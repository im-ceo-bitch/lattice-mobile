import json
import sqlite3
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0,str(SCRIPT_DIR))
from prepare import prepare_one, allow_row, fix_row
from cloudflare import preflight

AUDIT_PATH = Path('/mnt/data/iumrah-old-cloudflare-d1-audit.zip')
POLICY = json.loads((SCRIPT_DIR/'policy.json').read_text())

class MigrationTests(unittest.TestCase):
    def test_flight_date_selection(self):
        db=sqlite3.connect(':memory:');db.row_factory=sqlite3.Row
        db.execute('CREATE TABLE curated_flight_offers(outbound_date TEXT, inbound_date TEXT)')
        for outbound, inbound in [
            ('2026-10-28',None),('2026-11-07',None),('2026-11-08','2026-11-16'),
            ('2026-11-08','2026-11-01'),('bad',None)
        ]:
            db.execute('INSERT INTO curated_flight_offers VALUES (?,?)',(outbound,inbound))
        got=[allow_row('iumrah-hotels','curated_flight_offers',r,'2026-11-07')
             for r in db.execute('SELECT * FROM curated_flight_offers')]
        self.assertEqual(got,[False,True,True,False,False])
        db.close()

    def test_preserve_sync_identity_but_clear_cached_flights(self):
        db=sqlite3.connect(':memory:');db.row_factory=sqlite3.Row
        db.execute('CREATE TABLE business_flight_sync_feeds(owner_login TEXT, token_hash TEXT, snapshot_json TEXT, flight_count INT, snapshot_updated_at TEXT)')
        db.execute('INSERT INTO business_flight_sync_feeds VALUES (?,?,?,?,?)',('owner','hash','{"flights":[{"expired":true}]}',1,'2026'))
        cols=[x[1] for x in db.execute('PRAGMA table_info(business_flight_sync_feeds)')]
        values=fix_row('business_flight_sync_feeds',cols,db.execute('SELECT * FROM business_flight_sync_feeds').fetchone())
        self.assertEqual(values,('owner','hash','{"version":1,"flights":[]}',0,None))
        db.close()

    def test_schema_roundtrip_for_all_audited_tables(self):
        if not AUDIT_PATH.exists():
            self.skipTest('Original audit ZIP not mounted; source schema fixture unavailable')
        with zipfile.ZipFile(AUDIT_PATH) as z:
            audit=json.loads(z.read('inventory.json'))
        with tempfile.TemporaryDirectory() as td:
            work=Path(td)
            for d in audit['databases']:
                name=d['database']
                source=sqlite3.connect(':memory:');source.execute('PRAGMA foreign_keys=OFF')
                for t in d['tables']:
                    if t['table']=='_cf_KV': continue
                    source.execute(t['create_sql'])
                if name=='iumrah-hotels':
                    # Valid future/expired synthetic offers; no real user data.
                    vals=source.execute('PRAGMA table_info(curated_flight_offers)').fetchall()
                    c=[x[1] for x in vals];data={
                        'id':'f1','source_candidate_id':'c1','source_provider':'ignav',
                        'outbound_origin':'TAS','outbound_destination':'JED','outbound_date':'2026-12-03',
                        'cabin_class':'economy', 'airline_codes_json':'[]', 'airline_names_json':'[]',
                        'flight_numbers_json':'[]','itinerary_json':'{}', 'total_fare':270,
                        'per_traveler_fare':270,'currency':'USD','traveler_count':1,
                        'observed_at':'2026-11-06T00:00:00Z','published':1,'priority':100,
                        'created_at':'2026-11-06T00:00:00Z','updated_at':'2026-11-06T00:00:00Z',
                    }
                    source.execute('INSERT INTO curated_flight_offers ('+
                                   ','.join('"'+k+'"' for k in data)+') VALUES ('+
                                   ','.join('?' for _ in data)+')',list(data.values()))
                    source.execute("INSERT INTO curated_flight_offers SELECT 'f2',source_candidate_id,source_provider,"
                                   "outbound_origin,outbound_destination,inbound_origin,inbound_destination,"
                                   "'2026-10-01',inbound_date,cabin_class,airline_codes_json,airline_names_json,"
                                   "flight_numbers_json,itinerary_json,total_fare,per_traveler_fare,currency,"
                                   "traveler_count,observed_at,published,priority,created_by,created_at,updated_at,"
                                   "offer_type,journey_role,fingerprint FROM curated_flight_offers WHERE id='f1'")
                path=work/(name+'.sql')
                path.write_text('\n'.join(source.iterdump()))
                result=prepare_one(name,POLICY['databases'][name],path,work/'stage','2026-11-07')
                self.assertEqual(set(result['tables']),set(POLICY['databases'][name]['allow']))
                if name=='iumrah-hotels':
                    self.assertEqual(result['tables']['curated_flight_offers'],{'kept':1,'skipped':1})
                    data=(work/'stage'/'iumrah-core.sql').read_text()
                    self.assertNotIn('CREATE TABLE "hotels"',data)
                    self.assertNotIn('REFERENCES hotels',data)
                source.close()

    def test_nonempty_target_is_never_overwritten(self):
        class Fake:
            def list_d1(self):return {'iumrah-core':'db-1'}
            def query(self,id_,sql):return [{'name':'iumrah_accounts'}]
        with self.assertRaisesRegex(RuntimeError,'not empty'):
            preflight(Fake(),{'reports':[{'target':'iumrah-core'}]},False)

if __name__=='__main__':unittest.main()
