import test from 'node:test';
import assert from 'node:assert/strict';
import { presentationStatus, presentItinerary } from '../src/itineraries.js';
const base={id:'direct:f1',origin:'TAS',destination:'JED',departure_date:'2026-12-01',segment_count:1,stop_count:0};
const segment={segment_order:0,transfer_type:'through',flight_number:'C6123',airline_code:'C6',origin:'TAS',destination:'JED',departure_at:'2026-12-01T09:00:00+05:00',arrival_at:'2026-12-01T13:00:00+03:00'};
test('direct flight complete schedule never synthesizes price',()=>{
 const got=presentItinerary(base,[segment],[]);
 assert.equal(got.detail_status,'complete');assert.equal(got.stop_count,0);assert.deepEqual(got.offers,[]);
});
test('missing timestamps remain unconfirmed',()=>{
 assert.equal(presentationStatus(base,[{...segment,arrival_at:null}]),'needs_confirmation');
});
test('connecting itinerary requires ordered valid chain',()=>{
 const row={...base,segment_count:2,stop_count:1};
 const a={...segment,destination:'DOH',arrival_at:'2026-12-01T10:00:00+03:00'};
 const b={...segment,origin:'DOH',departure_at:'2026-12-01T12:00:00+03:00',arrival_at:'2026-12-01T16:00:00+03:00'};
 assert.equal(presentationStatus(row,[a,b]),'complete');
 assert.equal(presentationStatus(row,[a,{...b,origin:'MED'}]),'needs_confirmation');
 assert.equal(presentationStatus(row,[a,{...b,departure_at:'2026-12-01T09:00:00+03:00'}]),'needs_confirmation');
});
