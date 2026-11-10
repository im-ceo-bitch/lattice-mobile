import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {deriveServiceCredentials} from '../scripts/ci-secret-derivation.mjs';
import {createHmac} from 'node:crypto';

test('rotate v1 credentials and mask both before exporting for Actions',()=>{
 const id='a'.repeat(32);const token='b'.repeat(40);
 const previous=role=>createHmac('sha256',token).update(`iumrah-flight-hub:v1:${id}:${role}`).digest('hex');
 const next=deriveServiceCredentials(id,token);
 assert.notEqual(next.bot,previous('bot-ingest'));
 assert.notEqual(next.admin,previous('admin'));
 const dir=mkdtempSync(join(tmpdir(),'hub-test-'));const file=join(dir,'github_env');
 try{
  const p=spawnSync(process.execPath,['scripts/write-ci-service-keys.mjs'],{
   cwd:process.cwd(),encoding:'utf8',env:{...process.env,CLOUDFLARE_ACCOUNT_ID:id,CLOUDFLARE_API_TOKEN:token,GITHUB_ENV:file}});
  assert.equal(p.status,0,p.stderr);
  const lines=p.stdout.split('\n').filter(Boolean);
  assert.equal(lines[0],`::add-mask::${next.bot}`);
  assert.equal(lines[1],`::add-mask::${next.admin}`);
  const exported=readFileSync(file,'utf8');
  assert.match(exported,/FLIGHT_HUB_BOT_TOKEN=/);
  assert.match(exported,/FLIGHT_HUB_ADMIN_TOKEN=/);
  assert.ok(exported.includes(next.bot)&&exported.includes(next.admin));
 }finally{rmSync(dir,{recursive:true,force:true})}
});
