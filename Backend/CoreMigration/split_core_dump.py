#!/usr/bin/env python3
"""Offline, opt-in preparation of a NON-HOTEL D1 export. Never connects to Cloudflare.

Source: a Wrangler D1 export from the existing operations or bookings database.
Output: SQL limited to allowlisted tables. Fails closed if any included foreign-key
points at an excluded table. All preserved IDs/data remain unchanged.
The generated SQL contains PERSONAL DATA; never commit it or upload to GitHub.
"""
import argparse
import json
import sqlite3
from pathlib import Path

# Explicit allowlist. Unknown tables are excluded and listed for manual review.
CORE_TABLES = frozenset('''
bookings booking_esims booking_itinerary_items booking_number_sequence
booking_payment_instructions booking_payment_receipts booking_pricing_overrides
booking_status_history booking_tombstones booking_travel_documents booking_travelers
business_chat_attachments business_chat_messages business_chat_threads
business_push_devices business_security_devices business_security_login_events
business_staff_sessions business_flight_sync_feeds client_notification_devices
client_push_devices client_push_subscriptions client_push_subscriptions_v2
client_system_notification_reads client_system_notifications deleted_bookings
esim_access_inventory flight_verification_cache ignav_api_usage_monthly
operation_notification_receipts package_quote_audits payment_templates
pending_package_pricing_reports pilgrim_trips pilgrims iumrah_accounts
pilgrim_trips_v2 pilgrims_v2 iumrah_account_sessions
rumrah_identity_confirmations iumrah_identity_confirmations iumrah_security_submissions
team_members trip_assignments trip_flights business_chatgpt_oauth_codes
business_chatgpt_oauth_tokens chatgpt_access_links
'''.split()) - {'rumrah_identity_confirmations'}

EXCLUDED_PREFIXES = ('hotel_', 'business_hotel_', 'ziyarat_', 'primary_hotel', 'catalog_', 'd1_', '_cf_')

def q(name):
    return '"' + name.replace('"','""') + '"'

def literal(value):
    if value is None: return 'NULL'
    if isinstance(value,bytes): return "X'"+value.hex()+"'"
    if isinstance(value,(int,float)): return str(value)
    return "'"+str(value).replace("'","''")+"'"

def load_db(path):
    db=sqlite3.connect(':memory:')
    db.executescript(Path(path).read_text(encoding='utf-8'))
    db.execute('PRAGMA foreign_keys=ON')
    return db

def analyze(db):
    tables={r[0]:r[1] for r in db.execute("SELECT name,sql FROM sqlite_master WHERE type='table' AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%'")}
    selected=sorted(set(tables)&CORE_TABLES)
    unknown=sorted(t for t in tables if t not in CORE_TABLES and not t.startswith(EXCLUDED_PREFIXES) and t not in {'hotels','legacy_deleted_bookings_cleanup'})
    missing_fks=[]
    for table in selected:
        for fk in db.execute(f'PRAGMA foreign_key_list({q(table)})'):
            if fk[2] not in selected: missing_fks.append({'table':table,'references':fk[2]})
    counts={t:db.execute(f'SELECT COUNT(*) FROM {q(t)}').fetchone()[0] for t in selected}
    return tables,selected,unknown,missing_fks,counts

def write_export(db,tables,selected,output):
    parts=['-- IUMRAH NON-HOTEL MIGRATION; PRIVATE CUSTOMER DATA: NEVER COMMIT',
           'PRAGMA foreign_keys=OFF;','BEGIN TRANSACTION;']
    for table in selected:
        parts.append(tables[table].rstrip(';')+';')
        cols=[r[1] for r in db.execute(f'PRAGMA table_info({q(table)})')]
        names=', '.join(q(c) for c in cols)
        select=f'SELECT {names} FROM {q(table)}'
        for row in db.execute(select):
            values=', '.join(literal(v) for v in row)
            parts.append(f'INSERT INTO {q(table)} ({names}) VALUES ({values});')
    if db.execute("SELECT 1 FROM sqlite_master WHERE name='sqlite_sequence'").fetchone():
        for table, seq in db.execute('SELECT name,seq FROM sqlite_sequence'):
            if table in selected:
                parts.append(f"INSERT OR REPLACE INTO sqlite_sequence(name,seq) VALUES ({literal(table)},{literal(seq)});")
    for typ,name,table,sql in db.execute("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE type IN ('index','trigger') AND sql IS NOT NULL"):
        if table in selected:
            parts.append(sql.rstrip(';')+';')
    parts += ['COMMIT;','PRAGMA foreign_keys=ON;']
    Path(output).write_text('\n'.join(parts)+'\n',encoding='utf-8')


def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('source',help='Wrangler D1 SQL export; must be from YOUR old operations / bookings D1')
    ap.add_argument('--output',help='Private destination SQL (never upload to GitHub)')
    ap.add_argument('--plan-only',action='store_true')
    args=ap.parse_args()
    db=load_db(args.source)
    tables,selected,unknown,fks,counts=analyze(db)
    report={'selected_tables':selected,'excluded_tables':sorted(set(tables)-set(selected)),
            'unknown_review_required':unknown,'foreign_key_blockers':fks,'row_counts':counts,
            'total_rows':sum(counts.values()),'safe_to_export':bool(selected) and not fks and not unknown}
    print(json.dumps(report,ensure_ascii=False,indent=2))
    if args.plan_only: return
    if not args.output: ap.error('Specify --output for export or --plan-only for inspection')
    if not report['safe_to_export']:
        raise SystemExit('REFUSED: Unknown tables or cross-database foreign keys; manual schema review required.')
    write_export(db,tables,selected,args.output)
    check=sqlite3.connect(':memory:')
    check.executescript(Path(args.output).read_text(encoding='utf-8'))
    failures=list(check.execute('PRAGMA foreign_key_check'))
    if failures:
        Path(args.output).unlink(missing_ok=True)
        raise SystemExit('REFUSED: Foreign key check failed; private output deleted.')
    after={t:check.execute(f'SELECT COUNT(*) FROM {q(t)}').fetchone()[0] for t in selected}
    if after != counts:
        Path(args.output).unlink(missing_ok=True)
        raise SystemExit('REFUSED: Row count mismatch; private output deleted.')
    print('OFFLINE_CHECK_PASSED: row counts and foreign keys preserved; no Cloudflare writes performed.')

if __name__=='__main__': main()
