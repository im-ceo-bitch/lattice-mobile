import test from 'node:test';
import assert from 'node:assert/strict';
import {advancePlan,conciergeIntent,conciergeAnswer,eventLines} from '../core/telegram/concierge.js';
import {handleUpdate} from '../core/telegram/mini-bot.js';
const now=new Date('2026-11-17T12:00:00Z');
test('Concierge understands four supported languages and keeps unknown questions out of automated actions',()=>{
 for(const [s,i] of [['Хочу совершить умру','plan'],['Is my visa ready?','visa'],['To‘lov qoldig‘i','payment'],['Менинг сафарим','trip'],['/trip@iumrah_bot','trip'],['hello','unknown']])assert.equal(conciergeIntent(s),i,s);
});
test('Concierge quote draft validates dates, travelers and contact without creating booking',()=>{
 let d={id:'test',step:'date'};assert.equal(advancePlan(d,'2026-02-30',now),null);assert.equal(advancePlan(d,'2026-11-16',now),null);
 d=advancePlan(d,'2026-12-01',now);d=advancePlan(d,'14',now);assert.equal(d.exactEndDate,'2026-12-15');assert.equal(advancePlan(d,'1 0 2 1',now),null);
 d=advancePlan(d,'2 0 0 1',now);assert.equal(advancePlan(d,'JED',now),null);d=advancePlan(d,'TAS',now);d=advancePlan(d,'Test Pilgrim',now);assert.equal(advancePlan(d,'123',now),null);d=advancePlan(d,'+998901234567',now);assert.equal(d.step,'confirm');assert.equal(d.adults,2);
});
test('Concierge never treats submitted receipts as paid and does not invent visa readiness',()=>{
 const bundle={checkout:{paymentReview:{dueCents:250000,paidCents:150000,satisfied:false},receipts:[{reviewStatus:'submitted'}],documentRequirements:[{kind:'visa',state:'preparing',ready:false},{kind:'visa',state:'published',ready:true},{kind:'ticket',ready:true} ]}};
 assert.match(conciergeAnswer('payment',bundle,'en'),/Balance: USD 1000\.00/);assert.match(conciergeAnswer('payment',bundle,'en'),/under review/);assert.doesNotMatch(conciergeAnswer('payment',bundle,'en'),/Payment confirmed\./);
 assert.match(conciergeAnswer('visa',bundle,'ru'),/Визы: 1\/2/);assert.match(conciergeAnswer('visa',bundle,'ru'),/На оформлении 1/);assert.match(conciergeAnswer('visa',{},'en'),/could not/);
});
test('Concierge schedule respects actual execution state and Saudi local day',()=>{
 const items=[{dateLocal:'2026-11-17',timeLocal:'08:00',title:'Delayed',executionState:'delayed'},{dateLocal:'2026-11-17',timeLocal:'09:00',title:'Finished',executionState:'completed'}];
 assert.equal(eventLines(items,'en',now).length,1);assert.match(eventLines(items,'en',now)[0],/Delayed/);assert.doesNotMatch(eventLines(items,'en',now)[0],/Finished/);
});
test('Concierge rejects group, mismatched identity and bot senders before data access',async()=>{
 for(const message of [{chat:{type:'group',id:5},from:{id:5}},{chat:{type:'private',id:7},from:{id:5}},{chat:{type:'private',id:5},from:{id:5,is_bot:true}}])await handleUpdate({}, {message:{...message,text:'Моя виза'}},'https://example.com');
});
