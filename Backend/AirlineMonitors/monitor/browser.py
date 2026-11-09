"""Conservative browser adapter, no CAPTCHA bypass, no privileged endpoints.
Selectors require live airline-by-airline verification. Missing UI => failure report.
"""
from pathlib import Path
import re
from datetime import date
from .extract import parse_offer_card,AIRPORTS

class SiteChanged(RuntimeError): pass
class AccessBlocked(RuntimeError): pass
class NoFareAvailable(RuntimeError): pass
BLOCK_TERMS=('captcha','verify you are human','robot verification','access denied','too many requests','подтвердите, что вы не робот','проверка безопасности')

def first_visible(page,candidates,timeout=1500):
 for selector in candidates:
  try:
   loc=page.locator(selector).first
   if loc.is_visible(timeout=timeout): return loc
  except Exception: pass
 raise SiteChanged('Visible control not found: '+str(candidates))

def assert_not_blocked(page):
 text=page.locator('body').inner_text(timeout=7000).lower()
 if any(v in text for v in BLOCK_TERMS):raise AccessBlocked('The airline displayed a verification/limit screen; no bypass attempted')

def select_airport(page,candidates,iata):
 control=first_visible(page,candidates)
 tag=(control.evaluate('(el)=>el.tagName') or '').lower()
 if tag=='select':
  options=control.locator('option')
  for k in range(options.count()):
   opt=options.nth(k)
   name=(opt.inner_text()+' '+(opt.get_attribute('value') or '')).casefold()
   if iata.casefold() in name or any(city.casefold() in name for city in AIRPORTS.get(iata,())):
    control.select_option(index=k);return
  raise SiteChanged(f'No matching select option {iata}')
 control.click()
 if tag=='button':
  field=first_visible(page,['input:focus','[role="dialog"] input','input[placeholder*="Origin"]','input[placeholder*="Destination"]',
    'input[placeholder*="From"]','input[placeholder*="To"]','input[placeholder*="Откуда"]','input[placeholder*="Куда"]',
    '[role="dialog"] input','input:focus'])
 else:field=control
 for query in [iata,*AIRPORTS.get(iata,())[:1]]:
  try: field.fill(query)
  except Exception as exc: raise SiteChanged(f'Cannot type airport {iata}') from exc
  page.wait_for_timeout(700)
  terms=[iata,*AIRPORTS.get(iata,())[:1]]
  selectors=[f'[role="option"]:has-text("{term}")' for term in terms]+[f'li:has-text("{term}")' for term in terms]+[
   f'[class*="Option"]:has-text("{term}")' for term in terms]
  try:
   first_visible(page,selectors,timeout=500).click();return
  except SiteChanged: pass
 raise SiteChanged(f'Airport selector did not expose option for {iata}')

def select_departure_date(page,candidates,target):
 field=first_visible(page,candidates)
 fmt=target.isoformat()
 typ=field.get_attribute('type') or ''
 if typ=='date':
  field.fill(fmt);field.press('Tab');return
 if field.get_attribute('readonly') is None and typ!='button':
  for text in (fmt,target.strftime('%d.%m.%Y')):
   try:
    field.fill(text);field.press('Tab')
    if text in field.input_value():return
   except Exception:pass
 field.click()
 options=[f'[data-date="{fmt}"]',f'[data-day="{fmt}"]',f'[aria-label*="{fmt}"]',f'[title="{fmt}"]']
 try:first_visible(page,options).click()
 except SiteChanged as exc:raise SiteChanged(f'Cannot safely choose exact date {fmt}; calibrate site-specific calendar') from exc

def search_one(page,settings,task,diagnostics):
 p=settings['selectors'];diagnostics.mkdir(parents=True,exist_ok=True)
 page.goto(settings['booking_url'],wait_until='domcontentloaded',timeout=50000)
 page.wait_for_timeout(1800);assert_not_blocked(page)
 select_airport(page,p['origin_input'],task['origin'])
 select_airport(page,p['destination_input'],task['destination'])
 select_departure_date(page,p['departure_input'],date.fromisoformat(task['departure_date']))
 first_visible(page,p['search_button']).click()
 page.wait_for_timeout(3000);assert_not_blocked(page)
 text_cards=[]
 for s in p['flight_cards']:
  loc=page.locator(s)
  try:
   for i in range(min(30,loc.count())):
    if loc.nth(i).is_visible(): text_cards.append(loc.nth(i).inner_text(timeout=2500))
   if text_cards:break
  except Exception:continue
 if not text_cards:
  visible=page.locator('body').inner_text(timeout=7000).lower()
  no_fares=('нет рейсов','рейсы не найдены','билетов нет','no flights','no results','no fares available','no available flights')
  if any(t in visible for t in no_fares):
   raise NoFareAvailable('Airline shows no available fares for requested itinerary')
  raise SiteChanged('No readable itinerary price cards; selectors require site calibration')
 records=[]
 for body in text_cards:
  offer=parse_offer_card(body,airline_code=settings['airline_code'],provider=settings['provider'],origin=task['origin'],
    destination=task['destination'],date=task['departure_date'],adults=1,source_url=page.url)
  if offer and offer['flight_number']==task['flight_number']: records.append(offer)
 if not records:raise SiteChanged('No exact matching flight number, date, route and unambiguous price')
 return records

def save_diagnostic(page,folder,task,error):
 folder.mkdir(parents=True,exist_ok=True)
 key=re.sub(r'[^A-Za-z0-9_-]','_',f"{task['origin']}-{task['destination']}-{task['departure_date']}")
 try:page.screenshot(path=str(folder/f'{key}.png'),full_page=True,timeout=8000)
 except Exception:pass
 (folder/f'{key}.txt').write_text(str(error),encoding='utf-8')
