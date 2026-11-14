import {botConfigured} from '../core/lib/telegram-native.js';
// Schema readiness and operator attestation are distinct from live data parity.
const required = {
  HOTELS_DB: {
    catalog:['hotels','hotel_price_cache','primary_hotels'],
    operations:['pilgrims','pilgrim_trips','iumrah_accounts','iumrah_account_sessions','business_staff_sessions','business_chat_threads','business_chat_messages','business_chat_attachments','trip_flights','payment_templates','booking_travelers','booking_payment_receipts','booking_travel_documents','booking_status_history','booking_tombstones','booking_number_sequence','booking_itinerary_items','booking_pricing_overrides','booking_esims','iumrah_security_submissions','iumrah_identity_confirmations','client_notification_devices','client_system_notifications','client_system_notification_reads'],
    accountSecurity:['iumrah_client_devices','iumrah_client_session_bindings','iumrah_client_apple_links','iumrah_client_apple_assertions','iumrah_client_google_links','iumrah_client_google_assertions','iumrah_client_account_emails','iumrah_client_email_challenges','iumrah_client_account_phones','iumrah_client_sms_challenges','iumrah_client_security_audit','iumrah_client_security_proofs'],
    gifts:['iumrah_friends_gifts','iumrah_friends_redemptions','iumrah_friends_credit_ledger'],
    careAndEmail:['iumrah_care_package_requests','iumrah_guest_booking_email_challenges','iumrah_guest_booking_phone_challenges','iumrah_booking_email_subscriptions']},
  BOOKINGS_DB: {bookingStore:['bookings','booking_events','booking_documents','chat_threads','chat_messages','telegram_booking_consents','booking_telegram_subscriptions','booking_telegram_outbox','booking_telegram_links']},
  FLIGHTS_DB: {flightCatalog:['flights','flight_offers']}
};
const bindings=['HOTELS_DB','BOOKINGS_DB','FLIGHTS_DB','HOTELS_MEDIA','PASSPORTS','IUMRAH_SESSION_SECRET','IUMRAH_SUPERADMIN_PASSWORD','PACKAGE_QUOTE_SEAL_KEY'];
export const migrationAttested = env => /^v21:[a-f0-9]{64}$/.test(env.IUMRAH_CORE_PARITY_ATTESTATION || '');
export const cleanLaunchAttested = env => /^[a-f0-9]{64}$/.test(env.IUMRAH_CORE_RESOURCE_FINGERPRINT||'') && env.IUMRAH_CORE_CLEAN_ATTESTATION==='v22-clean:'+env.IUMRAH_CORE_RESOURCE_FINGERPRINT;
export const activationAttested = env => migrationAttested(env)||cleanLaunchAttested(env);
export function securityConfigurationReady(env) {
  const session=env.IUMRAH_SESSION_SECRET, password=env.IUMRAH_SUPERADMIN_PASSWORD, quote=env.PACKAGE_QUOTE_SEAL_KEY;
  if(typeof session!=='string'||session.trim().length<32||typeof password!=='string'||password.trim().length<16||typeof quote!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(quote))return false;
  try{return atob(quote.replace(/-/g,'+').replace(/_/g,'/')+'=').length===32;}catch{return false;}
}
export function coreReady(env,core) {
  return !!core && env.IUMRAH_CORE_CUTOVER_READY === '1' && activationAttested(env) && (!cleanLaunchAttested(env)||securityConfigurationReady(env)) && bindings.every(key=>!!env[key]);
}
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
  for (const binding of bindings) if (!env[binding]) missing.push(binding);
  if (env.IUMRAH_CORE_CUTOVER_READY !== '1') missing.push('IUMRAH_CORE_CUTOVER_READY');
  if (!activationAttested(env)) missing.push('IUMRAH_CORE_PARITY_ATTESTATION','IUMRAH_CORE_CLEAN_ATTESTATION');
  if(!migrationAttested(env)&&!securityConfigurationReady(env))missing.push('CORE_SECURITY_CONFIGURATION_INVALID');
  const has=(...keys)=>keys.every(key=>typeof env[key]==='string'&&env[key].trim().length>0);
  const providers={
    sms:has('DEVSMS_API_TOKEN'), email:has('RESEND_API_KEY'),
    apple:has('APPLE_BUNDLE_ID'), google:has('GOOGLE_SERVER_CLIENT_ID'),
    wallet:has('WALLET_PASS_TYPE_ID','WALLET_TEAM_ID','WALLET_CERT_PEM','WALLET_KEY_PEM','WALLET_WWDR_CERT_PEM'),
    push:has('APNS_PRIVATE_KEY','APNS_KEY_ID','APPLE_TEAM_ID'),
    telegram:botConfigured(env)&&has('IUMRAH_SESSION_SECRET')&&env.IUMRAH_SESSION_SECRET.trim().length>=32,
    esim:has('ESIM_ACCESS_CODE','ESIM_ACCESS_SECRET'),
    telegramOAuth:has('TELEGRAM_LOGIN_CLIENT_ID')&&botConfigured(env)
  };
  const schemaReady=Object.values(readiness).every(Boolean);
  const optionalProviders=['esim','telegramOAuth'];
  const requiredProviderGaps=Object.entries(providers).filter(([name,ready])=>!optionalProviders.includes(name)&&!ready).map(([name])=>name);
  const providerConfigurationReady=requiredProviderGaps.length===0;
  return {ok:true, missing, service:'iumrah-backend', readiness, schemaReady, providers, optionalProviders, requiredProviderGaps, providerConfigurationReady, coreHandlersInstalled:installed,coreCutoverEnabled:enabled, migrationAttested:migrationAttested(env),cleanLaunchAttested:cleanLaunchAttested(env),activationAttested:activationAttested(env),cleanLaunchSupported:true,securityConfigurationReady:securityConfigurationReady(env),activationMode:migrationAttested(env)?'legacy-migration':cleanLaunchAttested(env)?'new-account':'pending',dataParityVerified:false, legacyRetirementAllowed:false};
}
