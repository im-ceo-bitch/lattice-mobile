import importlib.util
import sqlite3
import tempfile
import unittest
from pathlib import Path

p=Path(__file__).resolve().parents[1]/'split_core_dump.py'
spec=importlib.util.spec_from_file_location('split',p)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class SplitTests(unittest.TestCase):
    def test_preserves_ids_and_never_exports_hotel(self):
        db=sqlite3.connect(':memory:')
        db.executescript("""
            CREATE TABLE bookings(id TEXT PRIMARY KEY,status TEXT);
            CREATE TABLE booking_status_history(id TEXT PRIMARY KEY,booking_id TEXT REFERENCES bookings(id));
            CREATE TABLE hotels(id TEXT PRIMARY KEY,name TEXT);
            INSERT INTO bookings VALUES ('0041','NEW');
            INSERT INTO booking_status_history VALUES ('s1','0041');
            INSERT INTO hotels VALUES ('h1','private hotel');
        """)
        tables,selected,unknown,fks,counts=m.analyze(db)
        self.assertFalse(fks)
        self.assertFalse(unknown)
        with tempfile.TemporaryDirectory() as d:
            target=Path(d)/'core.sql'
            m.write_export(db,tables,selected,target)
            content=target.read_text()
            self.assertNotIn('private hotel',content)
            new=sqlite3.connect(':memory:');new.executescript(content)
            self.assertEqual(new.execute('SELECT id FROM bookings').fetchone()[0],'0041')
            self.assertEqual(list(new.execute('PRAGMA foreign_key_check')),[])
    def test_blocks_cross_database_foreign_key(self):
        db=sqlite3.connect(':memory:')
        db.executescript('CREATE TABLE hotels(id TEXT PRIMARY KEY); CREATE TABLE trip_assignments(id TEXT,hotel_id TEXT REFERENCES hotels(id));')
        _,_,_,fks,_=m.analyze(db)
        self.assertEqual(fks[0]['references'],'hotels')
    def test_unknown_table_requires_review(self):
        db=sqlite3.connect(':memory:')
        db.execute('CREATE TABLE customer_custom_data(id TEXT)')
        _,_,unknown,_,_=m.analyze(db)
        self.assertEqual(unknown,['customer_custom_data'])

if __name__=='__main__':unittest.main()
