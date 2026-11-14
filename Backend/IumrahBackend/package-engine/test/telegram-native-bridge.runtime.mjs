import test from 'node:test';import assert from 'node:assert/strict';import worker from '../.runtime-dist/index.js';
const id='IUM-2026-ABCDEFG',base='https://iumrah-backend.helloiumrah.workers.dev';
test('existing iOS Telegram contracts forward only through the in-process unified core, not the obsolete bot Worker',async()=>{
 const requests=[];const env={IUMRAH_CORE_FETCH:async(url,init)=>{requests.push(new Request(url,init));return Response.json({ok:true,linked:false,linkUrl:'https://t.me/iumrah_test_bot?start=fixture'});}};
 const r=await worker.fetch(new Request(base+'/api/package/booking/'+id+'/telegram-link',{method:'POST',headers:{'x-booking-token':'x'.repeat(32),'content-type':'application/json'},body:JSON.stringify({language:'uz'})}),env);
 assert.equal(r.status,200);assert.equal(requests[0].url,base+'/api/telegram/link');assert.equal(requests[0].headers.get('x-booking-token'),'x'.repeat(32));assert.deepEqual(await requests[0].json(),{bookingId:id,language:'uz'});
 const s=await worker.fetch(new Request(base+'/api/package/booking/'+id+'/telegram-status',{headers:{authorization:'Bearer account-fixture'}}),env);assert.equal(s.status,200);assert.equal(requests[1].url,base+'/api/telegram/link?bookingId='+id);assert.equal(requests[1].headers.get('authorization'),'Bearer account-fixture');
 assert.equal((await worker.fetch(new Request(base+'/api/package/booking/'+id+'/telegram-status'),{TELEGRAM_BOT_ORIGIN:'https://old.example'})).status,503);
});
