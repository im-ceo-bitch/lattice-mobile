import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliseFlight,normaliseOffer,allowCreateFlight,publicOfferIsFresh } from '../src/core.js';
test('master flight stable key and strict validation',()=>{
  const f=normaliseFlight({airline_code:'C6',flight_number:'C6 401',origin:'TAS',destination:'JED',departure_date:'2026-12-12'},'ignav');
  assert.equal(f.key,'C6|C6401|TAS|JED|2026-12-12');
  assert.throws(()=>normaliseFlight({airline_code:'C6',flight_number:'C6401',origin:'JED',destination:'TAS',departure_date:'2026-11-31'},'centrum'));
  assert.throws(()=>normaliseFlight({airline_code:'HY',flight_number:'HY321',origin:'TAS',destination:'JED',departure_date:'2026-11-20'},'centrum'));
});
test('bot cannot create master flights',()=>{
  assert.equal(allowCreateFlight('centrum'),false); assert.equal(allowCreateFlight('ignav'),true);
  assert.equal(allowCreateFlight('aerodatabox'),false);
});
test('offers are validated and missing seats remain unknown',()=>{
 const date=new Date().toISOString();
 const o=normaliseOffer({amount_minor:32000,currency:'USD',observed_at:date},'centrum',date);
 assert.equal(o.seats_left,null);
 assert.equal(o.amount_minor,32000);
 assert.throws(()=>normaliseOffer({amount_minor:0,currency:'USD'},'centrum',date));
});
test('stale prices are never marked fresh',()=>{
 const old=new Date(Date.now()-30*3600000).toISOString();
 assert.equal(publicOfferIsFresh({provider:'centrum',checked_at:old}),false);
 assert.equal(publicOfferIsFresh({provider:'legacy_import',checked_at:new Date().toISOString()}),false);
});
