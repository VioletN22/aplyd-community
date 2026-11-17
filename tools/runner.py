#!/usr/bin/env python3
"""Local bookkeeping for AI-operated applications. No browser or model worker."""
import argparse
import hashlib
import html
import json
import os
import re
import shutil
import sqlite3
import sys
import uuid
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import local_store
from local_store import backup_error, validate_directory
STAGES = ['applied','assessment','phone_screen','interview','offer','rejected','withdrawn']


def now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def canonical(url):
    u = urlsplit(url)
    if u.scheme not in ('http','https') or not u.hostname or u.username or u.password:
        raise ValueError('A public HTTP(S) job URL is required')
    query = [(k,v) for k,v in parse_qsl(u.query,keep_blank_values=True)
             if not k.lower().startswith('utm_') and k.lower() not in ('gclid','fbclid','tracking','trackingid','trk','refid')]
    host = u.hostname.lower().removeprefix('www.')
    if host == 'indeed.com' or host.endswith('.indeed.com'):
        ids = dict(query)
        if ids.get('jk') or ids.get('vjk'):
            return 'https://indeed.com/viewjob?jk='+urlencode({'jk':ids.get('jk') or ids['vjk']})[3:]
    if host == 'linkedin.com' or host.endswith('.linkedin.com'):
        match = re.search(r'/jobs/view/(?:[^/]*-)?(\d+)/?$',u.path)
        if match:
            return 'https://linkedin.com/jobs/view/'+match[1]
        ids=dict(query)
        if ids.get('currentJobId'):
            return 'https://linkedin.com/jobs/view/'+ids['currentJobId']
    if host == 'seek.com.au' or host.endswith('.seek.com.au') or host=='au.seek.com':
        match=re.search(r'/job/(\d+)',u.path)
        if match:
            return 'https://seek.com.au/job/'+match[1]
    authority=host+((':'+str(u.port)) if u.port else '')
    return urlunsplit(('https',authority,u.path.rstrip('/') or '/',urlencode(sorted(query)),''))


def safe_name(value):
    return re.sub(r'[^\w .-]','',value).strip()[:90] or 'application'


def atomic_text(path, text):
    path=Path(path)
    path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_name(path.name+'.'+uuid.uuid4().hex+'.tmp')
    tmp.write_text(text,encoding='utf-8')
    os.replace(tmp,path)


