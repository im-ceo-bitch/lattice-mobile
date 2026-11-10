import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyIntelligenceBusinessSession } from '../src/intelligence-business-auth.js';

const token = 'test_login_device_token_abcdefghijklmnopqrstuvwxyz123';
const req = (deviceToken = token) => new Request('https://iumrah-backend.example/api/admin/hotels/intelligence', {
  headers: {cookie:'staff=private-login-cookie', 'x-iumrah-business-session':deviceToken}
});
const env={AUTH_SESSION_URL:'https://iumrah.app/api/auth/staff/session'};

test('verified first-party device session can access intelligence (not local D1)',async()=>{
  let called=0;
  const result=await verifyIntelligenceBusinessSession(req(),env,async(url,options)=>{
    called++;
    assert.equal(url,'https://iumrah.app/api/admin/hotels/security/sessions');
    assert.equal(options.headers.cookie,'staff=private-login-cookie');
    assert.equal(options.headers['x-iumrah-business-session'],token);
    assert.equal(options.redirect,'manual');
    return Response.json({ok:true,currentSessionID:'valid-session-id-123456789'});
  });
  assert.equal(called,1);
  assert.deepEqual(result,{ok:true,session:{session_id:'valid-session-id-123456789'}});
});

test('missing token cannot bypass Business device security',async()=>{
  const result=await verifyIntelligenceBusinessSession(req(''),env,()=>{throw Error('should never run');});
  assert.equal(result.status,401);
  assert.equal(result.error,'BUSINESS_SESSION_REQUIRED');
});

test('expired/revoked device session fails closed',async()=>{
  const result=await verifyIntelligenceBusinessSession(req(),env,async()=>Response.json({ok:false,error:'BUSINESS_SESSION_REQUIRED'},{status:401}));
  assert.equal(result.ok,false);assert.equal(result.status,401);
});

test('unavailable authority does not return success or leak credentials',async()=>{
  const result=await verifyIntelligenceBusinessSession(req(),env,async()=>{throw Error('upstream offline');});
  assert.deepEqual(result,{ok:false,status:503,error:'BUSINESS_SESSION_AUTHORITY_UNAVAILABLE'});
  assert.ok(!JSON.stringify(result).includes(token));
});

test('external auth domain is blocked from receiving secrets',async()=>{
  const result=await verifyIntelligenceBusinessSession(req(),{AUTH_SESSION_URL:'https://evil.example/session'},async()=>{throw Error('should never run');});
  assert.equal(result.ok,false);assert.equal(result.status,503);
});

test('upstream must return a recognized device session identifier',async()=>{
  const result=await verifyIntelligenceBusinessSession(req(),env,async()=>Response.json({ok:true,sessions:[]}));
  assert.equal(result.status,503);
  assert.equal(result.error,'BUSINESS_SESSION_AUTHORITY_INVALID_RESPONSE');
});
