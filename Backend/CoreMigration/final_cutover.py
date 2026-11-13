#!/usr/bin/env python3
"""V21 offline D1 reconciliation and read-only R2 verification. Private exports only.
No remote SQL writes, no R2 writes, no secrets or customer rows in logs.
"""
import argparse
import hashlib
import json
import os
import re
import sqlite3
import subprocess
import sys
import tempfile
import urllib.request
import urllib.error
from pathlib import Path
from collections import Counter
from prepare_cutover import load, tables, columns, rows, prepare
from split_core_dump import q

BASE = Path(__file__).resolve().parents[1]
POLICY = json.loads((BASE/'CloudflareMigration/policy.json').read_text())['databases']
SCHEMA = json.loads((BASE/'IumrahBackend/schema/bootstrap-v21.json').read_text())
# Earlier cross-account imports intentionally excluded the hotel catalog. Never
# replace the new hotel catalog or import derived prices as operational data.
SKIP_OPS = set(POLICY['iumrah-hotels']['exclude']) | {
    'd1_migrations','flight_calendar_fares','flight_search_cache','flight_search_locks',
    'flight_verification_cache','catalog_maintenance_tasks',
}
SKIP_WEB = {'d1_migrations','storefront_package_cache','storefront_package_snapshots','storefront_flight_refresh_progress'}
ANCHORS = {'HOTELS_DB':{'pilgrims','pilgrim_trips','iumrah_accounts','iumrah_account_sessions','iumrah_client_devices','iumrah_client_session_bindings',
                            'iumrah_friends_gifts','iumrah_friends_redemptions','iumrah_friends_credit_ledger',
                            'booking_travelers','booking_payment_receipts','booking_travel_documents',
                            'business_chat_threads','business_chat_messages','business_chat_attachments'},
           'BOOKINGS_DB':{'bookings','booking_events','booking_documents'}}
ALLOWED = {'HOTELS_DB':{'aerodatabox_daily_usage','aerodatabox_provider_cooldown'}|set(POLICY['iumrah-hotels']['allow'])|{x['name'] for x in SCHEMA['HOTELS_DB']['tables']},
           'BOOKINGS_DB':set(POLICY['iumrah-web-db']['allow'])|{x['name'] for x in SCHEMA['BOOKINGS_DB']['tables']}}
SKIPS={'HOTELS_DB':SKIP_OPS,'BOOKINGS_DB':SKIP_WEB}
# Bucket choice is determined by the actual consuming server code, not a filename guess.
# The operational bucket contains passport/receipt/attachment files used by HotelsWorker.
MEDIA_FIELDS={'HOTELS_DB':{'business_chat_attachments': ['object_key'], 'team_members':['photo_object_key'],
    'booking_travelers':['passport_object_key'], 'booking_payment_instructions':['payme_qr_object_key'],
    'booking_payment_receipts':['object_key'], 'booking_travel_documents':['object_key'],
    'iumrah_security_submissions':['passport_object_key'], 'payment_templates':['payme_qr_object_key'],
    'ziyarat_images':['object_key']}, 'BOOKINGS_DB':{'booking_documents':['r2_key']}}

def selection(src,binding):
    names=set(tables(src))
    missing=ANCHORS[binding]-names
    if missing: raise ValueError('SOURCE_ANCHORS_MISSING:'+binding+':'+','.join(sorted(missing)))
    unknown=names-ALLOWED[binding]-SKIPS[binding]
    if unknown: raise ValueError('SOURCE_TABLES_REQUIRE_REVIEW:'+binding+':'+','.join(sorted(unknown)))
    return sorted((names & ALLOWED[binding])-SKIPS[binding])

def existing_rows(db):
    return {name:([c[1] for c in columns(db,name)],Counter(rows(db,name,[c[1] for c in columns(db,name)]))) for name in tables(db)}

def reconcile(source,target,binding,selected=None):
    selected=selection(source,binding) if selected is None else selected
    before=existing_rows(target)
    statements,report=prepare(source,target,selected)
    # A pre-existing trigger must not silently rewrite or delete destination-only rows.
    for name,(cols,data) in before.items():
        if data-Counter(rows(target,name,cols)):
            raise ValueError('EXISTING_TARGET_ROW_CHANGED:'+name)
    return statements,{'tables':report,'excluded':sorted(set(tables(source))-set(selected)),
        'absent_optional_source_tables':sorted(ALLOWED[binding]-SKIPS[binding]-set(tables(source)))}

