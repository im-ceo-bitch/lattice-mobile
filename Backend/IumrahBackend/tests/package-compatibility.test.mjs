import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {createBackendRouter,resolveBackendRoute} from '../src/router.js';
import flightWorker from '../../FlightHubWorker/src/index.js';
const root=fileURLToPath(new URL('../',import.meta.url));
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'iumrah-package-test-'));
fs.writeFileSync(path.join(temp,'package.json'),'{"type":"commonjs"}');
try {execFileSync('tsc',['-p',path.join(root,'src/package-engine/tsconfig.json'),'--noEmit','false','--module','commonjs','--moduleResolution','node','--outDir',temp],{stdio:'inherit'});} catch(error) {fs.rmSync(temp,{recursive:true,force:true});throw error;}
const packageWorker=createRequire(import.meta.url)(path.join(temp,'index.js')).default;
process.on('exit',()=>fs.rmSync(temp,{recursive:true,force:true}));
const migration=fs.readFileSync(new URL('../migrations/0001_package_compatibility_additive.sql',import.meta.url),'utf8');
function wrap(db, writes){return {prepare(sql){const stmt=db.prepare(sql);let args=[];function bindings(){// D1 uses ?1 placeholders, node:sqlite represents them as named parameters.
 const numbered=[...sql.matchAll(/\?(\d+)/g)].map(m=>m[1]);
 return numbered.length?[Object.fromEntries([...new Set(numbered)].map(n=>['?'+n,args[Number(n)-1]]))]:args;}
 return {bind(...v){args=v;return this},async all(){return {results:stmt.all(...bindings()),success:true}},async first(){return stmt.get(...bindings())??null},async run(){writes.push(sql);return {success:true,meta:{changes:stmt.run(...bindings()).changes}}}};}};}
function fixture(){
 const h=new DatabaseSync(':memory:'),b=new DatabaseSync(':memory:');const writes=[];
 h.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE hotels(id TEXT PRIMARY KEY,status TEXT,city TEXT,stars INTEGER);
 CREATE TABLE hotel_price_cache(hotel_id TEXT,status TEXT,nightly_price_usd REAL,expires_at TEXT);
 CREATE TABLE pilgrims(id INTEGER PRIMARY KEY,email TEXT,phone TEXT,first_name TEXT,last_name TEXT,display_name TEXT,telegram TEXT,whatsapp TEXT);
 CREATE TABLE iumrah_accounts(pilgrim_id INTEGER PRIMARY KEY,password_hash TEXT,password_salt TEXT,password_iterations INTEGER,activated_at TEXT,password_updated_at TEXT,failed_attempts INTEGER DEFAULT 0,locked_until TEXT,last_login_at TEXT);
 CREATE TABLE iumrah_account_sessions(token_hash TEXT PRIMARY KEY,pilgrim_id INTEGER,expires_at TEXT,revoked_at TEXT,created_at TEXT,last_used_at TEXT);
 CREATE TABLE pilgrim_trips(pilgrim_id INTEGER,booking_id TEXT);
 INSERT INTO pilgrims VALUES(16,'fixture@example.invalid','', 'Test','Account','Test Account','','');
 INSERT INTO hotels VALUES('test-hotel','published','Makkah',5);
 INSERT INTO hotel_price_cache VALUES('test-hotel','fresh',100,'2099-12-31T00:00:00Z');`);
 b.exec(`CREATE TABLE bookings(id TEXT PRIMARY KEY,access_token_hash TEXT,payload_json TEXT); INSERT INTO bookings VALUES('existing-booking','fixture','{}');`);
 h.exec(migration);h.exec(migration);
 h.exec("INSERT INTO primary_hotels(city,star_category,position,hotel_id) VALUES('Makkah',5,1,'test-hotel')");
 return {h,b,writes,env:{HOTELS_DB:wrap(h,writes),BOOKINGS_DB:wrap(b,writes),FLIGHTS_DB:{}}};
}
const router=createBackendRouter({hotels:{fetch:async()=>Response.json({hotels:[]})},flights:flightWorker,packageEngine:packageWorker});
const req=(p,init)=>new Request('https://iumrah-backend.example.workers.dev'+p,init);
test('missing package route is now real, not an alias to binding health',async()=>{
 for(const p of ['/api/package/health','/api/package/client/account/login','/api/admin/package/flights/curated','/.well-known/apple-app-site-association','/h/test']) assert.equal(resolveBackendRoute(p),'package');
 assert.equal(resolveBackendRoute('/api/package-malicious'),'missing');
 const {h,b,env,writes}=fixture();
 const res=await router.fetch(req('/api/package/health'),env,{});const body=await res.json();
 assert.equal(res.status,200,JSON.stringify(body));assert.equal(body.databaseReadsVerified,true);assert.equal(body.accountsReady,true);assert.equal(body.primaryHotelConfigCount,1);
 assert.equal(writes.length,0,'public health must not write to D1');
 assert.equal(h.prepare('SELECT COUNT(*) AS count FROM pilgrims').get().count,1);assert.equal(b.prepare('SELECT COUNT(*) AS count FROM bookings').get().count,1);
 const missing=await router.fetch(req('/api/package/health'),{...env,BOOKINGS_DB:undefined},{});assert.equal(missing.status,503);
 b.exec('DROP TABLE bookings');const broken=await router.fetch(req('/api/package/health'),env,{});assert.equal(broken.status,503);h.close();b.close();
});
test('account route requires valid credentials; existing session identity is read from same HOTELS_DB',async()=>{
 const {h,b,env}=fixture();
 const unauth=await router.fetch(req('/api/package/client/account/public-card'),env,{});assert.equal(unauth.status,401);
 const login=await router.fetch(req('/api/package/client/account/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({identifier:'00000016',password:'bad'})}),env,{});assert.equal(login.status,401);
 const token='fixture-session-token-1234567890';const digest=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))).toString('hex');
 h.prepare('INSERT INTO iumrah_account_sessions(token_hash,pilgrim_id,expires_at) VALUES(?,?,?)').run(digest,16,'2099-12-31T00:00:00Z');
 const card=await router.fetch(req('/api/package/client/account/public-card',{headers:{authorization:'Bearer '+token}}),env,{});const data=await card.json();assert.equal(card.status,200,JSON.stringify(data));assert.equal(data.iumrahID,'00000016');
 const forbidden=await router.fetch(req('/api/admin/package/flights/curated'),env,{});assert.equal(forbidden.status,401);
 const aasa=await router.fetch(req('/.well-known/apple-app-site-association'),env,{});assert.equal(aasa.status,200);assert.ok((await aasa.json()).applinks);
 h.close();b.close();
});
test('auxiliary migration has only idempotent CREATE statements; no destructive legacy SQL',()=>{
 const stripped=migration.replace(/^\s*--[^\n]*/gm,'');
 for(const stmt of stripped.split(';').map(x=>x.trim()).filter(Boolean)) assert.match(stmt,/^CREATE (?:TABLE|(?:UNIQUE )?INDEX) IF NOT EXISTS\b/i);
});
