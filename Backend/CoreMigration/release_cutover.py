#!/usr/bin/env python3
"""V21 RC: one guarded D1/R2 migration command; explicitly gated optional production activation.
Requires confirmed old/new bindings, a frozen write window and protected local disk.
Optional activation requires explicit --activate and dedicated smoke credentials.
Never prints SQL, object keys, tokens or provider exception details.
"""
import argparse, hashlib, json, os, re, subprocess, sys, tempfile
from pathlib import Path
from final_cutover import load, selection, object_refs, columns, rows, sha, verify_bucket, verify_objects
from collections import Counter

ROOT=Path(__file__).resolve().parents[1]
UUID=re.compile(r'^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$')
NAME=re.compile(r'^[a-z0-9][a-z0-9-]{0,62}$')
META=('ContentType','CacheControl','ContentDisposition','ContentEncoding','ContentLanguage','Expires','Metadata')

def credentials(side):
    account=os.environ.get(side+'_CLOUDFLARE_ACCOUNT_ID','');token=os.environ.get(side+'_CLOUDFLARE_API_TOKEN','')
    if not re.fullmatch(r'[0-9a-fA-F]{32}',account) or not token:raise ValueError('MISSING_'+side+'_CLOUDFLARE_CREDENTIALS')
    return account,token

def command(args,creds=None):
    env=os.environ.copy()
    if creds:env.update(CLOUDFLARE_ACCOUNT_ID=creds[0],CLOUDFLARE_API_TOKEN=creds[1])
    return subprocess.run(args,env=env,check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=1800).stdout

def cf_settings(creds,worker):
    import urllib.request
    if not NAME.fullmatch(worker):raise ValueError('INVALID_WORKER_NAME')
    req=urllib.request.Request(f'https://api.cloudflare.com/client/v4/accounts/{creds[0]}/workers/scripts/{worker}/settings',headers={'Authorization':'Bearer '+creds[1]})
    with urllib.request.urlopen(req,timeout=30) as response:data=json.load(response)
    if not data.get('success') or not isinstance(data.get('result',{}).get('bindings'),list):raise ValueError('WORKER_BINDINGS_UNVERIFIED')
    return data['result']['bindings']

def binding_value(bindings,name,kind,field,pattern):
    items=[x for x in bindings if x.get('name')==name and x.get('type')==kind]
    if len(items)!=1 or not pattern.fullmatch(str(items[0].get(field,''))):raise ValueError('BINDING_NOT_CONFIRMED:'+name)
    return items[0][field]

def make_config(path,account,dbid):
    path.write_text(json.dumps({'name':'iumrah-cutover-local-config','account_id':account,'compatibility_date':'2026-11-10','d1_databases':[{'binding':'DB','database_name':'cutover-explicit-db','database_id':dbid}]}))
    path.chmod(0o600)

def export_db(config,output,creds):
    command(['wrangler','d1','export','DB','--remote','--skip-confirmation','--config',str(config),'--output',str(output)],creds)
    if not output.is_file() or not output.stat().st_size:raise ValueError('EXPORT_MISSING')
    output.chmod(0o600)

def apply_db(config,sql,creds):
    command(['wrangler','d1','execute','DB','--remote','--yes','--config',str(config),'--file',str(sql)],creds)

def s3(side,account):
    import boto3
    from botocore.config import Config
    key=os.environ.get(side+'_R2_ACCESS_KEY_ID','');secret=os.environ.get(side+'_R2_SECRET_ACCESS_KEY','')
    if not key or not secret:raise ValueError('MISSING_'+side+'_R2_S3_CREDENTIALS')
    return boto3.client('s3',endpoint_url=f'https://{account}.r2.cloudflarestorage.com',region_name='auto',aws_access_key_id=key,aws_secret_access_key=secret,config=Config(signature_version='s3v4',request_checksum_calculation='when_required',response_checksum_validation='when_required'))

def read_object(client,bucket,key,path):
    response=client.get_object(Bucket=bucket,Key=key)
    try:
        with path.open('wb') as f:
            for chunk in response['Body'].iter_chunks(chunk_size=1024*1024):f.write(chunk)
    finally:response['Body'].close()
    return {k:response[k] for k in META if k in response}

