import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveServiceCredentials} from '../scripts/ci-secret-derivation.mjs';
const id='a'.repeat(32);const token='b'.repeat(40);
test('two stable domain separated credentials from two Cloudflare GitHub secrets',()=>{
 const a=deriveServiceCredentials(id,token);
 const b=deriveServiceCredentials(id,token);
 assert.deepEqual(a,b);assert.notEqual(a.bot,a.admin);
 assert.match(a.bot,/^[0-9a-f]{64}$/);
 assert.notEqual(a.bot,deriveServiceCredentials('c'.repeat(32),token).bot);
 assert.notEqual(a.bot,deriveServiceCredentials(id,'d'.repeat(40)).bot);
});
test('invalid Cloudflare config is rejected',()=>{
 assert.throws(()=>deriveServiceCredentials('bad',token));
 assert.throws(()=>deriveServiceCredentials(id,'short'));
});