class Runner:
    def __init__(self,data_dir):
        directory = validate_directory(data_dir)
        self.root=directory/'agent-workflows'
        self.aplyd=directory/'job-tracker.db'
        self.root.mkdir(parents=True,exist_ok=True,mode=0o700)
        if (self.root/'pipeline.sqlite').is_symlink():
            raise ValueError('Queue database may not be a symlink')
        self.q=sqlite3.connect(self.root/'pipeline.sqlite',timeout=local_store.BUSY_TIMEOUT)
        self.q.row_factory=sqlite3.Row
        self.q.execute('PRAGMA foreign_keys=ON')
        self.q.execute('PRAGMA journal_mode=WAL')
        self.q.executescript('''
          CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,agent TEXT,owner TEXT,state TEXT,target INTEGER,created_at TEXT,updated_at TEXT);
          CREATE UNIQUE INDEX IF NOT EXISTS one_running ON runs(state) WHERE state='running';
          CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,url TEXT UNIQUE,company TEXT,title TEXT,location TEXT,source TEXT,state TEXT,run_id TEXT REFERENCES runs(id),payload TEXT,created_at TEXT,updated_at TEXT);
          CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY,run_id TEXT,job_id TEXT,kind TEXT,data TEXT,at TEXT);
          CREATE TABLE IF NOT EXISTS resume_versions(source_path TEXT,sha256 TEXT,doc_id TEXT NOT NULL,archive_path TEXT NOT NULL,PRIMARY KEY(source_path,sha256));
        ''')

    def connection(self,write=False):
        if not self.aplyd.is_file():
            raise ValueError('Aplyd database is missing: '+str(self.aplyd))
        c=sqlite3.connect(self.aplyd.as_uri()+('?mode=rw' if write else '?mode=ro'),uri=True,timeout=local_store.BUSY_TIMEOUT)
        c.row_factory=sqlite3.Row
        c.execute('PRAGMA foreign_keys=ON')
        required={'applications':{'raw_job_text','resume_doc_id'},'locker_documents':{'tags','file_path'},'cover_letters':{'application_id','is_final'},'attachments':{'file_path'}}
        for table,columns in required.items():
            actual={r['name'] for r in c.execute('PRAGMA table_info('+table+')')}
            if not columns <= actual:
                c.close()
                raise ValueError('Unsupported Aplyd schema; inspect '+table+' before writing')
        return c

    def backup(self):
        dest=self.root/'backups'/('aplyd-'+datetime.now().strftime('%Y-%m-%d')+'.sqlite')
        if dest.exists():
            return
        tmp=dest.with_name(dest.stem+'.'+uuid.uuid4().hex+'.tmp')
        try:
            dest.parent.mkdir(parents=True,exist_ok=True)
            source=self.connection()
            try:
                target=sqlite3.connect(tmp)
                try: source.backup(target)
                finally: target.close()
            finally: source.close()
            os.replace(tmp,dest)
        except (OSError,sqlite3.Error) as error:
            try: tmp.unlink(missing_ok=True)
            except OSError: pass
            raise backup_error(dest.parent,error) from None

    def event(self,kind,data,job_id=None,run_id=None):
        self.q.execute('INSERT INTO events(run_id,job_id,kind,data,at) VALUES(?,?,?,?,?)',(run_id,job_id,kind,json.dumps(data),now()))

    def auth(self,data):
        run=self.q.execute('SELECT * FROM runs WHERE id=?',(data.get('run_id'),)).fetchone()
        if not run or run['state']!='running' or run['owner']!=data.get('owner'):
            raise ValueError('An active run and its current owner token are required')
        self.q.execute('UPDATE runs SET updated_at=? WHERE id=?',(now(),run['id']))
        return dict(run)

    def job(self,job_id):
        row=self.q.execute('SELECT * FROM jobs WHERE id=?',(job_id,)).fetchone()
        if not row: raise ValueError('Unknown job')
        result=dict(row); result['payload']=json.loads(result['payload'])
        return result

    def owned_job(self,data):
        self.auth(data)
        job=self.job(data['job_id'])
        if job['run_id']!=data['run_id']: raise ValueError('Job belongs to another run; adopt it first')
        return job

    def save(self,job,state=None):
        if state: job['state']=state
        job['updated_at']=now()
        self.q.execute('UPDATE jobs SET state=?,payload=?,run_id=?,updated_at=? WHERE id=?',
                       (job['state'],json.dumps(job['payload']),job['run_id'],job['updated_at'],job['id']))
        self.event(job['state'],{},job['id'],job['run_id'])
        return job

    def existing_aplyd(self,url):
        c=self.connection()
        try:
            for row in c.execute('SELECT id,company,job_title,job_url,current_stage FROM applications'):
                try:
                    if canonical(row['job_url'])==url: return dict(row)
                except (ValueError,TypeError): pass
        finally: c.close()
        return None

    def register_resume(self,data):
        file=Path(data['resume_path']).expanduser().resolve()
        if not file.is_file() or file.suffix.lower() not in ('.pdf','.docx'):
            raise ValueError('Resume must be an existing PDF or DOCX')
        content=file.read_bytes()
        sha=hashlib.sha256(content).hexdigest()
        version=self.q.execute('SELECT doc_id,archive_path FROM resume_versions WHERE source_path=? AND sha256=?',(str(file),sha)).fetchone()
        archive=Path(version['archive_path']) if version else self.root/'library'/'resumes'/sha/file.name
        if archive.exists():
            if digest(archive)!=sha: raise ValueError('Archived resume hash changed; restore the original archived version')
        else:
            archive.parent.mkdir(parents=True,exist_ok=True)
            tmp=archive.with_name(archive.name+'.'+uuid.uuid4().hex+'.tmp')
            try:
                tmp.write_bytes(content)
                os.replace(tmp,archive)
            finally:
                tmp.unlink(missing_ok=True)
        focus=data.get('resume_focus','').strip()
        self.backup()
        c=self.connection(True)
        try:
            c.execute('BEGIN IMMEDIATE')
            existing=c.execute('SELECT * FROM locker_documents WHERE file_path=?',(str(file),)).fetchone()
            if not existing and version:
                existing=c.execute('SELECT * FROM locker_documents WHERE id=? AND file_path=?',(version['doc_id'],str(archive))).fetchone()
            if not existing:
                # Recover a committed Aplyd write even when the queue transaction
                # (including resume_versions) was lost in a crash.
                existing=c.execute('SELECT * FROM locker_documents WHERE file_path=?',(str(archive),)).fetchone()
            if existing:
                doc_id=existing['id']
                if 'resume' not in json.loads(existing['tags']): raise ValueError('This file is registered as a different document type')
                if existing['file_path']!=str(archive):
                    c.execute('UPDATE locker_documents SET file_path=? WHERE id=?',(str(archive),doc_id))
            else:
                if not focus: raise ValueError('A new resume needs a focus note explaining suitable roles')
                doc_id=str(uuid.uuid4())
                c.execute('INSERT INTO locker_documents(id,label,file_path,tags,is_default,created_at) VALUES(?,?,?,?,0,?)',
                          (doc_id,data.get('resume_label') or file.name,str(archive),json.dumps(['resume']+data.get('tags',[])),now()))
            if focus:
                row=c.execute("SELECT value FROM app_settings WHERE key='resume_focus'").fetchone()
                notes=json.loads(row['value']) if row else {}
                notes[doc_id]=focus
                c.execute("INSERT INTO app_settings(key,value) VALUES('resume_focus',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",(json.dumps(notes),))
            c.commit()
        except Exception:
            c.rollback(); raise
        finally: c.close()
        self.q.execute('INSERT INTO resume_versions(source_path,sha256,doc_id,archive_path) VALUES(?,?,?,?) ON CONFLICT(source_path,sha256) DO UPDATE SET doc_id=excluded.doc_id,archive_path=excluded.archive_path',
                       (str(file),sha,doc_id,str(archive)))
        return {'id':doc_id,'path':str(archive),'source_path':str(file),'sha256':sha}

    def dispatch(self,action,data):
        read_actions={'context','status','job','report','init'}
        if action in read_actions:
            return self.read(action,data)
        self.q.execute('BEGIN IMMEDIATE')
        try:
            result=self.mutate(action,data)
            self.q.commit()
        except Exception:
            self.q.rollback(); raise
        try:
            report=self.report({})
            if isinstance(result,dict): result['report']=report['path']
        except OSError as e:
            result['report_error']=str(e)
        return result

    def mutate(self,action,d):
        if action=='start':
            if self.q.execute("SELECT 1 FROM runs WHERE state='running'").fetchone():
                raise ValueError('Another run is active; status shows who owns it. Pause/handoff or explicitly resume after a crash.')
            run_id=datetime.now().strftime('%Y-%m-%d')+'-'+uuid.uuid4().hex[:6]
            owner=str(uuid.uuid4())
            target=d.get('target',1)
            if type(target) is not int or target<1: raise ValueError('Target must be a positive integer')
            if d.get('agent','codex') not in ('codex','claude'): raise ValueError('Agent must be codex or claude')
            self.q.execute('INSERT INTO runs VALUES(?,?,?,?,?,?,?)',(run_id,d.get('agent','codex'),owner,'running',target,now(),now()))
            self.event('started',{'agent':d.get('agent','codex')},run_id=run_id)
            return {'run_id':run_id,'owner':owner,'target':target}
        if action=='resume':
            run=self.q.execute('SELECT * FROM runs WHERE id=?',(d['run_id'],)).fetchone()
            if not run or run['state']=='completed': raise ValueError('Choose a paused or interrupted run')
            active=self.q.execute("SELECT id FROM runs WHERE state='running'").fetchone()
            if active and (active['id']!=run['id'] or d.get('takeover') is not True):
                raise ValueError('A run is active. Explicit takeover requires checking the other agent has stopped.')
            owner=str(uuid.uuid4())
            self.q.execute("UPDATE jobs SET state='uncertain',updated_at=? WHERE run_id=? AND state='submitting'",(now(),run['id']))
            self.q.execute("UPDATE runs SET state='running',owner=?,agent=?,updated_at=? WHERE id=?",(owner,d.get('agent','codex'),now(),run['id']))
            self.event('resumed',{'agent':d.get('agent','codex')},run_id=run['id'])
            return {'run_id':run['id'],'owner':owner}
        run=self.auth(d)
        if action in ('pause','finish'):
            self.q.execute("UPDATE jobs SET state='uncertain',updated_at=? WHERE run_id=? AND state='submitting'",(now(),run['id']))
            state='paused' if action=='pause' else 'completed'
            self.q.execute('UPDATE runs SET state=?,updated_at=? WHERE id=?',(state,now(),run['id']))
            self.event(state,{'reason':d.get('reason','')},run_id=run['id'])
            return {'run_id':run['id'],'state':state}
        if action=='register-resume': return self.register_resume(d)
        if action=='enqueue':
            url=canonical(d['url'])
            existing=self.q.execute('SELECT id FROM jobs WHERE url=?',(url,)).fetchone()
            if existing: return {**self.job(existing['id']),'duplicate':True}
            for key in ('company','title','posting'):
                if not str(d.get(key,'')).strip(): raise ValueError('Missing '+key)
            applied=self.existing_aplyd(url)
            state='already_tracked' if applied else 'queued'
            payload={k:v for k,v in d.items() if k not in ('owner','run_id')}
            if applied: payload['existing_application']=applied
            if not applied:
                possible=self.q.execute('SELECT id,payload FROM jobs WHERE lower(company)=lower(?) AND lower(title)=lower(?) AND lower(location)=lower(?)',
                                        (d['company'],d['title'],d.get('location',''))).fetchall()
                ambiguous=[]
                for candidate in possible:
                    old=json.loads(candidate['payload']).get('requisition_id')
                    new=d.get('requisition_id')
                    if not old or not new or old==new: ambiguous.append(candidate['id'])
                c=self.connection()
                try:
                    historical=[dict(row) for row in c.execute(
                        'SELECT id,company,job_title,location,job_url,current_stage FROM applications WHERE lower(trim(company))=lower(trim(?)) AND lower(trim(job_title))=lower(trim(?))',
                        (d['company'],d['title']))]
                finally:
                    c.close()
                if historical:
                    # Aplyd has no requisition field: same role is a review candidate,
                    # never proof that a distinct vacancy has already been applied to.
                    payload['possible_aplyd_duplicates']=historical
                    ambiguous.extend('aplyd:'+row['id'] for row in historical)
                if ambiguous:
                    state='needs_review'; payload['possible_duplicates']=ambiguous
                    payload['duplicate_reason']='Check whether this is the same vacancy on another website or an existing Aplyd application.'
                    payload['reason']=payload['duplicate_reason']
            ident=str(uuid.uuid4())
            self.q.execute('INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?,?,?)',
                           (ident,url,d['company'],d['title'],d.get('location',''),d.get('source','Other'),state,run['id'],json.dumps(payload),now(),now()))
            self.event(state,{},ident,run['id'])
            return self.job(ident)
        job=self.job(d['job_id'])
        if action=='adopt':
            previous=self.q.execute('SELECT state FROM runs WHERE id=?',(job['run_id'],)).fetchone()
            if job['run_id']!=run['id'] and previous and previous['state']=='running': raise ValueError('Another active run owns this job')
            if job['state'] in ('submitted','already_tracked','skipped'): raise ValueError('This job is already settled')
            if job['state']=='submitting': job['state']='uncertain'
            job['run_id']=run['id']
            return self.save(job)
        if job['run_id']!=run['id']: raise ValueError('Job belongs to another run; adopt it first')
        if action=='prepare':
            if job['state'] not in ('queued','prepared','needs_input','needs_review'): raise ValueError('Cannot replace files after a submission may have occurred')
            posting=d.get('posting',job['payload']['posting'])
            if not isinstance(posting,str) or not posting.strip(): raise ValueError('posting must be a nonempty string')
            duplicate_check=d.get('duplicate_check',job['payload'].get('duplicate_check',''))
            if (job['state']=='needs_review' or job['payload'].get('possible_duplicates')) and (not isinstance(duplicate_check,str) or not duplicate_check.strip()):
                raise ValueError('Resolve the possible duplicate first and record the evidence in duplicate_check')
            document=self.register_resume(d)
            folder=self.root/run['id']/(safe_name(job['company']+' - '+job['title'])+' - '+job['id'][:8])
            folder.mkdir(parents=True,exist_ok=True)
            payload=job['payload']
            payload['posting']=posting
            snapshot=folder/Path(document['path']).name
            shutil.copy2(document['path'],snapshot)
            payload.update({'folder':str(folder),'resume_doc_id':document['id'],'resume_original':document['source_path'],'resume_archive':document['path'],'resume_snapshot':str(snapshot),'resume_sha256':digest(snapshot)})
            payload.pop('resume_companion_snapshot',None)
            payload.pop('snapshot_files',None)
            source_docx=Path(document['source_path']).with_suffix('.docx')
            if source_docx.is_file() and source_docx!=Path(document['source_path']):
                companion=folder/source_docx.name
                shutil.copy2(source_docx,companion)
                payload['resume_companion_snapshot']=str(companion)
            letter=d.get('cover_letter_text','')
            payload['cover_letter_text']=letter
            payload.pop('cover_letter_path',None)
            payload.pop('cover_letter_sha256',None)
            if d.get('cover_letter_path'):
                letterfile=Path(d['cover_letter_path']).expanduser().resolve()
                if not letterfile.is_file() or letterfile.suffix.lower() not in ('.pdf','.docx'): raise ValueError('Cover letter file is missing or unsupported')
                if not letter.strip(): raise ValueError('Include the text of the exact cover letter for Aplyd')
                target=folder/('cover-letter'+letterfile.suffix.lower())
                shutil.copy2(letterfile,target)
                payload['cover_letter_path']=str(target)
                payload['cover_letter_sha256']=digest(target)
            atomic_text(folder/'cover-letter.txt',letter)
            atomic_text(folder/'job.txt',payload['posting'])
            payload['answers']=d.get('answers',{})
            payload['reason']=d.get('reason','')
            payload['duplicate_check']=duplicate_check
            atomic_text(folder/'answers.json',json.dumps(payload['answers'],ensure_ascii=False,indent=2))
            atomic_text(folder/'manifest.json',json.dumps({'job_id':job['id'],'url':job['url'],**payload},ensure_ascii=False,indent=2))
            files=[snapshot,folder/'job.txt',folder/'answers.json',folder/'manifest.json']
            for key in ('resume_companion_snapshot','cover_letter_path'):
                if payload.get(key): files.append(Path(payload[key]))
            if letter: files.append(folder/'cover-letter.txt')
            # A fresh allowlist replaces the previous preparation. Leftovers are never submitted.
            payload['snapshot_files']={str(file):digest(file) for file in files}
            return self.save(job,'prepared')
        if action=='begin-submit':
            if job['state']!='prepared': raise ValueError('Only a prepared job can start submission; reconcile uncertain attempts first')
            p=job['payload']
            duplicate_check=p.get('duplicate_check','')
            if p.get('possible_duplicates') and (not isinstance(duplicate_check,str) or not duplicate_check.strip()):
                raise ValueError('Resolve the possible duplicate before submitting')
            self.verify_snapshots(p)
            duplicate=self.existing_aplyd(job['url'])
            if duplicate: raise ValueError('This vacancy is already tracked in Aplyd; reconcile before submitting')
            p['attempt_id']=str(uuid.uuid4()); p['attempt_started_at']=now()
            return self.save(job,'submitting')
        if action=='confirm':
            if job['state'] not in ('submitting','uncertain'): raise ValueError('No submission attempt to confirm')
            if not d.get('evidence_text','').strip() or not d.get('evidence_url','').strip(): raise ValueError('Confirmation needs observed evidence text and its URL')
            job['payload']['confirmation']={'text':d['evidence_text'],'url':d['evidence_url'],'at':now(),'reference':d.get('reference','')}
            if d.get('evidence_path'):
                source=Path(d['evidence_path']).expanduser().resolve()
                dest=Path(job['payload']['folder'])/('confirmation'+source.suffix)
                shutil.copy2(source,dest)
                job['payload']['confirmation']['file']=str(dest)
                job['payload']['snapshot_files'][str(dest)]=digest(dest)
            receipt=Path(job['payload']['folder'])/'confirmation.json'
            atomic_text(receipt,json.dumps(job['payload']['confirmation'],indent=2))
            job['payload']['snapshot_files'][str(receipt)]=digest(receipt)
            return self.save(job,'confirmed')
        if action=='sync':
            if job['state'] not in ('confirmed','submitted'): raise ValueError('Only confirmed submissions may be added to Aplyd')
            return self.sync(job)
        if action=='reconcile':
            if job['state'] not in ('uncertain','submitting'): raise ValueError('No uncertain submission to reconcile')
            if not d.get('evidence_text','').strip() or d.get('verified_not_submitted') is not True: raise ValueError('Document evidence that the application was not submitted before retrying')
            job['payload']['reconciliation']={'text':d['evidence_text'],'at':now()}
            return self.save(job,'prepared')
        if action=='hold':
            if job['state'] in ('submitted','confirmed','already_tracked'): raise ValueError('Cannot hold a settled application')
            state='uncertain' if job['state'] in ('submitting','uncertain') else 'needs_input'
            if not d.get('reason','').strip(): raise ValueError('Explain what needs attention')
            job['payload']['reason']=d['reason']
            return self.save(job,state)
        if action=='skip':
            if job['state'] in ('submitting','uncertain','confirmed','submitted'): raise ValueError('Reconcile the submission outcome first')
            if not d.get('reason','').strip(): raise ValueError('Explain why the job was skipped')
            job['payload']['reason']=d['reason']
            return self.save(job,'skipped')
        raise ValueError('Unknown action: '+action)

    def verify_snapshots(self,payload):
        files=payload.get('snapshot_files')
        if not isinstance(files,dict) or not files:
            raise ValueError('Preparation has no verified file manifest; review and prepare again before submitting')
        for pathkey,hashkey in (('resume_snapshot','resume_sha256'),('cover_letter_path','cover_letter_sha256')):
            if payload.get(pathkey) and digest(payload[pathkey])!=payload[hashkey]:
                raise ValueError('Document hash changed after preparation')
        for file,sha in files.items():
            if digest(file)!=sha:
                raise ValueError('Application snapshot changed; restore the verified file before continuing')
        return [Path(file) for file in files]

    def sync(self,job):
        p=job['payload']; app_id='daily-'+job['id']
        files=self.verify_snapshots(p)
        self.backup()
        duplicate=self.existing_aplyd(job['url'])
        if duplicate and duplicate['id']!=app_id:
            raise ValueError('Aplyd has a separate record for this vacancy; reconcile it instead of duplicating')
        c=self.connection(True)
        try:
            c.execute('BEGIN IMMEDIATE')
            if not c.execute('SELECT 1 FROM applications WHERE id=?',(app_id,)).fetchone():
                c.execute("INSERT OR IGNORE INTO workflows(id,company,name,stages,is_default,created_at) VALUES('standard','','Standard',?,0,?)",(json.dumps(STAGES),now()))
                at=p['confirmation']['at']
                notes='Submitted by daily application runner.\nRun: '+job['run_id']+'\nFiles: '+p['folder']+'\nConfirmation: '+p['confirmation']['text']+'\nAnswers: '+json.dumps(p.get('answers',{}),ensure_ascii=False)
                c.execute('''INSERT INTO applications(id,company,job_title,location,job_url,job_source,job_description,key_responsibilities,required_skills,nice_to_have_skills,current_stage,workflow_id,notes,created_at,updated_at,raw_job_text,resume_doc_id)
                   VALUES(?,?,?,?,?,?,?,?,?,?,'applied','standard',?,?,?,?,?)''',
                   (app_id,job['company'],job['title'],job['location'],job['url'],job['source'],p.get('summary') or p['posting'],
                    '\n'.join(p['key_responsibilities']) if isinstance(p.get('key_responsibilities'),list) else p.get('key_responsibilities',''),
                    '\n'.join(p['required_skills']) if isinstance(p.get('required_skills'),list) else p.get('required_skills',''),
                    '\n'.join(p['nice_to_have_skills']) if isinstance(p.get('nice_to_have_skills'),list) else p.get('nice_to_have_skills',''),
                    notes,at,at,p['posting'],p['resume_doc_id']))
                c.execute('INSERT INTO stage_history(id,application_id,stage,entered_at,notes) VALUES(?,?,?,?,?)',('daily-stage-'+job['id'],app_id,'applied',at,p['confirmation']['text']))
                if p.get('cover_letter_text'):
                    c.execute('''INSERT INTO cover_letters(id,company,role,job_url,application_id,label,body,is_final,created_at,updated_at)
                       VALUES(?,?,?,?,?,?,?,1,?,?)''',('daily-letter-'+job['id'],job['company'],job['title'],job['url'],app_id,'Submitted version',p['cover_letter_text'],at,at))
                for file in files:
                    c.execute('INSERT INTO attachments(id,application_id,file_name,file_type,file_path,created_at) VALUES(?,?,?,?,?,?)',
                              (str(uuid.uuid4()),app_id,file.name,file.suffix.lstrip('.'),str(file),at))
            self.verify_snapshots(p)
            c.commit()
        except Exception:
            c.rollback(); raise
        finally: c.close()
        p['application_id']=app_id
        return self.save(job,'submitted')

    def read(self,action,d):
        if action=='job': return self.job(d['job_id'])
        if action in ('report','init'): return self.report(d)
        runs=[{k:r[k] for k in r.keys() if k!='owner'} for r in self.q.execute('SELECT * FROM runs ORDER BY created_at DESC')]
        jobs=[self.job(r['id']) for r in self.q.execute('SELECT id FROM jobs ORDER BY created_at DESC')]
        if action=='status': return {'runs':runs,'jobs':jobs}
        if action=='context':
            c=self.connection()
            try:
                settings=dict(c.execute("SELECT key,value FROM app_settings WHERE key IN ('profile','resume_focus','voice_profile','cover_letter_dir')"))
                docs=[dict(r) for r in c.execute('SELECT * FROM locker_documents')]
                for doc in docs: doc['exists']=Path(doc['file_path']).is_file()
                return {'settings':settings,'documents':docs,'answer_bank':[dict(r) for r in c.execute('SELECT * FROM answer_bank')],
                        'portfolio':[dict(r) for r in c.execute('SELECT * FROM portfolio_links')],
                        'voice_notes':[dict(r) for r in c.execute('SELECT * FROM voice_notes ORDER BY created_at DESC LIMIT 20')],
                        'letter_examples':[dict(r) for r in c.execute('SELECT company,role,body FROM cover_letters WHERE is_final=1 ORDER BY updated_at DESC LIMIT 3')],
                        'application_count':c.execute('SELECT count(*) FROM applications').fetchone()[0],
                        'runs':runs,'outstanding':[j for j in jobs if j['state'] not in ('submitted','skipped','already_tracked')]}
            finally: c.close()
        raise ValueError('Unknown read action')

    def report(self,d):
        run_id=d.get('run_id')
        run=self.q.execute('SELECT * FROM runs WHERE id=?',(run_id,)).fetchone() if run_id else self.q.execute('SELECT * FROM runs ORDER BY created_at DESC,rowid DESC LIMIT 1').fetchone()
        jobs=[self.job(r['id']) for r in self.q.execute('SELECT id FROM jobs WHERE run_id=? ORDER BY updated_at DESC',(run['id'],))] if run else []
        counts=dict(Counter(j['state'] for j in jobs))
        target=run['target'] if run else 1
        submitted=counts.get('submitted',0)+counts.get('confirmed',0)
        waiting=sum(counts.get(k,0) for k in ('needs_input','needs_review','uncertain'))
        labels={'queued':'In queue','prepared':'Ready','submitting':'Submitting','uncertain':'Check submission','confirmed':'Submitted · sync pending','submitted':'Submitted','needs_input':'Needs you','needs_review':'Check duplicate','skipped':'Skipped','already_tracked':'Already in Aplyd'}
        esc=lambda v:html.escape(str(v),quote=True)
        rows=''
        for j in jobs:
            p=j['payload']; links=[]
            for key,label in (('resume_snapshot','Resume'),('cover_letter_path','Letter')):
                if p.get(key): links.append('<a href="'+esc(Path(p[key]).as_uri())+'">'+label+'</a>')
            if p.get('folder'): links.append('<a href="'+esc(Path(p['folder']).as_uri())+'">Files</a>')
            rows+='<tr data-state="'+esc(j['state'])+'"><td><a class="role" href="'+esc(j['url'])+'" target="_blank" rel="noopener">'+esc(j['title'])+'</a><div>'+esc(j['company'])+'</div></td><td>'+esc(j['location'])+'<div>'+esc(j['source'])+'</div></td><td><span class="status '+esc(j['state'])+'">'+esc(labels[j['state']])+'</span><div class="reason">'+esc(p.get('reason',''))+'</div></td><td>'+' &nbsp; '.join(links)+'</td></tr>'
        title='Ready for your first run' if not run else ('Applications in progress' if run['state']=='running' else 'Your application report')
        sub='Ask Codex or Claude to use aplyd-daily-applications.' if not run else ('Run '+run['id']+' · '+run['agent'].capitalize()+' · '+run['state'])
        table='<table><thead><tr><th>Opportunity</th><th>Where</th><th>Progress</th><th>Documents</th></tr></thead><tbody>'+rows+'</tbody></table>' if rows else '<div class="empty"><h2>Your next opportunity starts here.</h2><p>Choose roles using your own saved preferences.</p><p>No applications have been submitted in this run.</p></div>'
        report='''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Your applications</title><style>
          :root{font-family:"Avenir Next",Avenir,system-ui,sans-serif;color:#233342;background:#f4f7fa}*{box-sizing:border-box}body{margin:0}main{max-width:1120px;margin:0 auto;padding:48px 32px}header{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #c9d9e5;padding-bottom:20px}header strong{font-size:19px;color:#284e6d}a{color:#285a7e;text-underline-offset:3px}h1{font-size:clamp(30px,4vw,44px);font-weight:600;letter-spacing:-1.3px;margin:35px 0 8px}p{line-height:1.6;color:#5b6d7c;max-width:760px}.summary{display:flex;gap:48px;margin:30px 0;padding:25px 0;border-block:1px solid #c9d9e5}.metric strong{display:block;font-size:34px;font-weight:600}.metric span{font-size:14px;color:#5b6d7c}.metric:first-child strong{color:#266c59}.progress{height:5px;background:#dbe5ec;border-radius:3px;margin-top:14px;overflow:hidden}.progress span{height:100%;background:#468d79;display:block}.tools{display:flex;gap:10px;margin:26px 0 18px}button,input,select{font:inherit;border:1px solid #b6cbdc;border-radius:6px;background:white;padding:9px 13px;color:#284e6d}input{flex:1;min-width:100px}button{cursor:pointer}table{width:100%;border-collapse:collapse;text-align:left;font-size:14px}th{font-size:13px;font-weight:500;color:#607686;padding:12px}td{padding:19px 12px;border-top:1px solid #dbe5ec;vertical-align:top}td div{color:#647888;margin-top:5px}.role{font-size:16px;font-weight:600;text-decoration:none}.status{display:inline-block;border-radius:5px;background:#e4ecf4;padding:5px 8px;white-space:nowrap}.submitted,.confirmed{background:#dcefe7;color:#255e4d}.uncertain,.needs_input,.needs_review{background:#fff0ce;color:#755318}.reason{max-width:280px;font-size:12px}.empty{background:white;border-radius:10px;padding:38px;margin-top:25px}.empty h2{font-weight:500;font-size:23px}.empty p{margin:8px 0}footer{margin-top:36px;font-size:12px;color:#607686}details{margin-top:28px}details p{font-size:14px}@media(max-width:650px){main{padding:24px 16px}.summary{gap:23px;flex-wrap:wrap}table{display:block;overflow:auto}.tools{flex-wrap:wrap}header{align-items:flex-start;gap:10px}h1{letter-spacing:-.8px}}
          </style></head><body><main><header><strong>Your applications</strong><button onclick="location.reload()">Refresh report</button></header>'''
        report+='<h1>'+esc(title)+'</h1><p>'+esc(sub)+'</p><section class="summary">'
        for value,label in ((submitted,'Submitted'),(counts.get('prepared',0),'Ready to apply'),(waiting,'Need attention'),(len(jobs),'Considered')):
            report+='<div class="metric"><strong>'+str(value)+'</strong><span>'+label+'</span></div>'
        report+='</section><p>'+str(submitted)+' confirmed submissions / '+str(target)+' daily aim</p><div class="progress"><span style="width:'+str(min(100,100*submitted/target))+'%"></span></div>'
        report+='<div class="tools"><input id="search" aria-label="Search applications" placeholder="Find a role or company"><select id="filter" aria-label="Filter progress"><option value="all">All progress</option><option value="submitted">Submitted</option><option value="prepared">Ready</option><option value="attention">Needs attention</option></select></div>'+table
        report+='<details><summary>How this run works</summary><p>Your AI finds jobs, chooses or tailors your documents, completes applications, and verifies the result. Confirmed applications and resume variants are saved in Aplyd. Jobs awaiting submission stay in the shared queue. Codex and Claude can hand off the same run.</p><p>This is a local report, updated after each recorded step. The AI must be actively running to do the work. Refresh to see saved progress.</p></details><footer>Saved '+esc(now())+' · Files stay in your community data directory. “Submitted” requires recorded confirmation.</footer>'
        report+='''</main><script>function filter(){let q=document.getElementById('search').value.toLowerCase(),s=document.getElementById('filter').value;document.querySelectorAll('tbody tr').forEach(r=>{let state=r.dataset.state,m=s==='all'||state===s||(s==='submitted'&&state==='confirmed')||(s==='attention'&&['uncertain','needs_input','needs_review'].includes(state));r.hidden=!m||!r.textContent.toLowerCase().includes(q)})}document.getElementById('search').addEventListener('input',filter);document.getElementById('filter').addEventListener('change',filter);</script></body></html>'''
        dest=self.root/'dashboard.html'
        atomic_text(dest,report)
        if run:
            atomic_text(self.root/run['id']/'report.html',report)
            atomic_text(self.root/run['id']/'report.json',json.dumps({'run_id':run['id'],'state':run['state'],'target':target,'counts':counts,'jobs':jobs},indent=2,ensure_ascii=False))
        return {'path':str(dest),'counts':counts,'run_id':run['id'] if run else None}
