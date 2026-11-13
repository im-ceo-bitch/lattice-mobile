import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { handleGuestBookingPhone } from '../.runtime-dist/booking-contact-verification.js';

// Exercise actual bundled OTP handling against an in-memory D1-compatible mock,
// without sending an SMS or modifying any production database.
function mockEnvironment() {
  const challenges = new Map();
  const bookingID = 'IUM-2026-ABCDEFG';
  const otherBookingID = 'IUM-2026-HJKLMNP';
  const accessToken = 'booking-token-' + 'a'.repeat(45);
  const tokenHash = createHash('sha256').update(accessToken).digest('hex');
  const bookings = new Map([
    [bookingID, { id: bookingID, payload_json: JSON.stringify({ pilgrimProfile: { firstName: 'Ali', lastName: 'Vali' } }), access_token_hash: tokenHash }],
    [otherBookingID, { id: otherBookingID, payload_json: '{}', access_token_hash: tokenHash }],
  ]);
  const pilgrim = { id: 7, phone: '' };

  function prepared(kind) {
    return {
      prepare(query) {
        const args = [];
        return {
          bind(...values) { args.push(...values); return this; },
          async first() {
            if (query.includes('COUNT(*) AS attempts')) {
              const count = [...challenges.values()].filter(c => c.created_at > args[0] && (c.phone === args[1] || (c.ip_hash && c.ip_hash === args[2]))).length;
              return { attempts: count };
            }
            if (query.includes('FROM iumrah_guest_booking_phone_challenges WHERE id=')) {
              return challenges.get(args[0]) ?? null;
            }
            if (query.includes('FROM iumrah_guest_booking_phone_challenges WHERE verification_token_hash=')) {
              return [...challenges.values()].find(c => c.verification_token_hash === args[0]) ?? null;
            }
            if (query.includes('SELECT id, payload_json FROM bookings')) {
              const b = bookings.get(args[0]);
              return b && (args.length === 1 || args[1] === b.access_token_hash) ? b : null;
            }
            if (query.includes('SELECT pilgrim_id FROM pilgrim_trips')) return { pilgrim_id: pilgrim.id };
            return null;
          },
          async run() {
            if (kind === 'hotels' && query.includes('INSERT INTO iumrah_guest_booking_phone_challenges')) {
              const [id,phone,salt,code_hash,created_at,expires_at,ip_hash] = args;
              challenges.set(id,{id,phone,salt,code_hash,created_at,expires_at,ip_hash,attempts:0,verified_at:null,consumed_at:null,booking_id:null});
            } else if (kind === 'hotels' && query.includes('DELETE FROM iumrah_guest_booking_phone_challenges')) {
              challenges.delete(args[0]);
            } else if (kind === 'hotels' && query.includes('SET attempts=attempts+1')) {
              challenges.get(args[0]).attempts++;
            } else if (kind === 'hotels' && query.includes('SET verified_at=')) {
              const c = challenges.get(args[3]);
              if (c.verified_at) return { success: false };
              c.verified_at = args[0];c.verification_token_hash=args[1];c.proof_expires_at=args[2];
            } else if (kind === 'hotels' && query.includes('SET consumed_at=COALESCE')) {
              const c = [...challenges.values()].find(c=>c.verification_token_hash===args[2]);
              if (c && (!c.booking_id || c.booking_id===args[1])) {c.consumed_at ??= args[0];c.booking_id ??= args[1];}
            } else if (kind === 'hotels' && query.includes('UPDATE pilgrims SET phone=')) {
              if (!pilgrim.phone) pilgrim.phone=args[0];
            } else if (kind === 'bookings' && query.includes('UPDATE bookings SET payload_json')) {
              bookings.get(args[2]).payload_json=args[0];
            }
            return { success: true };
          },
        };
      }
    };
  }
  return { env: { HOTELS_DB: prepared('hotels'), BOOKINGS_DB: prepared('bookings'), DEVSMS_API_TOKEN: 'fake-sms-provider-key' },
    challenges, bookings, pilgrim, bookingID, otherBookingID, accessToken };
}

async function route(env, path, body, headers = {}) {
  const url = new URL(path, 'https://iumrah.app');
  const request = new Request(url, { method: 'POST', headers: {'content-type':'application/json',...headers}, body:JSON.stringify(body) });
  const response = await handleGuestBookingPhone(request, env, url);
  return { status:response.status, data:await response.json() };
}

test('guest booking phone OTP is one-time, does not register an account, binds to just one authorized booking', async () => {
  const oldFetch = globalThis.fetch;
  let sentCode = '';
  globalThis.fetch = async (_url, init) => {
    sentCode = JSON.parse(init.body).otp_code;
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  };
  try {
    const { env, bookings, bookingID, otherBookingID, pilgrim, accessToken } = mockEnvironment();
    const start = await route(env, '/api/package/booking-contact/sms/start', { phone: '+998901234567' });
    assert.equal(start.status,200);
    assert.match(start.data.challengeID, /^book-sms-/);
    assert.equal(start.data.verificationToken,undefined);
    assert.match(sentCode,/^\d{6}$/);

    const wrong = await route(env,'/api/package/booking-contact/sms/confirm',{challengeID:start.data.challengeID,code:'000000'===sentCode?'999999':'000000'});
    assert.equal(wrong.status,400);
    const confirm = await route(env,'/api/package/booking-contact/sms/confirm',{challengeID:start.data.challengeID,code:sentCode});
    assert.equal(confirm.status,200);
    assert.equal(confirm.data.phone,'+998901234567');
    assert.ok(confirm.data.verificationToken.length>=64);
    const repeat = await route(env,'/api/package/booking-contact/sms/confirm',{challengeID:start.data.challengeID,code:sentCode});
    assert.equal(repeat.status,400);

    const noProof = await route(env,`/api/package/booking/${bookingID}/verified-phone`,{verificationToken:confirm.data.verificationToken});
    assert.equal(noProof.status,404);
    const authorized = await route(env,`/api/package/booking/${bookingID}/verified-phone`,{verificationToken:confirm.data.verificationToken},{'x-booking-token':accessToken});
    assert.equal(authorized.status,200);
    assert.equal(JSON.parse(bookings.get(bookingID).payload_json).pilgrimProfile.phone,'+998901234567');
    assert.equal(pilgrim.phone,'+998901234567');
    const other = await route(env,`/api/package/booking/${otherBookingID}/verified-phone`,{verificationToken:confirm.data.verificationToken},{'x-booking-token':accessToken});
    assert.equal(other.status,400);
  } finally { globalThis.fetch = oldFetch; }
});
