"""Small, evidence-based interface to an explicitly selected community database."""
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import uuid
from contextlib import closing
from datetime import datetime, timezone

APP_ID = 'io.github.VioletN22.aplyd-community'
# Seconds to wait for the app (or another agent) to finish a write before giving up.
BUSY_TIMEOUT = 15
STAGES = {'applied','assessment','assessed','take_home','phone_screen','interview','offer','rejected','withdrawn'}


def now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def validate_directory(data_dir):
    p=Path(data_dir).expanduser()
    if not p.is_absolute():
        raise ValueError('--data-dir must be an explicit absolute community data directory')
    p=p.resolve()
    marker=p/'.aplyd-community.json'
    if not marker.is_file() or marker.is_symlink():
        raise ValueError('Community identity marker missing; launch Aplyd Community first and select its data directory')
    try: identity=json.loads(marker.read_text(encoding='utf-8-sig'))
    except (ValueError,UnicodeDecodeError): identity=None
    if not isinstance(identity,dict) or identity.get('appId') != APP_ID or identity.get('schemaVersion') != 1:
        raise ValueError('Not a supported Aplyd Community data directory')
    db=p/'job-tracker.db'
    if not db.is_file() or db.is_symlink():
        raise ValueError('Community database missing or is a symlink; open the community app first')
    for name in ('agent-workflows','agent-backups'):
        if (p/name).is_symlink():
            raise ValueError('Agent storage may not be a symlink')
    return p


def is_busy(error):
    return isinstance(error,sqlite3.OperationalError) and ('locked' in str(error) or 'busy' in str(error))


def backup_error(folder,error):
    if is_busy(error): return error
    return ValueError('Could not save a backup in '+str(folder)+' ('+str(error)+'), so nothing was changed. '
                      'Make that folder writable, then run the same command again.')


def evidence(d):
    value=d.get('evidence')
    if not isinstance(value,dict):
        raise ValueError('Evidence object is required')
    for key in ('source_id','text','observed_at'):
        if not isinstance(value.get(key),str) or not value[key].strip():
            raise ValueError('Evidence needs source_id, text and observed_at')
    try:
        timestamp=datetime.fromisoformat(value['observed_at'].replace('Z','+00:00'))
        if timestamp.tzinfo is None: raise ValueError()
    except ValueError:
        raise ValueError('observed_at must be an ISO timestamp with a timezone') from None
    return value


