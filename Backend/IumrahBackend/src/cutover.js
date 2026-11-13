// No writes, no private rows, no counts, no tokens. Presence of schema is not parity.
const required = {
  HOTELS_DB: {catalog:['hotels','hotel_price_cache','primary_hotels'], operations:['pilgrims','pilgrim_trips','iumrah_account_sessions','business_staff_sessions','business_chat_threads','trip_flights','payment_templates']},
  BOOKINGS_DB: {bookingStore:['bookings','booking_events','booking_documents','chat_threads','chat_messages']},
  FLIGHTS_DB: {flightCatalog:['flights','flight_offers']}
};
export async function cutoverStatus(env,installed=false,enabled=false) {
  const readiness = {};
  for (const [binding, groups] of Object.entries(required)) {
    try {
      if (!env[binding]) throw Error('missing binding');
      const result = await env[binding].prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
      const names = new Set((result.results || []).map(row=>row.name));
      for (const [group, tables] of Object.entries(groups)) readiness[group] = tables.every(table=>names.has(table));
    } catch { for (const group of Object.keys(groups)) readiness[group] = false; }
  }
  const missing = [];
  if (!installed) missing.push('coreHandlers');
  for (const binding of ['HOTELS_DB','BOOKINGS_DB','FLIGHTS_DB','PASSPORTS','IUMRAH_SESSION_SECRET','IUMRAH_SUPERADMIN_PASSWORD','PACKAGE_QUOTE_SEAL_KEY']) if (!env[binding]) missing.push(binding);
  if (env.IUMRAH_CORE_CUTOVER_READY !== '1') missing.push('IUMRAH_CORE_CUTOVER_READY');
  return {ok:true, missing, service:'iumrah-backend', readiness, coreHandlersInstalled:installed,coreCutoverEnabled:enabled, dataParityVerified:false, legacyRetirementAllowed:false};
}
