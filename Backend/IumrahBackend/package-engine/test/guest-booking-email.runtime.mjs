import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {handleGuestBookingEmail} from '../.runtime-dist/booking-email-verification.js';
import {sendBookingEmailStatus} from '../.runtime-dist/booking-email.js';
const hash=v=>createHash('sha256').update(v).digest('hex');
function fixture(){
  const id='IUM-2026-ABCDEFG',token='a'.repeat(50),state={challenges:new Map(),sub:null,trip:{status:'new',booking_number:1234},booking:{id,status:'new',access_token_hash:hash(token),payload_json:JSON.stringify({booking:{totalUsd:3250,perPilgrimUsd:1625,planId:'comfort',hotelNames:{makkah:'Test Makkah Hotel'},stay:{totalDays:7},input:{travelers:{adults:2}},pilgrimProfile:{firstName:'Ali',lastName:'Vali'}}})}};
  const hotels={prepare(sql){let a=[];return {bind(...x){a=x;return this},async first(){
    if(sql.includes('COUNT(*) AS count'))return {count:state.challenges.size};
    if(sql.includes('FROM iumrah_guest_booking_email_challenges WHERE id='))return state.challenges.get(a[0])??null;
    if(sql.includes('FROM iumrah_guest_booking_email_challenges WHERE verification_token_hash='))return [...state.challenges.values()].find(x=>x.verification_token_hash===a[0])??null;
    if(sql.includes('FROM iumrah_booking_email_subscriptions WHERE booking_id='))return state.sub;
    if(sql.includes('FROM pilgrim_trips'))return state.trip;
    return null;
  },async run(){
    if(sql.includes('INSERT INTO iumrah_guest_booking_email_challenges')){const [id,email,salt,code_hash,created_at,expires_at,ip_hash]=a;state.challenges.set(id,{id,email,salt,code_hash,created_at,expires_at,ip_hash,attempts:0,verified_at:null,consumed_at:null,booking_id:null});}
    if(sql.includes('SET attempts=attempts+1'))state.challenges.get(a[0]).attempts++;
    if(sql.includes('SET verified_at=')){let c=state.challenges.get(a[3]);Object.assign(c,{verified_at:a[0],verification_token_hash:a[1],proof_expires_at:a[2]});}
    if(sql.includes('INSERT INTO iumrah_booking_email_subscriptions'))state.sub={booking_id:a[0],email:a[1],locale:a[2],verified_at:a[3],last_sent_status:null,lease_until:null};
    if(sql.includes('SET consumed_at=COALESCE')){const c=[...state.challenges.values()].find(c=>c.verification_token_hash===a[2]);Object.assign(c,{consumed_at:a[0],booking_id:a[1]});}
    if(sql.includes('lease_token=?1,lease_until=?2')){if(state.sub.last_sent_status===a[4])return {success:true,meta:{changes:0}};state.sub.lease_token=a[0];return {success:true,meta:{changes:1}};}
    if(sql.includes('last_sent_status=?1'))state.sub.last_sent_status=a[0];
    return {success:true,meta:{changes:1}};
  }}}};
  const bookings={prepare(sql){let a=[];return {bind(...x){a=x;return this;},async first(){return a[0]===id&&(!sql.includes('access_token_hash')||a[1]===state.booking.access_token_hash)?state.booking:null;},async run(){if(sql.includes('UPDATE bookings SET payload_json'))state.booking.payload_json=a[0];return {success:true};}}}};
  return {id,token,state,env:{HOTELS_DB:hotels,BOOKINGS_DB:bookings,RESEND_API_KEY:'test',ACCOUNT_EMAIL_FROM:'security@iumrah.app'}};
}
async function call(env,path,body,token){const url=new URL(path,'https://iumrah.app');const headers={'content-type':'application/json'};if(token)headers['x-booking-token']=token;const r=await handleGuestBookingEmail(new Request(url,{method:'POST',headers,body:JSON.stringify(body)}),env,url);return {status:r.status,value:await r.json()};}
test('guest email OTP is independent of login, status mail is localized and only sent on change',async()=>{
  const old=globalThis.fetch,sent=[];globalThis.fetch=async(_url,options)=>{sent.push(JSON.parse(options.body));return Response.json({id:'email-1'});};
  try{
    const f=fixture();const first=await call(f.env,'/api/package/booking-contact/email/start',{email:'ali@example.com',locale:'uz-cyrl'});
    assert.equal(first.status,200);const code=sent[0].text.match(/\b\d{6}\b/)[0];
    const wrong=await call(f.env,'/api/package/booking-contact/email/confirm',{challengeID:first.value.challengeID,code:code==='000000'?'123456':'000000'});assert.equal(wrong.status,400);
    const conf=await call(f.env,'/api/package/booking-contact/email/confirm',{challengeID:first.value.challengeID,code});assert.equal(conf.status,200);
    const again=await call(f.env,'/api/package/booking-contact/email/confirm',{challengeID:first.value.challengeID,code});assert.equal(again.status,400);
    const noToken=await call(f.env,`/api/package/booking/${f.id}/verified-email`,{verificationToken:conf.value.verificationToken});assert.equal(noToken.status,401);
    const connected=await call(f.env,`/api/package/booking/${f.id}/verified-email`,{verificationToken:conf.value.verificationToken,locale:'uz-cyrl'},f.token);
    assert.equal(connected.status,200);assert.equal(sent.length,2);assert.match(sent[1].html,/#1234/);assert.match(sent[1].subject,/Умра учун аризангиз қабул қилинди/);assert.match(sent[1].html,/\$1,625/);
    assert.equal(await sendBookingEmailStatus(f.env,f.id),'skipped');
    for(const [status,title] of [['payment_pending','Мавжудлик'],['paid','Тўлов'],['documents_ready','Ҳужжатлар'],['in_trip','Сиз сафардасиз']]){f.state.trip.status=status;assert.equal(await sendBookingEmailStatus(f.env,f.id),'sent');assert.match(sent.at(-1).subject,new RegExp(title));}
    assert.equal(sent.length,6);
    assert.match(f.state.booking.payload_json,/emailVerifiedAt/);
  }finally{globalThis.fetch=old;}
});
