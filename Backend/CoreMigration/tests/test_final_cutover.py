import sqlite3,sys,unittest,tempfile,subprocess,json,os
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from final_cutover import selection,reconcile,object_refs,verify_objects,ANCHORS,ALLOWED,SKIPS

class FinalCutoverTests(unittest.TestCase):
    def fixture(self,binding):
        db=sqlite3.connect(':memory:')
        for name in ANCHORS[binding]:db.execute(f'CREATE TABLE "{name}"(id INTEGER PRIMARY KEY,value TEXT)')
        return db
    def test_gifts_preserved_and_new_destination_rows_kept(self):
        src=self.fixture('HOTELS_DB');dst=self.fixture('HOTELS_DB')
        src.execute("INSERT INTO iumrah_friends_gifts VALUES(1,'legacy-token')")
        dst.execute("INSERT INTO iumrah_friends_gifts VALUES(2,'new-token')")
        stmts,report=reconcile(src,dst,'HOTELS_DB')
        self.assertEqual(report['tables']['iumrah_friends_gifts']['insert'],1)
        self.assertEqual(dst.execute('SELECT * FROM iumrah_friends_gifts ORDER BY id').fetchall(),[(1,'legacy-token'),(2,'new-token')])
        self.assertEqual(reconcile(src,dst,'HOTELS_DB')[0],[])
    def test_wrong_binding_and_unknown_table_rejected(self):
        with self.assertRaisesRegex(ValueError,'SOURCE_ANCHORS_MISSING'):selection(self.fixture('BOOKINGS_DB'),'HOTELS_DB')
        src=self.fixture('HOTELS_DB');src.execute('CREATE TABLE undocumented_customer_data(id INTEGER)')
        with self.assertRaisesRegex(ValueError,'SOURCE_TABLES_REQUIRE_REVIEW'):selection(src,'HOTELS_DB')
    def test_conflicting_gift_not_overwritten(self):
        src=self.fixture('HOTELS_DB');dst=self.fixture('HOTELS_DB')
        src.execute("INSERT INTO iumrah_friends_gifts VALUES(1,'old')")
        dst.execute("INSERT INTO iumrah_friends_gifts VALUES(1,'different')")
        with self.assertRaisesRegex(ValueError,'ROW_CONFLICT'):reconcile(src,dst,'HOTELS_DB')
    def test_misplaced_existing_rows_can_be_reconciled_separately(self):
        src=sqlite3.connect(':memory:');dst=self.fixture('HOTELS_DB')
        src.executescript("CREATE TABLE iumrah_friends_credit_ledger(id INTEGER PRIMARY KEY,value TEXT); INSERT INTO iumrah_friends_credit_ledger VALUES(5,'credit');")
        stmts,report=reconcile(src,dst,'HOTELS_DB',['iumrah_friends_credit_ledger'])
        self.assertEqual(report['tables']['iumrah_friends_credit_ledger']['insert'],1)
        self.assertEqual(dst.execute('SELECT * FROM iumrah_friends_credit_ledger').fetchall(),[(5,'credit')])
    def test_existing_target_trigger_cannot_erase_other_rows(self):
        src=self.fixture('HOTELS_DB');dst=self.fixture('HOTELS_DB')
        src.execute("INSERT INTO iumrah_friends_gifts VALUES(1,'old')")
        dst.executescript("INSERT INTO iumrah_friends_gifts VALUES(2,'new'); CREATE TRIGGER danger AFTER INSERT ON iumrah_friends_gifts BEGIN DELETE FROM iumrah_friends_gifts WHERE id=2; END;")
        with self.assertRaisesRegex(ValueError,'EXISTING_TARGET_ROW_CHANGED'):reconcile(src,dst,'HOTELS_DB')
    def test_document_keys_are_routed_to_correct_bucket(self):
        web=sqlite3.connect(':memory:');web.executescript("CREATE TABLE booking_documents(r2_key TEXT);INSERT INTO booking_documents VALUES('private/doc');")
        ops=sqlite3.connect(':memory:');ops.executescript("CREATE TABLE booking_travelers(passport_object_key TEXT);INSERT INTO booking_travelers VALUES('private/passport');")
        self.assertEqual(object_refs(web,'BOOKINGS_DB'),{'private/doc'});self.assertEqual(object_refs(ops,'HOTELS_DB'),{'private/passport'})
        ops.execute('CREATE TABLE hidden_files(other_object_key TEXT)')
        with self.assertRaisesRegex(ValueError,'UNMAPPED_R2_FIELDS'):object_refs(ops,'HOTELS_DB')
    def test_r2_byte_verification_and_target_only_read(self):
        calls=[];buckets=[]
        def get(bucket,key,path,*creds):calls.append((bucket,key));path.write_bytes(key.encode())
        def check(bucket,*creds):buckets.append(bucket)
        report=verify_objects({'a'},{'a','b'},'old-bucket','new-bucket',('a','b'),('c','d'),get,check)
        self.assertEqual(report,{'source_objects_byte_verified':1,'target_only_objects_read':1})
        self.assertEqual(buckets,['old-bucket','new-bucket']);self.assertEqual(len(calls),3)
        def bad(bucket,key,path,*creds):path.write_bytes(bucket.encode())
        with self.assertRaisesRegex(ValueError,'R2_VERIFICATION_FAILED'):verify_objects({'a'},{'a'},'old-bucket','new-bucket',('a','b'),('c','d'),bad,check)
        with self.assertRaisesRegex(ValueError,'TARGET_R2_REFERENCES_MISSING'):verify_objects({'a'},set(),'old-bucket','new-bucket',('a','b'),('c','d'),get,check)
    def test_cli_prepare_apply_and_verify_with_misplaced_ledger(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td);ops=self.fixture('HOTELS_DB');web=self.fixture('BOOKINGS_DB');hotels=self.fixture('HOTELS_DB');bookings=self.fixture('BOOKINGS_DB')
            ops.execute("INSERT INTO iumrah_friends_gifts VALUES(1,'old')")
            hotels.execute("INSERT INTO iumrah_friends_gifts VALUES(2,'new')")
            bookings.executescript("CREATE TABLE iumrah_friends_credit_ledger(id INTEGER PRIMARY KEY,value TEXT); INSERT INTO iumrah_friends_credit_ledger VALUES(9,'misplaced-credit');")
            web.execute("INSERT INTO bookings VALUES(3,'booking')")
            pairs=[('legacy-operations',ops),('legacy-bookings',web),('target-hotels',hotels),('target-bookings',bookings)]
            args=[sys.executable,str(Path(__file__).resolve().parents[1]/'final_cutover.py')]
            for name,db in pairs:
                file=root/(name+'.sql');file.write_text('\n'.join(db.iterdump()));args+=['--'+name,str(file)]
            def run(*opts):return subprocess.run(args+list(opts),capture_output=True,text=True,check=False)
            r=run('--mode','plan');self.assertEqual(r.returncode,0,r.stderr);data=json.loads(r.stdout)
            self.assertEqual(data['tables']['HOTELS_DB']['misplaced_source_tables']['iumrah_friends_credit_ledger']['insert'],1)
            self.assertNotEqual(run('--mode','verify-d1').returncode,0)
            out=root/'additions';self.assertNotEqual(run('--mode','prepare','--output-dir',str(out)).returncode,0)
            prepared=run('--mode','prepare','--old-writes-frozen','--output-dir',str(out));self.assertEqual(prepared.returncode,0,prepared.stderr)
            for binding,db,filename in [('HOTELS_DB',hotels,'target-hotels'),('BOOKINGS_DB',bookings,'target-bookings')]:
                db.executescript((out/(binding+'.sql')).read_text());(root/(filename+'.sql')).write_text('\n'.join(db.iterdump()))
            self.assertEqual(hotels.execute('SELECT value FROM iumrah_friends_gifts ORDER BY id').fetchall(),[('old',),('new',)])
            self.assertEqual(hotels.execute('SELECT value FROM iumrah_friends_credit_ledger').fetchone(),('misplaced-credit',))
            self.assertEqual(bookings.execute('SELECT value FROM iumrah_friends_credit_ledger').fetchone(),('misplaced-credit',))
            verified=run('--mode','verify-d1');self.assertEqual(verified.returncode,0,verified.stderr)
            self.assertEqual(json.loads(verified.stdout)['pending_statements'],{'HOTELS_DB':0,'BOOKINGS_DB':0})
            self.assertNotIn('operator_attestation',json.loads(verified.stdout))
            for _,db in pairs:db.close()
if __name__=='__main__':unittest.main()
