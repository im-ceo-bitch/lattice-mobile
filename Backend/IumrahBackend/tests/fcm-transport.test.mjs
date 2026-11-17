import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,verify} from 'node:crypto';
import {normalizeClientPushToken,clientPushProvider,fcmConfigured,fcmMessage,sendFCM,deliverClientPushRows} from '../../HotelsWorker/src/fcm.js';
const pair=generateKeyPairSync('rsa',{modulusLength:2048});
const credential={type:'service_account',project_id:'iumrah-fixture',client_email:'push@iumrah-fixture.iam.gserviceaccount.com',private_key:pair.privateKey.export({type:'pkcs8',format:'pem'}),private_key_id:'fixture'};
const env={FCM_SERVICE_ACCOUNT_JSON:JSON.stringify(credential)};
const token='AbCDeF1234567890:APA91bMixedCase_'+ 'X'.repeat(120);
test('APNs normalization remains compatible; FCM case and long token preserved; reject malformed input',()=>{
 assert.equal(normalizeClientPushToken('AA'.repeat(32)),'aa'.repeat(32));assert.equal(clientPushProvider('AA'.repeat(32)),'apns');
 assert.equal(normalizeClientPushToken(token),token);assert.equal(clientPushProvider(token),'fcm');
 assert.equal(normalizeClientPushToken(token+'Z'.repeat(500)),token+'Z'.repeat(500));
 for(const t of [null,123,'bad','a'.repeat(5000),token+'\n'+token,token+'/'])assert.equal(normalizeClientPushToken(t),null);
 assert.equal(fcmConfigured(env),true);assert.equal(fcmConfigured({FCM_SERVICE_ACCOUNT_JSON:'{}'}),false);
});
test('FCM v1 authenticates with signed JWT and delivers Android payload; caches OAuth token',async()=>{
 let oauth=0, messages=0;
 const fetcher=async(url,init)=>{
  if(url==='https://oauth2.googleapis.com/token'){
    oauth++;const [h,p,s]=init.body.get('assertion').split('.');const claims=JSON.parse(Buffer.from(p,'base64url'));
    assert.equal(claims.iss,credential.client_email);assert.equal(claims.aud,url);assert.equal(claims.scope,'https://www.googleapis.com/auth/firebase.messaging');assert.equal(claims.exp-claims.iat,3600);
    assert.ok(verify('RSA-SHA256',Buffer.from(`${h}.${p}`),pair.publicKey,Buffer.from(s,'base64url')));
    return Response.json({access_token:'mock-oauth',expires_in:3600});
  }
  messages++;assert.equal(url,'https://fcm.googleapis.com/v1/projects/iumrah-fixture/messages:send');assert.equal(init.headers.authorization,'Bearer mock-oauth');
  const {message}=JSON.parse(init.body);assert.equal(message.token,token);assert.equal(message.android.notification.channel_id,'iumrah_trip_updates');assert.equal(message.android.priority,'HIGH');assert.equal(message.data.type,'booking_status');assert.equal(message.data.bookingID,'1234');assert.equal(message.notification.title,'Status');
  return Response.json({name:'projects/iumrah-fixture/messages/1'});
 };
 for(let i=0;i<2;i++)assert.equal((await sendFCM(env,token,'Status','Paid',{type:'booking_status',bookingID:1234},fetcher)).ok,true);
 assert.equal(oauth,1);assert.equal(messages,2);
});
test('provider errors only disable definitively unregistered tokens; no raw response or secret logged',async()=>{
 for(const [code,status,disable] of [['UNREGISTERED',404,true],['INVALID_ARGUMENT',400,false],['SENDER_ID_MISMATCH',403,false],['UNAVAILABLE',503,false]]){
  const result=await sendFCM(env,token,'Title','Body',{},async()=>Response.json({error:{message:'sensitive text',details:[{'@type':'type.googleapis.com/google.firebase.fcm.v1.FcmError',errorCode:code}]}},{status}));
  assert.equal(result.disable,disable);assert.equal(result.error,`FCM_${status}_${code}`);
 }
 assert.equal((await sendFCM(env,token,'Title','Body',{},async()=>{throw Error('secret')})).error,'FCM_NETWORK_FAILED');
 assert.equal((await sendFCM({},token,'Title','Body')).error,'FCM_NOT_CONFIGURED');
});
test('401 refreshes access token once and retries message',async()=>{
 let auth=0,send=0;
 const result=await sendFCM(env,token,'Title','Body',{},async url=>{
  if(url==='https://oauth2.googleapis.com/token'){auth++;return Response.json({access_token:'new-token',expires_in:3600});}
  send++;return send===1?Response.json({}, {status:401}):Response.json({name:'ok'});
 });
 assert.equal(result.ok,true);assert.equal(auth,1);assert.equal(send,2);
});
test('mixed recipients route separately and a broken APNs transport does not prevent FCM',async()=>{
 const old=globalThis.fetch;const seen=[];const persisted=[];
 globalThis.fetch=async(url,init)=>{if(url==='https://oauth2.googleapis.com/token')return Response.json({access_token:'mock',expires_in:3600});seen.push(JSON.parse(init.body).message.token);return Response.json({name:'ok'});};
 try{
  const result=await deliverClientPushRows(env,[{device_token:'a'.repeat(64)},{device_token:token}],'Title','Body',{},async(d,r)=>persisted.push([d.device_token,r.ok]),async rows=>{assert.equal(rows.length,1);assert.equal(rows[0].device_token,'a'.repeat(64));throw Error('APNs failed')},true);
  assert.deepEqual(result,{ok:true,sent:1,total:2});assert.deepEqual(seen,[token]);assert.deepEqual(persisted,[[token,true]]);
 }finally{globalThis.fetch=old;}
});