def missing_object(error):
    return str(getattr(error,'response',{}).get('Error',{}).get('Code','')) in ('NoSuchKey','404','NotFound')

def migrate_object(src,dst,old_bucket,new_bucket,key,directory,copy):
    a,b=directory/'source-object',directory/'target-object'
    try:
        metadata=read_object(src,old_bucket,key,a)
        try:target_meta=read_object(dst,new_bucket,key,b)
        except Exception as error:
            if not missing_object(error):raise
            if not copy:raise ValueError('R2_OBJECT_MISSING') from None
            # Conditional write is atomic. A conflicting destination is never overwritten.
            with a.open('rb') as f:
                dst.put_object(Bucket=new_bucket,Key=key,Body=f,IfNoneMatch='*',**metadata)
            target_meta=read_object(dst,new_bucket,key,b)
        if sha(a)!=sha(b) or metadata!=target_meta:raise ValueError('R2_OBJECT_CONTENT_OR_METADATA_CONFLICT')
    finally:a.unlink(missing_ok=True);b.unlink(missing_ok=True)

def unchanged_source(first,second,binding):
    a,b=load(first),load(second)
    try:
        names=selection(a,binding)
        if names!=selection(b,binding):return False
        for table in names:
            ca,cb=columns(a,table),columns(b,table)
            if ca!=cb:return False
            fields=[x[1] for x in ca]
            if Counter(rows(a,table,fields))!=Counter(rows(b,table,fields)):return False
        # Check sequence watermark even if rows are identical.
        def sequences(db):
            if not db.execute("SELECT 1 FROM sqlite_master WHERE name='sqlite_sequence'").fetchone():return {}
            return {n:seq for n,seq in db.execute('SELECT name,seq FROM sqlite_sequence') if n in names}
        return sequences(a)==sequences(b)
    finally:a.close();b.close()

def live_status(path):
    import urllib.request
    with urllib.request.urlopen('https://iumrah-backend.helloiumrah.workers.dev'+path,timeout=30) as res:return json.load(res)

def pending_target():
    services=live_status('/api/services/health');cut=live_status('/__iumrah/cutover')
    if services.get('release')!='v21-rc' or cut.get('service')!='iumrah-backend' or not cut.get('schemaReady') or cut.get('coreCutoverEnabled') is not False:raise ValueError('DEPLOY_RC_WITH_CORE_WRITES_BLOCKED_FIRST')
    return cut

def arguments():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--old-operations-worker',required=True);p.add_argument('--old-bookings-worker',required=True)
    p.add_argument('--old-operations-binding',default='HOTELS_DB');p.add_argument('--old-bookings-binding',default='DB')
    p.add_argument('--old-media-binding',default='HOTELS_MEDIA');p.add_argument('--old-passports-binding',default='PASSPORTS')
    p.add_argument('--private-dir',required=True,type=Path,help='New directory outside repository on encrypted/protected disk; retains backups.')
    p.add_argument('--mode',choices=['plan','apply'],default='plan')
    p.add_argument('--old-and-new-writes-frozen',action='store_true');p.add_argument('--reviewed-source-and-exclusions',action='store_true')
    p.add_argument('--activate',action='store_true',help='Explicitly activate only after verified migration, provider preflight and dedicated smoke credentials. Keeps old writers frozen.')
    p.add_argument('--copy-missing-r2',action='store_true',help='Requires boto3>=1.36 and separate R2 S3 credentials, conditional create only.')
    return p.parse_args()

