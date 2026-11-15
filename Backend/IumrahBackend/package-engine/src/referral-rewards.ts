import type { D1Like } from './d1';
import type { Env } from './env';
import { formatIumrahID } from './public-identity';

const REWARD_USD = 100; // same amount as the existing Friends program
const origin = 'https://iumrah-backend.helloiumrah.workers.dev';
const codePattern = /^IUMR-[A-F0-9]{24}$/;
export const referralCode = (value: unknown) => typeof value === 'string' ? value.trim().toUpperCase() : '';
export function referralLanding(url: URL): Response {
  const code = referralCode(url.pathname.split('/').pop());
  if (!codePattern.test(code)) return new Response('Invalid invitation', {status:404});
  return new Response(`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>iumrah Friends</title><style>body{font:17px system-ui;margin:40px auto;padding:24px;max-width:440px;color:#111}a{display:block;background:#111;color:white;padding:16px;border-radius:16px;text-decoration:none;text-align:center;margin:16px 0}code{font-size:16px;overflow-wrap:anywhere}small{color:#666}</style><h1>iumrah Friends</h1><p>Вас пригласили в iumrah. Откройте приложение, чтобы зарегистрироваться по приглашению.</p><p>Ваш код: <code>${code}</code></p><a href="iumrahapp://referral/${code}">Открыть iumrah</a><a href="https://apps.apple.com/app/id6759577859">Загрузить приложение</a><small>После установки откройте эту ссылку повторно или введите код при регистрации.</small></html>`,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"}});
}
export async function ensureReferralCode(db:D1Like, owner:number) {
  const bytes=crypto.getRandomValues(new Uint8Array(12));
  const code='IUMR-'+Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('').toUpperCase();
  await db.prepare('INSERT OR IGNORE INTO iumrah_referral_codes(pilgrim_id,code,created_at) VALUES(?1,?2,?3)').bind(owner,code,new Date().toISOString()).run();
  const row=await db.prepare('SELECT code FROM iumrah_referral_codes WHERE pilgrim_id=?1').bind(owner).first<{code:string}>();
  if (!row) throw new Error('REFERRAL_CODE_UNAVAILABLE');
  return {code:row.code, url:`${origin}/ref/${row.code}`};
}
// Call ONLY after new, verified account credentials have been established.
// Never infer attribution from a login, device ID, IP or unverified contact.
export async function attributeNewAccount(request:Request, db:D1Like, invitee:number) {
  const code=referralCode(request.headers.get('x-iumrah-referral-code'));
  if (!codePattern.test(code)) return;
  // No self-referrals, no replacement of an existing attribution and no existing gift redemption.
  await db.prepare(`INSERT OR IGNORE INTO iumrah_referrals(invitee_id,referrer_id,created_at,reward_usd)
    SELECT ?1,c.pilgrim_id,?2,?3 FROM iumrah_referral_codes c
    WHERE c.code=?4 AND c.pilgrim_id<>?1
    AND NOT EXISTS(SELECT 1 FROM iumrah_friends_redemptions g WHERE g.redeemer_pilgrim_id=?1 AND g.status<>'cancelled')`)
    .bind(invitee,new Date().toISOString(),REWARD_USD,code).run();
}
// Both stores must agree on confirmed payment; a receipt submission is not payment.
export function isPaid(source:string, mirror:string, payment:string) {
  return ['PAID','BOOKING_CONFIRMED','DOCUMENTS_READY','READY_TO_TRAVEL','IN_TRIP','COMPLETED'].includes(source.toUpperCase())
    && ['booking_confirmed','ready_to_travel','in_trip','completed'].includes(mirror.toLowerCase())
    && !['refunded','refund','chargeback','cancelled','canceled','unpaid','failed'].includes(payment.trim().toLowerCase());
}
type Referral = {invitee_id:number; referrer_id:number; created_at:string; reward_usd:number; first_name:string; last_name:string; display_name:string};
type Trip = {booking_id:string; status:string; payment_status:string; created_at:string};
type Ledger = {id:string; booking_id:string|null; amount_usd:number; source_type:string; source_id:string; created_at:string};
export async function referralRows(env:Pick<Env,'HOTELS_DB'|'BOOKINGS_DB'>, owner:number) {
  const db=env.HOTELS_DB, bookings=env.BOOKINGS_DB;
  if (!db || !bookings) throw new Error('REFERRALS_DB_NOT_CONFIGURED');
  const rows=(await db.prepare(`SELECT r.*,p.first_name,p.last_name,p.display_name FROM iumrah_referrals r JOIN pilgrims p ON p.id=r.invitee_id WHERE r.referrer_id=?1 ORDER BY r.created_at DESC`).bind(owner).all<Referral>()).results??[];
  const output=[];
  for (const r of rows) {
    const key=String(r.invitee_id);
    const earned=await db.prepare(`SELECT * FROM iumrah_friends_credit_ledger WHERE source_type='referral_paid' AND source_id=?1`).bind(key).first<Ledger>();
    const trips=(await db.prepare(`SELECT booking_id,status,payment_status,created_at FROM pilgrim_trips WHERE pilgrim_id=?1 ORDER BY created_at ASC,booking_id ASC`).bind(r.invitee_id).all<Trip>()).results??[];
    let bookingID:string|null=null, status='registered';
    if (earned) {
      bookingID=earned.booking_id;
      const trip=trips.find(t=>t.booking_id===bookingID);
      const source=bookingID ? await bookings.prepare('SELECT status FROM bookings WHERE id=?1').bind(bookingID).first<{status:string}>():null;
      // Explicit cancellation/refund or deletion is terminal for this reward.
      if (!source || !trip || source.status.toUpperCase()==='CANCELLED' || trip.status==='cancelled' || ['refunded','refund','chargeback','cancelled','canceled'].includes(trip.payment_status.trim().toLowerCase())) {
        await db.prepare(`INSERT OR IGNORE INTO iumrah_friends_credit_ledger(id,pilgrim_id,amount_usd,source_type,source_id,booking_id,created_at) VALUES(?1,?2,?3,'referral_reversal',?4,?5,?6)`).bind(crypto.randomUUID(),owner,-Math.abs(earned.amount_usd),key,bookingID,new Date().toISOString()).run();
      }
      const reversal=await db.prepare(`SELECT id FROM iumrah_friends_credit_ledger WHERE source_type='referral_reversal' AND source_id=?1`).bind(key).first();
      status=reversal?'cancelled':'earned';
    } else {
      // The first eligible confirmed payment wins, even if an earlier request is unpaid.
      let candidate:Trip|null=null, paidCandidate:Trip|null=null, earlierPaid=false, cancelled=false;
      for (const trip of trips) {
        const source=await bookings.prepare('SELECT status FROM bookings WHERE id=?1').bind(trip.booking_id).first<{status:string}>();
        if (!source || source.status.toUpperCase()==='CANCELLED' || trip.status==='cancelled') {cancelled=true;continue;}
        const receipt=await db.prepare("SELECT reviewed_at,created_at FROM booking_payment_receipts WHERE booking_id=?1 AND review_status='approved' ORDER BY reviewed_at ASC LIMIT 1").bind(trip.booking_id).first<{reviewed_at:string|null;created_at:string}>();
        const paid=isPaid(source.status,trip.status,trip.payment_status||'') && Boolean(receipt);
        if (paid && (receipt?.reviewed_at || receipt?.created_at || '') < r.created_at) {earlierPaid=true;continue;}
        // A booking created before account activation may qualify if it is still unpaid.
        if (trip.created_at<r.created_at && isPaid(source.status,trip.status,trip.payment_status||'') && !paid) {earlierPaid=true;continue;}
        if (!candidate) candidate=trip;
        if (paid && !paidCandidate) paidCandidate=trip;
      }
      const selected=paidCandidate||candidate;
      if (earlierPaid) status='ineligible';
      else if (selected) {
        bookingID=selected.booking_id; status='pending';
        if (paidCandidate) {
          // Ledger unique(source_type,source_id) makes concurrent reads idempotent.
          // A legacy Gift Card reward and a referral-link reward cannot stack for one invitee.
          await db.prepare(`INSERT OR IGNORE INTO iumrah_friends_credit_ledger(id,pilgrim_id,amount_usd,source_type,source_id,booking_id,created_at)
            SELECT ?1,?2,?3,'referral_paid',?4,?5,?6 WHERE NOT EXISTS(SELECT 1 FROM iumrah_friends_redemptions WHERE redeemer_pilgrim_id=?7 AND status<>'cancelled')`).bind(crypto.randomUUID(),owner,r.reward_usd,key,bookingID,new Date().toISOString(),r.invitee_id).run();
          const actual=await db.prepare(`SELECT booking_id FROM iumrah_friends_credit_ledger WHERE source_type='referral_paid' AND source_id=?1`).bind(key).first<{booking_id:string}>();
          status=actual?'earned':'ineligible'; if(actual) bookingID=actual.booking_id;
        }
      } else if(cancelled) status='cancelled';
    }
    output.push({id:formatIumrahID(r.invitee_id), name:[r.first_name,r.last_name].filter(Boolean).join(' ')||r.display_name||'', status, rewardUsd:r.reward_usd, registeredAt:r.created_at});
  }
  return output;
}
export async function referralDashboard(env:Env, owner:number) {
  const db=env.HOTELS_DB!;
  const invitation=await ensureReferralCode(db,owner);
  const referrals=await referralRows(env,owner);
  const transactions=(await db.prepare(`SELECT id,amount_usd,source_type,created_at FROM iumrah_friends_credit_ledger WHERE pilgrim_id=?1 ORDER BY created_at DESC,id DESC LIMIT 100`).bind(owner).all<Ledger>()).results??[];
  const trips=(await db.prepare(`SELECT booking_id FROM pilgrim_trips WHERE pilgrim_id=?1 AND status='completed'`).bind(owner).all<{booking_id:string}>()).results??[];
  let completedTrips=0;
  for (const t of trips) {const s=await env.BOOKINGS_DB!.prepare('SELECT status FROM bookings WHERE id=?1').bind(t.booking_id).first<{status:string}>();if(s?.status.toUpperCase()==='COMPLETED') completedTrips++;}
  const paidReferrals=referrals.filter(r=>r.status==='earned').length;
  return { invitation, referrals, completedTrips, paidReferrals, tier:completedTrips>=3||paidReferrals>=7?'elite':completedTrips>=1||paidReferrals>=3?'plus':'member', transactions:transactions.map(t=>({id:t.id,amountUsd:t.amount_usd,type:t.source_type,createdAt:t.created_at})) };
}

// Called after the existing authorized Business status update has committed.
export async function syncReferralForBooking(env:Env, bookingID:string) {
  const db=env.HOTELS_DB; if(!db || !env.BOOKINGS_DB) return;
  const owners=(await db.prepare(`SELECT r.referrer_id AS owner FROM iumrah_referrals r JOIN pilgrim_trips t ON t.pilgrim_id=r.invitee_id WHERE t.booking_id=?1 UNION SELECT pilgrim_id AS owner FROM iumrah_friends_credit_ledger WHERE booking_id=?1 AND source_type='referral_paid'`).bind(bookingID).all<{owner:number}>()).results??[];
  for(const row of owners) await referralRows(env,row.owner);
  // Return unused credits only on explicitly cancelled, never-paid trips.
  // After a paid trip is refunded, a staff financial review is required.
  const source=await env.BOOKINGS_DB.prepare('SELECT status FROM bookings WHERE id=?1').bind(bookingID).first<{status:string}>();
  const trip=await db.prepare('SELECT status FROM pilgrim_trips WHERE booking_id=?1').bind(bookingID).first<{status:string}>();
  if (source?.status.toUpperCase()==='CANCELLED' && trip?.status==='cancelled') {
    const paid=await db.prepare("SELECT id FROM booking_payment_receipts WHERE booking_id=?1 AND review_status IN ('submitted','approved') LIMIT 1").bind(bookingID).first();
    const history=await db.prepare("SELECT id FROM booking_status_history WHERE booking_id=?1 AND lower(new_status) IN ('paid','booking_confirmed','documents_ready','ready_to_travel','in_trip','completed') LIMIT 1").bind(bookingID).first();
    if (!paid && !history) {
      await db.prepare(`INSERT OR IGNORE INTO iumrah_friends_credit_ledger(id,pilgrim_id,amount_usd,source_type,source_id,booking_id,created_at)
        SELECT 'refund-'||id,pilgrim_id,-amount_usd,'friends_credit_return',id,booking_id,?2 FROM iumrah_friends_credit_ledger WHERE booking_id=?1 AND source_type='friends_credit_spend' AND amount_usd<0`).bind(bookingID,new Date().toISOString()).run();
    }
  }
}
