import test from 'node:test';
import assert from 'node:assert/strict';
import {renderBookingEmail} from '../.runtime-dist/booking-email.js';
import {bookingEmailAvatarResponse} from '../.runtime-dist/booking-email-avatar.js';

const snapshot={bookingID:'IUM-2026-ABCDEFG',bookingNumber:'#0100',status:'new',priceConfirmed:false,
  payload:{booking:{planId:'comfort',totalUsd:3750,perPilgrimUsd:1875,
    pilgrimProfile:{firstName:'Test',lastName:'Pilgrim'},hotelNames:{makkah:'Hotel Makkah'},
    input:{startDate:'2026-11-14',endDate:'2026-11-17',travelers:{adults:2,children:0,infants:0}},
    stay:{totalDays:4,totalNights:3},flight:'Centrum Air · C6 321 / flynas · XY 633',
    generatorTrace:{outbound:{airline:'Centrum Air',flightNumbers:'C6 321',origin:'TAS',destination:'JED',
      departureAt:'2026-11-14T04:00:00Z',arrivalAt:'2026-11-14T09:00:00Z',stops:0,durationMinutes:420,
      segments:[{airline:'Centrum Air',airlineCode:'C6',flightNumber:'C6 321',origin:'TAS',destination:'JED'}]},
      inbound:{airline:'flynas',flightNumbers:'XY 633',origin:'JED',destination:'TAS',
        departureAt:'2026-11-17T10:00:00Z',arrivalAt:'2026-11-17T15:00:00Z',stops:0}}
  }}};

test('received request is never called confirmed while checking availability',()=>{
  for(const locale of ['ru','en','uz','uz-cyrl']){
    const mail=renderBookingEmail(snapshot,locale,'checking');
    assert.ok(!/подтверждено|has been confirmed/i.test(mail.subject));
    assert.match(mail.html,/#0100/);
    assert.match(mail.html,/\$3,750/);
    assert.match(mail.html,/\$1,875/);
    assert.match(mail.html,/4 (дня|days|kun|кун)/);
    assert.match(mail.html,/3 (ночи|nights|tun|тун)/);
    assert.ok(!mail.html.includes('>4</td>')); // duration is no longer bare "4"
    assert.match(mail.html,/C6 321/);
    assert.match(mail.html,/XY 633/);
    assert.match(mail.html,/TAS/);
    assert.match(mail.html,/JED/);
    assert.match(mail.html,/support@iumrah.app/);
    assert.match(mail.html,/https:\/\/iumrah.app\/booking/);
  }
});

test('airline times are converted from UTC to local airport time',()=>{
  const mail=renderBookingEmail(snapshot,'en','checking');
  // TAS is UTC+5, JED is UTC+3 in November.
  assert.match(mail.html,/>09:00</);
  assert.match(mail.html,/>12:00</);
  assert.match(mail.html,/>13:00</);
  assert.match(mail.html,/>20:00</);
});

test('support channels display only when configured and valid',()=>{
  const plain=renderBookingEmail(snapshot,'ru','checking');
  assert.doesNotMatch(plain.html,/href="tel:/);
  assert.doesNotMatch(plain.html,/href="https:\/\/t.me\//);
  const withContacts=renderBookingEmail(snapshot,'ru','checking',{
    phoneUZ:'+998 90 123 45 67',phoneSA:'+966 54 123 4567',telegram:'@iumrah_support',whatsapp:'+998 90 123 45 67'});
  assert.match(withContacts.html,/tel:\+998901234567/);
  assert.match(withContacts.html,/tel:\+966541234567/);
  assert.match(withContacts.html,/https:\/\/t.me\/iumrah_support/);
  assert.match(withContacts.html,/https:\/\/wa.me\/998901234567/);
  assert.match(withContacts.text,/https:\/\/t.me\/iumrah_support/);
  const malicious=renderBookingEmail(snapshot,'ru','checking',{telegram:'https://evil.example.com',phoneUZ:'"><script>alert(1)</script>'});
  assert.doesNotMatch(malicious.html,/evil\.example/);
  assert.doesNotMatch(malicious.html,/href="tel:/);
});

test('booking details are escaped and flights without itinerary show summary only',()=>{
  const input=structuredClone(snapshot);
  input.payload.booking.hotelNames.makkah='<img onerror=alert(1)>';
  input.payload.booking.generatorTrace=null;
  const mail=renderBookingEmail(input,'ru','checking');
  assert.doesNotMatch(mail.html,/<img onerror=/);
  assert.match(mail.html,/&lt;img onerror=alert\(1\)&gt;/);
  assert.match(mail.html,/Centrum Air/);
  assert.doesNotMatch(mail.html,/09:00/);
});

test('paid and ready stages use their own accurate headings',()=>{
  assert.match(renderBookingEmail(snapshot,'ru','available').subject,/Доступность подтверждена/);
  assert.match(renderBookingEmail(snapshot,'ru','paid').subject,/Оплата подтверждена/);
  assert.match(renderBookingEmail(snapshot,'ru','ready').subject,/Документы готовы/);
});

test('sender avatar endpoint returns an existing iumrah PNG asset',async()=>{
  const response=bookingEmailAvatarResponse();
  assert.equal(response.headers.get('content-type'),'image/png');
  const bytes=new Uint8Array(await response.arrayBuffer());
  assert.deepEqual([...bytes.slice(0,8)],[137,80,78,71,13,10,26,10]);
  assert.ok(bytes.byteLength>5000);
});
