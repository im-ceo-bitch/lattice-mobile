import io, sys, tempfile, unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from release_cutover import migrate_object, binding_value, UUID
class Missing(Exception):
    response={'Error':{'Code':'NoSuchKey'}}
class Body(io.BytesIO):
    def iter_chunks(self,chunk_size):yield self.read()
class FakeS3:
    def __init__(self,objects):self.objects=objects;self.writes=0
    def get_object(self, Bucket, Key):
        if Key not in self.objects:raise Missing()
        body,meta=self.objects[Key];return {'Body':Body(body),**meta}
    def put_object(self,Bucket,Key,Body,IfNoneMatch,**meta):
        assert IfNoneMatch=='*' and Key not in self.objects
        self.objects[Key]=(Body.read(),meta);self.writes+=1
class TestReleaseCutover(unittest.TestCase):
    def test_copy_only_missing_and_repeat_idempotently(self):
        src=FakeS3({'key':(b'abc',{'ContentType':'application/pdf'})});dst=FakeS3({})
        with tempfile.TemporaryDirectory() as d:
            migrate_object(src,dst,'old','new','key',Path(d),True)
            migrate_object(src,dst,'old','new','key',Path(d),True)
            self.assertEqual(dst.writes,1);self.assertEqual(list(Path(d).iterdir()),[])
    def test_conflict_never_overwrites(self):
        src=FakeS3({'key':(b'abc',{'ContentType':'application/pdf'})});dst=FakeS3({'key':(b'xyz',{'ContentType':'application/pdf'})})
        with tempfile.TemporaryDirectory() as d,self.assertRaisesRegex(ValueError,'CONFLICT'):migrate_object(src,dst,'old','new','key',Path(d),True)
        self.assertEqual(dst.writes,0)
    def test_metadata_conflict(self):
        src=FakeS3({'key':(b'abc',{'ContentType':'application/pdf'})});dst=FakeS3({'key':(b'abc',{'ContentType':'text/plain'})})
        with tempfile.TemporaryDirectory() as d,self.assertRaisesRegex(ValueError,'CONFLICT'):migrate_object(src,dst,'old','new','key',Path(d),True)
        self.assertEqual(dst.writes,0)
    def test_missing_in_verify_mode_no_write(self):
        src=FakeS3({'key':(b'abc',{})});dst=FakeS3({})
        with tempfile.TemporaryDirectory() as d,self.assertRaisesRegex(ValueError,'MISSING'):migrate_object(src,dst,'old','new','key',Path(d),False)
        self.assertEqual(dst.writes,0)
    def test_explicit_binding(self):
        id='12345678-1234-1234-1234-123456789abc';self.assertEqual(binding_value([{'name':'DB','type':'d1','id':id}],'DB','d1','id',UUID),id)
        with self.assertRaisesRegex(ValueError,'BINDING_NOT_CONFIRMED'):binding_value([],'DB','d1','id',UUID)
