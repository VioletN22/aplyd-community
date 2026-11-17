import importlib.util
import io
import os
from contextlib import closing
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from local_store import Store, APP_ID
from runner import Runner


def fixture(root):
    root.mkdir(exist_ok=True)
    (root/'.aplyd-community.json').write_text(json.dumps({'appId': APP_ID, 'schemaVersion': 1}), encoding='utf-8')
    c=sqlite3.connect(root/'job-tracker.db')
    c.executescript('''
    CREATE TABLE workflows(id TEXT PRIMARY KEY,company TEXT,name TEXT,stages TEXT,is_default INTEGER,created_at TEXT);
    CREATE TABLE applications(id TEXT PRIMARY KEY,company TEXT,job_title TEXT,location TEXT,job_url TEXT,job_source TEXT,job_description TEXT,key_responsibilities TEXT,required_skills TEXT,nice_to_have_skills TEXT,current_stage TEXT,workflow_id TEXT,notes TEXT,created_at TEXT,updated_at TEXT,raw_job_text TEXT,resume_doc_id TEXT,interview_at TEXT,prep_notes TEXT);
    CREATE TABLE stage_history(id TEXT PRIMARY KEY,application_id TEXT,stage TEXT,entered_at TEXT,exited_at TEXT,notes TEXT);
    CREATE TABLE locker_documents(id TEXT PRIMARY KEY,label TEXT,file_path TEXT,tags TEXT,is_default INTEGER,created_at TEXT);
    CREATE TABLE app_settings(key TEXT PRIMARY KEY,value TEXT);
    CREATE TABLE cover_letters(id TEXT PRIMARY KEY,company TEXT,role TEXT,job_url TEXT,application_id TEXT,label TEXT,body TEXT,is_final INTEGER,created_at TEXT,updated_at TEXT);
    CREATE TABLE attachments(id TEXT PRIMARY KEY,application_id TEXT,file_name TEXT,file_type TEXT,file_path TEXT,created_at TEXT);
    CREATE TABLE answer_bank(id TEXT,field_key TEXT,label TEXT,value TEXT,context TEXT,patterns TEXT,created_at TEXT,updated_at TEXT);
    CREATE TABLE portfolio_links(id TEXT,label TEXT,url TEXT,created_at TEXT);
    CREATE TABLE voice_notes(id TEXT,kind TEXT,note TEXT,created_at TEXT);
    CREATE TABLE email_events(id TEXT,email TEXT,message_id TEXT,application_id TEXT,kind TEXT,evidence TEXT,status TEXT,created_at TEXT);
    INSERT INTO app_settings VALUES('profile','{"Full name":"Example Candidate"}');
    INSERT INTO applications(id,company,job_title,job_url,current_stage,created_at,updated_at) VALUES('example','Example Org','Developer','https://example.org/jobs/1','applied','2026-01-01','2026-01-01');
    ''')
    c.commit(); c.close()


class ToolsTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.root=Path(self.temp.name)/'community'
        fixture(self.root)
        self.store=Store(self.root)

    def tearDown(self):
        self.temp.cleanup()

    def update(self, **extra):
        return dict(application_id='example', changes={'current_stage':'interview'}, expected_stage='applied',
                    evidence={'source_id':'mail:example-account:message-1','text':'Invitation for Example Org developer interview','observed_at':'2026-11-16T10:00:00Z'}, **extra)

    def test_requires_community_marker(self):
        (self.root/'.aplyd-community.json').unlink()
        with self.assertRaises(ValueError): Store(self.root)
        self.assertFalse((self.root/'agent-workflows').exists())

    def test_refuses_wrong_identity_and_database_symlink(self):
        (self.root/'.aplyd-community.json').write_text('{"appId":"private"}', encoding='utf-8')
        with self.assertRaises(ValueError): Runner(self.root)
        (self.root/'.aplyd-community.json').write_text(json.dumps({'appId':APP_ID,'schemaVersion':1}), encoding='utf-8')
        original=self.root/'job-tracker.db'
        moved=self.root.parent/'other.db'
        original.rename(moved)
        try: original.symlink_to(moved)
        except OSError: self.skipTest('symlinks unavailable')
        with self.assertRaises(ValueError): Store(self.root)

    def test_preview_does_not_mutate(self):
        result=self.store.update(self.update())
        self.assertTrue(result['preview'])
        self.assertEqual(self.store.application('example')['current_stage'],'applied')
        self.assertFalse((self.root/'agent-backups').exists())

    def test_evidence_required_and_no_sql(self):
        for invalid in ({}, {'source_id':'a','text':'','observed_at':'2026-01-01'}, {'source_id':'a','text':'ok','observed_at':'yesterday'}):
            d=self.update(apply=True); d['evidence']=invalid
            with self.assertRaises(ValueError): self.store.update(d)
        d=self.update(apply=True); d['changes']={'id':"'; DROP TABLE applications;--"}
        with self.assertRaises(ValueError): self.store.update(d)
        self.assertEqual(self.store.application('example')['current_stage'],'applied')

    def test_update_idempotency_history_backup_and_conflict(self):
        d=self.update(apply=True)
        self.store.update(d)
        self.assertTrue(self.store.update(d)['duplicate'])
        self.assertEqual(self.store.application('example')['current_stage'],'interview')
        with closing(sqlite3.connect(self.root/'job-tracker.db')) as c:
            self.assertEqual(c.execute('SELECT count(*) FROM stage_history').fetchone()[0],1)
        self.assertEqual(len(list((self.root/'agent-backups').glob('*.sqlite'))),1)
        d['changes']={'current_stage':'offer'}
        with self.assertRaises(ValueError): self.store.update(d)

    def test_stale_stage_refused(self):
        d=self.update(apply=True); d['expected_stage']='rejected'
        with self.assertRaises(ValueError): self.store.update(d)
        self.assertEqual(self.store.application('example')['current_stage'],'applied')

    def test_new_application_needs_receipt_and_deduplicates(self):
        d={'company':'Example Two','title':'Engineer','url':'https://example.org/jobs/2','evidence':self.update()['evidence'],'apply':True}
        result=self.store.record(d)
        self.assertEqual(self.store.record(d)['application_id'],result['application_id'])
        d['evidence']={**d['evidence'],'source_id':'different-message'}
        with self.assertRaises(ValueError): self.store.record(d)

    def run_start(self):
        self.runner=Runner(self.root)
        return self.runner.dispatch('start',{'agent':'codex','target':2})

    def queued(self, auth):
        return self.runner.dispatch('enqueue',{**auth,'url':'https://example.org/jobs/2?utm_source=x','company':'Fictional Co','title':'Developer','posting':'Example posting'})

    def test_queue_duplicate_and_single_owner(self):
        auth=self.run_start()
        try:
            job=self.queued(auth)
            self.assertEqual(self.queued(auth)['id'],job['id'])
            with self.assertRaises(ValueError): self.runner.dispatch('start',{'agent':'claude'})
            with self.assertRaises(ValueError): self.runner.dispatch('skip',{**auth,'owner':'wrong','job_id':job['id'],'reason':'no'})
        finally: self.runner.q.close()

    def test_uncertain_submission_cannot_retry_or_count(self):
        auth=self.run_start()
        try:
            job=self.queued(auth)
            pdf=self.root.parent/'Example Resume.pdf'; pdf.write_bytes(b'%PDF-example fixture')
            data={**auth,'job_id':job['id']}
            self.runner.dispatch('prepare',{**data,'resume_path':str(pdf),'resume_focus':'Developer roles'})
            self.runner.dispatch('begin-submit',data)
            self.runner.dispatch('pause',auth)
            auth=self.runner.dispatch('resume',{'run_id':auth['run_id'],'agent':'claude'})
            data={**auth,'job_id':job['id']}
            for action in ('begin-submit','skip','sync'):
                with self.assertRaises(ValueError): self.runner.dispatch(action,{**data,'reason':'try again'})
            with self.assertRaises(ValueError): self.runner.dispatch('reconcile',{**data,'verified_not_submitted':'false','evidence_text':'unknown'})
            self.assertEqual(self.runner.job(job['id'])['state'],'uncertain')
            self.runner.dispatch('confirm',{**data,'evidence_text':'Application received, reference EX-2','evidence_url':'https://example.org/receipt/2'})
            self.runner.dispatch('sync',data); self.runner.dispatch('sync',data)
            with closing(sqlite3.connect(self.root/'job-tracker.db')) as c:
                self.assertEqual(c.execute('SELECT count(*) FROM applications').fetchone()[0],2)
            self.assertNotIn(auth['owner'],(self.root/'agent-workflows/dashboard.html').read_text(encoding='utf-8'))
        finally: self.runner.q.close()

    def test_changed_snapshot_cannot_be_registered_as_submitted(self):
        auth=self.run_start()
        try:
            job=self.queued(auth)
            pdf=self.root.parent/'Example Resume.pdf'; pdf.write_bytes(b'original')
            data={**auth,'job_id':job['id']}
            prepared=self.runner.dispatch('prepare',{**data,'resume_path':str(pdf),'resume_focus':'Developer'})
            self.runner.dispatch('begin-submit',data)
            self.runner.dispatch('confirm',{**data,'evidence_text':'Application received','evidence_url':'https://example.org/receipt/2'})
            snapshot=Path(prepared['payload']['resume_snapshot'])
            snapshot.write_bytes(b'changed')
            with self.assertRaises(ValueError): self.runner.dispatch('sync',data)
            self.assertEqual(self.runner.job(job['id'])['state'],'confirmed')
            snapshot.write_bytes(b'original')
            self.runner.dispatch('sync',data)
        finally: self.runner.q.close()

    def test_reprepare_only_attaches_current_resume_companion_and_letter(self):
        auth=self.run_start()
        try:
            job=self.queued(auth); data={**auth,'job_id':job['id']}
            for name in ('v1.pdf','v1.docx','v2.pdf','v2.docx','letter.pdf'):
                (self.root.parent/name).write_bytes(name.encode())
            self.runner.dispatch('prepare',{**data,'resume_path':str(self.root.parent/'v1.pdf'),'resume_focus':'First variant','cover_letter_text':'First letter','cover_letter_path':str(self.root.parent/'letter.pdf')})
            prepared=self.runner.dispatch('prepare',{**data,'resume_path':str(self.root.parent/'v2.pdf'),'resume_focus':'Second variant'})
            folder=Path(prepared['payload']['folder'])
            self.assertTrue((folder/'v1.pdf').exists())  # Leftovers must never become submitted attachments.
            (folder/'unrelated.txt').write_text('Not part of the application', encoding='utf-8')
            self.runner.dispatch('begin-submit',data)
            self.runner.dispatch('confirm',{**data,'evidence_text':'Received','evidence_url':'https://example.org/receipt/2'})
            self.runner.dispatch('sync',data)
            with closing(sqlite3.connect(self.root/'job-tracker.db')) as c:
                names={r[0] for r in c.execute('SELECT file_name FROM attachments')}
                self.assertTrue({'v2.pdf','v2.docx','job.txt','answers.json','manifest.json','confirmation.json'} <= names)
                self.assertFalse({'v1.pdf','v1.docx','cover-letter.pdf','cover-letter.txt','unrelated.txt'} & names)
                self.assertEqual(c.execute('SELECT count(*) FROM cover_letters').fetchone()[0],0)
        finally: self.runner.q.close()

    def test_current_resume_companion_hash_is_checked_before_sync(self):
        auth=self.run_start()
        try:
            job=self.queued(auth); data={**auth,'job_id':job['id']}
            pdf=self.root.parent/'resume.pdf'; pdf.write_bytes(b'pdf')
            pdf.with_suffix('.docx').write_bytes(b'companion')
            prepared=self.runner.dispatch('prepare',{**data,'resume_path':str(pdf),'resume_focus':'Developer'})
            self.runner.dispatch('begin-submit',data)
            self.runner.dispatch('confirm',{**data,'evidence_text':'Received','evidence_url':'https://example.org/receipt/2'})
            (Path(prepared['payload']['folder'])/'resume.docx').write_bytes(b'changed')
            with self.assertRaises(ValueError): self.runner.dispatch('sync',data)
            self.assertEqual(self.runner.job(job['id'])['state'],'confirmed')
            with closing(sqlite3.connect(self.root/'job-tracker.db')) as c:
                self.assertEqual(c.execute('SELECT count(*) FROM attachments').fetchone()[0],0)
        finally: self.runner.q.close()

    def cli(self, action, data=None, raw=None):
        """Runs the CLI in process and returns (exit code, stdout JSON or None, stderr JSON or None)."""
        import aplyd
        source=self.root.parent/'request.json'
        if raw is not None: source.write_bytes(raw)
        else: source.write_text(json.dumps(data or {}), encoding='utf-8')
        out,err=io.StringIO(),io.StringIO()
        with patch.object(sys,'argv',['aplyd.py',action,'--data-dir',str(self.root),'--input',str(source)]), \
             patch.object(sys,'stdout',out), patch.object(sys,'stderr',err):
            code=aplyd.main()
        parse=lambda text: json.loads(text) if text.strip() else None
        return code,parse(out.getvalue()),parse(err.getvalue())

    def test_cli_errors_are_json_and_say_what_is_wrong(self):
        code,_,err=self.cli('application',{})
        self.assertEqual((code,err['error']),(1,'Missing required field: application_id'))
        code,out,_=self.cli('applications',raw=b'\xef\xbb\xbf{"limit": 5}')
        self.assertEqual((code,out[0]['id']),(0,'example'))
        auth=self.run_start(); self.runner.q.close()
        job=self.cli('enqueue',{**auth,'url':'https://example.org/jobs/7','company':'Fictional Co','title':'Developer','posting':'Example'})[1]
        code,_,err=self.cli('hold',{**auth,'job_id':job['id'],'reason':5})
        self.assertEqual((code,err['error']),(1,'reason must be a string'))
        code,_,err=self.cli('confirm',{**auth,'job_id':job['id'],'evidence_text':['Received'],'evidence_url':'https://example.org/r'})
        self.assertEqual(code,1); self.assertIn('evidence_text',err['error'])
        (self.root/'.aplyd-community.json').write_text('[]', encoding='utf-8')
        code,_,err=self.cli('doctor')
        self.assertEqual((code,err['error']),(1,'Not a supported Aplyd Community data directory'))

    def test_busy_database_reports_a_retry_and_changes_nothing(self):
        import local_store
        blocker=sqlite3.connect(self.root/'job-tracker.db'); blocker.execute('BEGIN EXCLUSIVE')
        try:
            with patch.object(local_store,'BUSY_TIMEOUT',0.1):
                code,_,err=self.cli('application-update',self.update(apply=True))
        finally: blocker.rollback(); blocker.close()
        self.assertEqual(code,1); self.assertIn('database is busy',err['error'])
        self.assertEqual(self.store.application('example')['current_stage'],'applied')

    @unittest.skipIf(os.name=='nt' or (hasattr(os,'geteuid') and os.geteuid()==0),'needs POSIX permissions as a normal user')
    def test_unwritable_backup_folder_refuses_the_write(self):
        folder=self.root/'agent-backups'; folder.mkdir(); folder.chmod(0o500)
        try: code,_,err=self.cli('application-update',self.update(apply=True))
        finally: folder.chmod(0o700)
        self.assertEqual(code,1); self.assertIn('Could not save a backup',err['error'])
        self.assertEqual(self.store.application('example')['current_stage'],'applied')

    def test_snapshot_tampering_blocks_submission(self):
        auth=self.run_start()
        try:
            job=self.queued(auth)
            pdf=self.root.parent/'Example Resume.pdf'; pdf.write_bytes(b'fixture')
            data={**auth,'job_id':job['id']}
            result=self.runner.dispatch('prepare',{**data,'resume_path':str(pdf),'resume_focus':'Developer'})
            Path(result['payload']['resume_snapshot']).write_bytes(b'changed')
            with self.assertRaises(ValueError): self.runner.dispatch('begin-submit',data)
        finally: self.runner.q.close()

if __name__=='__main__': unittest.main()