def object_refs(db,binding,selected=None):
    available=set(tables(db)); found=set()
    for name in sorted(available if selected is None else available & set(selected)):
        cols={c[1] for c in columns(db,name)}
        candidates={c for c in cols if c=='object_key' or c.endswith('_object_key') or c=='r2_key' or c.endswith('_r2_key')}
        expected=set(MEDIA_FIELDS[binding].get(name,[]))
        if candidates-expected:
            # Catalog objects are not part of this operational migration.
            if name in SKIPS[binding]: continue
            raise ValueError('UNMAPPED_R2_FIELDS:'+name+':'+','.join(sorted(candidates-expected)))
        for field in expected & cols:
            for (key,) in db.execute(f'SELECT {q(field)} FROM {q(name)} WHERE {q(field)} IS NOT NULL AND {q(field)} != \'\''):
                if not isinstance(key,str) or not key.strip() or key.startswith('/') or '..' in key.split('/') or '\x00' in key:
                    raise ValueError('INVALID_OBJECT_KEY:'+name)
                found.add(key)
    return found

def sha(path):
    with open(path,'rb') as f: return hashlib.file_digest(f,'sha256').hexdigest()

def get_r2(bucket,key,output,account,token):
    env={**os.environ,'CLOUDFLARE_ACCOUNT_ID':account,'CLOUDFLARE_API_TOKEN':token}
    # No shell, no object names or provider stderr in output.
    subprocess.run(['wrangler','r2','object','get',f'{bucket}/{key}','--remote','--file',str(output)],
        env=env,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=300)

def verify_bucket(bucket,account,token):
    req=urllib.request.Request(f'https://api.cloudflare.com/client/v4/accounts/{account}/r2/buckets/{bucket}',headers={'Authorization':'Bearer '+token})
    try:
        with urllib.request.urlopen(req,timeout=30) as response: data=json.load(response)
        if not data.get('success') or data.get('result',{}).get('name')!=bucket:raise ValueError('R2_BUCKET_NOT_CONFIRMED')
    except (OSError,ValueError):raise ValueError('R2_BUCKET_NOT_CONFIRMED') from None

def verify_objects(old_keys,new_keys,old_bucket,new_bucket,old_creds,new_creds,fetch=get_r2,check_bucket=verify_bucket):
    if not old_keys <= new_keys: raise ValueError('TARGET_R2_REFERENCES_MISSING')
    for bucket in (old_bucket,new_bucket):
        if not re.fullmatch(r'[a-z0-9][a-z0-9-]{1,62}',bucket or ''): raise ValueError('EXPLICIT_R2_BUCKET_REQUIRED')
    check_bucket(old_bucket,*old_creds);check_bucket(new_bucket,*new_creds)
    with tempfile.TemporaryDirectory() as tmp:
        a,b=Path(tmp)/'source',Path(tmp)/'target'
        for i,key in enumerate(sorted(new_keys),1):
            try:
                fetch(new_bucket,key,b,*new_creds)
                if key in old_keys:
                    fetch(old_bucket,key,a,*old_creds)
                    if sha(a)!=sha(b): raise ValueError('R2_BYTE_MISMATCH')
            except (OSError,subprocess.SubprocessError,ValueError) as e:
                raise ValueError(f'R2_VERIFICATION_FAILED:object_{i}') from None
            finally:
                a.unlink(missing_ok=True);b.unlink(missing_ok=True)
    return {'source_objects_byte_verified':len(old_keys),'target_only_objects_read':len(new_keys-old_keys)}

def write_private(path,content):
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w',encoding='utf8') as f:f.write(content)

