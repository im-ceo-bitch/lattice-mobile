import test from 'node:test';import assert from 'node:assert/strict';import {mapAero} from '../src/aerodatabox.js';
test('AeroDataBox matches exact number and route; never invents offsets',()=>{
 const flight={airline_code:'C6',flight_number:'C6401',origin:'TAS',destination:'JED',departure_date:'2026-12-01'};
 const item={number:'C6 401',departure:{airport:{iata:'TAS'},scheduledTime:{local:'2026-12-01 11:00'}},
  arrival:{airport:{iata:'JED'},scheduledTime:{local:'2026-12-01 14:00'}},status:'Expected'};
 const f=mapAero(flight,item); assert.equal(f.departure_at,null);assert.equal(f.operational_status,'Expected');
 assert.equal(mapAero(flight,{...item,number:'C6402'}),null);
 assert.equal(mapAero(flight,{...item,arrival:{airport:{iata:'MED'}}}),null);
});
