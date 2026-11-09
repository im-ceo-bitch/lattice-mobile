import importlib.util
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / 'verify_cutover.py'
SPEC = importlib.util.spec_from_file_location('verify_cutover', SCRIPT)
M = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(M)


class VerifyCutoverTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def files(self, source, target):
        first, second = self.root / 'expected.sql', self.root / 'target.sql'
        first.write_text(source)
        second.write_text(target)
        return str(first), str(second)

    def test_empty_snapshot_cannot_be_approved(self):
        result = M.verify(*self.files('SELECT 1;', 'SELECT 1;'))
        self.assertFalse(result['ok'])
        self.assertIn('empty_expected_schema', str(result))

    def test_perfect_copy(self):
        sql = "CREATE TABLE iumrah_accounts(id TEXT PRIMARY KEY, login TEXT); INSERT INTO iumrah_accounts VALUES('u1', 'a');"
        self.assertTrue(M.verify(*self.files(sql, sql))['ok'])

    def test_missing_user_detected(self):
        schema = 'CREATE TABLE iumrah_accounts(id TEXT PRIMARY KEY, login TEXT);'
        result = M.verify(*self.files(schema + "INSERT INTO iumrah_accounts VALUES('u1','a');", schema))
        self.assertEqual(result['issues'][0]['reason'], 'row_mismatch')
        self.assertNotIn('u1', str(result))

    def test_hotel_catalog_rejected(self):
        source = 'CREATE TABLE iumrah_accounts(id TEXT PRIMARY KEY);'
        result = M.verify(*self.files(source, source + 'CREATE TABLE hotels(id TEXT PRIMARY KEY);'))
        self.assertIn('hotel_catalog_found', str(result))

    def test_schema_drift_detected(self):
        result = M.verify(*self.files('CREATE TABLE t(id TEXT);', 'CREATE TABLE t(id INTEGER);'))
        self.assertIn('schema_drift', str(result))

    def test_fk_violation_detected(self):
        sql = "CREATE TABLE parent(id TEXT PRIMARY KEY); CREATE TABLE child(pid TEXT REFERENCES parent(id)); INSERT INTO child VALUES('unknown');"
        result = M.verify(*self.files(sql,sql))
        self.assertFalse(result['ok'])
        self.assertIn('foreign_key_violation', str(result))

    def test_reorder_not_mismatch(self):
        a = 'CREATE TABLE a(x TEXT); INSERT INTO a VALUES ("1"); INSERT INTO a VALUES ("2");'
        b = 'CREATE TABLE a(x TEXT); INSERT INTO a VALUES ("2"); INSERT INTO a VALUES ("1");'
        self.assertTrue(M.verify(*self.files(a,b))['ok'])


if __name__ == '__main__':
    unittest.main()