class Store:
    def __init__(self,data_dir):
        self.root=validate_directory(data_dir)
        self.path=self.root/'job-tracker.db'
        with closing(self.connect()) as c:
            columns={r['name'] for r in c.execute('PRAGMA table_info(applications)')}
            if not {'id','job_title','current_stage','raw_job_text','resume_doc_id'} <= columns:
                raise ValueError('Unsupported community schema; update and launch the app first')

    def connect(self,write=False):
        validate_directory(self.root)
        c=sqlite3.connect(self.path.as_uri()+('?mode=rw' if write else '?mode=ro'),uri=True,timeout=BUSY_TIMEOUT)
        c.row_factory=sqlite3.Row
        c.execute('PRAGMA foreign_keys=ON')
        return c

    def backup(self):
        folder=self.root/'agent-backups'
        path=folder/('before-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')+'-'+uuid.uuid4().hex[:8]+'.sqlite')
        try:
            folder.mkdir(mode=0o700,exist_ok=True)
            source=self.connect()
            try:
                dest=sqlite3.connect(path)
                try: source.backup(dest)
                finally: dest.close()
            finally: source.close()
        except (OSError,sqlite3.Error) as error:
            raise backup_error(folder,error) from None
        try: path.chmod(0o600)
        except OSError: pass
        return path

    def application(self,ident):
        with closing(self.connect()) as c:
            row=c.execute('SELECT * FROM applications WHERE id=?',(ident,)).fetchone()
            if not row: raise ValueError('Unknown application ID')
            return dict(row)

    def list_applications(self,d):
        limit=d.get('limit',100)
        if type(limit) is not int or not 1 <= limit <= 1000: raise ValueError('limit must be 1 to 1000')
        query=d.get('query','')
        if not isinstance(query,str): raise ValueError('query must be a string')
        with closing(self.connect()) as c:
            return [dict(r) for r in c.execute('SELECT id,company,job_title,job_url,location,current_stage,updated_at FROM applications WHERE company LIKE ? OR job_title LIKE ? ORDER BY updated_at DESC LIMIT ?',('%'+query+'%','%'+query+'%',limit))]

    def email_events(self,d):
        with closing(self.connect()) as c:
            if d.get('application_id'):
                rows=c.execute('SELECT * FROM email_events WHERE application_id=? ORDER BY created_at DESC LIMIT 200',(d['application_id'],))
            else:
                rows=c.execute('SELECT * FROM email_events ORDER BY created_at DESC LIMIT 200')
            # Pending classifier payloads can contain whole mail bodies; evidence is sufficient here.
            return [{k:r[k] for k in r.keys() if k!='pending_input'} for r in rows]

    def _ledger(self,c):
        c.execute('CREATE TABLE IF NOT EXISTS aplyd_agent_evidence(source_id TEXT PRIMARY KEY,request_hash TEXT NOT NULL,application_id TEXT NOT NULL,evidence TEXT NOT NULL,recorded_at TEXT NOT NULL)')

    def _existing(self,c,ev,signature):
        self._ledger(c)
        row=c.execute('SELECT * FROM aplyd_agent_evidence WHERE source_id=?',(ev['source_id'],)).fetchone()
        if row and row['request_hash']!=signature:
            raise ValueError('Evidence source was already used for a different change; review it instead of overwriting')
        return dict(row) if row else None

    def _remember(self,c,ev,signature,ident):
        c.execute('INSERT INTO aplyd_agent_evidence VALUES(?,?,?,?,?)',(ev['source_id'],signature,ident,json.dumps(ev),now()))

    def update(self,d):
        ev=evidence(d)
        changes=d.get('changes')
        allowed={'current_stage','notes','interview_at','prep_notes'}
        if not isinstance(changes,dict) or not changes or not set(changes)<=allowed:
            raise ValueError('changes allows only current_stage, notes, interview_at and prep_notes')
        if any(not isinstance(v,str) for v in changes.values()): raise ValueError('Changes must be strings')
        if 'current_stage' in changes and changes['current_stage'] not in STAGES: raise ValueError('Unrecognised stage')
        if 'current_stage' in changes and d.get('expected_stage') not in STAGES: raise ValueError('expected_stage is required for stage changes')
        if changes.get('interview_at'):
            try: datetime.fromisoformat(changes['interview_at'])
            except ValueError: raise ValueError('interview_at must be an ISO local date/time') from None
        ident=d.get('application_id')
        signature=hashlib.sha256(json.dumps({'action':'update','application_id':ident,'changes':changes,'evidence':ev},sort_keys=True).encode()).hexdigest()
        if d.get('apply') is not True:
            return {'preview':True,'application':self.application(ident),'changes':changes,'evidence':ev}
        c=self.connect(True)
        try:
            c.execute('BEGIN IMMEDIATE')
            existing=self._existing(c,ev,signature)
            if existing: return {'duplicate':True,'application_id':ident}
            row=c.execute('SELECT * FROM applications WHERE id=?',(ident,)).fetchone()
            if not row: raise ValueError('Unknown application ID')
            if 'current_stage' in changes and row['current_stage']!=d['expected_stage']:
                raise ValueError('Application stage changed since reading; review current evidence')
            self.backup()
            at=now()
            if 'current_stage' in changes and changes['current_stage']!=row['current_stage']:
                c.execute('UPDATE stage_history SET exited_at=? WHERE application_id=? AND exited_at IS NULL',(at,ident))
                c.execute('INSERT INTO stage_history(id,application_id,stage,entered_at,notes) VALUES(?,?,?,?,?)',('agent-'+uuid.uuid4().hex,ident,changes['current_stage'],at,ev['text']+'\nSource: '+ev['source_id']))
            # Column identifiers come only from the constant allowlist above.
            columns=sorted(changes)
            c.execute('UPDATE applications SET '+','.join(key+'=?' for key in columns)+',updated_at=? WHERE id=?',tuple(changes[key] for key in columns)+(at,ident))
            self._remember(c,ev,signature,ident); c.commit()
            return {'application_id':ident,'changes':changes,'duplicate':False}
        finally: c.close()

    def record(self,d):
        ev=evidence(d)
        from runner import canonical
        url=canonical(d.get('url',''))
        for key in ('company','title'):
            if not isinstance(d.get(key),str) or not d[key].strip(): raise ValueError('Missing '+key)
        stage=d.get('stage','applied')
        if stage not in STAGES: raise ValueError('Unrecognised stage')
        ident='agent-'+hashlib.sha256(ev['source_id'].encode()).hexdigest()[:32]
        content={k:d.get(k,'') for k in ('company','title','location','posting')}
        signature=hashlib.sha256(json.dumps({'action':'record',**content,'url':url,'stage':stage,'evidence':ev},sort_keys=True).encode()).hexdigest()
        if d.get('apply') is not True: return {'preview':True,'application_id':ident,**content,'url':url,'stage':stage,'evidence':ev}
        c=self.connect(True)
        try:
            c.execute('BEGIN IMMEDIATE')
            existing=self._existing(c,ev,signature)
            if existing: return {'duplicate':True,'application_id':existing['application_id']}
            for row in c.execute('SELECT id,company,job_title,job_url FROM applications'):
                try: same_url=canonical(row['job_url'])==url
                except (ValueError,TypeError): same_url=False
                same_role=row['company'].strip().casefold()==d['company'].strip().casefold() and row['job_title'].strip().casefold()==d['title'].strip().casefold()
                if same_url or same_role:
                    raise ValueError('Possible existing application '+row['id']+'; review/update it instead')
            self.backup()
            at=ev['observed_at']
            c.execute("INSERT OR IGNORE INTO workflows VALUES('standard','','Standard',?,0,?)",(json.dumps(sorted(STAGES)),at))
            c.execute('INSERT INTO applications(id,company,job_title,location,job_url,job_source,job_description,key_responsibilities,required_skills,nice_to_have_skills,current_stage,workflow_id,notes,created_at,updated_at,raw_job_text) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',(ident,d['company'],d['title'],d.get('location',''),url,'Email',d.get('posting',''),'','','',stage,'standard',ev['text'],at,at,d.get('posting','')))
            c.execute('INSERT INTO stage_history(id,application_id,stage,entered_at,notes) VALUES(?,?,?,?,?)',('agent-stage-'+ident,ident,stage,at,ev['text']+'\nSource: '+ev['source_id']))
            self._remember(c,ev,signature,ident); c.commit()
            return {'application_id':ident,'duplicate':False}
        finally: c.close()
