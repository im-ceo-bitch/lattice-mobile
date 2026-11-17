import test from 'node:test';
import assert from 'node:assert/strict';
import {manualTotals} from '../core/lib/business-manual-booking.js';
const cost={flight:1000,makkah:1100,madinah:500,transfer:400,ziyarat:0,visa:200,guide:100,other:0,commission:0};
test('Configurator 2: backwards-compatible pricing, group discount and per pilgrim total',()=>{
 assert.deepEqual(manualTotals(cost,2),{totalUsd:3300,perPilgrimUsd:1650});
 assert.deepEqual(manualTotals({...cost,discount:800},2),{totalUsd:2500,perPilgrimUsd:1250});
 assert.deepEqual(manualTotals({...cost,commission:10,discount:800},2),{totalUsd:2830,perPilgrimUsd:1415});
});
test('Configurator 2: invalid discounts and nonpositive final price cannot publish',()=>{
 for(const discount of [-1,3300,4000,NaN,Infinity,'800',null]) assert.equal(manualTotals({...cost,discount},2),null);
 assert.equal(manualTotals({...cost,discount:800},7),null);
});
test('Configurator 2: pricing rounds individual cost lines and commission to cents',()=>{
 assert.deepEqual(manualTotals({...cost,flight:1000.004,makkah:1100.006,commission:1,discount:0.01},3),{totalUsd:3333,perPilgrimUsd:1111});
});