def main(a):
    if a.mode=='apply' and not (a.old_and_new_writes_frozen and a.reviewed_source_and_exclusions):raise ValueError('FREEZE_AND_REVIEW_REQUIRED')
    if (a.copy_missing_r2 or a.activate) and a.mode!='apply':raise ValueError('COPY_OR_ACTIVATION_REQUIRES_APPLY')
    if a.activate:
        for k in ('SMOKE_TEST_IDENTIFIER','SMOKE_TEST_PASSWORD','SMOKE_EXPECTED_IUMRAH_ID','SMOKE_BOOKING_ID','SMOKE_BOOKING_TOKEN','SMOKE_STAFF_LOGIN','SMOKE_STAFF_PASSWORD'):
            if not os.environ.get(k):raise ValueError('MISSING_'+k)
        if os.environ.get('SMOKE_DEDICATED_TEST_ACCOUNT')!='1':raise ValueError('DEDICATED_TEST_ACCOUNT_REQUIRED')
    work=a.private_dir.resolve()
    if ROOT.parent in (work,*work.parents):raise ValueError('PRIVATE_DIR_MUST_BE_OUTSIDE_REPOSITORY')
    old,new=credentials('OLD'),credentials('NEW')
    # Verify that the authenticated target account owns the public production origin.
    import urllib.request
    req=urllib.request.Request(f'https://api.cloudflare.com/client/v4/accounts/{new[0]}/workers/subdomain',headers={'Authorization':'Bearer '+new[1]})
    with urllib.request.urlopen(req,timeout=30) as res:sub=json.load(res)
    if not sub.get('success') or sub.get('result',{}).get('subdomain')!='helloiumrah':raise ValueError('TARGET_ACCOUNT_DOES_NOT_OWN_PRODUCTION_ORIGIN')
    if a.mode=='apply':pending_target()
    oldops=cf_settings(old,a.old_operations_worker);oldbook=cf_settings(old,a.old_bookings_worker);target=cf_settings(new,'iumrah-backend')
    sources=[binding_value(oldops,a.old_operations_binding,'d1','id',UUID),binding_value(oldbook,a.old_bookings_binding,'d1','id',UUID)]
    targets=[binding_value(target,'HOTELS_DB','d1','id',UUID),binding_value(target,'BOOKINGS_DB','d1','id',UUID)]
    if len(set(sources))!=2 or len(set(targets))!=2 or (old[0]==new[0] and set(sources)&set(targets)):raise ValueError('DISTINCT_SOURCE_AND_TARGET_DATABASES_REQUIRED')
    buckets=[(binding_value(oldops,a.old_media_binding,'r2_bucket','bucket_name',NAME),binding_value(target,'HOTELS_MEDIA','r2_bucket','bucket_name',NAME)),(binding_value(oldbook,a.old_passports_binding,'r2_bucket','bucket_name',NAME),binding_value(target,'PASSPORTS','r2_bucket','bucket_name',NAME))]
    for source,destination in buckets:verify_bucket(source,*old);verify_bucket(destination,*new)
    work.mkdir(mode=0o700,parents=False,exist_ok=False)
    paths=[work/f'{n}.sql' for n in ['old-operations','old-bookings','new-hotels','new-bookings']];configs=[work/f'db-{n}.json' for n in range(4)]
    for conf,dbid,creds,output in zip(configs,sources+targets,[old,old,new,new],paths):
        make_config(conf,creds[0],dbid);export_db(conf,output,creds)
    def reconcile(mode,files=paths,extra=()):
        args=[sys.executable,str(Path(__file__).with_name('final_cutover.py'))]
        for flag,file in zip(['legacy-operations','legacy-bookings','target-hotels','target-bookings'],files):args+=['--'+flag,str(file)]
        return json.loads(command(args+['--mode',mode,*extra]))
    plan=reconcile('plan');print(json.dumps({'mode':'plan','pending_statements':plan['pending_statements'],'tables':plan['tables']},ensure_ascii=False,indent=2),flush=True)
    if a.mode=='plan':return
    output=work/'additions';reconcile('prepare',extra=['--old-writes-frozen','--output-dir',str(output)])
    # Copy only referenced source R2 keys, including metadata. Verify before importing rows.
    if a.copy_missing_r2:
        src,dst=s3('OLD',old[0]),s3('NEW',new[0]);counts={}
        for ix,binding in enumerate(['HOTELS_DB','BOOKINGS_DB']):
            db=load(paths[ix]);keys=object_refs(db,binding,selection(db,binding));db.close()
            for key in sorted(keys):migrate_object(src,dst,*buckets[ix],key,work,True)
            counts[binding]=len(keys)
        print('R2 source objects copied or already identical:',json.dumps(counts),flush=True)
    else:
        # Verify source objects already exist in destination before adding references.
        for ix,binding in enumerate(['HOTELS_DB','BOOKINGS_DB']):
            db=load(paths[ix]);keys=object_refs(db,binding,selection(db,binding));db.close()
            verify_objects(keys,keys,*buckets[ix],old,new)
    pending_target()
    for ix,binding in enumerate(['HOTELS_DB','BOOKINGS_DB']):
        sql=output/(binding+'.sql')
        if sql.exists():apply_db(configs[ix+2],sql,new)
    after=[work/f'{n}-after.sql' for n in ['old-operations','old-bookings','new-hotels','new-bookings']]
    for conf,creds,file in zip(configs,[old,old,new,new],after):export_db(conf,file,creds)
    if not all(unchanged_source(paths[ix],after[ix],binding) for ix,binding in enumerate(['HOTELS_DB','BOOKINGS_DB'])):raise ValueError('SOURCE_SNAPSHOT_CHANGED')
    report=reconcile('verify',after,['--old-writes-frozen','--old-media-bucket',buckets[0][0],'--new-media-bucket',buckets[0][1],'--old-passports-bucket',buckets[1][0],'--new-passports-bucket',buckets[1][1]])
    # Do not enable writes automatically. The report remains a separate operator gate.
    reportfile=work/'verified-report.json';reportfile.write_text(json.dumps(report,indent=2));reportfile.chmod(0o600)
    print(json.dumps({'mode':'verified','r2':report['r2'],'operator_attestation':report['operator_attestation'],'activation_performed':False},indent=2),flush=True)
    if a.activate:
        cut=pending_target()
        if not cut.get('providerConfigurationReady') or set(cut.get('missing',[]))-{'IUMRAH_CORE_CUTOVER_READY','IUMRAH_CORE_PARITY_ATTESTATION'}:raise ValueError('REQUIRED_PROVIDER_OR_CORE_CONFIGURATION_MISSING')
        current=cf_settings(new,'iumrah-backend')
        if [binding_value(current,k,'d1','id',UUID) for k in ('HOTELS_DB','BOOKINGS_DB')]!=targets or [binding_value(current,k,'r2_bucket','bucket_name',NAME) for k in ('HOTELS_MEDIA','PASSPORTS')]!=[p[1] for p in buckets]:raise ValueError('TARGET_BINDINGS_CHANGED')
        # Verify real public provider paths before enabling private Core.
        smoke=str(ROOT/'IumrahBackend/scripts/release-smoke.mjs')
        command(['node',smoke,'--public-only'])
        # Explicit operator opt-in only. A bulk secret update preserves other secrets.
        config=work/'activation-config.json';config.write_text(json.dumps({'name':'iumrah-backend','account_id':new[0],'compatibility_date':'2026-11-10'}));config.chmod(0o600)
        with tempfile.TemporaryDirectory(dir=work) as tmp:
            secrets=Path(tmp)/'activation.json';secrets.write_text(json.dumps({'IUMRAH_CORE_PARITY_ATTESTATION':report['operator_attestation'],'IUMRAH_CORE_CUTOVER_READY':'1'}));secrets.chmod(0o600)
            command(['wrangler','secret','bulk',str(secrets),'--name','iumrah-backend','--config',str(config)],new)
        print('CORE_ACTIVATION_REQUEST_COMPLETED: do not resume old writes; checking live test account.',flush=True)
        try:
            import time
            for _ in range(15):
                if live_status('/__iumrah/cutover').get('coreCutoverEnabled') is True:break
                time.sleep(2)
            else:raise ValueError('CORE_ACTIVATION_NOT_VISIBLE')
            result=json.loads(command(['node',smoke]));(work/'smoke-report.json').write_text(json.dumps(result,indent=2))
            print(json.dumps({'mode':'activated','smoke':result,'app_store_release_ready':False},indent=2))
        except Exception:raise ValueError('CORE_ACTIVATED_SMOKE_BLOCKED_KEEP_OLD_WRITES_FROZEN') from None

if __name__=='__main__':
    os.umask(0o077)
    try:main(arguments())
    except Exception as error:
        print(str(error) if isinstance(error,ValueError) and re.fullmatch(r'[A-Z0-9_:]+',str(error)) else 'CUTOVER_BLOCKED:'+type(error).__name__,file=sys.stderr);sys.exit(1)
