#!/usr/bin/env python3
"""Install/update portable Aplyd skills without changing agent auth or user data."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import sys
import tempfile
import time
import uuid

MANIFEST='.aplyd-install.json'
LOCK='.aplyd-install.lock'
STAGE_PREFIX='.aplyd-stage-'
ROLLBACK_PREFIX='.aplyd-rollback-'
TOOL_FILES=('aplyd.py','local_store.py','runner.py')
# A lock older than this is from an installer that is no longer running (the app stops it after 45 seconds).
STALE_LOCK_SECONDS=600


def digest(content): return hashlib.sha256(content).hexdigest()


def targets(home,target):
    known={'codex':home/'.agents/skills','claude':home/'.claude/skills'}
    if target=='auto':
        selected=[key for key in known if (home/('.codex' if key=='codex' else '.claude')).exists() or known[key].parent.exists() or shutil.which(key)]
        if not selected: raise ValueError('No agent installation detected; choose --target codex, claude or both')
    else: selected=list(known) if target=='both' else [target]
    return [known[key] for key in selected]


def safe_relative(value):
    path=PurePosixPath(value)
    if path.is_absolute() or '..' in path.parts or '\\' in value or not value or ':' in value:
        raise ValueError('Unsafe installed manifest path')
    return path


def load_bundle(source):
    version=(source/'skills/VERSION').read_text(encoding='utf-8').strip()
    result={}
    for directory in sorted((source/'skills').iterdir()):
        if not directory.is_dir() or not (directory/'SKILL.md').is_file(): continue
        files={}
        for file in directory.rglob('*'):
            if file.is_symlink(): raise ValueError('Source skill contains symlink: '+str(file))
            if file.is_file(): files[file.relative_to(directory).as_posix()]=file.read_bytes()
        for name in TOOL_FILES: files['scripts/'+name]=(source/'tools'/name).read_bytes()
        manifest={'format':1,'version':version,'files':{name:digest(content) for name,content in files.items()}}
        files[MANIFEST]=(json.dumps(manifest,indent=2)+'\n').encode()
        result[directory.name]=files
    if not result: raise ValueError('No skills found in release source')
    return version,result


def read_manifest(dest):
    """The install record of a managed skill folder, or a ValueError that says how to recover."""
    manifest_path=dest/MANIFEST
    if not manifest_path.is_file() or manifest_path.is_symlink():
        raise ValueError(str(dest)+' was not installed by this installer (it has no '+MANIFEST+'), so it was left alone. '
                         'Move or rename that folder, then install again.')
    try:
        manifest=json.loads(manifest_path.read_text(encoding='utf-8'))
    except (ValueError,UnicodeDecodeError):
        manifest=None
    if not isinstance(manifest,dict) or manifest.get('format')!=1 or not isinstance(manifest.get('files'),dict):
        raise ValueError('The install record '+str(manifest_path)+' is unreadable, so nothing was changed. '
                         'Move the folder '+str(dest)+' out of the skills folder, then install again.')
    return manifest


def changed_files(dest,manifest):
    """Managed files that were edited or deleted since installation."""
    changed=[]
    for name,sha in manifest['files'].items():
        path=dest/str(safe_relative(str(name)))
        if not path.is_file() or path.is_symlink() or digest(path.read_bytes())!=sha: changed.append(path)
    return changed


def modified_error(dest,path):
    return ValueError('Your copy of '+str(path)+' differs from the installed version (edited or deleted), so nothing was changed. '
                      'To update: move the folder '+str(dest)+' out of the skills folder (this keeps your edits), '
                      'install again, then copy back any edits you still want.')


def check_destination(dest,files,update):
    if dest.is_symlink(): raise ValueError('Refusing symlink destination: '+str(dest))
    if not dest.exists(): return None
    if dest.is_file(): raise ValueError(str(dest)+' is a file, not a skill folder. Move or rename it, then install again.')
    if not update:
        raise ValueError('Aplyd skills are already installed at '+str(dest)+'. To refresh them, tick "Update an existing managed '
                         'installation" in Settings, or run the installer again with --update.')
    manifest=read_manifest(dest)
    changed=changed_files(dest,manifest)
    if changed: raise modified_error(dest,changed[0])
    for path in dest.rglob('*'):
        if path.is_symlink(): raise ValueError('Installation contains a symlink: '+str(path))
    for name in files:
        if name==MANIFEST: continue
        path=dest/name
        if path.exists() and name not in manifest['files']:
            raise ValueError('The new release would overwrite '+str(path)+', a file you added. Move or rename it, then update again.')
    return manifest


def prepare_base(base):
    try:
        base.mkdir(parents=True,exist_ok=True)
    except OSError as error:
        raise OSError('Cannot create the skills folder '+str(base)+' ('+(error.strerror or str(error))+'). '
                      'Check that it is a folder you can write to.') from None
    if not base.is_dir():
        raise ValueError(str(base)+' is not a folder. Move or rename it, then install again.')


def pid_running(pid):
    if os.name=='nt': return True  # Windows has no harmless liveness probe here; age decides instead.
    try: os.kill(pid,0)
    except ProcessLookupError: return False
    except OSError: return True
    return True


def acquire_lock(base):
    lock=base/LOCK
    for _ in range(3):
        try:
            fd=os.open(lock,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
        except FileExistsError:
            try: age=time.time()-lock.stat().st_mtime
            except FileNotFoundError: continue
            try: pid=json.loads(lock.read_text(encoding='utf-8')).get('pid')
            except (OSError,ValueError,AttributeError): pid=None
            # A lock without a readable pid is either being written right now or left by an older release.
            stale=age>=STALE_LOCK_SECONDS or (isinstance(pid,int) and not pid_running(pid)) or (pid is None and age>=60)
            if not stale:
                raise ValueError('Another skill installation is running ('+str(lock)+'). Wait for it to finish and try again.')
            lock.unlink(missing_ok=True)
            continue
        with os.fdopen(fd,'w',encoding='utf-8') as handle: json.dump({'pid':os.getpid()},handle)
        return lock
    raise ValueError('Could not take the installer lock '+str(lock)+'. Try again.')


def recover(base):
    """Finish or undo an installation that was killed part way. Runs only while holding the lock."""
    for path in sorted(base.glob(STAGE_PREFIX+'*')):
        # Staging folders are never live; a killed run leaves them behind.
        if path.is_dir() and not path.is_symlink(): shutil.rmtree(path)
    for backup in sorted(base.glob(ROLLBACK_PREFIX+'*')):
        match=re.fullmatch(re.escape(ROLLBACK_PREFIX)+r'(.+)-[0-9a-f]{32}',backup.name)
        if not match or backup.is_symlink() or not backup.is_dir():
            raise ValueError('An earlier installation stopped part way and left '+str(backup)+'. It holds the previous copy of a skill: '
                             'move it back to its skill folder name (for example aplyd-email-pass) if that folder is missing, or delete it, then try again.')
        dest=base/match[1]
        if not dest.exists() and not dest.is_symlink():
            os.replace(backup,dest)  # The new copy never landed: restore the previous one.
            continue
        try: complete=not changed_files(dest,read_manifest(dest))
        except ValueError: complete=False
        if not complete:
            raise ValueError('An earlier installation stopped part way: '+str(dest)+' is incomplete and the previous copy is in '+str(backup)+'. '
                             'Delete '+str(dest)+', rename '+str(backup)+' to '+dest.name+', then try again.')
        shutil.rmtree(backup)  # The new copy landed in full; only the cleanup was missed.


def install(source,home,target='auto',dry_run=False,update=False):
    source=Path(source).resolve(); home=Path(home).expanduser().resolve()
    version,bundles=load_bundle(source)
    plan=[]
    for base in targets(home,target):
        for name,files in bundles.items():
            dest=base/name
            old=check_destination(dest,files,update)
            plan.append({'destination':str(dest),'action':'update' if old else 'install','version':version,'files':len(files)})
    if dry_run: return {'dry_run':True,'plan':plan}
    # Per-target locks prevent two installers from overwriting each other's validated plan.
    locks=[]; staged=[]; changed=[]
    try:
        for base in targets(home,target):
            prepare_base(base)
            locks.append(acquire_lock(base))
            recover(base)
        for entry in plan:
            dest=Path(entry['destination']); files=bundles[dest.name]
            old=check_destination(dest,files,update)
            entry['action']='update' if old else 'install'
            stage=Path(tempfile.mkdtemp(prefix=STAGE_PREFIX,dir=dest.parent))
            staged.append(stage)
            if old:
                shutil.copytree(dest,stage,dirs_exist_ok=True)
                for name in old['files']:
                    if name not in files: (stage/str(safe_relative(name))).unlink()
            for name,content in files.items():
                path=stage/name; path.parent.mkdir(parents=True,exist_ok=True); path.write_bytes(content)
            for name,content in files.items():
                if digest((stage/name).read_bytes())!=digest(content): raise OSError('Staged file verification failed')
        for entry,stage in zip(plan,staged):
            dest=Path(entry['destination'])
            # The skill name in the backup lets a later run restore it if this process is killed.
            backup=dest.with_name(ROLLBACK_PREFIX+dest.name+'-'+uuid.uuid4().hex) if dest.exists() else None
            if backup: os.replace(dest,backup)
            changed.append((dest,backup))
            os.replace(stage,dest)
    except Exception:
        for dest,backup in reversed(changed):
            if dest.exists(): shutil.rmtree(dest)
            if backup and backup.exists(): os.replace(backup,dest)
        raise
    finally:
        for stage in staged:
            if stage.exists(): shutil.rmtree(stage)
        for lock in locks: lock.unlink(missing_ok=True)
    for dest,backup in changed:
        if backup: shutil.rmtree(backup)
    return {'dry_run':False,'plan':plan,'next':'Restart or refresh skill discovery in your agent. Local profile/data were not changed.'}


def uninstall(source,home,target='auto',dry_run=False):
    """Remove installed Aplyd skills. Only unmodified managed files go; anything else stays and is reported."""
    source=Path(source).resolve(); home=Path(home).expanduser().resolve()
    _,bundles=load_bundle(source)
    plan=[]
    for base in targets(home,target):
        for name in bundles:
            dest=base/name
            if dest.is_symlink(): raise ValueError('Refusing symlink destination: '+str(dest))
            if not dest.exists(): continue
            manifest=read_manifest(dest)
            changed=changed_files(dest,manifest)
            if changed:
                raise ValueError('Your copy of '+str(changed[0])+' differs from the installed version, so nothing was removed. '
                                 'Move that file out of '+str(dest)+' (or delete the folder yourself), then try again.')
            kept=sorted(p.relative_to(dest).as_posix() for p in dest.rglob('*') if (p.is_file() or p.is_symlink()) and p.relative_to(dest).as_posix() not in manifest['files'] and p.name!=MANIFEST)
            plan.append({'destination':str(dest),'action':'uninstall','version':str(manifest.get('version','')),'files':len(manifest['files']),'kept':kept})
    if dry_run: return {'dry_run':True,'plan':plan}
    locks=[]
    try:
        for base in {Path(entry['destination']).parent for entry in plan}:
            locks.append(acquire_lock(base)); recover(base)
        for entry in plan:
            dest=Path(entry['destination'])
            manifest=read_manifest(dest)
            if changed_files(dest,manifest): raise modified_error(dest,changed_files(dest,manifest)[0])
            for name in manifest['files']: (dest/str(safe_relative(str(name)))).unlink()
            (dest/MANIFEST).unlink()
            # Remove folders left empty, deepest first; folders holding your own files stay.
            for folder in sorted((p for p in dest.rglob('*') if p.is_dir() and not p.is_symlink()),key=lambda p:len(p.parts),reverse=True):
                if not any(folder.iterdir()): folder.rmdir()
            if not any(dest.iterdir()): dest.rmdir()
    finally:
        for lock in locks: lock.unlink(missing_ok=True)
    return {'dry_run':False,'plan':plan,'next':'Restart or refresh skill discovery in your agent. Local profile/data were not changed.'}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--target',choices=['auto','codex','claude','both'],default='auto')
    parser.add_argument('--dry-run',action='store_true')
    parser.add_argument('--update',action='store_true',help='Update only unmodified files managed by an earlier installation')
    parser.add_argument('--uninstall',action='store_true',help='Remove installed Aplyd skills; edited or added files are never deleted')
    parser.add_argument('--home',type=Path,default=Path.home(),help='Agent home directory (default: current user home)')
    args=parser.parse_args()
    if args.uninstall and args.update: parser.error('--uninstall cannot be combined with --update')
    try:
        source=Path(__file__).resolve().parents[1]
        if args.uninstall: result=uninstall(source,args.home,args.target,args.dry_run)
        else: result=install(source,args.home,args.target,args.dry_run,args.update)
        print(json.dumps(result,indent=2)); return 0
    except (ValueError,OSError) as error:
        print(json.dumps({'error':str(error)}),file=sys.stderr); return 1

if __name__=='__main__': raise SystemExit(main())
