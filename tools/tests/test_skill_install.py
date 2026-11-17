import importlib.util
from contextlib import closing
import sqlite3
import json
import os
from pathlib import Path
import tempfile
import subprocess
import sys
import unittest
from unittest.mock import patch

path=Path(__file__).resolve().parents[2]/'scripts/install-skills.py'
spec=importlib.util.spec_from_file_location('skill_installer',path)
installer=importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class InstallerTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.root=Path(self.tmp.name)
        self.source=self.root/'source'; self.home=self.root/'home'
        (self.source/'skills/aplyd-example').mkdir(parents=True)
        (self.source/'skills/aplyd-example/SKILL.md').write_text('Example version one', encoding='utf-8')
        (self.source/'skills/VERSION').write_text('0.1.0', encoding='utf-8')
        (self.source/'tools').mkdir()
        for name in installer.TOOL_FILES: (self.source/'tools'/name).write_text('# fixture', encoding='utf-8')

    def tearDown(self): self.tmp.cleanup()

    def install(self,**kw): return installer.install(self.source,self.home,'both',**kw)

    def test_dry_run_makes_no_directories(self):
        result=self.install(dry_run=True)
        self.assertEqual(len(result['plan']),2)
        self.assertFalse(self.home.exists())

    def test_installs_bundled_tools_and_hashes_both_runtimes(self):
        self.install()
        for base in ('.agents','.claude'):
            dest=self.home/base/'skills/aplyd-example'
            self.assertTrue((dest/'scripts/aplyd.py').exists())
            manifest=json.loads((dest/installer.MANIFEST).read_text(encoding='utf-8'))
            self.assertEqual(manifest['version'],'0.1.0')
            self.assertEqual(manifest['files']['SKILL.md'],installer.digest(b'Example version one'))

    def test_existing_unmanaged_directory_refused_without_partial_install(self):
        d=self.home/'.claude/skills/aplyd-example'; d.mkdir(parents=True)
        (d/'SKILL.md').write_text('User skill', encoding='utf-8')
        with self.assertRaises(ValueError): self.install()
        self.assertFalse((self.home/'.agents/skills/aplyd-example').exists())
        self.assertEqual((d/'SKILL.md').read_text(encoding='utf-8'),'User skill')

    def test_update_preserves_extras_refuses_modified_managed(self):
        self.install()
        dest=self.home/'.agents/skills/aplyd-example'
        (dest/'my-notes.txt').write_text('Local customization', encoding='utf-8')
        (self.source/'skills/aplyd-example/SKILL.md').write_text('Example version two', encoding='utf-8')
        self.install(update=True)
        self.assertEqual((dest/'SKILL.md').read_text(encoding='utf-8'),'Example version two')
        self.assertEqual((dest/'my-notes.txt').read_text(encoding='utf-8'),'Local customization')
        (dest/'SKILL.md').write_text('My edits', encoding='utf-8')
        with self.assertRaises(ValueError): self.install(update=True)
        self.assertEqual((dest/'SKILL.md').read_text(encoding='utf-8'),'My edits')

    def test_failed_second_replacement_rolls_back_first(self):
        self.install()
        (self.source/'skills/aplyd-example/SKILL.md').write_text('Second version', encoding='utf-8')
        original=installer.os.replace
        count=[0]
        def fail_once(src,dst):
            if Path(dst).name=='aplyd-example' and '.claude' in str(dst) and '.aplyd-stage-' in str(src):
                count[0]+=1
                if count[0]==1: raise OSError('Simulated disk failure')
            return original(src,dst)
        with patch.object(installer.os,'replace',side_effect=fail_once):
            with self.assertRaises(OSError): self.install(update=True)
        for base in ('.agents','.claude'):
            self.assertEqual((self.home/base/'skills/aplyd-example/SKILL.md').read_text(encoding='utf-8'),'Example version one')

    def test_real_installed_helper_runs_without_checkout_or_dependencies(self):
        from test_local_tools import fixture
        source=Path(__file__).resolve().parents[2]
        self.home=self.root/'hôme'
        installer.install(source,self.home,'both')
        data=self.root/'community-data'; fixture(data)
        with closing(sqlite3.connect(data/'job-tracker.db')) as c:
            c.execute("UPDATE app_settings SET value=? WHERE key='profile'",(json.dumps({'Full name':'Example Candidate – Zoë'}),))
            c.execute("UPDATE applications SET company=? WHERE id='example'",('Société Example',))
            c.commit()
        script=self.home/'.claude/skills/aplyd-daily-applications/scripts/aplyd.py'
        result=subprocess.run([sys.executable,str(script),'doctor','--data-dir',str(data)],cwd=self.root,capture_output=True,text=True,encoding="utf-8",check=True,env={**os.environ,"PYTHONIOENCODING":"cp1252","PYTHONUTF8":"0"})
        self.assertTrue(json.loads(result.stdout)['ok'])
        result=subprocess.run([sys.executable,str(script),'context','--data-dir',str(data)],cwd=self.root,capture_output=True,text=True,encoding="utf-8",check=True,env={**os.environ,"PYTHONIOENCODING":"cp1252","PYTHONUTF8":"0"})
        self.assertEqual(json.loads(json.loads(result.stdout)['settings']['profile'])['Full name'],'Example Candidate – Zoë')
        result=subprocess.run([sys.executable,str(script),'applications','--data-dir',str(data)],cwd=self.root,capture_output=True,text=True,encoding='utf-8',check=True,env={**os.environ,'PYTHONIOENCODING':'cp1252','PYTHONUTF8':'0'})
        self.assertEqual(json.loads(result.stdout)[0]['company'],'Société Example')
        result=subprocess.run([sys.executable,str(source/'scripts/install-skills.py'),'--target','both','--home',str(self.home),'--update','--dry-run'],cwd=self.root,capture_output=True,text=True,encoding='utf-8',check=True,env={**os.environ,'PYTHONIOENCODING':'cp1252','PYTHONUTF8':'0'})
        self.assertIn('hôme',json.loads(result.stdout)['plan'][0]['destination'])
        result.stdout.encode('ascii')  # Installer JSON safely escapes non-ASCII paths.


    def test_reinstall_and_conflict_messages_say_how_to_resolve(self):
        self.install()
        with self.assertRaisesRegex(ValueError,'--update'): self.install()
        dest=self.home/'.claude/skills/aplyd-example'
        (dest/'SKILL.md').write_text('My edits', encoding='utf-8')
        with self.assertRaisesRegex(ValueError,'move the folder .*install again'): self.install(update=True)
        self.assertEqual((dest/'SKILL.md').read_text(encoding='utf-8'),'My edits')
        (self.home/'.agents/skills/aplyd-example'/installer.MANIFEST).write_text('{broken', encoding='utf-8')
        with self.assertRaisesRegex(ValueError,'unreadable'): installer.install(self.source,self.home,'codex',update=True)

    def test_skills_path_that_is_a_file_gets_a_clear_error(self):
        (self.home/'.claude').mkdir(parents=True); (self.home/'.claude/skills').write_text('', encoding='utf-8')
        with self.assertRaisesRegex(OSError,'Cannot create the skills folder'): installer.install(self.source,self.home,'claude')

    def killed_install(self):
        """The state a run leaves when killed between moving the old copy aside and moving the new one in."""
        installer.install(self.source,self.home,'claude')
        base=self.home/'.claude/skills'
        os.replace(base/'aplyd-example',base/(installer.ROLLBACK_PREFIX+'aplyd-example-'+'0'*32))
        (base/(installer.STAGE_PREFIX+'leftover')).mkdir()
        return base

    def test_killed_install_is_recovered_once_its_lock_is_stale(self):
        base=self.killed_install()
        lock=base/installer.LOCK
        lock.write_text(json.dumps({'pid':os.getpid()}), encoding='utf-8')
        with self.assertRaisesRegex(ValueError,'Another skill installation is running'): installer.install(self.source,self.home,'claude',update=True)
        old=lock.stat().st_mtime-installer.STALE_LOCK_SECONDS-5; os.utime(lock,(old,old))
        (self.source/'skills/aplyd-example/SKILL.md').write_text('Example version two', encoding='utf-8')
        installer.install(self.source,self.home,'claude',update=True)
        self.assertEqual((base/'aplyd-example/SKILL.md').read_text(encoding='utf-8'),'Example version two')
        self.assertEqual(sorted(p.name for p in base.iterdir()),['aplyd-example'])

    @unittest.skipIf(os.name=='nt','pid probing is POSIX only')
    def test_lock_from_a_dead_process_is_stale(self):
        base=self.killed_install()
        done=subprocess.run([sys.executable,'-c','import os; print(os.getpid())'],capture_output=True,text=True,check=True)
        (base/installer.LOCK).write_text(json.dumps({'pid':int(done.stdout)}), encoding='utf-8')
        installer.install(self.source,self.home,'claude',update=True)
        self.assertEqual((base/'aplyd-example/SKILL.md').read_text(encoding='utf-8'),'Example version one')
        self.assertEqual(sorted(p.name for p in base.iterdir()),['aplyd-example'])

    def test_uninstall_removes_only_unmodified_managed_files(self):
        self.install()
        codex=self.home/'.agents/skills/aplyd-example'; claude=self.home/'.claude/skills/aplyd-example'
        (codex/'my-notes.txt').write_text('Mine', encoding='utf-8')
        preview=installer.uninstall(self.source,self.home,'both',dry_run=True)
        self.assertEqual([row['action'] for row in preview['plan']],['uninstall','uninstall'])
        self.assertTrue((claude/'SKILL.md').exists())
        installer.uninstall(self.source,self.home,'both')
        self.assertFalse(claude.exists())
        self.assertEqual(sorted(p.name for p in codex.iterdir()),['my-notes.txt'])
        # The folder now holds only the user's file, so a fresh install leaves it alone.
        with self.assertRaisesRegex(ValueError,'not installed by this installer'): self.install(update=True)

    def test_uninstall_refuses_edited_files(self):
        self.install()
        dest=self.home/'.claude/skills/aplyd-example'
        (dest/'SKILL.md').write_text('My edits', encoding='utf-8')
        with self.assertRaisesRegex(ValueError,'nothing was removed'): installer.uninstall(self.source,self.home,'both')
        self.assertEqual((dest/'SKILL.md').read_text(encoding='utf-8'),'My edits')
        self.assertTrue((self.home/'.agents/skills/aplyd-example/SKILL.md').exists())

    def test_shipped_skills_match_the_cli(self):
        import re
        source=Path(__file__).resolve().parents[2]
        help_text=subprocess.run([sys.executable,str(source/'tools/aplyd.py'),'-h'],capture_output=True,text=True,check=True).stdout
        actions=set(re.search(r'\{([a-z,-]+)\}',help_text)[1].split(','))
        skills=sorted(p for p in (source/'skills').iterdir() if (p/'SKILL.md').is_file())
        self.assertEqual(len(skills),3)
        interfaces={(p/'references/interface.md').read_bytes() for p in skills}
        self.assertEqual(len(interfaces),1,'the three references/interface.md files must stay identical')
        documented=set()
        for row in interfaces.pop().decode('utf-8').splitlines():
            if row.startswith('| `'): documented|=set(re.findall(r'`([a-z-]+)`',row.split('|')[1]))
        self.assertEqual(documented,actions)
        for skill in skills:
            text=(skill/'SKILL.md').read_text(encoding='utf-8')
            front=re.match(r'---\n(.*?)\n---\n',text,re.S)
            self.assertIsNotNone(front,skill.name)
            fields=dict(line.split(': ',1) for line in front[1].splitlines())
            self.assertEqual(fields['name'],skill.name)
            self.assertTrue(0<len(fields['description'])<=1024)
            for command in set(re.findall(r'`([a-z]+(?:-[a-z]+)*)`',text))&{'doctor','context','status','applications','application'}:
                self.assertIn(command,actions)

    def test_symlink_destination_refused(self):
        other=self.root/'other'; other.mkdir()
        d=self.home/'.agents/skills'; d.mkdir(parents=True)
        try: (d/'aplyd-example').symlink_to(other,target_is_directory=True)
        except OSError: self.skipTest('symlinks unavailable')
        with self.assertRaises(ValueError): self.install()

if __name__=='__main__': unittest.main()
