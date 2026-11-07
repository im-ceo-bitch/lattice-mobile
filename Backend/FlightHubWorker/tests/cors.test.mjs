import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

test('public web origins can read the new Worker directly', async()=>{
 const req=new Request('https://iumrah-flight-hub.example.workers.dev/health',{headers:{Origin:'https://iumrah.app'}});
 const res=await worker.fetch(req,{});
 assert.equal(res.status,200);
 assert.equal(res.headers.get('Access-Control-Allow-Origin'),'https://iumrah.app');
 const body=await res.json();
 assert.equal(body.database_connected,false);
});
test('untrusted origins get no CORS permission', async()=>{
 const req=new Request('https://example.workers.dev/health',{headers:{Origin:'https://attacker.example'}});
 const res=await worker.fetch(req,{});
 assert.equal(res.headers.get('Access-Control-Allow-Origin'),null);
});
test('preflight is only allowed from allowlisted web origins', async()=>{
 const ok=await worker.fetch(new Request('https://example.workers.dev/v1/public/flights',{method:'OPTIONS',headers:{Origin:'https://iumrah.uz'}}),{});
 assert.equal(ok.status,204);
 const fail=await worker.fetch(new Request('https://example.workers.dev/v1/public/flights',{method:'OPTIONS',headers:{Origin:'https://attacker.example'}}),{});
 assert.equal(fail.status,403);
});
