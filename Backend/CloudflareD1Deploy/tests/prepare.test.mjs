import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareD1 } from '../prepare.mjs';
const accountId = 'a'.repeat(32);
const token = 't'.repeat(40);
const fake = (data, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(data) });
test('refuses to create anything if flights D1 missing (wrong account guard)', async () => {
  let count = 0;
  await assert.rejects(prepareD1({ accountId, token, fetcher: async () => {count++; return fake({ success: true, result: [] });} }), /Safety stop/);
  assert.equal(count, 1);
});
test('creates core only when flights D1 already exists', async () => {
  const calls = [];
  const result = await prepareD1({ accountId, token, fetcher: async (url, opts) => {
    calls.push({url,method: opts.method||'GET'});
    if (opts.method==='POST') return fake({ success:true, result: {uuid:'core-id'} });
    return fake({success:true, result:[{name:'iumrah-flights',uuid:'flights-id'}]});
  }});
  assert.equal(result.createdCore,true);
  assert.deepEqual(calls.map(x=>x.method),['GET','POST']);
});
test('does not change already existing core', async () => {
  const result = await prepareD1({ accountId, token, fetcher: async (_, opts) => {
    assert.equal(opts.method,undefined);
    return fake({success:true,result:[{name:'iumrah-flights',uuid:'f'},{name:'iumrah-core',uuid:'c'}]});
  }});
  assert.equal(result.createdCore,false);
});
test('fails on invalid Cloudflare token/auth response without writing', async () => {
  await assert.rejects(prepareD1({ accountId, token, fetcher: async ()=>fake({success:false,errors:[{code:10000,message:'Authentication error'}]},401) }),/HTTP 401/);
});
test('rejects wrong account id', async () => {
  await assert.rejects(prepareD1({accountId:'broken',token,fetcher:async()=>{throw Error('should not call API')}}), /32-character/);
});
