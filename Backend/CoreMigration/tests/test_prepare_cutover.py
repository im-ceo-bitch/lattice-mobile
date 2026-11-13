import sqlite3,sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from prepare_cutover import prepare
class MergeTest(unittest.TestCase):
    def db(self,data=''):
        db=sqlite3.connect(':memory:');db.executescript('CREATE TABLE a(id INTEGER PRIMARY KEY,token TEXT); CREATE TABLE b(id INTEGER PRIMARY KEY,aid INTEGER REFERENCES a(id));'+data);return db
    def test_preserves_existing_ids_and_token(self):
        src=self.db("INSERT INTO a VALUES(1,'hash');INSERT INTO b VALUES(7,1);");dst=self.db("INSERT INTO a VALUES(1,'hash');")
        sql,report=prepare(src,dst,['a','b']);self.assertEqual(report['b']['insert'],1);self.assertEqual(dst.execute('SELECT * FROM b').fetchall(),[(7,1)]);self.assertEqual(prepare(src,dst,['a','b'])[0],[])
    def test_refuses_conflicts(self):
        with self.assertRaisesRegex(ValueError,'ROW_CONFLICT'):prepare(self.db("INSERT INTO a VALUES(1,'old');"),self.db("INSERT INTO a VALUES(1,'new');"),['a'])
    def test_missing_parent(self):
        with self.assertRaisesRegex(ValueError,'FOREIGN_KEY_CHECK'):prepare(self.db("INSERT INTO b VALUES(7,1);"),self.db(),['b'])
    def test_missing_table(self):
        src=self.db("INSERT INTO a VALUES(1,'hash');");dst=sqlite3.connect(':memory:');sql,_=prepare(src,dst,['a']);self.assertEqual(dst.execute('SELECT * FROM a').fetchall(),[(1,'hash')]);self.assertTrue(sql[0].startswith('CREATE TABLE'))
if __name__=='__main__':unittest.main()
