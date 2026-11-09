"""Strict on-page offer parser. A price without a known flight is never published."""
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
import re

AIRPORTS = {
 'TAS': ('tashkent','ташкент','toshkent'), 'JED': ('jeddah','джидд','jiddah'),
 'MED': ('medina','madinah','медин','мадина'), 'TIF': ('taif','таи́ф','тайф'),
 'FEG': ('fergana','fargona','фарган','ферган'), 'SKD': ('samarkand','самарканд','samarqand'),
 'NMA': ('namangan','наманган'), 'AZN': ('andijan','андижан','andijon'),
 'BHK': ('bukhara','бухара','buxoro'), 'KSQ': ('karshi','qarshi','карши'),
 'TMJ': ('termez','термез','termiz'), 'UGC': ('urgench','ургенч','urganch'),
}
# Name, currency and amount must come from one matching visible offer card.
PRICE_RE = re.compile(r"(?<![\w])(?:(UZS|USD|SAR|сум(?:ов|а)?|so[‘'’]?m|₽|\$|ر\.س)\s*([\d\s\u00a0\u202f.,]+)|([\d][\d\s\u00a0\u202f.,]{1,})\s*(UZS|USD|SAR|сум(?:ов|а)?|so[‘'’]?m|\$|ر\.س))(?!\w)", re.I)
CURRENCY_RE = {'$':'USD','ر.س':'SAR'}

def airport_in_text(text, code):
 lower = text.lower()
 return bool(re.search(rf'(?<![a-z]){code.lower()}(?![a-z])',lower)) or any(v in lower for v in AIRPORTS.get(code,()))

def parse_currency(value, token):
 c = CURRENCY_RE.get(token.upper().strip(),token.upper().strip())
 if c in ('СУМ','СУМОВ','СУМА','SOʻM',"SO'M",'SO’M'): c='UZS'
 if c not in ('USD','UZS','SAR'): return None
 s = re.sub(r'[\s\u00a0\u202f]','',value)
 if c=='UZS':
  num=re.sub(r'[,.]','',s)
  return (int(num),'UZS') if num.isdigit() and 10000<=int(num)<=200000000 else None
 if '.' in s and ',' in s:
  sep='.' if s.rfind('.')>s.rfind(',') else ','
  s=s.replace(',' if sep=='.' else '.','').replace(sep,'.')
 elif ',' in s:
  s=s.replace(',','.' if len(s.split(',')[-1]) in (1,2) else '')
 elif '.' in s and len(s.split('.')[-1])==3:
  s=s.replace('.','')
 try:
  f=float(s)
  if 1<=f<=100000:return (round(f*100),c)
 except ValueError: pass
 return None

def find_prices(text):
 prices=set()
 for m in PRICE_RE.finditer(text):
  a=parse_currency(m.group(2) or m.group(3),m.group(1) or m.group(4))
  if a: prices.add(a)
 return prices

def parse_offer_card(text,*,airline_code,provider,origin,destination,date,adults=1,source_url):
 if provider not in ('centrum','uzbekistan','flynas'): raise ValueError('unknown provider')
 expected={'centrum':'C6','uzbekistan':'HY','flynas':'XY'}[provider]
 if airline_code!=expected: return None
 if not (airport_in_text(text,origin) and airport_in_text(text,destination)):return None
 if re.search(r'пересадк|transfer|stopover|connecting|with stops',text,re.I):return None
 codes={expected+match for match in re.findall(rf'(?<![A-Z0-9]){expected}[\s\-–]?(\d{{1,5}}[A-Z]?)(?![A-Z0-9])',text,re.I)}
 prices=find_prices(text)
 if len(codes)!=1 or len(prices)!=1:return None
 amount_minor,currency=prices.pop()
 brands={b.lower():b for b in re.findall(r'\b(Base|Optimal|Comfort|Economy|Value|Light|Classic|Flex|Premium)\b',text,re.I)}
 if len(brands)>1: return None
 brand=next(iter(brands.values()),None)
 # Weight and remaining availability are extracted ONLY if the site explicitly
 # attributes them to the displayed fare. Never infer baggage from airline rules.
 baggage=re.search(r'(?:checked\s*baggage|регистрируемый\s*багаж|багаж)\s*(?:до\s*)?(\d{1,2})\s*(?:kg|кг)|(?:checked\s*baggage|багаж)\s*[:：-]?\s*(\d{1,2})\s*(?:kg|кг)',text,re.I)
 if not baggage:
  baggage=re.search(r'(\d{1,2})\s*(?:kg|кг)\s*(?:checked\s*baggage|багаж)',text,re.I)
 cabin=re.search(r'(?:cabin\s*bag(?:gage)?|hand\s*luggage|ручн(?:ая|ой)\s*клад(?:ь|и))\s*[:：-]?\s*(?:до\s*)?(\d{1,2})\s*(?:kg|кг)',text,re.I)
 left=re.search(r'(?:only|осталось|осталось\s*всего)\s*(\d{1,2})\s*(?:seats?|мест[ао]?)\s*(?:left|available|доступно)?',text,re.I)
 seats=int(left.group(1)) if left else None
 # A generic seat count is not live inventory. Only an explicit fare scarcity
 # statement counts. Values of 10+ are often API caps and not exact counts.
 if seats is not None and seats>9: seats=None
 return {'airline_code':expected,'flight_number':next(iter(codes)),'origin':origin,'destination':destination,
  'departure_date':date,'fare_brand':brand or '', 'amount_minor':amount_minor,
  'currency':currency,'adults':adults,'children':0,'infants':0,'observed_at':datetime.now(timezone.utc).isoformat(),
  'price_scope':'site_displayed_not_checkout_verified','source_url':source_url,
  'baggage_checked_kg':int(next(v for v in baggage.groups() if v)) if baggage else None,
  'baggage_cabin_kg':int(cabin.group(1)) if cabin else None,
  'seats_left':seats}
