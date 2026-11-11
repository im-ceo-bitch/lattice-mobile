"""Published-flight-only official-site monitor. --limit is a page size, NOT a catalog cap.
Existing 08:00/20:00 Asia/Tashkent workflow remains unchanged.
"""
import argparse
import json
import logging
import os
import sys
import time
import uuid
from datetime import datetime, timezone
from collections import Counter
from pathlib import Path
import requests
from playwright.sync_api import sync_playwright
from .browser import search_one,save_diagnostic,SiteChanged,AccessBlocked,NoFareAvailable

ROOT=Path(__file__).resolve().parent.parent
logging.basicConfig(level=logging.INFO,format='%(asctime)s %(levelname)s %(message)s')
LOG=logging.getLogger('iumrah-airline-monitor')

def endpoint():
 value=os.getenv('FLIGHT_HUB_URL','').strip().rstrip('/')
 if not value.startswith('https://'):raise ValueError('FLIGHT_HUB_URL requires HTTPS')
 return value

def api_token():
 token=os.getenv('FLIGHT_HUB_BOT_TOKEN','').strip()
 if not token:raise ValueError('FLIGHT_HUB_BOT_TOKEN not configured')
 return token

def load_tasks(provider,limit,since):
 r=requests.get(f'{endpoint()}/v1/monitor/tasks',params={'provider':provider,'limit':limit,'since':since},
  headers={'Authorization':f'Bearer {api_token()}'},timeout=30)
 r.raise_for_status()
 return r.json()['tasks']

def publish(provider,records,attempts,status,message,run_id):
 r=requests.post(f'{endpoint()}/v1/ingest/{provider}',headers={'Authorization':f'Bearer {api_token()}'},
  json={'records':records,'attempts':attempts,'status':status,'message':message,'run_id':run_id},timeout=40)
 r.raise_for_status()
 payload=r.json()
 if payload.get('rejected'):raise ValueError('Flight Hub rejected records: '+str(payload.get('errors')))
 return payload

def task_key(task):
 return '|'.join(str(task[v]).upper() for v in ('airline_code','flight_number','origin','destination','departure_date'))

