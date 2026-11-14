import {botConfigured,telegramRetrySecret,notifyTelegramStatus} from '../core/lib/telegram-native.js';
import {runCore} from '../core/runtime.js';
import { cutoverStatus, coreReady } from './cutover.js';
import { publicServices } from './public-services.js';
// iumrah Backend — single entry point, no duplicated hotel or flight business logic.
// Narrow, explicit routing prevents the backend from swallowing unrelated website APIs.
const publicCoreReads = new Set(['/api/airports','/api/storefront/hotels','/api/storefront/primary-hotel','/api/storefront/hotel-detail','/api/storefront/hotel-rooms','/api/storefront/flight-recommendations','/api/flights/data']);
const corePrefixes = ['/api/account','/api/bookings','/api/admin/bookings','/api/admin/chats','/api/auth/staff','/api/chat','/api/telegram','/api/internal/telegram','/api/storefront','/api/airports','/api/flights/data','/api/generate','/api/reprice','/api/seo'];
const hotelPrefixes = [
  '/api/admin/hotels', '/api/catalog/hotels',
  '/api/admin/ziyarats', '/api/catalog/ziyarats', '/flights-feed',
  '/.well-known/oauth-protected-resource', '/.well-known/oauth-authorization-server'
];
function matches(path, prefix) {
  return path === prefix || path.startsWith(`${prefix}/`) || (
    prefix.startsWith('/.well-known/') && path.startsWith(prefix)
  );
}
// These routes exist in the migrated package module, but their state is still
// tied to legacy booking/account data. Do not publish mutations against an
// unverified D1 merely because a binding is present.
const pendingCorePackagePrefixes = [
  '/api/package/client/account', '/api/package/public/id', '/api/package/booking',
  '/api/package/booking-contact', '/api/package/quote', '/api/package/storefront/quote',
  '/api/package/care-requests', '/api/admin/package/booking', '/api/admin/package/care-requests'
];
export function isPendingCorePackage(pathname) {
  return pendingCorePackagePrefixes.some(prefix=>matches(pathname,prefix));
}
export function isPendingHotelOperation(pathname) {
  // HotelsWorker also handles private operations, not just the public catalogue.
  // Decode segments as its pathParts implementation does, including escaped aliases.
  const prefixes=['/api/catalog/hotels','/api/admin/hotels'];
  const prefix=prefixes.find(p=>matches(pathname,p));if(!prefix)return false;
  let segment;try{segment=decodeURIComponent(pathname.slice(prefix.length).replace(/^\/+/, '').split('/')[0]);}catch{return true;}
  return prefix===prefixes[0]?segment==='client':['chats','push','security','operations'].includes(segment);
}
export function resolveBackendRoute(pathname) {
  if (pathname === '/__iumrah/health') return 'health';
  if (pathname === '/__iumrah/cutover') return 'cutover';
  if (pathname === '/') return 'root';
  if (matches(pathname, '/api/services')) return 'services';
  if (matches(pathname, '/api/flight-hub') || matches(pathname, '/v1') || pathname === '/health') return 'flights';
  if (matches(pathname, '/api/package') || matches(pathname, '/api/admin/package') || pathname === '/.well-known/apple-app-site-association' || /^\/(?:hotel|h)\/[^/]+$/.test(pathname)) return 'packages';
  if (corePrefixes.some(prefix=>matches(pathname,prefix))) return 'core';
  if (hotelPrefixes.some(prefix => matches(pathname, prefix))) return 'hotels';
  return 'missing';
}
const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: {'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}
});
export function createBackendRouter({hotels, flights, packages, core, requestAeroDataBox, aeroDataBoxConfiguration, verifyBookingQuote, sendBookingEmailStatus, retryBookingStatusEmails}) {
  if (typeof hotels?.fetch !== 'function' || typeof flights?.fetch !== 'function') throw Error('BACKEND_HANDLERS_REQUIRED');
  const router = {
    async fetch(request, env, ctx) {
      const pathname = new URL(request.url).pathname;
      const route = resolveBackendRoute(pathname);
      if (route === 'services') return publicServices(request,fetch,env);
      if (!['GET','HEAD','OPTIONS'].includes(request.method)) {
        const origin=request.headers.get('origin');
        if (origin && !['https://iumrah.app','https://iumrah.uz','https://iumrah.us','https://iumrahproject.com','https://iumrah-backend.helloiumrah.workers.dev'].includes(origin)) return json({ok:false,error:'CROSS_ORIGIN_REQUEST'},403);
      }
      const sharedEnv = requestAeroDataBox ? {...env, IUMRAH_AERO_REQUEST: (endpoint) => requestAeroDataBox(env, endpoint)} : env;
      const ready = coreReady(env,core);
      // The operator activates this only after verifying D1/R2 parity and freezing old writes.
      const dispatch = (req) => router.fetch(req,env,ctx);
      const routedEnv = core ? {...sharedEnv,IUMRAH_BOOKING_EMAIL_NOTIFY: sendBookingEmailStatus ? (id)=>sendBookingEmailStatus(sharedEnv,id) : undefined, IUMRAH_TELEGRAM_NOTIFY: (id,status)=>runCore(sharedEnv,ctx,dispatch,()=>notifyTelegramStatus(sharedEnv,id,status)), IUMRAH_VERIFY_BOOKING_QUOTE: verifyBookingQuote ? (booking,proof)=>verifyBookingQuote(booking,proof,env) : undefined, IUMRAH_CORE_FETCH: (input,init)=>dispatch(new Request(input,init)), AUTH_SESSION_URL:'https://iumrah-backend.helloiumrah.workers.dev/api/auth/staff/session', BOOKINGS_ADMIN_URL:'https://iumrah-backend.helloiumrah.workers.dev/api/admin/bookings', BOOKINGS_PUBLIC_URL:'https://iumrah-backend.helloiumrah.workers.dev/api/bookings'} : sharedEnv;
      if (route === 'core') {
        if (!ready && !(core && request.method==='GET' && publicCoreReads.has(pathname))) return json({ok:false,error:'CORE_CUTOVER_PENDING'},503);
        return core.fetch(request,routedEnv,ctx,dispatch);
      }
      if (route === 'flights') return flights.fetch(request, routedEnv, ctx);
      if (route === 'hotels') {
        if (!ready && isPendingHotelOperation(pathname)) return json({ok:false,error:'CORE_CUTOVER_PENDING'},503);
        return hotels.fetch(request, routedEnv, ctx);
      }
      if (route === 'packages' && packages) {
        if (isPendingCorePackage(pathname) && !ready) return json({ok:false,error:'CORE_CUTOVER_PENDING'},503);
        return packages.fetch(request, routedEnv, ctx);
      }
      if (route === 'cutover') return request.method === 'GET' ? json(await cutoverStatus(env,!!core,ready)) : json({ok:false,error:'METHOD_NOT_ALLOWED'},405);
      if (route === 'root') return json({ok:true,service:'iumrah-backend',apiVersion:1});
      if (route === 'health') {
        const bindings = {
          HOTELS_DB: !!env.HOTELS_DB,
          BOOKINGS_DB: !!env.BOOKINGS_DB,
          FLIGHTS_DB: !!env.FLIGHTS_DB,
          HOTELS_MEDIA: !!env.HOTELS_MEDIA
        };
        const coreReady = bindings.HOTELS_DB && bindings.BOOKINGS_DB && bindings.FLIGHTS_DB;
        const fullyConfigured = coreReady && bindings.HOTELS_MEDIA;
        return json({ok:!!coreReady,status:fullyConfigured?'configured':'degraded',fullyConfigured:!!fullyConfigured,service:'iumrah-backend',bindings,modules:{hotels:true,flights:true,packages:!!packages,core:!!core,coreCutoverEnabled:ready},...(aeroDataBoxConfiguration ? aeroDataBoxConfiguration(env) : {}),kind:'binding-presence-only'},coreReady?200:503);
      }
      return json({ok:false,error:'NOT_FOUND'},404);
    },
    // Intentionally separate schedules, so a daily Gemini run never triggers
    // flight cleanup (and vice versa). Staging deployment has no cron triggers.
    async scheduled(controller, env, ctx) {
      const cron = String(controller?.cron || '');
      if (cron === '*/5 * * * *') {
        const date=new Date(controller.scheduledTime);
        if (!Number.isFinite(date.getTime())) return;
        const h=date.getUTCHours(),m=date.getUTCMinutes();
        const jobs=[];
        if (h===1 && m===15) jobs.push(()=>flights.scheduled?.(controller,env,ctx));
        if (h===3 && m===0) jobs.push(()=>hotels.scheduled?.(controller,env,ctx));
        if (packages && coreReady(env,core) && env.IUMRAH_PACKAGE_CRON_ENABLED==='1') jobs.push(()=>packages.scheduled?.(controller,env,ctx));
        else if(coreReady(env,core)&&env.RESEND_API_KEY&&retryBookingStatusEmails) jobs.push(()=>retryBookingStatusEmails(env));
        if (coreReady(env,core) && botConfigured(env)) jobs.push(async()=>{
          const secret=await telegramRetrySecret(env);if(!secret)throw Error('TELEGRAM_RETRY_SECURITY_NOT_READY');
          const res=await router.fetch(new Request('https://iumrah-backend.helloiumrah.workers.dev/api/internal/telegram/retry',{method:'POST',headers:{authorization:`Bearer ${secret}`}}),env,ctx);
          if(!res.ok)throw Error('TELEGRAM_RETRY_FAILED');
        });
        const outcomes=await Promise.allSettled(jobs.map(job=>Promise.resolve().then(job)));
        if(outcomes.some(x=>x.status==='rejected'))throw Error('UNIFIED_SCHEDULE_FAILED');
        return;
      }
      if (cron === '15 1 * * *') return flights.scheduled?.(controller,env,ctx);
      if (cron === '0 3 * * *') return hotels.scheduled?.(controller,env,ctx);
      console.warn('IUMRAH_BACKEND_UNKNOWN_CRON',cron);
    }
  };
  return router;
}
