// iumrah Backend — single entry point, no duplicated hotel or flight business logic.
// Narrow, explicit routing prevents the backend from swallowing unrelated website APIs.
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
export function resolveBackendRoute(pathname) {
  if (pathname === '/__iumrah/health') return 'health';
  if (pathname === '/__iumrah/readiness') return 'readiness';
  if (pathname === '/') return 'root';
  if (matches(pathname, '/api/flight-hub') || matches(pathname, '/v1') || pathname === '/health') return 'flights';
  if (hotelPrefixes.some(prefix => matches(pathname, prefix))) return 'hotels';
  return 'missing';
}
const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: {'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}
});
export function createBackendRouter({hotels, flights}) {
  if (typeof hotels?.fetch !== 'function' || typeof flights?.fetch !== 'function') throw Error('BACKEND_HANDLERS_REQUIRED');
  return {
    async fetch(request, env, ctx) {
      const pathname = new URL(request.url).pathname;
      const route = resolveBackendRoute(pathname);
      if (route === 'flights') return flights.fetch(request, env, ctx);
      if (route === 'hotels') return hotels.fetch(request, env, ctx);
      if (route === 'root') return json({ok:true,service:'iumrah-backend',apiVersion:1});
      if (route === 'readiness') {
        // Read-only D1 schema probes. No user data, credentials, or SQL errors
        // are exposed. A binding can exist while its tables are still absent.
        const probes = [
          ['flights', env.FLIGHTS_DB, 'SELECT 1 FROM flights LIMIT 0'],
          ['flightOffers', env.FLIGHTS_DB, 'SELECT 1 FROM flight_offers LIMIT 0'],
          ['analyticsEvents', env.HOTELS_DB, 'SELECT 1 FROM intelligence_events LIMIT 0'],
          ['analyticsReports', env.HOTELS_DB, 'SELECT 1 FROM intelligence_reports LIMIT 0'],
          ['businessSessions', env.HOTELS_DB, 'SELECT 1 FROM business_staff_sessions LIMIT 0']
        ];
        const checks = {};
        for (const [name, database, sql] of probes) {
          try {
            if (!database?.prepare) { checks[name] = false; continue; }
            await database.prepare(sql).all();
            checks[name] = true;
          } catch { checks[name] = false; }
        }
        // BOOKINGS_DB schema migration is checked separately; presence alone
        // cannot be treated as successful customer data migration.
        checks.bookingsBinding = !!env.BOOKINGS_DB;
        const ready = Object.values(checks).every(Boolean);
        return json({ok:ready,service:'iumrah-backend',kind:'schema-readiness',checks},ready?200:503);
      }
      if (route === 'health') {
        const bindings = {
          HOTELS_DB: !!env.HOTELS_DB,
          BOOKINGS_DB: !!env.BOOKINGS_DB,
          FLIGHTS_DB: !!env.FLIGHTS_DB,
          HOTELS_MEDIA: !!env.HOTELS_MEDIA
        };
        const coreReady = bindings.HOTELS_DB && bindings.BOOKINGS_DB && bindings.FLIGHTS_DB;
        const fullyConfigured = coreReady && bindings.HOTELS_MEDIA;
        return json({ok:!!coreReady,status:fullyConfigured?'configured':'degraded',fullyConfigured:!!fullyConfigured,service:'iumrah-backend',bindings,kind:'binding-presence-only'},coreReady?200:503);
      }
      return json({ok:false,error:'NOT_FOUND'},404);
    },
    // Intentionally separate schedules, so a daily Gemini run never triggers
    // flight cleanup (and vice versa). Staging deployment has no cron triggers.
    async scheduled(controller, env, ctx) {
      const cron = String(controller?.cron || '');
      if (cron === '15 1 * * *') return flights.scheduled?.(controller,env,ctx);
      if (cron === '0 3 * * *') return hotels.scheduled?.(controller,env,ctx);
      console.warn('IUMRAH_BACKEND_UNKNOWN_CRON',cron);
    }
  };
}