def main():
    p=argparse.ArgumentParser(description=__doc__)
    for flag in ('legacy-operations','legacy-bookings','target-hotels','target-bookings'):
        p.add_argument('--'+flag,required=True,type=Path)
    p.add_argument('--mode',choices=['plan','prepare','verify-d1','verify'],required=True)
    p.add_argument('--output-dir',type=Path)
    p.add_argument('--old-writes-frozen',action='store_true',help='Operator confirms old API and scheduled writers are frozen before final exports.')
    for flag in ('old-media-bucket','new-media-bucket','old-passports-bucket','new-passports-bucket'):
        p.add_argument('--'+flag)
    args=p.parse_args()
    if args.mode in ('prepare','verify') and not args.old_writes_frozen: raise ValueError('FREEZE_OLD_WRITES_REQUIRED')
    if args.mode=='prepare' and not args.output_dir: raise ValueError('PRIVATE_OUTPUT_DIR_REQUIRED')
    if args.mode!='prepare' and args.output_dir: raise ValueError('OUTPUT_DIR_ONLY_FOR_PREPARE')
    pairs={'HOTELS_DB':(args.legacy_operations,args.target_hotels),'BOOKINGS_DB':(args.legacy_bookings,args.target_bookings)}
    if len({x.resolve() for pair in pairs.values() for x in pair})!=4:raise ValueError('FOUR_DISTINCT_EXPORT_FILES_REQUIRED')
    reports={}; pending={}; refs={}; hashes={}
    for binding,(source_path,target_path) in pairs.items():
        source,target=load(source_path),load(target_path)
        try:
            selected=selection(source,binding)
            unknown_target=set(tables(target))-ALLOWED['HOTELS_DB']-ALLOWED['BOOKINGS_DB']-SKIP_OPS-SKIP_WEB
            if unknown_target:raise ValueError('TARGET_TABLES_REQUIRE_REVIEW:'+binding+':'+','.join(sorted(unknown_target)))
            old_refs=object_refs(source,binding,selected)
            new_refs=object_refs(target,binding,ALLOWED[binding]-SKIPS[binding])
            statements,report=reconcile(source,target,binding)
            # Previous versions could have copied operations into iumrah-core.
            # Treat every such existing row as additional source data, never discard it.
            other_binding='BOOKINGS_DB' if binding=='HOTELS_DB' else 'HOTELS_DB'
            misplaced_db=load(pairs[other_binding][1])
            try:
                misplaced=sorted((set(tables(misplaced_db))&ALLOWED[binding])-SKIPS[binding]-ALLOWED[other_binding])
                if misplaced:
                    additional,misplaced_report=reconcile(misplaced_db,target,binding,misplaced)
                    statements.extend(additional);report['misplaced_source_tables']=misplaced_report['tables']
                    report['misplaced_tables_left_intact']=misplaced
                else:report['misplaced_source_tables']={}
            finally:misplaced_db.close()
            pending[binding]=statements;reports[binding]=report;refs[binding]=(old_refs,new_refs)
            hashes[binding]=[sha(source_path),sha(target_path)]
        finally:source.close();target.close()
    result={'mode':args.mode,'tables':reports,'pending_statements':{k:len(v) for k,v in pending.items()},'remote_changes':False}
    if args.mode in ('verify-d1','verify') and any(pending.values()):raise ValueError('D1_PARITY_PENDING:'+json.dumps(result['pending_statements']))
    if args.mode=='prepare':
        args.output_dir.mkdir(mode=0o700,parents=False,exist_ok=False)
        for binding,statements in pending.items():
            if statements:write_private(args.output_dir/(binding+'.sql'),'-- PRIVATE: NEVER COMMIT\nPRAGMA defer_foreign_keys=TRUE;\n'+'\n'.join(statements)+'\n')
    if args.mode=='verify':
        old=tuple(os.getenv('OLD_CLOUDFLARE_'+x,'') for x in ('ACCOUNT_ID','API_TOKEN'))
        new=tuple(os.getenv('NEW_CLOUDFLARE_'+x,'') for x in ('ACCOUNT_ID','API_TOKEN'))
        if not all((*old,*new)) or not all(re.fullmatch(r'[a-fA-F0-9]{32}',x[0]) for x in (old,new)):raise ValueError('EXPLICIT_CLOUDFLARE_CREDENTIALS_REQUIRED')
        if not all((args.old_media_bucket,args.new_media_bucket,args.old_passports_bucket,args.new_passports_bucket)):raise ValueError('FOUR_EXPLICIT_BUCKET_NAMES_REQUIRED')
        buckets={'HOTELS_DB':(args.old_media_bucket,args.new_media_bucket),'BOOKINGS_DB':(args.old_passports_bucket,args.new_passports_bucket)}
        result['r2']={binding:verify_objects(*refs[binding],*buckets[binding],old,new) for binding in pairs}
        # This is an operator attestation ID, not an automatic proof of dump provenance.
        # It binds the exact local exports and named buckets to the completed read-only check.
        evidence={'hashes':hashes,'buckets':buckets,'accounts':[old[0],new[0]],'r2':result['r2'],'version':21}
        result['operator_attestation']='v21:'+hashlib.sha256(json.dumps(evidence,sort_keys=True).encode()).hexdigest()
        result['note']='Verify export provenance and absent optional source tables; activate manually only after review. No API smoke tests were run.'
    print(json.dumps(result,ensure_ascii=False,indent=2))

if __name__=='__main__':
    try:main()
    except (ValueError,sqlite3.Error,OSError,subprocess.SubprocessError) as e:
        # Never echo SQLite errors (could contain customer data), paths, or tokens.
        print(str(e) if isinstance(e,ValueError) else 'CUTOVER_VERIFICATION_BLOCKED:'+type(e).__name__,file=sys.stderr);sys.exit(1)
