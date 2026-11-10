import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { artifactFileURL, prepareFlightIdentities, seedLocalFlightArtifactIfAvailable } from '../scripts/seed-from-flight-artifact.mjs';

const snapshot = JSON.parse(await readFile(artifactFileURL, 'utf8'));
const NOW = new Date('2026-11-10T08:45:00Z');

test('kepler-ios snapshot is public identities with expected airline split and no price fields', () => {
  assert.equal(snapshot.version, 1);
  assert.equal(snapshot.scope, 'public_flight_identities_only');
  assert.equal(snapshot.records.length,79);
  const count = Object.groupBy ? Object.groupBy(snapshot.records,x=>x.airline_code) : null;
  if (count) assert.deepEqual(Object.fromEntries(Object.entries(count).map(([k,v])=>[k,v.length])),{C6:28,HY:18,XY:33});
  assert.ok(snapshot.records.every(x=>Object.keys(x).every(k=>['airline_code','flight_number','origin','destination','departure_date','departure_at','arrival_at'].includes(k))));
});
test('filter departed and out-of-window flights, preserve all other identities', () => {
  const { records, stats } = prepareFlightIdentities(snapshot, NOW);
  assert.equal(stats.export_count,79);
  assert.equal(stats.expired_or_departed, 2);
  assert.equal(stats.duplicates,0);
  assert.equal(stats.invalid,0);
  assert.equal(records.length,77);
  assert.ok(records.every(x=>new Date(x.departure_at)>NOW));
});
test('never allow fare, hotel or passenger fields in artifact',()=>{
  const data=structuredClone(snapshot);
  data.records[0].price=270;
  assert.throws(()=>prepareFlightIdentities(data,NOW),/FLIGHT_ARTIFACT_CONTAINS_INVALID_RECORDS/);
});
test('local seed uses existing API and does not require old-account secrets', async()=>{
  const calls=[];
  const env={...process.env};
  process.env.NEW_CLOUDFLARE_ACCOUNT_ID='a'.repeat(32);
  process.env.NEW_CLOUDFLARE_API_TOKEN='test-cloudflare-token-not-real';
  process.env.FLIGHT_HUB_URL='https://test-flight-hub.example';
  try {
    const result=await seedLocalFlightArtifactIfAvailable({now:NOW,push:true,request:async(url,opts)=>{
      calls.push({url,opts});
      const body=JSON.parse(opts.body);
      return {ok:true,status:200,json:async()=>({accepted:body.records.length,unmatched:0,rejected:0})};
    }});
    assert.equal(result,true);
    assert.equal(calls.length,1);
    assert.equal(calls[0].url,'https://test-flight-hub.example/v1/ingest/legacy_import');
    const sent=JSON.parse(calls[0].opts.body);
    assert.equal(sent.records.length,77);
    assert.ok(sent.records.every(r=>!('amount_minor' in r)&&!('price' in r)));
  }finally {for(const k of ['NEW_CLOUDFLARE_ACCOUNT_ID','NEW_CLOUDFLARE_API_TOKEN','FLIGHT_HUB_URL']){
    if(env[k]===undefined) delete process.env[k]; else process.env[k]=env[k];
  }}
});