def run_monitor():
 p=argparse.ArgumentParser()
 p.add_argument('--provider',choices=['centrum','uzbekistan','flynas'],required=True)
 p.add_argument('--limit',type=int,default=20,help='page size, not maximum run size')
 p.add_argument('--max-tasks',type=int,default=140,help='safety cap per run')
 p.add_argument('--output',default=str(ROOT/'output'))
 p.add_argument('--headful',action='store_true')
 a=p.parse_args()
 settings=json.loads((ROOT/'config'/f'{a.provider}.json').read_text())
 started=datetime.now(timezone.utc).isoformat()
 run_id=uuid.uuid4().hex
 page_size=max(1,min(a.limit,35))
 output=Path(a.output)/a.provider
 output.mkdir(parents=True,exist_ok=True)
 LOG.info('%s: checking entire catalog in pages of %d; run=%s',a.provider,page_size,run_id)
 # Announce the run before any Playwright/network interaction with the airline.
 # A browser crash then becomes a visible 'started/stalled' run in D1, rather
 # than looking identical to a GitHub schedule that never executed.
 publish(a.provider,[],[],'started','Monitor browser startup; run='+run_id,run_id)
 offers=[];attempts=[];failures=[];blocked=False;calibration_required=False;processed=0
 consecutive_stage=None;consecutive_count=0
 # Actions has a 45-minute job limit; allow room for installing deps and publishing.
 deadline=time.monotonic()+30*60
 with sync_playwright() as p:
  browser=p.chromium.launch(headless=not a.headful)
  context=browser.new_context(locale=settings['locale'],timezone_id='Asia/Tashkent',viewport={'width':1440,'height':900})
  page=context.new_page()
  while processed<max(1,a.max_tasks) and time.monotonic()<deadline:
   tasks=load_tasks(a.provider,min(page_size,a.max_tasks-processed),started)
   if not tasks:break
   LOG.info('Page: %d pending published flights',len(tasks))
   for task in tasks:
    key=task_key(task)
    try:
     found=search_one(page,settings,task,output/'diagnostics')
     offers.extend(found)
     consecutive_stage=None;consecutive_count=0
     attempts.append({'flight_key':key,'outcome':'verified','message':f'{len(found)} exact site fares'})
     LOG.info('Verified %s: %d exact offer(s)',key,len(found))
    except NoFareAvailable as e:
     consecutive_stage=None;consecutive_count=0
     attempts.append({'flight_key':key,'outcome':'no_fares','message':str(e)[:150]})
     LOG.info('No visible fare at official site for %s',key)
    except AccessBlocked as e:
     attempts.append({'flight_key':key,'outcome':'blocked','message':str(e)[:150]})
     failures.append({'flight':task,'error':str(e)});save_diagnostic(page,output/'diagnostics',task,e)
     blocked=True
    except Exception as e:
     outcome='site_changed' if isinstance(e,SiteChanged) else 'failed'
     attempts.append({'flight_key':key,'outcome':outcome,'message':str(e)[:150]})
     failures.append({'flight':task,'error':str(e)});save_diagnostic(page,output/'diagnostics',task,e)
     if isinstance(e,SiteChanged):
      stage=str(e).split(':',1)[0]
      consecutive_count=consecutive_count+1 if stage==consecutive_stage else 1
      consecutive_stage=stage
      if consecutive_count>=3:
       calibration_required=True
       LOG.error('Circuit breaker: %d consecutive browser failures at %s; stop this provider run', consecutive_count,stage)
    processed+=1
    if blocked or calibration_required or time.monotonic()>=deadline:break
    if processed<a.max_tasks:time.sleep(max(8,settings.get('min_pause_seconds',12)))
   if blocked or calibration_required:break
  context.close();browser.close()
 status=('no_tasks' if processed==0 else 'blocked' if blocked else 'partial' if failures and offers else
  'site_changed' if failures else 'ok' if offers else 'no_verified_fares')
 reason_counts=Counter(str(item['error']).split(':',1)[0] for item in failures)
 first_problem=next((str(item['error']) for item in failures), '')
 report={'provider':a.provider,'checked_at':datetime.now(timezone.utc).isoformat(),'run_id':run_id,
  'status':status,'tasks':processed,'offers':offers,'attempts':attempts,'failures':failures,
  'failure_stages':dict(reason_counts),'first_problem':first_problem[:250],
  'calibration_required':calibration_required}
 (output/'latest.json').write_text(json.dumps(report,indent=2,ensure_ascii=False),encoding='utf-8')
 # Each API ingestion accepts <=100 fares. All attempted tasks receive diagnostic records.
 if not offers and not attempts:
  result=publish(a.provider,[],[],status,'No published tasks',run_id)
 else:
  result={}
  # Put the first real browser failure into D1, not just the uploaded artifact.
  # Business can then distinguish airport/date/calendar/results/matching errors.
  summary=(f'{processed} checked; {len(failures)} failed; {len(offers)} exact fares; '
           f'{"STOPPED_EARLY; " if calibration_required else ""}first={first_problem[:115]}' if failures else
           f'{processed} checked; {len(offers)} exact fares; no failures')
  for i in range(0,max(len(offers),len(attempts)),100):
   result=publish(a.provider,offers[i:i+100],attempts[i:i+100],status,summary,run_id)
 LOG.info('Hub: %s; total visited=%s',result,processed)
 return 0 if status in ('ok','no_tasks','partial','no_verified_fares') else 2

def main():
 try:
  return run_monitor()
 except Exception as error:
  # Never silently lose a scheduled run when Playwright, task paging or
  # publishing fails. Fail the Action, keep a local artifact, attempt a D1
  # diagnostic (best-effort, because network/auth may be the actual blocker).
  LOG.exception('AIRLINE_MONITOR_FATAL')
  name='unknown'
  if '--provider' in sys.argv:
   i=sys.argv.index('--provider')
   if i+1<len(sys.argv): name=sys.argv[i+1]
  report={'provider':name,'status':'failed','at':datetime.now(timezone.utc).isoformat(),
   'reason':type(error).__name__,'detail':str(error)[:400]}
  try:
   folder=ROOT/'output'/name
   folder.mkdir(parents=True,exist_ok=True)
   (folder/'fatal.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
  except Exception: LOG.exception('FATAL_ARTIFACT_WRITE_FAILED')
  if name in ('centrum','uzbekistan','flynas'):
   try:
    publish(name,[],[],'failed',f"{report['reason']}: {report['detail']}",uuid.uuid4().hex)
   except Exception: LOG.exception('FATAL_REPORT_DELIVERY_FAILED: inspect GitHub Actions logs')
  return 2

if __name__=='__main__':sys.exit(main())
