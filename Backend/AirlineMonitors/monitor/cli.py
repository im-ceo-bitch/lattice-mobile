"""Daily per-airline visible-price monitor. Queries ONLY existing Flight Hub flights."""
import argparse
import json
import logging
import os
import sys
import time
from datetime import datetime,timezone
from pathlib import Path
import requests
from playwright.sync_api import sync_playwright
from .browser import search_one,save_diagnostic,SiteChanged,AccessBlocked

ROOT=Path(__file__).resolve().parent.parent
logging.basicConfig(level=logging.INFO,format='%(asctime)s %(levelname)s %(message)s')
LOG=logging.getLogger('iumrah-airline-monitor')

def endpoint():
 value=os.getenv('FLIGHT_HUB_URL','').strip().rstrip('/')
 if not value.startswith('https://'):raise ValueError('FLIGHT_HUB_URL requires HTTPS; new Flight Hub must be deployed')
 return value

def api_token():
 token=os.getenv('FLIGHT_HUB_BOT_TOKEN','').strip()
 if not token:raise ValueError('FLIGHT_HUB_BOT_TOKEN not configured')
 return token

def load_tasks(provider,limit):
 url=f'{endpoint()}/v1/monitor/tasks'
 r=requests.get(url,params={'provider':provider,'limit':limit},headers={'Authorization':f'Bearer {api_token()}'},timeout=30)
 r.raise_for_status()
 return r.json()['tasks']

def publish(provider,records,status,message):
 r=requests.post(f'{endpoint()}/v1/ingest/{provider}',headers={'Authorization':f'Bearer {api_token()}'},
  json={'records':records,'status':status,'message':message},timeout=35)
 r.raise_for_status()
 payload=r.json()
 if payload.get('rejected'):raise ValueError('Flight Hub rejected some records: '+str(payload.get('errors')))
 return payload

def main():
 p=argparse.ArgumentParser()
 p.add_argument('--provider',choices=['centrum','uzbekistan','flynas'],required=True)
 p.add_argument('--limit',type=int,default=14)
 p.add_argument('--output',default=str(ROOT/'output'))
 p.add_argument('--headful',action='store_true')
 a=p.parse_args()
 settings=json.loads((ROOT/'config'/f'{a.provider}.json').read_text())
 tasks=load_tasks(a.provider,max(1,min(a.limit,35)))
 output=Path(a.output)/a.provider;output.mkdir(parents=True,exist_ok=True)
 LOG.info('%s: %s existing flights scheduled for check',a.provider,len(tasks))
 offers=[];failures=[];blocked=False
 if tasks:
  with sync_playwright() as p:
   browser=p.chromium.launch(headless=not a.headful)
   context=browser.new_context(locale=settings['locale'],timezone_id='Asia/Tashkent',viewport={'width':1440,'height':900})
   page=context.new_page()
   for idx,task in enumerate(tasks):
    try:
     found=search_one(page,settings,task,output/'diagnostics')
     offers.extend(found);LOG.info('%s %s %s -> %d offer(s)',task['origin'],task['destination'],task['departure_date'],len(found))
    except AccessBlocked as e:
     failures.append({'flight':task,'error':str(e)});save_diagnostic(page,output/'diagnostics',task,e);blocked=True;break
    except Exception as e:
     failures.append({'flight':task,'error':str(e)});save_diagnostic(page,output/'diagnostics',task,e)
     if isinstance(e,SiteChanged) and idx==0:break
    if idx<len(tasks)-1:time.sleep(max(8,settings.get('min_pause_seconds',12)))
   context.close();browser.close()
 status='no_tasks' if not tasks else 'blocked' if blocked else 'ok' if offers else 'site_changed'
 report={'provider':a.provider,'checked_at':datetime.now(timezone.utc).isoformat(),'status':status,'tasks':len(tasks),'offers':offers,'failures':failures}
 (output/'latest.json').write_text(json.dumps(report,indent=2,ensure_ascii=False),encoding='utf-8')
 result=publish(a.provider,offers,status,f'{len(tasks)} tasks; {len(failures)} failed; {len(offers)} exact offers')
 LOG.info('Hub response: %s',result)
 return 0 if status in ('ok','no_tasks') else 2

if __name__=='__main__':sys.exit(main())
