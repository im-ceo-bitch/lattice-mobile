import test from 'node:test';
import assert from 'node:assert/strict';
import {extractCuratedFlightIdentities} from '../src/curated.js';
import {tashkentDay} from '../src/core.js';
const today=new Date(tashkentDay()+'T00:00:00Z');
function iso(days) {const d=new Date(today);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10)+'T11:00:00+05:00';}
const leg=(date,code='C6')=>({airline_code:code,flight_number:code+' 401',origin:'TAS',destination:'JED',departure_at:date,arrival_at:date});
test('legacy catalog imports only future identities and dedupes; never imports prices',()=>{
 const rows=[
  {itinerary_json:JSON.stringify({legs:[leg(iso(9)),leg(iso(-4))],price:{amount:9000,currency:'USD'}})},
  {itinerary_json:JSON.stringify({legs:[leg(iso(9))]})},
  {itinerary_json:'invalid-json'}
 ];
 const {records,stats}=extractCuratedFlightIdentities(rows);
 assert.equal(records.length,1);assert.equal(stats.expired,1);assert.equal(stats.duplicates,1);
 assert.equal(stats.unreadable,1);assert.ok(!('amount_minor' in records[0]));
});
