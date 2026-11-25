import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {parsePayload} from '../core/app/api/bookings/route.js';
import * as foundation from '../../HotelsWorker/src/booking-foundation.js';
import * as transport from '../../HotelsWorker/src/fcm.js';
const helpers={...foundation,...transport};
const base=new URL('../../HotelsWorker/',import.meta.url);
const src=readFileSync(new URL('src/index.js',base),'utf8').replace(/^import .*;\n/gm,'').replace('export default {','const worker = {').replace(/export (async function|class) /g,'$1 ').replace('export { sendStaffPush };','');
const api=new Function('WorkflowEntrypoint',...Object.keys(helpers),src+'\nreturn {publicTeam,updateBookingAssignments,bookingAssignmentDetail,clientBookingAssignmentDetail,saveGuideDetails};')(class {},...Object.values(helpers));
function fixture(){
 const db=new DatabaseSync(':memory:');
 db.exec(`CREATE TABLE team_members(id TEXT PRIMARY KEY,first_name TEXT,last_name TEXT,role_kind TEXT,role_title TEXT,public_slug TEXT,public_visible INTEGER,active INTEGER,is_owner INTEGER,sort_order INTEGER,created_at TEXT);
 CREATE TABLE pilgrim_trips(id TEXT,booking_id TEXT PRIMARY KEY,status TEXT,start_date TEXT,end_date TEXT,booking_snapshot_json TEXT);
 CREATE TABLE trip_assignments(booking_id TEXT PRIMARY KEY,makkah_hotel_id TEXT,madinah_hotel_id TEXT,guide_team_member_id TEXT,created_at TEXT,updated_at TEXT);
 INSERT INTO team_members VALUES('g','Real','Guide','guide','Guide','g',1,1,0,1,'2025-01-01'),('h','Other','Guide','guide','Guide','h',1,1,0,2,'2025-01-01'),('owner','Founder','','owner','Founder','owner',1,1,1,0,'2025-01-01'),('hidden','Hidden','','guide','Guide','hidden',0,1,0,3,'2025-01-01');
 INSERT INTO pilgrim_trips VALUES('1','a','booking_confirmed','2026-12-09','2026-12-16','{}'),('2','b','availability_check','2026-12-16','2026-12-20','{"customization":{"preferredGuideID":"g"}}');
 INSERT INTO trip_assignments VALUES('a',NULL,NULL,'g','','');`);
 db.exec(readFileSync(new URL('migrations/0044_business_intelligence.sql',base),'utf8'));
 const d1={prepare(sql){const s=db.prepare(sql);const wrap=v=>({first:async()=>s.get(...v)||null,all:async()=>({results:s.all(...v)}),run:async()=>({meta:{changes:Number(s.run(...v).changes)}})});return {...wrap([]),bind:(...v)=>wrap(v)}}};
 return {db,env:{HOTELS_DB:d1}};
}
const request=id=>new Request('https://test.local',{method:'POST',body:JSON.stringify({guideID:id})});
test('guide dates filter employees and never disclose another booking',async()=>{
 const {db,env}=fixture(); const url=new URL('https://test.local/api/catalog/hotels/team?guideStart=2026-12-16&guideEnd=2026-12-20');
 await api.saveGuideDetails(env,'g',{experienceYears:4,languages:['Uzbek','Russian'],introVideoURL:'https://example.org/guide.mp4'});
 const response=await api.publicTeam(env,[],url);const v=await response.json();
 assert.equal(response.headers.get('cache-control'),'no-store');assert.deepEqual(v.members.map(m=>[m.id,m.guideAvailable]),[['g',false],['h',true]]);
 assert.equal(v.members[0].experienceYears,4);assert.equal(v.members[0].languages[0],'Uzbek');assert.ok(!JSON.stringify(v).includes('bookingID'));
 url.searchParams.set('guideStart','2026-02-31');assert.equal((await api.publicTeam(env,[],url)).status,400); db.close();
});
test('client preference is not an assignment; same-day overlap is rejected at write',async()=>{
 const {db,env}=fixture(); const d=await api.bookingAssignmentDetail(env,'b');assert.equal(d.preferredGuideID,'g');assert.equal(d.preferredGuideName,'Real Guide');assert.equal(d.guideIsPrimary,true);assert.equal((await api.clientBookingAssignmentDetail(env,'b')).guide,null);
 const failed=await api.updateBookingAssignments(request('g'),env,'b',{login:'staff'});assert.equal(failed.status,409);assert.equal((await failed.json()).error,'GUIDE_BUSY_ON_DATES');
 assert.equal((await api.updateBookingAssignments(request('h'),env,'b',{login:'staff'})).status,200);assert.equal((await api.clientBookingAssignmentDetail(env,'b')).guide.id,'h');
 db.exec("UPDATE pilgrim_trips SET status='cancelled' WHERE booking_id='a'");assert.equal((await api.updateBookingAssignments(request('g'),env,'b',{login:'staff'})).status,200);db.close();
});
test('booking parser preserves preferred guide ID without changing price or old-client payloads',()=>{
 const raw={planId:'standard',totalUsd:1500,perPilgrimUsd:750,input:{from:'TAS',originCode:'TAS',arrivalAirportCode:'JED',startDate:'2026-12-09',endDate:'2026-12-16',flexibleDays:0,hotelPreference:'3',includeMadinah:false,travelers:{adults:2,children:0,infants:0,rooms:1}},route:{originCode:'TAS',outboundDestination:'JED',returnOrigin:'JED'},stay:{},customization:{accompaniment:true,guideMeetingPoint:'airport',preferredGuideID:'g'}};
 const result=parsePayload(raw);assert.equal(result.customization.preferredGuideID,'g');assert.equal(result.totalUsd,1500);assert.equal(result.customization.accompaniment,true);
 delete raw.customization.preferredGuideID;assert.equal(Object.hasOwn(parsePayload(raw).customization,'preferredGuideID'),false);
});
