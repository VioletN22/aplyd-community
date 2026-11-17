#!/usr/bin/env python3
"""Aplyd Community local agent interface (Python 3.10+, no dependencies)."""
import argparse
import json
import os
from pathlib import Path
import sqlite3
import sys
from local_store import Store, is_busy
from runner import Runner

# Fields read as text. A number or list here is a caller mistake, refused before anything runs.
TEXT_FIELDS=('application_id','run_id','owner','job_id','agent','url','company','title','posting','location','source',
             'reason','evidence_text','evidence_url','reference','evidence_path','resume_path','resume_focus','resume_label',
             'cover_letter_text','cover_letter_path','duplicate_check','query','expected_stage','stage')
QUEUE_ACTIONS=['context','status','job','report','start','resume','pause','finish','enqueue','adopt','register-resume','prepare','begin-submit','confirm','sync','hold','skip','reconcile']

def read_input(source):
    # Windows editors often save JSON with a byte order mark.
    raw=sys.stdin.read() if source=='-' else Path(source).read_text(encoding='utf-8-sig') if source else '{}'
    d=json.loads(raw.lstrip('\ufeff') or '{}')
    if not isinstance(d,dict): raise ValueError('Input must be a JSON object')
    for key in TEXT_FIELDS:
        if key in d and not isinstance(d[key],str): raise ValueError(key+' must be a string')
    if 'tags' in d and (not isinstance(d['tags'],list) or not all(isinstance(t,str) for t in d['tags'])):
        raise ValueError('tags must be a list of strings')
    return d


def main():
    # JSON pipes have one encoding on every OS, regardless of the Windows locale.
    for stream in (sys.stdin,sys.stdout,sys.stderr):
        if hasattr(stream,'reconfigure'): stream.reconfigure(encoding='utf-8')
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=['doctor','applications','application','application-update','application-record','email-events']+QUEUE_ACTIONS)
    parser.add_argument('--data-dir',required=True,help='Absolute Aplyd Community data directory (Settings > Local data > Copy data directory)')
    parser.add_argument('--input',help='JSON file, or - for stdin; no secret arguments')
    args=parser.parse_args()
    os.umask(0o077)
    runner=None
    try:
        d=read_input(args.input)
        store=Store(args.data_dir)
        if args.action=='doctor':
            result={'ok':True,'data_dir':str(store.root),'database':str(store.path),'mail_access':'Use the app Email > Sync now or your separately connected agent mail tool','python':sys.version.split()[0]}
        elif args.action=='applications': result=store.list_applications(d)
        elif args.action=='application': result=store.application(d['application_id'])
        elif args.action=='application-update': result=store.update(d)
        elif args.action=='application-record': result=store.record(d)
        elif args.action=='email-events': result=store.email_events(d)
        else:
            runner=Runner(args.data_dir)
            result=runner.dispatch(args.action,d)
        print(json.dumps(result,ensure_ascii=False,indent=2))
    except KeyError as error:
        print(json.dumps({'error':'Missing required field: '+str(error.args[0])},ensure_ascii=False),file=sys.stderr)
        return 1
    except (ValueError,TypeError,OSError,sqlite3.Error) as error:
        message=str(error)
        if is_busy(error):
            message=('The Aplyd database is busy (the app or another agent is saving). This step did not complete; '
                     'wait a moment and run the same command again.')
        print(json.dumps({'error':message},ensure_ascii=False),file=sys.stderr)
        return 1
    finally:
        if runner: runner.q.close()
    return 0

if __name__=='__main__': raise SystemExit(main())
