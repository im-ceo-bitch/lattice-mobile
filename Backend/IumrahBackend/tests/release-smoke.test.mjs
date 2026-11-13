import test from 'node:test';
import assert from 'node:assert/strict';
import {releaseSmoke} from '../scripts/release-smoke.mjs';
const env={SMOKE_DEDICATED_TEST_ACCOUNT:'1',SMOKE_TEST_IDENTIFIER:'test@example.test',SMOKE_TEST_PASSWORD:'test-password',SMOKE_EXPECTED_IUMRAH_ID:'000123',SMOKE_BOOKING_ID:'IUM-1234-ABCDEFG',SMOKE_BOOKING_TOKEN:'valid-fixture-token-1234567890',SMOKE_STAFF_LOGIN:'test-staff',SMOKE_STAFF_PASSWORD:'test-staff-password'};
function fixture(){let device,logout=0;const fake=async(url,opts)=>{assert.equal(new URL(url).hostname,'iumrah-backend.helloiumrah.workers.dev');assert.equal(opts.redirect,'error');const {pathname:p}=new URL(url);let data;
 if(p==='/__iumrah/health')data={service:'iumrah-backend',modules:{core:true,packages:true}};
 else if(p==='/__iumrah/cutover')data={coreCutoverEnabled:true,schemaReady:true,migrationAttested:true,providerConfigurationReady:true};
 else if(p==='/api/services/prayer')data={data:{timings:{Fajr:'1',Dhuhr:'2',Asr:'3',Maghrib:'4',Isha:'5'}}};
 else if(p==='/api/services/weather')data={properties:{timeseries:[{}]}};
 else if(p==='/api/services/fx')data=[{Ccy:'USD',Rate:'12 000'}];
 else if(p==='/api/services/advisor/translations')data=Array(170).fill({key:'t',value:'t'});
 else if(p==='/api/services/advisor/audio')data=[{key:'a',url:'/api/services/advisor/audio/ru/a'}];
 else if(p==='/api/services/advisor/audio/ru/a')return new Response(new Uint8Array(1024));
 else if(p==='/v1/public/flights')data={flights:[{}]};
 else if(p==='/api/package/client/account/login'){device=JSON.parse(opts.body).device;data={account:{iumrahID:'000123'},session:{token:'test-token'}};}
 else if(p==='/api/catalog/hotels/client/account/session'){if(!opts.headers.Authorization)return Response.json({}, {status:401});data={account:{iumrahID:'000123'}};}
 else if(p==='/api/catalog/hotels/client/account/logout'||p==='/api/auth/staff/logout'){logout++;data={ok:true};}
 else if(p==='/api/package/client/account/wallet-pass')return new Response(new Uint8Array([80,75]),{headers:{'content-type':'application/vnd.apple.pkpass'}});
 else if(p==='/api/package/client/account/security'||p==='/api/package/client/account/friends'){assert.equal(opts.headers['x-iumrah-device-id'],device.installationID);assert.equal(opts.headers['x-iumrah-device-secret'],device.secret);data={ok:true};}
 else if(p==='/api/package/client/account/public-card'||p==='/api/catalog/hotels/client/trips')data={ok:true};
 else if(p==='/api/bookings/'+env.SMOKE_BOOKING_ID){if(opts.headers['x-booking-token']!==env.SMOKE_BOOKING_TOKEN)return Response.json({}, {status:404});data={booking:{id:env.SMOKE_BOOKING_ID}};}
 else if(p==='/api/package/booking/'+env.SMOKE_BOOKING_ID+'/telegram-status')data={ok:true,linked:false};
 else if(p==='/api/auth/staff/login')return Response.json({}, {headers:{'set-cookie':'staff=test; Secure'}});
 else if(p==='/api/auth/staff/session'){assert.equal(opts.headers.cookie,'staff=test');data={authenticated:true};}
 else if(p==='/api/admin/bookings')data={bookings:[]};
 else throw Error('UNEXPECTED_ROUTE');return Response.json(data);};return {fake,logout:()=>logout};}
test('production smoke uses valid device credentials and revokes test session',async()=>{const f=fixture();const r=await releaseSmoke(env,f.fake);assert.ok(r.done.includes('Apple Wallet'));assert.ok(r.done.includes('migrated booking'));assert.equal(f.logout(),2);assert.equal(r.releaseReady,false);});
test('public-only checks do not authenticate or declare production ready',async()=>{const f=fixture();const r=await releaseSmoke({},f.fake,true);assert.equal(f.logout(),0);assert.equal(r.publicOnly,true);assert.equal(r.releaseReady,false);});
test('missing provider data blocks activation smoke before credentials used',async()=>{const f=fixture();await assert.rejects(releaseSmoke(env,(url,opts)=>url.includes('/api/services/fx')?Response.json([]):f.fake(url,opts)),/FX_DATA/);assert.equal(f.logout(),0);});
