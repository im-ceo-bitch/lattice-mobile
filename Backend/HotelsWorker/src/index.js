import { obtainHotelPrice, propertyKey, safePropertyKey } from './hotel-price-source.js';
import { intelligenceAdmin, intelligenceIngest, runIntelligenceReport } from './intelligence.js';
import { verifyIntelligenceBusinessSession } from './intelligence-business-auth.js';
import { WorkflowEntrypoint } from 'cloudflare:workers';
import { handleZiyaratAdmin, handleZiyaratCatalog } from './ziyarats.js';
import { HOTEL_PRICE_TTL_MS, HOTEL_PRICE_RETRY_MS, normalizeImportedHotelPriceSnapshot, hotelPriceMoveNeedsConfirmation, hotelPriceCandidatesMatch, extractHotelPriceFromHTML, quoteContextFromProbeURL } from './hotel-price.js';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store'
};

const PUBLIC_CACHE_HEADERS = {
  'cache-control': 'public, max-age=60, s-maxage=300'
};

const BUSINESS_APP_BUNDLE_ID = 'com.iumrah.root';
const CLIENT_APP_BUNDLE_ID = 'com.iumrah.app';

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: corsHeaders(request)
        });
      }

      if (url.pathname.startsWith('/.well-known/oauth-protected-resource') || url.pathname === '/.well-known/oauth-authorization-server') {
        return withCors(await businessChatGPTHotelOAuthWellKnown(request, env, url), request);
      }

      if (url.pathname.startsWith('/api/admin/ziyarats')) {
        const staff = await requireStaff(request, env);
        if (!staff.ok) return staff.response;
        return withCors(await handleZiyaratAdmin(request, env, url, staff.user), request);
      }

      if (url.pathname.startsWith('/api/catalog/ziyarats')) {
        return withCors(await handleZiyaratCatalog(request, env, url), request);
      }

      if (url.pathname === '/api/catalog/hotels/intelligence/events') {
        return withCors(await intelligenceIngest(request, env), request);
      }

      if (url.pathname.startsWith('/api/admin/hotels')) {
        const registrationPath = url.pathname.replace(/\/+$/, '') === '/api/admin/hotels/security/sessions/register'
          && request.method === 'POST';
        const staff = await requireStaff(request, env, {
          allowSessionRegistration: registrationPath,
          intelligenceAuthority: url.pathname.startsWith('/api/admin/hotels/intelligence')
        });
        if (!staff.ok) return staff.response;
        return withCors(await handleAdmin(request, env, url, staff.user, staff.businessSession), request);
      }

      if (url.pathname.startsWith('/api/catalog/hotels')) {
        return withCors(await handleCatalog(request, env, url), request);
      }

      // Human-readable, persistent, public read-only mirror for monitoring agents.
      // This non-API HTML route avoids machine readers that suppress API JSON.
      if (url.pathname.startsWith('/flights-feed/')) {
        if (request.method !== 'GET' && request.method !== 'HEAD') return methodNotAllowed();
        return withCors(await publicBusinessFlightSyncStableFeed(env, url, request.method), request);
      }

      return json({ ok: false, error: 'NOT_FOUND' }, 404);
    } catch (error) {
      const requestPath = new URL(request.url).pathname;
      if (requestPath.startsWith('/api/admin/hotels/intelligence')) {
        const requestId = crypto.randomUUID();
        // Admin diagnostic correlation only; never expose SQL or private data to clients.
        console.error('INTELLIGENCE_UNHANDLED', requestId, String(error?.message || 'unknown').slice(0,250));
        return json({ ok: false, error: 'INTELLIGENCE_BACKEND_FAILURE', requestId }, 503);
      }
      console.error('HOTELS_API_UNHANDLED', error);
      return json({ ok: false, error: 'INTERNAL_ERROR' }, 500);
    }
  },

  // Cron is dedicated to iumrah Intelligence. Price monitoring remains manual.
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runIntelligenceReport(env).catch(error => {
      console.error('INTELLIGENCE_CRON_FAILED', String(error?.message || error));
    }));
  }
};

async function handleAdmin(request, env, url, user, businessSession = null) {
  const parts = pathParts(url.pathname, '/api/admin/hotels');

  if (parts[0] === 'intelligence') {
    return intelligenceAdmin(request, env, url, user);
  }

  if (parts.length === 0) {
    if (request.method === 'GET') {
      return listHotels(env, url, false);
    }
    if (request.method === 'POST') {
      return saveHotel(request, env, user);
    }
    return methodNotAllowed();
  }

  if (parts.length === 1 && parts[0] === 'health') {
    if (request.method !== 'GET') return methodNotAllowed();
    return health(env, true);
  }

  if (parts[0] === 'dedupe') {
    if (request.method !== 'POST' || parts.length !== 1) return methodNotAllowed();
    return checkDuplicateRequest(request, env);
  }

  if (parts[0] === 'source-rooms') {
    if (parts.length !== 1 || request.method !== 'POST') return methodNotAllowed();
    return recoverSourceRooms(request, env);
  }

  if (parts[0] === 'import-jobs') {
    if (parts.length === 1 && request.method === 'GET') return listImportJobs(env, url);
    if (parts.length === 1 && request.method === 'POST') return createImportJob(request, env, user);
    const jobID = safeID(parts[1]);
    if (!jobID) return json({ ok: false, error: 'INVALID_JOB_ID' }, 400);
    if (parts.length === 2 && request.method === 'GET') return importJobDetail(env, jobID);
    if (parts.length === 2 && request.method === 'DELETE') return deleteImportJob(env, jobID);
    if (parts.length === 3 && parts[2] === 'retry' && request.method === 'POST') return retryImportJob(env, jobID);
    if (parts.length === 3 && parts[2] === 'cancel' && request.method === 'POST') return cancelImportJob(env, jobID);
    return methodNotAllowed();
  }

  if (parts[0] === 'chats') {
    return handleBusinessChats(request, env, parts.slice(1), user);
  }

  if (parts[0] === 'push') {
    return handleBusinessPush(request, env, parts.slice(1), user, businessSession);
  }

  if (parts[0] === 'security') {
    return handleBusinessSecurity(request, env, parts.slice(1), user, businessSession);
  }

  if (parts[0] === 'operations') {
    return handleBusinessOperations(request, env, url, parts.slice(1), user, businessSession);
  }

  const hotelID = safeID(parts[0]);
  if (!hotelID) return json({ ok: false, error: 'INVALID_HOTEL_ID' }, 400);

  if (parts.length === 2 && parts[1] === 'price') {
    if (request.method === 'PUT') return setManualHotelPrice(request, env, hotelID, user);
    if (request.method === 'DELETE') return clearManualHotelPrice(env, hotelID);
    return methodNotAllowed();
  }

  if (parts.length === 3 && parts[1] === 'price' && parts[2] === 'refresh') {
    if (request.method !== 'POST') return methodNotAllowed();
    return refreshHotelPriceResponse(env, hotelID);
  }

  if (parts.length === 3 && parts[1] === 'price' && parts[2] === 'browser') {
    if (request.method !== 'PUT') return methodNotAllowed();
    return saveBrowserHotelPrice(request, env, hotelID);
  }

  if (parts.length === 1) {
    if (request.method === 'GET') return hotelDetail(env, hotelID, true, url);
    if (request.method === 'PATCH') return updateHotelAdmin(request, env, hotelID);
    if (request.method === 'DELETE') return deleteHotel(env, hotelID);
    return methodNotAllowed();
  }

  if (parts.length === 2 && parts[1] === 'images') {
    if (request.method === 'POST') return uploadHotelImage(request, env, hotelID);
    if (request.method === 'DELETE') return deleteAllHotelImages(env, hotelID);
    return methodNotAllowed();
  }

  if (parts.length === 3 && parts[1] === 'images') {
    if (request.method !== 'GET') return methodNotAllowed();
    return serveHotelImage(env, hotelID, parts[2], true);
  }

  return json({ ok: false, error: 'NOT_FOUND' }, 404);
}


async function handleBusinessChats(request, env, parts, user) {
  if (parts.length === 0 && request.method === 'GET') return listBusinessChatThreads(env);
  const bookingID = cleanText(parts[0], 180);
  if (!bookingID) return json({ ok: false, error: 'INVALID_BOOKING_ID' }, 400);
  if (parts.length === 1 && request.method === 'GET') return chatMessages(env, bookingID, true);
  if (parts.length === 2 && parts[1] === 'messages') {
    if (request.method === 'GET') return chatMessages(env, bookingID, true);
    if (request.method === 'POST') return sendChatMessage(request, env, bookingID, user);
  }
  if (parts.length === 2 && parts[1] === 'attachments' && request.method === 'POST') {
    return sendChatAttachment(request, env, bookingID, user, true);
  }
  if (parts.length === 3 && parts[1] === 'media' && request.method === 'GET') {
    return serveChatAttachment(env, bookingID, parts[2]);
  }
  if (parts.length === 2 && parts[1] === 'read' && request.method === 'POST') {
    await env.HOTELS_DB.batch([
      env.HOTELS_DB.prepare('UPDATE business_chat_messages SET read_by_staff=1 WHERE booking_id=?').bind(bookingID),
      env.HOTELS_DB.prepare('UPDATE business_chat_threads SET unread_for_staff=0, updated_at=? WHERE booking_id=?').bind(new Date().toISOString(), bookingID)
    ]);
    return json({ ok: true });
  }
  return methodNotAllowed();
}

async function listBusinessChatThreads(env) {
  const result = await env.HOTELS_DB.prepare(`
    SELECT booking_id, last_message_at, last_message_preview, last_sender_type, unread_for_staff, updated_at
    FROM business_chat_threads
    ORDER BY COALESCE(last_message_at, updated_at) DESC
    LIMIT 300
  `).all();
  return json({
    ok: true,
    threads: (result.results || []).map(row => ({
      bookingID: row.booking_id,
      lastMessageAt: row.last_message_at || row.updated_at,
      lastMessagePreview: row.last_message_preview || '',
      lastSenderType: row.last_sender_type || null,
      unreadForStaff: Number(row.unread_for_staff || 0) === 1
    }))
  });
}

async function chatMessages(env, bookingID, admin = true) {
  const result = await env.HOTELS_DB.prepare(`
    SELECT id, booking_id, sender_type, sender_name, body, created_at, read_by_staff, message_type, attachment_id
    FROM business_chat_messages WHERE booking_id=? ORDER BY created_at ASC LIMIT 500
  `).bind(bookingID).all();
  return json({
    ok: true,
    bookingID,
    messages: (result.results || []).map(row => mapChatMessage(row, admin))
  });
}

function mapChatMessage(row, admin = true) {
  const attachmentID = row.attachment_id || null;
  return {
    id: row.id,
    bookingID: row.booking_id,
    senderType: row.sender_type,
    senderName: row.sender_name || null,
    body: row.body || '',
    messageType: row.message_type || 'text',
    attachmentID,
    attachmentURL: attachmentID ? (admin ? `/api/admin/hotels/chats/${encodeURIComponent(row.booking_id)}/media/${encodeURIComponent(attachmentID)}` : `/api/catalog/hotels/client/chats/${encodeURIComponent(row.booking_id)}/media/${encodeURIComponent(attachmentID)}`) : null,
    createdAt: row.created_at,
    readByStaff: Number(row.read_by_staff || 0) === 1
  };
}

async function staffDisplayName(env, user) {
  const login = cleanText(user?.login, 180);
  if (login) {
    const row = await env.HOTELS_DB.prepare('SELECT first_name, last_name, role_title FROM team_members WHERE staff_login=? LIMIT 1').bind(login).first().catch(() => null);
    if (row) {
      const name = [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
      if (name) return safeHumanText(name, 160) || 'iumrah Business';
      if (row.role_title) return safeHumanText(row.role_title, 160) || 'iumrah Business';
    }
  }
  return safeHumanText(user?.displayName || user?.login || 'iumrah Business', 160) || 'iumrah Business';
}

async function sendChatMessage(request, env, bookingID, user) {
  const payload = await request.json().catch(() => null);
  const body = safeHumanText(payload?.body, 4000);
  if (!body) return json({ ok: false, error: 'EMPTY_MESSAGE' }, 400);
  const clientMessageID = safeID(payload?.clientMessageID) || null;
  if (clientMessageID) {
    const existing = await env.HOTELS_DB.prepare('SELECT id FROM business_chat_messages WHERE booking_id=? AND client_message_id=? LIMIT 1')
      .bind(bookingID, clientMessageID).first();
    if (existing?.id) return chatMessageDetail(env, existing.id, 200);
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const senderName = await staffDisplayName(env, user);
  await env.HOTELS_DB.batch([
    env.HOTELS_DB.prepare(`
      INSERT INTO business_chat_threads (booking_id, created_at, updated_at, last_message_at, last_message_preview, last_sender_type, unread_for_staff)
      VALUES (?, ?, ?, ?, ?, 'staff', 0)
      ON CONFLICT(booking_id) DO UPDATE SET updated_at=excluded.updated_at, last_message_at=excluded.last_message_at,
        last_message_preview=excluded.last_message_preview, last_sender_type='staff', unread_for_staff=0
    `).bind(bookingID, now, now, now, body.slice(0, 240)),
    env.HOTELS_DB.prepare(`
      INSERT INTO business_chat_messages (id, booking_id, sender_type, sender_name, body, created_at, read_by_staff, client_message_id)
      VALUES (?, ?, 'staff', ?, ?, ?, 1, ?)
    `).bind(id, bookingID, senderName, body, now, clientMessageID)
  ]);
  await sendClientPush(env, bookingID, 'iumrah Care', body.slice(0, 180), { type: 'chat_message', bookingID }).catch(() => {});
  return chatMessageDetail(env, id, 201);
}

async function chatMessageDetail(env, id, status = 200, admin = true) {
  const row = await env.HOTELS_DB.prepare('SELECT * FROM business_chat_messages WHERE id=?').bind(id).first();
  if (!row) return json({ ok: false, error: 'MESSAGE_NOT_FOUND' }, 404);
  return json({ ok: true, message: mapChatMessage(row, admin) }, status);
}

async function handleBusinessPush(request, env, parts, user, businessSession = null) {
  if (parts.length === 1 && parts[0] === 'devices' && request.method === 'POST') {
    const payload = await request.json().catch(() => null);
    const token = cleanText(payload?.deviceToken, 256)?.toLowerCase();
    if (!token || !/^[0-9a-f]{32,256}$/.test(token)) return json({ ok: false, error: 'INVALID_DEVICE_TOKEN' }, 400);
    const environment = payload?.environment === 'development' ? 'development' : 'production';
    const now = new Date().toISOString();
    await env.HOTELS_DB.prepare(`
      INSERT INTO business_push_devices (device_token, staff_login, environment, app_bundle_id, enabled, created_at, updated_at, last_error, installation_id)
      VALUES (?, ?, ?, ?, 1, ?, ?, NULL, ?)
      ON CONFLICT(device_token) DO UPDATE SET staff_login=excluded.staff_login, environment=excluded.environment,
        app_bundle_id=excluded.app_bundle_id, enabled=1, updated_at=excluded.updated_at, last_error=NULL,
        installation_id=excluded.installation_id
    `).bind(token, cleanText(user?.login, 180), environment, BUSINESS_APP_BUNDLE_ID, now, now, businessSession?.installation_id || null).run();
    return json({ ok: true, ready: apnsConfigured(env) });
  }
  if (parts.length === 1 && parts[0] === 'status' && request.method === 'GET') {
    const row = await env.HOTELS_DB.prepare('SELECT COUNT(*) AS count FROM business_push_devices WHERE enabled=1').first();
    return json({ ok: true, configured: apnsConfigured(env), devices: Number(row?.count || 0) });
  }
  return methodNotAllowed();
}

const BUSINESS_SESSION_TTL_MS = 180 * 24 * 60 * 60_000;

function businessSessionToken(request) {
  return cleanText(request.headers.get('x-iumrah-business-session'), 512);
}

function businessStaffLogin(user) {
  return cleanText(user?.login, 180)?.toLowerCase() || '';
}

function businessRequestLocation(request) {
  return {
    city: safeHumanText(request.cf?.city || '', 120) || '',
    countryCode: cleanText(request.cf?.country, 8)?.toUpperCase() || ''
  };
}

function businessDevicePayload(payload, request) {
  const location = businessRequestLocation(request);
  return {
    installationID: cleanText(payload?.installationID, 128),
    installationSecret: cleanText(payload?.installationSecret, 256),
    deviceName: safeHumanText(payload?.deviceName || '', 180) || '',
    deviceModel: safeHumanText(payload?.deviceModel || '', 120) || '',
    hardwareIdentifier: cleanText(payload?.hardwareIdentifier, 120) || '',
    platform: cleanText(payload?.platform, 32)?.toLowerCase() || 'ios',
    osName: safeHumanText(payload?.osName || 'iOS', 40) || 'iOS',
    osVersion: cleanText(payload?.osVersion, 40) || '',
    appVersion: cleanText(payload?.appVersion, 40) || '',
    appBuild: cleanText(payload?.appBuild, 40) || '',
    locale: cleanText(payload?.locale, 40) || '',
    timeZone: cleanText(payload?.timeZone, 80) || '',
    city: location.city,
    countryCode: location.countryCode
  };
}

function validBusinessInstallation(value) {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{16,128}$/.test(value);
}

function validBusinessInstallationSecret(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{32,256}$/.test(value);
}

function mapBusinessSession(row, currentSessionID = '') {
  const isPrimary = Number(row.is_primary || 0) === 1;
  const trusted = Number(row.trusted || 0) === 1;
  return {
    id: row.session_id,
    deviceID: row.device_id,
    deviceName: row.device_name || '',
    deviceModel: row.device_model || '',
    hardwareIdentifier: row.hardware_identifier || '',
    platform: row.platform || 'ios',
    osName: row.os_name || 'iOS',
    osVersion: row.os_version || '',
    appVersion: row.app_version || '',
    appBuild: row.app_build || '',
    locale: row.locale || '',
    timeZone: row.time_zone || '',
    city: row.city || '',
    countryCode: row.country_code || '',
    isCurrent: row.session_id === currentSessionID,
    isPrimary,
    trusted,
    trustLevel: isPrimary ? 'primary' : (trusted ? 'trusted' : 'new'),
    createdAt: row.session_created_at,
    lastActiveAt: row.session_last_seen_at,
    expiresAt: row.expires_at
  };
}

function mapBusinessSecurityLoginEvent(row, currentSessionID = '') {
  return {
    id: row.id,
    sessionID: row.session_id,
    deviceID: row.device_id,
    deviceName: row.device_name || '',
    deviceModel: row.device_model || '',
    platform: row.platform || 'ios',
    osName: row.os_name || '',
    osVersion: row.os_version || '',
    city: row.city || '',
    countryCode: row.country_code || '',
    createdAt: row.created_at,
    isCurrent: row.session_id === currentSessionID
  };
}

async function recordBusinessSecurityLoginEvent(env, staffLogin, sessionID, device, value, createdAt) {
  const id = crypto.randomUUID();
  await env.HOTELS_DB.prepare(`
    INSERT INTO business_security_login_events (
      id, staff_login, session_id, device_id, device_name, device_model, platform, os_name, os_version, city, country_code, created_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    id, staffLogin, sessionID, device.id, value.deviceName, value.deviceModel, value.platform,
    value.osName, value.osVersion, value.city, value.countryCode, createdAt
  ).run();
  return id;
}

async function listBusinessSecurityEvents(env, url, user, currentSession) {
  const requested = Number(url.searchParams.get('limit') || 8);
  const limit = Number.isFinite(requested) ? Math.max(1, Math.min(20, Math.trunc(requested))) : 8;
  const rows = await env.HOTELS_DB.prepare(`
    SELECT id, session_id, device_id, device_name, device_model, platform, os_name, os_version, city, country_code, created_at
    FROM business_security_login_events
    WHERE staff_login=?
    ORDER BY created_at DESC
    LIMIT ?
  `).bind(businessStaffLogin(user), limit).all();
  return json({
    ok: true,
    currentSessionID: currentSession.session_id,
    events: (rows.results || []).map(row => mapBusinessSecurityLoginEvent(row, currentSession.session_id))
  });
}

const BUSINESS_SESSION_SELECT = `
  SELECT
    s.id AS session_id,
    s.staff_login,
    s.device_id,
    s.created_at AS session_created_at,
    s.last_seen_at AS session_last_seen_at,
    s.expires_at,
    d.installation_id,
    d.device_name,
    d.device_model,
    d.hardware_identifier,
    d.platform,
    d.os_name,
    d.os_version,
    d.app_version,
    d.app_build,
    d.locale,
    d.time_zone,
    d.city,
    d.country_code,
    d.is_primary,
    d.trusted
  FROM business_staff_sessions s
  JOIN business_security_devices d ON d.id=s.device_id
`;

async function businessSessionForRequest(request, env, user) {
  const token = businessSessionToken(request);
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const staffLogin = businessStaffLogin(user);
  const now = new Date();
  const row = await env.HOTELS_DB.prepare(`${BUSINESS_SESSION_SELECT}
    WHERE s.token_hash=? AND s.staff_login=? AND s.revoked_at IS NULL AND s.expires_at>?
      AND d.revoked_at IS NULL
    LIMIT 1
  `).bind(tokenHash, staffLogin, now.toISOString()).first();
  if (!row) return null;

  const previous = Date.parse(row.session_last_seen_at || '');
  if (!Number.isFinite(previous) || now.getTime() - previous >= 60_000) {
    const seenAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + BUSINESS_SESSION_TTL_MS).toISOString();
    const location = businessRequestLocation(request);
    await env.HOTELS_DB.batch([
      env.HOTELS_DB.prepare('UPDATE business_staff_sessions SET last_seen_at=?, expires_at=? WHERE id=? AND revoked_at IS NULL')
        .bind(seenAt, expiresAt, row.session_id),
      env.HOTELS_DB.prepare('UPDATE business_security_devices SET last_seen_at=?, city=?, country_code=? WHERE id=? AND revoked_at IS NULL')
        .bind(seenAt, location.city, location.countryCode, row.device_id)
    ]).catch(() => {});
    row.session_last_seen_at = seenAt;
    row.expires_at = expiresAt;
    row.city = location.city || row.city;
    row.country_code = location.countryCode || row.country_code;
  }
  return { ...row, tokenHash };
}

async function requireBusinessSession(request, env, user) {
  const session = await businessSessionForRequest(request, env, user);
  if (session) return { ok: true, session };

  const staffLogin = businessStaffLogin(user);
  const row = await env.HOTELS_DB.prepare(`
    SELECT COUNT(*) AS count FROM business_security_devices
    WHERE staff_login=? AND revoked_at IS NULL
  `).bind(staffLogin).first().catch(() => null);

  // Backward-compatible rollout: the old application continues to work until
  // this account registers its first protected device. From that moment onward,
  // every admin call requires an active per-device credential.
  if (Number(row?.count || 0) === 0) return { ok: true, session: null, legacy: true };
  return { ok: false, response: json({ ok: false, error: 'BUSINESS_SESSION_REQUIRED' }, 401) };
}

async function registerBusinessSession(request, env, user) {
  const payload = await request.json().catch(() => null);
  if (!payload) return json({ ok: false, error: 'INVALID_JSON' }, 400);
  const value = businessDevicePayload(payload, request);
  if (!validBusinessInstallation(value.installationID) || !validBusinessInstallationSecret(value.installationSecret)) {
    return json({ ok: false, error: 'INVALID_DEVICE_IDENTITY' }, 400);
  }

  const staffLogin = businessStaffLogin(user);
  if (!staffLogin) return json({ ok: false, error: 'INVALID_STAFF_SESSION' }, 401);
  const reauthenticated = request.headers.get('x-iumrah-business-reauthenticated') === '1';
  const now = new Date();
  const nowISO = now.toISOString();
  const secretHash = await sha256Hex(value.installationSecret);
  let device = await env.HOTELS_DB.prepare(`
    SELECT * FROM business_security_devices WHERE staff_login=? AND installation_id=? LIMIT 1
  `).bind(staffLogin, value.installationID).first();
  let createdDevice = false;

  if (device) {
    if (!constantTimeEqual(device.installation_secret_hash, secretHash)) {
      return json({ ok: false, error: 'DEVICE_PROOF_INVALID' }, 403);
    }
    // Older builds permanently revoked the device row when the primary device
    // ended a session. A verified password login is now allowed to reactivate
    // that same installation; passive cookie restore is not.
    if (device.revoked_at && !reauthenticated) {
      return json({ ok: false, error: 'SESSION_REAUTH_REQUIRED' }, 401);
    }
    await env.HOTELS_DB.prepare(`
      UPDATE business_security_devices SET
        device_name=?, device_model=?, hardware_identifier=?, platform=?, os_name=?, os_version=?,
        app_version=?, app_build=?, locale=?, time_zone=?, city=?, country_code=?, last_seen_at=?,
        revoked_at=NULL, revoked_by_device_id=NULL
      WHERE id=?
    `).bind(
      value.deviceName, value.deviceModel, value.hardwareIdentifier, value.platform, value.osName,
      value.osVersion, value.appVersion, value.appBuild, value.locale, value.timeZone,
      value.city, value.countryCode, nowISO, device.id
    ).run();
    device = await env.HOTELS_DB.prepare('SELECT * FROM business_security_devices WHERE id=?').bind(device.id).first();
  } else {
    const primary = await env.HOTELS_DB.prepare(`
      SELECT id FROM business_security_devices WHERE staff_login=? AND is_primary=1 AND revoked_at IS NULL LIMIT 1
    `).bind(staffLogin).first();
    let isPrimary = primary ? 0 : 1;
    const deviceID = crypto.randomUUID();
    const insert = primaryValue => env.HOTELS_DB.prepare(`
      INSERT INTO business_security_devices (
        id, staff_login, installation_id, installation_secret_hash, device_name, device_model,
        hardware_identifier, platform, os_name, os_version, app_version, app_build, locale,
        time_zone, city, country_code, is_primary, trusted, created_at, last_seen_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      deviceID, staffLogin, value.installationID, secretHash, value.deviceName, value.deviceModel,
      value.hardwareIdentifier, value.platform, value.osName, value.osVersion, value.appVersion,
      value.appBuild, value.locale, value.timeZone, value.city, value.countryCode,
      primaryValue, primaryValue, nowISO, nowISO
    ).run();
    try {
      await insert(isPrimary);
    } catch (error) {
      if (!isPrimary) throw error;
      isPrimary = 0;
      await insert(0);
    }
    device = await env.HOTELS_DB.prepare('SELECT * FROM business_security_devices WHERE id=?').bind(deviceID).first();
    createdDevice = true;
  }

  const presented = await businessSessionForRequest(request, env, user);
  if (presented) {
    if (presented.device_id !== device.id) return json({ ok: false, error: 'SESSION_DEVICE_MISMATCH' }, 403);
    const current = mapBusinessSession(presented, presented.session_id);
    return json({ ok: true, sessionToken: null, currentSession: current });
  }

  const previousSession = await env.HOTELS_DB.prepare(`
    SELECT revoked_at, revocation_reason FROM business_staff_sessions
    WHERE device_id=? ORDER BY created_at DESC LIMIT 1
  `).bind(device.id).first();
  if (previousSession?.revoked_at && previousSession.revocation_reason === 'revoked_by_primary' && !reauthenticated) {
    return json({ ok: false, error: 'SESSION_REAUTH_REQUIRED' }, 401);
  }

  await env.HOTELS_DB.prepare(`
    UPDATE business_staff_sessions SET revoked_at=?, revocation_reason='replaced'
    WHERE device_id=? AND revoked_at IS NULL
  `).bind(nowISO, device.id).run();

  const token = randomToken(32);
  const tokenHash = await sha256Hex(token);
  const sessionID = crypto.randomUUID();
  const expiresAt = new Date(now.getTime() + BUSINESS_SESSION_TTL_MS).toISOString();
  await env.HOTELS_DB.prepare(`
    INSERT INTO business_staff_sessions (id,staff_login,device_id,token_hash,created_at,last_seen_at,expires_at)
    VALUES (?,?,?,?,?,?,?)
  `).bind(sessionID, staffLogin, device.id, tokenHash, nowISO, nowISO, expiresAt).run();

  const row = await env.HOTELS_DB.prepare(`${BUSINESS_SESSION_SELECT} WHERE s.id=? LIMIT 1`).bind(sessionID).first();
  const eventID = await recordBusinessSecurityLoginEvent(env, staffLogin, sessionID, device, value, nowISO)
    .catch(error => { console.error('SECURITY_EVENT_WRITE_FAILED', error); return ''; });
  const location = [value.city, value.countryCode].filter(Boolean).join(', ');
  const label = value.deviceModel || value.deviceName || 'Новое устройство';
  await sendBusinessSecurityPush(
    env,
    staffLogin,
    value.installationID,
    'Новый вход в iumrah Business',
    location ? `${label} · ${location}` : label,
    {
      type: 'security_new_session',
      eventID,
      sessionID,
      deviceName: label,
      platform: value.platform,
      osName: value.osName,
      osVersion: value.osVersion,
      city: value.city,
      countryCode: value.countryCode,
      occurredAt: nowISO
    }
  ).catch(error => console.error('SECURITY_PUSH_FAILED', error));
  return json({ ok: true, sessionToken: token, currentSession: mapBusinessSession(row, sessionID) }, 201);
}

async function listBusinessSessions(env, user, currentSession) {
  const now = new Date().toISOString();
  const rows = await env.HOTELS_DB.prepare(`${BUSINESS_SESSION_SELECT}
    WHERE s.staff_login=? AND s.revoked_at IS NULL AND s.expires_at>? AND d.revoked_at IS NULL
    ORDER BY d.is_primary DESC, (s.id=?) DESC, s.last_seen_at DESC
  `).bind(businessStaffLogin(user), now, currentSession.session_id).all();
  return json({
    ok: true,
    currentSessionID: currentSession.session_id,
    sessions: (rows.results || []).map(row => mapBusinessSession(row, currentSession.session_id)),
    inactivityDays: 180,
    policy: 'primary_only_revocation'
  });
}

async function revokeBusinessSession(env, user, currentSession, targetSessionID) {
  const staffLogin = businessStaffLogin(user);
  const target = await env.HOTELS_DB.prepare(`${BUSINESS_SESSION_SELECT}
    WHERE s.id=? AND s.staff_login=? AND s.revoked_at IS NULL AND d.revoked_at IS NULL LIMIT 1
  `).bind(targetSessionID, staffLogin).first();
  if (!target) return json({ ok: false, error: 'SESSION_NOT_FOUND' }, 404);
  const now = new Date().toISOString();

  if (target.session_id === currentSession.session_id) {
    await env.HOTELS_DB.batch([
      env.HOTELS_DB.prepare(`
        UPDATE business_staff_sessions SET revoked_at=?, revoked_by_session_id=?, revocation_reason='self_logout'
        WHERE id=? AND revoked_at IS NULL
      `).bind(now, currentSession.session_id, target.session_id),
      env.HOTELS_DB.prepare(`
        UPDATE business_push_devices SET enabled=0, updated_at=?
        WHERE LOWER(COALESCE(staff_login,''))=? AND installation_id=?
      `).bind(now, staffLogin, target.installation_id || '')
    ]);
    return json({ ok: true, signedOut: true });
  }

  if (Number(currentSession.is_primary || 0) !== 1) {
    return json({ ok: false, error: 'PRIMARY_SESSION_REQUIRED' }, 403);
  }
  if (Number(target.is_primary || 0) === 1) {
    return json({ ok: false, error: 'PRIMARY_SESSION_PROTECTED' }, 403);
  }

  await env.HOTELS_DB.batch([
    env.HOTELS_DB.prepare(`
      UPDATE business_staff_sessions SET revoked_at=?, revoked_by_session_id=?, revocation_reason='revoked_by_primary'
      WHERE id=? AND revoked_at IS NULL
    `).bind(now, currentSession.session_id, target.session_id),
    env.HOTELS_DB.prepare(`
      UPDATE business_push_devices SET enabled=0, updated_at=?
      WHERE LOWER(COALESCE(staff_login,''))=? AND installation_id=?
    `).bind(now, staffLogin, target.installation_id || '')
  ]);
  return json({ ok: true, signedOut: false });
}

async function revokeOtherBusinessSessions(env, user, currentSession) {
  if (Number(currentSession.is_primary || 0) !== 1) {
    return json({ ok: false, error: 'PRIMARY_SESSION_REQUIRED' }, 403);
  }
  const staffLogin = businessStaffLogin(user);
  const now = new Date().toISOString();
  await env.HOTELS_DB.batch([
    env.HOTELS_DB.prepare(`
      UPDATE business_staff_sessions SET revoked_at=?, revoked_by_session_id=?, revocation_reason='revoked_by_primary'
      WHERE staff_login=? AND id<>? AND revoked_at IS NULL
    `).bind(now, currentSession.session_id, staffLogin, currentSession.session_id),
    env.HOTELS_DB.prepare(`
      UPDATE business_push_devices SET enabled=0, updated_at=?
      WHERE LOWER(COALESCE(staff_login,''))=? AND (installation_id IS NULL OR installation_id<>?)
    `).bind(now, staffLogin, currentSession.installation_id || '')
  ]);
  return json({ ok: true });
}

async function approveBusinessDevice(env, user, currentSession, targetSessionID) {
  if (Number(currentSession.is_primary || 0) !== 1) {
    return json({ ok: false, error: 'PRIMARY_SESSION_REQUIRED' }, 403);
  }
  const target = await env.HOTELS_DB.prepare(`${BUSINESS_SESSION_SELECT}
    WHERE s.id=? AND s.staff_login=? AND s.revoked_at IS NULL AND d.revoked_at IS NULL LIMIT 1
  `).bind(targetSessionID, businessStaffLogin(user)).first();
  if (!target) return json({ ok: false, error: 'SESSION_NOT_FOUND' }, 404);
  if (Number(target.is_primary || 0) === 1) return json({ ok: true });
  const now = new Date().toISOString();
  await env.HOTELS_DB.prepare(`
    UPDATE business_security_devices SET trusted=1, approved_at=?, approved_by_device_id=?
    WHERE id=? AND revoked_at IS NULL
  `).bind(now, currentSession.device_id, target.device_id).run();
  return json({ ok: true });
}

async function handleBusinessSecurity(request, env, parts, user, currentSession) {
  if (parts[0] === 'events') {
    if (!currentSession) return json({ ok: false, error: 'BUSINESS_SESSION_REQUIRED' }, 401);
    if (parts.length === 1 && request.method === 'GET') return listBusinessSecurityEvents(env, new URL(request.url), user, currentSession);
    return methodNotAllowed();
  }
  if (parts[0] !== 'sessions') return json({ ok: false, error: 'NOT_FOUND' }, 404);
  if (parts.length === 2 && parts[1] === 'register' && request.method === 'POST') {
    return registerBusinessSession(request, env, user);
  }
  if (!currentSession) return json({ ok: false, error: 'BUSINESS_SESSION_REQUIRED' }, 401);
  if (parts.length === 1 && request.method === 'GET') return listBusinessSessions(env, user, currentSession);
  if (parts.length === 2 && parts[1] === 'current' && request.method === 'DELETE') {
    return revokeBusinessSession(env, user, currentSession, currentSession.session_id);
  }
  if (parts.length === 2 && parts[1] === 'others' && request.method === 'DELETE') {
    return revokeOtherBusinessSessions(env, user, currentSession);
  }
  const sessionID = safeID(parts[1]);
  if (!sessionID) return json({ ok: false, error: 'INVALID_SESSION_ID' }, 400);
  if (parts.length === 2 && request.method === 'DELETE') {
    return revokeBusinessSession(env, user, currentSession, sessionID);
  }
  if (parts.length === 3 && parts[2] === 'approve' && request.method === 'POST') {
    return approveBusinessDevice(env, user, currentSession, sessionID);
  }
  return methodNotAllowed();
}

async function sendBusinessSecurityPush(env, staffLogin, excludedInstallationID, title, body, data = {}) {
  if (!apnsConfigured(env)) return { ok: false, skipped: 'APNS_NOT_CONFIGURED' };
  const devices = await env.HOTELS_DB.prepare(`
    SELECT device_token, environment, COALESCE(NULLIF(app_bundle_id,''), 'com.iumrah.root') AS app_bundle_id
    FROM business_push_devices
    WHERE enabled=1 AND LOWER(COALESCE(staff_login,''))=?
      AND (installation_id IS NULL OR installation_id<>?)
    LIMIT 50
  `).bind(staffLogin, excludedInstallationID).all();
  return sendAPNsToRows(env, devices.results || [], title, body, data, async (device, result) => {
    const now = new Date().toISOString();
    if (result.ok) {
      await env.HOTELS_DB.prepare('UPDATE business_push_devices SET last_success_at=?, last_error=NULL, updated_at=? WHERE device_token=?')
        .bind(now, now, device.device_token).run().catch(() => {});
    } else if (result.response) {
      await env.HOTELS_DB.prepare('UPDATE business_push_devices SET enabled=?, last_error=?, updated_at=? WHERE device_token=?')
        .bind(result.disable ? 0 : 1, result.error.slice(0, 900), now, device.device_token).run().catch(() => {});
    }
  });
}

function apnsConfigured(env) {
  return !!(env.APNS_PRIVATE_KEY && env.APNS_KEY_ID && env.APPLE_TEAM_ID);
}

async function sendStaffPush(env, title, body, data = {}) {
  if (!apnsConfigured(env)) return { ok: false, skipped: 'APNS_NOT_CONFIGURED' };
  const devices = await env.HOTELS_DB.prepare(`
    SELECT device_token, environment, COALESCE(NULLIF(app_bundle_id,''), 'com.iumrah.root') AS app_bundle_id
    FROM business_push_devices WHERE enabled=1 LIMIT 100
  `).all();
  return sendAPNsToRows(env, devices.results || [], title, body, data, async (device, result) => {
    const now = new Date().toISOString();
    if (result.ok) {
      await env.HOTELS_DB.prepare('UPDATE business_push_devices SET last_success_at=?, last_error=NULL, updated_at=? WHERE device_token=?')
        .bind(now, now, device.device_token).run().catch(() => {});
    } else if (result.response) {
      await env.HOTELS_DB.prepare('UPDATE business_push_devices SET enabled=?, last_error=?, updated_at=? WHERE device_token=?')
        .bind(result.disable ? 0 : 1, result.error.slice(0, 900), now, device.device_token).run().catch(() => {});
    }
  });
}

async function sendClientPush(env, bookingID, title, body, data = {}) {
  if (!apnsConfigured(env)) return { ok: false, skipped: 'APNS_NOT_CONFIGURED' };
  const devices = await env.HOTELS_DB.prepare(`
    SELECT device_token, environment, app_bundle_id, locale
    FROM client_push_subscriptions
    WHERE booking_id=? AND enabled=1 AND app_bundle_id=?
    ORDER BY updated_at DESC LIMIT 50
  `).bind(bookingID, CLIENT_APP_BUNDLE_ID).all().catch(() => ({ results: [] }));
  return sendAPNsToRows(env, devices.results || [], title, body, { ...data, bookingID }, async (device, result) => {
    const now = new Date().toISOString();
    if (result.ok) {
      await env.HOTELS_DB.prepare('UPDATE client_push_subscriptions SET last_success_at=?, last_error=NULL, updated_at=? WHERE device_token=? AND booking_id=?')
        .bind(now, now, device.device_token, bookingID).run().catch(() => {});
    } else if (result.response) {
      await env.HOTELS_DB.prepare('UPDATE client_push_subscriptions SET enabled=?, last_error=?, updated_at=? WHERE device_token=? AND booking_id=?')
        .bind(result.disable ? 0 : 1, result.error.slice(0, 900), now, device.device_token, bookingID).run().catch(() => {});
    }
  }, CLIENT_APP_BUNDLE_ID);
}

async function sendAPNsToRows(env, rows, title, body, data, persistResult, fallbackTopic = BUSINESS_APP_BUNDLE_ID) {
  if (!rows.length) return { ok: false, skipped: 'NO_DEVICES' };
  const jwt = await apnsJWT(env);
  let sent = 0;
  for (const device of rows) {
    const base = device.environment === 'development' ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com';
    const topic = cleanText(device.app_bundle_id, 220) || fallbackTopic;
    const response = await fetch(`${base}/3/device/${device.device_token}`, {
      method: 'POST',
      headers: {
        authorization: `bearer ${jwt}`,
        'apns-topic': topic,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'apns-expiration': '0',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        aps: {
          alert: { title, body },
          sound: 'default',
          'thread-id': cleanText(data?.bookingID, 180) || 'iumrah'
        },
        ...data
      })
    }).catch(() => null);
    if (response?.ok) {
      sent += 1;
      await persistResult(device, { ok: true, response });
    } else if (response) {
      const text = await response.text().catch(() => '');
      const disable = response.status === 410 || /BadDeviceToken|Unregistered|DeviceTokenNotForTopic/i.test(text);
      await persistResult(device, { ok: false, response, disable, error: `${response.status}:${text}` });
    }
  }
  return { ok: sent > 0, sent, total: rows.length };
}

function clientNotificationCopy(localeRaw, type, value) {
  const locale = String(localeRaw || 'ru').toLowerCase();
  const lang = locale.startsWith('uz-cyrl') ? 'uz-cyrl' : locale.startsWith('uz') ? 'uz' : locale.startsWith('en') ? 'en' : 'ru';
  if (type === 'status') {
    const labels = {
      ru: { availability_check:'Новый пакет создан · Проверка наличия', payment_pending:'Наличие подтверждено · Оплата и данные паломников', booking_confirmed:'Оплачено · Бронирование подтверждено', ready_to_travel:'Документы готовы · Готово к поездке', in_trip:'Паломник в поездке', completed:'Поездка завершена', cancelled:'Отменено' },
      en: { availability_check:'New package created · Availability check', payment_pending:'Availability confirmed · Payment & pilgrim details', booking_confirmed:'Paid · Booking confirmed', ready_to_travel:'Documents ready · Ready to travel', in_trip:'Pilgrim in trip', completed:'Trip completed', cancelled:'Cancelled' },
      uz: { availability_check:'Yangi paket yaratildi · Mavjudlik tekshiruvi', payment_pending:'Mavjudlik tasdiqlandi · To‘lov va ziyoratchi ma’lumotlari', booking_confirmed:'To‘langan · Bron tasdiqlandi', ready_to_travel:'Hujjatlar tayyor · Safarga tayyor', in_trip:'Ziyoratchi safarda', completed:'Safar yakunlandi', cancelled:'Bekor qilindi' },
      'uz-cyrl': { availability_check:'Янги пакет яратилди · Мавжудлик текшируви', payment_pending:'Мавжудлик тасдиқланди · Тўлов ва зиёратчи маълумотлари', booking_confirmed:'Тўланган · Брон тасдиқланди', ready_to_travel:'Ҳужжатлар тайёр · Сафарга тайёр', in_trip:'Зиёратчи сафарда', completed:'Сафар якунланди', cancelled:'Бекор қилинди' }
    };
    const titles = { ru:'Статус поездки обновлён', en:'Trip status updated', uz:'Safar holati yangilandi', 'uz-cyrl':'Сафар ҳолати янгиланди' };
    return { title: titles[lang], body: labels[lang][value] || String(value || '') };
  }
  return { title: 'iumrah Care', body: String(value || '') };
}

async function sendClientStatusPush(env, bookingID, status) {
  if (!apnsConfigured(env)) return { ok: false, skipped: 'APNS_NOT_CONFIGURED' };
  const devices = await env.HOTELS_DB.prepare(`
    SELECT device_token, environment, app_bundle_id, locale
    FROM client_push_subscriptions WHERE booking_id=? AND enabled=1 AND app_bundle_id=?
    ORDER BY updated_at DESC LIMIT 50
  `).bind(bookingID, CLIENT_APP_BUNDLE_ID).all().catch(() => ({ results: [] }));
  const groups = new Map();
  for (const device of devices.results || []) {
    const copy = clientNotificationCopy(device.locale, 'status', status);
    const key = `${copy.title}\n${copy.body}`;
    if (!groups.has(key)) groups.set(key, { copy, rows: [] });
    groups.get(key).rows.push(device);
  }
  let sent = 0;
  let total = 0;
  for (const { copy, rows } of groups.values()) {
    const result = await sendAPNsToRows(env, rows, copy.title, copy.body, { type: 'booking_status', bookingID, status }, async (device, delivery) => {
      const now = new Date().toISOString();
      if (delivery.ok) {
        await env.HOTELS_DB.prepare('UPDATE client_push_subscriptions SET last_success_at=?, last_error=NULL, updated_at=? WHERE device_token=? AND booking_id=?')
          .bind(now, now, device.device_token, bookingID).run().catch(() => {});
      } else if (delivery.response) {
        await env.HOTELS_DB.prepare('UPDATE client_push_subscriptions SET enabled=?, last_error=?, updated_at=? WHERE device_token=? AND booking_id=?')
          .bind(delivery.disable ? 0 : 1, delivery.error.slice(0, 900), now, device.device_token, bookingID).run().catch(() => {});
      }
    }, CLIENT_APP_BUNDLE_ID);
    sent += Number(result.sent || 0);
    total += Number(result.total || 0);
  }
  return { ok: sent > 0, sent, total };
}

let cachedAPNSJWT = null;
let cachedAPNSJWTAt = 0;
async function apnsJWT(env) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (cachedAPNSJWT && nowSeconds - cachedAPNSJWTAt < 45 * 60) return cachedAPNSJWT;
  const header = base64urlJSON({ alg: 'ES256', kid: env.APNS_KEY_ID });
  const payload = base64urlJSON({ iss: env.APPLE_TEAM_ID, iat: nowSeconds });
  const signingInput = `${header}.${payload}`;
  const key = await crypto.subtle.importKey('pkcs8', pemToArrayBuffer(env.APNS_PRIVATE_KEY), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(signingInput));
  cachedAPNSJWT = `${signingInput}.${base64urlBytes(new Uint8Array(signature))}`;
  cachedAPNSJWTAt = nowSeconds;
  return cachedAPNSJWT;
}

function pemToArrayBuffer(pem) {
  const normalized = String(pem || '').replace(/\\n/g, '\n');
  const base64 = normalized.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s+/g, '');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function base64urlJSON(value) {
  return base64urlBytes(new TextEncoder().encode(JSON.stringify(value)));
}

function base64urlBytes(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function handleCatalog(request, env, url) {
  const parts = pathParts(url.pathname, '/api/catalog/hotels');

  if (parts.length === 0) {
    if (request.method !== 'GET') return methodNotAllowed();
    return listHotels(env, url, true);
  }

  if (parts.length === 1 && parts[0] === 'health') {
    if (request.method !== 'GET') return methodNotAllowed();
    return health(env, false);
  }

  if (parts[0] === 'team') {
    if (request.method !== 'GET') return methodNotAllowed();
    return publicTeam(env, parts.slice(1));
  }

  if (parts.length === 1 && parts[0] === 'primary') {
    if (request.method !== 'GET') return methodNotAllowed();
    return publicPrimaryHotels(env, url);
  }

  if (parts[0] === 'chatgpt-hotels') {
    if (parts.length !== 1 || request.method !== 'GET') return methodNotAllowed();
    return publicBusinessChatGPTHotelFeed(env, url);
  }

  if (parts[0] === 'chatgpt-mcp') {
    if (parts.length >= 2 && parts[1] === 'oauth') {
      return businessChatGPTHotelOAuth(request, env, url, parts.slice(2));
    }
    if (parts.length !== 1) return json({ ok: false, error: 'NOT_FOUND' }, 404);
    return businessChatGPTHotelMCP(request, env);
  }

  if (parts[0] === 'flight-sync') {
    if (parts.length !== 2 || request.method !== 'GET') return methodNotAllowed();
    return publicBusinessFlightSyncFeed(env, parts[1]);
  }

  if (parts[0] === 'hotel-sync') {
    if (parts.length !== 3 || request.method !== 'GET') return methodNotAllowed();
    return publicBusinessHotelSyncFeed(env, parts[1], parts[2]);
  }

  if (parts[0] === 'client') {
    return handleClientOperations(request, env, parts.slice(1));
  }

  const hotelID = safeID(parts[0]);
  if (!hotelID) return json({ ok: false, error: 'INVALID_HOTEL_ID' }, 400);

  if (parts.length === 1) {
    if (request.method !== 'GET') return methodNotAllowed();
    return hotelDetail(env, hotelID, false, url);
  }

  if (parts.length === 3 && parts[1] === 'translations') {
    if (request.method !== 'GET') return methodNotAllowed();
    return hotelTranslation(env, hotelID, parts[2]);
  }

  if (parts.length === 3 && parts[1] === 'images') {
    if (request.method !== 'GET') return methodNotAllowed();
    return serveHotelImage(env, hotelID, parts[2], false);
  }

  return json({ ok: false, error: 'NOT_FOUND' }, 404);
}


const TRIP_STATUSES = new Set(['availability_check','payment_pending','booking_confirmed','ready_to_travel','in_trip','completed','cancelled']);
const TRIP_TRANSITIONS = {
  availability_check: new Set(['availability_check','payment_pending','cancelled']),
  payment_pending: new Set(['payment_pending','availability_check','booking_confirmed','cancelled']),
  booking_confirmed: new Set(['booking_confirmed','payment_pending','ready_to_travel','cancelled']),
  ready_to_travel: new Set(['ready_to_travel','booking_confirmed','in_trip','cancelled']),
  in_trip: new Set(['in_trip','completed','cancelled']),
  completed: new Set(['completed']),
  cancelled: new Set(['cancelled'])
};

async function handleBusinessOperations(request, env, url, parts, user, businessSession = null) {
  if (parts.length === 1 && parts[0] === 'me') {
    if (request.method === 'GET') return businessProfileMe(env, user);
    if (request.method === 'PUT') return saveBusinessProfileMe(request, env, user);
    return methodNotAllowed();
  }

  if (parts[0] === 'team') {
    if (parts.length === 1 && request.method === 'GET') return adminTeam(env);
    if (parts.length === 1 && request.method === 'POST') return createTeamMember(request, env);
    const memberID = safeID(parts[1]);
    if (!memberID) return json({ ok: false, error: 'INVALID_TEAM_MEMBER_ID' }, 400);
    if (parts.length === 2 && request.method === 'GET') return adminTeamMember(env, memberID);
    if (parts.length === 2 && request.method === 'PUT') return updateTeamMember(request, env, memberID);
    if (parts.length === 2 && request.method === 'DELETE') return deleteTeamMember(env, memberID);
    if (parts.length === 3 && parts[2] === 'photo') {
      if (request.method === 'GET') return serveAdminTeamMemberPhoto(env, memberID);
      if (request.method === 'POST') return uploadTeamMemberPhoto(request, env, memberID);
      if (request.method === 'DELETE') return deleteTeamMemberPhoto(env, memberID);
      return methodNotAllowed();
    }
    return methodNotAllowed();
  }

  if (parts[0] === 'payment-templates') {
    if (parts.length === 1 && request.method === 'GET') return listPaymentTemplates(env);
    if (parts.length === 1 && request.method === 'POST') return createPaymentTemplate(request, env, user);
    const templateID = safeID(parts[1]);
    if (!templateID) return json({ ok: false, error: 'INVALID_PAYMENT_TEMPLATE_ID' }, 400);
    if (parts.length === 2 && request.method === 'GET') return paymentTemplateDetail(env, templateID);
    if (parts.length === 2 && request.method === 'PUT') return updatePaymentTemplate(request, env, templateID, user);
    if (parts.length === 2 && request.method === 'DELETE') return deletePaymentTemplate(env, templateID);
    if (parts.length === 3 && parts[2] === 'qr') {
      if (request.method === 'GET') return servePaymentTemplateQR(env, templateID);
      if (request.method === 'POST') return uploadPaymentTemplateQR(request, env, templateID, user);
      if (request.method === 'DELETE') return deletePaymentTemplateQR(env, templateID, user);
      return methodNotAllowed();
    }
    return methodNotAllowed();
  }

  if (parts.length === 1 && parts[0] === 'ignav-usage') {
    if (request.method !== 'GET') return methodNotAllowed();
    return adminIgnavUsage(env);
  }

  if (parts[0] === 'chatgpt-hotels') {
    if (parts.length === 1 && request.method === 'GET') return businessChatGPTHotelAccessStatus(env);
    if (parts.length === 2 && parts[1] === 'access' && request.method === 'POST') return setBusinessChatGPTHotelAccess(env, user, true);
    if (parts.length === 2 && parts[1] === 'access' && request.method === 'DELETE') return setBusinessChatGPTHotelAccess(env, user, false);
    if (parts.length === 2 && parts[1] === 'body' && request.method === 'GET') return businessChatGPTHotelFeedResponse(env, url);
    if (parts.length === 2 && parts[1] === 'apply' && request.method === 'POST') return applyBusinessChatGPTHotelUpdates(request, env, user);
    return methodNotAllowed();
  }

  if (parts[0] === 'flight-sync') {
    if (parts.length === 1 && request.method === 'GET') return businessFlightSyncStatus(env, user);
    if (parts.length === 2 && parts[1] === 'access' && request.method === 'POST') return rotateBusinessFlightSyncAccess(env, user);
    if (parts.length === 2 && parts[1] === 'access' && request.method === 'DELETE') return revokeBusinessFlightSyncAccess(env, user);
    if (parts.length === 2 && parts[1] === 'snapshot' && request.method === 'POST') return saveBusinessFlightSyncSnapshot(request, env, user);
    return methodNotAllowed();
  }

  if (parts[0] === 'hotel-sync') {
    if (parts.length === 2 && parts[1] === 'apply' && request.method === 'POST') {
      return applyBusinessHotelSyncUpdates(request, env, user);
    }
    const city = normalizedHotelSyncCity(parts[1]);
    if (!city) return json({ ok: false, error: 'HOTEL_SYNC_INVALID_CITY' }, 400);
    if (parts.length === 2 && request.method === 'GET') return businessHotelSyncStatus(env, user, city);
    if (parts.length === 3 && parts[2] === 'access' && request.method === 'POST') return ensureBusinessHotelSyncAccess(env, user, city);
    if (parts.length === 3 && parts[2] === 'access' && request.method === 'DELETE') return revokeBusinessHotelSyncAccess(env, user, city);
    if (parts.length === 3 && parts[2] === 'snapshot' && request.method === 'POST') return saveBusinessHotelSyncSnapshot(request, env, user, city);
    if (parts.length === 3 && parts[2] === 'body' && request.method === 'GET') return businessHotelSyncBody(env, user, city);
    return methodNotAllowed();
  }

  if (parts[0] === 'flight-verify') {
    if (parts.length !== 1 || request.method !== 'POST') return methodNotAllowed();
    return verifyBusinessFlight(request, env);
  }

  if (parts[0] === 'notifications') {
    if (parts.length === 1 && request.method === 'GET') return listClientSystemNotifications(env);
    if (parts.length === 1 && request.method === 'POST') return createClientSystemNotification(request, env, user);
    if (parts.length === 2 && parts[1] === 'audience' && request.method === 'GET') return clientNotificationAudience(env);
    return methodNotAllowed();
  }

  if (parts[0] === 'esim-access') {
    const role = String(user?.role || '').toLowerCase();
    if (role !== 'superadmin') return json({ ok: false, error: 'ESIM_ACCESS_PURCHASE_SUPERADMIN_ONLY' }, 403);
    if (parts.length === 2 && parts[1] === 'balance' && request.method === 'GET') return adminEsimAccessBalance(env);
    if (parts.length === 2 && parts[1] === 'packages' && request.method === 'GET') return adminEsimAccessPackages(env, url);
    if (parts.length === 2 && parts[1] === 'inventory' && request.method === 'GET') return adminEsimAccessInventory(env);
    if (parts.length === 2 && parts[1] === 'orders' && request.method === 'POST') {
      if (businessSession && Number(businessSession.is_primary || 0) !== 1) return json({ ok: false, error: 'ESIM_ACCESS_PURCHASE_PRIMARY_ONLY' }, 403);
      return purchaseEsimAccessProfile(request, env, user);
    }
    if (parts.length === 4 && parts[1] === 'inventory' && parts[3] === 'refresh' && request.method === 'POST') {
      return refreshEsimAccessInventory(env, parts[2]);
    }
    if (parts.length === 4 && parts[1] === 'inventory' && parts[3] === 'assign' && request.method === 'POST') {
      return assignEsimAccessInventory(request, env, parts[2], user);
    }
    return methodNotAllowed();
  }

  if (parts[0] === 'bookings') {
    if (parts.length === 1 && request.method === 'GET') return operationsBookings(request, env);
    const bookingID = cleanText(parts[1], 180);
    if (!bookingID) return json({ ok: false, error: 'INVALID_BOOKING_ID' }, 400);
    if (parts.length === 2 && request.method === 'GET') return operationsBookingDetail(request, env, bookingID);
    if (parts.length === 2 && request.method === 'PATCH') return updateOperationsBooking(request, env, bookingID, user);
    if (parts.length === 2 && request.method === 'DELETE') return deleteOperationsBooking(request, env, bookingID, user);
    if (parts.length === 3 && parts[2] === 'security' && request.method === 'GET') return adminSecuritySubmissionResponse(env, bookingID);
    if (parts.length === 4 && parts[2] === 'security' && parts[3] === 'passport' && request.method === 'GET') return serveAdminSecurityPassport(env, bookingID);
    if (parts.length === 4 && parts[2] === 'security' && parts[3] === 'review' && request.method === 'POST') return reviewSecuritySubmission(request, env, bookingID, user);
    if (parts.length === 3 && parts[2] === 'itinerary') {
      if (request.method === 'GET') return bookingItineraryDetail(env, bookingID);
      if (request.method === 'PUT') return saveBookingItinerary(request, env, bookingID);
      return methodNotAllowed();
    }
    if (parts.length === 3 && parts[2] === 'pricing') {
      if (request.method === 'GET') return bookingPricingOverrideDetail(request, env, bookingID);
      if (request.method === 'PUT') return saveBookingPricingOverride(request, env, bookingID, user);
      return methodNotAllowed();
    }
    if (parts.length === 3 && parts[2] === 'assignments' && request.method === 'PATCH') return updateBookingAssignments(request, env, bookingID);
    if (parts.length === 3 && parts[2] === 'esims') {
      if (request.method === 'GET') return adminBookingEsims(env, bookingID);
      if (request.method === 'POST') return saveBookingEsim(request, env, bookingID, null, user);
      return methodNotAllowed();
    }
    if (parts.length === 4 && parts[2] === 'esims') {
      if (request.method === 'PUT') return saveBookingEsim(request, env, bookingID, parts[3], user);
      if (request.method === 'DELETE') return deleteBookingEsim(env, bookingID, parts[3]);
      return methodNotAllowed();
    }
    if (parts.length === 5 && parts[2] === 'esims' && parts[4] === 'sync' && request.method === 'POST') {
      return syncBookingEsim(request, env, bookingID, parts[3]);
    }
    if (parts.length === 3 && parts[2] === 'payment' && request.method === 'PUT') return saveBookingPaymentInstructions(request, env, bookingID, user);
    if (parts.length === 4 && parts[2] === 'payment-template' && request.method === 'POST') return applyPaymentTemplateToBooking(env, bookingID, parts[3], user);
    if (parts.length === 3 && parts[2] === 'payment-qr' && request.method === 'POST') return uploadBookingPaymeQR(request, env, bookingID, user);
    if (parts.length === 4 && parts[2] === 'price-lock' && parts[3] === 'restart' && request.method === 'POST') return restartBookingPriceLock(request, env, bookingID);
    if (parts.length === 4 && parts[2] === 'receipt' && parts[3] === 'media' && request.method === 'GET') return serveAdminPaymentReceipt(env, bookingID, url.searchParams.get('id'));
    if (parts.length === 5 && parts[2] === 'travelers' && parts[4] === 'passport' && request.method === 'GET') return serveAdminTravelerPassport(env, bookingID, Number(parts[3]));
    if (parts.length === 3 && parts[2] === 'documents' && request.method === 'POST') return uploadBookingTravelDocument(request, env, bookingID, user, url);
    if (parts.length === 4 && parts[2] === 'documents' && request.method === 'GET') return serveAdminTravelDocument(env, bookingID, parts[3]);
    if (parts.length === 4 && parts[2] === 'flights' && request.method === 'PUT') return saveVerifiedBookingFlight(request, env, bookingID, parts[3]);
    if (parts.length === 4 && parts[2] === 'flights' && request.method === 'DELETE') return deleteBookingFlight(env, bookingID, parts[3]);
    return methodNotAllowed();
  }

  if (parts[0] === 'pilgrims') {
    if (parts.length === 1 && request.method === 'GET') return listPilgrims(env, url);
    const publicID = cleanText(parts[1], 80);
    if (!publicID) return json({ ok: false, error: 'INVALID_PILGRIM_ID' }, 400);
    if (parts.length === 2 && request.method === 'GET') return pilgrimDetail(env, publicID);
    return methodNotAllowed();
  }

  if (parts[0] === 'primary-hotels') {
    if (parts.length !== 1) return json({ ok: false, error: 'NOT_FOUND' }, 404);
    if (request.method === 'GET') return adminPrimaryHotels(env, url);
    if (request.method === 'PUT') return savePrimaryHotels(request, env);
    return methodNotAllowed();
  }

  return json({ ok: false, error: 'NOT_FOUND' }, 404);
}


async function adminIgnavUsage(env) {
  const period = new Date().toISOString().slice(0, 7);
  const configuredBudget = Math.trunc(Number(env.IGNAV_MONTHLY_REQUEST_BUDGET || 6000));
  const monthlyBudget = Number.isFinite(configuredBudget) && configuredBudget > 0 ? configuredBudget : 6000;
  const row = await env.HOTELS_DB.prepare(`
    SELECT period, successful_requests, first_success_at, last_success_at, updated_at
    FROM ignav_api_usage_monthly
    WHERE period=?
    LIMIT 1
  `).bind(period).first().catch(() => null);
  const successfulRequests = Math.max(0, Math.trunc(Number(row?.successful_requests || 0)));
  const remainingRequests = Math.max(0, monthlyBudget - successfulRequests);
  const usedFraction = monthlyBudget > 0 ? Math.min(1, successfulRequests / monthlyBudget) : 0;
  return json({
    ok: true,
    usage: {
      period,
      monthlyBudget,
      successfulRequests,
      remainingRequests,
      usedFraction,
      firstSuccessAt: row?.first_success_at || null,
      lastSuccessAt: row?.last_success_at || null,
      trackingNote: 'Серверный счётчик iumrah: учитываются успешные Ignav-запросы, записанные в общий D1.'
    }
  });
}


const BUSINESS_HOTEL_SYNC_VERSION = 2;
const BUSINESS_HOTEL_SYNC_MAX_HOTELS = 500; // legacy upload compatibility only; live feeds are database-backed

function normalizedHotelSyncCity(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/[-_]+/g, ' ');
  if (raw.includes('makkah') || raw.includes('mecca') || raw.includes('مكة')) return 'Makkah';
  if (raw.includes('madinah') || raw.includes('medina') || raw.includes('المدينة')) return 'Madinah';
  return '';
}

function hotelSyncCitySlug(value) {
  const city = normalizedHotelSyncCity(value);
  if (city === 'Makkah') return 'makkah';
  if (city === 'Madinah') return 'madinah';
  return '';
}

function businessHotelSyncOwner(user) {
  return businessStaffLogin(user);
}

function businessHotelSyncPublicURL(city, token) {
  return `https://iumrah.app/api/catalog/hotels/hotel-sync/${hotelSyncCitySlug(city)}/${encodeURIComponent(token)}`;
}

function hotelSyncDateFromUTC(date) {
  return date.toISOString().slice(0, 10);
}

function hotelSyncDefaultDates(now = new Date()) {
  const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const checkInDate = new Date(base.getTime() + 20 * 24 * 60 * 60_000);
  const checkOutDate = new Date(checkInDate.getTime() + 24 * 60 * 60_000);
  return { checkIn: hotelSyncDateFromUTC(checkInDate), checkOut: hotelSyncDateFromUTC(checkOutDate) };
}

function resolvedHotelSyncDates(row) {
  const today = hotelSyncDateFromUTC(new Date());
  const checkIn = validLocalDate(row?.check_in);
  const checkOut = validLocalDate(row?.check_out);
  if (checkIn && checkOut && checkOut > checkIn && checkIn >= today) return { checkIn, checkOut };
  return hotelSyncDefaultDates();
}

async function businessHotelSyncLiveHotels(env, city, checkIn, checkOut) {
  const result = await env.HOTELS_DB.prepare(`
    SELECT
      h.id, h.name, h.city, h.stars, h.status, h.updated_at,
      hps.provider AS locked_source_provider,
      hps.source_url AS locked_source_url,
      ${HOTEL_PRICE_SELECT}
    FROM hotels h
    LEFT JOIN hotel_price_cache hp ON hp.hotel_id=h.id
    LEFT JOIN hotel_price_overrides hpo ON hpo.hotel_id=h.id
    LEFT JOIN hotel_price_sources hps ON hps.hotel_id=h.id
    WHERE LOWER(h.city)=LOWER(?)
      AND NOT EXISTS (SELECT 1 FROM primary_hotels p WHERE p.hotel_id=h.id)
    ORDER BY h.name COLLATE NOCASE ASC
  `).bind(city).all();

  return (result.results || []).map(row => {
    const price = hotelPriceFromRow(row);
    const sourceURL = price?.sourceURL || row.locked_source_url || null;
    const provider = normalizedHotelSyncProvider(price?.provider || row.locked_source_provider, sourceURL);
    return normalizedHotelSyncItem({
      hotel_id: row.id,
      hotel_name: row.name,
      city,
      stars: row.stars,
      current_nightly_usd: price?.nightlyUSD ?? null,
      catalog_status: row.status || 'published',
      price_status: price?.status || null,
      is_manual_override: Boolean(price?.isManualOverride),
      provider,
      source_url: sourceURL,
      last_price_fetched_at: price?.fetchedAt || null
    }, city, checkIn, checkOut);
  }).filter(Boolean);
}

function normalizedHotelSyncProvider(value, sourceURL) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw.includes('booking')) return 'Booking';
  if (raw.includes('expedia')) return 'Expedia';
  try {
    const host = new URL(String(sourceURL || '')).hostname.toLowerCase();
    if (host === 'booking.com' || host.endsWith('.booking.com')) return 'Booking';
    if (host === 'expedia.com' || host.endsWith('.expedia.com') || host.includes('expedia.')) return 'Expedia';
  } catch {}
  return null;
}

function safeHotelSyncSourceURL(value) {
  const raw = cleanText(value, 7000);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return null;
    const provider = normalizedHotelSyncProvider(null, raw);
    return provider ? url.toString() : null;
  } catch {
    return null;
  }
}

function hotelSyncMonitoringURL(sourceURL, provider, checkIn, checkOut) {
  if (!sourceURL) return null;
  try {
    const source = new URL(sourceURL);
    const resolved = normalizedHotelSyncProvider(provider, sourceURL);

    // Keep the same Flight Sync transport contract, but normalize the hotel-specific
    // provider URL so stale share/deep-link parameters cannot override snapshot dates.
    const url = new URL(`${source.origin}${source.pathname}`);
    if (resolved === 'Booking') {
      const propertyID = source.searchParams.get('app_hotel_id') || source.searchParams.get('hotel_id');
      if (propertyID && /^[0-9]{3,}$/.test(propertyID)) url.searchParams.set('app_hotel_id', propertyID);
      url.searchParams.set('checkin', checkIn);
      url.searchParams.set('checkout', checkOut);
      url.searchParams.set('group_adults', '2');
      url.searchParams.set('group_children', '0');
      url.searchParams.set('no_rooms', '1');
      url.searchParams.set('room1', 'A,A');
      url.searchParams.set('selected_currency', 'USD');
      return url.toString();
    }
    if (resolved === 'Expedia') {
      url.searchParams.set('chkin', checkIn);
      url.searchParams.set('chkout', checkOut);
      url.searchParams.set('rm1', 'a2');
      url.searchParams.set('currency', 'USD');
      url.searchParams.set('useRewards', 'false');
      return url.toString();
    }
    return null;
  } catch {
    return null;
  }
}

function hotelSyncPropertyIdentity(value, providerHint = null) {
  try {
    const url = new URL(String(value || ''));
    const provider = normalizedHotelSyncProvider(providerHint, url.toString());
    if (provider === 'Expedia') {
      const propertyID = providerPropertyIDFromURL(url, 'Expedia');
      return propertyID ? `expedia:${propertyID}` : null;
    }
    if (provider === 'Booking') {
      const pathKey = bookingHotelIdentityKey(url.toString());
      if (pathKey) return `booking:path:${pathKey}`;
      const explicit = url.searchParams.get('app_hotel_id') || url.searchParams.get('hotel_id');
      return explicit && /^[0-9]{3,}$/.test(explicit) ? `booking:id:${explicit}` : null;
    }
  } catch {}
  return null;
}

function hotelSyncSameProperty(a, b, provider) {
  const first = hotelSyncPropertyIdentity(a, provider);
  const second = hotelSyncPropertyIdentity(b, provider);
  return !!first && first === second;
}

function hotelSyncURLContainsDates(value, providerHint, checkIn, checkOut) {
  try {
    const url = new URL(String(value || ''));
    const provider = normalizedHotelSyncProvider(providerHint, value);
    if (provider === 'Booking') {
      return url.searchParams.get('checkin') === checkIn && url.searchParams.get('checkout') === checkOut;
    }
    if (provider === 'Expedia') {
      const compact = url.searchParams.get('chkin') === checkIn && url.searchParams.get('chkout') === checkOut;
      const long = url.searchParams.get('startDate') === checkIn && url.searchParams.get('endDate') === checkOut;
      return compact || long;
    }
  } catch {}
  return false;
}

function normalizedHotelSyncItem(value, expectedCity, checkIn, checkOut) {
  if (!value || typeof value !== 'object') return null;
  const hotelID = cleanText(value.hotel_id || value.hotelID, 220);
  const hotelName = safeHumanText(value.hotel_name || value.hotelName, 300);
  const city = normalizedHotelSyncCity(value.city);
  if (!hotelID || !hotelName || city !== expectedCity) return null;

  const sourceURL = safeHotelSyncSourceURL(value.source_url || value.sourceURL);
  const provider = normalizedHotelSyncProvider(value.provider, sourceURL);
  const monitorable = Boolean(sourceURL && provider && hotelSyncPropertyIdentity(sourceURL, provider));

  const rawPrice = value.current_nightly_usd ?? value.currentNightlyUSD;
  const price = rawPrice === null || rawPrice === undefined || rawPrice === '' ? null : Number(rawPrice);
  if (price !== null && (!Number.isFinite(price) || price <= 0 || price > 100000)) return null;

  return {
    hotel_id: hotelID,
    hotel_name: hotelName,
    city,
    stars: Number.isFinite(Number(value.stars)) ? Math.max(1, Math.min(5, Math.trunc(Number(value.stars)))) : null,
    current_nightly_usd: price === null ? null : Math.round(price * 100) / 100,
    currency: 'USD',
    catalog_status: cleanText(value.catalog_status || value.catalogStatus, 40) || 'published',
    price_status: cleanText(value.price_status || value.priceStatus, 40) || null,
    is_manual_override: Boolean(value.is_manual_override ?? value.isManualOverride),
    provider: provider || null,
    source_url: sourceURL || null,
    monitoring_url: monitorable ? hotelSyncMonitoringURL(sourceURL, provider, checkIn, checkOut) : null,
    monitoring_status: monitorable ? 'ready' : 'unverified_source',
    last_price_fetched_at: cleanText(value.last_price_fetched_at || value.lastPriceFetchedAt, 80) || null
  };
}

async function businessHotelSyncStatus(env, user, cityValue) {
  const owner = businessHotelSyncOwner(user);
  const city = normalizedHotelSyncCity(cityValue);
  if (!owner) return json({ ok: false, error: 'HOTEL_SYNC_OWNER_REQUIRED' }, 403);
  if (!city) return json({ ok: false, error: 'HOTEL_SYNC_INVALID_CITY' }, 400);
  const row = await env.HOTELS_DB.prepare(`
    SELECT token_hash, enabled, snapshot_id, hotel_count, check_in, check_out, snapshot_updated_at, created_at, updated_at
    FROM business_hotel_sync_feeds WHERE owner_login=? AND city=? LIMIT 1
  `).bind(owner, city).first().catch(() => null);
  const enabled = Boolean(row && Number(row.enabled) === 1);
  const dates = resolvedHotelSyncDates(row);
  const liveHotels = enabled ? await businessHotelSyncLiveHotels(env, city, dates.checkIn, dates.checkOut).catch(() => []) : [];
  const liveFeedID = row?.snapshot_id || `hotel-sync-${hotelSyncCitySlug(city)}-live`;
  return json({
    ok: true,
    city,
    configured: Boolean(row),
    enabled,
    readOnly: true,
    live: true,
    source: 'iumrah_business_live_database',
    // token_hash is itself accepted as the canonical bearer. There is no TTL and no
    // automatic rotation: this URL remains valid until the operator explicitly revokes it.
    accessURL: enabled && row?.token_hash ? businessHotelSyncPublicURL(city, row.token_hash) : null,
    snapshotID: row ? liveFeedID : null,
    hotelCount: liveHotels.length,
    checkIn: dates.checkIn,
    checkOut: dates.checkOut,
    snapshotUpdatedAt: row?.snapshot_updated_at || row?.updated_at || null,
    createdAt: row?.created_at || null,
    updatedAt: row?.updated_at || null,
    expiresAt: null,
    unlimitedReads: true
  });
}

async function ensureBusinessHotelSyncAccess(env, user, cityValue) {
  const owner = businessHotelSyncOwner(user);
  const city = normalizedHotelSyncCity(cityValue);
  if (!owner) return json({ ok: false, error: 'HOTEL_SYNC_OWNER_REQUIRED' }, 403);
  if (!city) return json({ ok: false, error: 'HOTEL_SYNC_INVALID_CITY' }, 400);

  const now = new Date().toISOString();
  const fallbackDates = hotelSyncDefaultDates();
  const fallbackFeedID = `hotel-sync-${hotelSyncCitySlug(city)}-live`;
  const existing = await env.HOTELS_DB.prepare(`
    SELECT token_hash, enabled, snapshot_id, check_in, check_out, created_at
    FROM business_hotel_sync_feeds
    WHERE owner_login=? AND city=?
    LIMIT 1
  `).bind(owner, city).first().catch(() => null);

  if (existing?.token_hash) {
    const dates = resolvedHotelSyncDates(existing);
    if (Number(existing.enabled) !== 1 || !existing.snapshot_id || existing.check_in !== dates.checkIn || existing.check_out !== dates.checkOut) {
      await env.HOTELS_DB.prepare(`
        UPDATE business_hotel_sync_feeds
        SET enabled=1, snapshot_id=COALESCE(snapshot_id, ?), check_in=?, check_out=?, updated_at=?
        WHERE owner_login=? AND city=?
      `).bind(fallbackFeedID, dates.checkIn, dates.checkOut, now, owner, city).run();
    }
    return json({
      ok: true,
      city,
      readOnly: true,
      live: true,
      accessURL: businessHotelSyncPublicURL(city, existing.token_hash),
      rotatedAt: null,
      createdAt: existing.created_at || null,
      reused: true,
      unlimitedReads: true,
      expiresAt: null,
      note: 'Permanent live read-only URL. No TTL, no read limit, no snapshot cache dependency. Valid until explicitly revoked.'
    });
  }

  const token = randomToken(32);
  const tokenHash = await sha256Hex(token);
  const compactState = JSON.stringify({
    version: BUSINESS_HOTEL_SYNC_VERSION,
    snapshot_id: fallbackFeedID,
    source: 'iumrah_business_live_database',
    city,
    check_in: fallbackDates.checkIn,
    check_out: fallbackDates.checkOut,
    hotels: []
  });
  await env.HOTELS_DB.prepare(`
    INSERT INTO business_hotel_sync_feeds (
      owner_login, city, token_hash, enabled, snapshot_json, hotel_count,
      snapshot_id, check_in, check_out, snapshot_updated_at, created_at, updated_at
    ) VALUES (?, ?, ?, 1, ?, 0, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(owner_login, city) DO NOTHING
  `).bind(owner, city, tokenHash, compactState, fallbackFeedID, fallbackDates.checkIn, fallbackDates.checkOut, now, now, now).run();

  // Concurrent devices always converge on the same stored token. We never rotate it here.
  const persisted = await env.HOTELS_DB.prepare(`
    SELECT token_hash, enabled, snapshot_id, check_in, check_out, created_at
    FROM business_hotel_sync_feeds
    WHERE owner_login=? AND city=?
    LIMIT 1
  `).bind(owner, city).first().catch(() => null);
  if (!persisted?.token_hash) return json({ ok: false, error: 'HOTEL_SYNC_ACCESS_CREATE_FAILED' }, 500);
  const dates = resolvedHotelSyncDates(persisted);
  if (Number(persisted.enabled) !== 1 || !persisted.snapshot_id || persisted.check_in !== dates.checkIn || persisted.check_out !== dates.checkOut) {
    await env.HOTELS_DB.prepare(`
      UPDATE business_hotel_sync_feeds
      SET enabled=1, snapshot_id=COALESCE(snapshot_id, ?), check_in=?, check_out=?, updated_at=?
      WHERE owner_login=? AND city=?
    `).bind(fallbackFeedID, dates.checkIn, dates.checkOut, now, owner, city).run();
  }

  return json({
    ok: true,
    city,
    readOnly: true,
    live: true,
    accessURL: businessHotelSyncPublicURL(city, persisted.token_hash),
    rotatedAt: null,
    createdAt: persisted.created_at || now,
    reused: persisted.token_hash !== tokenHash,
    unlimitedReads: true,
    expiresAt: null,
    note: 'Permanent live read-only URL. No TTL, no read limit, no snapshot cache dependency. Valid until explicitly revoked.'
  });
}

// Backward-compatible internal alias for older tests/callers. The operation is now
// idempotent and never rotates an existing bearer token.
async function rotateBusinessHotelSyncAccess(env, user, cityValue) {
  return ensureBusinessHotelSyncAccess(env, user, cityValue);
}

async function revokeBusinessHotelSyncAccess(env, user, cityValue) {
  const owner = businessHotelSyncOwner(user);
  const city = normalizedHotelSyncCity(cityValue);
  if (!owner) return json({ ok: false, error: 'HOTEL_SYNC_OWNER_REQUIRED' }, 403);
  if (!city) return json({ ok: false, error: 'HOTEL_SYNC_INVALID_CITY' }, 400);
  const now = new Date().toISOString();
  await env.HOTELS_DB.prepare(`
    UPDATE business_hotel_sync_feeds SET enabled=0, updated_at=? WHERE owner_login=? AND city=?
  `).bind(now, owner, city).run();
  return json({ ok: true, city, enabled: false, revokedAt: now });
}

async function saveBusinessHotelSyncSnapshot(request, env, user, cityValue) {
  const owner = businessHotelSyncOwner(user);
  const city = normalizedHotelSyncCity(cityValue);
  if (!owner) return json({ ok: false, error: 'HOTEL_SYNC_OWNER_REQUIRED' }, 403);
  if (!city) return json({ ok: false, error: 'HOTEL_SYNC_INVALID_CITY' }, 400);

  const existing = await env.HOTELS_DB.prepare(`
    SELECT enabled FROM business_hotel_sync_feeds WHERE owner_login=? AND city=? LIMIT 1
  `).bind(owner, city).first().catch(() => null);
  if (!existing || Number(existing.enabled) !== 1) {
    return json({ ok: false, error: 'HOTEL_SYNC_ACCESS_NOT_ENABLED' }, 409);
  }

  // Legacy clients may still upload their hotel list here. It is accepted only as input
  // compatibility; the public feed NEVER reads those rows. Live D1 is the source of truth.
  const raw = await request.text();
  if (raw.length > 800_000) return json({ ok: false, error: 'HOTEL_SYNC_SETTINGS_TOO_LARGE' }, 413);
  let payload;
  try { payload = JSON.parse(raw); } catch { return json({ ok: false, error: 'INVALID_JSON' }, 400); }

  const payloadCity = normalizedHotelSyncCity(payload?.city);
  const checkIn = validLocalDate(payload?.check_in || payload?.checkIn);
  const checkOut = validLocalDate(payload?.check_out || payload?.checkOut);
  if (payloadCity !== city) return json({ ok: false, error: 'HOTEL_SYNC_CITY_MISMATCH' }, 400);
  if (!checkIn || !checkOut || checkOut <= checkIn) return json({ ok: false, error: 'HOTEL_SYNC_INVALID_DATES' }, 400);
  if (Number(payload?.rooms ?? 1) !== 1 || Number(payload?.adults ?? 2) !== 2 || Number(payload?.children || 0) !== 0) {
    return json({ ok: false, error: 'HOTEL_SYNC_INVALID_OCCUPANCY' }, 400);
  }
  // Preserve a generous compatibility ceiling for old app builds, but do not use uploaded
  // hotel data as the feed or as an authorization gate. New builds send no hotel array.
  if (Array.isArray(payload?.hotels) && payload.hotels.length > BUSINESS_HOTEL_SYNC_MAX_HOTELS) {
    return json({ ok: false, error: 'HOTEL_SYNC_TOO_MANY_LEGACY_HOTELS' }, 400);
  }

  const now = new Date().toISOString();
  const snapshotID = `hotel-sync-${hotelSyncCitySlug(city)}-${crypto.randomUUID()}`;
  const liveHotels = await businessHotelSyncLiveHotels(env, city, checkIn, checkOut);
  const compactState = {
    version: BUSINESS_HOTEL_SYNC_VERSION,
    snapshot_id: snapshotID,
    source: 'iumrah_business_live_database',
    generated_at: now,
    city,
    check_in: checkIn,
    check_out: checkOut,
    rooms: 1,
    adults: 2,
    children: 0,
    currency: 'USD',
    hotels: []
  };

  await env.HOTELS_DB.prepare(`
    UPDATE business_hotel_sync_feeds
    SET snapshot_id=?, snapshot_json=?, hotel_count=?, check_in=?, check_out=?, snapshot_updated_at=?, updated_at=?
    WHERE owner_login=? AND city=? AND enabled=1
  `).bind(snapshotID, JSON.stringify(compactState), liveHotels.length, checkIn, checkOut, now, now, owner, city).run();

  return json({
    ok: true,
    city,
    readOnly: true,
    live: true,
    source: 'iumrah_business_live_database',
    snapshotID,
    hotelCount: liveHotels.length,
    checkIn,
    checkOut,
    snapshotUpdatedAt: now
  });
}

async function businessHotelSyncBody(env, user, cityValue) {
  const owner = businessHotelSyncOwner(user);
  const city = normalizedHotelSyncCity(cityValue);
  if (!owner) return json({ ok: false, error: 'HOTEL_SYNC_OWNER_REQUIRED' }, 403);
  if (!city) return json({ ok: false, error: 'HOTEL_SYNC_INVALID_CITY' }, 400);

  const row = await env.HOTELS_DB.prepare(`
    SELECT snapshot_id, snapshot_json, hotel_count, check_in, check_out, snapshot_updated_at, updated_at
    FROM business_hotel_sync_feeds
    WHERE owner_login=? AND city=? AND enabled=1
    LIMIT 1
  `).bind(owner, city).first().catch(() => null);
  if (!row) return json({ ok: false, error: 'HOTEL_SYNC_ACCESS_NOT_ENABLED' }, 404);
  return businessHotelSyncFeedResponse(env, row, city);
}

async function publicBusinessHotelSyncFeed(env, citySlug, token) {
  const city = normalizedHotelSyncCity(citySlug);
  const cleanToken = cleanText(token, 512);
  if (!city || !cleanToken || cleanToken.length < 24) return json({ ok: false, error: 'HOTEL_SYNC_NOT_FOUND' }, 404);
  const hashedToken = await sha256Hex(cleanToken);
  const row = await env.HOTELS_DB.prepare(`
    SELECT snapshot_id, snapshot_json, hotel_count, check_in, check_out, snapshot_updated_at, updated_at
    FROM business_hotel_sync_feeds
    WHERE (token_hash=? OR token_hash=?) AND city=? AND enabled=1
    LIMIT 1
  `).bind(cleanToken, hashedToken, city).first().catch(() => null);
  if (!row) return json({ ok: false, error: 'HOTEL_SYNC_NOT_FOUND' }, 404);
  return businessHotelSyncFeedResponse(env, row, city);
}

async function businessHotelSyncFeedResponse(env, row, city) {
  const dates = resolvedHotelSyncDates(row);
  const snapshotID = row.snapshot_id || `hotel-sync-${hotelSyncCitySlug(city)}-live`;
  const liveGeneratedAt = new Date().toISOString();
  const hotels = await businessHotelSyncLiveHotels(env, city, dates.checkIn, dates.checkOut);
  const payload = {
    ok: true,
    type: 'iumrah_business_hotel_prices',
    read_only: true,
    live: true,
    feed_mode: 'live_database',
    source: 'iumrah_business_live_database',
    version: BUSINESS_HOTEL_SYNC_VERSION,
    snapshot_id: snapshotID,
    updated_at: liveGeneratedAt,
    live_generated_at: liveGeneratedAt,
    expires_at: null,
    unlimited_reads: true,
    city,
    check_in: dates.checkIn,
    check_out: dates.checkOut,
    rooms: 1,
    adults: 2,
    children: 0,
    currency: 'USD',
    hotel_count: hotels.length,
    monitoring_rules: {
      primary_method: 'Open monitoring_url for each hotel first. It is the exact stored Expedia/Booking property with the preferred feed dates applied.',
      fallback_method: 'If the stored provider cannot expose a reliable live rate, Booking.com may be used only for the exact same physical property. Never use a Google/search-result price snippet as a verified price.',
      exact_property_only: true,
      exact_dates_required: false,
      date_policy: 'Prefer the feed dates. If the provider does not expose them, a directly verified nearby stay date for the same property and occupancy is acceptable; keep the feed check_in/check_out in the JSON and mention the observed stay date in reason.',
      link_policy: 'This bearer URL has no TTL, no read limit, and no automatic token rotation. It remains valid until the operator explicitly revokes it in iumrah Business.',
      freshness_policy: 'Hotels, provider/source identity, and current_nightly_usd are read directly from the live iumrah D1 catalog on every request. No saved hotel snapshot or cache-miss gate is used.',
      snapshot_policy: 'snapshot_id is audit/history/configuration metadata only. It never expires the link and never invalidates a result globally. Apply is protected per hotel by live hotel ID + provider/property + current old_nightly_usd compare-and-set.',
      occupancy: '1 room, 2 adults, 0 children, 1 night',
      unverified_when_not_provable: true,
      result_schema: 'iumrah.hotel-price-update.v2',
      price_basis: 'Use a directly sellable nightly room rate for the same hotel/property. Do not mix another property, crossed-out savings, or recommendation-card prices.',
      currency_rule: 'Prefer USD. If only SAR is directly shown, convert with 1 USD = 3.75 SAR and preserve the observed SAR amount in the result.'
    },
    result_template: {
      schema: 'iumrah.hotel-price-update.v2',
      version: 2,
      snapshot_id: snapshotID,
      city,
      check_in: dates.checkIn,
      check_out: dates.checkOut,
      rooms: 1,
      adults: 2,
      currency: 'USD',
      checked_at: 'ISO-8601 timestamp',
      hotels: [{
        hotel_id: 'copy from feed',
        hotel_name: 'copy from feed',
        status: 'changed | unchanged | unverified',
        old_nightly_usd: 'copy freshly fetched current_nightly_usd from this live feed immediately before building JSON',
        new_nightly_usd: 'verified USD nightly price or null',
        observed_nightly_amount: 'exact displayed amount or null',
        observed_currency: 'USD | SAR | other exact displayed currency',
        provider: 'copy from feed',
        source_url: 'copy from feed exactly',
        monitoring_url: 'copy from feed exactly',
        checked_source_url: 'exact property page actually used; may be Booking.com only when it is the exact same physical property',
        check_in: dates.checkIn,
        check_out: dates.checkOut,
        rooms: 1,
        adults: 2,
        currency: 'USD',
        confidence: 'high | none',
        reason: 'short reason or null',
        checked_at: 'ISO-8601 timestamp'
      }]
    },
    hotels
  };

  return new Response(`${JSON.stringify(payload, null, 2)}\n`, {
    status: 200,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store, max-age=0',
      'pragma': 'no-cache',
      'expires': '0'
    }
  });
}

function normalizedHotelSyncUpdateItem(value) {
  if (!value || typeof value !== 'object') return null;
  const hotelID = cleanText(value.hotel_id || value.hotelID, 220);
  const status = cleanText(value.status, 40)?.toLowerCase();
  if (!hotelID || !['changed', 'unchanged', 'unverified'].includes(status)) return null;
  const oldPrice = value.old_nightly_usd ?? value.oldNightlyUSD;
  const newPrice = value.new_nightly_usd ?? value.newNightlyUSD;
  const sourceURL = safeHotelSyncSourceURL(value.source_url || value.sourceURL);
  const monitoringURL = safeHotelSyncSourceURL(value.monitoring_url || value.monitoringURL);
  const checkedSourceURL = safeHotelSyncSourceURL(value.checked_source_url || value.checkedSourceURL);
  return {
    hotel_id: hotelID,
    hotel_name: safeHumanText(value.hotel_name || value.hotelName, 300) || null,
    status,
    old_nightly_usd: oldPrice == null ? null : Number(oldPrice),
    new_nightly_usd: newPrice == null ? null : Number(newPrice),
    provider: normalizedHotelSyncProvider(value.provider, checkedSourceURL || sourceURL || monitoringURL),
    source_url: sourceURL,
    monitoring_url: monitoringURL,
    checked_source_url: checkedSourceURL,
    check_in: validLocalDate(value.check_in || value.checkIn),
    check_out: validLocalDate(value.check_out || value.checkOut),
    rooms: Number(value.rooms),
    adults: Number(value.adults),
    currency: normalizedCurrency(value.currency || 'USD'),
    confidence: cleanText(value.confidence, 40)?.toLowerCase() || 'none',
    reason: safeHumanText(value.reason, 500) || null,
    checked_at: cleanText(value.checked_at || value.checkedAt, 80) || null
  };
}

async function applyBusinessHotelSyncUpdates(request, env, user) {
  const owner = businessHotelSyncOwner(user);
  if (!owner) return json({ ok: false, error: 'HOTEL_SYNC_OWNER_REQUIRED' }, 403);
  const payload = await readJSON(request, 1_500_000);
  if (!payload.ok) return payload.response;
  const document = payload.value?.result;
  const selectedIDs = Array.isArray(payload.value?.hotel_ids) ? payload.value.hotel_ids.map(x => cleanText(x, 220)).filter(Boolean) : [];
  if (!document || document.schema !== 'iumrah.hotel-price-update.v2') return json({ ok: false, error: 'HOTEL_SYNC_INVALID_RESULT_SCHEMA' }, 400);
  if (!selectedIDs.length) return json({ ok: false, error: 'HOTEL_SYNC_NO_SELECTION' }, 400);

  const city = normalizedHotelSyncCity(document.city);
  const snapshotID = cleanText(document.snapshot_id || document.snapshotID, 260);
  const checkIn = validLocalDate(document.check_in || document.checkIn);
  const checkOut = validLocalDate(document.check_out || document.checkOut);
  // snapshot_id is retained for audit/history only. It no longer acts as a global lock:
  // every selected hotel is compared against the live catalog state immediately before write.
  if (!city || !snapshotID || !checkIn || !checkOut || checkOut <= checkIn) return json({ ok: false, error: 'HOTEL_SYNC_INVALID_RESULT_CONTEXT' }, 400);
  if (Number(document.rooms) !== 1 || Number(document.adults) !== 2 || normalizedCurrency(document.currency) !== 'USD') {
    return json({ ok: false, error: 'HOTEL_SYNC_INVALID_RESULT_OCCUPANCY' }, 400);
  }

  const updates = Array.isArray(document.hotels) ? document.hotels.map(normalizedHotelSyncUpdateItem).filter(Boolean) : [];
  const updateByID = new Map(updates.map(item => [item.hotel_id, item]));
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + HOTEL_PRICE_TTL_MS).toISOString();
  const applied = [];
  const rejected = [];

  for (const hotelID of selectedIDs) {
    const update = updateByID.get(hotelID);
    if (!update) { rejected.push({ hotelID, error: 'HOTEL_SYNC_ITEM_NOT_FOUND' }); continue; }
    if (update.status !== 'changed' || update.confidence !== 'high') { rejected.push({ hotelID, error: 'HOTEL_SYNC_ITEM_NOT_VERIFIED' }); continue; }

    const nextPrice = Number(update.new_nightly_usd);
    const oldPrice = Number(update.old_nightly_usd);
    if (!Number.isFinite(nextPrice) || nextPrice < 15 || nextPrice > 5000) { rejected.push({ hotelID, error: 'HOTEL_SYNC_INVALID_NEW_PRICE' }); continue; }

    const hotel = await env.HOTELS_DB.prepare(`
      SELECT id, city, status
      FROM hotels
      WHERE id=?
      LIMIT 1
    `).bind(hotelID).first().catch(() => null);
    if (!hotel || hotel.status !== 'published') { rejected.push({ hotelID, error: 'HOTEL_NOT_FOUND' }); continue; }
    if (normalizedHotelSyncCity(hotel.city) !== city) { rejected.push({ hotelID, error: 'CITY_MISMATCH' }); continue; }

    if (await isPrimaryHotel(env, hotelID)) {
      const rounded = Math.round(nextPrice * 100) / 100;
      await env.HOTELS_DB.prepare(`
        INSERT INTO hotel_price_overrides (hotel_id, nightly_price_usd, updated_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(hotel_id) DO UPDATE SET
          nightly_price_usd=excluded.nightly_price_usd,
          updated_by=excluded.updated_by,
          updated_at=excluded.updated_at
      `).bind(hotelID, rounded, owner, now, now).run();
      applied.push(hotelID);
      continue;
    }

    if (!Number.isFinite(oldPrice)) { rejected.push({ hotelID, error: 'HOTEL_SYNC_BASELINE_MISMATCH' }); continue; }
    if (update.check_in !== checkIn || update.check_out !== checkOut || update.rooms !== 1 || update.adults !== 2 || update.currency !== 'USD') {
      rejected.push({ hotelID, error: 'HOTEL_SYNC_DATES_OR_OCCUPANCY_MISMATCH' }); continue;
    }

    // Compare-and-set against the live price, not against the latest snapshot. This makes
    // daily/48-hour updates resilient to a new sync run while still preventing stale writes.
    const currentRow = await readHotelPriceRow(env, hotelID);
    const currentPrice = Number(hotelPriceFromRow(currentRow)?.nightlyUSD);
    if (!Number.isFinite(currentPrice) || Math.abs(currentPrice - oldPrice) >= 0.01) {
      rejected.push({ hotelID, error: 'HOTEL_SYNC_PRICE_ALREADY_CHANGED' }); continue;
    }

    const source = await ensureHotelPriceSourceLock(env, hotelID);
    const currentProvider = normalizedHotelSyncProvider(source?.provider, source?.source_url);
    if (!source?.source_url || !currentProvider || !update.provider || currentProvider !== update.provider) {
      rejected.push({ hotelID, error: 'HOTEL_SYNC_SOURCE_NOT_VERIFIED' }); continue;
    }
    if (update.source_url && !hotelSyncSameProperty(source.source_url, update.source_url, currentProvider)) {
      rejected.push({ hotelID, error: 'HOTEL_SYNC_PROPERTY_MISMATCH' }); continue;
    }
    if (!update.checked_source_url || !hotelSyncSameProperty(source.source_url, update.checked_source_url, currentProvider)) {
      rejected.push({ hotelID, error: 'HOTEL_SYNC_PROPERTY_MISMATCH' }); continue;
    }

    // checked_source_url may contain a nearby stay date. The requested sync dates remain in
    // the audit fields, but provider query dates no longer block an otherwise safe update.
    await env.HOTELS_DB.prepare(`
      INSERT INTO hotel_price_cache (
        hotel_id, source_id, provider, source_url, resolved_url,
        amount_original, currency_original, price_basis, nightly_price_usd, quote_total_usd,
        quote_check_in, quote_check_out, quote_nights, quote_adults, quote_rooms,
        confidence, method, status, fetched_at, expires_at, last_attempt_at, next_retry_at,
        last_http_status, error, pending_nightly_price_usd, pending_seen_count,
        pending_first_seen_at, pending_last_seen_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'USD', 'nightly', ?, ?, ?, ?, 1, 2, 1, 0.99, 'chatgpt-admin-live-cas', 'fresh', ?, ?, ?, NULL, 200, NULL, NULL, 0, NULL, NULL, ?, ?)
      ON CONFLICT(hotel_id) DO UPDATE SET
        source_id=excluded.source_id,
        provider=excluded.provider,
        source_url=excluded.source_url,
        resolved_url=excluded.resolved_url,
        amount_original=excluded.amount_original,
        currency_original='USD',
        price_basis='nightly',
        nightly_price_usd=excluded.nightly_price_usd,
        quote_total_usd=excluded.quote_total_usd,
        quote_check_in=excluded.quote_check_in,
        quote_check_out=excluded.quote_check_out,
        quote_nights=1,
        quote_adults=2,
        quote_rooms=1,
        confidence=0.99,
        method='chatgpt-admin-live-cas',
        status='fresh',
        fetched_at=excluded.fetched_at,
        expires_at=excluded.expires_at,
        last_attempt_at=excluded.last_attempt_at,
        next_retry_at=NULL,
        last_http_status=200,
        error=NULL,
        pending_nightly_price_usd=NULL,
        pending_seen_count=0,
        pending_first_seen_at=NULL,
        pending_last_seen_at=NULL,
        updated_at=excluded.updated_at
    `).bind(
      hotelID,
      source.source_id || null,
      currentProvider,
      source.source_url,
      update.checked_source_url,
      Math.round(nextPrice * 100) / 100,
      Math.round(nextPrice * 100) / 100,
      Math.round(nextPrice * 100) / 100,
      checkIn,
      checkOut,
      now,
      expiresAt,
      now,
      now,
      now
    ).run();
    await env.HOTELS_DB.prepare('DELETE FROM hotel_price_overrides WHERE hotel_id=?').bind(hotelID).run();
    applied.push(hotelID);
  }

  return json({ ok: true, city, snapshotID, applied, rejected, appliedCount: applied.length, rejectedCount: rejected.length });
}


const BUSINESS_CHATGPT_MCP_URL = 'https://iumrah.app/api/catalog/hotels/chatgpt-mcp';
const BUSINESS_CHATGPT_OAUTH_ISSUER = 'https://iumrah.app';
const BUSINESS_CHATGPT_OAUTH_AUTHORIZE_URL = 'https://iumrah.app/api/catalog/hotels/chatgpt-mcp/oauth/authorize';
const BUSINESS_CHATGPT_OAUTH_TOKEN_URL = 'https://iumrah.app/api/catalog/hotels/chatgpt-mcp/oauth/token';
const BUSINESS_CHATGPT_OAUTH_RESOURCE_METADATA_URL = 'https://iumrah.app/.well-known/oauth-protected-resource/api/catalog/hotels/chatgpt-mcp';
const BUSINESS_CHATGPT_OAUTH_SCOPES = ['hotels.read', 'offline_access'];
const BUSINESS_CHATGPT_OAUTH_ACCESS_TTL_SECONDS = 30 * 24 * 60 * 60;
const BUSINESS_CHATGPT_OAUTH_REFRESH_TTL_SECONDS = 10 * 365 * 24 * 60 * 60;
const BUSINESS_CHATGPT_OAUTH_CODE_TTL_SECONDS = 10 * 60;

function businessChatGPTISOAfter(seconds) {
  return new Date(Date.now() + Number(seconds || 0) * 1000).toISOString();
}

function businessChatGPTNormalizeOAuthScopes(value, allowDefault = false) {
  const raw = cleanText(value, 600);
  if (!raw && allowDefault) return [...BUSINESS_CHATGPT_OAUTH_SCOPES];
  const allowed = new Set(BUSINESS_CHATGPT_OAUTH_SCOPES);
  const scopes = [];
  for (const scope of String(raw || '').split(/\s+/).filter(Boolean)) {
    if (!allowed.has(scope)) return null;
    if (!scopes.includes(scope)) scopes.push(scope);
  }
  return scopes;
}

function businessChatGPTAllowedOAuthClientID(value) {
  const clientID = cleanText(value, 1200);
  if (!clientID) return false;
  try {
    const url = new URL(clientID);
    return url.protocol === 'https:' && url.hostname === 'chatgpt.com';
  } catch (_) {
    return false;
  }
}

function businessChatGPTAllowedOAuthRedirect(value) {
  const redirect = cleanText(value, 1600);
  if (!redirect) return false;
  try {
    const url = new URL(redirect);
    return url.protocol === 'https:' && url.hostname === 'chatgpt.com';
  } catch (_) {
    return false;
  }
}

async function businessChatGPTPKCEChallenge(verifier) {
  const data = new TextEncoder().encode(String(verifier || ''));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return base64urlBytes(digest);
}

function businessChatGPTOAuthError(code, description, status = 400) {
  return json({ error: code, error_description: description }, status);
}

function businessChatGPTOAuthChallenge(description = 'Connect Iumrah Business Hotels to continue.') {
  const safe = String(description || '').replaceAll('"', "'");
  return `Bearer resource_metadata="${BUSINESS_CHATGPT_OAUTH_RESOURCE_METADATA_URL}", scope="hotels.read", error="invalid_token", error_description="${safe}"`;
}

async function businessChatGPTHotelOAuthWellKnown(request, env, url) {
  if (request.method !== 'GET') return new Response(null, { status: 405, headers: { allow: 'GET' } });
  if (url.pathname.startsWith('/.well-known/oauth-protected-resource')) {
    return json({
      resource: BUSINESS_CHATGPT_MCP_URL,
      authorization_servers: [BUSINESS_CHATGPT_OAUTH_ISSUER],
      scopes_supported: BUSINESS_CHATGPT_OAUTH_SCOPES,
      resource_documentation: 'https://iumrah.app/support',
      resource_policy_uri: 'https://iumrah.app/privacy',
      resource_tos_uri: 'https://iumrah.app/terms'
    });
  }
  if (url.pathname === '/.well-known/oauth-authorization-server') {
    return json({
      issuer: BUSINESS_CHATGPT_OAUTH_ISSUER,
      authorization_endpoint: BUSINESS_CHATGPT_OAUTH_AUTHORIZE_URL,
      token_endpoint: BUSINESS_CHATGPT_OAUTH_TOKEN_URL,
      client_id_metadata_document_supported: true,
      token_endpoint_auth_methods_supported: ['none'],
      code_challenge_methods_supported: ['S256'],
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      scopes_supported: BUSINESS_CHATGPT_OAUTH_SCOPES
    });
  }
  return json({ ok: false, error: 'NOT_FOUND' }, 404);
}

async function businessChatGPTCreateOAuthCode(env, { clientID, redirectURI, resource, scopes, codeChallenge }) {
  const code = randomToken(32);
  const codeHash = await sha256Hex(code);
  const now = new Date().toISOString();
  await env.HOTELS_DB.prepare(`
    INSERT INTO business_chatgpt_oauth_codes(
      code_hash, client_id, redirect_uri, resource, scope, code_challenge, expires_at, used_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)
  `).bind(
    codeHash,
    clientID,
    redirectURI,
    resource,
    scopes.join(' '),
    codeChallenge,
    businessChatGPTISOAfter(BUSINESS_CHATGPT_OAUTH_CODE_TTL_SECONDS),
    now
  ).run();
  return code;
}

async function businessChatGPTIssueOAuthTokens(env, { clientID, resource, scopes, includeRefresh = true }) {
  const now = new Date().toISOString();
  const accessToken = randomToken(40);
  const accessHash = await sha256Hex(accessToken);
  await env.HOTELS_DB.prepare(`
    INSERT INTO business_chatgpt_oauth_tokens(token_hash, token_type, client_id, resource, scope, expires_at, last_used_at, created_at)
    VALUES (?, 'access', ?, ?, ?, ?, NULL, ?)
  `).bind(
    accessHash,
    clientID,
    resource,
    scopes.join(' '),
    businessChatGPTISOAfter(BUSINESS_CHATGPT_OAUTH_ACCESS_TTL_SECONDS),
    now
  ).run();

  let refreshToken = null;
  if (includeRefresh && scopes.includes('offline_access')) {
    refreshToken = randomToken(48);
    const refreshHash = await sha256Hex(refreshToken);
    await env.HOTELS_DB.prepare(`
      INSERT INTO business_chatgpt_oauth_tokens(token_hash, token_type, client_id, resource, scope, expires_at, last_used_at, created_at)
      VALUES (?, 'refresh', ?, ?, ?, ?, NULL, ?)
    `).bind(
      refreshHash,
      clientID,
      resource,
      scopes.join(' '),
      businessChatGPTISOAfter(BUSINESS_CHATGPT_OAUTH_REFRESH_TTL_SECONDS),
      now
    ).run();
  }

  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: BUSINESS_CHATGPT_OAUTH_ACCESS_TTL_SECONDS,
    scope: scopes.join(' '),
    ...(refreshToken ? { refresh_token: refreshToken } : {})
  };
}

async function businessChatGPTValidateOAuthAccessToken(request, env) {
  const header = cleanText(request.headers.get('authorization'), 4096);
  if (!header.toLowerCase().startsWith('bearer ')) return false;
  const token = header.slice(7).trim();
  if (!token) return false;
  const tokenHash = await sha256Hex(token);
  const row = await env.HOTELS_DB.prepare(`
    SELECT token_hash, resource, scope, expires_at
    FROM business_chatgpt_oauth_tokens
    WHERE token_hash=? AND token_type='access'
    LIMIT 1
  `).bind(tokenHash).first().catch(() => null);
  if (!row || row.resource !== BUSINESS_CHATGPT_MCP_URL || Date.parse(row.expires_at || '') <= Date.now()) return false;
  const scopes = businessChatGPTNormalizeOAuthScopes(row.scope) || [];
  if (!scopes.includes('hotels.read')) return false;
  await env.HOTELS_DB.prepare('UPDATE business_chatgpt_oauth_tokens SET last_used_at=? WHERE token_hash=?')
    .bind(new Date().toISOString(), tokenHash).run().catch(() => {});
  return true;
}

async function businessChatGPTHotelOAuth(request, env, url, parts) {
  const action = cleanText(parts?.[0], 80);
  if (action === 'authorize') {
    if (request.method !== 'GET') return methodNotAllowed();
    if (!(await businessChatGPTHotelAccessEnabled(env))) {
      return new Response(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Iumrah Business</title><body style="font-family:-apple-system;padding:32px;max-width:640px;margin:auto"><h1>ChatGPT access is closed</h1><p>Open “ChatGPT access” in Iumrah Business, then connect again. There is no snapshot, date limit, or expiring access link.</p></body>`, { status: 403, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
    }
    const responseType = cleanText(url.searchParams.get('response_type'), 80);
    const clientID = cleanText(url.searchParams.get('client_id'), 1200);
    const redirectURI = cleanText(url.searchParams.get('redirect_uri'), 1600);
    const resource = cleanText(url.searchParams.get('resource'), 1600) || BUSINESS_CHATGPT_MCP_URL;
    const state = cleanText(url.searchParams.get('state'), 2000);
    const codeChallenge = cleanText(url.searchParams.get('code_challenge'), 300);
    const codeChallengeMethod = cleanText(url.searchParams.get('code_challenge_method'), 40);
    const scopes = businessChatGPTNormalizeOAuthScopes(url.searchParams.get('scope'), true);
    if (responseType !== 'code') return businessChatGPTOAuthError('unsupported_response_type', 'Only authorization code is supported.');
    if (!businessChatGPTAllowedOAuthClientID(clientID)) return businessChatGPTOAuthError('invalid_client', 'ChatGPT client_id is required.');
    if (!businessChatGPTAllowedOAuthRedirect(redirectURI)) return businessChatGPTOAuthError('invalid_request', 'ChatGPT redirect_uri is required.');
    if (resource !== BUSINESS_CHATGPT_MCP_URL) return businessChatGPTOAuthError('invalid_target', 'Unexpected MCP resource.');
    if (!scopes) return businessChatGPTOAuthError('invalid_scope', 'Unsupported OAuth scope.');
    if (codeChallengeMethod !== 'S256' || !/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge)) {
      return businessChatGPTOAuthError('invalid_request', 'PKCE S256 is required.');
    }
    const code = await businessChatGPTCreateOAuthCode(env, { clientID, redirectURI, resource, scopes, codeChallenge });
    const target = new URL(redirectURI);
    target.searchParams.set('code', code);
    if (state) target.searchParams.set('state', state);
    target.searchParams.set('iss', BUSINESS_CHATGPT_OAUTH_ISSUER);
    return Response.redirect(target.toString(), 302);
  }

  if (action === 'token') {
    if (request.method !== 'POST') return methodNotAllowed();
    const form = new URLSearchParams(await request.text());
    const grantType = cleanText(form.get('grant_type'), 80);
    const clientID = cleanText(form.get('client_id'), 1200);
    const resource = cleanText(form.get('resource'), 1600) || BUSINESS_CHATGPT_MCP_URL;
    if (!businessChatGPTAllowedOAuthClientID(clientID)) return businessChatGPTOAuthError('invalid_client', 'ChatGPT client_id is required.', 401);
    if (resource !== BUSINESS_CHATGPT_MCP_URL) return businessChatGPTOAuthError('invalid_target', 'Unexpected MCP resource.');

    if (grantType === 'authorization_code') {
      const code = cleanText(form.get('code'), 1600);
      const redirectURI = cleanText(form.get('redirect_uri'), 1600);
      const verifier = cleanText(form.get('code_verifier'), 300);
      if (!code || !redirectURI || !verifier) return businessChatGPTOAuthError('invalid_request', 'code, redirect_uri and code_verifier are required.');
      const codeHash = await sha256Hex(code);
      const row = await env.HOTELS_DB.prepare(`
        SELECT * FROM business_chatgpt_oauth_codes WHERE code_hash=? LIMIT 1
      `).bind(codeHash).first().catch(() => null);
      if (!row || row.used_at || Date.parse(row.expires_at || '') <= Date.now()) return businessChatGPTOAuthError('invalid_grant', 'Authorization code is invalid or expired.');
      if (row.client_id !== clientID || row.redirect_uri !== redirectURI || row.resource !== resource) return businessChatGPTOAuthError('invalid_grant', 'Authorization code context does not match.');
      if (await businessChatGPTPKCEChallenge(verifier) !== row.code_challenge) return businessChatGPTOAuthError('invalid_grant', 'PKCE verification failed.');
      const consumed = await env.HOTELS_DB.prepare('UPDATE business_chatgpt_oauth_codes SET used_at=? WHERE code_hash=? AND used_at IS NULL')
        .bind(new Date().toISOString(), codeHash).run();
      if (Number(consumed?.meta?.changes || 0) !== 1) return businessChatGPTOAuthError('invalid_grant', 'Authorization code has already been used.');
      const scopes = businessChatGPTNormalizeOAuthScopes(row.scope, true) || [...BUSINESS_CHATGPT_OAUTH_SCOPES];
      return json(await businessChatGPTIssueOAuthTokens(env, { clientID, resource, scopes }));
    }

    if (grantType === 'refresh_token') {
      const refreshToken = cleanText(form.get('refresh_token'), 1800);
      if (!refreshToken) return businessChatGPTOAuthError('invalid_request', 'refresh_token is required.');
      const tokenHash = await sha256Hex(refreshToken);
      const row = await env.HOTELS_DB.prepare(`
        SELECT * FROM business_chatgpt_oauth_tokens
        WHERE token_hash=? AND token_type='refresh' LIMIT 1
      `).bind(tokenHash).first().catch(() => null);
      if (!row || row.client_id !== clientID || row.resource !== resource || Date.parse(row.expires_at || '') <= Date.now()) {
        return businessChatGPTOAuthError('invalid_grant', 'Refresh token is invalid or expired.');
      }
      await env.HOTELS_DB.prepare('UPDATE business_chatgpt_oauth_tokens SET last_used_at=? WHERE token_hash=?')
        .bind(new Date().toISOString(), tokenHash).run().catch(() => {});
      const scopes = businessChatGPTNormalizeOAuthScopes(row.scope, true) || [...BUSINESS_CHATGPT_OAUTH_SCOPES];
      return json(await businessChatGPTIssueOAuthTokens(env, { clientID, resource, scopes, includeRefresh: false }));
    }

    return businessChatGPTOAuthError('unsupported_grant_type', 'Only authorization_code and refresh_token are supported.');
  }

  return json({ ok: false, error: 'NOT_FOUND' }, 404);
}

const BUSINESS_CHATGPT_HOTEL_SCHEMA = 'iumrah.business-hotels.live.v1';
const BUSINESS_CHATGPT_PRICE_UPDATE_SCHEMA = 'iumrah.hotel-price-update.v3';

async function businessChatGPTHotelAccessRow(env) {
  return env.HOTELS_DB.prepare(`
    SELECT enabled, updated_by, enabled_at, disabled_at, updated_at
    FROM business_chatgpt_hotel_access
    WHERE id='global'
    LIMIT 1
  `).first().catch(() => null);
}

async function businessChatGPTHotelAccessEnabled(env) {
  const row = await businessChatGPTHotelAccessRow(env);
  return Number(row?.enabled || 0) === 1;
}

async function businessChatGPTHotelRows(env) {
  const result = await env.HOTELS_DB.prepare(`
    SELECT
      h.id, h.slug, h.name, h.city, h.stars, h.status, h.created_at, h.updated_at,
      EXISTS (SELECT 1 FROM primary_hotels p WHERE p.hotel_id=h.id) AS is_primary,
      hps.source_id AS locked_source_id,
      hps.provider AS locked_source_provider,
      hps.source_url AS locked_source_url,
      ${HOTEL_PRICE_SELECT}
    FROM hotels h
    LEFT JOIN hotel_price_cache hp ON hp.hotel_id=h.id
    LEFT JOIN hotel_price_overrides hpo ON hpo.hotel_id=h.id
    LEFT JOIN hotel_price_sources hps ON hps.hotel_id=h.id
    ORDER BY h.city COLLATE NOCASE ASC, h.name COLLATE NOCASE ASC
  `).all();

  return (result.results || []).map(row => {
    const city = normalizedHotelSyncCity(row.city) || cleanText(row.city, 120) || null;
    const price = hotelPriceFromRow(row);
    const sourceURL = price?.sourceURL || row.locked_source_url || null;
    const provider = normalizedHotelSyncProvider(price?.provider || row.locked_source_provider, sourceURL);
    const propertyIdentity = sourceURL && provider ? hotelSyncPropertyIdentity(sourceURL, provider) : null;
    const currentNightly = Number(price?.nightlyUSD);
    const sourceNightly = Number(price?.sourceNightlyUSD);
    const manualNightly = Number(row.price_manual_nightly_usd);
    return {
      hotel_id: row.id,
      hotel_name: row.name,
      is_primary: Number(row.is_primary || 0) === 1,
      slug: row.slug || null,
      city,
      stars: Number.isFinite(Number(row.stars)) ? Number(row.stars) : null,
      catalog_status: row.status || null,
      current_nightly_usd: Number.isFinite(currentNightly) && currentNightly > 0 ? Math.round(currentNightly * 100) / 100 : null,
      source_nightly_usd: Number.isFinite(sourceNightly) && sourceNightly > 0 ? Math.round(sourceNightly * 100) / 100 : null,
      manual_override_nightly_usd: Number.isFinite(manualNightly) && manualNightly > 0 ? Math.round(manualNightly * 100) / 100 : null,
      currency: 'USD',
      price_status: price?.sourceStatus || price?.status || null,
      price_method: price?.method || null,
      provider: provider || null,
      source_url: sourceURL || null,
      property_identity: propertyIdentity,
      last_price_fetched_at: price?.fetchedAt || null,
      price_expires_at: price?.sourceExpiresAt || null,
      last_price_attempt_at: price?.lastAttemptAt || null,
      price_error: price?.sourceError || null,
      quote_check_in: price?.checkIn || null,
      quote_check_out: price?.checkOut || null,
      quote_adults: price?.adults || null,
      quote_rooms: price?.rooms || null,
      hotel_updated_at: row.updated_at || null
    };
  });
}

function businessChatGPTHotelMonitoringContract() {
  return {
    access_policy: 'This is a live internal feed. There is no snapshot id, bearer link, TTL, read limit, or date gate. Access exists only while the operator keeps ChatGPT access enabled in iumrah Business.',
    source_of_truth: 'Read all published hotel rows and current prices directly from live HOTELS_DB every time. Primary Hotels are included for operator-driven manual price refresh; they are never placed into automatic provider monitoring.',
    direct_json_apply: true,
    update_key: 'hotel_id',
    price_rule: 'Return the best usable nightly price in new_nightly_usd. If the observed price is in SAR, new_nightly_usd may be observed_nightly_amount / 3.75. provider/source/confidence/old price are audit metadata only and do not block an operator-confirmed update.',
    apply_rule: 'After the operator selects hotels, the server writes the supplied usable price by hotel_id. Non-Primary hotels update hotel_price_cache. Primary Hotels write the same operator-confirmed value to hotel_price_overrides, preserving the manual-only Primary pricing contract.',
    result_schema: BUSINESS_CHATGPT_PRICE_UPDATE_SCHEMA
  };
}

function businessChatGPTHotelResultTemplate() {
  return {
    schema: BUSINESS_CHATGPT_PRICE_UPDATE_SCHEMA,
    version: 3,
    checked_at: 'ISO-8601 timestamp',
    hotels: [{
      hotel_id: 'copy from live feed',
      hotel_name: 'copy from live feed',
      city: 'Makkah | Madinah',
      status: 'changed | unchanged | unverified',
      old_nightly_usd: 'optional audit value; may copy current_nightly_usd',
      new_nightly_usd: 'preferred usable USD nightly price; this is the direct update value',
      observed_nightly_amount: 'optional observed amount; used as fallback when new_nightly_usd is null',
      observed_currency: 'USD or SAR when observed_nightly_amount is used',
      provider: 'optional audit metadata',
      source_url: 'optional audit metadata',
      checked_source_url: 'optional audit metadata',
      observed_check_in: 'optional YYYY-MM-DD; audit only',
      observed_check_out: 'optional YYYY-MM-DD; audit only',
      confidence: 'optional audit metadata',
      reason: 'optional note',
      checked_at: 'ISO-8601 timestamp'
    }]
  };
}

async function businessPrimaryHotelCount(env) {
  const row = await env.HOTELS_DB.prepare('SELECT COUNT(DISTINCT hotel_id) AS count FROM primary_hotels').first().catch(() => null);
  return Math.max(0, Number(row?.count || 0));
}

async function businessChatGPTHotelFeedPayload(env) {
  const hotels = await businessChatGPTHotelRows(env);
  const primaryHotelCount = await businessPrimaryHotelCount(env);
  const makkahCount = hotels.filter(item => normalizedHotelSyncCity(item.city) === 'Makkah').length;
  const madinahCount = hotels.filter(item => normalizedHotelSyncCity(item.city) === 'Madinah').length;
  const generatedAt = new Date().toISOString();
  return {
    ok: true,
    schema: BUSINESS_CHATGPT_HOTEL_SCHEMA,
    version: 1,
    internal: true,
    live: true,
    source: 'iumrah_business_HOTELS_DB',
    generated_at: generatedAt,
    expires_at: null,
    snapshot_id: null,
    date_gate: false,
    price_scope: 'all_hotels_primary_manual_override',
    hotel_count: hotels.length,
    primary_hotel_count: primaryHotelCount,
    excluded_primary_hotel_count: 0,
    city_counts: { Makkah: makkahCount, Madinah: madinahCount },
    monitoring_rules: businessChatGPTHotelMonitoringContract(),
    result_template: businessChatGPTHotelResultTemplate(),
    hotels
  };
}

async function businessChatGPTHotelAccessStatus(env) {
  const row = await businessChatGPTHotelAccessRow(env);
  const hotels = await businessChatGPTHotelRows(env).catch(() => []);
  const primaryHotelCount = await businessPrimaryHotelCount(env);
  const enabled = Number(row?.enabled || 0) === 1;
  return json({
    ok: true,
    enabled,
    readOnly: true,
    live: true,
    source: 'iumrah_business_HOTELS_DB',
    hotelCount: hotels.length,
    primaryHotelCount,
    makkahCount: hotels.filter(item => normalizedHotelSyncCity(item.city) === 'Makkah').length,
    madinahCount: hotels.filter(item => normalizedHotelSyncCity(item.city) === 'Madinah').length,
    enabledAt: row?.enabled_at || null,
    disabledAt: row?.disabled_at || null,
    updatedAt: row?.updated_at || null,
    note: enabled
      ? 'ChatGPT live access is open for all hotels. Primary Hotels are included for operator-confirmed price collection and are saved as manual overrides; automatic monitoring remains disabled for them.'
      : 'ChatGPT live access is closed.'
  });
}

async function setBusinessChatGPTHotelAccess(env, user, enabled) {
  const actor = businessStaffLogin(user) || 'admin';
  const now = new Date().toISOString();
  await env.HOTELS_DB.prepare(`
    INSERT INTO business_chatgpt_hotel_access(id, enabled, updated_by, enabled_at, disabled_at, updated_at)
    VALUES('global', ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      enabled=excluded.enabled,
      updated_by=excluded.updated_by,
      enabled_at=CASE WHEN excluded.enabled=1 THEN excluded.enabled_at ELSE business_chatgpt_hotel_access.enabled_at END,
      disabled_at=CASE WHEN excluded.enabled=0 THEN excluded.disabled_at ELSE NULL END,
      updated_at=excluded.updated_at
  `).bind(enabled ? 1 : 0, actor, enabled ? now : null, enabled ? null : now, now).run();
  return businessChatGPTHotelAccessStatus(env);
}

async function businessChatGPTHotelFeedResponse(env, url = null) {
  const payload = await businessChatGPTHotelFeedPayload(env);
  const rawCity = url?.searchParams?.get('city');
  const requestedCity = normalizedHotelSyncCity(rawCity);
  if (rawCity && !requestedCity) return json({ ok: false, error: 'CHATGPT_HOTEL_INVALID_CITY' }, 400);
  if (requestedCity) {
    payload.hotels = payload.hotels.filter(item => normalizedHotelSyncCity(item.city) === requestedCity);
    payload.hotel_count = payload.hotels.length;
    payload.city_filter = requestedCity;
    payload.city_counts = {
      Makkah: requestedCity === 'Makkah' ? payload.hotel_count : 0,
      Madinah: requestedCity === 'Madinah' ? payload.hotel_count : 0
    };
  }
  return new Response(`${JSON.stringify(payload, null, 2)}\n`, {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
      'pragma': 'no-cache',
      'expires': '0',
      'x-content-type-options': 'nosniff'
    }
  });
}

async function publicBusinessChatGPTHotelFeed(env, url) {
  if (!(await businessChatGPTHotelAccessEnabled(env))) {
    return json({ ok: false, error: 'CHATGPT_HOTEL_ACCESS_DISABLED' }, 403);
  }
  const payload = await businessChatGPTHotelFeedPayload(env);
  const requestedCity = normalizedHotelSyncCity(url?.searchParams?.get('city'));
  if (url?.searchParams?.get('city') && !requestedCity) return json({ ok: false, error: 'CHATGPT_HOTEL_INVALID_CITY' }, 400);
  if (requestedCity) {
    payload.hotels = payload.hotels.filter(item => normalizedHotelSyncCity(item.city) === requestedCity);
    payload.hotel_count = payload.hotels.length;
  }
  return new Response(`${JSON.stringify(payload, null, 2)}\n`, {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
      'pragma': 'no-cache',
      'expires': '0',
      'x-content-type-options': 'nosniff'
    }
  });
}

function chatGPTHotelMCPToolDescriptor(name, description, inputSchema) {
  return {
    name,
    description,
    inputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    securitySchemes: [{ type: 'oauth2', scopes: ['hotels.read'] }],
    _meta: { securitySchemes: [{ type: 'oauth2', scopes: ['hotels.read'] }] }
  };
}

function businessChatGPTHotelMCPTools() {
  return [
    chatGPTHotelMCPToolDescriptor(
      'list_internal_hotel_databases',
      'Read the current internal Iumrah Business hotel database summary for Makkah and Madinah. Data is live and has no snapshot/date gate.',
      { type: 'object', properties: {}, additionalProperties: false }
    ),
    chatGPTHotelMCPToolDescriptor(
      'search_internal_hotels',
      'Search live internal Iumrah Business hotels and internal nightly prices. Use for operational hotel/price questions.',
      {
        type: 'object',
        properties: {
          city: { type: 'string', enum: ['Makkah', 'Madinah'] },
          query: { type: 'string' },
          stars: { type: 'integer', minimum: 1, maximum: 5 },
          has_price: { type: 'boolean' },
          limit: { type: 'integer', minimum: 1, maximum: 200, default: 100 }
        },
        additionalProperties: false
      }
    ),
    chatGPTHotelMCPToolDescriptor(
      'get_internal_hotel',
      'Get the full live internal hotel record, internal price, provider identity, and source URL for one Iumrah Business hotel.',
      {
        type: 'object',
        required: ['hotel_id'],
        properties: { hotel_id: { type: 'string', minLength: 1 } },
        additionalProperties: false
      }
    ),
    chatGPTHotelMCPToolDescriptor(
      'export_internal_hotel_prices',
      'Export the live Iumrah Business hotel-price JSON used for monitoring and comparison. Includes the strict v3 result template for returning updated prices.',
      {
        type: 'object',
        properties: { city: { type: 'string', enum: ['Makkah', 'Madinah'] } },
        additionalProperties: false
      }
    )
  ];
}

function mcpJSONRPCResult(id, result) {
  return json({ jsonrpc: '2.0', id, result });
}

function mcpJSONRPCError(id, code, message) {
  return json({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
}

function mcpToolResult(payload) {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
    isError: false
  };
}

async function businessChatGPTHotelMCP(request, env) {
  if (request.method === 'GET') return methodNotAllowed();
  if (request.method !== 'POST') return methodNotAllowed();
  if (!(await businessChatGPTHotelAccessEnabled(env))) {
    return json({ ok: false, error: 'CHATGPT_HOTEL_ACCESS_DISABLED' }, 403);
  }
  if (!(await businessChatGPTValidateOAuthAccessToken(request, env))) {
    return json({ ok: false, error: 'CHATGPT_OAUTH_REQUIRED' }, 401, {
      'www-authenticate': businessChatGPTOAuthChallenge()
    });
  }

  const parsed = await readJSON(request, 1_000_000);
  if (!parsed.ok) return parsed.response;
  const rpc = parsed.value || {};
  const id = rpc.id ?? null;
  const method = cleanText(rpc.method, 120);

  if (method === 'notifications/initialized' || (id === null && String(method || '').startsWith('notifications/'))) {
    return new Response(null, { status: 202 });
  }
  if (method === 'initialize') {
    const requestedVersion = cleanText(rpc.params?.protocolVersion, 80) || '2025-06-18';
    return mcpJSONRPCResult(id, {
      protocolVersion: requestedVersion,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'Iumrah Business Hotels', version: '1.0.0' },
      instructions: 'Private operational hotel database access. All hotel and price data is live from Iumrah Business HOTELS_DB. No snapshots or date gates are used.'
    });
  }
  if (method === 'ping') return mcpJSONRPCResult(id, {});
  if (method === 'tools/list') return mcpJSONRPCResult(id, { tools: businessChatGPTHotelMCPTools() });
  if (method !== 'tools/call') return mcpJSONRPCError(id, -32601, 'Method not found');

  const toolName = cleanText(rpc.params?.name, 120);
  const args = rpc.params?.arguments && typeof rpc.params.arguments === 'object' ? rpc.params.arguments : {};
  const hotels = await businessChatGPTHotelRows(env);

  if (toolName === 'list_internal_hotel_databases') {
    const payload = {
      ok: true,
      source: 'iumrah_business_HOTELS_DB',
      live: true,
      snapshot_id: null,
      date_gate: false,
      total_hotels: hotels.length,
      databases: [
        { city: 'Makkah', hotel_count: hotels.filter(item => normalizedHotelSyncCity(item.city) === 'Makkah').length },
        { city: 'Madinah', hotel_count: hotels.filter(item => normalizedHotelSyncCity(item.city) === 'Madinah').length }
      ]
    };
    return mcpJSONRPCResult(id, mcpToolResult(payload));
  }

  if (toolName === 'search_internal_hotels') {
    const city = args.city ? normalizedHotelSyncCity(args.city) : '';
    if (args.city && !city) return mcpJSONRPCError(id, -32602, 'Invalid city');
    const query = cleanText(args.query, 240)?.toLowerCase() || '';
    const stars = Number.isFinite(Number(args.stars)) ? Math.trunc(Number(args.stars)) : null;
    const hasPrice = typeof args.has_price === 'boolean' ? args.has_price : null;
    const limit = Math.max(1, Math.min(200, Math.trunc(Number(args.limit || 100))));
    const filtered = hotels.filter(item => {
      if (city && normalizedHotelSyncCity(item.city) !== city) return false;
      if (query && !`${item.hotel_name || ''} ${item.hotel_id || ''}`.toLowerCase().includes(query)) return false;
      if (stars && Number(item.stars) !== stars) return false;
      if (hasPrice !== null && Boolean(Number.isFinite(Number(item.current_nightly_usd)) && Number(item.current_nightly_usd) > 0) !== hasPrice) return false;
      return true;
    }).slice(0, limit);
    return mcpJSONRPCResult(id, mcpToolResult({ ok: true, live: true, count: filtered.length, hotels: filtered }));
  }

  if (toolName === 'get_internal_hotel') {
    const hotelID = cleanText(args.hotel_id, 220);
    if (!hotelID) return mcpJSONRPCError(id, -32602, 'hotel_id is required');
    const hotel = hotels.find(item => item.hotel_id === hotelID);
    if (!hotel) return mcpJSONRPCResult(id, { content: [{ type: 'text', text: 'Hotel not found' }], isError: true });
    return mcpJSONRPCResult(id, mcpToolResult({ ok: true, live: true, hotel }));
  }

  if (toolName === 'export_internal_hotel_prices') {
    const city = args.city ? normalizedHotelSyncCity(args.city) : '';
    if (args.city && !city) return mcpJSONRPCError(id, -32602, 'Invalid city');
    const payload = await businessChatGPTHotelFeedPayload(env);
    if (city) {
      payload.hotels = payload.hotels.filter(item => normalizedHotelSyncCity(item.city) === city);
      payload.hotel_count = payload.hotels.length;
    }
    return mcpJSONRPCResult(id, mcpToolResult(payload));
  }

  return mcpJSONRPCError(id, -32602, 'Unknown tool');
}

function normalizedBusinessChatGPTPriceUpdateItem(value) {
  if (!value || typeof value !== 'object') return null;
  const hotelID = cleanText(value.hotel_id || value.hotelID, 220);
  if (!hotelID) return null;
  const city = normalizedHotelSyncCity(value.city) || cleanText(value.city, 120) || null;
  const status = cleanText(value.status, 40)?.toLowerCase() || 'changed';
  const oldRaw = value.old_nightly_usd ?? value.oldNightlyUSD;
  const newRaw = value.new_nightly_usd ?? value.newNightlyUSD;
  const sourceURL = safeHotelSyncSourceURL(value.source_url || value.sourceURL);
  const checkedSourceURL = safeHotelSyncSourceURL(value.checked_source_url || value.checkedSourceURL);
  const observedAmountRaw = value.observed_nightly_amount ?? value.observedNightlyAmount;
  const observedAmount = observedAmountRaw === null || observedAmountRaw === undefined || observedAmountRaw === '' ? null : Number(observedAmountRaw);
  const observedCurrency = cleanText(value.observed_currency || value.observedCurrency, 12)?.toUpperCase() || null;
  let nextPrice = newRaw === null || newRaw === undefined || newRaw === '' ? null : Number(newRaw);
  if (!(Number.isFinite(nextPrice) && nextPrice > 0) && Number.isFinite(observedAmount) && observedAmount > 0) {
    if (observedCurrency === 'SAR') nextPrice = observedAmount / 3.75;
    else if (!observedCurrency || observedCurrency === 'USD') nextPrice = observedAmount;
  }
  if (Number.isFinite(nextPrice) && nextPrice > 0) nextPrice = Math.round(nextPrice * 100) / 100;
  else nextPrice = null;

  return {
    hotel_id: hotelID,
    hotel_name: safeHumanText(value.hotel_name || value.hotelName, 300) || null,
    city,
    status,
    old_nightly_usd: oldRaw === null || oldRaw === undefined || oldRaw === '' ? null : Number(oldRaw),
    new_nightly_usd: nextPrice,
    observed_nightly_amount: Number.isFinite(observedAmount) && observedAmount > 0 ? observedAmount : null,
    observed_currency: observedCurrency,
    provider: normalizedHotelSyncProvider(value.provider, checkedSourceURL || sourceURL),
    source_url: sourceURL,
    checked_source_url: checkedSourceURL,
    observed_check_in: validLocalDate(value.observed_check_in || value.observedCheckIn),
    observed_check_out: validLocalDate(value.observed_check_out || value.observedCheckOut),
    confidence: cleanText(value.confidence, 40)?.toLowerCase() || null,
    reason: safeHumanText(value.reason, 700) || null,
    checked_at: cleanText(value.checked_at || value.checkedAt, 80) || null
  };
}

async function applyBusinessChatGPTHotelUpdates(request, env, user) {
  if (!businessStaffLogin(user)) return json({ ok: false, error: 'CHATGPT_HOTEL_ADMIN_REQUIRED' }, 403);
  const parsed = await readJSON(request, 1_500_000);
  if (!parsed.ok) return parsed.response;
  const document = parsed.value?.result;
  if (!document || document.schema !== BUSINESS_CHATGPT_PRICE_UPDATE_SCHEMA) {
    return json({ ok: false, error: 'CHATGPT_HOTEL_INVALID_RESULT_SCHEMA' }, 400);
  }

  const updates = Array.isArray(document.hotels) ? document.hotels.map(normalizedBusinessChatGPTPriceUpdateItem).filter(Boolean) : [];
  const updateByID = new Map(updates.map(item => [item.hotel_id, item]));
  const selectedIDs = Array.isArray(parsed.value?.hotel_ids)
    ? parsed.value.hotel_ids.map(item => cleanText(item, 220)).filter(Boolean)
    : updates.filter(item => Number.isFinite(Number(item.new_nightly_usd)) && Number(item.new_nightly_usd) > 0).map(item => item.hotel_id);
  if (!selectedIDs.length) return json({ ok: false, error: 'CHATGPT_HOTEL_NO_SELECTION' }, 400);

  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + HOTEL_PRICE_TTL_MS).toISOString();
  const applied = [];
  const rejected = [];

  for (const hotelID of selectedIDs) {
    const update = updateByID.get(hotelID);
    if (!update) { rejected.push({ hotelID, error: 'CHATGPT_HOTEL_ITEM_NOT_FOUND' }); continue; }

    const nextPrice = Number(update.new_nightly_usd);
    if (!Number.isFinite(nextPrice) || nextPrice <= 0 || nextPrice >= 100000) {
      rejected.push({ hotelID, error: 'CHATGPT_HOTEL_INVALID_NEW_PRICE' });
      continue;
    }
    const hotel = await env.HOTELS_DB.prepare('SELECT id FROM hotels WHERE id=? LIMIT 1').bind(hotelID).first().catch(() => null);
    if (!hotel) { rejected.push({ hotelID, error: 'HOTEL_NOT_FOUND' }); continue; }

    if (await isPrimaryHotel(env, hotelID)) {
      const roundedPrice = Math.round(nextPrice * 100) / 100;
      await env.HOTELS_DB.prepare(`
        INSERT INTO hotel_price_overrides (hotel_id, nightly_price_usd, updated_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(hotel_id) DO UPDATE SET
          nightly_price_usd=excluded.nightly_price_usd,
          updated_by=excluded.updated_by,
          updated_at=excluded.updated_at
      `).bind(hotelID, roundedPrice, businessStaffLogin(user) || null, now, now).run();
      applied.push(hotelID);
      continue;
    }

    // Metadata is preserved when available, but it is never an authorization gate.
    const source = await ensureHotelPriceSourceLock(env, hotelID).catch(() => null);
    const sourceURL = source?.source_url || update.source_url || update.checked_source_url || null;
    const resolvedURL = update.checked_source_url || sourceURL || null;
    const provider = normalizedHotelSyncProvider(source?.provider || update.provider, sourceURL || resolvedURL) || null;
    const observedCheckIn = update.observed_check_in || null;
    const observedCheckOut = update.observed_check_out || null;
    const observedCurrency = /^[A-Z]{3}$/.test(update.observed_currency || '') ? update.observed_currency : 'USD';
    const observedAmount = Number(update.observed_nightly_amount);
    const amountOriginal = Number.isFinite(observedAmount) && observedAmount > 0 ? observedAmount : nextPrice;
    const roundedPrice = Math.round(nextPrice * 100) / 100;

    await env.HOTELS_DB.prepare(`
      INSERT INTO hotel_price_cache (
        hotel_id, source_id, provider, source_url, resolved_url,
        amount_original, currency_original, price_basis, nightly_price_usd, quote_total_usd,
        quote_check_in, quote_check_out, quote_nights, quote_adults, quote_rooms,
        confidence, method, status, fetched_at, expires_at, last_attempt_at, next_retry_at,
        last_http_status, error, pending_nightly_price_usd, pending_seen_count,
        pending_first_seen_at, pending_last_seen_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'nightly', ?, ?, ?, ?, NULL, NULL, NULL, 1.0, 'chatgpt-json-v3-direct', 'fresh', ?, ?, ?, NULL, 200, NULL, NULL, 0, NULL, NULL, ?, ?)
      ON CONFLICT(hotel_id) DO UPDATE SET
        source_id=COALESCE(excluded.source_id, hotel_price_cache.source_id),
        provider=COALESCE(excluded.provider, hotel_price_cache.provider),
        source_url=COALESCE(excluded.source_url, hotel_price_cache.source_url),
        resolved_url=COALESCE(excluded.resolved_url, hotel_price_cache.resolved_url),
        amount_original=excluded.amount_original,
        currency_original=excluded.currency_original,
        price_basis='nightly',
        nightly_price_usd=excluded.nightly_price_usd,
        quote_total_usd=excluded.quote_total_usd,
        quote_check_in=excluded.quote_check_in,
        quote_check_out=excluded.quote_check_out,
        quote_nights=NULL,
        quote_adults=NULL,
        quote_rooms=NULL,
        confidence=1.0,
        method='chatgpt-json-v3-direct',
        status='fresh',
        fetched_at=excluded.fetched_at,
        expires_at=excluded.expires_at,
        last_attempt_at=excluded.last_attempt_at,
        next_retry_at=NULL,
        last_http_status=200,
        error=NULL,
        pending_nightly_price_usd=NULL,
        pending_seen_count=0,
        pending_first_seen_at=NULL,
        pending_last_seen_at=NULL,
        updated_at=excluded.updated_at
    `).bind(
      hotelID,
      source?.source_id || null,
      provider,
      sourceURL,
      resolvedURL,
      amountOriginal,
      observedCurrency,
      roundedPrice,
      roundedPrice,
      observedCheckIn,
      observedCheckOut,
      now,
      expiresAt,
      now,
      now,
      now
    ).run();

    // JSON price becomes the active catalog price immediately.
    await env.HOTELS_DB.prepare('DELETE FROM hotel_price_overrides WHERE hotel_id=?').bind(hotelID).run();
    applied.push(hotelID);
  }

  return json({ ok: true, schema: BUSINESS_CHATGPT_PRICE_UPDATE_SCHEMA, applied, rejected, appliedCount: applied.length, rejectedCount: rejected.length });
}

const BUSINESS_FLIGHT_SYNC_VERSION = 1;
const BUSINESS_FLIGHT_SYNC_MAX_FLIGHTS = 500;

function businessFlightSyncOwner(user) {
  return businessStaffLogin(user);
}

function businessFlightSyncPublicURL(token) {
  // Backward-compatible legacy bearer URL. Never break already shared links.
  return `https://iumrah.app/api/catalog/hotels/flight-sync/${encodeURIComponent(token)}`;
}

async function businessFlightSyncStableID(owner) {
  // No expiry, public read-only link independent of access-token rotations.
  // Hash avoids putting the staff login itself in the public URL.
  return sha256Hex(`iumrah:public-flight-feed:v1:${owner}`);
}

async function businessFlightSyncStableURL(owner) {
  return `https://iumrah.app/flights-feed/${await businessFlightSyncStableID(owner)}`;
}

function normalizedIATA(value) {
  const code = String(value || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : '';
}

function normalizedCurrency(value) {
  const code = String(value || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : '';
}

function normalizedStringArray(value, limit, itemLimit = 80) {
  if (!Array.isArray(value)) return [];
  const result = [];
  for (const item of value) {
    const text = safeHumanText(item, itemLimit);
    if (!text || result.includes(text)) continue;
    result.push(text);
    if (result.length >= limit) break;
  }
  return result;
}

function normalizedFlightSyncLeg(value) {
  if (!value || typeof value !== 'object') return null;
  const origin = normalizedIATA(value.origin);
  const destination = normalizedIATA(value.destination);
  const flightNumber = cleanText(value.flight_number || value.flightNumber, 40)?.toUpperCase() || '';
  if (!origin || !destination || !flightNumber) return null;
  return {
    airline: safeHumanText(value.airline || '', 160) || null,
    airline_code: cleanText(value.airline_code || value.airlineCode, 12)?.toUpperCase() || null,
    flight_number: flightNumber,
    origin,
    destination,
    departure_at: cleanText(value.departure_at || value.departureAt, 80) || null,
    arrival_at: cleanText(value.arrival_at || value.arrivalAt, 80) || null,
    stops: Number.isFinite(Number(value.stops)) ? Math.max(0, Math.trunc(Number(value.stops))) : 0,
    cabin_class: cleanText(value.cabin_class || value.cabinClass, 40)?.toLowerCase() || 'economy'
  };
}

function normalizedFlightSyncItem(value) {
  if (!value || typeof value !== 'object') return null;
  const origin = normalizedIATA(value.from || value.origin);
  const destination = normalizedIATA(value.to || value.destination);
  const date = validLocalDate(value.date || value.outbound_date || value.outboundDate);
  const amount = Number(value?.price?.amount ?? value.per_traveler_fare ?? value.perTravelerFare);
  const currency = normalizedCurrency(value?.price?.currency ?? value.currency);
  if (!origin || !destination || !date || !Number.isFinite(amount) || amount < 0 || !currency) return null;

  const legs = Array.isArray(value.legs)
    ? value.legs.map(normalizedFlightSyncLeg).filter(Boolean).slice(0, 4)
    : [];

  return {
    id: cleanText(value.id, 180) || crypto.randomUUID(),
    comparison_key: cleanText(value.comparison_key || value.comparisonKey, 260) || null,
    from: origin,
    to: destination,
    date,
    airline_codes: normalizedStringArray(value.airline_codes || value.airlineCodes, 8, 12).map(x => x.toUpperCase()),
    airline_names: normalizedStringArray(value.airline_names || value.airlineNames, 8, 160),
    flight_numbers: normalizedStringArray(value.flight_numbers || value.flightNumbers, 8, 40).map(x => x.toUpperCase().replace(/\s+/g, '')),
    offer_type: cleanText(value.offer_type || value.offerType, 40)?.toLowerCase() || 'one_way',
    journey_role: cleanText(value.journey_role || value.journeyRole, 40)?.toLowerCase() || 'outbound',
    fare_scope: cleanText(value.fare_scope || value.fareScope, 40)?.toLowerCase() || null,
    price_type: cleanText(value.price_type || value.priceType, 40)?.toLowerCase() || null,
    price: { amount: Math.round(amount * 100) / 100, currency },
    observed_at: cleanText(value.observed_at || value.observedAt, 80) || null,
    legs
  };
}

async function businessFlightSyncStatus(env, user) {
  const owner = businessFlightSyncOwner(user);
  if (!owner) return json({ ok: false, error: 'FLIGHT_SYNC_OWNER_REQUIRED' }, 403);
  const row = await env.HOTELS_DB.prepare(`
    SELECT enabled, flight_count, snapshot_json, snapshot_updated_at, created_at, updated_at
    FROM business_flight_sync_feeds WHERE owner_login=? LIMIT 1
  `).bind(owner).first();
  const actualSnapshot = row ? parseBusinessFlightSnapshot(row) : null;
  return json({
    ok: true,
    configured: Boolean(row),
    enabled: Boolean(row && Number(row.enabled) === 1),
    // A fixed public URL is returned whenever the feed is enabled.
    // Fetching the URL never needs a session, API key or cookie.
    accessURL: row && Number(row.enabled) === 1 ? await businessFlightSyncStableURL(owner) : null,
    flightCount: actualSnapshot ? actualSnapshot.flights.length : 0,
    snapshotUpdatedAt: row?.snapshot_updated_at || null,
    createdAt: row?.created_at || null,
    updatedAt: row?.updated_at || null,
    readOnly: true
  });
}

async function rotateBusinessFlightSyncAccess(env, user) {
  const owner = businessFlightSyncOwner(user);
  if (!owner) return json({ ok: false, error: 'FLIGHT_SYNC_OWNER_REQUIRED' }, 403);
  // Creating access twice must not revoke links previously given to a monitor.
  const existing = await env.HOTELS_DB.prepare(`
    SELECT enabled FROM business_flight_sync_feeds WHERE owner_login=? LIMIT 1
  `).bind(owner).first();
  const now = new Date().toISOString();
  if (!existing || Number(existing.enabled) !== 1) {
    const token = randomToken(32);
    const tokenHash = await sha256Hex(token);
    await env.HOTELS_DB.prepare(`
      INSERT INTO business_flight_sync_feeds (
        owner_login, token_hash, enabled, snapshot_json, flight_count,
        snapshot_updated_at, created_at, updated_at
      ) VALUES (?, ?, 1, '{"version":1,"flights":[]}', 0, NULL, ?, ?)
      ON CONFLICT(owner_login) DO UPDATE SET
        token_hash=excluded.token_hash,
        enabled=1,
        updated_at=excluded.updated_at
    `).bind(owner, tokenHash, now, now).run();
  }
  return json({
    ok: true,
    readOnly: true,
    accessURL: await businessFlightSyncStableURL(owner),
    rotatedAt: null,
    note: 'Permanent read-only URL. Repeated access requests never rotate or expire it.'
  });
}

async function revokeBusinessFlightSyncAccess(env, user) {
  const owner = businessFlightSyncOwner(user);
  if (!owner) return json({ ok: false, error: 'FLIGHT_SYNC_OWNER_REQUIRED' }, 403);
  const now = new Date().toISOString();
  await env.HOTELS_DB.prepare(`
    UPDATE business_flight_sync_feeds SET enabled=0, updated_at=? WHERE owner_login=?
  `).bind(now, owner).run();
  return json({ ok: true, enabled: false, revokedAt: now });
}

async function saveBusinessFlightSyncSnapshot(request, env, user) {
  const owner = businessFlightSyncOwner(user);
  if (!owner) return json({ ok: false, error: 'FLIGHT_SYNC_OWNER_REQUIRED' }, 403);
  const existing = await env.HOTELS_DB.prepare(`
    SELECT enabled, flight_count, snapshot_json, snapshot_updated_at
    FROM business_flight_sync_feeds WHERE owner_login=? LIMIT 1
  `).bind(owner).first();
  if (!existing || Number(existing.enabled) !== 1) {
    return json({ ok: false, error: 'FLIGHT_SYNC_ACCESS_NOT_ENABLED' }, 409);
  }

  const raw = await request.text();
  if (raw.length > 600_000) return json({ ok: false, error: 'FLIGHT_SYNC_SNAPSHOT_TOO_LARGE' }, 413);
  let payload;
  try { payload = JSON.parse(raw); } catch { return json({ ok: false, error: 'INVALID_JSON' }, 400); }
  if (!Array.isArray(payload?.flights)) return json({ ok: false, error: 'FLIGHT_SYNC_FLIGHTS_REQUIRED' }, 400);
  if (payload.flights.length > BUSINESS_FLIGHT_SYNC_MAX_FLIGHTS) {
    return json({ ok: false, error: 'FLIGHT_SYNC_TOO_MANY_FLIGHTS', max: BUSINESS_FLIGHT_SYNC_MAX_FLIGHTS }, 400);
  }

  const flights = payload.flights.map(normalizedFlightSyncItem).filter(Boolean);
  if (flights.length !== payload.flights.length) {
    return json({ ok: false, error: 'FLIGHT_SYNC_INVALID_FLIGHT', accepted: flights.length, received: payload.flights.length }, 400);
  }

  // A transient empty/unloaded SwiftUI array must NEVER erase a previous
  // non-empty public snapshot. A drastic reduction is equally suspicious and
  // requires explicit operator confirmation via a separate future workflow.
  // This endpoint does not offer a force/clear flag, intentionally.
  const previous = parseBusinessFlightSnapshot(existing);
  if (!previous) return json({ ok: false, error: 'FLIGHT_SYNC_STORED_SNAPSHOT_CORRUPT' }, 503);
  const previousCount = previous.flights.length;
  if (previousCount > 0 && flights.length === 0) {
    return json({ ok: false, error: 'FLIGHT_SYNC_EMPTY_SNAPSHOT_REJECTED', previousCount }, 409);
  }
  if (previousCount >= 10 && flights.length < previousCount / 2) {
    return json({ ok: false, error: 'FLIGHT_SYNC_SUSPICIOUS_COUNT_DROP', previousCount, receivedCount: flights.length }, 409);
  }

  const now = new Date().toISOString();
  const snapshot = JSON.stringify({ version: BUSINESS_FLIGHT_SYNC_VERSION, generated_at: now, flights });
  await env.HOTELS_DB.prepare(`
    UPDATE business_flight_sync_feeds
    SET snapshot_json=?, flight_count=?, snapshot_updated_at=?, updated_at=?
    WHERE owner_login=? AND enabled=1
  `).bind(snapshot, flights.length, now, now, owner).run();
  return json({ ok: true, flightCount: flights.length, snapshotUpdatedAt: now });
}

function parseBusinessFlightSnapshot(row) {
  try {
    const parsed = JSON.parse(row?.snapshot_json || '{}');
    if (!parsed || !Array.isArray(parsed.flights)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function businessFlightSyncPayload(row) {
  const snapshot = parseBusinessFlightSnapshot(row);
  // Corrupt snapshots are never reported as successfully synchronized EMPTY.
  if (!snapshot) return null;
  const flights = snapshot.flights;
  return {
    ok: true,
    type: 'iumrah_business_published_flights',
    read_only: true,
    version: Number(snapshot.version || BUSINESS_FLIGHT_SYNC_VERSION),
    updated_at: row.snapshot_updated_at || null,
    flight_count: flights.length,
    sync_state: row.snapshot_updated_at ? (flights.length ? 'ready' : 'empty') : 'not_synchronized',
    comparison_key: 'Use flight_number, origin, destination and local departure date; check legs for UTC times.',
    flights
  };
}

async function publicBusinessFlightSyncFeed(env, token) {
  const cleanToken = cleanText(token, 512);
  if (!cleanToken || cleanToken.length < 24) return json({ ok: false, error: 'FLIGHT_SYNC_NOT_FOUND' }, 404);
  const tokenHash = await sha256Hex(cleanToken);
  const row = await env.HOTELS_DB.prepare(`
    SELECT snapshot_json, flight_count, snapshot_updated_at
    FROM business_flight_sync_feeds
    WHERE token_hash=? AND enabled=1
    LIMIT 1
  `).bind(tokenHash).first();
  if (!row) return json({ ok: false, error: 'FLIGHT_SYNC_NOT_FOUND' }, 404);

  const payload = businessFlightSyncPayload(row);
  if (!payload) return json({ ok: false, error: 'FLIGHT_SYNC_SNAPSHOT_CORRUPT' }, 503);

  // Legacy URL remains fully compatible and non-cacheable.
  return businessFlightSyncJSONResponse(payload);
}

function businessFlightSyncJSONResponse(payload) {
  return new Response(`${JSON.stringify(payload, null, 2)}\n`, {
    status: 200,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store, max-age=0',
      'pragma': 'no-cache'
    }
  });
}

function businessFlightSyncHTMLEscape(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function publicBusinessFlightSyncStableFeed(env, url, method = 'GET') {
  const parts = pathParts(url.pathname, '/flights-feed');
  if (parts.length !== 1) return json({ ok: false, error: 'NOT_FOUND' }, 404);
  const isJSON = parts[0].endsWith('.json');
  const publicID = isJSON ? parts[0].slice(0, -5) : parts[0];
  const isStableID = /^[a-f0-9]{64}$/.test(publicID);
  // Existing shared token can also be opened through the HTML route without
  // reissuing access. New links always use the rotation-proof stable ID.
  const isLegacyToken = !isStableID && /^[A-Za-z0-9_-]{24,128}$/.test(publicID);
  if (!isStableID && !isLegacyToken) return json({ ok: false, error: 'FLIGHT_SYNC_NOT_FOUND' }, 404);

  let owner = '';
  let row = null;
  if (isStableID) {
    // Do not expose other staff accounts if there are multiple operators.
    const owners = await env.HOTELS_DB.prepare(`
      SELECT owner_login FROM business_flight_sync_feeds WHERE enabled=1
    `).all();
    for (const entry of owners.results || []) {
      if (await businessFlightSyncStableID(entry.owner_login) === publicID) {
        owner = entry.owner_login;
        break;
      }
    }
    if (owner) row = await env.HOTELS_DB.prepare(`
      SELECT snapshot_json, flight_count, snapshot_updated_at
      FROM business_flight_sync_feeds WHERE owner_login=? AND enabled=1 LIMIT 1
    `).bind(owner).first();
  } else {
    row = await env.HOTELS_DB.prepare(`
      SELECT owner_login, snapshot_json, flight_count, snapshot_updated_at
      FROM business_flight_sync_feeds WHERE token_hash=? AND enabled=1 LIMIT 1
    `).bind(await sha256Hex(publicID)).first();
    owner = row?.owner_login || '';
  }
  if (!row) return json({ ok: false, error: 'FLIGHT_SYNC_NOT_FOUND' }, 404);
  const payload = businessFlightSyncPayload(row);
  if (!payload) return json({ ok: false, error: 'FLIGHT_SYNC_SNAPSHOT_CORRUPT' }, 503);
  const flights = payload.flights;
  const headers = {
    'cache-control': 'no-store, max-age=0',
    'pragma': 'no-cache',
    'x-content-type-options': 'nosniff'
  };
  if (isJSON || url.searchParams.get('format') === 'json') {
    headers['content-type'] = 'application/json; charset=utf-8';
    return new Response(method === 'HEAD' ? null : `${JSON.stringify(payload, null, 2)}\n`, { status: 200, headers });
  }
  headers['content-type'] = 'text/html; charset=utf-8';
  const rendered = businessFlightSyncHTMLEscape(JSON.stringify(payload, null, 2));
  const machineURL = `${await businessFlightSyncStableURL(owner)}.json`;
  const timestamp = businessFlightSyncHTMLEscape(payload.updated_at || 'not yet synchronized');
  const permanentURL = await businessFlightSyncStableURL(owner);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>iumrah — Published Flights Feed</title><link rel="canonical" href="${permanentURL}"></head><body><main><h1>iumrah — Published Flights (read-only)</h1><p>Flight records: ${flights.length}. Last synchronized: ${timestamp}. This feed reflects the latest saved snapshot, not live ticket availability.</p><p>Permanent feed link: <a href="${permanentURL}">${permanentURL}</a></p><p>Direct machine-readable JSON: <a href="${machineURL}">${machineURL}</a></p><pre id="flight-sync-json">${rendered}</pre></main></body></html>`;
  return new Response(method === 'HEAD' ? null : html, { status: 200, headers });
}

const FLIGHT_DIRECTIONS = new Set(['outbound','return']);

function normalizedFlightNumber(value) {
  const text = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/^[A-Z0-9]{2,4}\d{1,4}[A-Z]?$/.test(text)) return '';
  return text;
}

function validLocalDate(value) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return '';
  const parsed = Date.parse(`${text}T00:00:00Z`);
  return Number.isFinite(parsed) ? text : '';
}

function movementTime(movement, key, utc = false) {
  if (!movement || typeof movement !== 'object') return '';
  const legacyKey = `${key}${utc ? 'Utc' : 'Local'}`;
  const legacy = movement[legacyKey];
  if (typeof legacy === 'string' && legacy.trim()) return legacy.trim();
  const structured = movement[key];
  if (structured && typeof structured === 'object') {
    const value = structured[utc ? 'utc' : 'local'];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function airportFromMovement(movement) {
  const airport = movement?.airport && typeof movement.airport === 'object' ? movement.airport : {};
  return {
    iata: cleanText(airport.iata, 12) || '',
    icao: cleanText(airport.icao, 12) || '',
    name: safeHumanText(airport.name || airport.shortName || airport.municipalityName || '', 240) || ''
  };
}

function normalizedAeroCandidate(item, index) {
  const departure = item?.departure && typeof item.departure === 'object' ? item.departure : {};
  const arrival = item?.arrival && typeof item.arrival === 'object' ? item.arrival : {};
  const depAirport = airportFromMovement(departure);
  const arrAirport = airportFromMovement(arrival);
  return {
    id: `candidate-${index + 1}`,
    flightNumber: safeHumanText(item?.number || '', 40) || '',
    callSign: safeHumanText(item?.callSign || '', 40) || '',
    airlineName: safeHumanText(item?.airline?.name || '', 180) || '',
    airlineIATA: cleanText(item?.airline?.iata, 12) || '',
    airlineICAO: cleanText(item?.airline?.icao, 12) || '',
    departureAirportIATA: depAirport.iata,
    departureAirportICAO: depAirport.icao,
    departureAirportName: depAirport.name,
    arrivalAirportIATA: arrAirport.iata,
    arrivalAirportICAO: arrAirport.icao,
    arrivalAirportName: arrAirport.name,
    scheduledDepartureLocal: movementTime(departure, 'scheduledTime', false),
    scheduledDepartureUTC: movementTime(departure, 'scheduledTime', true),
    scheduledArrivalLocal: movementTime(arrival, 'scheduledTime', false),
    scheduledArrivalUTC: movementTime(arrival, 'scheduledTime', true),
    departureTerminal: safeHumanText(departure.terminal || '', 40) || '',
    arrivalTerminal: safeHumanText(arrival.terminal || '', 40) || '',
    departureGate: safeHumanText(departure.gate || '', 40) || '',
    arrivalGate: safeHumanText(arrival.gate || '', 40) || '',
    status: safeHumanText(item?.status || '', 80) || '',
    lastUpdatedUTC: cleanText(item?.lastUpdatedUtc || item?.lastUpdatedUTC || '', 80) || ''
  };
}

function flightCacheTTL(dateLocal) {
  const target = Date.parse(`${dateLocal}T00:00:00Z`);
  const delta = Math.abs(target - Date.now());
  return delta <= 2 * 86400_000 ? 5 * 60_000 : 6 * 60 * 60_000;
}

async function verifyFlightWithAeroDataBox(env, flightNumber, dateLocal, force = false) {
  const normalized = normalizedFlightNumber(flightNumber);
  const date = validLocalDate(dateLocal);
  if (!normalized) return { ok: false, response: json({ ok: false, error: 'INVALID_FLIGHT_NUMBER' }, 400) };
  if (!date) return { ok: false, response: json({ ok: false, error: 'INVALID_FLIGHT_DATE' }, 400) };
  const cacheKey = `${normalized}|${date}`;
  const now = new Date();
  if (!force) {
    const cached = await env.HOTELS_DB.prepare('SELECT * FROM flight_verification_cache WHERE cache_key=? LIMIT 1').bind(cacheKey).first();
    if (cached && Date.parse(cached.expires_at) > now.getTime()) {
      return { ok: true, cacheKey, cached: true, checkedAt: cached.checked_at, candidates: parseJSONArray(cached.candidates_json) };
    }
  }
  const apiKey = String(env.AERODATABOX_RAPIDAPI_KEY || '').trim();
  if (!apiKey) return { ok: false, response: json({ ok: false, error: 'AERODATABOX_NOT_CONFIGURED' }, 503) };
  const endpoint = `https://aerodatabox.p.rapidapi.com/flights/number/${encodeURIComponent(normalized)}/${encodeURIComponent(date)}?withAircraftImage=false&withLocation=false&dateLocalRole=Departure`;
  let response;
  try {
    response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'accept': 'application/json',
        'X-RapidAPI-Key': apiKey,
        'X-RapidAPI-Host': 'aerodatabox.p.rapidapi.com'
      }
    });
  } catch (error) {
    console.error('AERODATABOX_NETWORK_ERROR', error);
    return { ok: false, response: json({ ok: false, error: 'FLIGHT_PROVIDER_UNAVAILABLE' }, 502) };
  }
  if (response.status === 429) return { ok: false, response: json({ ok: false, error: 'AERODATABOX_QUOTA_EXCEEDED' }, 429) };
  if (response.status === 401 || response.status === 403) return { ok: false, response: json({ ok: false, error: 'AERODATABOX_AUTH_FAILED' }, 502) };
  if (!response.ok) {
    const body = (await response.text().catch(() => '')).slice(0, 500);
    console.warn('AERODATABOX_HTTP_ERROR', response.status, body);
    return { ok: false, response: json({ ok: false, error: `AERODATABOX_HTTP_${response.status}` }, 502) };
  }
  const payload = await response.json().catch(() => null);
  const items = Array.isArray(payload) ? payload : [];
  const candidates = items
    .filter(item => normalizedFlightNumber(item?.number || '') === normalized)
    .slice(0, 8)
    .map((item, index) => normalizedAeroCandidate(item, index));
  const checkedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + flightCacheTTL(date)).toISOString();
  await env.HOTELS_DB.prepare(`
    INSERT INTO flight_verification_cache (cache_key, flight_number, date_local, candidates_json, checked_at, expires_at, provider)
    VALUES (?, ?, ?, ?, ?, ?, 'aerodatabox')
    ON CONFLICT(cache_key) DO UPDATE SET candidates_json=excluded.candidates_json, checked_at=excluded.checked_at, expires_at=excluded.expires_at, provider='aerodatabox'
  `).bind(cacheKey, normalized, date, JSON.stringify(candidates), checkedAt, expiresAt).run();
  await env.HOTELS_DB.prepare("DELETE FROM flight_verification_cache WHERE julianday(expires_at) < julianday('now','-7 days')").run().catch(() => {});
  return { ok: true, cacheKey, cached: false, checkedAt, candidates };
}

async function verifyBusinessFlight(request, env) {
  const payload = await request.json().catch(() => null);
  if (!payload) return json({ ok: false, error: 'INVALID_JSON' }, 400);
  const result = await verifyFlightWithAeroDataBox(env, payload.flightNumber, payload.dateLocal, payload.force === true);
  if (!result.ok) return result.response;
  if (!result.candidates.length) return json({ ok: false, error: 'FLIGHT_NOT_FOUND', flightNumber: normalizedFlightNumber(payload.flightNumber), dateLocal: validLocalDate(payload.dateLocal) }, 404);
  return json({ ok: true, provider: 'AeroDataBox', verificationKey: result.cacheKey, cached: result.cached, checkedAt: result.checkedAt, candidates: result.candidates });
}

function mapTripFlight(row) {
  if (!row) return null;
  return {
    direction: row.direction,
    flightNumber: row.flight_number || '',
    callSign: row.call_sign || '',
    airlineName: row.airline_name || '',
    airlineIATA: row.airline_iata || '',
    airlineICAO: row.airline_icao || '',
    departureAirportIATA: row.departure_airport_iata || '',
    departureAirportICAO: row.departure_airport_icao || '',
    departureAirportName: row.departure_airport_name || '',
    arrivalAirportIATA: row.arrival_airport_iata || '',
    arrivalAirportICAO: row.arrival_airport_icao || '',
    arrivalAirportName: row.arrival_airport_name || '',
    scheduledDepartureLocal: row.scheduled_departure_local || '',
    scheduledDepartureUTC: row.scheduled_departure_utc || '',
    scheduledArrivalLocal: row.scheduled_arrival_local || '',
    scheduledArrivalUTC: row.scheduled_arrival_utc || '',
    departureTerminal: row.departure_terminal || '',
    arrivalTerminal: row.arrival_terminal || '',
    departureGate: row.departure_gate || '',
    arrivalGate: row.arrival_gate || '',
    status: row.status || '',
    verificationProvider: row.verification_provider || 'aerodatabox',
    verifiedAt: row.verified_at || null,
    lastCheckedAt: row.last_checked_at || null
  };
}

async function saveVerifiedBookingFlight(request, env, bookingID, directionRaw) {
  const direction = String(directionRaw || '').toLowerCase();
  if (!FLIGHT_DIRECTIONS.has(direction)) return json({ ok: false, error: 'INVALID_FLIGHT_DIRECTION' }, 400);
  const trip = await env.HOTELS_DB.prepare('SELECT id FROM pilgrim_trips WHERE booking_id=? LIMIT 1').bind(bookingID).first();
  if (!trip) return json({ ok: false, error: 'BOOKING_NOT_SYNCED' }, 404);
  const payload = await request.json().catch(() => null);
  const verificationKey = cleanText(payload?.verificationKey, 120);
  const candidateID = cleanText(payload?.candidateID, 80);
  if (!verificationKey || !candidateID) return json({ ok: false, error: 'VERIFICATION_REQUIRED' }, 400);
  const cached = await env.HOTELS_DB.prepare('SELECT * FROM flight_verification_cache WHERE cache_key=? LIMIT 1').bind(verificationKey).first();
  if (!cached || Date.now() - Date.parse(cached.checked_at) > 24 * 60 * 60_000) return json({ ok: false, error: 'FLIGHT_VERIFICATION_EXPIRED' }, 409);
  const candidates = parseJSONArray(cached.candidates_json);
  const candidate = candidates.find(item => item?.id === candidateID);
  if (!candidate) return json({ ok: false, error: 'FLIGHT_CANDIDATE_NOT_FOUND' }, 404);
  const now = new Date().toISOString();
  await env.HOTELS_DB.prepare(`
    INSERT INTO trip_flights (
      booking_id, direction, flight_number, call_sign, airline_name, airline_iata, airline_icao,
      departure_airport_iata, departure_airport_icao, departure_airport_name,
      arrival_airport_iata, arrival_airport_icao, arrival_airport_name,
      scheduled_departure_local, scheduled_departure_utc, scheduled_arrival_local, scheduled_arrival_utc,
      departure_terminal, arrival_terminal, departure_gate, arrival_gate, status,
      verification_provider, verification_key, verified_at, last_checked_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'aerodatabox', ?, ?, ?, ?, ?)
    ON CONFLICT(booking_id, direction) DO UPDATE SET
      flight_number=excluded.flight_number, call_sign=excluded.call_sign, airline_name=excluded.airline_name,
      airline_iata=excluded.airline_iata, airline_icao=excluded.airline_icao,
      departure_airport_iata=excluded.departure_airport_iata, departure_airport_icao=excluded.departure_airport_icao,
      departure_airport_name=excluded.departure_airport_name, arrival_airport_iata=excluded.arrival_airport_iata,
      arrival_airport_icao=excluded.arrival_airport_icao, arrival_airport_name=excluded.arrival_airport_name,
      scheduled_departure_local=excluded.scheduled_departure_local, scheduled_departure_utc=excluded.scheduled_departure_utc,
      scheduled_arrival_local=excluded.scheduled_arrival_local, scheduled_arrival_utc=excluded.scheduled_arrival_utc,
      departure_terminal=excluded.departure_terminal, arrival_terminal=excluded.arrival_terminal,
      departure_gate=excluded.departure_gate, arrival_gate=excluded.arrival_gate, status=excluded.status,
      verification_provider='aerodatabox', verification_key=excluded.verification_key,
      verified_at=excluded.verified_at, last_checked_at=excluded.last_checked_at, updated_at=excluded.updated_at
  `).bind(
    bookingID, direction, candidate.flightNumber || '', candidate.callSign || '', candidate.airlineName || '', candidate.airlineIATA || '', candidate.airlineICAO || '',
    candidate.departureAirportIATA || '', candidate.departureAirportICAO || '', candidate.departureAirportName || '',
    candidate.arrivalAirportIATA || '', candidate.arrivalAirportICAO || '', candidate.arrivalAirportName || '',
    candidate.scheduledDepartureLocal || '', candidate.scheduledDepartureUTC || '', candidate.scheduledArrivalLocal || '', candidate.scheduledArrivalUTC || '',
    candidate.departureTerminal || '', candidate.arrivalTerminal || '', candidate.departureGate || '', candidate.arrivalGate || '', candidate.status || '',
    verificationKey, now, now, now, now
  ).run();
  return json({ ok: true, flight: mapTripFlight(await env.HOTELS_DB.prepare('SELECT * FROM trip_flights WHERE booking_id=? AND direction=?').bind(bookingID, direction).first()) });
}

async function deleteBookingFlight(env, bookingID, directionRaw) {
  const direction = String(directionRaw || '').toLowerCase();
  if (!FLIGHT_DIRECTIONS.has(direction)) return json({ ok: false, error: 'INVALID_FLIGHT_DIRECTION' }, 400);
  await env.HOTELS_DB.prepare('DELETE FROM trip_flights WHERE booking_id=? AND direction=?').bind(bookingID, direction).run();
  return json({ ok: true });
}

async function assignmentHotelSummary(env, hotelID) {
  if (!hotelID) return null;
  return hotelSummary(await summaryRow(env, hotelID));
}

async function bookingAssignmentDetail(env, bookingID) {
  const row = await env.HOTELS_DB.prepare('SELECT * FROM trip_assignments WHERE booking_id=? LIMIT 1').bind(bookingID).first();
  const primaryGuide = await env.HOTELS_DB.prepare("SELECT * FROM team_members WHERE role_kind='guide' AND active=1 ORDER BY sort_order ASC, created_at ASC LIMIT 1").first();
  if (!row) {
    return { makkahHotelID: null, madinahHotelID: null, guideID: primaryGuide?.id || null, makkahHotel: null, madinahHotel: null, guide: primaryGuide ? mapTeamMember(primaryGuide, true) : null, guideIsPrimary: !!primaryGuide };
  }
  const guide = row.guide_team_member_id
    ? await env.HOTELS_DB.prepare('SELECT * FROM team_members WHERE id=? LIMIT 1').bind(row.guide_team_member_id).first()
    : primaryGuide;
  return {
    makkahHotelID: row.makkah_hotel_id || null,
    madinahHotelID: row.madinah_hotel_id || null,
    guideID: guide?.id || null,
    makkahHotel: await assignmentHotelSummary(env, row.makkah_hotel_id),
    madinahHotel: await assignmentHotelSummary(env, row.madinah_hotel_id),
    guide: guide ? mapTeamMember(guide, true) : null,
    guideIsPrimary: !row.guide_team_member_id && !!primaryGuide
  };
}

async function clientBookingAssignmentDetail(env, bookingID) {
  const detail = await bookingAssignmentDetail(env, bookingID);
  const guide = detail?.guide;
  return {
    guide: guide ? {
      id: String(guide.id || ''),
      displayName: String(guide.displayName || ''),
      roleTitle: String(guide.roleTitle || ''),
      phoneUZ: String(guide.phoneUZ || ''),
      phoneSA: String(guide.phoneSA || ''),
      telegram: String(guide.telegram || ''),
      whatsapp: String(guide.whatsapp || ''),
      bio: String(guide.bio || '')
    } : null
  };
}

async function updateBookingAssignments(request, env, bookingID) {
  const trip = await env.HOTELS_DB.prepare('SELECT id FROM pilgrim_trips WHERE booking_id=? LIMIT 1').bind(bookingID).first();
  if (!trip) return json({ ok: false, error: 'BOOKING_NOT_SYNCED' }, 404);
  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== 'object') return json({ ok: false, error: 'INVALID_JSON' }, 400);
  const current = await env.HOTELS_DB.prepare('SELECT * FROM trip_assignments WHERE booking_id=? LIMIT 1').bind(bookingID).first();
  const makkahID = payload.makkahHotelID === null ? null : (cleanText(payload.makkahHotelID, 180) || current?.makkah_hotel_id || null);
  const madinahID = payload.madinahHotelID === null ? null : (cleanText(payload.madinahHotelID, 180) || current?.madinah_hotel_id || null);
  const guideID = payload.guideID === null ? null : (cleanText(payload.guideID, 180) || current?.guide_team_member_id || null);
  for (const [id, city] of [[makkahID, 'Makkah'], [madinahID, 'Madinah']]) {
    if (!id) continue;
    const hotel = await env.HOTELS_DB.prepare("SELECT id, city, status FROM hotels WHERE id=? AND status='published' LIMIT 1").bind(id).first();
    if (!hotel) return json({ ok: false, error: 'HOTEL_NOT_AVAILABLE', hotelID: id }, 409);
    if (canonicalCity(hotel.city) !== city) return json({ ok: false, error: 'HOTEL_CITY_MISMATCH', hotelID: id, expectedCity: city }, 409);
  }
  if (guideID) {
    const guide = await env.HOTELS_DB.prepare("SELECT id FROM team_members WHERE id=? AND role_kind='guide' AND active=1 LIMIT 1").bind(guideID).first();
    if (!guide) return json({ ok: false, error: 'GUIDE_NOT_AVAILABLE' }, 409);
  }
  const now = new Date().toISOString();
  await env.HOTELS_DB.prepare(`
    INSERT INTO trip_assignments (booking_id, makkah_hotel_id, madinah_hotel_id, guide_team_member_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(booking_id) DO UPDATE SET makkah_hotel_id=excluded.makkah_hotel_id, madinah_hotel_id=excluded.madinah_hotel_id, guide_team_member_id=excluded.guide_team_member_id, updated_at=excluded.updated_at
  `).bind(bookingID, makkahID, madinahID, guideID, now, now).run();
  return json({ ok: true, assignment: await bookingAssignmentDetail(env, bookingID) });
}

async function sourceBookingDeleteTargets(db) {
  const tables = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  const targets = [];
  for (const row of tables.results || []) {
    const table = String(row?.name || '');
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table) || table === 'bookings') continue;
    const columns = await db.prepare(`PRAGMA table_info("${table}")`).all().catch(() => ({ results: [] }));
    const bookingColumn = (columns.results || []).find(column => String(column?.name || '') === 'booking_id');
    if (bookingColumn) {
      targets.push({ table, column: 'booking_id' });
      continue;
    }
    const foreignKeys = await db.prepare(`PRAGMA foreign_key_list("${table}")`).all().catch(() => ({ results: [] }));
    const bookingFK = (foreignKeys.results || []).find(fk => String(fk?.table || '') === 'bookings' && String(fk?.to || '') === 'id');
    const column = String(bookingFK?.from || '');
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(column)) targets.push({ table, column });
  }
  return targets;
}

async function hardDeleteSourceBooking(env, bookingID) {
  if (!env.BOOKINGS_DB) return { configured: false, deleted: false };
  const existing = await env.BOOKINGS_DB.prepare('SELECT id FROM bookings WHERE id=? LIMIT 1').bind(bookingID).first();
  if (!existing) return { configured: true, deleted: false };

  const targets = await sourceBookingDeleteTargets(env.BOOKINGS_DB);
  const statements = targets.map(({ table, column }) =>
    env.BOOKINGS_DB.prepare(`DELETE FROM "${table}" WHERE "${column}"=?`).bind(bookingID)
  );
  statements.push(env.BOOKINGS_DB.prepare('DELETE FROM bookings WHERE id=?').bind(bookingID));
  await env.BOOKINGS_DB.batch(statements);

  const remaining = await env.BOOKINGS_DB.prepare('SELECT id FROM bookings WHERE id=? LIMIT 1').bind(bookingID).first();
  if (remaining) throw new Error('BOOKING_SOURCE_DELETE_NOT_PERSISTED');
  return { configured: true, deleted: true };
}

async function purgeOperationalBooking(env, bookingID) {
  await ensureBookingItinerarySchema(env);
  const trip = await env.HOTELS_DB.prepare('SELECT pilgrim_id FROM pilgrim_trips WHERE booking_id=? LIMIT 1').bind(bookingID).first().catch(() => null);
  const attachments = await env.HOTELS_DB.prepare('SELECT object_key FROM business_chat_attachments WHERE booking_id=?').bind(bookingID).all().catch(() => ({ results: [] }));
  const now = new Date().toISOString();

  await env.HOTELS_DB.batch([
    env.HOTELS_DB.prepare('DELETE FROM client_push_subscriptions WHERE booking_id=?').bind(bookingID),
    env.HOTELS_DB.prepare('DELETE FROM business_chat_messages WHERE booking_id=?').bind(bookingID),
    env.HOTELS_DB.prepare('DELETE FROM business_chat_attachments WHERE booking_id=?').bind(bookingID),
    env.HOTELS_DB.prepare('DELETE FROM business_chat_threads WHERE booking_id=?').bind(bookingID),
    env.HOTELS_DB.prepare('DELETE FROM booking_status_history WHERE booking_id=?').bind(bookingID),
    env.HOTELS_DB.prepare('DELETE FROM trip_flights WHERE booking_id=?').bind(bookingID),
    env.HOTELS_DB.prepare('DELETE FROM booking_itinerary_items WHERE booking_id=?').bind(bookingID),
    env.HOTELS_DB.prepare('DELETE FROM trip_assignments WHERE booking_id=?').bind(bookingID),
    env.HOTELS_DB.prepare('DELETE FROM booking_esims WHERE booking_id=?').bind(bookingID),
    env.HOTELS_DB.prepare('DELETE FROM pilgrim_trips WHERE booking_id=?').bind(bookingID),
    env.HOTELS_DB.prepare('DELETE FROM booking_tombstones WHERE booking_id=?').bind(bookingID)
  ]);

  await Promise.allSettled((attachments.results || []).map(row => env.HOTELS_MEDIA.delete(row.object_key)));

  if (trip?.pilgrim_id) {
    const pilgrim = await env.HOTELS_DB.prepare('SELECT * FROM pilgrims WHERE id=? LIMIT 1').bind(trip.pilgrim_id).first().catch(() => null);
    const stats = await env.HOTELS_DB.prepare('SELECT COUNT(*) AS count, MAX(COALESCE(end_date, created_at)) AS last_trip FROM pilgrim_trips WHERE pilgrim_id=?').bind(trip.pilgrim_id).first();
    const count = Number(stats?.count || 0);
    if (count === 0 && pilgrim && !(await env.HOTELS_DB.prepare('SELECT pilgrim_id FROM iumrah_accounts WHERE pilgrim_id=?').bind(trip.pilgrim_id).first().catch(() => null))) {
      await env.HOTELS_DB.prepare('DELETE FROM pilgrims WHERE id=?').bind(trip.pilgrim_id).run();
    } else {
      // The pilgrim identity is permanent. Deleting one trip must never recycle its six-digit iumrah ID.
      await env.HOTELS_DB.prepare('UPDATE pilgrims SET total_trips=?, last_trip_at=?, updated_at=? WHERE id=?')
        .bind(count, stats?.last_trip || null, now, trip.pilgrim_id).run();
    }
  }
}

async function deleteOperationsBooking(request, env, bookingID, user) {
  try {
    const direct = await hardDeleteSourceBooking(env, bookingID);
    if (!direct.configured) return json({ ok: false, error: 'BOOKINGS_DB_NOT_CONFIGURED' }, 503);
    if (!direct.deleted) return json({ ok: false, error: 'BOOKING_NOT_FOUND_IN_SOURCE_DB' }, 404);
  } catch (error) {
    console.error('BOOKING_SOURCE_DELETE_FAILED', bookingID, error);
    return json({ ok: false, error: cleanText(error?.message, 180) || 'BOOKING_SOURCE_DELETE_FAILED' }, 500);
  }

  await purgeOperationalBooking(env, bookingID);
  return json({ ok: true, deletedBookingID: bookingID, deletedBy: cleanText(user?.login, 180) || null });
}

async function deleteClientBooking(request, env, bookingID, auth) {
  // requireClientBooking has already verified x-booking-token against the live
  // booking service. Delete the same source row directly through the D1 binding
  // so client and staff deletion cannot drift through separate HTTP routes.
  try {
    const direct = await hardDeleteSourceBooking(env, bookingID);
    if (!direct.configured) return json({ ok: false, error: 'BOOKINGS_DB_NOT_CONFIGURED' }, 503);
    if (!direct.deleted) return json({ ok: false, error: 'BOOKING_NOT_FOUND_IN_SOURCE_DB' }, 404);
  } catch (error) {
    console.error('CLIENT_BOOKING_SOURCE_DELETE_FAILED', bookingID, error);
    return json({ ok: false, error: cleanText(error?.message, 180) || 'BOOKING_SOURCE_DELETE_FAILED' }, 500);
  }

  await purgeOperationalBooking(env, bookingID);
  return json({ ok: true, deleted: true, pilgrimID: auth?.trip?.pilgrim_id ? pilgrimPublicID(auth.trip.pilgrim_id) : null });
}

function teamMemberPayload(payload, defaults = {}) {
  const firstName = safeHumanText(payload?.firstName ?? defaults.firstName ?? '', 120) || '';
  const lastName = safeHumanText(payload?.lastName ?? defaults.lastName ?? '', 120) || '';
  const roleKindRaw = String(payload?.roleKind ?? defaults.roleKind ?? 'guide').toLowerCase();
  const roleKind = ['owner','guide','manager','operations'].includes(roleKindRaw) ? roleKindRaw : 'guide';
  const publicSlugInput = cleanText(payload?.publicSlug ?? defaults.publicSlug, 120);
  const slugBase = publicSlugInput || `${firstName}-${lastName}` || `team-${crypto.randomUUID().slice(0, 8)}`;
  return {
    firstName,
    lastName,
    roleKind,
    roleTitle: safeHumanText(payload?.roleTitle ?? defaults.roleTitle ?? '', 160) || '',
    phoneUZ: cleanText(payload?.phoneUZ ?? defaults.phoneUZ ?? '', 80) || '',
    phoneSA: cleanText(payload?.phoneSA ?? defaults.phoneSA ?? '', 80) || '',
    telegram: cleanText(payload?.telegram ?? defaults.telegram ?? '', 160) || '',
    whatsapp: cleanText(payload?.whatsapp ?? defaults.whatsapp ?? '', 160) || '',
    instagram: cleanText(payload?.instagram ?? defaults.instagram ?? '', 160) || '',
    bio: safeHumanText(payload?.bio ?? defaults.bio ?? '', 1800) || '',
    publicSlug: slugify(slugBase) || `team-${crypto.randomUUID().slice(0, 8)}`,
    publicVisible: payload?.publicVisible == null ? (defaults.publicVisible ?? true) : !!payload.publicVisible,
    active: payload?.active == null ? (defaults.active ?? true) : !!payload.active
  };
}

function mapTeamMember(row, admin = true) {
  if (!row) return null;
  const base = {
    id: row.id,
    firstName: row.first_name || '',
    lastName: row.last_name || '',
    displayName: [row.first_name, row.last_name].filter(Boolean).join(' ').trim() || row.role_title || 'iumrah',
    roleKind: row.role_kind || 'guide',
    roleTitle: row.role_title || '',
    phoneUZ: row.phone_uz || '',
    phoneSA: row.phone_sa || '',
    telegram: row.telegram || '',
    whatsapp: row.whatsapp || '',
    instagram: row.instagram || '',
    bio: row.bio || '',
    publicSlug: row.public_slug,
    publicVisible: Number(row.public_visible || 0) === 1,
    active: Number(row.active || 0) === 1,
    isOwner: Number(row.is_owner || 0) === 1,
    photoURL: row.photo_object_key
      ? (admin
          ? `/api/admin/hotels/operations/team/${encodeURIComponent(row.id)}/photo?v=${encodeURIComponent(row.updated_at || '')}`
          : `/api/catalog/hotels/team/${encodeURIComponent(row.public_slug)}/photo?v=${encodeURIComponent(row.updated_at || '')}`)
      : null
  };
  if (admin) base.staffLogin = row.staff_login || null;
  return base;
}

async function ensureOwnerProfile(env, user) {
  const login = cleanText(user?.login, 180) || 'owner';
  let row = await env.HOTELS_DB.prepare('SELECT * FROM team_members WHERE staff_login=? LIMIT 1').bind(login).first();
  if (row) return row;
  const id = `team-${crypto.randomUUID()}`;
  const display = safeHumanText(user?.displayName || '', 200) || '';
  const pieces = display.split(/\s+/).filter(Boolean);
  const firstName = pieces[0] || '';
  const lastName = pieces.slice(1).join(' ');
  let slug = slugify(display || login) || `owner-${crypto.randomUUID().slice(0,8)}`;
  const exists = await env.HOTELS_DB.prepare('SELECT id FROM team_members WHERE public_slug=? LIMIT 1').bind(slug).first();
  if (exists) slug = `${slug}-${crypto.randomUUID().slice(0,6)}`;
  const now = new Date().toISOString();
  await env.HOTELS_DB.prepare(`
    INSERT INTO team_members (id, staff_login, first_name, last_name, role_kind, role_title, public_slug, public_visible, active, is_owner, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'owner', 'Owner · iumrah', ?, 1, 1, 1, 0, ?, ?)
  `).bind(id, login, firstName, lastName, slug, now, now).run();
  return env.HOTELS_DB.prepare('SELECT * FROM team_members WHERE id=?').bind(id).first();
}

async function businessProfileMe(env, user) {
  return json({ ok: true, member: mapTeamMember(await ensureOwnerProfile(env, user), true) });
}

async function saveBusinessProfileMe(request, env, user) {
  const existing = await ensureOwnerProfile(env, user);
  const payload = await request.json().catch(() => null);
  if (!payload) return json({ ok: false, error: 'INVALID_JSON' }, 400);
  const value = teamMemberPayload(payload, mapTeamMember(existing, true));
  const duplicate = await env.HOTELS_DB.prepare('SELECT id FROM team_members WHERE public_slug=? AND id<>? LIMIT 1').bind(value.publicSlug, existing.id).first();
  if (duplicate) return json({ ok: false, error: 'PUBLIC_SLUG_TAKEN' }, 409);
  const now = new Date().toISOString();
  await env.HOTELS_DB.prepare(`
    UPDATE team_members SET first_name=?, last_name=?, role_kind='owner', role_title=?, phone_uz=?, phone_sa=?, telegram=?, whatsapp=?, instagram=?, bio=?, public_slug=?, public_visible=?, active=1, is_owner=1, updated_at=? WHERE id=?
  `).bind(value.firstName, value.lastName, value.roleTitle, value.phoneUZ, value.phoneSA, value.telegram, value.whatsapp, value.instagram, value.bio, value.publicSlug, value.publicVisible ? 1 : 0, now, existing.id).run();
  return businessProfileMe(env, user);
}

async function adminTeam(env) {
  const result = await env.HOTELS_DB.prepare('SELECT * FROM team_members ORDER BY is_owner DESC, sort_order ASC, last_name COLLATE NOCASE, first_name COLLATE NOCASE').all();
  return json({ ok: true, members: (result.results || []).map(row => mapTeamMember(row, true)) });
}

async function adminTeamMember(env, memberID) {
  const row = await env.HOTELS_DB.prepare('SELECT * FROM team_members WHERE id=?').bind(memberID).first();
  if (!row) return json({ ok: false, error: 'TEAM_MEMBER_NOT_FOUND' }, 404);
  return json({ ok: true, member: mapTeamMember(row, true) });
}

async function createTeamMember(request, env) {
  const payload = await request.json().catch(() => null);
  if (!payload) return json({ ok: false, error: 'INVALID_JSON' }, 400);
  const value = teamMemberPayload(payload);
  if (!value.firstName && !value.lastName) return json({ ok: false, error: 'NAME_REQUIRED' }, 400);
  const duplicate = await env.HOTELS_DB.prepare('SELECT id FROM team_members WHERE public_slug=? LIMIT 1').bind(value.publicSlug).first();
  if (duplicate) return json({ ok: false, error: 'PUBLIC_SLUG_TAKEN' }, 409);
  const id = `team-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const max = await env.HOTELS_DB.prepare('SELECT COALESCE(MAX(sort_order), 0) AS max_order FROM team_members').first();
  await env.HOTELS_DB.prepare(`
    INSERT INTO team_members (id, first_name, last_name, role_kind, role_title, phone_uz, phone_sa, telegram, whatsapp, instagram, bio, public_slug, public_visible, active, is_owner, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
  `).bind(id, value.firstName, value.lastName, value.roleKind, value.roleTitle, value.phoneUZ, value.phoneSA, value.telegram, value.whatsapp, value.instagram, value.bio, value.publicSlug, value.publicVisible ? 1 : 0, value.active ? 1 : 0, Number(max?.max_order || 0) + 1, now, now).run();
  return adminTeamMember(env, id);
}

async function updateTeamMember(request, env, memberID) {
  const row = await env.HOTELS_DB.prepare('SELECT * FROM team_members WHERE id=?').bind(memberID).first();
  if (!row) return json({ ok: false, error: 'TEAM_MEMBER_NOT_FOUND' }, 404);
  const payload = await request.json().catch(() => null);
  if (!payload) return json({ ok: false, error: 'INVALID_JSON' }, 400);
  const value = teamMemberPayload(payload, mapTeamMember(row, true));
  const duplicate = await env.HOTELS_DB.prepare('SELECT id FROM team_members WHERE public_slug=? AND id<>? LIMIT 1').bind(value.publicSlug, memberID).first();
  if (duplicate) return json({ ok: false, error: 'PUBLIC_SLUG_TAKEN' }, 409);
  const now = new Date().toISOString();
  await env.HOTELS_DB.prepare(`
    UPDATE team_members SET first_name=?, last_name=?, role_kind=?, role_title=?, phone_uz=?, phone_sa=?, telegram=?, whatsapp=?, instagram=?, bio=?, public_slug=?, public_visible=?, active=?, updated_at=? WHERE id=?
  `).bind(value.firstName, value.lastName, row.is_owner ? 'owner' : value.roleKind, value.roleTitle, value.phoneUZ, value.phoneSA, value.telegram, value.whatsapp, value.instagram, value.bio, value.publicSlug, value.publicVisible ? 1 : 0, value.active ? 1 : 0, now, memberID).run();
  return adminTeamMember(env, memberID);
}

async function serveAdminTeamMemberPhoto(env, memberID) {
  const row = await env.HOTELS_DB.prepare('SELECT photo_object_key, photo_content_type FROM team_members WHERE id=? LIMIT 1').bind(memberID).first();
  if (!row?.photo_object_key) return json({ ok: false, error: 'PHOTO_NOT_FOUND' }, 404);
  const object = await env.HOTELS_MEDIA.get(row.photo_object_key);
  if (!object) return json({ ok: false, error: 'PHOTO_NOT_FOUND' }, 404);
  return new Response(object.body, {
    headers: {
      'content-type': row.photo_content_type || 'image/jpeg',
      'cache-control': 'private, max-age=3600'
    }
  });
}

async function uploadTeamMemberPhoto(request, env, memberID) {
  const row = await env.HOTELS_DB.prepare('SELECT * FROM team_members WHERE id=? LIMIT 1').bind(memberID).first();
  if (!row) return json({ ok: false, error: 'TEAM_MEMBER_NOT_FOUND' }, 404);

  const uploaded = await privateImageUpload(request, env, `team-photos/${memberID}`);
  if (!uploaded.ok) return uploaded.response;

  const previousKey = row.photo_object_key || null;
  const now = new Date().toISOString();
  try {
    await env.HOTELS_DB.prepare('UPDATE team_members SET photo_object_key=?, photo_content_type=?, updated_at=? WHERE id=?')
      .bind(uploaded.key, uploaded.ct, now, memberID).run();
  } catch (error) {
    await env.HOTELS_MEDIA.delete(uploaded.key).catch(() => {});
    throw error;
  }
  if (previousKey && previousKey !== uploaded.key) await env.HOTELS_MEDIA.delete(previousKey).catch(() => {});
  return adminTeamMember(env, memberID);
}

async function deleteTeamMemberPhoto(env, memberID) {
  const row = await env.HOTELS_DB.prepare('SELECT * FROM team_members WHERE id=? LIMIT 1').bind(memberID).first();
  if (!row) return json({ ok: false, error: 'TEAM_MEMBER_NOT_FOUND' }, 404);
  const previousKey = row.photo_object_key || null;
  const now = new Date().toISOString();
  await env.HOTELS_DB.prepare('UPDATE team_members SET photo_object_key=NULL, photo_content_type=NULL, updated_at=? WHERE id=?')
    .bind(now, memberID).run();
  if (previousKey) await env.HOTELS_MEDIA.delete(previousKey).catch(() => {});
  return adminTeamMember(env, memberID);
}

async function deleteTeamMember(env, memberID) {
  const row = await env.HOTELS_DB.prepare('SELECT is_owner, photo_object_key FROM team_members WHERE id=?').bind(memberID).first();
  if (!row) return json({ ok: true });
  if (Number(row.is_owner || 0) === 1) return json({ ok: false, error: 'OWNER_CANNOT_BE_DELETED' }, 409);
  await env.HOTELS_DB.prepare('DELETE FROM team_members WHERE id=?').bind(memberID).run();
  if (row.photo_object_key) await env.HOTELS_MEDIA.delete(row.photo_object_key).catch(() => {});
  return json({ ok: true });
}

function mapPaymentTemplate(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name || 'Реквизиты',
    visaCardNumber: row.visa_card_number || '',
    visaHolder: row.visa_holder || '',
    hasPaymeQR: !!row.payme_qr_object_key,
    paymeQRURL: row.payme_qr_object_key
      ? `/api/admin/hotels/operations/payment-templates/${encodeURIComponent(row.id)}/qr?v=${encodeURIComponent(row.updated_at || '')}`
      : null,
    humoCardNumber: row.humo_card_number || '',
    humoHolder: row.humo_holder || '',
    instructions: row.instructions || '',
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || ''
  };
}

function paymentTemplatePayload(payload, defaults = {}) {
  return {
    name: safeHumanText(payload?.name ?? defaults.name ?? '', 140) || '',
    visaCardNumber: cleanText(payload?.visaCardNumber ?? defaults.visaCardNumber ?? '', 80) || '',
    visaHolder: safeHumanText(payload?.visaHolder ?? defaults.visaHolder ?? '', 160) || '',
    humoCardNumber: cleanText(payload?.humoCardNumber ?? defaults.humoCardNumber ?? '', 80) || '',
    humoHolder: safeHumanText(payload?.humoHolder ?? defaults.humoHolder ?? '', 160) || '',
    instructions: safeHumanText(payload?.instructions ?? defaults.instructions ?? '', 1500) || ''
  };
}

async function listPaymentTemplates(env) {
  const result = await env.HOTELS_DB.prepare('SELECT * FROM payment_templates ORDER BY sort_order ASC, updated_at DESC, name COLLATE NOCASE').all();
  return json({ ok: true, templates: (result.results || []).map(mapPaymentTemplate) });
}

async function paymentTemplateDetail(env, templateID) {
  const row = await env.HOTELS_DB.prepare('SELECT * FROM payment_templates WHERE id=? LIMIT 1').bind(templateID).first();
  if (!row) return json({ ok: false, error: 'PAYMENT_TEMPLATE_NOT_FOUND' }, 404);
  return json({ ok: true, template: mapPaymentTemplate(row) });
}

async function createPaymentTemplate(request, env, user) {
  const payload = await request.json().catch(() => null);
  if (!payload) return json({ ok: false, error: 'INVALID_JSON' }, 400);
  const value = paymentTemplatePayload(payload);
  if (!value.name) return json({ ok: false, error: 'PAYMENT_TEMPLATE_NAME_REQUIRED' }, 400);
  const id = `paytpl-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const max = await env.HOTELS_DB.prepare('SELECT COALESCE(MAX(sort_order), 0) AS max_order FROM payment_templates').first();
  await env.HOTELS_DB.prepare(`
    INSERT INTO payment_templates(id,name,visa_card_number,visa_holder,humo_card_number,humo_holder,instructions,sort_order,created_by,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)
  `).bind(id,value.name,value.visaCardNumber,value.visaHolder,value.humoCardNumber,value.humoHolder,value.instructions,Number(max?.max_order || 0)+1,cleanText(user?.login,180),now,now).run();
  return paymentTemplateDetail(env, id);
}

async function updatePaymentTemplate(request, env, templateID, user) {
  const row = await env.HOTELS_DB.prepare('SELECT * FROM payment_templates WHERE id=? LIMIT 1').bind(templateID).first();
  if (!row) return json({ ok: false, error: 'PAYMENT_TEMPLATE_NOT_FOUND' }, 404);
  const payload = await request.json().catch(() => null);
  if (!payload) return json({ ok: false, error: 'INVALID_JSON' }, 400);
  const value = paymentTemplatePayload(payload, mapPaymentTemplate(row));
  if (!value.name) return json({ ok: false, error: 'PAYMENT_TEMPLATE_NAME_REQUIRED' }, 400);
  const now = new Date().toISOString();
  await env.HOTELS_DB.prepare(`UPDATE payment_templates SET name=?,visa_card_number=?,visa_holder=?,humo_card_number=?,humo_holder=?,instructions=?,updated_at=? WHERE id=?`)
    .bind(value.name,value.visaCardNumber,value.visaHolder,value.humoCardNumber,value.humoHolder,value.instructions,now,templateID).run();
  return paymentTemplateDetail(env, templateID);
}

async function servePaymentTemplateQR(env, templateID) {
  const row = await env.HOTELS_DB.prepare('SELECT payme_qr_object_key,payme_qr_content_type FROM payment_templates WHERE id=? LIMIT 1').bind(templateID).first();
  if (!row?.payme_qr_object_key) return json({ ok: false, error: 'PAYMENT_TEMPLATE_QR_NOT_FOUND' }, 404);
  const object = await env.HOTELS_MEDIA.get(row.payme_qr_object_key);
  if (!object) return json({ ok: false, error: 'PAYMENT_TEMPLATE_QR_NOT_FOUND' }, 404);
  return new Response(object.body, { headers: { 'content-type': row.payme_qr_content_type || 'image/png', 'cache-control': 'private, max-age=3600' } });
}

async function uploadPaymentTemplateQR(request, env, templateID, user) {
  const row = await env.HOTELS_DB.prepare('SELECT * FROM payment_templates WHERE id=? LIMIT 1').bind(templateID).first();
  if (!row) return json({ ok: false, error: 'PAYMENT_TEMPLATE_NOT_FOUND' }, 404);
  const uploaded = await privateImageUpload(request, env, `payment-templates/${templateID}`);
  if (!uploaded.ok) return uploaded.response;
  const previousKey = row.payme_qr_object_key || null;
  const now = new Date().toISOString();
  try {
    await env.HOTELS_DB.prepare('UPDATE payment_templates SET payme_qr_object_key=?,payme_qr_content_type=?,updated_at=? WHERE id=?')
      .bind(uploaded.key,uploaded.ct,now,templateID).run();
  } catch (error) {
    await env.HOTELS_MEDIA.delete(uploaded.key).catch(() => {});
    throw error;
  }
  if (previousKey && previousKey !== uploaded.key) await env.HOTELS_MEDIA.delete(previousKey).catch(() => {});
  return paymentTemplateDetail(env, templateID);
}

async function deletePaymentTemplateQR(env, templateID, user) {
  const row = await env.HOTELS_DB.prepare('SELECT * FROM payment_templates WHERE id=? LIMIT 1').bind(templateID).first();
  if (!row) return json({ ok: false, error: 'PAYMENT_TEMPLATE_NOT_FOUND' }, 404);
  const previousKey = row.payme_qr_object_key || null;
  const now = new Date().toISOString();
  await env.HOTELS_DB.prepare('UPDATE payment_templates SET payme_qr_object_key=NULL,payme_qr_content_type=NULL,updated_at=? WHERE id=?').bind(now,templateID).run();
  if (previousKey) await env.HOTELS_MEDIA.delete(previousKey).catch(() => {});
  return paymentTemplateDetail(env, templateID);
}

async function deletePaymentTemplate(env, templateID) {
  const row = await env.HOTELS_DB.prepare('SELECT payme_qr_object_key FROM payment_templates WHERE id=? LIMIT 1').bind(templateID).first();
  if (!row) return json({ ok: true });
  await env.HOTELS_DB.prepare('DELETE FROM payment_templates WHERE id=?').bind(templateID).run();
  if (row.payme_qr_object_key) await env.HOTELS_MEDIA.delete(row.payme_qr_object_key).catch(() => {});
  return json({ ok: true });
}

function privateImageExtension(contentType) {
  const value = String(contentType || '').toLowerCase();
  if (value.includes('png')) return 'png';
  if (value.includes('heic')) return 'heic';
  return 'jpg';
}

async function applyPaymentTemplateToBooking(env, bookingID, templateID, user) {
  const trip = await env.HOTELS_DB.prepare('SELECT * FROM pilgrim_trips WHERE booking_id=? LIMIT 1').bind(bookingID).first();
  if (!trip || !['availability_check','payment_pending'].includes(normalizedTripStatus(trip.status))) {
    return json({ ok: false, error: 'PAYMENT_INSTRUCTIONS_LOCKED' }, 409);
  }
  const template = await env.HOTELS_DB.prepare('SELECT * FROM payment_templates WHERE id=? LIMIT 1').bind(templateID).first();
  if (!template) return json({ ok: false, error: 'PAYMENT_TEMPLATE_NOT_FOUND' }, 404);

  const current = await env.HOTELS_DB.prepare('SELECT payme_qr_object_key FROM booking_payment_instructions WHERE booking_id=? LIMIT 1').bind(bookingID).first();
  let newQRKey = null;
  let newQRContentType = null;
  if (template.payme_qr_object_key) {
    const sourceObject = await env.HOTELS_MEDIA.get(template.payme_qr_object_key);
    if (!sourceObject) return json({ ok: false, error: 'PAYMENT_TEMPLATE_QR_NOT_FOUND' }, 409);
    newQRContentType = template.payme_qr_content_type || 'image/png';
    newQRKey = `private/payment-qr/${bookingID}/${crypto.randomUUID()}.${privateImageExtension(newQRContentType)}`;
    await env.HOTELS_MEDIA.put(newQRKey, sourceObject.body, { httpMetadata: { contentType: newQRContentType } });
  }

  const now = new Date().toISOString();
  try {
    await env.HOTELS_DB.prepare(`
      INSERT INTO booking_payment_instructions(booking_id,visa_card_number,visa_holder,payme_qr_object_key,payme_qr_content_type,humo_card_number,humo_holder,instructions,updated_by,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(booking_id) DO UPDATE SET
        visa_card_number=excluded.visa_card_number,
        visa_holder=excluded.visa_holder,
        payme_qr_object_key=excluded.payme_qr_object_key,
        payme_qr_content_type=excluded.payme_qr_content_type,
        humo_card_number=excluded.humo_card_number,
        humo_holder=excluded.humo_holder,
        instructions=excluded.instructions,
        updated_by=excluded.updated_by,
        updated_at=excluded.updated_at
    `).bind(
      bookingID,template.visa_card_number || '',template.visa_holder || '',newQRKey,newQRContentType,
      template.humo_card_number || '',template.humo_holder || '',template.instructions || '',cleanText(user?.login,180),now
    ).run();
  } catch (error) {
    if (newQRKey) await env.HOTELS_MEDIA.delete(newQRKey).catch(() => {});
    throw error;
  }
  if (current?.payme_qr_object_key && current.payme_qr_object_key !== newQRKey) {
    await env.HOTELS_MEDIA.delete(current.payme_qr_object_key).catch(() => {});
  }
  return json({ ok: true, checkout: await adminCheckoutDetail(env, bookingID, trip) });
}

async function publicTeam(env, parts) {
  if (parts.length === 2 && parts[1] === 'photo') {
    const slug = cleanText(parts[0], 120);
    if (!slug) return json({ ok: false, error: 'INVALID_PROFILE' }, 400);
    const row = await env.HOTELS_DB.prepare('SELECT photo_object_key,photo_content_type FROM team_members WHERE public_slug=? AND active=1 AND public_visible=1 LIMIT 1').bind(slug).first();
    if (!row?.photo_object_key) return json({ ok: false, error: 'PHOTO_NOT_FOUND' }, 404);
    const object = await env.HOTELS_MEDIA.get(row.photo_object_key);
    if (!object) return json({ ok: false, error: 'PHOTO_NOT_FOUND' }, 404);
    return new Response(object.body, { headers: { 'content-type': row.photo_content_type || 'image/jpeg', 'cache-control': 'public, max-age=3600' } });
  }
  if (parts.length === 0) {
    const result = await env.HOTELS_DB.prepare(`SELECT * FROM team_members WHERE active=1 AND public_visible=1 ORDER BY is_owner DESC, sort_order ASC, last_name COLLATE NOCASE, first_name COLLATE NOCASE`).all();
    return json({ ok: true, members: (result.results || []).map(row => mapTeamMember(row, false)) }, 200, PUBLIC_CACHE_HEADERS);
  }
  const slug = cleanText(parts[0], 120);
  if (!slug) return json({ ok: false, error: 'INVALID_PROFILE' }, 400);
  const row = await env.HOTELS_DB.prepare('SELECT * FROM team_members WHERE public_slug=? AND active=1 AND public_visible=1 LIMIT 1').bind(slug).first();
  if (!row) return json({ ok: false, error: 'PROFILE_NOT_FOUND' }, 404);
  return json({ ok: true, member: mapTeamMember(row, false) }, 200, PUBLIC_CACHE_HEADERS);
}

async function fetchUpstreamBookings(request, env) {
  const cookie = request.headers.get('cookie') || '';
  const response = await fetch(env.BOOKINGS_ADMIN_URL || 'https://iumrah.app/api/admin/bookings', {
    method: 'GET',
    headers: {
      'cookie': cookie,
      'accept': 'application/json',
      'user-agent': request.headers.get('user-agent') || 'iumrah-business'
    },
    redirect: 'manual'
  });
  if (!response.ok) throw new Error(`BOOKINGS_UPSTREAM_${response.status}`);
  const payload = await response.json().catch(() => null);
  return Array.isArray(payload?.bookings) ? payload.bookings : [];
}

function deepScalar(root, candidates) {
  const wanted = new Set(candidates.map(value => value.toLowerCase()));
  const queue = [{ value: root, depth: 0 }];
  const seen = new Set();
  while (queue.length) {
    const { value, depth } = queue.shift();
    if (!value || typeof value !== 'object' || depth > 4 || seen.has(value)) continue;
    seen.add(value);
    for (const [key, child] of Object.entries(value)) {
      if (wanted.has(key.toLowerCase()) && (typeof child === 'string' || typeof child === 'number')) {
        const text = String(child).trim();
        if (text) return text;
      }
    }
    for (const child of Object.values(value)) {
      if (child && typeof child === 'object') queue.push({ value: child, depth: depth + 1 });
    }
  }
  return '';
}

function bookingIdentity(raw) {
  const firstName = deepScalar(raw, ['firstName','first_name','givenName']);
  const lastName = deepScalar(raw, ['lastName','last_name','familyName','surname']);
  const explicitName = deepScalar(raw, ['clientName','customerName','travelerName','travellerName','fullName','displayName']);
  const email = deepScalar(raw, ['email','emailAddress']);
  const phone = deepScalar(raw, ['phone','phoneNumber','mobile','whatsapp']);
  const displayName = [firstName, lastName].filter(Boolean).join(' ').trim() || explicitName || '';
  return { firstName, lastName, displayName, email, phone };
}

function extractPricingSnapshot(raw) {
  const candidates = ['pricingSnapshot','pricing_snapshot','pricing','priceBreakdown','pricingBreakdown','costBreakdown','generationReport','packagePricing','quote'];
  for (const key of candidates) {
    if (raw && typeof raw === 'object' && raw[key] && typeof raw[key] === 'object') return raw[key];
  }
  return {};
}

function normalizedTripStatus(value) {
  const raw = String(value || '').toUpperCase();
  const map = {
    NEW:'availability_check', AVAILABILITY_CHECK:'availability_check',
    PAYMENT_PENDING:'payment_pending', PAID:'booking_confirmed', BOOKING_CONFIRMED:'booking_confirmed',
    DOCUMENTS_READY:'ready_to_travel', READY_TO_TRAVEL:'ready_to_travel',
    IN_TRIP:'in_trip', COMPLETED:'completed', CANCELLED:'cancelled'
  };
  return map[raw] || (TRIP_STATUSES.has(String(value || '').toLowerCase()) ? String(value).toLowerCase() : 'availability_check');
}

function tripStatusFromBooking(raw) { return normalizedTripStatus(raw?.status); }

async function createPilgrim(env, identity) {
  const now = new Date().toISOString();
  const result = await env.HOTELS_DB.prepare(`INSERT INTO pilgrims (first_name,last_name,display_name,phone,email,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`)
    .bind(identity.firstName || '', identity.lastName || '', identity.displayName || 'Паломник', identity.phone || '', identity.email || '', now, now).run();
  return env.HOTELS_DB.prepare('SELECT * FROM pilgrims WHERE id=?').bind(Number(result?.meta?.last_row_id || 0)).first();
}

function pilgrimPublicID(id) { return String(Number(id || 0)).padStart(6, '0'); }
function bookingPublicNumber(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) return null;
  return `#${String(Math.trunc(number)).padStart(4, '0')}`;
}
async function allocateBookingNumber(env) {
  const row = await env.HOTELS_DB.prepare('UPDATE booking_number_sequence SET next_number=next_number+1 WHERE id=1 RETURNING next_number-1 AS booking_number').first();
  const number = Number(row?.booking_number || 0);
  if (!number) throw new Error('BOOKING_NUMBER_ALLOCATION_FAILED');
  return number;
}

function tripMap(row) {
  if (!row) return null;
  return {
    tripID:row.id, bookingID:row.booking_id, bookingNumber:Number(row.booking_number||0)||null,
    bookingDisplayNumber:bookingPublicNumber(row.booking_number), pilgrimID:pilgrimPublicID(row.pilgrim_id),
    status:normalizedTripStatus(row.status), paymentStatus:row.payment_status||'',
    confirmationNumber:row.confirmation_number||'', internalNotes:row.internal_notes||'',
    startDate:row.start_date||null, endDate:row.end_date||null, createdAt:row.created_at,
    updatedAt:row.updated_at, completedAt:row.completed_at||null,
    availabilityStartedAt:row.availability_started_at||null,
    availabilityDeadlineAt:row.availability_deadline_at||null,
    priceLockStartedAt:row.price_lock_started_at||null,
    priceLockExpiresAt:row.price_lock_expires_at||null,
    paymentReceivedAt:row.payment_received_at||null,
    paymentConfirmationDeadlineAt:row.payment_confirmation_deadline_at||null,
    documentsStartedAt:row.documents_started_at||null,
    documentsDeadlineAt:row.documents_deadline_at||null
  };
}

function lifecycleISOAfter(start, milliseconds) {
  const base = Date.parse(start || '');
  return new Date((Number.isFinite(base) ? base : Date.now()) + milliseconds).toISOString();
}

async function ensureTripLifecycleTimers(env, bookingID) {
  const trip = await env.HOTELS_DB.prepare('SELECT * FROM pilgrim_trips WHERE booking_id=? LIMIT 1').bind(bookingID).first();
  if (!trip) return null;
  const status = normalizedTripStatus(trip.status);
  const start = trip.created_at || new Date().toISOString();
  if (status === 'availability_check' && (!trip.availability_started_at || !trip.availability_deadline_at)) {
    const startedAt = trip.availability_started_at || start;
    await env.HOTELS_DB.prepare('UPDATE pilgrim_trips SET availability_started_at=?,availability_deadline_at=? WHERE booking_id=?')
      .bind(startedAt,lifecycleISOAfter(startedAt,6*60*60_000),bookingID).run();
  } else if (status === 'payment_pending' && !trip.payment_received_at && (!trip.price_lock_started_at || !trip.price_lock_expires_at)) {
    const startedAt = trip.price_lock_started_at || trip.updated_at || start;
    await env.HOTELS_DB.prepare('UPDATE pilgrim_trips SET price_lock_started_at=?,price_lock_expires_at=? WHERE booking_id=?')
      .bind(startedAt,lifecycleISOAfter(startedAt,30*60_000),bookingID).run();
  } else if (status === 'payment_pending' && trip.payment_received_at && !trip.payment_confirmation_deadline_at) {
    await env.HOTELS_DB.prepare('UPDATE pilgrim_trips SET payment_confirmation_deadline_at=? WHERE booking_id=?')
      .bind(lifecycleISOAfter(trip.payment_received_at,10*60_000),bookingID).run();
  } else if (status === 'booking_confirmed' && (!trip.documents_started_at || !trip.documents_deadline_at)) {
    const startedAt = trip.documents_started_at || trip.updated_at || start;
    await env.HOTELS_DB.prepare('UPDATE pilgrim_trips SET documents_started_at=?,documents_deadline_at=? WHERE booking_id=?')
      .bind(startedAt,lifecycleISOAfter(startedAt,24*60*60_000),bookingID).run();
  }
  return env.HOTELS_DB.prepare('SELECT * FROM pilgrim_trips WHERE booking_id=? LIMIT 1').bind(bookingID).first();
}

async function clientStatusHistory(env, bookingID) {
  const rows = await env.HOTELS_DB.prepare('SELECT old_status,new_status,created_at FROM booking_status_history WHERE booking_id=? ORDER BY created_at ASC LIMIT 100').bind(bookingID).all();
  return (rows.results || []).map(row => ({ oldStatus:row.old_status||null, newStatus:normalizedTripStatus(row.new_status), createdAt:row.created_at }));
}

async function sourceBookingPayload(env, bookingID) {
  if (!env.BOOKINGS_DB) return {};
  const row = await env.BOOKINGS_DB.prepare('SELECT payload_json FROM bookings WHERE id=? LIMIT 1').bind(bookingID).first().catch(() => null);
  return parseJSONObject(row?.payload_json);
}

function mergeSourceBooking(raw, sourcePayload) {
  const source = sourcePayload && typeof sourcePayload === 'object' ? sourcePayload : {};
  const merged = { ...source, ...(raw && typeof raw === 'object' ? raw : {}) };
  if ((!raw?.pilgrimProfile || typeof raw.pilgrimProfile !== 'object') && source?.pilgrimProfile) merged.pilgrimProfile = source.pilgrimProfile;
  if ((!raw?.selection || typeof raw.selection !== 'object') && source?.selection) merged.selection = source.selection;
  if ((!raw?.hotelNames || typeof raw.hotelNames !== 'object') && source?.hotelNames) merged.hotelNames = source.hotelNames;
  return merged;
}


async function applyPendingPackagePricingReport(env, bookingID) {
  // PackageEngine may accept the sealed pricing report before the Business trip is
  // materialized. This post-booking table is the durable server-to-server hand-off.
  // Rollout-safe: if the migration has not reached this environment yet, booking
  // sync continues and the PackageEngine/client can retry later.
  let pending;
  try {
    pending = await env.HOTELS_DB.prepare(
      'SELECT quote_id,pricing_version,pricing_snapshot_json FROM pending_package_pricing_reports WHERE booking_id=? LIMIT 1'
    ).bind(bookingID).first();
  } catch (error) {
    if (String(error?.message || '').toLowerCase().includes('no such table')) return false;
    throw error;
  }
  if (!pending) return false;

  const pendingPricing = parseJSONObject(pending.pricing_snapshot_json);
  const pendingQuoteID = cleanText(pending.quote_id, 220);
  if (!pendingQuoteID || !pendingPricing || typeof pendingPricing !== 'object' || String(pendingPricing.quoteId || '') !== pendingQuoteID) {
    console.error('PENDING_PACKAGE_PRICING_INVALID', { bookingID, quoteID: pendingQuoteID });
    return false;
  }

  const trip = await env.HOTELS_DB.prepare(
    'SELECT id,pricing_snapshot_json FROM pilgrim_trips WHERE booking_id=? LIMIT 1'
  ).bind(bookingID).first();
  if (!trip) return false;

  const existingPricing = parseJSONObject(trip.pricing_snapshot_json);
  const existingKeys = existingPricing && typeof existingPricing === 'object' ? Object.keys(existingPricing) : [];
  if (existingKeys.length > 0) {
    if (String(existingPricing.quoteId || '') === pendingQuoteID) {
      await env.HOTELS_DB.prepare('DELETE FROM pending_package_pricing_reports WHERE booking_id=?').bind(bookingID).run();
      return true;
    }
    // Never overwrite an already committed cost report with another quote. Keep
    // the pending row for staff/debug visibility instead of destroying evidence.
    console.error('PACKAGE_PRICING_IMMUTABILITY_CONFLICT', {
      bookingID,
      existingQuoteID: String(existingPricing.quoteId || ''),
      pendingQuoteID,
    });
    return false;
  }

  const now = new Date().toISOString();
  await env.HOTELS_DB.prepare(
    `UPDATE pilgrim_trips
     SET pricing_snapshot_json=?,updated_at=?
     WHERE booking_id=?
       AND (pricing_snapshot_json IS NULL OR TRIM(pricing_snapshot_json)='' OR TRIM(pricing_snapshot_json)='{}')`
  ).bind(JSON.stringify(pendingPricing),now,bookingID).run();

  const persisted = await env.HOTELS_DB.prepare(
    'SELECT pricing_snapshot_json FROM pilgrim_trips WHERE booking_id=? LIMIT 1'
  ).bind(bookingID).first();
  const persistedPricing = parseJSONObject(persisted?.pricing_snapshot_json);
  if (String(persistedPricing.quoteId || '') !== pendingQuoteID) return false;

  await env.HOTELS_DB.prepare('DELETE FROM pending_package_pricing_reports WHERE booking_id=?').bind(bookingID).run();
  return true;
}

async function updatePilgrimIdentityFields(env, pilgrim, identity) {
  if (!pilgrim) return null;
  const now = new Date().toISOString();
  await env.HOTELS_DB.prepare(`UPDATE pilgrims SET first_name=CASE WHEN ?<>'' THEN ? ELSE first_name END,last_name=CASE WHEN ?<>'' THEN ? ELSE last_name END,display_name=CASE WHEN ?<>'' THEN ? ELSE display_name END,phone=CASE WHEN ?<>'' THEN ? ELSE phone END,email=CASE WHEN ?<>'' THEN ? ELSE email END,updated_at=? WHERE id=?`)
    .bind(identity.firstName||'',identity.firstName||'',identity.lastName||'',identity.lastName||'',identity.displayName||'',identity.displayName||'',identity.phone||'',identity.phone||'',identity.email||'',identity.email||'',now,pilgrim.id).run();
  return env.HOTELS_DB.prepare('SELECT * FROM pilgrims WHERE id=?').bind(pilgrim.id).first();
}

async function syncBookingTrip(env, raw) {
  const bookingID = cleanText(raw?.id, 180); if (!bookingID) return null;
  const tombstone = await env.HOTELS_DB.prepare('SELECT booking_id FROM booking_tombstones WHERE booking_id=? LIMIT 1').bind(bookingID).first().catch(()=>null);
  if (tombstone) return { deleted:true, pilgrim:null, trip:null };
  const sourcePayload = await sourceBookingPayload(env, bookingID);
  const effectiveRaw = mergeSourceBooking(raw, sourcePayload);
  let trip = await env.HOTELS_DB.prepare('SELECT * FROM pilgrim_trips WHERE booking_id=? LIMIT 1').bind(bookingID).first();
  const now = new Date().toISOString();
  const identity = bookingIdentity(effectiveRaw);
  // Pricing is server-owned by PackageEngine. Never ingest supplier costs or
  // margin data from the public booking payload. The operational row starts empty
  // and PackageEngine attaches the sealed report only after booking creation.
  const startDate = cleanText(effectiveRaw?.startDate,64); const endDate = cleanText(effectiveRaw?.endDate,64);
  let pilgrim;
  if (!trip) {
    pilgrim = await createPilgrim(env, identity); if (!pilgrim) return null;
    const bookingNumber = await allocateBookingNumber(env);
    await env.HOTELS_DB.prepare(`INSERT INTO pilgrim_trips (id,booking_id,booking_number,pilgrim_id,status,start_date,end_date,booking_snapshot_json,pricing_snapshot_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(`trip-${crypto.randomUUID()}`,bookingID,bookingNumber,pilgrim.id,tripStatusFromBooking(effectiveRaw),startDate,endDate,JSON.stringify(effectiveRaw),'{}',now,now).run();
  } else {
    pilgrim = await env.HOTELS_DB.prepare('SELECT * FROM pilgrims WHERE id=?').bind(trip.pilgrim_id).first();
    pilgrim = await updatePilgrimIdentityFields(env,pilgrim,identity);
    const previous = parseJSONObject(trip.booking_snapshot_json); const merged={...previous,...effectiveRaw};
    await env.HOTELS_DB.prepare(`UPDATE pilgrim_trips SET start_date=COALESCE(?,start_date),end_date=COALESCE(?,end_date),booking_snapshot_json=?,updated_at=? WHERE booking_id=?`)
      .bind(startDate,endDate,JSON.stringify(merged),now,bookingID).run();
  }
  trip=await ensureTripLifecycleTimers(env,bookingID);
  await applyPendingPackagePricingReport(env, bookingID);
  pilgrim=pilgrim||await env.HOTELS_DB.prepare('SELECT * FROM pilgrims WHERE id=?').bind(trip.pilgrim_id).first();
  const stats=await env.HOTELS_DB.prepare('SELECT COUNT(*) AS count,MAX(COALESCE(end_date,created_at)) AS last_trip FROM pilgrim_trips WHERE pilgrim_id=?').bind(pilgrim.id).first();
  await env.HOTELS_DB.prepare('UPDATE pilgrims SET total_trips=?,last_trip_at=?,updated_at=? WHERE id=?').bind(Number(stats?.count||0),stats?.last_trip||null,now,pilgrim.id).run();
  return {pilgrim,trip};
}

function canonicalPilgrimName(pilgrim, identity=null) {
  const firstName=safeHumanText(pilgrim?.first_name||identity?.firstName||'',120)||''; const lastName=safeHumanText(pilgrim?.last_name||identity?.lastName||'',120)||'';
  return [firstName,lastName].filter(Boolean).join(' ').trim() || safeHumanText(pilgrim?.display_name||identity?.displayName||'',220) || 'Паломник';
}
async function bookingPilgrimName(env,bookingID,fallback='') { const row=await env.HOTELS_DB.prepare(`SELECT p.first_name,p.last_name,p.display_name FROM pilgrim_trips t JOIN pilgrims p ON p.id=t.pilgrim_id WHERE t.booking_id=? LIMIT 1`).bind(bookingID).first().catch(()=>null); return canonicalPilgrimName(row,{displayName:fallback}); }
function augmentBooking(raw,linked) { const identity=bookingIdentity(raw); return {...raw,clientName:canonicalPilgrimName(linked?.pilgrim,identity),pilgrimID:linked?.pilgrim?pilgrimPublicID(linked.pilgrim.id):null,bookingNumber:Number(linked?.trip?.booking_number||0)||null,bookingDisplayNumber:bookingPublicNumber(linked?.trip?.booking_number),tripID:linked?.trip?.id||null,operationStatus:linked?.trip?.status||tripStatusFromBooking(raw)}; }
async function cleanupOrphanLegacyPilgrims(env) { await env.HOTELS_DB.prepare(`DELETE FROM pilgrims WHERE NOT EXISTS (SELECT 1 FROM pilgrim_trips t WHERE t.pilgrim_id=pilgrims.id) AND NOT EXISTS (SELECT 1 FROM iumrah_accounts a WHERE a.pilgrim_id=pilgrims.id)`).run().catch(()=>{}); }

async function operationsBookings(request, env) {
  let bookings;
  try { bookings = await fetchUpstreamBookings(request, env); }
  catch (error) { return json({ ok: false, error: String(error?.message || 'BOOKINGS_UNAVAILABLE') }, 502); }
  const deletedRows = await env.HOTELS_DB.prepare('SELECT booking_id FROM booking_tombstones').all().catch(() => ({ results: [] }));
  const deletedIDs = new Set((deletedRows.results || []).map(row => String(row.booking_id || '')));
  const source = bookings.filter(item => !deletedIDs.has(String(item?.id || ''))).slice(0, 500);
  const output = new Array(source.length);
  const chunkSize = 8;
  for (let offset = 0; offset < source.length; offset += chunkSize) {
    const chunk = source.slice(offset, offset + chunkSize);
    let linkedChunk;
    try {
      linkedChunk = await Promise.all(chunk.map(async raw => {
        try { return await syncBookingTrip(env, raw); }
        catch (error) {
          const wrapped = new Error(`BOOKING_SYNC_FAILED:${cleanText(raw?.id, 180) || 'UNKNOWN'}:${cleanText(error?.message, 220) || 'ERROR'}`);
          wrapped.cause = error;
          throw wrapped;
        }
      }));
    } catch (error) {
      console.error('BOOKING_OPERATION_SYNC_FAILED', error);
      return json({ ok: false, error: cleanText(error?.message, 420) || 'BOOKING_OPERATION_SYNC_FAILED' }, 500);
    }
    chunk.forEach((raw, index) => { output[offset + index] = augmentBooking(raw, linkedChunk[index]); });
  }
  await cleanupOrphanLegacyPilgrims(env);
  return json({ bookings: output });
}


async function ensureBookingItinerarySchema(env) {
  await env.HOTELS_DB.prepare(`
    CREATE TABLE IF NOT EXISTS booking_itinerary_items (
      id TEXT PRIMARY KEY,
      booking_id TEXT NOT NULL,
      date_local TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      title TEXT NOT NULL,
      subtitle TEXT NOT NULL DEFAULT '',
      icon TEXT NOT NULL DEFAULT 'calendar',
      location TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `).run();
  await env.HOTELS_DB.prepare('CREATE INDEX IF NOT EXISTS idx_booking_itinerary_booking_date ON booking_itinerary_items(booking_id, date_local, sort_order)').run();
}

function itineraryDay(value) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return '';
  const parsed = Date.parse(`${text}T12:00:00Z`);
  return Number.isFinite(parsed) ? text : '';
}

function addItineraryDays(day, offset) {
  const valid = itineraryDay(day);
  if (!valid) return '';
  const date = new Date(`${valid}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + Number(offset || 0));
  return date.toISOString().slice(0, 10);
}

function itineraryItemMap(row) {
  return {
    id: row.id,
    bookingID: row.booking_id,
    dateLocal: row.date_local,
    sortOrder: Number(row.sort_order || 0),
    title: row.title || '',
    subtitle: row.subtitle || '',
    icon: row.icon || 'calendar',
    location: row.location || '',
    notes: row.notes || '',
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || ''
  };
}

async function seedBookingItineraryIfNeeded(env, bookingID, trip = null) {
  await ensureBookingItinerarySchema(env);
  const count = await env.HOTELS_DB.prepare('SELECT COUNT(*) AS count FROM booking_itinerary_items WHERE booking_id=?').bind(bookingID).first();
  if (Number(count?.count || 0) > 0) return;

  const resolvedTrip = trip || await env.HOTELS_DB.prepare('SELECT * FROM pilgrim_trips WHERE booking_id=? LIMIT 1').bind(bookingID).first();
  if (!resolvedTrip) return;
  const snapshot = parseJSONObject(resolvedTrip.booking_snapshot_json);
  const input = snapshot?.input && typeof snapshot.input === 'object' ? snapshot.input : {};
  const stay = snapshot?.stay && typeof snapshot.stay === 'object' ? snapshot.stay : {};
  const route = snapshot?.route && typeof snapshot.route === 'object' ? snapshot.route : {};
  const hotelNames = snapshot?.hotelNames && typeof snapshot.hotelNames === 'object' ? snapshot.hotelNames : {};
  const customization = snapshot?.customization && typeof snapshot.customization === 'object' ? snapshot.customization : {};
  const trace = snapshot?.generatorTrace && typeof snapshot.generatorTrace === 'object' ? snapshot.generatorTrace : {};

  const start = itineraryDay(resolvedTrip.start_date || input.startDate || snapshot.startDate);
  const end = itineraryDay(resolvedTrip.end_date || input.endDate || snapshot.endDate);
  if (!start) return;

  const events = [];
  const push = (dateLocal, title, subtitle = '', icon = 'calendar', location = '', notes = '') => {
    const day = itineraryDay(dateLocal);
    if (!day) return;
    events.push({ id: `iti-${crypto.randomUUID()}`, dateLocal: day, sortOrder: events.filter(item => item.dateLocal === day).length, title, subtitle, icon, location, notes });
  };

  const outbound = trace?.outbound || {};
  const inbound = trace?.inbound || {};
  const outboundLabel = [safeHumanText(outbound.airline || '', 120), safeHumanText(outbound.flightNumbers || '', 120)].filter(Boolean).join(' · ');
  const inboundLabel = [safeHumanText(inbound.airline || '', 120), safeHumanText(inbound.flightNumbers || '', 120)].filter(Boolean).join(' · ');
  const origin = cleanText(route.originCode || input.originCode, 12) || '';
  const destination = cleanText(route.outboundDestination || input.arrivalAirportCode, 12) || '';

  push(start, 'Прилёт и встреча', outboundLabel || `${origin} → ${destination}`, 'airplane.arrival', destination);
  if (hotelNames.makkah) push(start, 'Заселение в отель', safeHumanText(hotelNames.makkah, 220) || '', 'building.2.fill', 'Makkah');

  const umrahDay = addItineraryDays(start, 1);
  if (!end || umrahDay <= end) push(umrahDay, 'Умра', 'Ихрам · таваф · са’й', 'moon.stars.fill', 'Masjid al-Haram');

  if (customization.ziyaratMakkah !== false) {
    const ziyaratMakkahDay = addItineraryDays(start, 2);
    if (!end || ziyaratMakkahDay <= end) push(ziyaratMakkahDay, 'Зиярат в Мекке', 'Маршрут святых мест', 'mappin.and.ellipse', 'Makkah');
  }

  const madinahCheckIn = itineraryDay(stay.madinahCheckIn);
  if (madinahCheckIn) {
    push(madinahCheckIn, 'Переезд в Медину', 'Междугородний трансфер', 'car.side.fill', 'Madinah');
    if (hotelNames.madinah) push(madinahCheckIn, 'Заселение в отель', safeHumanText(hotelNames.madinah, 220) || '', 'building.2.fill', 'Madinah');
    const madinahVisit = addItineraryDays(madinahCheckIn, 1);
    if (!end || madinahVisit <= end) push(madinahVisit, 'Зиярат в Медине', 'Мечеть Пророка ﷺ и места зиярата', 'building.columns.fill', 'Madinah');
  }

  if (end) push(end, 'Обратный рейс', inboundLabel || `${cleanText(route.returnOrigin, 12) || destination} → ${origin}`, 'airplane.departure', cleanText(route.returnOrigin, 12) || destination);

  if (!events.length) return;
  const now = new Date().toISOString();
  await env.HOTELS_DB.batch(events.map(item => env.HOTELS_DB.prepare(`INSERT INTO booking_itinerary_items (id,booking_id,date_local,sort_order,title,subtitle,icon,location,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(item.id, bookingID, item.dateLocal, item.sortOrder, item.title, item.subtitle, item.icon, item.location, item.notes, now, now)));
}

async function bookingItineraryDetail(env, bookingID, trip = null) {
  await seedBookingItineraryIfNeeded(env, bookingID, trip);
  const rows = await env.HOTELS_DB.prepare('SELECT * FROM booking_itinerary_items WHERE booking_id=? ORDER BY date_local ASC, sort_order ASC, created_at ASC').bind(bookingID).all();
  return json({ ok: true, bookingID, items: (rows.results || []).map(itineraryItemMap) });
}

async function saveBookingItinerary(request, env, bookingID) {
  await ensureBookingItinerarySchema(env);
  const trip = await env.HOTELS_DB.prepare('SELECT * FROM pilgrim_trips WHERE booking_id=? LIMIT 1').bind(bookingID).first();
  if (!trip) return json({ ok: false, error: 'BOOKING_NOT_SYNCED' }, 404);
  const payload = await request.json().catch(() => null);
  const rawItems = Array.isArray(payload?.items) ? payload.items : null;
  if (!rawItems) return json({ ok: false, error: 'ITEMS_REQUIRED' }, 400);
  if (rawItems.length > 80) return json({ ok: false, error: 'TOO_MANY_ITINERARY_ITEMS' }, 400);

  const snapshot = parseJSONObject(trip.booking_snapshot_json);
  const start = itineraryDay(trip.start_date || snapshot?.input?.startDate || snapshot?.startDate);
  const end = itineraryDay(trip.end_date || snapshot?.input?.endDate || snapshot?.endDate);
  const now = new Date().toISOString();
  const items = [];

  for (let index = 0; index < rawItems.length; index += 1) {
    const raw = rawItems[index] || {};
    const dateLocal = itineraryDay(raw.dateLocal || raw.date);
    if (!dateLocal) return json({ ok: false, error: 'INVALID_ITINERARY_DATE', index }, 400);
    if (start && dateLocal < start) return json({ ok: false, error: 'ITINERARY_DATE_BEFORE_TRIP', index }, 409);
    if (end && dateLocal > end) return json({ ok: false, error: 'ITINERARY_DATE_AFTER_TRIP', index }, 409);
    const title = safeHumanText(raw.title || '', 180);
    if (!title) return json({ ok: false, error: 'ITINERARY_TITLE_REQUIRED', index }, 400);
    const rawID = cleanText(raw.id, 120) || '';
    const id = /^[A-Za-z0-9_-]{6,120}$/.test(rawID) ? rawID : `iti-${crypto.randomUUID()}`;
    items.push({
      id,
      bookingID,
      dateLocal,
      sortOrder: Number.isFinite(Number(raw.sortOrder)) ? Math.max(0, Math.trunc(Number(raw.sortOrder))) : index,
      title,
      subtitle: safeHumanText(raw.subtitle || '', 320) || '',
      icon: cleanText(raw.icon, 80) || 'calendar',
      location: safeHumanText(raw.location || '', 180) || '',
      notes: safeHumanText(raw.notes || '', 1200) || '',
      createdAt: cleanText(raw.createdAt, 80) || now,
      updatedAt: now
    });
  }

  const statements = [env.HOTELS_DB.prepare('DELETE FROM booking_itinerary_items WHERE booking_id=?').bind(bookingID)];
  for (const item of items) {
    statements.push(env.HOTELS_DB.prepare(`INSERT INTO booking_itinerary_items (id,booking_id,date_local,sort_order,title,subtitle,icon,location,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(item.id, bookingID, item.dateLocal, item.sortOrder, item.title, item.subtitle, item.icon, item.location, item.notes, item.createdAt, item.updatedAt));
  }
  await env.HOTELS_DB.batch(statements);
  return bookingItineraryDetail(env, bookingID, trip);
}

function humanizeFieldKey(value) {
  return String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, char => char.toUpperCase());
}

function russianPricingComponentLabel(codeValue, labelValue, index = null) {
  const code = String(codeValue || '').trim().toLowerCase();
  const label = String(labelValue || '').trim();
  if (/^flight_|airfare|journey_fare|air_ticket/.test(code)) return 'Авиабилет';
  if (code === 'makkah_hotel') return 'Отель в Мекке';
  if (code === 'madinah_hotel') return 'Отель в Медине';
  if (code === 'hotel' || /hotel/.test(code)) return 'Отель';
  if (/^visa/.test(code)) return 'Виза';
  if (/meal|food/.test(code)) return 'Питание';
  if (/transfer|transport/.test(code)) return 'Трансфер';
  if (/haramain|train/.test(code)) return 'Поезд Haramain';
  if (/accompaniment|guide/.test(code)) return 'Гид';
  if (code === 'ziyarat_makkah') return 'Зиярат в Мекке';
  if (code === 'ziyarat_madinah') return 'Зиярат в Медине';
  if (/ziyarat/.test(code)) return 'Зиярат';
  if (/esim|sim/.test(code)) return 'eSIM';
  if (/care|support/.test(code)) return 'iumrah Care';
  if (/platform|service/.test(code)) return 'Сервис iumrah';

  const lowerLabel = label.toLowerCase();
  if (/flight|airfare|air ticket|перел[её]т|авиабилет/.test(lowerLabel)) return 'Авиабилет';
  if (/makkah.*hotel|hotel.*makkah|отель.*мекк/.test(lowerLabel)) return 'Отель в Мекке';
  if (/madinah.*hotel|hotel.*madinah|отель.*медин/.test(lowerLabel)) return 'Отель в Медине';
  if (/hotel|отель/.test(lowerLabel)) return 'Отель';
  if (/transfer|трансфер/.test(lowerLabel)) return 'Трансфер';
  if (/guide|accompan|сопровожд|гид/.test(lowerLabel)) return 'Гид';
  if (/visa|виз/.test(lowerLabel)) return 'Виза';
  if (/meal|food|питан/.test(lowerLabel)) return 'Питание';
  if (/ziyarat|зиярат/.test(lowerLabel)) return label || 'Зиярат';
  if (label && /[А-Яа-яЁё]/.test(label)) return label;
  return index != null ? `Компонент ${index}` : 'Компонент';
}

function legacyPricingComponentLabel(index, total, hasSeparateMadinahHotel) {
  const n = Number(index || 0);
  const count = Number(total || 0);
  if (!Number.isInteger(n) || n < 1) return null;

  // Older pricing snapshots sometimes persisted component amounts without their
  // `code`/`label`. Preserve the exact component order emitted by the existing
  // LocalPackagePricingEngine instead of exposing JSON paths to Business users.
  if (hasSeparateMadinahHotel) {
    const hasTrain = count >= 11;
    const labels = hasTrain
      ? ['Авиабилет', 'Отель в Мекке', 'Отель в Медине', 'Виза', 'Питание', 'Трансфер', 'Поезд Haramain', 'Гид', 'Зиярат в Мекке', 'Зиярат в Медине', 'iumrah Care']
      : ['Авиабилет', 'Отель в Мекке', 'Отель в Медине', 'Виза', 'Питание', 'Трансфер', 'Гид', 'Зиярат в Мекке', 'Зиярат в Медине', 'iumrah Care'];
    return labels[n - 1] || null;
  }

  // Single-hotel storefront/legacy mode. A 10-item snapshot contains Haramain;
  // a 9-item snapshot does not.
  if (count >= 9) {
    const hasTrain = count >= 10;
    const labels = hasTrain
      ? ['Авиабилет', 'Отель', 'Виза', 'Питание', 'Трансфер', 'Поезд Haramain', 'Гид', 'Зиярат в Мекке', 'Зиярат в Медине', 'iumrah Care']
      : ['Авиабилет', 'Отель', 'Виза', 'Питание', 'Трансфер', 'Гид', 'Зиярат в Мекке', 'Зиярат в Медине', 'iumrah Care'];
    return labels[n - 1] || null;
  }

  // Makkah-only package mode. Nine items means the optional Haramain component
  // is present; eight means it is absent.
  const hasTrain = count >= 9;
  const labels = hasTrain
    ? ['Авиабилет', 'Отель в Мекке', 'Виза', 'Питание', 'Трансфер', 'Поезд Haramain', 'Гид', 'Зиярат в Мекке', 'iumrah Care']
    : ['Авиабилет', 'Отель в Мекке', 'Виза', 'Питание', 'Трансфер', 'Гид', 'Зиярат в Мекке', 'iumrah Care'];
  return labels[n - 1] || null;
}

function russianPricingScalarLabel(value) {
  const key = String(value || '').trim().toLowerCase().replace(/[_-]+/g, '');
  const map = {
    suppliercostusd: 'Себестоимость',
    amountusd: 'Сумма',
    amount: 'Сумма',
    priceusd: 'Цена',
    totalusd: 'Итого',
    publictotalusd: 'Итого клиенту',
    publicpriceperpilgrimusd: 'На паломника',
    markupamountusd: 'Наценка',
    subtotalaftermarkupusd: 'После наценки',
    paymentfeeamountusd: 'Комиссия оплаты',
    calculatedsellingpriceusd: 'Расчётная цена',
    roundingdifferenceusd: 'Округление',
    estimatedprofitusd: 'Расчётная прибыль',
    markuprate: 'Ставка наценки',
    paymentfeerate: 'Ставка комиссии'
  };
  return map[key] || humanizeFieldKey(value);
}

function russianPricingGroup(pathValue) {
  const raw = String(pathValue || '');
  const lower = raw.toLowerCase();
  if (/components(?:\.|$)/.test(lower)) return 'Компоненты';
  if (/selectedpricinginputs.*journeyfare/.test(lower)) return 'Выбранная цена · Авиабилет';
  if (/selectedpricinginputs.*outbound/.test(lower)) return 'Выбранная цена · Перелёт туда';
  if (/selectedpricinginputs.*inbound/.test(lower)) return 'Выбранная цена · Перелёт обратно';
  if (/selectedpricinginputs.*makkahhotel/.test(lower)) return 'Выбранная цена · Отель в Мекке';
  if (/selectedpricinginputs.*madinahhotel/.test(lower)) return 'Выбранная цена · Отель в Медине';
  if (/totals(?:\.|$)/.test(lower)) return 'Итоги';
  if (/pricing/.test(lower)) return 'Расчёт пакета';
  return humanizeFieldKey(raw || 'Расчёт');
}

function flattenPricingLines(value) {
  const lines = [];
  const currency = deepScalar(value, ['currency','currencyCode']) || 'USD';
  const rootComponents = Array.isArray(value?.components) ? value.components : [];
  const hasSeparateMadinahHotel = value?.selectedPricingInputs?.madinahHotel != null;
  const walk = (node, path = [], depth = 0) => {
    if (depth > 5 || lines.length >= 120 || node == null) return;

    // pricingSnapshot.components is an array of named business components. Keep the
    // component identity instead of recursively flattening it into labels such as
    // "Components · 1 / Supplier Cost Usd".
    if (typeof node === 'object' && !Array.isArray(node) && /(?:^|\.)components\.\d+$/.test(path.join('.'))) {
      const amount = Number(node.supplierCostUsd ?? node.supplier_cost_usd ?? node.costUsd ?? node.amountUsd);
      if (Number.isFinite(amount)) {
        const index = Number(path[path.length - 1]) || null;
        lines.push({
          id: `${path.join('.')}.supplierCostUsd`,
          label: russianPricingComponentLabel(node.code, node.label, index)
            .replace(/^Компонент \d+$/, legacyPricingComponentLabel(index, rootComponents.length, hasSeparateMadinahHotel) || `Компонент ${index}`),
          group: 'Компоненты',
          amount,
          currency
        });
        return;
      }
    }

    if (typeof node === 'number' && Number.isFinite(node)) {
      const key = path.join('.');
      // Percentage rates are not money. The old generic fallback rendered 0.50 and
      // 0.02 as "$0.5 / $0.02", which is misleading. PricingReport shows them as
      // fixed percentages; the fallback omits them instead of pretending they are USD.
      if (/(markupRate|paymentFeeRate)$/i.test(key)) return;
      if (/(price|cost|fee|commission|margin|visa|hotel|flight|air|guide|transfer|transport|sim|support|total|amount|service|markup|profit)/i.test(key) && !/(count|guests|traveler|rooms|nights|days|year)/i.test(key)) {
        lines.push({
          id: key || `value-${lines.length}`,
          label: russianPricingScalarLabel(path[path.length - 1] || 'Amount'),
          group: russianPricingGroup(path.slice(0, -1).join('.')),
          amount: node,
          currency
        });
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((child, index) => walk(child, [...path, String(index + 1)], depth + 1));
      return;
    }
    if (typeof node === 'object') Object.entries(node).forEach(([key, child]) => walk(child, [...path, key], depth + 1));
  };
  walk(value);
  return lines;
}

function flattenRequestFields(raw) {
  const fields = [];
  const skip = /(^|\.)(pricing|priceBreakdown|pricingBreakdown|costBreakdown|generationReport|quote)(\.|$)/i;
  const walk = (node, path = [], depth = 0) => {
    if (depth > 4 || fields.length >= 120 || node == null) return;
    if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') {
      const keyPath = path.join('.');
      if (!skip.test(keyPath) && String(node).trim() !== '') fields.push({ id: keyPath, label: humanizeFieldKey(path[path.length - 1] || 'Value'), group: humanizeFieldKey(path.slice(0, -1).join(' · ') || 'Booking'), value: String(node) });
      return;
    }
    if (Array.isArray(node)) {
      node.slice(0, 20).forEach((child, index) => walk(child, [...path, String(index + 1)], depth + 1));
      return;
    }
    if (typeof node === 'object') Object.entries(node).forEach(([key, child]) => walk(child, [...path, key], depth + 1));
  };
  walk(raw);
  return fields;
}

async function rawBookingForDetail(request, env, bookingID) {
  const trip = await env.HOTELS_DB.prepare('SELECT * FROM pilgrim_trips WHERE booking_id=? LIMIT 1').bind(bookingID).first();
  try {
    const bookings = await fetchUpstreamBookings(request, env);
    const raw = bookings.find(item => String(item?.id || '') === bookingID);
    if (raw) return { raw, linked: await syncBookingTrip(env, raw) };
  } catch (error) {
    console.warn('BOOKING_DETAIL_UPSTREAM_FALLBACK', error);
  }
  if (trip) {
    const raw = parseJSONObject(trip.booking_snapshot_json);
    const pilgrim = await env.HOTELS_DB.prepare('SELECT * FROM pilgrims WHERE id=?').bind(trip.pilgrim_id).first();
    return { raw, linked: { trip, pilgrim } };
  }
  return null;
}


async function ensureBookingPricingOverrideSchema(env) {
  await env.HOTELS_DB.prepare(`CREATE TABLE IF NOT EXISTS booking_pricing_overrides (
    booking_id TEXT PRIMARY KEY,
    currency TEXT NOT NULL DEFAULT 'USD',
    components_json TEXT NOT NULL DEFAULT '[]',
    markup_rate REAL NOT NULL DEFAULT 0.50,
    payment_fee_rate REAL NOT NULL DEFAULT 0.02,
    supplier_cost_usd REAL NOT NULL DEFAULT 0,
    markup_amount_usd REAL NOT NULL DEFAULT 0,
    subtotal_after_markup_usd REAL NOT NULL DEFAULT 0,
    payment_fee_amount_usd REAL NOT NULL DEFAULT 0,
    calculated_selling_price_usd REAL NOT NULL DEFAULT 0,
    public_price_per_pilgrim_usd REAL NOT NULL DEFAULT 0,
    public_total_usd REAL NOT NULL DEFAULT 0,
    rounding_difference_usd REAL NOT NULL DEFAULT 0,
    estimated_profit_usd REAL NOT NULL DEFAULT 0,
    traveler_count INTEGER NOT NULL DEFAULT 1,
    updated_by TEXT,
    updated_at TEXT NOT NULL
  )`).run();
}

function bookingPricingOverrideMap(row) {
  if (!row) return null;
  return {
    bookingID: row.booking_id,
    currency: row.currency || 'USD',
    components: (() => { try { const value = JSON.parse(row.components_json || '[]'); return Array.isArray(value) ? value : []; } catch { return []; } })(),
    markupRate: Number(row.markup_rate || 0),
    paymentFeeRate: Number(row.payment_fee_rate || 0),
    travelerCount: Math.max(1, Number(row.traveler_count || 1)),
    totals: {
      supplierCostUsd: Number(row.supplier_cost_usd || 0),
      markupRate: Number(row.markup_rate || 0),
      markupAmountUsd: Number(row.markup_amount_usd || 0),
      subtotalAfterMarkupUsd: Number(row.subtotal_after_markup_usd || 0),
      paymentFeeRate: Number(row.payment_fee_rate || 0),
      paymentFeeAmountUsd: Number(row.payment_fee_amount_usd || 0),
      calculatedSellingPriceUsd: Number(row.calculated_selling_price_usd || 0),
      publicPricePerPilgrimUsd: Number(row.public_price_per_pilgrim_usd || 0),
      publicTotalUsd: Number(row.public_total_usd || 0),
      roundingDifferenceUsd: Number(row.rounding_difference_usd || 0),
      estimatedProfitUsd: Number(row.estimated_profit_usd || 0)
    },
    updatedBy: row.updated_by || null,
    updatedAt: row.updated_at
  };
}

async function bookingPricingOverride(env, bookingID) {
  await ensureBookingPricingOverrideSchema(env);
  const row = await env.HOTELS_DB.prepare('SELECT * FROM booking_pricing_overrides WHERE booking_id=? LIMIT 1').bind(bookingID).first();
  return bookingPricingOverrideMap(row);
}

function reportWithPricingOverride(report, override) {
  if (!report || !override) return report;
  return {
    ...report,
    components: override.components,
    totals: override.totals,
    businessOverride: true
  };
}

async function bookingPricingOverrideDetail(request, env, bookingID) {
  const resolved = await rawBookingForDetail(request, env, bookingID);
  if (!resolved) return json({ ok: false, error: 'BOOKING_NOT_FOUND' }, 404);
  const pricingReport = await generatorPricingReportForBooking(env, bookingID, resolved.raw);
  if (!pricingReport) return json({ ok: false, error: 'GENERATOR_PRICING_NOT_FOUND' }, 409);
  const override = await bookingPricingOverride(env, bookingID);
  return json({ ok: true, pricing: override, basePricing: pricingReport });
}

function normalizedEditablePricingComponents(value, baseComponents) {
  const baseByCode = new Map((Array.isArray(baseComponents) ? baseComponents : []).map(item => [String(item?.code || ''), item]));
  if (!Array.isArray(value) || !value.length) return null;
  const output = [];
  const seen = new Set();
  for (const raw of value) {
    const code = cleanText(raw?.code, 80);
    if (!code || seen.has(code) || !baseByCode.has(code)) continue;
    const amount = Number(raw?.supplierCostUsd);
    if (!Number.isFinite(amount) || amount < 0 || amount > 1000000) return null;
    const base = baseByCode.get(code);
    output.push({ code, label: safeHumanText(base?.label || raw?.label || code, 180) || code, supplierCostUsd: Math.round(amount * 100) / 100 });
    seen.add(code);
  }
  // Every original component is required, so saving cannot silently drop a cost.
  if (output.length !== baseByCode.size) return null;
  return output;
}

async function syncPricingOverrideToSourceBooking(env, bookingID, override) {
  if (!env.BOOKINGS_DB) throw new Error('BOOKINGS_DB_NOT_CONFIGURED');
  const source = await sourceBookingPayload(env, bookingID);
  if (!source || !Object.keys(source).length) throw new Error('SOURCE_BOOKING_NOT_FOUND');
  source.totalUsd = override.totals.publicTotalUsd;
  source.perPilgrimUsd = override.totals.publicPricePerPilgrimUsd;
  source.businessPricingOverride = {
    currency: override.currency,
    components: override.components,
    markupRate: override.markupRate,
    paymentFeeRate: override.paymentFeeRate,
    totals: override.totals,
    updatedAt: override.updatedAt
  };
  const sourceColumns = await env.BOOKINGS_DB.prepare("PRAGMA table_info('bookings')").all().catch(() => ({ results: [] }));
  const sourceNames = new Set((sourceColumns.results || []).map(row => String(row?.name || '')));
  if (sourceNames.has('updated_at')) {
    await env.BOOKINGS_DB.prepare('UPDATE bookings SET payload_json=?, updated_at=? WHERE id=?').bind(JSON.stringify(source), override.updatedAt, bookingID).run();
  } else {
    await env.BOOKINGS_DB.prepare('UPDATE bookings SET payload_json=? WHERE id=?').bind(JSON.stringify(source), bookingID).run();
  }

  const trip = await env.HOTELS_DB.prepare('SELECT * FROM pilgrim_trips WHERE booking_id=? LIMIT 1').bind(bookingID).first().catch(() => null);
  if (trip) {
    const snapshot = parseJSONObject(trip.booking_snapshot_json);
    snapshot.totalUsd = override.totals.publicTotalUsd;
    snapshot.perPilgrimUsd = override.totals.publicPricePerPilgrimUsd;
    snapshot.businessPricingOverride = source.businessPricingOverride;
    const pricing = parseJSONObject(trip.pricing_snapshot_json);
    pricing.businessPricingOverride = source.businessPricingOverride;
    await env.HOTELS_DB.prepare('UPDATE pilgrim_trips SET booking_snapshot_json=?, pricing_snapshot_json=?, updated_at=? WHERE booking_id=?')
      .bind(JSON.stringify(snapshot), JSON.stringify(pricing), override.updatedAt, bookingID).run();
  }
}

async function saveBookingPricingOverride(request, env, bookingID, user) {
  const resolved = await rawBookingForDetail(request, env, bookingID);
  if (!resolved) return json({ ok: false, error: 'BOOKING_NOT_FOUND' }, 404);
  const report = await generatorPricingReportForBooking(env, bookingID, resolved.raw);
  if (!report) return json({ ok: false, error: 'GENERATOR_PRICING_NOT_FOUND' }, 409);
  const payload = await request.json().catch(() => null);
  if (!payload) return json({ ok: false, error: 'INVALID_JSON' }, 400);

  const components = normalizedEditablePricingComponents(payload.components, report.components);
  if (!components) return json({ ok: false, error: 'INVALID_PRICING_COMPONENTS' }, 400);
  // Percentages are part of the package pricing contract and are not operator-editable.
  // Business may edit every monetary component, but the server always reuses the
  // original snapshot rates even if an old/new client sends different values.
  const markupRate = Number(report?.totals?.markupRate);
  const paymentFeeRate = Number(report?.totals?.paymentFeeRate);
  if (!Number.isFinite(markupRate) || markupRate < 0 || markupRate > 5) return json({ ok: false, error: 'INVALID_MARKUP_RATE' }, 400);
  if (!Number.isFinite(paymentFeeRate) || paymentFeeRate < 0 || paymentFeeRate >= 0.5) return json({ ok: false, error: 'INVALID_PAYMENT_FEE_RATE' }, 400);

  const travelerCount = Math.max(1,
    Number(report?.context?.travelers?.adults || 0) +
    Number(report?.context?.travelers?.children || 0) +
    Number(report?.context?.travelers?.infants || 0)
  );
  const supplierCostUsd = components.reduce((sum, item) => sum + Number(item.supplierCostUsd || 0), 0);
  const markupAmountUsd = supplierCostUsd * markupRate;
  const subtotalAfterMarkupUsd = supplierCostUsd + markupAmountUsd;
  const calculatedSellingPriceUsd = subtotalAfterMarkupUsd / (1 - paymentFeeRate);
  const paymentFeeAmountUsd = calculatedSellingPriceUsd - subtotalAfterMarkupUsd;
  const publicPricePerPilgrimUsd = Math.max(5, Math.round((calculatedSellingPriceUsd / travelerCount) / 5) * 5);
  const publicTotalUsd = publicPricePerPilgrimUsd * travelerCount;
  const roundingDifferenceUsd = publicTotalUsd - calculatedSellingPriceUsd;
  const estimatedProfitUsd = publicTotalUsd - supplierCostUsd - paymentFeeAmountUsd;
  const now = new Date().toISOString();
  const updatedBy = cleanText(user?.login, 180) || null;

  await ensureBookingPricingOverrideSchema(env);
  await env.HOTELS_DB.prepare(`INSERT INTO booking_pricing_overrides (
    booking_id,currency,components_json,markup_rate,payment_fee_rate,supplier_cost_usd,markup_amount_usd,
    subtotal_after_markup_usd,payment_fee_amount_usd,calculated_selling_price_usd,public_price_per_pilgrim_usd,
    public_total_usd,rounding_difference_usd,estimated_profit_usd,traveler_count,updated_by,updated_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(booking_id) DO UPDATE SET
    currency=excluded.currency,components_json=excluded.components_json,markup_rate=excluded.markup_rate,
    payment_fee_rate=excluded.payment_fee_rate,supplier_cost_usd=excluded.supplier_cost_usd,
    markup_amount_usd=excluded.markup_amount_usd,subtotal_after_markup_usd=excluded.subtotal_after_markup_usd,
    payment_fee_amount_usd=excluded.payment_fee_amount_usd,calculated_selling_price_usd=excluded.calculated_selling_price_usd,
    public_price_per_pilgrim_usd=excluded.public_price_per_pilgrim_usd,public_total_usd=excluded.public_total_usd,
    rounding_difference_usd=excluded.rounding_difference_usd,estimated_profit_usd=excluded.estimated_profit_usd,
    traveler_count=excluded.traveler_count,updated_by=excluded.updated_by,updated_at=excluded.updated_at`)
    .bind(bookingID, report.currency || 'USD', JSON.stringify(components), markupRate, paymentFeeRate, supplierCostUsd, markupAmountUsd,
      subtotalAfterMarkupUsd, paymentFeeAmountUsd, calculatedSellingPriceUsd, publicPricePerPilgrimUsd, publicTotalUsd,
      roundingDifferenceUsd, estimatedProfitUsd, travelerCount, updatedBy, now).run();

  const override = await bookingPricingOverride(env, bookingID);
  await syncPricingOverrideToSourceBooking(env, bookingID, override);
  return json({ ok: true, pricing: override });
}

async function generatorPricingReport(env, raw) {
  const trace = raw?.generatorTrace && typeof raw.generatorTrace === 'object' ? raw.generatorTrace : {};
  const quoteID = cleanText(trace?.quoteId || raw?.quoteId, 180);
  if (!quoteID) return null;
  let row;
  try { row = await env.HOTELS_DB.prepare('SELECT audit_json FROM package_quote_audits WHERE quote_id=? LIMIT 1').bind(quoteID).first(); }
  catch { return null; }
  const audit = parseJSONObject(row?.audit_json);
  if (!audit || !Object.keys(audit).length) return null;
  return { ...audit, selection: trace };
}


async function generatorPricingReportForBooking(env, bookingID, raw) {
  const trip = await env.HOTELS_DB.prepare('SELECT booking_snapshot_json, pricing_snapshot_json FROM pilgrim_trips WHERE booking_id=? LIMIT 1')
    .bind(bookingID).first().catch(() => null);
  const snapshot = parseJSONObject(trip?.booking_snapshot_json);
  const persistedPricing = parseJSONObject(trip?.pricing_snapshot_json);
  const rawObject = raw && typeof raw === 'object' ? raw : {};
  const directPricing = persistedPricing && typeof persistedPricing === 'object' &&
    Array.isArray(persistedPricing?.components) && persistedPricing.components.length > 0 &&
    persistedPricing?.totals && typeof persistedPricing.totals === 'object' &&
    persistedPricing?.context && typeof persistedPricing.context === 'object' &&
    persistedPricing?.selectedPricingInputs && typeof persistedPricing.selectedPricingInputs === 'object'
      ? persistedPricing
      : null;
  const trace = rawObject?.generatorTrace && typeof rawObject.generatorTrace === 'object'
    ? rawObject.generatorTrace
    : snapshot?.generatorTrace && typeof snapshot.generatorTrace === 'object'
      ? snapshot.generatorTrace
      : {};

  // New pricing reports are written directly by PackageEngine after booking.
  // Never treat an embedded client pricingSnapshot as authoritative.
  if (directPricing) {
    return {
      ...directPricing,
      quoteId: cleanText(directPricing.quoteId, 180) || `booking-${bookingID}`,
      pricingVersion: cleanText(directPricing.pricingVersion, 120) || 'server-booking-pricing-v1',
      currency: cleanText(directPricing.currency, 12) || 'USD',
      selection: trace
    };
  }

  // Compatibility only for older deployments that stored a server quote audit by
  // quoteId. This source is also server-side; client-embedded costs are not used.
  return generatorPricingReport(env, { ...snapshot, ...rawObject });
}


function normalizeSecurityName(value) {
  return String(safeHumanText(value, 120) || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function normalizeSecurityPassport(value) {
  return String(cleanText(value, 32) || '')
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

async function securityIdentityFingerprint(_firstName, _lastName, passportNumber) {
  // Gift Card anti-fraud identity is anchored to the normalized passport number.
  // Names are still manually reviewed against the passport image, but spelling/case
  // differences must never allow the same passport to redeem a second first-trip Gift.
  const passport = normalizeSecurityPassport(passportNumber);
  return sha256Hex(`iumrah-passport-v1|${passport}`);
}

function validSecurityName(value) {
  const text = normalizeSecurityName(value);
  return text.length >= 2 && text.length <= 120 && /[\p{L}]/u.test(text);
}

async function securitySubmissionRow(env, bookingID) {
  return env.HOTELS_DB.prepare(
    `SELECT id,booking_id,pilgrim_id,first_name,last_name,passport_number,passport_last4,
            identity_fingerprint,passport_object_key,passport_content_type,status,
            submitted_at,reviewed_at,reviewed_by,review_note,created_at,updated_at
     FROM iumrah_security_submissions WHERE booking_id=? LIMIT 1`
  ).bind(bookingID).first().catch(() => null);
}

async function confirmedIdentityDuplicate(env, bookingID, fingerprint) {
  if (!fingerprint) return null;
  return env.HOTELS_DB.prepare(
    `SELECT booking_id FROM iumrah_identity_confirmations
     WHERE identity_fingerprint=? AND booking_id<>? AND status='confirmed'
     ORDER BY updated_at DESC LIMIT 1`
  ).bind(fingerprint, bookingID).first().catch(() => null);
}

function clientSecurityMap(row, duplicate) {
  if (!row) return null;
  return {
    bookingID: row.booking_id,
    status: row.status || 'draft',
    firstName: row.first_name || '',
    lastName: row.last_name || '',
    passportLast4: row.passport_last4 || '',
    verificationMethod: row.status === 'confirmed' ? 'business_manual_passport_review' : 'business_manual_review_pending',
    reusedIdentity: !!duplicate,
    hasPassportPhoto: !!row.passport_object_key,
    reviewNote: row.review_note || '',
    submittedAt: row.submitted_at || row.created_at || '',
    updatedAt: row.updated_at || row.created_at || ''
  };
}

function adminSecurityMap(row, duplicate) {
  if (!row) return null;
  return {
    bookingID: row.booking_id,
    pilgrimID: row.pilgrim_id == null ? null : pilgrimPublicID(row.pilgrim_id),
    status: row.status || 'draft',
    firstName: row.first_name || '',
    lastName: row.last_name || '',
    passportNumber: row.passport_number || '',
    passportLast4: row.passport_last4 || '',
    hasPassportPhoto: !!row.passport_object_key,
    passportMediaURL: row.passport_object_key
      ? `/api/admin/hotels/operations/bookings/${encodeURIComponent(row.booking_id)}/security/passport`
      : null,
    submittedAt: row.submitted_at || null,
    reviewedAt: row.reviewed_at || null,
    reviewedBy: row.reviewed_by || null,
    reviewNote: row.review_note || '',
    duplicateBookingID: duplicate?.booking_id || null
  };
}

async function clientSecuritySubmissionResponse(env, bookingID, auth) {
  const row = await securitySubmissionRow(env, bookingID);
  if (!row) return json({ ok: true, confirmation: null });
  const duplicate = row.identity_fingerprint
    ? await confirmedIdentityDuplicate(env, bookingID, row.identity_fingerprint)
    : null;
  return json({ ok: true, confirmation: clientSecurityMap(row, duplicate) });
}

async function uploadClientSecurityPassport(request, env, bookingID, auth) {
  if (normalizedTripStatus(auth?.trip?.status) !== 'payment_pending') {
    return json({ ok: false, error: 'IDENTITY_CONFIRMATION_NOT_AVAILABLE' }, 409);
  }
  const current = await securitySubmissionRow(env, bookingID);
  if (current?.status === 'confirmed') return json({ ok: false, error: 'IDENTITY_ALREADY_CONFIRMED' }, 409);

  const upload = await privateImageUpload(request, env, `security-passports/${bookingID}`);
  if (!upload.ok) return upload.response;
  const now = new Date().toISOString();
  const pilgrimID = Number(auth?.trip?.pilgrim_id || 0) || null;
  const id = current?.id || `security-${crypto.randomUUID()}`;

  try {
    await env.HOTELS_DB.prepare(
      `INSERT INTO iumrah_security_submissions(
         id,booking_id,pilgrim_id,passport_object_key,passport_content_type,status,created_at,updated_at
       ) VALUES(?,?,?,?,?,'draft',?,?)
       ON CONFLICT(booking_id) DO UPDATE SET
         pilgrim_id=excluded.pilgrim_id,
         passport_object_key=excluded.passport_object_key,
         passport_content_type=excluded.passport_content_type,
         status='draft',review_note='',reviewed_at=NULL,reviewed_by=NULL,updated_at=excluded.updated_at`
    ).bind(id, bookingID, pilgrimID, upload.key, upload.ct, current?.created_at || now, now).run();
    if (current?.passport_object_key && current.passport_object_key !== upload.key) {
      await env.HOTELS_MEDIA.delete(current.passport_object_key).catch(() => {});
    }
    return clientSecuritySubmissionResponse(env, bookingID, auth);
  } catch (error) {
    await env.HOTELS_MEDIA.delete(upload.key).catch(() => {});
    console.error('CLIENT_SECURITY_PASSPORT_UPLOAD_FAILED', bookingID, error);
    return json({ ok: false, error: 'IDENTITY_PASSPORT_UPLOAD_FAILED' }, 500);
  }
}

async function submitClientSecurityProfile(request, env, bookingID, auth) {
  if (normalizedTripStatus(auth?.trip?.status) !== 'payment_pending') {
    return json({ ok: false, error: 'IDENTITY_CONFIRMATION_NOT_AVAILABLE' }, 409);
  }
  const payload = await request.json().catch(() => null);
  const firstName = String(safeHumanText(payload?.firstName, 120) || '')
    .normalize('NFKC').replace(/\s+/g, ' ').trim();
  const lastName = String(safeHumanText(payload?.lastName, 120) || '')
    .normalize('NFKC').replace(/\s+/g, ' ').trim();
  const passportNumber = normalizeSecurityPassport(payload?.passportNumber);
  const holderConfirmed = payload?.holderConfirmed === true;
  if (!validSecurityName(firstName) || !validSecurityName(lastName)
      || passportNumber.length < 5 || passportNumber.length > 20 || !holderConfirmed) {
    return json({ ok: false, error: 'INVALID_IDENTITY_DETAILS' }, 400);
  }

  const current = await securitySubmissionRow(env, bookingID);
  if (!current?.passport_object_key) return json({ ok: false, error: 'IDENTITY_PASSPORT_PHOTO_REQUIRED' }, 409);
  if (current.status === 'confirmed') return json({ ok: false, error: 'IDENTITY_ALREADY_CONFIRMED' }, 409);

  const now = new Date().toISOString();
  const fingerprint = await securityIdentityFingerprint(firstName, lastName, passportNumber);
  const pilgrimID = Number(auth?.trip?.pilgrim_id || current.pilgrim_id || 0) || null;
  await env.HOTELS_DB.prepare(
    `UPDATE iumrah_security_submissions SET
       pilgrim_id=?,first_name=?,last_name=?,passport_number=?,passport_last4=?,identity_fingerprint=?,
       status='submitted',submitted_at=?,reviewed_at=NULL,reviewed_by=NULL,review_note='',updated_at=?
     WHERE booking_id=?`
  ).bind(pilgrimID, firstName, lastName, passportNumber, passportNumber.slice(-4), fingerprint, now, now, bookingID).run();

  await sendClientPush(
    env,
    bookingID,
    'iUmrah Security',
    'Данные получены. Проверка безопасности бронирования началась.',
    { type: 'security_confirmation', bookingID }
  ).catch(() => {});
  return clientSecuritySubmissionResponse(env, bookingID, auth);
}

async function adminSecuritySubmissionDetail(env, bookingID) {
  const row = await securitySubmissionRow(env, bookingID);
  if (!row) return null;
  const duplicate = row.identity_fingerprint
    ? await confirmedIdentityDuplicate(env, bookingID, row.identity_fingerprint)
    : null;
  return adminSecurityMap(row, duplicate);
}

async function adminSecuritySubmissionResponse(env, bookingID) {
  return json({ ok: true, security: await adminSecuritySubmissionDetail(env, bookingID) });
}

async function serveAdminSecurityPassport(env, bookingID) {
  const row = await securitySubmissionRow(env, bookingID);
  if (!row?.passport_object_key) return json({ ok: false, error: 'SECURITY_PASSPORT_NOT_FOUND' }, 404);
  const object = await env.HOTELS_MEDIA.get(row.passport_object_key);
  if (!object) return json({ ok: false, error: 'SECURITY_PASSPORT_NOT_FOUND' }, 404);
  return new Response(object.body, {
    headers: {
      'content-type': row.passport_content_type || 'image/jpeg',
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff'
    }
  });
}

async function reviewSecuritySubmission(request, env, bookingID, user) {
  const payload = await request.json().catch(() => null);
  const action = cleanText(payload?.action, 40).toLowerCase();
  const note = safeHumanText(payload?.note, 600) || '';
  if (!['approve','reject','needs_resubmission'].includes(action)) {
    return json({ ok: false, error: 'INVALID_SECURITY_REVIEW_ACTION' }, 400);
  }

  const row = await securitySubmissionRow(env, bookingID);
  if (!row) return json({ ok: false, error: 'SECURITY_SUBMISSION_NOT_FOUND' }, 404);
  if (!['submitted','under_review','rejected','needs_resubmission'].includes(String(row.status || ''))) {
    return json({ ok: false, error: 'SECURITY_SUBMISSION_NOT_REVIEWABLE' }, 409);
  }

  const now = new Date().toISOString();
  const reviewer = cleanText(user?.login || user?.email || user?.displayName, 180) || 'iumrah Business';

  if (action === 'approve') {
    if (!row.passport_object_key || !row.identity_fingerprint || !row.passport_number || !row.first_name || !row.last_name) {
      return json({ ok: false, error: 'SECURITY_SUBMISSION_INCOMPLETE' }, 409);
    }

    // The booking holder row is canonical travel data. It must exist before
    // an identity can be promoted from the manual-review queue to confirmed.
    const tripForSecurity = await env.HOTELS_DB.prepare(
      'SELECT * FROM pilgrim_trips WHERE booking_id=? LIMIT 1'
    ).bind(bookingID).first().catch(() => null);
    if (!tripForSecurity) return json({ ok: false, error: 'SECURITY_BOOKING_NOT_FOUND' }, 404);
    await ensureTravelerRows(env, bookingID, tripForSecurity);
    const holder = await env.HOTELS_DB.prepare(
      'SELECT id FROM booking_travelers WHERE booking_id=? AND position=1 LIMIT 1'
    ).bind(bookingID).first().catch(() => null);
    if (!holder) return json({ ok: false, error: 'SECURITY_BOOKING_HOLDER_MISSING' }, 409);

    const existingConfirmation = await env.HOTELS_DB.prepare(
      'SELECT id,created_at FROM iumrah_identity_confirmations WHERE booking_id=? LIMIT 1'
    ).bind(bookingID).first().catch(() => null);
    const confirmationID = existingConfirmation?.id || `identity-${crypto.randomUUID()}`;
    const createdAt = existingConfirmation?.created_at || now;

    // Promote all three pieces together: canonical booking-holder data,
    // confirmed anti-fraud identity, and review status. D1 batch keeps the
    // manual approval from leaving a half-confirmed KYC state.
    await env.HOTELS_DB.batch([
      env.HOTELS_DB.prepare(
        `UPDATE booking_travelers SET
           first_name=?,last_name=?,passport_number=?,
           passport_object_key=COALESCE(passport_object_key,?),
           passport_content_type=COALESCE(passport_content_type,?),updated_at=?
         WHERE booking_id=? AND position=1`
      ).bind(
        row.first_name, row.last_name, row.passport_number,
        row.passport_object_key, row.passport_content_type, now, bookingID
      ),
      env.HOTELS_DB.prepare(
        `INSERT INTO iumrah_identity_confirmations(
           id,booking_id,identity_fingerprint,first_name,last_name,passport_last4,status,
           verification_method,created_at,updated_at
         ) VALUES(?,?,?,?,?,?,'confirmed','business_manual_passport_review',?,?)
         ON CONFLICT(booking_id) DO UPDATE SET
           identity_fingerprint=excluded.identity_fingerprint,
           first_name=excluded.first_name,
           last_name=excluded.last_name,
           passport_last4=excluded.passport_last4,
           status='confirmed',verification_method='business_manual_passport_review',updated_at=excluded.updated_at`
      ).bind(
        confirmationID, bookingID, row.identity_fingerprint, row.first_name, row.last_name,
        row.passport_last4, createdAt, now
      ),
      env.HOTELS_DB.prepare(
        `UPDATE iumrah_security_submissions SET
           status='confirmed',passport_number='',reviewed_at=?,reviewed_by=?,review_note=?,updated_at=?
         WHERE booking_id=?`
      ).bind(now, reviewer, note, now, bookingID)
    ]);

    await sendClientPush(
      env,
      bookingID,
      'iUmrah Security',
      'Владелец бронирования подтверждён. Бронирование защищено.',
      { type: 'security_confirmation', bookingID, status: 'confirmed' }
    ).catch(() => {});
  } else {
    const nextStatus = action === 'reject' ? 'rejected' : 'needs_resubmission';
    await env.HOTELS_DB.prepare('DELETE FROM iumrah_identity_confirmations WHERE booking_id=?').bind(bookingID).run().catch(() => {});
    await env.HOTELS_DB.prepare(
      `UPDATE iumrah_security_submissions SET
         status=?,reviewed_at=?,reviewed_by=?,review_note=?,updated_at=?
       WHERE booking_id=?`
    ).bind(nextStatus, now, reviewer, note, now, bookingID).run();
    await sendClientPush(
      env,
      bookingID,
      'iUmrah Security',
      action === 'reject' ? 'Подтверждение безопасности не завершено.' : 'Для завершения iUmrah Security нужно уточнить данные.',
      { type: 'security_confirmation', bookingID, status: nextStatus }
    ).catch(() => {});
  }

  return json({ ok: true, security: await adminSecuritySubmissionDetail(env, bookingID) });
}

async function operationsBookingDetail(request, env, bookingID) {
  const deleted = await env.HOTELS_DB.prepare('SELECT booking_id FROM booking_tombstones WHERE booking_id=? LIMIT 1').bind(bookingID).first().catch(() => null);
  if (deleted) return json({ ok: false, error: 'BOOKING_DELETED' }, 404);
  const resolved = await rawBookingForDetail(request, env, bookingID);
  if (!resolved) return json({ ok: false, error: 'BOOKING_NOT_FOUND' }, 404);
  const trip = await ensureTripLifecycleTimers(env,bookingID);
  const pilgrim = trip ? await env.HOTELS_DB.prepare('SELECT * FROM pilgrims WHERE id=?').bind(trip.pilgrim_id).first() : null;
  const pricingSnapshot = trip ? parseJSONObject(trip.pricing_snapshot_json) : {};
  const pricingReportSource = trip ? { ...parseJSONObject(trip.booking_snapshot_json), ...resolved.raw } : resolved.raw;
  let pricingLines = flattenPricingLines(pricingSnapshot);
  // Client payloads are not a trusted source of supplier-cost lines.
  const [history, flightRows, assignment] = await Promise.all([
    env.HOTELS_DB.prepare('SELECT old_status, new_status, changed_by, created_at FROM booking_status_history WHERE booking_id=? ORDER BY created_at DESC LIMIT 50').bind(bookingID).all(),
    env.HOTELS_DB.prepare("SELECT * FROM trip_flights WHERE booking_id=? ORDER BY CASE direction WHEN 'outbound' THEN 0 ELSE 1 END").bind(bookingID).all(),
    bookingAssignmentDetail(env, bookingID)
  ]);
  return json({
    ok: true,
    booking: augmentBooking(resolved.raw, { trip, pilgrim }),
    operation: tripMap(trip),
    pilgrim: pilgrim ? { id: pilgrimPublicID(pilgrim.id), displayName: pilgrim.display_name || '', firstName: pilgrim.first_name || '', lastName: pilgrim.last_name || '', phone: pilgrim.phone || '', email: pilgrim.email || '', totalTrips: Number(pilgrim.total_trips || 0) } : null,
    pricingLines,
    pricingReport: reportWithPricingOverride(await generatorPricingReportForBooking(env, bookingID, pricingReportSource), await bookingPricingOverride(env, bookingID)),
    pricingOverride: await bookingPricingOverride(env, bookingID),
    requestFields: flattenRequestFields(resolved.raw),
    statusHistory: (history.results || []).map(row => ({ oldStatus: row.old_status || null, newStatus: row.new_status, changedBy: row.changed_by || null, createdAt: row.created_at })),
    flights: (flightRows.results || []).map(mapTripFlight),
    assignment,
    esims: await clientBookingEsimRows(env, bookingID, { syncIfStale: true }),
    checkout: await adminCheckoutDetail(env, bookingID, trip),
    security: await adminSecuritySubmissionDetail(env, bookingID)
  });
}


const ESIM_PROVIDER_ESIM_ACCESS = 'esim_access';
const ESIM_USAGE_SYNC_TTL_MS = 60 * 1000;

function normalizedEsimProvider(value) {
  const provider = String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  return provider || ESIM_PROVIDER_ESIM_ACCESS;
}

function esimNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function normalizeLpaString(value, smdpAddress = '', activationCode = '') {
  const direct = String(value || '').trim();
  if (direct) return direct;
  const smdp = String(smdpAddress || '').trim();
  const code = String(activationCode || '').trim();
  return smdp && code ? `LPA:1$${smdp}$${code}` : '';
}

function lpaParts(value) {
  const text = String(value || '').trim();
  if (!/^LPA:1\$/i.test(text)) return { smdpAddress: '', activationCode: '' };
  const parts = text.split('$');
  return { smdpAddress: parts[1] || '', activationCode: parts[2] || '' };
}

function mapBookingEsim(row) {
  if (!row) return null;
  const totalMB = esimNumber(row.total_mb);
  const usedMB = esimNumber(row.used_mb);
  const remainingMB = row.remaining_mb == null ? Math.max(0, totalMB - usedMB) : esimNumber(row.remaining_mb);
  return {
    id: row.id,
    bookingID: row.booking_id,
    travelerPosition: row.traveler_position == null ? null : Number(row.traveler_position),
    label: row.label || 'Saudi Arabia eSIM',
    provider: row.provider || ESIM_PROVIDER_ESIM_ACCESS,
    providerEsimID: row.provider_esim_id || null,
    iccid: row.iccid || '',
    planName: row.plan_name || '',
    countryCode: row.country_code || 'SA',
    totalMB,
    usedMB,
    remainingMB,
    validityDays: row.validity_days == null ? null : Number(row.validity_days),
    status: row.status || 'ready',
    providerStatus: row.provider_status || null,
    providerSmdpStatus: row.provider_smdp_status || null,
    smdpAddress: row.smdp_address || '',
    activationCode: row.activation_code || '',
    lpaString: row.lpa_string || '',
    qrCodeURL: row.qr_code_url || null,
    activatedAt: row.activated_at || null,
    expiresAt: row.expires_at || null,
    lastUsageSyncAt: row.last_usage_sync_at || null,
    usageSource: row.usage_source || 'pending',
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || ''
  };
}

async function bookingEsimRows(env, bookingID) {
  const rows = await env.HOTELS_DB.prepare('SELECT * FROM booking_esims WHERE booking_id=? ORDER BY COALESCE(traveler_position, 9999), created_at').bind(bookingID).all();
  return (rows.results || []).map(mapBookingEsim).filter(Boolean);
}

async function adminBookingEsims(env, bookingID) {
  return json({ ok: true, bookingID, esims: await clientBookingEsimRows(env, bookingID, { syncIfStale: true }) });
}

async function saveBookingEsim(request, env, bookingID, rawEsimID, user) {
  const trip = await env.HOTELS_DB.prepare('SELECT booking_id FROM pilgrim_trips WHERE booking_id=? LIMIT 1').bind(bookingID).first();
  if (!trip) return json({ ok: false, error: 'BOOKING_NOT_FOUND' }, 404);
  const payload = await request.json().catch(() => null);
  if (!payload) return json({ ok: false, error: 'INVALID_JSON' }, 400);

  const existingID = rawEsimID ? safeID(rawEsimID) : null;
  if (rawEsimID && !existingID) return json({ ok: false, error: 'INVALID_ESIM_ID' }, 400);
  if (existingID) {
    const existing = await env.HOTELS_DB.prepare('SELECT id FROM booking_esims WHERE id=? AND booking_id=? LIMIT 1').bind(existingID, bookingID).first();
    if (!existing) return json({ ok: false, error: 'ESIM_NOT_FOUND' }, 404);
  }

  const id = existingID || `esim-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const travelerPositionRaw = payload.travelerPosition == null || payload.travelerPosition === '' ? null : Number(payload.travelerPosition);
  const travelerPosition = Number.isInteger(travelerPositionRaw) && travelerPositionRaw > 0 ? travelerPositionRaw : null;
  const provider = normalizedEsimProvider(payload.provider);
  const iccid = cleanText(payload.iccid, 80) || '';
  if (provider === ESIM_PROVIDER_ESIM_ACCESS && !iccid) return json({ ok: false, error: 'ESIM_ICCID_REQUIRED' }, 400);
  const planName = safeHumanText(payload.planName, 180) || '';
  const label = safeHumanText(payload.label, 180) || planName || 'Saudi Arabia eSIM';
  const countryCode = (cleanText(payload.countryCode, 8) || 'SA').toUpperCase();
  const smdpAddress = cleanText(payload.smdpAddress, 500) || '';
  const activationCode = cleanText(payload.activationCode, 500) || '';
  const lpaString = normalizeLpaString(payload.lpaString, smdpAddress, activationCode);
  const parsed = lpaParts(lpaString);
  const finalSmdp = smdpAddress || parsed.smdpAddress;
  const finalActivationCode = activationCode || parsed.activationCode;
  const providerEsimID = cleanText(payload.providerEsimID, 120) || null;
  const qrCodeURL = cleanText(payload.qrCodeURL, 1500) || null;
  const updatedBy = cleanText(user?.login, 180) || null;

  if (existingID) {
    await env.HOTELS_DB.prepare(`UPDATE booking_esims SET traveler_position=?,label=?,provider=?,provider_esim_id=?,iccid=?,plan_name=?,country_code=?,smdp_address=?,activation_code=?,lpa_string=?,qr_code_url=?,updated_by=?,updated_at=? WHERE id=? AND booking_id=?`)
      .bind(travelerPosition,label,provider,providerEsimID,iccid,planName,countryCode,finalSmdp,finalActivationCode,lpaString,qrCodeURL,updatedBy,now,id,bookingID).run();
  } else {
    await env.HOTELS_DB.prepare(`INSERT INTO booking_esims(id,booking_id,traveler_position,label,provider,provider_esim_id,iccid,plan_name,country_code,total_mb,used_mb,remaining_mb,validity_days,status,smdp_address,activation_code,lpa_string,qr_code_url,usage_source,updated_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(id,bookingID,travelerPosition,label,provider,providerEsimID,iccid,planName,countryCode,0,0,0,null,'ready',finalSmdp,finalActivationCode,lpaString,qrCodeURL,'pending',updatedBy,now,now).run();
  }

  let row = await env.HOTELS_DB.prepare('SELECT * FROM booking_esims WHERE id=? AND booking_id=?').bind(id, bookingID).first();
  if (row && normalizedEsimProvider(row.provider) === ESIM_PROVIDER_ESIM_ACCESS && row.iccid && String(env.ESIM_ACCESS_CODE || '').trim()) {
    try { row = await syncEsimAccessRow(env, row); }
    catch (error) { console.warn('ESIM_AUTO_SYNC_AFTER_SAVE_FAILED', bookingID, id, String(error?.message || error)); }
  }
  return json({ ok: true, esim: mapBookingEsim(row) }, existingID ? 200 : 201);
}

async function deleteBookingEsim(env, bookingID, rawEsimID) {
  const esimID = safeID(rawEsimID);
  if (!esimID) return json({ ok: false, error: 'INVALID_ESIM_ID' }, 400);
  const result = await env.HOTELS_DB.prepare('DELETE FROM booking_esims WHERE id=? AND booking_id=?').bind(esimID, bookingID).run();
  if (!Number(result?.meta?.changes || 0)) return json({ ok: false, error: 'ESIM_NOT_FOUND' }, 404);
  return json({ ok: true, deletedEsimID: esimID });
}

function esimAccessProfileFromPayload(payload, iccid) {
  const candidateLists = [payload?.obj?.esimList, payload?.esimList, payload?.data?.esimList, payload?.obj?.list, payload?.data?.list];
  const list = candidateLists.find(Array.isArray) || [];
  return list.find(item => String(item?.iccid || '') === String(iccid || '')) || list[0] || null;
}

function bytesToMB(value) {
  const bytes = Number(value);
  return Number.isFinite(bytes) && bytes >= 0 ? bytes / (1024 * 1024) : 0;
}

async function syncEsimAccessRow(env, row) {
  const accessCode = String(env.ESIM_ACCESS_CODE || '').trim();
  if (!accessCode) throw new Error('ESIM_ACCESS_NOT_CONFIGURED');
  const iccid = String(row?.iccid || '').trim();
  if (!iccid) throw new Error('ESIM_ICCID_REQUIRED');

  const body = JSON.stringify({ iccid, pager: { pageNum: 1, pageSize: 20 } });
  const response = await fetch('https://api.esimaccess.com/api/v1/open/esim/list', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'RT-AccessCode': accessCode },
    body
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload) throw new Error(`ESIM_ACCESS_HTTP_${response.status}`);
  const profile = esimAccessProfileFromPayload(payload, iccid);
  if (!profile) throw new Error('ESIM_ACCESS_PROFILE_NOT_FOUND');

  const totalMB = bytesToMB(profile.totalVolume);
  const usedMB = bytesToMB(profile.orderUsage);
  const remainingMB = Math.max(0, totalMB - usedMB);
  const lpaString = String(profile.ac || row.lpa_string || '').trim();
  const parsed = lpaParts(lpaString);
  const now = new Date().toISOString();
  const validityDays = Number.isFinite(Number(profile.totalDuration)) ? Math.max(0, Math.floor(Number(profile.totalDuration))) : row.validity_days;
  await env.HOTELS_DB.prepare(`UPDATE booking_esims SET provider_esim_id=COALESCE(?,provider_esim_id),total_mb=?,used_mb=?,remaining_mb=?,validity_days=?,status=?,provider_status=?,provider_smdp_status=?,smdp_address=CASE WHEN smdp_address='' THEN ? ELSE smdp_address END,activation_code=CASE WHEN activation_code='' THEN ? ELSE activation_code END,lpa_string=CASE WHEN lpa_string='' THEN ? ELSE lpa_string END,qr_code_url=COALESCE(?,qr_code_url),expires_at=COALESCE(?,expires_at),last_usage_sync_at=?,usage_source='provider',updated_at=? WHERE id=? AND booking_id=?`)
    .bind(
      cleanText(profile.esimTranNo, 120) || null,
      totalMB, usedMB, remainingMB, validityDays,
      cleanText(profile.esimStatus, 60) || row.status || 'ready',
      cleanText(profile.esimStatus, 60) || null,
      cleanText(profile.smdpStatus, 60) || null,
      parsed.smdpAddress,
      parsed.activationCode,
      lpaString,
      cleanText(profile.qrCodeUrl, 1500) || null,
      cleanText(profile.expiredTime, 80) || null,
      now, now, row.id, row.booking_id
    ).run();
  return env.HOTELS_DB.prepare('SELECT * FROM booking_esims WHERE id=? AND booking_id=?').bind(row.id, row.booking_id).first();
}

async function syncBookingEsim(request, env, bookingID, rawEsimID) {
  const esimID = safeID(rawEsimID);
  if (!esimID) return json({ ok: false, error: 'INVALID_ESIM_ID' }, 400);
  let row = await env.HOTELS_DB.prepare('SELECT * FROM booking_esims WHERE id=? AND booking_id=? LIMIT 1').bind(esimID, bookingID).first();
  if (!row) return json({ ok: false, error: 'ESIM_NOT_FOUND' }, 404);
  if (normalizedEsimProvider(row.provider) !== ESIM_PROVIDER_ESIM_ACCESS) return json({ ok: false, error: 'ESIM_PROVIDER_SYNC_UNSUPPORTED' }, 409);
  try {
    row = await syncEsimAccessRow(env, row);
    return json({ ok: true, esim: mapBookingEsim(row) });
  } catch (error) {
    console.error('ESIM_USAGE_SYNC_FAILED', bookingID, esimID, error);
    const code = String(error?.message || 'ESIM_USAGE_SYNC_FAILED');
    return json({ ok: false, error: code }, code === 'ESIM_ACCESS_NOT_CONFIGURED' ? 503 : 502);
  }
}

function esimSyncIsStale(row) {
  if (!row?.last_usage_sync_at) return true;
  const when = Date.parse(row.last_usage_sync_at);
  return !Number.isFinite(when) || Date.now() - when >= ESIM_USAGE_SYNC_TTL_MS;
}

async function clientBookingEsimRows(env, bookingID, options = {}) {
  let rows = (await env.HOTELS_DB.prepare('SELECT * FROM booking_esims WHERE booking_id=? ORDER BY COALESCE(traveler_position, 9999), created_at').bind(bookingID).all()).results || [];
  if (options.syncIfStale && String(env.ESIM_ACCESS_CODE || '').trim()) {
    const refreshed = [];
    for (const row of rows) {
      if (normalizedEsimProvider(row.provider) === ESIM_PROVIDER_ESIM_ACCESS && row.iccid && esimSyncIsStale(row)) {
        try { refreshed.push(await syncEsimAccessRow(env, row)); }
        catch (error) { console.warn('ESIM_BACKGROUND_SYNC_SKIPPED', bookingID, row.id, String(error?.message || error)); refreshed.push(row); }
      } else refreshed.push(row);
    }
    rows = refreshed;
  }
  return rows.map(mapBookingEsim).filter(Boolean);
}

async function clientBookingEsims(env, bookingID) {
  return json({ ok: true, bookingID, esims: await clientBookingEsimRows(env, bookingID, { syncIfStale: true }) });
}


async function esimAccessPost(env, endpoint, body = {}) {
  const accessCode = String(env.ESIM_ACCESS_CODE || '').trim();
  if (!accessCode) throw new Error('ESIM_ACCESS_NOT_CONFIGURED');

  const secretKey = String(env.ESIM_ACCESS_SECRET || '').trim();
  const requestBody = JSON.stringify(body || {});
  const headers = {
    'content-type': 'application/json',
    'RT-AccessCode': accessCode
  };

  // eSIM Access supports the simplified RT-AccessCode-only mode. When the
  // account's SecretKey is configured as a Cloudflare secret, use the stronger
  // signed form recommended for write operations without ever exposing either
  // credential to the iOS application.
  if (secretKey) {
    const timestamp = Date.now().toString();
    const requestID = crypto.randomUUID();
    const signData = timestamp + requestID + accessCode + requestBody;
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secretKey),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(signData));
    const signature = [...new Uint8Array(signatureBuffer)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    headers['RT-Timestamp'] = timestamp;
    headers['RT-RequestID'] = requestID;
    headers['RT-Signature'] = signature;
  }

  const response = await fetch(`https://api.esimaccess.com/api/v1/open${endpoint}`, {
    method: 'POST',
    headers,
    body: requestBody
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload) {
    const error = new Error(`ESIM_ACCESS_HTTP_${response.status}`);
    error.httpStatus = response.status;
    throw error;
  }
  if (payload.success === false) {
    const code = String(payload.errorCode || '').trim();
    if (code === '200007') throw new Error('ESIM_ACCESS_BALANCE_INSUFFICIENT');
    if (code === '401001') throw new Error('ESIM_ACCESS_AUTH_FAILED');
    const error = new Error(code ? `ESIM_ACCESS_PROVIDER_${code}` : 'ESIM_ACCESS_PROVIDER_ERROR');
    error.providerMessage = cleanText(payload.errorMsg, 360) || '';
    throw error;
  }
  return payload;
}

function esimAccessBalanceValue(payload) {
  const raw = Number(payload?.obj?.balance ?? payload?.balance ?? 0);
  return Number.isFinite(raw) && raw >= 0 ? raw : 0;
}

function esimAccessNetworkNames(raw) {
  const roots = Array.isArray(raw?.locationNetworkList) ? raw.locationNetworkList : [];
  const values = [];
  for (const item of roots) {
    const direct = [item?.networkName, item?.operatorName, item?.name].filter(Boolean);
    values.push(...direct);
    const nested = Array.isArray(item?.networkList) ? item.networkList : [];
    for (const network of nested) values.push(network?.networkName || network?.operatorName || network?.name || '');
  }
  return [...new Set(values.map(value => safeHumanText(value, 100)).filter(Boolean))].slice(0, 8);
}

function mapEsimAccessPackage(raw) {
  if (!raw) return null;
  const packageCode = cleanText(raw.packageCode, 160);
  if (!packageCode) return null;
  const priceRaw = esimNumber(raw.price);
  const retailPriceRaw = raw.retailPrice == null ? null : esimNumber(raw.retailPrice);
  const locationRaw = raw.locationCode || raw.location || '';
  const locationCode = Array.isArray(locationRaw) ? cleanText(locationRaw[0], 12) || '' : cleanText(locationRaw, 12) || '';
  return {
    packageCode,
    slug: cleanText(raw.slug, 180) || '',
    name: safeHumanText(raw.name || raw.packageName || packageCode, 240) || packageCode,
    priceRaw,
    priceUSD: priceRaw / 10000,
    retailPriceRaw,
    retailPriceUSD: retailPriceRaw == null ? null : retailPriceRaw / 10000,
    currencyCode: cleanText(raw.currencyCode, 12) || 'USD',
    volumeBytes: esimNumber(raw.volume),
    duration: Math.max(0, Math.trunc(esimNumber(raw.duration))),
    durationUnit: cleanText(raw.durationUnit, 30) || 'DAY',
    locationCode: locationCode.toUpperCase(),
    speed: safeHumanText(raw.speed || '', 80) || '',
    supportsTopUp: Number(raw.supportTopUpType || 0) >= 2,
    activeType: raw.activeType == null ? null : Number(raw.activeType),
    networkNames: esimAccessNetworkNames(raw)
  };
}

async function esimAccessPackages(env, countryCode = '', packageCode = '') {
  const payload = await esimAccessPost(env, '/package/list', {
    locationCode: String(countryCode || '').toUpperCase(),
    type: '',
    slug: '',
    packageCode: packageCode || '',
    iccid: ''
  });
  const rows = Array.isArray(payload?.obj?.packageList) ? payload.obj.packageList : [];
  return rows
    .filter(raw => Number(raw?.dataType || 0) !== 2)
    .map(mapEsimAccessPackage)
    .filter(Boolean);
}

async function esimAccessBalance(env) {
  const payload = await esimAccessPost(env, '/balance/query', {});
  const rawAmount = esimAccessBalanceValue(payload);
  return { rawAmount, amountUSD: rawAmount / 10000, currencyCode: 'USD' };
}

async function adminEsimAccessBalance(env) {
  try { return json({ ok: true, balance: await esimAccessBalance(env) }); }
  catch (error) { return esimAccessErrorResponse(error); }
}

async function adminEsimAccessPackages(env, url) {
  const countryCode = (cleanText(url.searchParams.get('country'), 8) || 'SA').toUpperCase();
  try {
    const packages = await esimAccessPackages(env, countryCode, '');
    return json({ ok: true, countryCode, packages });
  } catch (error) { return esimAccessErrorResponse(error); }
}

function esimAccessErrorResponse(error) {
  const code = String(error?.message || 'ESIM_ACCESS_FAILED');
  let status = 502;
  if (code === 'ESIM_ACCESS_NOT_CONFIGURED') status = 503;
  else if (code === 'ESIM_ACCESS_BALANCE_INSUFFICIENT') status = 409;
  else if (code === 'ESIM_ACCESS_PACKAGE_NOT_FOUND') status = 404;
  else if (code === 'ESIM_ACCESS_PRICE_CHANGED') status = 409;
  else if (code === 'ESIM_ACCESS_PROFILE_NOT_READY') status = 409;
  else if (code === 'ESIM_ACCESS_PROFILE_ALREADY_ASSIGNED') status = 409;
  else if (code === 'ESIM_ACCESS_PURCHASE_REQUIRES_REVIEW') status = 409;
  return json({ ok: false, error: code }, status);
}

function mapEsimAccessInventory(row) {
  if (!row) return null;
  const total = esimNumber(row.total_volume_bytes || row.volume_bytes);
  const used = esimNumber(row.used_volume_bytes);
  return {
    id: row.id,
    clientRequestID: row.client_request_id || '',
    transactionID: row.transaction_id || '',
    orderNo: row.order_no || null,
    esimTranNo: row.esim_tran_no || null,
    packageCode: row.package_code || '',
    packageName: row.package_name || row.package_code || '',
    countryCode: row.country_code || '',
    priceUSD: esimNumber(row.price_raw) / 10000,
    currencyCode: row.currency_code || 'USD',
    volumeBytes: esimNumber(row.volume_bytes),
    duration: row.duration == null ? null : Number(row.duration),
    durationUnit: row.duration_unit || null,
    iccid: row.iccid || null,
    lpaString: row.lpa_string || null,
    smdpAddress: row.smdp_address || null,
    activationCode: row.activation_code || null,
    qrCodeURL: row.qr_code_url || null,
    shortURL: row.short_url || null,
    smdpStatus: row.smdp_status || null,
    esimStatus: row.esim_status || null,
    totalVolumeBytes: total,
    usedVolumeBytes: used,
    remainingVolumeBytes: Math.max(0, total - used),
    expiresAt: row.expires_at || null,
    purchaseStatus: row.purchase_status || 'pending',
    assignedBookingID: row.assigned_booking_id || null,
    assignedBookingEsimID: row.assigned_booking_esim_id || null,
    assignedTravelerPosition: row.assigned_traveler_position == null ? null : Number(row.assigned_traveler_position),
    createdBy: row.created_by || null,
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || ''
  };
}

async function adminEsimAccessInventory(env) {
  const rows = await env.HOTELS_DB.prepare('SELECT * FROM esim_access_inventory ORDER BY created_at DESC LIMIT 500').all();
  return json({ ok: true, profiles: (rows.results || []).map(mapEsimAccessInventory).filter(Boolean) });
}

function esimAccessListFromPayload(payload) {
  const candidates = [payload?.obj?.esimList, payload?.esimList, payload?.data?.esimList, payload?.obj?.list, payload?.data?.list];
  return candidates.find(Array.isArray) || [];
}

async function esimAccessQueryProfile(env, { orderNo = '', iccid = '' } = {}) {
  const body = { orderNo: orderNo || '', iccid: iccid || '', pager: { pageNum: 1, pageSize: 20 } };
  let payload;
  try {
    payload = await esimAccessPost(env, '/esim/query', body);
  } catch (error) {
    if (!String(error?.message || '').startsWith('ESIM_ACCESS_HTTP_')) throw error;
    payload = await esimAccessPost(env, '/esim/list', body);
  }
  const list = esimAccessListFromPayload(payload);
  if (iccid) return list.find(item => String(item?.iccid || '') === String(iccid)) || list[0] || null;
  if (orderNo) return list.find(item => String(item?.orderNo || '') === String(orderNo)) || list[0] || null;
  return list[0] || null;
}

async function updateEsimAccessInventoryFromProfile(env, inventoryID, profile) {
  if (!profile) return env.HOTELS_DB.prepare('SELECT * FROM esim_access_inventory WHERE id=?').bind(inventoryID).first();
  const packageInfo = Array.isArray(profile.packageList) ? profile.packageList[0] || {} : {};
  const lpaString = cleanText(profile.ac, 1000) || '';
  const parsed = lpaParts(lpaString);
  const now = new Date().toISOString();
  await env.HOTELS_DB.prepare(`UPDATE esim_access_inventory SET
      esim_tran_no=COALESCE(?,esim_tran_no), package_name=CASE WHEN ?<>'' THEN ? ELSE package_name END,
      country_code=CASE WHEN ?<>'' THEN ? ELSE country_code END, volume_bytes=CASE WHEN ?>0 THEN ? ELSE volume_bytes END,
      duration=COALESCE(?,duration), duration_unit=COALESCE(?,duration_unit), iccid=COALESCE(?,iccid),
      lpa_string=CASE WHEN ?<>'' THEN ? ELSE lpa_string END, smdp_address=CASE WHEN ?<>'' THEN ? ELSE smdp_address END,
      activation_code=CASE WHEN ?<>'' THEN ? ELSE activation_code END, qr_code_url=COALESCE(?,qr_code_url), short_url=COALESCE(?,short_url),
      smdp_status=COALESCE(?,smdp_status), esim_status=COALESCE(?,esim_status), total_volume_bytes=?, used_volume_bytes=?,
      expires_at=COALESCE(?,expires_at), purchase_status='ready', provider_payload_json=?, updated_at=? WHERE id=?`)
    .bind(
      cleanText(profile.esimTranNo, 120) || null,
      safeHumanText(packageInfo.packageName || '', 240) || '', safeHumanText(packageInfo.packageName || '', 240) || '',
      cleanText(packageInfo.locationCode, 12) || '', (cleanText(packageInfo.locationCode, 12) || '').toUpperCase(),
      esimNumber(packageInfo.volume || profile.totalVolume), esimNumber(packageInfo.volume || profile.totalVolume),
      profile.totalDuration == null ? null : Math.max(0, Math.trunc(Number(profile.totalDuration))),
      cleanText(profile.durationUnit || packageInfo.durationUnit, 30) || null,
      cleanText(profile.iccid, 80) || null,
      lpaString, lpaString,
      parsed.smdpAddress, parsed.smdpAddress,
      parsed.activationCode, parsed.activationCode,
      cleanText(profile.qrCodeUrl, 1500) || null,
      cleanText(profile.shortUrl, 1500) || null,
      cleanText(profile.smdpStatus, 80) || null,
      cleanText(profile.esimStatus, 80) || null,
      esimNumber(profile.totalVolume || packageInfo.volume),
      esimNumber(profile.orderUsage),
      cleanText(profile.expiredTime, 100) || null,
      JSON.stringify(profile).slice(0, 50000), now, inventoryID
    ).run();
  return env.HOTELS_DB.prepare('SELECT * FROM esim_access_inventory WHERE id=?').bind(inventoryID).first();
}

async function purchaseEsimAccessProfile(request, env, user) {
  const payload = await request.json().catch(() => null);
  if (!payload) return json({ ok: false, error: 'INVALID_JSON' }, 400);
  const packageCode = cleanText(payload.packageCode, 160);
  const clientRequestID = safeID(payload.clientRequestID);
  const expectedPriceRaw = Number(payload.expectedPriceRaw);
  if (!packageCode || !clientRequestID || !Number.isFinite(expectedPriceRaw) || expectedPriceRaw < 0) {
    return json({ ok: false, error: 'INVALID_ESIM_PURCHASE_REQUEST' }, 400);
  }

  const duplicate = await env.HOTELS_DB.prepare('SELECT * FROM esim_access_inventory WHERE client_request_id=? LIMIT 1').bind(clientRequestID).first();
  if (duplicate) {
    let row = duplicate;
    if (!row.iccid && row.order_no) {
      try {
        const profile = await esimAccessQueryProfile(env, { orderNo: row.order_no });
        if (profile) row = await updateEsimAccessInventoryFromProfile(env, row.id, profile);
      } catch (_) {}
    }
    if (!row.order_no && ['failed', 'pending'].includes(String(row.purchase_status || '').toLowerCase())) {
      return json({ ok: false, error: 'ESIM_ACCESS_PURCHASE_REQUIRES_REVIEW', transactionID: row.transaction_id }, 409);
    }
    const balance = await esimAccessBalance(env).catch(() => null);
    return json({ ok: true, profile: mapEsimAccessInventory(row), balance });
  }

  try {
    const plans = await esimAccessPackages(env, '', packageCode);
    const plan = plans.find(item => item.packageCode === packageCode) || plans[0];
    if (!plan) throw new Error('ESIM_ACCESS_PACKAGE_NOT_FOUND');
    if (Math.abs(plan.priceRaw - expectedPriceRaw) > 0.01) throw new Error('ESIM_ACCESS_PRICE_CHANGED');
    const balance = await esimAccessBalance(env);
    if (balance.rawAmount + 0.0001 < plan.priceRaw) throw new Error('ESIM_ACCESS_BALANCE_INSUFFICIENT');

    const inventoryID = `esimp-${crypto.randomUUID()}`;
    const transactionID = `iumrah_${Date.now()}_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    await env.HOTELS_DB.prepare(`INSERT INTO esim_access_inventory
      (id,client_request_id,transaction_id,package_code,package_name,country_code,price_raw,currency_code,volume_bytes,duration,duration_unit,purchase_status,created_by,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(inventoryID, clientRequestID, transactionID, plan.packageCode, plan.name, plan.locationCode, plan.priceRaw, plan.currencyCode, plan.volumeBytes, plan.duration, plan.durationUnit, 'pending', cleanText(user?.login, 180) || null, now, now).run();

    let orderPayload;
    try {
      orderPayload = await esimAccessPost(env, '/esim/order', {
        transactionId: transactionID,
        amount: plan.priceRaw,
        packageInfoList: [{ packageCode: plan.packageCode, count: 1, price: plan.priceRaw }]
      });
    } catch (error) {
      await env.HOTELS_DB.prepare("UPDATE esim_access_inventory SET purchase_status='failed', updated_at=? WHERE id=?").bind(new Date().toISOString(), inventoryID).run().catch(() => {});
      throw error;
    }

    const orderNo = cleanText(orderPayload?.obj?.orderNo || orderPayload?.orderNo, 160);
    if (!orderNo) {
      await env.HOTELS_DB.prepare("UPDATE esim_access_inventory SET purchase_status='failed', provider_payload_json=?, updated_at=? WHERE id=?")
        .bind(JSON.stringify(orderPayload).slice(0, 50000), new Date().toISOString(), inventoryID).run();
      throw new Error('ESIM_ACCESS_ORDER_NUMBER_MISSING');
    }
    await env.HOTELS_DB.prepare("UPDATE esim_access_inventory SET order_no=?, purchase_status='provisioning', provider_payload_json=?, updated_at=? WHERE id=?")
      .bind(orderNo, JSON.stringify(orderPayload).slice(0, 50000), new Date().toISOString(), inventoryID).run();

    let row = await env.HOTELS_DB.prepare('SELECT * FROM esim_access_inventory WHERE id=?').bind(inventoryID).first();
    for (let attempt = 0; attempt < 5 && !row.iccid; attempt += 1) {
      if (attempt > 0) await new Promise(resolve => setTimeout(resolve, 1100));
      const profile = await esimAccessQueryProfile(env, { orderNo }).catch(() => null);
      if (profile) row = await updateEsimAccessInventoryFromProfile(env, inventoryID, profile);
    }
    const afterBalance = await esimAccessBalance(env).catch(() => null);
    return json({ ok: true, profile: mapEsimAccessInventory(row), balance: afterBalance }, 201);
  } catch (error) {
    console.error('ESIM_ACCESS_PURCHASE_FAILED', error);
    return esimAccessErrorResponse(error);
  }
}

async function refreshEsimAccessInventory(env, rawID) {
  const id = safeID(rawID);
  if (!id) return json({ ok: false, error: 'INVALID_ESIM_INVENTORY_ID' }, 400);
  let row = await env.HOTELS_DB.prepare('SELECT * FROM esim_access_inventory WHERE id=? LIMIT 1').bind(id).first();
  if (!row) return json({ ok: false, error: 'ESIM_ACCESS_PROFILE_NOT_FOUND' }, 404);
  try {
    const profile = await esimAccessQueryProfile(env, { orderNo: row.order_no || '', iccid: row.iccid || '' });
    if (!profile) return json({ ok: true, profile: mapEsimAccessInventory(row), balance: null });
    row = await updateEsimAccessInventoryFromProfile(env, id, profile);
    return json({ ok: true, profile: mapEsimAccessInventory(row), balance: null });
  } catch (error) { return esimAccessErrorResponse(error); }
}

async function assignEsimAccessInventory(request, env, rawID, user) {
  const id = safeID(rawID);
  if (!id) return json({ ok: false, error: 'INVALID_ESIM_INVENTORY_ID' }, 400);
  let row = await env.HOTELS_DB.prepare('SELECT * FROM esim_access_inventory WHERE id=? LIMIT 1').bind(id).first();
  if (!row) return json({ ok: false, error: 'ESIM_ACCESS_PROFILE_NOT_FOUND' }, 404);
  if (!row.iccid) return json({ ok: false, error: 'ESIM_ACCESS_PROFILE_NOT_READY' }, 409);

  const payload = await request.json().catch(() => null);
  if (!payload) return json({ ok: false, error: 'INVALID_JSON' }, 400);
  const bookingID = cleanText(payload.bookingID, 180);
  if (!bookingID) return json({ ok: false, error: 'INVALID_BOOKING_ID' }, 400);
  let travelerPosition = payload.travelerPosition == null ? 1 : Math.trunc(Number(payload.travelerPosition));
  if (!Number.isFinite(travelerPosition) || travelerPosition < 1) travelerPosition = 1;

  if (row.assigned_booking_id) {
    if (String(row.assigned_booking_id) !== bookingID) return json({ ok: false, error: 'ESIM_ACCESS_PROFILE_ALREADY_ASSIGNED' }, 409);
    const existing = row.assigned_booking_esim_id ? await env.HOTELS_DB.prepare('SELECT * FROM booking_esims WHERE id=? AND booking_id=? LIMIT 1').bind(row.assigned_booking_esim_id, bookingID).first() : null;
    if (existing) return json({ ok: true, profile: mapEsimAccessInventory(row), esim: mapBookingEsim(existing) });
  }

  const trip = await env.HOTELS_DB.prepare('SELECT * FROM pilgrim_trips WHERE booking_id=? LIMIT 1').bind(bookingID).first();
  if (!trip) return json({ ok: false, error: 'BOOKING_NOT_FOUND' }, 404);
  await ensureTravelerRows(env, bookingID, trip);
  const travelerCountRow = await env.HOTELS_DB.prepare('SELECT COUNT(*) AS count FROM booking_travelers WHERE booking_id=?').bind(bookingID).first();
  const travelerCount = Math.max(1, Number(travelerCountRow?.count || 1));
  if (travelerPosition > travelerCount) return json({ ok: false, error: 'INVALID_TRAVELER_POSITION' }, 400);

  const bookingEsimID = `esim-${crypto.randomUUID()}`;
  const totalMB = bytesToMB(row.total_volume_bytes || row.volume_bytes);
  const usedMB = bytesToMB(row.used_volume_bytes);
  const remainingMB = Math.max(0, totalMB - usedMB);
  const now = new Date().toISOString();
  await env.HOTELS_DB.batch([
    env.HOTELS_DB.prepare(`INSERT INTO booking_esims
      (id,booking_id,traveler_position,label,provider,provider_esim_id,iccid,plan_name,country_code,total_mb,used_mb,remaining_mb,validity_days,status,provider_status,provider_smdp_status,smdp_address,activation_code,lpa_string,qr_code_url,expires_at,last_usage_sync_at,usage_source,updated_by,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(
        bookingEsimID, bookingID, travelerPosition, row.package_name || 'eSIM', ESIM_PROVIDER_ESIM_ACCESS, row.esim_tran_no || null,
        row.iccid, row.package_name || '', row.country_code || 'SA', totalMB, usedMB, remainingMB, row.duration == null ? null : Number(row.duration),
        row.esim_status || 'ready', row.esim_status || null, row.smdp_status || null, row.smdp_address || '', row.activation_code || '', row.lpa_string || '',
        row.qr_code_url || null, row.expires_at || null, now, 'provider', cleanText(user?.login, 180) || null, now, now
      ),
    env.HOTELS_DB.prepare(`UPDATE esim_access_inventory SET assigned_booking_id=?, assigned_booking_esim_id=?, assigned_traveler_position=?, updated_at=? WHERE id=?`)
      .bind(bookingID, bookingEsimID, travelerPosition, now, id)
  ]);
  row = await env.HOTELS_DB.prepare('SELECT * FROM esim_access_inventory WHERE id=?').bind(id).first();
  const bookingEsim = await env.HOTELS_DB.prepare('SELECT * FROM booking_esims WHERE id=?').bind(bookingEsimID).first();
  return json({ ok: true, profile: mapEsimAccessInventory(row), esim: mapBookingEsim(bookingEsim) });
}


async function adminCheckoutDetail(env, bookingID, trip) {
  if (!trip) return null;
  await ensureTravelerRows(env, bookingID, trip);
  const [travelers, payment, receipts, documents, account] = await Promise.all([
    env.HOTELS_DB.prepare('SELECT * FROM booking_travelers WHERE booking_id=? ORDER BY position').bind(bookingID).all(),
    env.HOTELS_DB.prepare('SELECT * FROM booking_payment_instructions WHERE booking_id=?').bind(bookingID).first(),
    env.HOTELS_DB.prepare('SELECT id,payment_method,note,review_status,created_at,content_type FROM booking_payment_receipts WHERE booking_id=? ORDER BY created_at DESC').bind(bookingID).all(),
    env.HOTELS_DB.prepare('SELECT id,document_kind,title,booking_reference,content_type,created_at FROM booking_travel_documents WHERE booking_id=? ORDER BY created_at').bind(bookingID).all(),
    env.HOTELS_DB.prepare('SELECT activated_at,last_login_at FROM iumrah_accounts WHERE pilgrim_id=?').bind(trip.pilgrim_id).first()
  ]);
  const travelerItems = (travelers.results || []).map(row => ({
    ...travelerMap(row),
    passportMediaURL: row.passport_object_key ? `/api/admin/hotels/operations/bookings/${encodeURIComponent(bookingID)}/travelers/${Number(row.position)}/passport` : null
  }));
  return {
    iumrahID: pilgrimPublicID(trip.pilgrim_id),
    accountActive: !!account,
    activatedAt: account?.activated_at || null,
    allTravelersComplete: travelerItems.length > 0 && travelerItems.every(item => item.completed),
    travelers: travelerItems,
    payment: {
      visaCardNumber: payment?.visa_card_number || '',
      visaHolder: payment?.visa_holder || '',
      hasPaymeQR: !!payment?.payme_qr_object_key,
      humoCardNumber: payment?.humo_card_number || '',
      humoHolder: payment?.humo_holder || '',
      instructions: payment?.instructions || ''
    },
    receipts: (receipts.results || []).map(r => ({
      id: r.id,
      paymentMethod: r.payment_method || 'other',
      note: r.note || '',
      reviewStatus: r.review_status || 'submitted',
      createdAt: r.created_at || '',
      contentType: r.content_type || null,
      mediaURL: `/api/admin/hotels/operations/bookings/${encodeURIComponent(bookingID)}/receipt/media?id=${encodeURIComponent(r.id)}`
    })),
    documents: (documents.results || []).map(d => ({
      id: d.id,
      documentKind: d.document_kind || 'other',
      title: d.title || 'Документ поездки',
      bookingReference: d.booking_reference || null,
      contentType: d.content_type || 'application/octet-stream',
      createdAt: d.created_at || '',
      mediaURL: `/api/admin/hotels/operations/bookings/${encodeURIComponent(bookingID)}/documents/${encodeURIComponent(d.id)}`
    }))
  };
}

async function saveBookingPaymentInstructions(request, env, bookingID, user) {
  const trip=await env.HOTELS_DB.prepare('SELECT status FROM pilgrim_trips WHERE booking_id=?').bind(bookingID).first();
  if(!trip||!['availability_check','payment_pending'].includes(normalizedTripStatus(trip.status))) return json({ok:false,error:'PAYMENT_INSTRUCTIONS_LOCKED'},409);
  const payload = await request.json().catch(() => null);
  if (!payload) return json({ok:false,error:'INVALID_JSON'},400);
  const visaCard = cleanText(payload.visaCardNumber, 80) || '';
  const visaHolder = safeHumanText(payload.visaHolder, 160) || '';
  const humoCard = cleanText(payload.humoCardNumber, 80) || '';
  const humoHolder = safeHumanText(payload.humoHolder, 160) || '';
  const instructions = safeHumanText(payload.instructions, 1500) || '';
  const now = new Date().toISOString();
  await env.HOTELS_DB.prepare(`INSERT INTO booking_payment_instructions(booking_id,visa_card_number,visa_holder,humo_card_number,humo_holder,instructions,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(booking_id) DO UPDATE SET visa_card_number=excluded.visa_card_number,visa_holder=excluded.visa_holder,humo_card_number=excluded.humo_card_number,humo_holder=excluded.humo_holder,instructions=excluded.instructions,updated_by=excluded.updated_by,updated_at=excluded.updated_at`)
    .bind(bookingID,visaCard,visaHolder,humoCard,humoHolder,instructions,cleanText(user?.login,180),now).run();
  return json({ok:true,checkout:await adminCheckoutDetail(env,bookingID,await env.HOTELS_DB.prepare('SELECT * FROM pilgrim_trips WHERE booking_id=?').bind(bookingID).first())});
}

async function uploadBookingPaymeQR(request, env, bookingID, user) {
  const trip=await env.HOTELS_DB.prepare('SELECT status FROM pilgrim_trips WHERE booking_id=?').bind(bookingID).first();
  if(!trip||!['availability_check','payment_pending'].includes(normalizedTripStatus(trip.status))) return json({ok:false,error:'PAYMENT_INSTRUCTIONS_LOCKED'},409);
  const up = await privateImageUpload(request, env, `payment-qr/${bookingID}`); if (!up.ok) return up.response;
  const current = await env.HOTELS_DB.prepare('SELECT payme_qr_object_key FROM booking_payment_instructions WHERE booking_id=?').bind(bookingID).first();
  const now=new Date().toISOString();
  await env.HOTELS_DB.prepare(`INSERT INTO booking_payment_instructions(booking_id,payme_qr_object_key,payme_qr_content_type,updated_by,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(booking_id) DO UPDATE SET payme_qr_object_key=excluded.payme_qr_object_key,payme_qr_content_type=excluded.payme_qr_content_type,updated_by=excluded.updated_by,updated_at=excluded.updated_at`).bind(bookingID,up.key,up.ct,cleanText(user?.login,180),now).run();
  if(current?.payme_qr_object_key) await env.HOTELS_MEDIA.delete(current.payme_qr_object_key).catch(()=>{});
  return json({ok:true});
}

async function serveAdminPaymentReceipt(env, bookingID, receiptID) {
  const id=safeID(receiptID); if(!id)return json({ok:false,error:'INVALID_RECEIPT'},400);
  const row=await env.HOTELS_DB.prepare('SELECT object_key,content_type FROM booking_payment_receipts WHERE id=? AND booking_id=?').bind(id,bookingID).first();
  if(!row)return json({ok:false,error:'RECEIPT_NOT_FOUND'},404); const obj=await env.HOTELS_MEDIA.get(row.object_key); if(!obj)return json({ok:false,error:'RECEIPT_NOT_FOUND'},404);
  return new Response(obj.body,{headers:{'content-type':row.content_type||'image/jpeg','cache-control':'private, no-store'}});
}

async function serveAdminTravelerPassport(env, bookingID, position) {
  if (!Number.isInteger(position) || position < 1) return json({ok:false,error:'INVALID_TRAVELER'},400);
  const row = await env.HOTELS_DB.prepare('SELECT passport_object_key,passport_content_type FROM booking_travelers WHERE booking_id=? AND position=?').bind(bookingID,position).first();
  if (!row?.passport_object_key) return json({ok:false,error:'PASSPORT_NOT_FOUND'},404);
  const obj = await env.HOTELS_MEDIA.get(row.passport_object_key);
  if (!obj) return json({ok:false,error:'PASSPORT_NOT_FOUND'},404);
  return new Response(obj.body,{headers:{'content-type':row.passport_content_type||'image/jpeg','cache-control':'private, no-store'}});
}

async function uploadBookingTravelDocument(request, env, bookingID, user, url) {
  const kind=cleanText(url.searchParams.get('kind'),32)||'other'; if(!['visa','voucher','insurance','ticket','other'].includes(kind))return json({ok:false,error:'INVALID_DOCUMENT_KIND'},400);
  const title=safeHumanText(url.searchParams.get('title'),180)||'Документ поездки';
  const reference=safeHumanText(url.searchParams.get('reference'),180)||'';
  const ct=String(request.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
  if(!(ct==='application/pdf'||ct.startsWith('image/')))return json({ok:false,error:'DOCUMENT_REQUIRED'},415);
  const bytes=await request.arrayBuffer(); if(!bytes.byteLength||bytes.byteLength>15_000_000)return json({ok:false,error:'DOCUMENT_TOO_LARGE'},413);
  const ext=ct==='application/pdf'?'pdf':ct.includes('png')?'png':'jpg'; const id=crypto.randomUUID(); const key=`private/travel-documents/${bookingID}/${id}.${ext}`;
  await env.HOTELS_MEDIA.put(key,bytes,{httpMetadata:{contentType:ct}});
  await env.HOTELS_DB.prepare('INSERT INTO booking_travel_documents(id,booking_id,document_kind,title,booking_reference,object_key,content_type,byte_size,created_by) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,bookingID,kind,title,reference,key,ct,bytes.byteLength,cleanText(user?.login,180)).run();
  await sendClientPush(env,bookingID,'Документ поездки готов',title,{type:'travel_document',bookingID}).catch(()=>{});
  return json({ok:true,id});
}
async function serveAdminTravelDocument(env,bookingID,id){const safe=safeID(id);if(!safe)return json({ok:false,error:'INVALID_DOCUMENT'},400);const row=await env.HOTELS_DB.prepare('SELECT object_key,content_type FROM booking_travel_documents WHERE id=? AND booking_id=?').bind(safe,bookingID).first();if(!row)return json({ok:false,error:'DOCUMENT_NOT_FOUND'},404);const obj=await env.HOTELS_MEDIA.get(row.object_key);if(!obj)return json({ok:false,error:'DOCUMENT_NOT_FOUND'},404);return new Response(obj.body,{headers:{'content-type':row.content_type,'cache-control':'private, no-store'}});}

function sourceStatusFromTripStatus(value) {
  const map = { availability_check:'AVAILABILITY_CHECK', payment_pending:'PAYMENT_PENDING', booking_confirmed:'BOOKING_CONFIRMED', ready_to_travel:'READY_TO_TRAVEL', in_trip:'IN_TRIP', completed:'COMPLETED', cancelled:'CANCELLED' };
  return map[String(value || '')] || 'AVAILABILITY_CHECK';
}

async function persistSourceBookingStatus(env, bookingID, status) {
  if (!env.BOOKINGS_DB) throw new Error('BOOKINGS_DB_NOT_CONFIGURED');
  const columns = await env.BOOKINGS_DB.prepare("PRAGMA table_info('bookings')").all();
  const names = new Set((columns.results || []).map(row => String(row?.name || '')));
  if (!names.has('status')) throw new Error('BOOKINGS_SOURCE_STATUS_COLUMN_MISSING');
  const now = new Date().toISOString();
  const sourceStatus = sourceStatusFromTripStatus(status);
  const sql = names.has('updated_at')
    ? 'UPDATE bookings SET status=?, updated_at=? WHERE id=?'
    : 'UPDATE bookings SET status=? WHERE id=?';
  const result = names.has('updated_at')
    ? await env.BOOKINGS_DB.prepare(sql).bind(sourceStatus, now, bookingID).run()
    : await env.BOOKINGS_DB.prepare(sql).bind(sourceStatus, bookingID).run();
  if (Number(result?.meta?.changes ?? 0) < 1) throw new Error('BOOKING_NOT_FOUND_IN_SOURCE_DB');
  if (names.has('payload_json')) {
    await env.BOOKINGS_DB.prepare(
      `UPDATE bookings SET payload_json=json_set(payload_json,'$.status',?) WHERE id=? AND json_valid(payload_json)=1`
    ).bind(sourceStatus, bookingID).run().catch(error => console.warn('BOOKING_PAYLOAD_STATUS_SYNC_FAILED', bookingID, error));
  }
  const persisted = await env.BOOKINGS_DB.prepare('SELECT status FROM bookings WHERE id=? LIMIT 1').bind(bookingID).first();
  if (!persisted || String(persisted.status || '').toUpperCase() !== sourceStatus) throw new Error('BOOKING_SOURCE_STATUS_NOT_PERSISTED');
  return sourceStatus;
}

async function restartBookingPriceLock(request, env, bookingID) {
  const trip = await env.HOTELS_DB.prepare('SELECT status,payment_received_at FROM pilgrim_trips WHERE booking_id=? LIMIT 1').bind(bookingID).first();
  if (!trip) return json({ok:false,error:'BOOKING_NOT_SYNCED'},404);
  if (normalizedTripStatus(trip.status) !== 'payment_pending' || trip.payment_received_at) {
    return json({ok:false,error:'PRICE_LOCK_RESTART_NOT_AVAILABLE'},409);
  }
  const payload = await request.json().catch(() => ({}));
  const requested = Number(payload?.duration_minutes || payload?.durationMinutes || 30);
  const minutes = Number.isFinite(requested) ? Math.max(5,Math.min(60,Math.trunc(requested))) : 30;
  const now = new Date().toISOString();
  await env.HOTELS_DB.prepare('UPDATE pilgrim_trips SET price_lock_started_at=?,price_lock_expires_at=?,updated_at=? WHERE booking_id=?')
    .bind(now,lifecycleISOAfter(now,minutes*60_000),now,bookingID).run();
  return operationsBookingDetail(request,env,bookingID);
}

async function updateOperationsBooking(request, env, bookingID, user) {
  const trip = await env.HOTELS_DB.prepare('SELECT * FROM pilgrim_trips WHERE booking_id=?').bind(bookingID).first();
  if (!trip) return json({ ok: false, error: 'BOOKING_NOT_SYNCED' }, 404);
  const payload = await request.json().catch(() => null);
  if (!payload) return json({ ok: false, error: 'INVALID_JSON' }, 400);
  const nextStatus = cleanText(payload?.status, 80) || trip.status;
  if (!TRIP_STATUSES.has(nextStatus)) return json({ ok: false, error: 'INVALID_TRIP_STATUS' }, 400);
  const currentStatus = normalizedTripStatus(trip.status);
  if (!(TRIP_TRANSITIONS[currentStatus] || new Set([currentStatus])).has(nextStatus)) {
    return json({ ok:false, error:'INVALID_STATUS_TRANSITION' }, 409);
  }
  const paymentStatus = safeHumanText(payload?.paymentStatus ?? trip.payment_status ?? '', 160) || '';
  const confirmationNumber = safeHumanText(payload?.confirmationNumber ?? trip.confirmation_number ?? '', 200) || '';
  const internalNotes = safeHumanText(payload?.internalNotes ?? trip.internal_notes ?? '', 4000) || '';
  const now = new Date().toISOString();
  const completedAt = nextStatus === 'completed' ? (trip.completed_at || now) : null;
  let availabilityStartedAt = trip.availability_started_at || null;
  let availabilityDeadlineAt = trip.availability_deadline_at || null;
  let priceLockStartedAt = trip.price_lock_started_at || null;
  let priceLockExpiresAt = trip.price_lock_expires_at || null;
  let paymentReceivedAt = trip.payment_received_at || null;
  let paymentConfirmationDeadlineAt = trip.payment_confirmation_deadline_at || null;
  let documentsStartedAt = trip.documents_started_at || null;
  let documentsDeadlineAt = trip.documents_deadline_at || null;

  if (nextStatus !== currentStatus) {
    if (nextStatus === 'availability_check') {
      availabilityStartedAt = now;
      availabilityDeadlineAt = lifecycleISOAfter(now, 6 * 60 * 60_000);
      priceLockStartedAt = null;
      priceLockExpiresAt = null;
      paymentReceivedAt = null;
      paymentConfirmationDeadlineAt = null;
    } else if (nextStatus === 'payment_pending') {
      priceLockStartedAt = now;
      priceLockExpiresAt = lifecycleISOAfter(now, 30 * 60_000);
      paymentReceivedAt = null;
      paymentConfirmationDeadlineAt = null;
    } else if (nextStatus === 'booking_confirmed') {
      documentsStartedAt = now;
      documentsDeadlineAt = lifecycleISOAfter(now, 24 * 60 * 60_000);
    }
  }

  if (nextStatus === 'payment_pending' && nextStatus !== currentStatus) {
    const payment = await env.HOTELS_DB.prepare('SELECT visa_card_number,humo_card_number,payme_qr_object_key FROM booking_payment_instructions WHERE booking_id=? LIMIT 1').bind(bookingID).first();
    if (!(payment?.visa_card_number || payment?.humo_card_number || payment?.payme_qr_object_key)) {
      return json({ ok:false, error:'PAYMENT_INSTRUCTIONS_REQUIRED' }, 409);
    }
  }

  if (nextStatus === 'booking_confirmed' && nextStatus !== currentStatus) {
    await ensureTravelerRows(env, bookingID, trip);
    const readiness = await adminCheckoutDetail(env, bookingID, trip);
    if (!readiness?.accountActive) return json({ ok:false, error:'IUMRAH_ACCOUNT_REQUIRED' }, 409);
    if (!readiness?.allTravelersComplete) return json({ ok:false, error:'TRAVELER_DATA_INCOMPLETE' }, 409);
    if (!(readiness?.receipts || []).length) return json({ ok:false, error:'PAYMENT_RECEIPT_REQUIRED' }, 409);
  }
  if (nextStatus === 'ready_to_travel' && nextStatus !== currentStatus) {
    const docs = await env.HOTELS_DB.prepare('SELECT COUNT(*) AS count FROM booking_travel_documents WHERE booking_id=?').bind(bookingID).first();
    if (Number(docs?.count || 0) < 1) return json({ ok:false, error:'TRAVEL_DOCUMENT_REQUIRED' }, 409);
  }

  // The status is canonical across both databases: the customer booking row and
  // the Business operational mirror. This keeps filters, Beta and staff screens
  // on the same value instead of maintaining two drifting statuses.
  if (nextStatus !== currentStatus) {
    try {
      await persistSourceBookingStatus(env, bookingID, nextStatus);
    } catch (error) {
      console.error('BOOKING_SOURCE_STATUS_UPDATE_FAILED', bookingID, error);
      return json({ ok: false, error: cleanText(error?.message, 180) || 'BOOKING_SOURCE_STATUS_UPDATE_FAILED' }, 500);
    }
  }

  const updateResult = await env.HOTELS_DB.prepare(`UPDATE pilgrim_trips SET status=?, payment_status=?, confirmation_number=?, internal_notes=?, completed_at=?, availability_started_at=?, availability_deadline_at=?, price_lock_started_at=?, price_lock_expires_at=?, payment_received_at=?, payment_confirmation_deadline_at=?, documents_started_at=?, documents_deadline_at=?, updated_at=? WHERE booking_id=?`)
    .bind(nextStatus,paymentStatus,confirmationNumber,internalNotes,completedAt,availabilityStartedAt,availabilityDeadlineAt,priceLockStartedAt,priceLockExpiresAt,paymentReceivedAt,paymentConfirmationDeadlineAt,documentsStartedAt,documentsDeadlineAt,now,bookingID).run();
  if (Number(updateResult?.meta?.changes ?? 0) < 1) {
    if (nextStatus !== currentStatus) await persistSourceBookingStatus(env, bookingID, currentStatus).catch(() => {});
    return json({ ok: false, error: 'BOOKING_STATUS_UPDATE_NOT_PERSISTED' }, 500);
  }

  const persisted = await env.HOTELS_DB.prepare('SELECT status, payment_status, confirmation_number, internal_notes FROM pilgrim_trips WHERE booking_id=? LIMIT 1').bind(bookingID).first();
  if (!persisted || String(persisted.status || '') !== nextStatus) {
    if (nextStatus !== currentStatus) await persistSourceBookingStatus(env, bookingID, currentStatus).catch(() => {});
    console.error('BOOKING_STATUS_VERIFY_FAILED', bookingID, { expected: nextStatus, actual: persisted?.status || null });
    return json({ ok: false, error: 'BOOKING_STATUS_UPDATE_NOT_PERSISTED' }, 500);
  }

  if (nextStatus !== currentStatus) {
    if (nextStatus === 'booking_confirmed') {
      await env.HOTELS_DB.prepare("UPDATE booking_payment_receipts SET review_status='approved',reviewed_at=COALESCE(reviewed_at,?),reviewed_by=COALESCE(reviewed_by,?) WHERE booking_id=? AND review_status='submitted'")
        .bind(now,cleanText(user?.login,180),bookingID).run();
    }
    await env.HOTELS_DB.prepare('INSERT INTO booking_status_history (id, booking_id, old_status, new_status, changed_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), bookingID, currentStatus, nextStatus, cleanText(user?.login, 180), now).run();
    await sendClientStatusPush(env, bookingID, nextStatus).catch(error => console.warn('CLIENT_STATUS_PUSH_FAILED', bookingID, error));
  }

  return operationsBookingDetail(request, env, bookingID);
}

async function listPilgrims(env, url) {
  const archiveOnly = url.searchParams.get('archive') === '1';
  const search = cleanText(url.searchParams.get('q'), 120);
  const where = [];
  const values = [];
  if (archiveOnly) where.push("EXISTS (SELECT 1 FROM pilgrim_trips t WHERE t.pilgrim_id=p.id AND t.status='completed')");
  if (search) {
    where.push("(LOWER(p.display_name) LIKE LOWER(?) OR LOWER(p.email) LIKE LOWER(?) OR p.phone LIKE ? OR printf('%06d', p.id) LIKE ?)");
    const q = `%${search}%`; values.push(q,q,q,q);
  }
  const result = await env.HOTELS_DB.prepare(`
    SELECT p.*, (SELECT COUNT(*) FROM pilgrim_trips t WHERE t.pilgrim_id=p.id AND t.status='completed') AS completed_trips
    FROM pilgrims p ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY COALESCE(p.last_trip_at,p.updated_at) DESC LIMIT 500
  `).bind(...values).all();
  return json({ ok: true, pilgrims: (result.results || []).map(row => ({ id: pilgrimPublicID(row.id), displayName: row.display_name || '', firstName: row.first_name || '', lastName: row.last_name || '', phone: row.phone || '', email: row.email || '', totalTrips: Number(row.total_trips || 0), completedTrips: Number(row.completed_trips || 0), lastTripAt: row.last_trip_at || null })) });
}

function parsePilgrimPublicID(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{6})$/);
  return match ? Number(match[1]) : null;
}

async function pilgrimDetail(env, publicID) {
  const numericID = parsePilgrimPublicID(publicID);
  if (!numericID) return json({ ok: false, error: 'INVALID_PILGRIM_ID' }, 400);
  const pilgrim = await env.HOTELS_DB.prepare('SELECT * FROM pilgrims WHERE id=?').bind(numericID).first();
  if (!pilgrim) return json({ ok: false, error: 'PILGRIM_NOT_FOUND' }, 404);
  const trips = await env.HOTELS_DB.prepare('SELECT * FROM pilgrim_trips WHERE pilgrim_id=? ORDER BY created_at DESC').bind(numericID).all();
  return json({ ok: true, pilgrim: { id: pilgrimPublicID(pilgrim.id), displayName: pilgrim.display_name || '', firstName: pilgrim.first_name || '', lastName: pilgrim.last_name || '', phone: pilgrim.phone || '', email: pilgrim.email || '', totalTrips: Number(pilgrim.total_trips || 0), lastTripAt: pilgrim.last_trip_at || null }, trips: (trips.results || []).map(tripMap) });
}

async function adminPrimaryHotels(env, url) {
  const city = canonicalCity(url.searchParams.get('city'));
  const values = [];
  const where = [];
  if (city) { where.push('LOWER(p.city)=LOWER(?)'); values.push(city); }
  const result = await env.HOTELS_DB.prepare(`
    SELECT p.city AS primary_city, p.star_category, p.position,
      h.id, h.name, h.city, h.address, h.latitude, h.longitude, h.stars, h.rating, h.review_count, h.status, h.lifecycle_state, h.updated_at,
      hps.provider AS locked_source_provider, hps.source_url AS locked_source_url,
      ${HOTEL_PRICE_SELECT},
      (SELECT hs.city FROM hotel_sources hs WHERE hs.hotel_id=h.id AND hs.city IS NOT NULL AND hs.city!='' ORDER BY hs.checked_at DESC LIMIT 1) AS source_city_hint,
      (SELECT hs.address FROM hotel_sources hs WHERE hs.hotel_id=h.id AND hs.address IS NOT NULL AND hs.address!='' ORDER BY hs.checked_at DESC LIMIT 1) AS source_address_hint,
      (SELECT hs.latitude FROM hotel_sources hs WHERE hs.hotel_id=h.id AND hs.latitude IS NOT NULL ORDER BY hs.checked_at DESC LIMIT 1) AS source_latitude_hint,
      (SELECT hs.longitude FROM hotel_sources hs WHERE hs.hotel_id=h.id AND hs.longitude IS NOT NULL ORDER BY hs.checked_at DESC LIMIT 1) AS source_longitude_hint,
      (SELECT COUNT(*) FROM hotel_images hi WHERE hi.hotel_id=h.id) AS image_count,
      (SELECT COUNT(*) FROM hotel_rooms hr WHERE hr.hotel_id=h.id) AS room_count,
      (SELECT hi.id FROM hotel_images hi WHERE hi.hotel_id=h.id ORDER BY hi.is_cover DESC, hi.position ASC LIMIT 1) AS cover_image_id
    FROM primary_hotels p
    JOIN hotels h ON h.id=p.hotel_id
    LEFT JOIN hotel_price_cache hp ON hp.hotel_id=h.id
    LEFT JOIN hotel_price_overrides hpo ON hpo.hotel_id=h.id
    LEFT JOIN hotel_price_sources hps ON hps.hotel_id=h.id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY p.city, p.star_category, p.position
  `).bind(...values).all();
  return json({ ok: true, manualPricingOnly: true, assignments: (result.results || []).map(row => ({ city: row.primary_city, stars: Number(row.star_category), position: Number(row.position), hotel: hotelSummary(row, true, { manualOnlyPrice: true }) })) });
}

async function savePrimaryHotels(request, env) {
  const payload = await request.json().catch(() => null);
  const city = canonicalCity(payload?.city);
  const stars = Number(payload?.stars);
  const hotelIDs = Array.isArray(payload?.hotelIDs) ? [...new Set(payload.hotelIDs.map(value => safeID(value)).filter(Boolean))].slice(0,3) : [];
  if (!city || !Number.isInteger(stars) || stars < 1 || stars > 5) return json({ ok: false, error: 'INVALID_PRIMARY_CATEGORY' }, 400);
  const valid = [];
  for (const id of hotelIDs) {
    const hotel = await env.HOTELS_DB.prepare("SELECT id, city FROM hotels WHERE id=? AND status='published' LIMIT 1").bind(id).first();
    if (!hotel) return json({ ok: false, error: `HOTEL_NOT_PUBLISHED:${id}` }, 409);
    if (canonicalCity(hotel.city) !== canonicalCity(city)) return json({ ok: false, error: `HOTEL_CITY_MISMATCH:${id}` }, 409);
    valid.push(id);
  }
  const statements = [env.HOTELS_DB.prepare('DELETE FROM primary_hotels WHERE LOWER(city)=LOWER(?) AND star_category=?').bind(city, stars)];
  const now = new Date().toISOString();
  valid.forEach((id, index) => statements.push(env.HOTELS_DB.prepare('INSERT INTO primary_hotels (city, star_category, position, hotel_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').bind(city, stars, index + 1, id, now, now)));
  await env.HOTELS_DB.batch(statements);
  return adminPrimaryHotels(env, new URL(`https://iumrah.app/api/admin/hotels/operations/primary-hotels?city=${encodeURIComponent(city)}`));
}

async function publicPrimaryHotels(env, url) {
  const city = canonicalCity(url.searchParams.get('city'));
  const stars = Number(url.searchParams.get('stars'));
  if (!city || !Number.isInteger(stars) || stars < 1 || stars > 5) return json({ ok: false, error: 'CITY_AND_STARS_REQUIRED' }, 400);
  const result = await env.HOTELS_DB.prepare(`
    SELECT p.position, h.id, h.name, h.city, h.address, h.latitude, h.longitude, h.stars, h.rating, h.review_count, h.status, h.lifecycle_state, h.updated_at,
      hps.provider AS locked_source_provider, hps.source_url AS locked_source_url,
      ${HOTEL_PRICE_SELECT},
      (SELECT hs.city FROM hotel_sources hs WHERE hs.hotel_id=h.id AND hs.city IS NOT NULL AND hs.city!='' ORDER BY hs.checked_at DESC LIMIT 1) AS source_city_hint,
      (SELECT hs.address FROM hotel_sources hs WHERE hs.hotel_id=h.id AND hs.address IS NOT NULL AND hs.address!='' ORDER BY hs.checked_at DESC LIMIT 1) AS source_address_hint,
      (SELECT hs.latitude FROM hotel_sources hs WHERE hs.hotel_id=h.id AND hs.latitude IS NOT NULL ORDER BY hs.checked_at DESC LIMIT 1) AS source_latitude_hint,
      (SELECT hs.longitude FROM hotel_sources hs WHERE hs.hotel_id=h.id AND hs.longitude IS NOT NULL ORDER BY hs.checked_at DESC LIMIT 1) AS source_longitude_hint,
      (SELECT COUNT(*) FROM hotel_images hi WHERE hi.hotel_id=h.id) AS image_count,
      (SELECT COUNT(*) FROM hotel_rooms hr WHERE hr.hotel_id=h.id) AS room_count,
      (SELECT hi.id FROM hotel_images hi WHERE hi.hotel_id=h.id ORDER BY hi.is_cover DESC, hi.position ASC LIMIT 1) AS cover_image_id
    FROM primary_hotels p
    JOIN hotels h ON h.id=p.hotel_id
    LEFT JOIN hotel_price_cache hp ON hp.hotel_id=h.id
    LEFT JOIN hotel_price_overrides hpo ON hpo.hotel_id=h.id
    LEFT JOIN hotel_price_sources hps ON hps.hotel_id=h.id
    WHERE LOWER(p.city)=LOWER(?) AND p.star_category=? AND h.status='published'
    ORDER BY p.position ASC
  `).bind(city, stars).all();
  return json({ ok: true, city, stars, recommendationLabel: 'Рекомендует iumrah', manualPricingOnly: true, hotels: (result.results || []).map(row => ({ ...hotelSummary(row, false, { publicUsablePrice: true, manualOnlyPrice: true }), primaryPosition: Number(row.position) })) }, 200, PUBLIC_CACHE_HEADERS);
}

async function handleClientOperations(request, env, parts) {
  if (parts[0] === 'account') return handleClientAccount(request, env, parts.slice(1));

  if (parts[0] === 'trips') {
    if (parts.length === 1 && request.method === 'GET') {
      const auth = await requireIumrahAccount(request, env); if (!auth.ok) return auth.response;
      return listAccountTrips(env, auth.pilgrim.id);
    }
    const bookingID = cleanText(parts[1],180); if (!bookingID) return json({ok:false,error:'INVALID_BOOKING_ID'},400);
    if (parts.length === 3 && parts[2] === 'sync' && request.method === 'POST') {
      const auth = await requireBookingToken(request, env, bookingID, {syncTrip:true}); if (!auth.ok) return auth.response;
      return syncBookingProfileByToken(request, env, bookingID, auth);
    }
    if (parts.length === 2 && request.method === 'GET') {
      const auth = await requireClientBooking(request, env, bookingID); if (!auth.ok) return auth.response;
      return clientTripDetail(env, bookingID, auth.trip);
    }
    if (parts.length === 3 && parts[2] === 'itinerary' && request.method === 'GET') {
      const auth = await requireClientBooking(request, env, bookingID); if (!auth.ok) return auth.response;
      return bookingItineraryDetail(env, bookingID, auth.trip);
    }
    if (parts.length === 3 && parts[2] === 'esims' && request.method === 'GET') {
      const auth = await requireClientBooking(request, env, bookingID); if (!auth.ok) return auth.response;
      return clientBookingEsims(env, bookingID);
    }
    if (parts.length === 3 && parts[2] === 'checkout' && request.method === 'GET') {
      const auth=await requireClientBooking(request,env,bookingID); if(!auth.ok)return auth.response;
      return clientCheckoutDetail(env,bookingID,auth.trip);
    }
    if (parts.length === 3 && parts[2] === 'security' && request.method === 'GET') {
      const auth=await requireClientBooking(request,env,bookingID); if(!auth.ok)return auth.response;
      return clientSecuritySubmissionResponse(env,bookingID,auth);
    }
    if (parts.length === 3 && parts[2] === 'security' && request.method === 'PUT') {
      const auth=await requireClientBooking(request,env,bookingID); if(!auth.ok)return auth.response;
      return submitClientSecurityProfile(request,env,bookingID,auth);
    }
    if (parts.length === 4 && parts[2] === 'security' && parts[3] === 'passport' && request.method === 'POST') {
      const auth=await requireClientBooking(request,env,bookingID); if(!auth.ok)return auth.response;
      return uploadClientSecurityPassport(request,env,bookingID,auth);
    }
    if (parts.length === 4 && parts[2] === 'travelers' && request.method === 'PUT') {
      const auth=await requireIumrahBookingAccount(request,env,bookingID); if(!auth.ok)return auth.response;
      return saveTravelerForm(request,env,bookingID,Number(parts[3]),auth);
    }
    if (parts.length === 4 && parts[2] === 'travelers' && parts[3] === 'passport' && request.method === 'POST') return methodNotAllowed();
    if (parts.length === 5 && parts[2] === 'travelers' && parts[4] === 'passport' && request.method === 'POST') {
      const auth=await requireIumrahBookingAccount(request,env,bookingID); if(!auth.ok)return auth.response;
      return uploadTravelerPassport(request,env,bookingID,Number(parts[3]),auth);
    }
    if (parts.length === 3 && parts[2] === 'receipt' && request.method === 'POST') {
      const auth=await requireIumrahBookingAccount(request,env,bookingID); if(!auth.ok)return auth.response;
      return uploadPaymentReceipt(request,env,bookingID,auth);
    }
    if (parts.length === 4 && parts[2] === 'media' && request.method === 'GET') {
      const auth=await requireIumrahBookingAccount(request,env,bookingID); if(!auth.ok)return auth.response;
      return serveClientPrivateMedia(env,bookingID,parts[3]);
    }
    return methodNotAllowed();
  }

  if (parts[0] === 'bookings') {
    const bookingID=cleanText(parts[1],180); if(!bookingID)return json({ok:false,error:'INVALID_BOOKING_ID'},400);
    if(parts.length===2&&request.method==='DELETE'){const auth=await requireClientBooking(request,env,bookingID,{syncTrip:false});if(!auth.ok)return auth.response;return deleteClientBooking(request,env,bookingID,auth);} return methodNotAllowed();
  }
  if(parts[0]==='push'&&parts.length===2&&parts[1]==='devices'&&request.method==='POST')return registerClientPushDevice(request,env);
  if(parts[0]==='notifications')return handleClientSystemNotifications(request,env,parts.slice(1));
  if(parts[0]!=='chats')return json({ok:false,error:'NOT_FOUND'},404);
  const bookingID=cleanText(parts[1],180); if(!bookingID)return json({ok:false,error:'INVALID_BOOKING_ID'},400);
  const auth=await requireClientBooking(request,env,bookingID,{syncTrip:false}); if(!auth.ok)return auth.response;
  if(parts.length===3&&parts[2]==='messages'){if(request.method==='GET')return chatMessages(env,bookingID,false);if(request.method==='POST')return sendClientChatMessage(request,env,bookingID,auth.user);}
  if(parts.length===3&&parts[2]==='attachments'&&request.method==='POST')return sendChatAttachment(request,env,bookingID,auth.user,false);
  if(parts.length===3&&parts[2]==='read'&&request.method==='POST')return markClientChatRead(env,bookingID);
  if(parts.length===4&&parts[2]==='media'&&request.method==='GET')return serveChatAttachment(env,bookingID,parts[3]);
  return methodNotAllowed();
}

async function registerClientPushDevice(request,env){
 const payload=await request.json().catch(()=>null);const bookingID=cleanText(payload?.bookingID||payload?.bookingId,180);const token=cleanText(payload?.deviceToken,256)?.toLowerCase();if(!bookingID)return json({ok:false,error:'BOOKING_ID_REQUIRED'},400);if(!token||!/^[0-9a-f]{32,256}$/.test(token))return json({ok:false,error:'INVALID_DEVICE_TOKEN'},400);
 const auth=await requireClientBooking(request,env,bookingID,{syncTrip:false});if(!auth.ok)return auth.response;const environment=payload?.environment==='development'?'development':'production';const appBundleID=cleanText(payload?.appBundleID||payload?.appBundleId,220)||CLIENT_APP_BUNDLE_ID;if(appBundleID!==CLIENT_APP_BUNDLE_ID)return json({ok:false,error:'INVALID_APP_BUNDLE_ID'},400);const locale=cleanText(payload?.locale,32)||'ru';const now=new Date().toISOString();
 await env.HOTELS_DB.prepare(`INSERT INTO client_push_subscriptions(device_token,booking_id,environment,app_bundle_id,locale,enabled,created_at,updated_at,last_error) VALUES(?,?,?,?,?,1,?,?,NULL) ON CONFLICT(device_token,booking_id) DO UPDATE SET environment=excluded.environment,app_bundle_id=excluded.app_bundle_id,locale=excluded.locale,enabled=1,updated_at=excluded.updated_at,last_error=NULL`).bind(token,bookingID,environment,appBundleID,locale,now,now).run();return json({ok:true,ready:apnsConfigured(env),bookingID,appBundleID:CLIENT_APP_BUNDLE_ID});
}


const CLIENT_NOTIFICATION_SCOPES = new Set(['all','authenticated','guest','has_trip']);
const CLIENT_NOTIFICATION_DESTINATIONS = new Set(['home','hotels','bookings','care','account','booking']);

function validClientInstallation(value) {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{16,128}$/.test(value);
}

async function optionalIumrahAccount(request, env) {
  const header = String(request.headers.get('authorization') || '');
  if (!header.toLowerCase().startsWith('bearer ')) return { ok: true, authenticated: false, pilgrim: null };
  const auth = await requireIumrahAccount(request, env);
  if (!auth.ok) return { ok: false, response: auth.response };
  return { ok: true, authenticated: true, pilgrim: auth.pilgrim };
}

function clientNotificationTargetSQL(scope, alias = 'd') {
  if (scope === 'authenticated') return `${alias}.is_authenticated=1`;
  if (scope === 'guest') return `${alias}.is_authenticated=0`;
  if (scope === 'has_trip') return `${alias}.has_trip=1`;
  return '1=1';
}

function mapClientSystemNotification(row) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    targetScope: row.target_scope,
    destination: row.destination,
    destinationBookingID: row.destination_booking_id || null,
    createdBy: row.created_by || '',
    status: row.status,
    matchedDevices: Number(row.matched_devices || 0),
    pushSentCount: Number(row.push_sent_count || 0),
    pushFailedCount: Number(row.push_failed_count || 0),
    createdAt: row.created_at,
    sentAt: row.sent_at || null,
    expiresAt: row.expires_at,
    isRead: Number(row.is_read || 0) === 1
  };
}

async function registerClientNotificationDevice(request, env) {
  const payload = await request.json().catch(() => null);
  const installationID = cleanText(payload?.installationID || payload?.installationId, 128);
  if (!validClientInstallation(installationID)) return json({ ok: false, error: 'INVALID_INSTALLATION_ID' }, 400);

  let deviceToken = cleanText(payload?.deviceToken, 256)?.toLowerCase() || null;
  if (deviceToken && !/^[0-9a-f]{32,256}$/.test(deviceToken)) return json({ ok: false, error: 'INVALID_DEVICE_TOKEN' }, 400);
  const environment = payload?.environment === 'development' ? 'development' : 'production';
  const appBundleID = cleanText(payload?.appBundleID || payload?.appBundleId, 220) || CLIENT_APP_BUNDLE_ID;
  if (appBundleID !== CLIENT_APP_BUNDLE_ID) return json({ ok: false, error: 'INVALID_APP_BUNDLE_ID' }, 400);
  const locale = cleanText(payload?.locale, 32) || 'ru';
  const hasTrip = payload?.hasTrip === true ? 1 : 0;
  const account = await optionalIumrahAccount(request, env);
  if (!account.ok) return account.response;
  const pilgrimID = account.authenticated ? Number(account.pilgrim?.id || account.pilgrim?.pilgrim_id || 0) || null : null;
  const authenticated = account.authenticated ? 1 : 0;
  const now = new Date().toISOString();

  if (deviceToken) {
    await env.HOTELS_DB.prepare(`
      DELETE FROM client_notification_devices
      WHERE device_token=? AND installation_id<>?
    `).bind(deviceToken, installationID).run().catch(() => {});
  }

  await env.HOTELS_DB.prepare(`
    INSERT INTO client_notification_devices(
      installation_id,device_token,environment,app_bundle_id,locale,pilgrim_id,is_authenticated,has_trip,enabled,created_at,updated_at,last_seen_at,last_error
    ) VALUES(?,?,?,?,?,?,?,?,1,?,?,?,NULL)
    ON CONFLICT(installation_id) DO UPDATE SET
      device_token=COALESCE(excluded.device_token,client_notification_devices.device_token),
      environment=excluded.environment,
      app_bundle_id=excluded.app_bundle_id,
      locale=excluded.locale,
      pilgrim_id=excluded.pilgrim_id,
      is_authenticated=excluded.is_authenticated,
      has_trip=excluded.has_trip,
      enabled=CASE WHEN excluded.device_token IS NOT NULL THEN 1 ELSE client_notification_devices.enabled END,
      updated_at=excluded.updated_at,
      last_seen_at=excluded.last_seen_at,
      last_error=NULL
  `).bind(
    installationID, deviceToken, environment, appBundleID, locale, pilgrimID, authenticated, hasTrip,
    now, now, now
  ).run();

  return json({ ok: true, ready: apnsConfigured(env), installationID, appBundleID: CLIENT_APP_BUNDLE_ID, authenticated: !!authenticated, hasTrip: !!hasTrip });
}

async function clientSystemNotificationFeed(request, env) {
  const url = new URL(request.url);
  const installationID = cleanText(url.searchParams.get('installationID') || url.searchParams.get('installationId'), 128);
  if (!validClientInstallation(installationID)) return json({ ok: false, error: 'INVALID_INSTALLATION_ID' }, 400);
  const account = await optionalIumrahAccount(request, env);
  if (!account.ok) return account.response;

  const device = await env.HOTELS_DB.prepare(`
    SELECT installation_id,is_authenticated,has_trip FROM client_notification_devices WHERE installation_id=? LIMIT 1
  `).bind(installationID).first();
  if (!device) return json({ ok: true, notifications: [] });

  const now = new Date().toISOString();
  const rows = await env.HOTELS_DB.prepare(`
    SELECT n.*, CASE WHEN r.notification_id IS NULL THEN 0 ELSE 1 END AS is_read
    FROM client_system_notifications n
    LEFT JOIN client_system_notification_reads r
      ON r.notification_id=n.id AND r.installation_id=?
    WHERE n.status='published' AND n.sent_at IS NOT NULL AND n.expires_at>?
      AND (
        n.target_scope='all'
        OR (n.target_scope='authenticated' AND ?=1)
        OR (n.target_scope='guest' AND ?=0)
        OR (n.target_scope='has_trip' AND ?=1)
      )
    ORDER BY n.sent_at DESC
    LIMIT 12
  `).bind(
    installationID,
    now,
    Number(device.is_authenticated || 0),
    Number(device.is_authenticated || 0),
    Number(device.has_trip || 0)
  ).all();

  return json({ ok: true, notifications: (rows.results || []).map(mapClientSystemNotification) });
}

async function markClientSystemNotificationRead(request, env, notificationID) {
  const payload = await request.json().catch(() => null);
  const installationID = cleanText(payload?.installationID || payload?.installationId, 128);
  if (!validClientInstallation(installationID)) return json({ ok: false, error: 'INVALID_INSTALLATION_ID' }, 400);
  const exists = await env.HOTELS_DB.prepare('SELECT id FROM client_system_notifications WHERE id=? LIMIT 1').bind(notificationID).first();
  if (!exists) return json({ ok: false, error: 'NOTIFICATION_NOT_FOUND' }, 404);
  const device = await env.HOTELS_DB.prepare('SELECT installation_id FROM client_notification_devices WHERE installation_id=? LIMIT 1').bind(installationID).first();
  if (!device) return json({ ok: false, error: 'INSTALLATION_NOT_REGISTERED' }, 404);
  const now = new Date().toISOString();
  await env.HOTELS_DB.prepare(`
    INSERT INTO client_system_notification_reads(notification_id,installation_id,opened_at)
    VALUES(?,?,?)
    ON CONFLICT(notification_id,installation_id) DO UPDATE SET opened_at=excluded.opened_at
  `).bind(notificationID, installationID, now).run();
  return json({ ok: true });
}

async function handleClientSystemNotifications(request, env, parts) {
  if (parts.length === 1 && parts[0] === 'devices' && request.method === 'POST') {
    return registerClientNotificationDevice(request, env);
  }
  if (parts.length === 1 && parts[0] === 'feed' && request.method === 'GET') {
    return clientSystemNotificationFeed(request, env);
  }
  if (parts.length === 3 && parts[0] === 'feed' && parts[2] === 'read' && request.method === 'POST') {
    const notificationID = safeID(parts[1]);
    if (!notificationID) return json({ ok: false, error: 'INVALID_NOTIFICATION_ID' }, 400);
    return markClientSystemNotificationRead(request, env, notificationID);
  }
  return methodNotAllowed();
}

async function clientNotificationAudience(env) {
  const row = await env.HOTELS_DB.prepare(`
    SELECT
      COUNT(*) AS all_count,
      SUM(CASE WHEN is_authenticated=1 THEN 1 ELSE 0 END) AS authenticated_count,
      SUM(CASE WHEN is_authenticated=0 THEN 1 ELSE 0 END) AS guest_count,
      SUM(CASE WHEN has_trip=1 THEN 1 ELSE 0 END) AS has_trip_count,
      SUM(CASE WHEN enabled=1 AND device_token IS NOT NULL AND device_token<>'' THEN 1 ELSE 0 END) AS push_capable_count
    FROM client_notification_devices
  `).first();
  return json({
    ok: true,
    audience: {
      all: Number(row?.all_count || 0),
      authenticated: Number(row?.authenticated_count || 0),
      guest: Number(row?.guest_count || 0),
      hasTrip: Number(row?.has_trip_count || 0),
      pushCapable: Number(row?.push_capable_count || 0)
    }
  });
}

async function listClientSystemNotifications(env) {
  const rows = await env.HOTELS_DB.prepare(`
    SELECT * FROM client_system_notifications ORDER BY created_at DESC LIMIT 50
  `).all();
  return json({ ok: true, notifications: (rows.results || []).map(mapClientSystemNotification) });
}

async function sendClientSystemNotificationPush(env, scope, notification) {
  if (!apnsConfigured(env)) return { ok: false, skipped: 'APNS_NOT_CONFIGURED', sent: 0, total: 0 };
  let lastInstallationID = '';
  let sent = 0;
  let total = 0;
  const where = clientNotificationTargetSQL(scope, 'd');

  for (let page = 0; page < 100; page += 1) {
    const rows = await env.HOTELS_DB.prepare(`
      SELECT installation_id,device_token,environment,app_bundle_id,locale
      FROM client_notification_devices d
      WHERE d.enabled=1 AND d.device_token IS NOT NULL AND d.device_token<>''
        AND d.app_bundle_id=? AND d.installation_id>? AND ${where}
      ORDER BY d.installation_id ASC
      LIMIT 200
    `).bind(CLIENT_APP_BUNDLE_ID, lastInstallationID).all();
    const devices = rows.results || [];
    if (!devices.length) break;
    lastInstallationID = devices[devices.length - 1].installation_id;

    const data = {
      type: 'system_notification',
      notificationID: notification.id,
      destination: notification.destination,
      ...(notification.destinationBookingID ? { destinationBookingID: notification.destinationBookingID } : {})
    };
    const result = await sendAPNsToRows(env, devices, notification.title, notification.body, data, async (device, delivery) => {
      const now = new Date().toISOString();
      if (delivery.ok) {
        await env.HOTELS_DB.prepare(`
          UPDATE client_notification_devices SET last_success_at=?,last_error=NULL,updated_at=? WHERE installation_id=?
        `).bind(now, now, device.installation_id).run().catch(() => {});
      } else if (delivery.response) {
        await env.HOTELS_DB.prepare(`
          UPDATE client_notification_devices SET enabled=?,last_error=?,updated_at=? WHERE installation_id=?
        `).bind(delivery.disable ? 0 : 1, delivery.error.slice(0, 900), now, device.installation_id).run().catch(() => {});
      }
    }, CLIENT_APP_BUNDLE_ID);
    sent += Number(result.sent || 0);
    total += Number(result.total || 0);
    if (devices.length < 200) break;
  }
  return { ok: sent > 0, sent, total };
}

async function createClientSystemNotification(request, env, user) {
  const payload = await request.json().catch(() => null);
  const title = safeHumanText(payload?.title || '', 120) || '';
  const body = safeHumanText(payload?.body || '', 600) || '';
  const targetScope = cleanText(payload?.targetScope, 32)?.toLowerCase() || 'all';
  const destination = cleanText(payload?.destination, 32)?.toLowerCase() || 'home';
  const destinationBookingID = cleanText(payload?.destinationBookingID || payload?.destinationBookingId, 180) || null;
  if (!title || !body) return json({ ok: false, error: 'NOTIFICATION_COPY_REQUIRED' }, 400);
  if (!CLIENT_NOTIFICATION_SCOPES.has(targetScope)) return json({ ok: false, error: 'INVALID_NOTIFICATION_SCOPE' }, 400);
  if (!CLIENT_NOTIFICATION_DESTINATIONS.has(destination)) return json({ ok: false, error: 'INVALID_NOTIFICATION_DESTINATION' }, 400);
  if (destination === 'booking' && !destinationBookingID) return json({ ok: false, error: 'DESTINATION_BOOKING_ID_REQUIRED' }, 400);

  const id = `signal-${crypto.randomUUID()}`;
  const now = new Date();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + 14 * 86400_000).toISOString();
  const createdBy = businessStaffLogin(user) || safeHumanText(user?.displayName || '', 180) || 'iumrah-business';
  const countRow = await env.HOTELS_DB.prepare(`
    SELECT COUNT(*) AS count FROM client_notification_devices d WHERE ${clientNotificationTargetSQL(targetScope, 'd')}
  `).first();
  const matchedDevices = Number(countRow?.count || 0);

  await env.HOTELS_DB.prepare(`
    INSERT INTO client_system_notifications(
      id,title,body,target_scope,destination,destination_booking_id,created_by,status,matched_devices,push_sent_count,push_failed_count,created_at,sent_at,expires_at
    ) VALUES(?,?,?,?,?,?,?,'sending',?,0,0,?,NULL,?)
  `).bind(
    id,title,body,targetScope,destination,destinationBookingID,createdBy,matchedDevices,createdAt,expiresAt
  ).run();

  let delivery;
  try {
    delivery = await sendClientSystemNotificationPush(env, targetScope, {
      id, title, body, destination, destinationBookingID
    });
  } catch (error) {
    console.error('CLIENT_SYSTEM_NOTIFICATION_PUSH_FAILED', id, error);
    delivery = { ok: false, sent: 0, total: 0, error: String(error?.message || error) };
  }

  const sentAt = new Date().toISOString();
  const sentCount = Number(delivery?.sent || 0);
  const attempted = Number(delivery?.total || 0);
  const failedCount = Math.max(0, attempted - sentCount);
  await env.HOTELS_DB.prepare(`
    UPDATE client_system_notifications
    SET status='published',sent_at=?,push_sent_count=?,push_failed_count=?
    WHERE id=?
  `).bind(sentAt, sentCount, failedCount, id).run();

  const row = await env.HOTELS_DB.prepare('SELECT * FROM client_system_notifications WHERE id=?').bind(id).first();
  return json({ ok: true, notification: mapClientSystemNotification(row), delivery: { sent: sentCount, attempted, pushReady: apnsConfigured(env) } }, 201);
}

async function requireBookingToken(request,env,bookingID,options={}){
 const bookingToken=cleanText(request.headers.get('x-booking-token'),1024);if(!bookingToken)return {ok:false,response:json({ok:false,error:'UNAUTHORIZED'},401)};const base=String(env.BOOKINGS_PUBLIC_URL||'https://iumrah.app/api/bookings').replace(/\/$/,'');let response;try{response=await fetch(`${base}/${encodeURIComponent(bookingID)}`,{method:'GET',headers:{'x-booking-token':bookingToken,'accept':'application/json','user-agent':request.headers.get('user-agent')||'iumrah-client'},redirect:'manual'});}catch{return {ok:false,response:json({ok:false,error:'BOOKING_AUTH_UNAVAILABLE'},503)}}if(response.status===404)return {ok:false,response:json({ok:false,error:'BOOKING_NOT_FOUND'},404)};if(!response.ok)return {ok:false,response:json({ok:false,error:'BOOKING_ACCESS_DENIED'},403)};const payload=await response.json().catch(()=>null);const booking=payload?.booking||payload;if(!booking||cleanText(booking?.id,180)!==bookingID)return {ok:false,response:json({ok:false,error:'BOOKING_ACCESS_DENIED'},403)};
 let linked=null;if(options.syncTrip!==false){try{linked=await syncBookingTrip(env,booking);}catch(error){console.error('CLIENT_BOOKING_SYNC_FAILED',bookingID,error);return {ok:false,response:json({ok:false,error:'BOOKING_SYNC_FAILED'},503)}}}if(linked?.deleted)return {ok:false,response:json({ok:false,error:'BOOKING_DELETED'},410)};let trip=linked?.trip||await env.HOTELS_DB.prepare('SELECT * FROM pilgrim_trips WHERE booking_id=?').bind(bookingID).first().catch(()=>null);return {ok:true,booking,trip,user:{displayName:linked?.pilgrim?canonicalPilgrimName(linked.pilgrim):'Паломник'},bootstrap:true};
}

async function requireIumrahAccount(request,env){
 const header=String(request.headers.get('authorization')||'');
 const token=header.toLowerCase().startsWith('bearer ')?header.slice(7).trim():'';
 if(!token)return {ok:false,response:json({ok:false,error:'ACCOUNT_AUTH_REQUIRED'},401)};
 const hash=await sha256Hex(token),now=new Date().toISOString();
 const row=await env.HOTELS_DB.prepare(`SELECT s.pilgrim_id,s.expires_at,p.id,p.first_name,p.last_name,p.display_name,p.phone,p.email,p.telegram,p.whatsapp,p.created_at,p.updated_at,p.last_trip_at,p.total_trips FROM iumrah_account_sessions s JOIN pilgrims p ON p.id=s.pilgrim_id WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? LIMIT 1`).bind(hash,now).first();
 if(!row)return {ok:false,response:json({ok:false,error:'ACCOUNT_SESSION_EXPIRED'},401)};
 await env.HOTELS_DB.prepare('UPDATE iumrah_account_sessions SET last_used_at=? WHERE token_hash=?').bind(now,hash).run().catch(()=>{});
 return {ok:true,pilgrim:row,tokenHash:hash,user:{id:pilgrimPublicID(row.id),displayName:canonicalPilgrimName(row)}};
}
async function requireIumrahBookingAccount(request,env,bookingID){const auth=await requireIumrahAccount(request,env);if(!auth.ok)return auth;const trip=await env.HOTELS_DB.prepare('SELECT * FROM pilgrim_trips WHERE booking_id=? AND pilgrim_id=? LIMIT 1').bind(bookingID,auth.pilgrim.pilgrim_id||auth.pilgrim.id).first();if(!trip)return {ok:false,response:json({ok:false,error:'BOOKING_ACCESS_DENIED'},403)};return {...auth,trip};}
async function requireClientBooking(request,env,bookingID,options={}){const account=await requireIumrahAccount(request,env);if(account.ok){const access=await requireIumrahBookingAccount(request,env,bookingID);if(access.ok)return access;}return requireBookingToken(request,env,bookingID,options);}

const IUMRAH_PASSWORD_ITERATIONS = 100000;

function decodePilgrimID(value){const text=String(value||'').trim();if(!/^\d{6}$/.test(text))return 0;return Number(text);}
function validPassword(value){return typeof value==='string'&&value.length>=8&&value.length<=128;}
function passwordHashSupported(iterations){const value=Number(iterations||0);return Number.isFinite(value)&&value>0&&value<=IUMRAH_PASSWORD_ITERATIONS;}
function randomToken(bytes=32){const data=new Uint8Array(bytes);crypto.getRandomValues(data);return base64urlBytes(data);}
async function passwordDigest(password,salt,iterations=IUMRAH_PASSWORD_ITERATIONS){
 const safeIterations=Number(iterations||IUMRAH_PASSWORD_ITERATIONS);
 if(!passwordHashSupported(safeIterations))throw new Error('UNSUPPORTED_PASSWORD_ITERATIONS');
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
 const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:new TextEncoder().encode(salt),iterations:safeIterations},key,256);
 return base64urlBytes(new Uint8Array(bits));
}
function constantTimeEqual(a,b){const x=new TextEncoder().encode(String(a||'')),y=new TextEncoder().encode(String(b||''));if(x.length===0||y.length===0||x.length!==y.length)return false;let diff=0;for(let i=0;i<x.length;i++)diff|=x[i]^y[i];return diff===0;}
async function createAccountSession(env,pilgrimID){const token=randomToken(32),hash=await sha256Hex(token),now=new Date(),expires=new Date(now.getTime()+90*86400_000);await env.HOTELS_DB.prepare('INSERT INTO iumrah_account_sessions(token_hash,pilgrim_id,created_at,expires_at,last_used_at) VALUES(?,?,?,?,?)').bind(hash,pilgrimID,now.toISOString(),expires.toISOString(),now.toISOString()).run();return {token,expiresAt:expires.toISOString()};}
function accountProfile(p){return {iumrahID:pilgrimPublicID(p.id||p.pilgrim_id),displayName:canonicalPilgrimName(p),firstName:p.first_name||'',lastName:p.last_name||'',phone:p.phone||'',email:p.email||'',telegram:p.telegram||'',whatsapp:p.whatsapp||''};}
async function handleClientAccount(request,env,parts){
 if(parts.length===1&&parts[0]==='activate'&&request.method==='POST'){
  const payload=await request.json().catch(()=>null),bookingID=cleanText(payload?.bookingID,180),password=String(payload?.password||'');
  if(!bookingID||!validPassword(password))return json({ok:false,error:'INVALID_ACCOUNT_DATA'},400);
  const boot=await requireBookingToken(request,env,bookingID,{syncTrip:true});if(!boot.ok)return boot.response;
  const trip=boot.trip;if(!trip||!['availability_check','payment_pending'].includes(normalizedTripStatus(trip.status)))return json({ok:false,error:'ACCOUNT_ACTIVATION_NOT_AVAILABLE'},409);
  const existing=await env.HOTELS_DB.prepare('SELECT pilgrim_id,password_iterations FROM iumrah_accounts WHERE pilgrim_id=?').bind(trip.pilgrim_id).first();
  if(existing&&passwordHashSupported(existing.password_iterations))return json({ok:false,error:'ACCOUNT_ALREADY_ACTIVE'},409);
  const salt=randomToken(18),iterations=IUMRAH_PASSWORD_ITERATIONS,now=new Date().toISOString();
  let hash;try{hash=await passwordDigest(password,salt,iterations);}catch(error){console.error('IUMRAH_PASSWORD_HASH_FAILED',error);return json({ok:false,error:'PASSWORD_SETUP_UNAVAILABLE'},503);}
  if(existing){
   await env.HOTELS_DB.prepare(`UPDATE iumrah_accounts SET password_salt=?,password_hash=?,password_iterations=?,password_updated_at=?,failed_attempts=0,locked_until=NULL,last_login_at=NULL WHERE pilgrim_id=?`).bind(salt,hash,iterations,now,trip.pilgrim_id).run();
  }else{
   await env.HOTELS_DB.prepare('INSERT INTO iumrah_accounts(pilgrim_id,password_salt,password_hash,password_iterations,activated_at,password_updated_at) VALUES(?,?,?,?,?,?)').bind(trip.pilgrim_id,salt,hash,iterations,now,now).run();
  }
  const pilgrim=await env.HOTELS_DB.prepare('SELECT * FROM pilgrims WHERE id=?').bind(trip.pilgrim_id).first();
  const session=await createAccountSession(env,trip.pilgrim_id);
  return json({ok:true,account:accountProfile(pilgrim),session});
 }
 if(parts.length===1&&parts[0]==='login'&&request.method==='POST'){
  const payload=await request.json().catch(()=>null),id=decodePilgrimID(payload?.iumrahID||payload?.id),password=String(payload?.password||'');
  if(!id||!validPassword(password))return json({ok:false,error:'INVALID_CREDENTIALS'},401);
  const row=await env.HOTELS_DB.prepare('SELECT a.*,p.* FROM iumrah_accounts a JOIN pilgrims p ON p.id=a.pilgrim_id WHERE a.pilgrim_id=? LIMIT 1').bind(id).first();
  if(!row)return json({ok:false,error:'INVALID_CREDENTIALS'},401);
  if(!passwordHashSupported(row.password_iterations))return json({ok:false,error:'ACCOUNT_PASSWORD_RESET_REQUIRED'},409);
  if(row.locked_until&&Date.parse(row.locked_until)>Date.now())return json({ok:false,error:'ACCOUNT_TEMPORARILY_LOCKED'},423);
  let expected;try{expected=await passwordDigest(password,row.password_salt,Number(row.password_iterations));}catch(error){console.error('IUMRAH_PASSWORD_VERIFY_FAILED',error);return json({ok:false,error:'PASSWORD_LOGIN_UNAVAILABLE'},503);}
  if(!constantTimeEqual(expected,row.password_hash)){const attempts=Number(row.failed_attempts||0)+1;const locked=attempts>=6?new Date(Date.now()+15*60_000).toISOString():null;await env.HOTELS_DB.prepare('UPDATE iumrah_accounts SET failed_attempts=?,locked_until=? WHERE pilgrim_id=?').bind(locked?0:attempts,locked,id).run();return json({ok:false,error:locked?'ACCOUNT_TEMPORARILY_LOCKED':'INVALID_CREDENTIALS'},locked?423:401);}
  const now=new Date().toISOString();await env.HOTELS_DB.prepare('UPDATE iumrah_accounts SET failed_attempts=0,locked_until=NULL,last_login_at=? WHERE pilgrim_id=?').bind(now,id).run();
  const session=await createAccountSession(env,id);return json({ok:true,account:accountProfile(row),session});
 }
 if(parts.length===1&&parts[0]==='session'&&request.method==='GET'){const auth=await requireIumrahAccount(request,env);if(!auth.ok)return auth.response;return json({ok:true,account:accountProfile(auth.pilgrim)});}
 if(parts.length===1&&parts[0]==='profile'&&request.method==='PUT'){const auth=await requireIumrahAccount(request,env);if(!auth.ok)return auth.response;const payload=await request.json().catch(()=>null);if(!payload)return json({ok:false,error:'INVALID_JSON'},400);const firstName=safeHumanText(payload.firstName,120)||'',lastName=safeHumanText(payload.lastName,120)||'',phone=cleanText(payload.phone,100)||'',email=cleanText(payload.email,220)||'',telegram=cleanText(payload.telegram,120)||'',whatsapp=cleanText(payload.whatsapp,120)||'';if(!firstName||!lastName)return json({ok:false,error:'PROFILE_NAME_REQUIRED'},400);const displayName=[firstName,lastName].filter(Boolean).join(' ').trim();await env.HOTELS_DB.prepare('UPDATE pilgrims SET first_name=?,last_name=?,display_name=?,phone=?,email=?,telegram=?,whatsapp=?,updated_at=? WHERE id=?').bind(firstName,lastName,displayName,phone,email,telegram,whatsapp,new Date().toISOString(),auth.pilgrim.id).run();const pilgrim=await env.HOTELS_DB.prepare('SELECT * FROM pilgrims WHERE id=?').bind(auth.pilgrim.id).first();return json({ok:true,account:accountProfile(pilgrim)});}
 if(parts.length===1&&parts[0]==='logout'&&request.method==='POST'){const auth=await requireIumrahAccount(request,env);if(!auth.ok)return auth.response;await env.HOTELS_DB.prepare('UPDATE iumrah_account_sessions SET revoked_at=? WHERE token_hash=?').bind(new Date().toISOString(),auth.tokenHash).run();return json({ok:true});}
 if(parts.length===1&&parts[0]==='link-booking'&&request.method==='POST'){
  const auth=await requireIumrahAccount(request,env);if(!auth.ok)return auth.response;
  const payload=await request.json().catch(()=>null);const bookingID=cleanText(payload?.bookingID,180);if(!bookingID)return json({ok:false,error:'BOOKING_ID_REQUIRED'},400);
  // Validate the one-time booking token without creating a temporary pilgrim. The
  // canonical Iumrah account owns the trip from its first operational row.
  const boot=await requireBookingToken(request,env,bookingID,{syncTrip:false});if(!boot.ok)return boot.response;
  const canonicalID=Number(auth.pilgrim.id);const now=new Date().toISOString();
  let trip=await env.HOTELS_DB.prepare('SELECT * FROM pilgrim_trips WHERE booking_id=? LIMIT 1').bind(bookingID).first();
  if(!trip){
    const sourcePayload=await sourceBookingPayload(env,bookingID);const effectiveRaw=mergeSourceBooking(boot.booking,sourcePayload);const bookingNumber=await allocateBookingNumber(env);
    await env.HOTELS_DB.prepare(`INSERT INTO pilgrim_trips (id,booking_id,booking_number,pilgrim_id,status,start_date,end_date,booking_snapshot_json,pricing_snapshot_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(`trip-${crypto.randomUUID()}`,bookingID,bookingNumber,canonicalID,tripStatusFromBooking(effectiveRaw),cleanText(effectiveRaw?.startDate,64),cleanText(effectiveRaw?.endDate,64),JSON.stringify(effectiveRaw),'{}',now,now).run();
  }else if(Number(trip.pilgrim_id)!==canonicalID){
    const oldID=Number(trip.pilgrim_id||0);
    await env.HOTELS_DB.prepare('UPDATE pilgrim_trips SET pilgrim_id=?,updated_at=? WHERE booking_id=?').bind(canonicalID,now,bookingID).run();
    await recalcPilgrimStats(env,oldID);const orphan=await env.HOTELS_DB.prepare('SELECT COUNT(*) AS count FROM pilgrim_trips WHERE pilgrim_id=?').bind(oldID).first();const oldAccount=await env.HOTELS_DB.prepare('SELECT pilgrim_id FROM iumrah_accounts WHERE pilgrim_id=?').bind(oldID).first();if(oldID&&Number(orphan?.count||0)===0&&!oldAccount)await env.HOTELS_DB.prepare('DELETE FROM pilgrims WHERE id=?').bind(oldID).run().catch(()=>{});
  }
  const identity=bookingIdentity(boot.booking);await updatePilgrimIdentityFields(env,auth.pilgrim,identity);await recalcPilgrimStats(env,canonicalID);
  trip=await ensureTripLifecycleTimers(env,bookingID);
  await applyPendingPackagePricingReport(env, bookingID);
  return json({ok:true,pilgrimID:pilgrimPublicID(canonicalID),bookingNumber:Number(trip?.booking_number||0)||null,bookingDisplayNumber:bookingPublicNumber(trip?.booking_number)});
 }
 return methodNotAllowed();
}
async function recalcPilgrimStats(env,id){if(!id)return;const r=await env.HOTELS_DB.prepare('SELECT COUNT(*) count,MAX(COALESCE(end_date,created_at)) last_trip FROM pilgrim_trips WHERE pilgrim_id=?').bind(id).first();await env.HOTELS_DB.prepare('UPDATE pilgrims SET total_trips=?,last_trip_at=?,updated_at=? WHERE id=?').bind(Number(r?.count||0),r?.last_trip||null,new Date().toISOString(),id).run();}
async function listAccountTrips(env,pilgrimID){const rows=await env.HOTELS_DB.prepare('SELECT * FROM pilgrim_trips WHERE pilgrim_id=? ORDER BY created_at DESC').bind(pilgrimID).all();return json({ok:true,trips:(rows.results||[]).map(tripMap)});}
async function clientTripDetail(env,bookingID,trip){
  trip=await ensureTripLifecycleTimers(env,bookingID)||trip;
  const raw=parseJSONObject(trip?.booking_snapshot_json);
  return json({ok:true,trip:tripMap(trip),booking:raw,assignment:await clientBookingAssignmentDetail(env,bookingID),esims:await clientBookingEsimRows(env,bookingID,{syncIfStale:true}),statusHistory:await clientStatusHistory(env,bookingID)});
}
async function syncBookingProfileByToken(request, env, bookingID, auth) {
  const payload = await request.json().catch(() => ({}));
  let trip = auth.trip;
  let pilgrim = trip
    ? await env.HOTELS_DB.prepare('SELECT * FROM pilgrims WHERE id=?').bind(trip.pilgrim_id).first()
    : null;
  const identity = {
    firstName: safeHumanText(payload?.firstName || '', 120) || '',
    lastName: safeHumanText(payload?.lastName || '', 120) || '',
    displayName: [payload?.firstName, payload?.lastName].filter(Boolean).join(' ').trim(),
    phone: cleanText(payload?.whatsapp || payload?.phone, 100) || '',
    email: cleanText(payload?.email, 220) || ''
  };
  pilgrim = await updatePilgrimIdentityFields(env, pilgrim, identity);

  if (trip) {
    const hasGeneratorTrace = payload?.generatorTrace && typeof payload.generatorTrace === 'object';
    if (hasGeneratorTrace) {
      const snapshot = parseJSONObject(trip.booking_snapshot_json);
      snapshot.generatorTrace = payload.generatorTrace;
      // pricingSnapshot from a client is intentionally ignored. PackageEngine is
      // the only owner allowed to write pricing_snapshot_json for generated quotes.
      await env.HOTELS_DB.prepare(`UPDATE pilgrim_trips
        SET booking_snapshot_json=?, updated_at=?
        WHERE id=?`)
        .bind(JSON.stringify(snapshot), new Date().toISOString(), trip.id)
        .run();
      trip = await env.HOTELS_DB.prepare('SELECT * FROM pilgrim_trips WHERE id=?').bind(trip.id).first();
    }
  }

  return json({
    ok: true,
    pilgrimID: pilgrimPublicID(pilgrim.id),
    trip: tripMap(trip),
    assignment: await clientBookingAssignmentDetail(env, bookingID),
    esims: await clientBookingEsimRows(env, bookingID, { syncIfStale: true }),
    statusHistory: await clientStatusHistory(env, bookingID)
  });
}

function travelerCountsFromSnapshot(raw){const t=raw?.input?.travelers||raw?.travelers||{};return {adults:Math.max(1,Number(t.adults||1)),children:Math.max(0,Number(t.children||0)),infants:Math.max(0,Number(t.infants||0))};}
async function ensureTravelerRows(env,bookingID,trip){const existing=await env.HOTELS_DB.prepare('SELECT COUNT(*) count FROM booking_travelers WHERE booking_id=?').bind(bookingID).first();if(Number(existing?.count||0)>0)return;const c=travelerCountsFromSnapshot(parseJSONObject(trip.booking_snapshot_json));let pos=0;const stm=[];for(const [type,count] of [['adult',c.adults],['child',c.children],['infant',c.infants]])for(let i=0;i<count;i++){pos++;const relationship=pos===1?'self':(type==='child'||type==='infant'?'child':'other');stm.push(env.HOTELS_DB.prepare('INSERT OR IGNORE INTO booking_travelers(id,booking_id,position,traveler_type,relationship) VALUES(?,?,?,?,?)').bind(`traveler-${crypto.randomUUID()}`,bookingID,pos,type,relationship));}if(stm.length)await env.HOTELS_DB.batch(stm);}
function travelerMap(r){return {position:Number(r.position),travelerType:r.traveler_type,relationship:r.relationship||((Number(r.position)===1)?'self':'other'),firstName:r.first_name,middleName:r.middle_name,lastName:r.last_name,gender:r.gender,dateOfBirth:r.date_of_birth,placeOfBirth:r.place_of_birth,nationality:r.nationality,residenceCountry:r.residence_country,passportNumber:r.passport_number,passportIssueDate:r.passport_issue_date,passportExpiryDate:r.passport_expiry_date,passportIssuingCountry:r.passport_issuing_country,phone:r.phone,email:r.email,emergencyName:r.emergency_name,emergencyPhone:r.emergency_phone,emergencyRelation:r.emergency_relation,hasPassport:!!r.passport_object_key,completed:Number(r.completed||0)===1};}
async function accountActive(env,pid){const row=await env.HOTELS_DB.prepare('SELECT pilgrim_id,password_iterations FROM iumrah_accounts WHERE pilgrim_id=?').bind(pid).first();return !!row&&passwordHashSupported(row.password_iterations);}
async function clientCheckoutDetail(env,bookingID,trip){
 await ensureTravelerRows(env,bookingID,trip);
 const [trav,pay,receipts,docs,active]=await Promise.all([
  env.HOTELS_DB.prepare('SELECT * FROM booking_travelers WHERE booking_id=? ORDER BY position').bind(bookingID).all(),
  env.HOTELS_DB.prepare('SELECT * FROM booking_payment_instructions WHERE booking_id=?').bind(bookingID).first(),
  env.HOTELS_DB.prepare('SELECT id,payment_method,note,review_status,created_at,content_type FROM booking_payment_receipts WHERE booking_id=? ORDER BY created_at DESC').bind(bookingID).all(),
  env.HOTELS_DB.prepare('SELECT id,document_kind,title,booking_reference,content_type,created_at FROM booking_travel_documents WHERE booking_id=? ORDER BY created_at').bind(bookingID).all(),
  accountActive(env,trip.pilgrim_id)
 ]);
 return json({
  ok:true,iumrahID:pilgrimPublicID(trip.pilgrim_id),accountActive:active,status:normalizedTripStatus(trip.status),
  travelers:(trav.results||[]).map(travelerMap),
  payment:{visaCardNumber:pay?.visa_card_number||'',visaHolder:pay?.visa_holder||'',hasPaymeQR:!!pay?.payme_qr_object_key,paymeQRURL:pay?.payme_qr_object_key?`/api/catalog/hotels/client/trips/${encodeURIComponent(bookingID)}/media/payment-qr`:null,humoCardNumber:pay?.humo_card_number||'',humoHolder:pay?.humo_holder||'',instructions:pay?.instructions||''},
  receipts:(receipts.results||[]).map(r=>({id:r.id,paymentMethod:r.payment_method||'other',note:r.note||'',reviewStatus:r.review_status||'submitted',createdAt:r.created_at||'',contentType:r.content_type||'image/jpeg',filename:`payment-receipt-${r.id}.${r.content_type==='application/pdf'?'pdf':r.content_type==='image/png'?'png':'jpg'}`,url:`/api/catalog/hotels/client/trips/${encodeURIComponent(bookingID)}/media/receipt-${r.id}`})),
  documents:(docs.results||[]).map(d=>({id:d.id,documentKind:d.document_kind||'other',title:d.title||'Документ поездки',bookingReference:d.booking_reference||null,contentType:d.content_type||'application/octet-stream',createdAt:d.created_at||'',url:`/api/catalog/hotels/client/trips/${encodeURIComponent(bookingID)}/media/document-${d.id}`}))
 });
}
function travelerComplete(v,hasPassport){return !!(v.firstName&&v.lastName&&v.gender&&v.dateOfBirth&&v.nationality&&v.passportNumber&&v.passportExpiryDate&&v.passportIssuingCountry&&hasPassport);}
async function saveTravelerForm(request,env,bookingID,position,auth){
 if(!['availability_check','payment_pending'].includes(normalizedTripStatus(auth.trip?.status)))return json({ok:false,error:'TRAVELER_EDITING_CLOSED'},409);
 if(!Number.isInteger(position)||position<1)return json({ok:false,error:'INVALID_TRAVELER'},400);
 const p=await request.json().catch(()=>null);if(!p)return json({ok:false,error:'INVALID_JSON'},400);
 const row=await env.HOTELS_DB.prepare('SELECT * FROM booking_travelers WHERE booking_id=? AND position=?').bind(bookingID,position).first();if(!row)return json({ok:false,error:'TRAVELER_NOT_FOUND'},404);
 const allowedRelationships=new Set(['self','spouse','mother','father','brother','sister','child','relative','friend','other']);
 const requestedRelationship=cleanText(p.relationship,32);
 const relationship=allowedRelationships.has(requestedRelationship)?requestedRelationship:(row.relationship||((position===1)?'self':'other'));
 const val={firstName:safeHumanText(p.firstName,120)||'',middleName:safeHumanText(p.middleName,120)||'',lastName:safeHumanText(p.lastName,120)||'',gender:cleanText(p.gender,20)||'',dateOfBirth:cleanText(p.dateOfBirth,20)||'',placeOfBirth:safeHumanText(p.placeOfBirth,160)||'',nationality:safeHumanText(p.nationality,100)||'',residenceCountry:safeHumanText(p.residenceCountry,100)||'',passportNumber:cleanText(p.passportNumber,80)||'',passportIssueDate:cleanText(p.passportIssueDate,20)||'',passportExpiryDate:cleanText(p.passportExpiryDate,20)||'',passportIssuingCountry:safeHumanText(p.passportIssuingCountry,100)||'',phone:cleanText(p.phone,100)||'',email:cleanText(p.email,220)||'',emergencyName:safeHumanText(p.emergencyName,160)||'',emergencyPhone:cleanText(p.emergencyPhone,100)||'',emergencyRelation:safeHumanText(p.emergencyRelation,80)||''};
 const complete=travelerComplete(val,!!row.passport_object_key);
 await env.HOTELS_DB.prepare(`UPDATE booking_travelers SET relationship=?,first_name=?,middle_name=?,last_name=?,gender=?,date_of_birth=?,place_of_birth=?,nationality=?,residence_country=?,passport_number=?,passport_issue_date=?,passport_expiry_date=?,passport_issuing_country=?,phone=?,email=?,emergency_name=?,emergency_phone=?,emergency_relation=?,completed=?,updated_at=? WHERE booking_id=? AND position=?`).bind(relationship,val.firstName,val.middleName,val.lastName,val.gender,val.dateOfBirth,val.placeOfBirth,val.nationality,val.residenceCountry,val.passportNumber,val.passportIssueDate,val.passportExpiryDate,val.passportIssuingCountry,val.phone,val.email,val.emergencyName,val.emergencyPhone,val.emergencyRelation,complete?1:0,new Date().toISOString(),bookingID,position).run();
 return json({ok:true,traveler:travelerMap(await env.HOTELS_DB.prepare('SELECT * FROM booking_travelers WHERE booking_id=? AND position=?').bind(bookingID,position).first())});
}
async function privateImageUpload(request,env,keyPrefix){const ct=String(request.headers.get('content-type')||'').split(';')[0].toLowerCase();if(!ct.startsWith('image/'))return {ok:false,response:json({ok:false,error:'IMAGE_REQUIRED'},415)};const bytes=await request.arrayBuffer();if(!bytes.byteLength||bytes.byteLength>10_000_000)return {ok:false,response:json({ok:false,error:'IMAGE_TOO_LARGE'},413)};const ext=ct.includes('png')?'png':ct.includes('heic')?'heic':'jpg';const key=`private/${keyPrefix}/${crypto.randomUUID()}.${ext}`;await env.HOTELS_MEDIA.put(key,bytes,{httpMetadata:{contentType:ct}});return {ok:true,key,ct,size:bytes.byteLength};}
async function uploadTravelerPassport(request,env,bookingID,position,auth){if(!['availability_check','payment_pending'].includes(normalizedTripStatus(auth.trip?.status)))return json({ok:false,error:'TRAVELER_EDITING_CLOSED'},409);const row=await env.HOTELS_DB.prepare('SELECT * FROM booking_travelers WHERE booking_id=? AND position=?').bind(bookingID,position).first();if(!row)return json({ok:false,error:'TRAVELER_NOT_FOUND'},404);const up=await privateImageUpload(request,env,`passports/${bookingID}`);if(!up.ok)return up.response;if(row.passport_object_key){const securityPhoto=await env.HOTELS_DB.prepare('SELECT passport_object_key FROM iumrah_security_submissions WHERE booking_id=? LIMIT 1').bind(bookingID).first().catch(()=>null);if(securityPhoto?.passport_object_key!==row.passport_object_key)await env.HOTELS_MEDIA.delete(row.passport_object_key).catch(()=>{});}const complete=travelerComplete({firstName:row.first_name,lastName:row.last_name,gender:row.gender,dateOfBirth:row.date_of_birth,nationality:row.nationality,passportNumber:row.passport_number,passportExpiryDate:row.passport_expiry_date,passportIssuingCountry:row.passport_issuing_country},true);await env.HOTELS_DB.prepare('UPDATE booking_travelers SET passport_object_key=?,passport_content_type=?,completed=?,updated_at=? WHERE booking_id=? AND position=?').bind(up.key,up.ct,complete?1:0,new Date().toISOString(),bookingID,position).run();return json({ok:true,hasPassport:true});}
async function uploadPaymentReceipt(request,env,bookingID,auth){if(normalizedTripStatus(auth.trip?.status)!=='payment_pending')return json({ok:false,error:'PAYMENT_SUBMISSION_CLOSED'},409);const method=cleanText(request.headers.get('x-payment-method') || new URL(request.url).searchParams.get('method'),20)||'other';if(!['visa','payme','humo','other'].includes(method))return json({ok:false,error:'INVALID_PAYMENT_METHOD'},400);const up=await privateImageUpload(request,env,`receipts/${bookingID}`);if(!up.ok)return up.response;const id=crypto.randomUUID();const now=new Date().toISOString();await env.HOTELS_DB.prepare('INSERT INTO booking_payment_receipts(id,booking_id,payment_method,object_key,content_type,byte_size) VALUES(?,?,?,?,?,?)').bind(id,bookingID,method,up.key,up.ct,up.size).run();await env.HOTELS_DB.prepare("UPDATE pilgrim_trips SET payment_status='receipt_submitted',payment_received_at=COALESCE(payment_received_at,?),payment_confirmation_deadline_at=COALESCE(payment_confirmation_deadline_at,?),updated_at=? WHERE booking_id=?").bind(now,lifecycleISOAfter(now,10*60_000),now,bookingID).run();await sendStaffPush(env,'Новый чек оплаты',`Бронь ${bookingID} · iumrah ID ${pilgrimPublicID(auth.pilgrim.id)}`,{type:'payment_receipt',bookingID}).catch(()=>{});return json({ok:true,id});}
async function serveClientPrivateMedia(env,bookingID,mediaID){let key=null,ct='application/octet-stream';if(mediaID==='payment-qr'){const r=await env.HOTELS_DB.prepare('SELECT payme_qr_object_key,payme_qr_content_type FROM booking_payment_instructions WHERE booking_id=?').bind(bookingID).first();key=r?.payme_qr_object_key;ct=r?.payme_qr_content_type||'image/png';}else if(mediaID.startsWith('document-')){const id=mediaID.slice(9);const r=await env.HOTELS_DB.prepare('SELECT object_key,content_type FROM booking_travel_documents WHERE id=? AND booking_id=?').bind(id,bookingID).first();key=r?.object_key;ct=r?.content_type||ct;}else if(mediaID.startsWith('receipt-')){const id=mediaID.slice(8);const r=await env.HOTELS_DB.prepare('SELECT object_key,content_type FROM booking_payment_receipts WHERE id=? AND booking_id=?').bind(id,bookingID).first();key=r?.object_key;ct=r?.content_type||'image/jpeg';}if(!key)return json({ok:false,error:'MEDIA_NOT_FOUND'},404);const obj=await env.HOTELS_MEDIA.get(key);if(!obj)return json({ok:false,error:'MEDIA_NOT_FOUND'},404);return new Response(obj.body,{headers:{'content-type':ct,'cache-control':'private, no-store'}});}

async function sendClientChatMessage(request, env, bookingID, user) {
  const payload = await request.json().catch(() => null);
  const body = safeHumanText(payload?.body, 4000);
  if (!body) return json({ ok: false, error: 'EMPTY_MESSAGE' }, 400);
  const clientMessageID = safeID(payload?.clientMessageID) || null;
  if (clientMessageID) {
    const existing = await env.HOTELS_DB.prepare('SELECT id FROM business_chat_messages WHERE booking_id=? AND client_message_id=? LIMIT 1').bind(bookingID, clientMessageID).first();
    if (existing?.id) return chatMessageDetail(env, existing.id, 200, false);
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const senderName = await bookingPilgrimName(env, bookingID, safeHumanText(user?.displayName || user?.name || '', 160) || '');
  try {
    // Keep these writes sequential. Besides producing clearer diagnostics, this makes
    // the parent thread unquestionably visible before the FK-constrained message write.
    await env.HOTELS_DB.prepare(`INSERT INTO business_chat_threads (booking_id, created_at, updated_at, last_message_at, last_message_preview, last_sender_type, unread_for_staff) VALUES (?, ?, ?, ?, ?, 'client', 1) ON CONFLICT(booking_id) DO UPDATE SET updated_at=excluded.updated_at, last_message_at=excluded.last_message_at, last_message_preview=excluded.last_message_preview, last_sender_type='client', unread_for_staff=1`)
      .bind(bookingID, now, now, now, body.slice(0,240)).run();
    await env.HOTELS_DB.prepare(`INSERT INTO business_chat_messages (id, booking_id, sender_type, sender_name, body, created_at, read_by_staff, client_message_id, message_type) VALUES (?, ?, 'client', ?, ?, ?, 0, ?, 'text')`)
      .bind(id, bookingID, senderName, body, now, clientMessageID).run();
  } catch (error) {
    // If the client retried after a network timeout, return the already-created message.
    if (clientMessageID) {
      const existing = await env.HOTELS_DB.prepare('SELECT id FROM business_chat_messages WHERE booking_id=? AND client_message_id=? LIMIT 1')
        .bind(bookingID, clientMessageID).first().catch(() => null);
      if (existing?.id) return chatMessageDetail(env, existing.id, 200, false);
    }
    console.error('CLIENT_CHAT_WRITE_FAILED', bookingID, error);
    return json({ ok: false, error: 'CHAT_MESSAGE_WRITE_FAILED' }, 500);
  }
  await sendStaffPush(env, senderName, body.slice(0, 180), { type: 'chat_message', bookingID }).catch(() => {});
  return chatMessageDetail(env, id, 201, false);
}

async function markClientChatRead(env, bookingID) {
  return json({ ok: true });
}

async function sendChatAttachment(request, env, bookingID, user, staff = true) {
  const contentType = String(request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!contentType.startsWith('image/')) return json({ ok: false, error: 'IMAGE_REQUIRED' }, 415);
  const sourceBytes = await request.arrayBuffer();
  if (!sourceBytes.byteLength || sourceBytes.byteLength > 12_000_000) return json({ ok: false, error: 'IMAGE_TOO_LARGE' }, 413);
  let transformed;
  try { transformed = await optimizeHotelImageBytes(env, sourceBytes, { category: 'gallery', isCover: false, sourceContentType: contentType }); }
  catch (error) { return json({ ok: false, error: String(error?.message || 'IMAGE_OPTIMIZATION_FAILED') }, 422); }
  const attachmentID = crypto.randomUUID();
  const extension = transformed.extension || 'webp';
  const objectKey = `chat/${bookingID}/${attachmentID}.${extension}`;
  await env.HOTELS_MEDIA.put(objectKey, transformed.bytes, { httpMetadata: { contentType: transformed.contentType } });
  const now = new Date().toISOString();
  const messageID = crypto.randomUUID();
  const senderType = staff ? 'staff' : 'client';
  const senderName = staff
    ? await staffDisplayName(env, user)
    : await bookingPilgrimName(env, bookingID, safeHumanText(user?.displayName || user?.name || '', 160) || '');
  const preview = 'Фотография';
  try {
    await env.HOTELS_DB.batch([
      env.HOTELS_DB.prepare(`INSERT INTO business_chat_threads (booking_id, created_at, updated_at, last_message_at, last_message_preview, last_sender_type, unread_for_staff) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(booking_id) DO UPDATE SET updated_at=excluded.updated_at, last_message_at=excluded.last_message_at, last_message_preview=excluded.last_message_preview, last_sender_type=excluded.last_sender_type, unread_for_staff=excluded.unread_for_staff`).bind(bookingID, now, now, now, preview, senderType, staff ? 0 : 1),
      env.HOTELS_DB.prepare('INSERT INTO business_chat_attachments (id, booking_id, object_key, content_type, byte_size, width, height, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(attachmentID, bookingID, objectKey, transformed.contentType, transformed.bytes.byteLength, transformed.width, transformed.height, now),
      env.HOTELS_DB.prepare(`INSERT INTO business_chat_messages (id, booking_id, sender_type, sender_name, body, created_at, read_by_staff, message_type, attachment_id) VALUES (?, ?, ?, ?, '', ?, ?, 'image', ?)`).bind(messageID, bookingID, senderType, senderName, now, staff ? 1 : 0, attachmentID)
    ]);
  } catch (error) {
    await env.HOTELS_MEDIA.delete(objectKey).catch(() => {});
    throw error;
  }
  if (staff) {
    await sendClientPush(env, bookingID, 'iumrah Care', 'Фотография', { type: 'chat_image', bookingID }).catch(() => {});
  } else {
    await sendStaffPush(env, senderName, 'Фотография', { type: 'chat_image', bookingID }).catch(() => {});
  }
  return chatMessageDetail(env, messageID, 201, staff);
}

async function serveChatAttachment(env, bookingID, attachmentID) {
  const safeAttachmentID = safeID(attachmentID);
  if (!safeAttachmentID) return json({ ok: false, error: 'INVALID_ATTACHMENT_ID' }, 400);
  const row = await env.HOTELS_DB.prepare('SELECT * FROM business_chat_attachments WHERE id=? AND booking_id=? LIMIT 1').bind(safeAttachmentID, bookingID).first();
  if (!row) return json({ ok: false, error: 'ATTACHMENT_NOT_FOUND' }, 404);
  const object = await env.HOTELS_MEDIA.get(row.object_key);
  if (!object) return json({ ok: false, error: 'ATTACHMENT_NOT_FOUND' }, 404);
  const headers = new Headers();
  headers.set('content-type', row.content_type || 'image/webp');
  headers.set('cache-control', 'private, max-age=3600');
  return new Response(object.body, { status: 200, headers });
}


async function requireStaff(request, env, options = {}) {
  const cookie = request.headers.get('cookie') || '';
  if (!cookie) {
    return { ok: false, response: json({ ok: false, error: 'UNAUTHORIZED' }, 401) };
  }

  let response;
  try {
    response = await fetch(env.AUTH_SESSION_URL || 'https://iumrah.app/api/auth/staff/session', {
      method: 'GET',
      headers: {
        'cookie': cookie,
        'accept': 'application/json',
        'user-agent': request.headers.get('user-agent') || 'iumrah-business'
      },
      redirect: 'manual'
    });
  } catch (error) {
    console.error('AUTH_PROXY_FAILED', error);
    return { ok: false, response: json({ ok: false, error: 'AUTH_SERVICE_UNAVAILABLE' }, 503) };
  }

  if (!response.ok) {
    return { ok: false, response: json({ ok: false, error: 'UNAUTHORIZED' }, 401) };
  }

  const payload = await response.json().catch(() => null);
  const user = payload?.user;
  const role = String(user?.role || '').toLowerCase();
  if (!user || !['superadmin', 'admin'].includes(role)) {
    return { ok: false, response: json({ ok: false, error: 'FORBIDDEN' }, 403) };
  }

  if (options.allowSessionRegistration === true) {
    return { ok: true, user, businessSession: null };
  }
  if (options.intelligenceAuthority === true) {
    // Staff role is already validated by iumrah.app above. Reuse the SAME
    // authority for the device token; local HOTELS_DB may be a different D1.
    const verified = await verifyIntelligenceBusinessSession(request, env);
    if (!verified.ok) return {ok: false, response: json({ok: false, error: verified.error}, verified.status)};
    return {ok: true, user, businessSession: verified.session};
  }
  const business = await requireBusinessSession(request, env, user);
  if (!business.ok) return business;
  return { ok: true, user, businessSession: business.session || null };
}


async function isPrimaryHotel(env, hotelID) {
  const id = safeID(hotelID);
  if (!id) return false;
  const row = await env.HOTELS_DB.prepare('SELECT 1 AS yes FROM primary_hotels WHERE hotel_id=? LIMIT 1').bind(id).first().catch(() => null);
  return !!row;
}

async function primaryHotelsTableAvailable(env) {
  const row = await env.HOTELS_DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='primary_hotels' LIMIT 1").first().catch(() => null);
  return !!row;
}

function hotelPriceFromRow(row, options = {}) {
  if (!row) return null;
  const manualNightly = row.price_manual_nightly_usd == null ? null : Number(row.price_manual_nightly_usd);
  const sourceNightly = row.price_nightly_price_usd == null ? null : Number(row.price_nightly_price_usd);
  const hasManual = Number.isFinite(manualNightly) && manualNightly > 0;
  const manualOnly = options.manualOnly === true;
  const effectiveNightly = hasManual ? manualNightly : sourceNightly;
  if (manualOnly && !hasManual) return null;
  if (!hasManual && row.price_status == null) return null;

  const sourceStatus = hasManual ? 'manual' : row.price_status;
  const sourceExpiresAt = hasManual ? null : (row.price_expires_at || null);
  const sourceExpired = !!sourceExpiresAt && Number.isFinite(Date.parse(sourceExpiresAt)) && Date.parse(sourceExpiresAt) <= Date.now();
  const publicUsable = options.publicUsable === true && Number.isFinite(effectiveNightly) && effectiveNightly > 0;
  const usingFallback = publicUsable && !hasManual && (sourceStatus === 'stale' || sourceExpired);

  // Consumer compatibility contract: a last-known non-zero rate must never make
  // package generation impossible merely because the provider refresh is late.
  // Admin responses still expose the real stale/manual state; public catalog
  // responses expose the same amount as usable while retaining sourceStatus and
  // sourceExpiresAt for diagnostics.
  const publicStatus = publicUsable && (hasManual || usingFallback) ? 'fresh' : sourceStatus;
  const publicExpiresAt = hasManual && publicUsable
    ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
    : usingFallback
      ? new Date(Date.now() + HOTEL_PRICE_RETRY_MS).toISOString()
      : sourceExpiresAt;

  return {
    provider: manualOnly ? null : (row.price_provider || row.price_locked_provider || null),
    sourceURL: manualOnly ? null : (row.price_source_url || row.price_locked_source_url || null),
    resolvedURL: row.price_resolved_url || null,
    amountOriginal: row.price_amount_original == null ? null : Number(row.price_amount_original),
    currencyOriginal: row.price_currency_original || null,
    priceBasis: row.price_basis || null,
    nightlyUSD: effectiveNightly,
    sourceNightlyUSD: manualOnly ? null : sourceNightly,
    isManualOverride: hasManual,
    quoteTotalUSD: hasManual ? null : (row.price_quote_total_usd == null ? null : Number(row.price_quote_total_usd)),
    checkIn: row.price_quote_check_in || null,
    checkOut: row.price_quote_check_out || null,
    nights: row.price_quote_nights == null ? null : Number(row.price_quote_nights),
    adults: row.price_quote_adults == null ? null : Number(row.price_quote_adults),
    rooms: row.price_quote_rooms == null ? null : Number(row.price_quote_rooms),
    confidence: row.price_confidence == null ? null : Number(row.price_confidence),
    method: hasManual ? 'admin-manual-override' : (row.price_method || null),
    status: publicStatus,
    sourceStatus,
    fallbackPrice: usingFallback,
    fetchedAt: hasManual ? (row.price_manual_updated_at || null) : (row.price_fetched_at || null),
    expiresAt: publicExpiresAt,
    sourceExpiresAt: manualOnly ? null : sourceExpiresAt,
    lastAttemptAt: manualOnly ? null : (row.price_last_attempt_at || null),
    nextRetryAt: manualOnly ? null : (row.price_next_retry_at || null),
    error: manualOnly ? null : (publicUsable ? null : (row.price_error || null)),
    sourceError: manualOnly ? null : (row.price_error || null)
  };
}

const HOTEL_PRICE_SELECT = `
  hp.provider AS price_provider,
  hp.source_url AS price_source_url,
  hp.resolved_url AS price_resolved_url,
  hp.amount_original AS price_amount_original,
  hp.currency_original AS price_currency_original,
  hp.price_basis AS price_basis,
  hp.nightly_price_usd AS price_nightly_price_usd,
  hp.quote_total_usd AS price_quote_total_usd,
  hp.quote_check_in AS price_quote_check_in,
  hp.quote_check_out AS price_quote_check_out,
  hp.quote_nights AS price_quote_nights,
  hp.quote_adults AS price_quote_adults,
  hp.quote_rooms AS price_quote_rooms,
  hp.confidence AS price_confidence,
  hp.method AS price_method,
  hp.status AS price_status,
  hp.fetched_at AS price_fetched_at,
  hp.expires_at AS price_expires_at,
  hp.last_attempt_at AS price_last_attempt_at,
  hp.next_retry_at AS price_next_retry_at,
  hp.error AS price_error,
  hps.provider AS price_locked_provider,
  hps.source_url AS price_locked_source_url,
  hpo.nightly_price_usd AS price_manual_nightly_usd,
  hpo.updated_at AS price_manual_updated_at
`;

async function readHotelPriceRow(env, hotelID) {
  return env.HOTELS_DB.prepare(`
    SELECT ${HOTEL_PRICE_SELECT}
    FROM hotels h
    LEFT JOIN hotel_price_cache hp ON hp.hotel_id=h.id
    LEFT JOIN hotel_price_overrides hpo ON hpo.hotel_id=h.id
    LEFT JOIN hotel_price_sources hps ON hps.hotel_id=h.id
    WHERE h.id=?
    LIMIT 1
  `).bind(hotelID).first();
}


function importedHotelPriceCandidates(sources) {
  if (!Array.isArray(sources)) return [];
  return sources.map(source => {
    const normalized = normalizeImportedHotelPriceSnapshot(source?.price);
    const provider = cleanText(source?.provider, 80);
    const sourceURL = cleanURL(source?.sourceURL);
    if (!normalized || !provider || !sourceURL) return null;
    // Booking prices must arrive from a USD-configured Booking page. Do not accept
    // SAR/AED/UZS and silently convert it: that can validate the wrong DOM amount.
    // Expedia keeps its existing normalization behavior.
    if (normalizedHotelPriceProvider(provider, sourceURL) === 'Booking' && normalized.currencyOriginal !== 'USD') return null;
    return { source, provider, sourceURL, normalized };
  }).filter(Boolean).sort((a, b) => {
    const confidenceDelta = Number(b.normalized.confidence || 0) - Number(a.normalized.confidence || 0);
    if (Math.abs(confidenceDelta) > 0.001) return confidenceDelta;
    return Number(a.normalized.nightlyUSD || Infinity) - Number(b.normalized.nightlyUSD || Infinity);
  });
}

function hasImportedHotelPrice(sources) {
  return importedHotelPriceCandidates(sources).length > 0;
}

async function persistImportedHotelPriceSnapshots(env, id, sources) {
  if (await isPrimaryHotel(env, id)) return false;
  const best = importedHotelPriceCandidates(sources)[0];
  if (!best) return false;

  const nowDate = new Date();
  const now = nowDate.toISOString();
  const expiresAt = new Date(nowDate.getTime() + HOTEL_PRICE_TTL_MS).toISOString();
  const existing = await env.HOTELS_DB.prepare('SELECT * FROM hotel_price_cache WHERE hotel_id=? LIMIT 1').bind(id).first();

  if (existing?.nightly_price_usd != null && hotelPriceMoveNeedsConfirmation(existing.nightly_price_usd, best.normalized.nightlyUSD)) {
    const pendingMatches = hotelPriceCandidatesMatch(existing.pending_nightly_price_usd, best.normalized.nightlyUSD);
    const seenCount = pendingMatches ? Number(existing.pending_seen_count || 0) + 1 : 1;
    if (seenCount < 2) {
      await env.HOTELS_DB.prepare(`
        UPDATE hotel_price_cache
        SET pending_nightly_price_usd=?, pending_seen_count=?, pending_first_seen_at=CASE WHEN ?=1 THEN ? ELSE pending_first_seen_at END,
            pending_last_seen_at=?, last_attempt_at=?, error='PRICE_CHANGE_AWAITING_CONFIRMATION', updated_at=?
        WHERE hotel_id=?
      `).bind(
        best.normalized.nightlyUSD,
        seenCount,
        seenCount,
        now,
        now,
        now,
        now,
        id
      ).run();
      return true;
    }
  }

  const sourceRow = await env.HOTELS_DB.prepare(`
    SELECT id FROM hotel_sources
    WHERE hotel_id=? AND LOWER(provider)=LOWER(?) AND source_url=?
    ORDER BY checked_at DESC
    LIMIT 1
  `).bind(id, best.provider, best.sourceURL).first();

  await env.HOTELS_DB.prepare(`
    INSERT INTO hotel_price_cache (
      hotel_id, source_id, provider, source_url, resolved_url,
      amount_original, currency_original, price_basis, nightly_price_usd, quote_total_usd,
      quote_check_in, quote_check_out, quote_nights, quote_adults, quote_rooms,
      confidence, method, status, fetched_at, expires_at, last_attempt_at, next_retry_at,
      last_http_status, error, pending_nightly_price_usd, pending_seen_count,
      pending_first_seen_at, pending_last_seen_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'fresh', ?, ?, ?, NULL, NULL, NULL, NULL, 0, NULL, NULL, ?, ?)
    ON CONFLICT(hotel_id) DO UPDATE SET
      source_id=excluded.source_id,
      provider=excluded.provider,
      source_url=excluded.source_url,
      resolved_url=excluded.resolved_url,
      amount_original=excluded.amount_original,
      currency_original=excluded.currency_original,
      price_basis=excluded.price_basis,
      nightly_price_usd=excluded.nightly_price_usd,
      quote_total_usd=excluded.quote_total_usd,
      quote_check_in=excluded.quote_check_in,
      quote_check_out=excluded.quote_check_out,
      quote_nights=excluded.quote_nights,
      quote_adults=excluded.quote_adults,
      quote_rooms=excluded.quote_rooms,
      confidence=excluded.confidence,
      method=excluded.method,
      status='fresh',
      fetched_at=excluded.fetched_at,
      expires_at=excluded.expires_at,
      last_attempt_at=excluded.last_attempt_at,
      next_retry_at=NULL,
      last_http_status=NULL,
      error=NULL,
      pending_nightly_price_usd=NULL,
      pending_seen_count=0,
      pending_first_seen_at=NULL,
      pending_last_seen_at=NULL,
      updated_at=excluded.updated_at
  `).bind(
    id,
    sourceRow?.id || null,
    best.provider,
    best.sourceURL,
    best.sourceURL,
    best.normalized.amountOriginal,
    best.normalized.currencyOriginal,
    best.normalized.priceBasis,
    best.normalized.nightlyUSD,
    best.normalized.stayTotalUSD,
    best.normalized.checkIn,
    best.normalized.checkOut,
    best.normalized.nights,
    best.normalized.adults,
    best.normalized.rooms,
    best.normalized.confidence,
    best.normalized.method,
    now,
    expiresAt,
    now,
    now,
    now
  ).run();

  return true;
}

async function markHotelPriceRefreshFailure(env, hotelID, errorCode) {
  const nowDate = new Date();
  const now = nowDate.toISOString();
  const nextRetryAt = new Date(nowDate.getTime() + HOTEL_PRICE_RETRY_MS).toISOString();
  await env.HOTELS_DB.prepare(`
    INSERT INTO hotel_price_cache (hotel_id, status, last_attempt_at, next_retry_at, error, created_at, updated_at)
    VALUES (?, 'failed', ?, ?, ?, ?, ?)
    ON CONFLICT(hotel_id) DO UPDATE SET
      status=CASE WHEN hotel_price_cache.nightly_price_usd IS NOT NULL THEN 'stale' ELSE 'failed' END,
      last_attempt_at=excluded.last_attempt_at,
      next_retry_at=excluded.next_retry_at,
      error=excluded.error,
      updated_at=excluded.updated_at
  `).bind(hotelID, now, nextRetryAt, cleanText(errorCode, 220) || 'PRICE_REFRESH_FAILED', now, now).run();
}

async function runHotelPriceMaintenance(env) {
  if (!env?.HOTELS_DB) return;
  const now = new Date().toISOString();

  const primaryTableAvailable = await primaryHotelsTableAvailable(env);
  const stalePrimaryFilter = primaryTableAvailable ? ' AND hotel_id NOT IN (SELECT hotel_id FROM primary_hotels)' : '';
  await env.HOTELS_DB.prepare(`
    UPDATE hotel_price_cache
    SET status='stale', updated_at=?
    WHERE status='fresh' AND expires_at IS NOT NULL AND expires_at<=?${stalePrimaryFilter}
  `).bind(now, now).run().catch(error => {
    console.error('HOTEL_PRICE_MAINTENANCE_MARK_STALE_FAILED', String(error?.message || error));
  });

  // Prices expire after 48h. The 15-minute cron picks up every due row on the
  // next run. Keep each pass intentionally small because Expedia may require a
  // real browser session; four hotels per pass prevents one expiry boundary from
  // exhausting Browser Run minutes. Provider failures never erase nightly_price_usd:
  // mark failure preserves the last accepted rate as stale and schedules a retry.
  let due = { results: [] };
  try {
    due = await env.HOTELS_DB.prepare(`
      SELECT h.id
      FROM hotels h
      LEFT JOIN hotel_price_sources hps ON hps.hotel_id=h.id
      LEFT JOIN hotel_price_cache hp ON hp.hotel_id=h.id
      WHERE h.status='published'
        ${primaryTableAvailable ? 'AND NOT EXISTS (SELECT 1 FROM primary_hotels p WHERE p.hotel_id=h.id)' : ''}
        AND ((hps.source_url IS NOT NULL AND hps.source_url!='') OR EXISTS (
          SELECT 1 FROM hotel_sources hs WHERE hs.hotel_id=h.id
            AND LOWER(hs.provider) IN ('booking','booking.com','expedia','expedia.com')
            AND hs.source_url IS NOT NULL AND hs.source_url!=''
        ))
        AND (
          hp.hotel_id IS NULL
          OR (hp.status='fresh' AND hp.expires_at IS NOT NULL AND hp.expires_at<=?)
          OR (hp.status IN ('stale','failed','pending') AND (hp.next_retry_at IS NULL OR hp.next_retry_at<=?))
        )
      ORDER BY
        CASE WHEN LOWER(COALESCE(hps.provider, (SELECT hs0.provider FROM hotel_sources hs0 WHERE hs0.hotel_id=h.id ORDER BY CASE WHEN LOWER(hs0.provider) IN ('expedia','expedia.com') THEN 0 ELSE 1 END, hs0.checked_at DESC LIMIT 1), '')) IN ('expedia','expedia.com') THEN 0 ELSE 1 END,
        CASE WHEN hp.nightly_price_usd IS NULL THEN 0 ELSE 1 END,
        COALESCE(hp.next_retry_at, hp.expires_at, hp.updated_at, h.updated_at) ASC
      LIMIT 4
    `).bind(now, now).all();
  } catch (error) {
    console.error('HOTEL_PRICE_MAINTENANCE_QUEUE_FAILED', String(error?.message || error));
    return;
  }

  for (const row of due.results || []) {
    const hotelID = safeID(row?.id);
    if (!hotelID) continue;
    try {
      await fetchExactHotelSourcePrice(env, hotelID, { clearManualOverride: false });
    } catch (error) {
      const code = cleanText(error?.message, 220) || 'HOTEL_PRICE_REFRESH_FAILED';
      if (code === 'HOTEL_PRICE_REFRESH_IN_PROGRESS') continue;
      console.warn('HOTEL_PRICE_BACKGROUND_REFRESH_FAILED', hotelID, code);
    }
  }
}

async function setManualHotelPrice(request, env, hotelID, user) {
  const hotel = await env.HOTELS_DB.prepare('SELECT id FROM hotels WHERE id=? LIMIT 1').bind(hotelID).first();
  if (!hotel) return json({ ok: false, error: 'HOTEL_NOT_FOUND' }, 404);
  const payload = await readJSON(request, 100_000);
  if (!payload.ok) return payload.response;
  const nightlyUSD = Number(payload.value?.nightlyUSD);
  if (!Number.isFinite(nightlyUSD) || nightlyUSD < 1 || nightlyUSD > 10_000) {
    return json({ ok: false, error: 'INVALID_HOTEL_PRICE' }, 400);
  }
  const rounded = Math.round(nightlyUSD * 100) / 100;
  const now = new Date().toISOString();
  await env.HOTELS_DB.prepare(`
    INSERT INTO hotel_price_overrides (hotel_id, nightly_price_usd, updated_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(hotel_id) DO UPDATE SET
      nightly_price_usd=excluded.nightly_price_usd,
      updated_by=excluded.updated_by,
      updated_at=excluded.updated_at
  `).bind(hotelID, rounded, cleanText(user?.login, 180) || null, now, now).run();
  const row = await readHotelPriceRow(env, hotelID);
  return json({ ok: true, price: hotelPriceFromRow(row), error: null });
}

async function clearManualHotelPrice(env, hotelID) {
  const hotel = await env.HOTELS_DB.prepare('SELECT id FROM hotels WHERE id=? LIMIT 1').bind(hotelID).first();
  if (!hotel) return json({ ok: false, error: 'HOTEL_NOT_FOUND' }, 404);
  await env.HOTELS_DB.prepare('DELETE FROM hotel_price_overrides WHERE hotel_id=?').bind(hotelID).run();
  const row = await readHotelPriceRow(env, hotelID);
  return json({ ok: true, price: hotelPriceFromRow(row), error: null });
}

function normalizedHotelPriceProvider(value, sourceURL = '') {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'booking' || raw === 'booking.com') return 'Booking';
  if (raw === 'expedia' || raw === 'expedia.com') return 'Expedia';
  try { return detectRoomProvider(new URL(sourceURL)); } catch (_) { return null; }
}

async function ensureHotelPriceSourceLock(env, hotelID) {
  const existing = await env.HOTELS_DB.prepare(`
    SELECT hps.source_id, hps.provider, hps.source_url,
           hs.canonical_url
    FROM hotel_price_sources hps
    LEFT JOIN hotel_sources hs ON hs.id=hps.source_id AND hs.hotel_id=hps.hotel_id
    WHERE hps.hotel_id=?
    LIMIT 1
  `).bind(hotelID).first().catch(() => null);

  // Expedia is the preferred pricing engine. If this hotel has an Expedia import,
  // use that property even when an older Booking lock already exists. This keeps
  // metadata provenance intact while giving price refresh one deterministic source.
  const expedia = await env.HOTELS_DB.prepare(`
    SELECT hs.id AS source_id, hs.provider, hs.source_url, hs.canonical_url
    FROM hotel_sources hs
    LEFT JOIN hotel_price_cache hp ON hp.hotel_id=hs.hotel_id
    WHERE hs.hotel_id=? AND LOWER(hs.provider) IN ('expedia','expedia.com')
      AND hs.source_url IS NOT NULL AND hs.source_url!=''
    ORDER BY CASE WHEN hp.source_id=hs.id THEN 0 WHEN hp.source_url=hs.source_url THEN 1 ELSE 2 END,
             hs.checked_at DESC
    LIMIT 1
  `).bind(hotelID).first().catch(() => null);

  let row = expedia || existing;
  if (!row?.source_url) {
    row = await env.HOTELS_DB.prepare(`
      SELECT hs.id AS source_id, hs.provider, hs.source_url, hs.canonical_url
      FROM hotel_sources hs
      LEFT JOIN hotel_price_cache hp ON hp.hotel_id=hs.hotel_id
      WHERE hs.hotel_id=? AND LOWER(hs.provider) IN ('booking','booking.com','expedia','expedia.com')
        AND hs.source_url IS NOT NULL AND hs.source_url!=''
      ORDER BY CASE WHEN LOWER(hs.provider) IN ('expedia','expedia.com') THEN 0 ELSE 1 END,
               CASE WHEN hp.source_id=hs.id THEN 0 WHEN hp.source_url=hs.source_url THEN 1 ELSE 2 END,
               hs.checked_at DESC
      LIMIT 1
    `).bind(hotelID).first();
  }
  if (!row?.source_url) return null;

  const provider = normalizedHotelPriceProvider(row.provider, row.source_url);
  if (!provider) return null;
  const now = new Date().toISOString();

  // ON CONFLICT intentionally updates an old Booking lock to Expedia when the
  // same hotel has a verified Expedia source. The property URL itself is still
  // sourced only from the imported hotel row; no name search is performed.
  await env.HOTELS_DB.prepare(`
    INSERT INTO hotel_price_sources (hotel_id, source_id, provider, source_url, locked_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(hotel_id) DO UPDATE SET
      source_id=excluded.source_id,
      provider=excluded.provider,
      source_url=excluded.source_url,
      updated_at=excluded.updated_at
  `).bind(hotelID, row.source_id, provider, row.source_url, now, now).run().catch(() => {});
  return { ...row, provider };
}

async function fetchExactHotelSourcePrice(env, hotelID, options = {}) {
  if (await isPrimaryHotel(env, hotelID)) throw new Error('PRIMARY_HOTEL_MANUAL_PRICE_ONLY');
  const token = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const leaseUntil = new Date(Date.now() + 180000).toISOString();
  const claimed = await env.HOTELS_DB.prepare(`
    INSERT INTO hotel_price_refresh_leases (hotel_id, token, expires_at)
    VALUES (?, ?, ?)
    ON CONFLICT(hotel_id) DO UPDATE SET token=excluded.token, expires_at=excluded.expires_at
    WHERE hotel_price_refresh_leases.expires_at<=?
    RETURNING token
  `).bind(hotelID, token, leaseUntil, startedAt).first();
  if (!claimed) throw new Error('HOTEL_PRICE_REFRESH_IN_PROGRESS');
  try {
    return await performHotelSourcePriceRefresh(env, hotelID, { ...options, startedAt });
  } catch (error) {
    await markHotelPriceRefreshFailure(env, hotelID, String(error?.message || 'HOTEL_PRICE_REFRESH_FAILED')).catch(() => {});
    throw error;
  } finally {
    await env.HOTELS_DB.prepare('DELETE FROM hotel_price_refresh_leases WHERE hotel_id=? AND token=?').bind(hotelID, token).run();
  }
}

function expediaPriceEvidenceIsStrongEnoughForImmediateMove(provider, page, extracted) {
  if (provider !== 'Expedia') return false;
  const confidence = Number(extracted?.confidence || 0);
  const method = String(extracted?.method || '');
  if (confidence < 0.97) return false;

  // These paths are already protected by the exact Expedia .h<propertyID>
  // validation in extractPage(). Requiring a second read after a large seasonal
  // price move made legitimate changes (for example $87 -> ~$190) look like a
  // failed refresh. Strong exact-property Expedia evidence is accepted on the
  // first read; weaker/generic extraction still keeps the two-hit safety guard.
  if (method === 'expedia-property-faq-rolling-30d') return true;
  if (method === 'expedia-property-faq-nightly') return true;
  if (method === 'expedia-explicit-nightly' && confidence >= 0.99) return true;
  if (method === 'expedia-price-lockup-one-night' && confidence >= 0.99) return true;
  if (page?.transport === 'browser' && method === 'expedia-browser-any-room' && confidence >= 0.90) return true;
  return false;
}

async function performHotelSourcePriceRefresh(env, hotelID, options = {}) {
  const source = await ensureHotelPriceSourceLock(env, hotelID);
  if (!source?.source_url) throw new Error('HOTEL_PRICE_SOURCE_MISSING');
  const sourceURL = cleanURL(source.source_url);
  if (!sourceURL) throw new Error('HOTEL_PRICE_SOURCE_INVALID');
  const provider = normalizedHotelPriceProvider(source.provider, sourceURL);
  if (!provider) throw new Error('HOTEL_PRICE_SOURCE_UNSUPPORTED');

  // Keep the imported source URL as provenance, but price from the canonical
  // property page whenever the imported Expedia/Booking link is opaque (for
  // example expe.onelink.me). safePropertyKey deliberately does not throw here.
  let priceURL = sourceURL;
  const lockedPropertyKey = safePropertyKey(sourceURL, provider);
  if (!lockedPropertyKey && source.canonical_url && safePropertyKey(source.canonical_url, provider)) {
    priceURL = source.canonical_url;
  }
  if (!safePropertyKey(priceURL, provider)) throw new Error('HOTEL_PRICE_SOURCE_PROPERTY_MISMATCH');
  const page = await obtainHotelPrice(env, priceURL, provider);
  const { quote, extracted, finalURL } = page;

  const nowDate = new Date();
  const now = nowDate.toISOString();
  const expiresAt = new Date(nowDate.getTime() + HOTEL_PRICE_TTL_MS).toISOString();
  const previous = await env.HOTELS_DB.prepare('SELECT * FROM hotel_price_cache WHERE hotel_id=? LIMIT 1').bind(hotelID).first();
  const largeMoveNeedsConfirmation = hotelPriceMoveNeedsConfirmation(previous?.nightly_price_usd, extracted.nightlyUSD)
    && !expediaPriceEvidenceIsStrongEnoughForImmediateMove(provider, page, extracted);
  if (largeMoveNeedsConfirmation) {
    const count = hotelPriceCandidatesMatch(previous?.pending_nightly_price_usd, extracted.nightlyUSD)
      ? Number(previous.pending_seen_count || 0) + 1 : 1;
    if (count < 2) {
      await env.HOTELS_DB.prepare(`
        UPDATE hotel_price_cache SET status='stale', pending_nightly_price_usd=?, pending_seen_count=1,
          pending_first_seen_at=?, pending_last_seen_at=?, last_attempt_at=?, next_retry_at=?,
          error='PRICE_CHANGE_AWAITING_CONFIRMATION', updated_at=? WHERE hotel_id=?
      `).bind(extracted.nightlyUSD, now, now, now,
        new Date(nowDate.getTime() + HOTEL_PRICE_RETRY_MS).toISOString(), now, hotelID).run();
      return readHotelPriceRow(env, hotelID);
    }
  }

  await env.HOTELS_DB.prepare(`
    INSERT INTO hotel_price_cache (
      hotel_id, source_id, provider, source_url, resolved_url,
      amount_original, currency_original, price_basis, nightly_price_usd, quote_total_usd,
      quote_check_in, quote_check_out, quote_nights, quote_adults, quote_rooms,
      confidence, method, status, fetched_at, expires_at, last_attempt_at, next_retry_at,
      last_http_status, error, pending_nightly_price_usd, pending_seen_count,
      pending_first_seen_at, pending_last_seen_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'fresh', ?, ?, ?, NULL, ?, NULL, NULL, 0, NULL, NULL, ?, ?)
    ON CONFLICT(hotel_id) DO UPDATE SET
      source_id=excluded.source_id,
      provider=excluded.provider,
      source_url=excluded.source_url,
      resolved_url=excluded.resolved_url,
      amount_original=excluded.amount_original,
      currency_original=excluded.currency_original,
      price_basis=excluded.price_basis,
      nightly_price_usd=excluded.nightly_price_usd,
      quote_total_usd=excluded.quote_total_usd,
      quote_check_in=excluded.quote_check_in,
      quote_check_out=excluded.quote_check_out,
      quote_nights=excluded.quote_nights,
      quote_adults=excluded.quote_adults,
      quote_rooms=excluded.quote_rooms,
      confidence=excluded.confidence,
      method=excluded.method,
      status='fresh',
      fetched_at=excluded.fetched_at,
      expires_at=excluded.expires_at,
      last_attempt_at=excluded.last_attempt_at,
      next_retry_at=NULL,
      last_http_status=excluded.last_http_status,
      error=NULL,
      pending_nightly_price_usd=NULL,
      pending_seen_count=0,
      pending_first_seen_at=NULL,
      pending_last_seen_at=NULL,
      updated_at=excluded.updated_at
  `).bind(
    hotelID,
    source.source_id || null,
    provider,
    sourceURL,
    finalURL,
    extracted.amount,
    extracted.currency,
    extracted.priceBasis,
    extracted.nightlyUSD,
    extracted.stayTotalUSD,
    quote.checkIn,
    quote.checkOut,
    quote.nights,
    quote.adults,
    quote.rooms,
    extracted.confidence,
    `${page.transport}:${extracted.method}`,
    now,
    expiresAt,
    now,
    page.httpStatus,
    now,
    now
  ).run();

  // Only an explicit admin action is allowed to remove a manual override.
  // Scheduled source refreshes keep the manual value active while refreshing
  // the underlying source snapshot in the background.
  if (options.clearManualOverride === true) {
    await env.HOTELS_DB.prepare('DELETE FROM hotel_price_overrides WHERE hotel_id=? AND updated_at<=?').bind(hotelID, options.startedAt).run();
  }
  return readHotelPriceRow(env, hotelID);
}

function bookingHotelIdentityKey(value) {
  try {
    const url = new URL(String(value || ''));
    const host = url.hostname.toLowerCase();
    if (!(host === 'booking.com' || host.endsWith('.booking.com'))) return null;
    const match = url.pathname.match(/^\/hotel\/([^/]+)\/([^/?#]+?)(?:\.html)?\/?$/i);
    if (!match) return null;
    // Booking often redirects between localized filenames such as hotel-name.ru.html,
    // hotel-name.en-gb.html and hotel-name.html. They are the same property path.
    const slug = String(match[2] || '').replace(/\.(?:[a-z]{2}(?:-[a-z]{2})?)$/i, '');
    return `${match[1]}|${slug}`.toLowerCase();
  } catch (_) {
    return null;
  }
}

async function saveBrowserHotelPrice(request, env, hotelID) {
  const hotel = await env.HOTELS_DB.prepare('SELECT id FROM hotels WHERE id=? LIMIT 1').bind(hotelID).first();
  if (!hotel) return json({ ok: false, price: null, error: 'HOTEL_NOT_FOUND' }, 404);
  if (await isPrimaryHotel(env, hotelID)) return json({ ok: false, price: null, error: 'PRIMARY_HOTEL_MANUAL_PRICE_ONLY' }, 409);

  let payload;
  try { payload = await request.json(); }
  catch { return json({ ok: false, price: null, error: 'INVALID_JSON' }, 400); }

  const snapshot = payload?.price;
  const normalized = normalizeImportedHotelPriceSnapshot(snapshot);
  if (!normalized) return json({ ok: false, price: null, error: 'HOTEL_BROWSER_PRICE_INVALID' }, 422);

  const source = await ensureHotelPriceSourceLock(env, hotelID);
  if (!source?.source_url) return json({ ok: false, price: null, error: 'HOTEL_PRICE_SOURCE_MISSING' }, 409);
  const provider = normalizedHotelPriceProvider(source.provider, source.source_url);
  if (provider !== 'Booking') return json({ ok: false, price: null, error: 'HOTEL_BROWSER_PRICE_BOOKING_ONLY' }, 409);
  if (normalized.currencyOriginal !== 'USD') {
    return json({ ok: false, price: null, error: 'HOTEL_BROWSER_PRICE_USD_REQUIRED' }, 422);
  }

  const browserSourceURL = cleanURL(payload?.sourceURL);
  if (!browserSourceURL) return json({ ok: false, price: null, error: 'HOTEL_BROWSER_SOURCE_INVALID' }, 422);
  let parsedBrowserSource;
  try { parsedBrowserSource = new URL(browserSourceURL); }
  catch { return json({ ok: false, price: null, error: 'HOTEL_BROWSER_SOURCE_INVALID' }, 422); }
  if (!providerRoomHostAllowed(parsedBrowserSource, 'Booking')) {
    return json({ ok: false, price: null, error: 'HOTEL_BROWSER_SOURCE_MISMATCH' }, 422);
  }

  // When both URLs expose a concrete /hotel/<cc>/<slug> identity they must match.
  // Share/interstitial URLs intentionally have no identity key and therefore do not
  // block a verified browser snapshot from the same Booking provider.
  const lockedKey = bookingHotelIdentityKey(source.source_url);
  const browserKey = bookingHotelIdentityKey(browserSourceURL);
  if (lockedKey && browserKey && lockedKey !== browserKey) {
    return json({ ok: false, price: null, error: 'HOTEL_BROWSER_PROPERTY_MISMATCH' }, 409);
  }

  const nowDate = new Date();
  const now = nowDate.toISOString();
  const expiresAt = new Date(nowDate.getTime() + HOTEL_PRICE_TTL_MS).toISOString();
  const method = cleanText(normalized.method, 160) || 'booking-browser-live-price';

  await env.HOTELS_DB.prepare(`
    INSERT INTO hotel_price_cache (
      hotel_id, source_id, provider, source_url, resolved_url,
      amount_original, currency_original, price_basis, nightly_price_usd, quote_total_usd,
      quote_check_in, quote_check_out, quote_nights, quote_adults, quote_rooms,
      confidence, method, status, fetched_at, expires_at, last_attempt_at, next_retry_at,
      last_http_status, error, pending_nightly_price_usd, pending_seen_count,
      pending_first_seen_at, pending_last_seen_at, created_at, updated_at
    ) VALUES (?, ?, 'Booking', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'fresh', ?, ?, ?, NULL, 200, NULL, NULL, 0, NULL, NULL, ?, ?)
    ON CONFLICT(hotel_id) DO UPDATE SET
      source_id=excluded.source_id,
      provider='Booking',
      source_url=excluded.source_url,
      resolved_url=excluded.resolved_url,
      amount_original=excluded.amount_original,
      currency_original=excluded.currency_original,
      price_basis=excluded.price_basis,
      nightly_price_usd=excluded.nightly_price_usd,
      quote_total_usd=excluded.quote_total_usd,
      quote_check_in=excluded.quote_check_in,
      quote_check_out=excluded.quote_check_out,
      quote_nights=excluded.quote_nights,
      quote_adults=excluded.quote_adults,
      quote_rooms=excluded.quote_rooms,
      confidence=excluded.confidence,
      method=excluded.method,
      status='fresh',
      fetched_at=excluded.fetched_at,
      expires_at=excluded.expires_at,
      last_attempt_at=excluded.last_attempt_at,
      next_retry_at=NULL,
      last_http_status=200,
      error=NULL,
      pending_nightly_price_usd=NULL,
      pending_seen_count=0,
      pending_first_seen_at=NULL,
      pending_last_seen_at=NULL,
      updated_at=excluded.updated_at
  `).bind(
    hotelID,
    source.source_id || null,
    source.source_url,
    browserSourceURL,
    normalized.amountOriginal,
    normalized.currencyOriginal,
    normalized.priceBasis,
    normalized.nightlyUSD,
    normalized.stayTotalUSD,
    normalized.checkIn,
    normalized.checkOut,
    normalized.nights,
    normalized.adults,
    normalized.rooms,
    normalized.confidence,
    method,
    now,
    expiresAt,
    now,
    now,
    now
  ).run();

  // "Update from source" is an explicit admin action: a successful live Booking
  // snapshot replaces any manual override, matching the existing refresh contract.
  await env.HOTELS_DB.prepare('DELETE FROM hotel_price_overrides WHERE hotel_id=?').bind(hotelID).run();
  const row = await readHotelPriceRow(env, hotelID);
  return json({ ok: true, price: hotelPriceFromRow(row), error: null });
}

async function refreshHotelPriceResponse(env, hotelID) {
  const hotel = await env.HOTELS_DB.prepare('SELECT id FROM hotels WHERE id=? LIMIT 1').bind(hotelID).first();
  if (!hotel) return json({ ok: false, refreshed: false, changed: false, price: null, error: 'HOTEL_NOT_FOUND' }, 404);
  if (await isPrimaryHotel(env, hotelID)) {
    const row = await readHotelPriceRow(env, hotelID);
    return json({ ok: false, refreshed: false, changed: false, price: hotelPriceFromRow(row, { manualOnly: true }), error: 'PRIMARY_HOTEL_MANUAL_PRICE_ONLY' }, 409);
  }

  // The button has a strict semantic contract: `ok/refreshed=true` means this
  // request really obtained a new live provider snapshot and persisted it. A
  // stale cached amount may still be returned for continuity, but it is never
  // reported as a successful refresh.
  const beforeRow = await readHotelPriceRow(env, hotelID);
  const beforePrice = hotelPriceFromRow(beforeRow);
  const beforeSourceNightly = Number(beforePrice?.sourceNightlyUSD);
  const beforeFetchedAt = beforePrice?.fetchedAt || null;

  try {
    const row = await fetchExactHotelSourcePrice(env, hotelID, { clearManualOverride: true });
    const current = hotelPriceFromRow(row);
    const sourceNightly = Number(current?.sourceNightlyUSD);
    const rowError = cleanText(row?.price_error, 220) || null;
    const persistedFreshSnapshot = row?.price_status === 'fresh'
      && !rowError
      && Number.isFinite(sourceNightly)
      && sourceNightly > 0
      && !!current?.fetchedAt;

    if (!persistedFreshSnapshot) {
      const code = rowError || 'HOTEL_PRICE_REFRESH_NOT_CONFIRMED';
      console.warn('HOTEL_PRICE_ADMIN_REFRESH_NOT_CONFIRMED', hotelID, code);
      return json({ ok: false, refreshed: false, changed: false, price: current, error: code }, 200);
    }

    const changed = Number.isFinite(beforeSourceNightly)
      && beforeSourceNightly > 0
      && Math.abs(beforeSourceNightly - sourceNightly) >= 0.01;
    console.log('HOTEL_PRICE_ADMIN_REFRESH_OK', hotelID, current?.provider || null, sourceNightly, changed ? 'changed' : 'confirmed');
    return json({ ok: true, refreshed: true, changed, price: current, error: null }, 200);
  } catch (error) {
    const code = cleanText(error?.message, 220) || 'HOTEL_PRICE_REFRESH_FAILED';
    if (code === 'HOTEL_PRICE_REFRESH_IN_PROGRESS') {
      return json({ ok: false, refreshed: false, changed: false, price: hotelPriceFromRow(await readHotelPriceRow(env, hotelID)), error: code }, 409);
    }
    console.warn('HOTEL_PRICE_ADMIN_REFRESH_FAILED', hotelID, code);
    const fallback = hotelPriceFromRow(await readHotelPriceRow(env, hotelID));
    // Provider availability, anti-bot challenges and temporary browser/network
    // failures are valid business outcomes for a refresh attempt. Return them as
    // a decodable 200 response so iumrah Business can explicitly show that the
    // last accepted price was preserved rather than claiming success.
    const expectedSourceFailure = [
      /^HOTEL_PRICE_SOURCE_HTTP_\d+$/,
      /^HOTEL_PRICE_NOT_FOUND_ON_SOURCE$/,
      /^HOTEL_PRICE_SOURCE_CHALLENGE$/,
      /^HOTEL_PRICE_BROWSER_UNAVAILABLE$/,
      /^HOTEL_PRICE_SOURCE_EMPTY$/,
      /^HOTEL_PRICE_SOURCE_PROPERTY_MISMATCH$/,
      /^HOTEL_PRICE_SOURCE_(?:BAD_REDIRECT|REDIRECT_LIMIT|REDIRECT_MISMATCH)$/
    ].some(pattern => pattern.test(code));
    const status = expectedSourceFailure ? 200 : (code === 'HOTEL_PRICE_SOURCE_MISSING' ? 409 : 502);
    return json({ ok: false, refreshed: false, changed: false, price: fallback, error: code }, status);
  }
}

async function health(env, admin) {
  const row = await env.HOTELS_DB.prepare(
    admin
      ? 'SELECT COUNT(*) AS count FROM hotels'
      : "SELECT COUNT(*) AS count FROM hotels WHERE status = 'published'"
  ).first();

  let bookingsDbReady = false;
  let sourceBookings = 0;
  if (env.BOOKINGS_DB) {
    try {
      const bookings = await env.BOOKINGS_DB.prepare('SELECT COUNT(*) AS count FROM bookings').first();
      sourceBookings = Number(bookings?.count || 0);
      bookingsDbReady = true;
    } catch (error) {
      console.error('BOOKINGS_DB_HEALTH_FAILED', error);
    }
  }

  return json({
    ok: bookingsDbReady,
    database: 'iumrah-hotels',
    storage: 'iumrah-hotels-media',
    hotels: Number(row?.count || 0),
    bookingsDbReady,
    sourceBookings
  }, bookingsDbReady ? 200 : 503, PUBLIC_CACHE_HEADERS);
}

async function listHotels(env, url, publishedOnly) {
  const city = canonicalCity(url.searchParams.get('city'));
  const values = [];
  const where = [];

  if (publishedOnly) where.push("h.status = 'published'");
  if (city) {
    where.push('LOWER(h.city) = LOWER(?)');
    values.push(city);
  }

  const sql = `
    SELECT
      h.id,
      h.name,
      h.city,
      h.address,
      h.latitude,
      h.longitude,
      h.stars,
      h.rating,
      h.review_count,
      h.status,
      h.lifecycle_state,
      h.updated_at,
      hps.provider AS locked_source_provider,
      hps.source_url AS locked_source_url,
      (SELECT hs.city FROM hotel_sources hs WHERE hs.hotel_id=h.id AND hs.city IS NOT NULL AND hs.city!='' ORDER BY hs.checked_at DESC LIMIT 1) AS source_city_hint,
      (SELECT hs.address FROM hotel_sources hs WHERE hs.hotel_id=h.id AND hs.address IS NOT NULL AND hs.address!='' ORDER BY hs.checked_at DESC LIMIT 1) AS source_address_hint,
      (SELECT hs.latitude FROM hotel_sources hs WHERE hs.hotel_id=h.id AND hs.latitude IS NOT NULL ORDER BY hs.checked_at DESC LIMIT 1) AS source_latitude_hint,
      (SELECT hs.longitude FROM hotel_sources hs WHERE hs.hotel_id=h.id AND hs.longitude IS NOT NULL ORDER BY hs.checked_at DESC LIMIT 1) AS source_longitude_hint,
      ${HOTEL_PRICE_SELECT},
      (SELECT COUNT(*) FROM hotel_images hi WHERE hi.hotel_id = h.id) AS image_count,
      (SELECT COUNT(*) FROM hotel_rooms hr WHERE hr.hotel_id = h.id) AS room_count,
      (
        SELECT hi.id
        FROM hotel_images hi
        WHERE hi.hotel_id = h.id
        ORDER BY hi.is_cover DESC, hi.position ASC, hi.created_at ASC
        LIMIT 1
      ) AS cover_image_id
    FROM hotels h
    LEFT JOIN hotel_price_cache hp ON hp.hotel_id = h.id
    LEFT JOIN hotel_price_overrides hpo ON hpo.hotel_id = h.id
    LEFT JOIN hotel_price_sources hps ON hps.hotel_id = h.id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY
      CASE LOWER(h.city) WHEN 'makkah' THEN 0 WHEN 'madinah' THEN 1 ELSE 2 END,
      h.name COLLATE NOCASE ASC
    LIMIT 500
  `;

  const result = await env.HOTELS_DB.prepare(sql).bind(...values).all();
  const hotels = (result.results || []).map(row => hotelSummary(row, !publishedOnly, { publicUsablePrice: publishedOnly }));
  return json({ hotels }, 200, publishedOnly ? PUBLIC_CACHE_HEADERS : undefined);
}

async function updateHotelAdmin(request, env, hotelID) {
  const payload = await readJSON(request, 100_000);
  if (!payload.ok) return payload.response;

  const existing = await env.HOTELS_DB.prepare('SELECT id, city FROM hotels WHERE id=? LIMIT 1').bind(hotelID).first();
  if (!existing) return json({ ok: false, error: 'HOTEL_NOT_FOUND' }, 404);

  const body = payload.value && typeof payload.value === 'object' ? payload.value : {};
  const hasStars = Object.prototype.hasOwnProperty.call(body, 'stars');
  const hasCity = Object.prototype.hasOwnProperty.call(body, 'city');
  if (!hasStars && !hasCity) {
    return json({ ok: false, error: 'HOTEL_UPDATE_REQUIRED' }, 400);
  }

  let stars = null;
  if (hasStars) {
    stars = Number(body.stars);
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
      return json({ ok: false, error: 'INVALID_HOTEL_STARS' }, 400);
    }
  }

  let city = null;
  if (hasCity) {
    city = detectUmrahCity(body.city);
    if (city !== 'Makkah' && city !== 'Madinah') {
      return json({ ok: false, error: 'INVALID_HOTEL_CITY' }, 400);
    }
  }

  const now = new Date().toISOString();
  if (hasStars && hasCity) {
    await env.HOTELS_DB.prepare('UPDATE hotels SET stars=?, city=?, updated_at=? WHERE id=?')
      .bind(stars, city, now, hotelID).run();
  } else if (hasStars) {
    await env.HOTELS_DB.prepare('UPDATE hotels SET stars=?, updated_at=? WHERE id=?')
      .bind(stars, now, hotelID).run();
  } else {
    await env.HOTELS_DB.prepare('UPDATE hotels SET city=?, updated_at=? WHERE id=?')
      .bind(city, now, hotelID).run();
  }

  if (hasCity && canonicalCity(existing.city) !== city) {
    // An editorial Primary assignment under the old city is no longer valid.
    // Remove only this hotel's mismatched assignment; do not reshuffle any other slot.
    await env.HOTELS_DB.prepare('DELETE FROM primary_hotels WHERE hotel_id=? AND LOWER(city)<>LOWER(?)')
      .bind(hotelID, city).run();
  }

  // Source snapshots remain untouched as import evidence. The canonical hotels row
  // is the single value read by the public catalog and package generator.
  return hotelDetail(env, hotelID, true);
}

async function hotelDetail(env, hotelID, admin, url = null) {
  const hotel = await env.HOTELS_DB.prepare(
    `SELECT * FROM hotels WHERE id = ? ${admin ? '' : "AND status = 'published'"}`
  ).bind(hotelID).first();

  if (!hotel) return json({ ok: false, error: 'HOTEL_NOT_FOUND' }, 404);

  const [amenitiesResult, roomsResult, imagesResult, sourcesResult, priceRow] = await Promise.all([
    env.HOTELS_DB.prepare('SELECT amenity FROM hotel_amenities WHERE hotel_id = ? ORDER BY position ASC, amenity ASC').bind(hotelID).all(),
    env.HOTELS_DB.prepare('SELECT id, name, max_guests, size_m2, beds, view, description, amenities_json, smoking, accessibility_json, category, bathroom_json FROM hotel_rooms WHERE hotel_id = ? ORDER BY position ASC, name ASC').bind(hotelID).all(),
    env.HOTELS_DB.prepare('SELECT id, source_provider, category, label, room_name, position, is_cover, width, height, byte_size, original_byte_size, content_type, transform_version FROM hotel_images WHERE hotel_id = ? ORDER BY is_cover DESC, position ASC, created_at ASC').bind(hotelID).all(),
    admin
      ? env.HOTELS_DB.prepare('SELECT * FROM hotel_sources WHERE hotel_id = ? ORDER BY provider ASC').bind(hotelID).all()
      : Promise.resolve({ results: [] }),
    readHotelPriceRow(env, hotelID)
  ]);

  const images = (imagesResult.results || []).map(row => ({
    id: row.id,
    provider: row.source_provider,
    category: row.category || 'gallery',
    label: row.label || null,
    roomName: row.room_name || null,
    position: Number(row.position || 0),
    isCover: Number(row.is_cover || 0) === 1,
    width: row.width == null ? null : Number(row.width),
    height: row.height == null ? null : Number(row.height),
    byteSize: Number(row.byte_size || 0),
    originalByteSize: Number(row.original_byte_size || 0),
    contentType: row.content_type || 'image/webp',
    transformVersion: row.transform_version || null,
    url: publicImagePath(hotelID, row.id)
  }));

  const detail = {
    id: hotel.id,
    name: hotel.name,
    city: hotel.city,
    country: hotel.country,
    propertyType: hotel.property_type || null,
    brand: hotel.brand || null,
    chain: hotel.chain_name || null,
    postalCode: hotel.postal_code || null,
    stars: hotel.stars == null ? null : Number(hotel.stars),
    rating: hotel.rating == null ? null : Number(hotel.rating),
    ratingScale: hotel.rating_scale == null ? null : Number(hotel.rating_scale),
    reviewCount: hotel.review_count == null ? null : Number(hotel.review_count),
    address: hotel.address || '',
    description: hotel.description || '',
    latitude: hotel.latitude == null ? null : Number(hotel.latitude),
    longitude: hotel.longitude == null ? null : Number(hotel.longitude),
    checkIn: hotel.check_in || null,
    checkOut: hotel.check_out || null,
    policies: parseJSONArray(hotel.policies_json),
    nearby: parseJSONArray(hotel.nearby_json),
    facts: parseJSONArray(hotel.facts_json),
    fees: parseJSONArray(hotel.fees_json),
    services: parseJSONArray(hotel.services_json),
    highlights: parseJSONArray(hotel.highlights_json),
    importantInformation: parseJSONArray(hotel.important_information_json),
    food: parseJSONArray(hotel.food_json),
    parkingTransport: parseJSONArray(hotel.parking_transport_json),
    accessibility: parseJSONArray(hotel.accessibility_json),
    googleMapsURL: hotel.google_maps_url || googleMapsURL(hotel.latitude, hotel.longitude, hotel.address),
    canonicalKey: hotel.canonical_key || null,
    status: hotel.status,
    lifecycleState: hotel.lifecycle_state || hotel.status,
    dataQuality: parseJSONObject(hotel.data_quality_json),
    lastVerifiedAt: hotel.last_verified_at || null,
    amenities: (amenitiesResult.results || []).map(row => row.amenity),
    rooms: (roomsResult.results || []).map(row => ({
      id: row.id,
      name: row.name,
      maxGuests: row.max_guests == null ? null : Number(row.max_guests),
      sizeM2: row.size_m2 == null ? null : Number(row.size_m2),
      beds: row.beds,
      view: row.view,
      description: row.description || null,
      amenities: parseJSONArray(row.amenities_json),
      smoking: row.smoking || null,
      accessibility: parseJSONArray(row.accessibility_json),
      category: row.category || null,
      bathroom: parseJSONArray(row.bathroom_json)
    })),
    images,
    price: hotelPriceFromRow(priceRow, { publicUsable: !admin }),
    sources: admin ? (sourcesResult.results || []).map(sourceRow) : [],
    createdAt: hotel.created_at,
    updatedAt: hotel.updated_at
  };

  if (!admin && url) {
    const requestedLocale = normalizeLocale(url.searchParams.get('locale') || 'en');
    if (requestedLocale && requestedLocale !== 'en') {
      try {
        const source = await hotelDataForTranslation(env, hotelID);
        if (source) {
          const translated = await getOrCreateHotelTranslation(env, hotelID, requestedLocale, source);
          applyHotelTranslation(detail, translated.translation);
          detail.locale = requestedLocale;
          detail.translationStatus = translated.cached ? 'cached' : 'generated';
        }
      } catch (error) {
        console.error('HOTEL_DETAIL_TRANSLATION_FAILED', { hotelID, locale: requestedLocale, error: String(error?.message || error) });
        detail.locale = 'en';
        detail.translationStatus = 'fallback';
      }
    } else {
      detail.locale = 'en';
      detail.translationStatus = 'canonical';
    }
  }

  return json({ ok: true, hotel: detail }, 200, admin ? undefined : PUBLIC_CACHE_HEADERS);
}

function applyHotelTranslation(detail, translated) {
  if (!translated || typeof translated !== 'object') return detail;
  const fields = [
    'propertyType','address','description','checkIn','checkOut','amenities','policies',
    'nearby','facts','fees','services','highlights','importantInformation','food',
    'parkingTransport','accessibility','rooms'
  ];
  for (const field of fields) {
    if (translated[field] != null) detail[field] = translated[field];
  }
  return detail;
}

async function saveHotel(request, env, user) {
  const payload = await readJSON(request, 4_000_000);
  if (!payload.ok) return payload.response;

  // Direct admin saves are always server-side drafts. Publishing is reserved for
  // the import workflow after media/data integrity checks have completed.
  const safeDraft = { ...(payload.value || {}), status: 'draft', lifecycleState: 'draft' };
  const allowPossibleDuplicate = request.headers.get('x-iumrah-allow-possible-duplicate') === '1';
  const duplicate = await findDuplicateHotel(env, safeDraft, safeID(safeDraft.id));
  if (duplicate?.certainty === 'definitive') return json({ ok: false, error: 'HOTEL_ALREADY_EXISTS', duplicate }, 409);
  if (duplicate?.certainty === 'possible' && !allowPossibleDuplicate) return json({ ok: false, error: 'POSSIBLE_DUPLICATE', duplicate }, 409);
  const result = await persistHotelDraft(safeDraft, env, user, { checkDuplicate: false });
  if (!result.ok) return result.response;
  return json({ ok: true, hotel: result.hotel }, 200);
}

async function persistHotelDraft(draft, env, user, options = {}) {
  const id = safeID(draft?.id);
  const name = cleanText(draft?.name, 180);
  const city = resolveHotelCityDraft(draft);

  if (!id || !name || !city) {
    return { ok: false, response: json({ ok: false, error: 'INVALID_HOTEL_PAYLOAD' }, 400) };
  }

  if (options.checkDuplicate) {
    const duplicate = await findDuplicateHotel(env, draft, id);
    if (duplicate) {
      return {
        ok: false,
        duplicate,
        response: json({ ok: false, error: 'HOTEL_ALREADY_EXISTS', duplicate }, 409)
      };
    }
  }

  const country = cleanText(draft.country, 120) || 'Saudi Arabia';
  const propertyType = safeHumanText(draft.propertyType, 120);
  const stars = nullableInteger(draft.stars, 1, 5);
  const rating = nullableNumber(draft.rating, 0, 10);
  const ratingScale = nullableNumber(draft.ratingScale, 1, 10);
  const reviewCount = nullableInteger(draft.reviewCount, 0, 100000000);
  const address = safeHumanText(draft.address, 900) || '';
  const description = safeHumanText(draft.description, 3_500) || '';
  const latitude = nullableNumber(draft.latitude, -90, 90);
  const longitude = nullableNumber(draft.longitude, -180, 180);
  const checkIn = safeHumanText(draft.checkIn, 120);
  const checkOut = safeHumanText(draft.checkOut, 120);
  const policies = []; // provider policies are intentionally not part of the core catalog
  const nearby = safeObjectArray(draft.nearby, 24, 24_000);
  const facts = []; // noisy provider facts are omitted from the canonical selection object
  const fees = [];
  const services = []; // canonical amenities are stored in hotel_amenities
  const brand = safeHumanText(draft.brand, 180);
  const chainName = safeHumanText(draft.chain, 180) || safeHumanText(draft.chainName, 180);
  const postalCode = safeHumanText(draft.postalCode, 40);
  const highlights = uniqueStrings(draft.highlights, 16, 420);
  const importantInformation = [];
  const food = safeObjectArray(draft.food, 16, 24_000);
  const parkingTransport = safeObjectArray(draft.parkingTransport, 16, 24_000);
  const accessibility = uniqueStrings(draft.accessibility, 16, 360);
  const dataQuality = sanitizeObject(draft.dataQuality, 24_000);
  const googleMaps = cleanURL(draft.googleMapsURL) || googleMapsURL(latitude, longitude, address);
  const canonicalKey = canonicalHotelKey(name, city, address, latitude, longitude);
  // Persisting code never elevates an incoming payload to published. The workflow
  // is the only publication authority.
  const status = draft.status === 'archived' ? 'archived' : 'draft';
  const lifecycleState = cleanLifecycleState(draft.lifecycleState) || (status === 'archived' ? 'archived' : 'draft');
  const slug = await uniqueSlug(env, id, `${name}-${city}`);
  const now = new Date().toISOString();

  const statements = [
    env.HOTELS_DB.prepare(`
      INSERT INTO hotels (
        id, slug, name, city, country, property_type, stars, rating, rating_scale,
        review_count, address, description, latitude, longitude, check_in, check_out,
        policies_json, canonical_key, google_maps_url, nearby_json, facts_json, fees_json,
        services_json, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        city = excluded.city,
        country = excluded.country,
        property_type = excluded.property_type,
        stars = excluded.stars,
        rating = excluded.rating,
        rating_scale = excluded.rating_scale,
        review_count = excluded.review_count,
        address = excluded.address,
        description = excluded.description,
        latitude = excluded.latitude,
        longitude = excluded.longitude,
        check_in = excluded.check_in,
        check_out = excluded.check_out,
        policies_json = excluded.policies_json,
        canonical_key = excluded.canonical_key,
        google_maps_url = excluded.google_maps_url,
        nearby_json = excluded.nearby_json,
        facts_json = excluded.facts_json,
        fees_json = excluded.fees_json,
        services_json = excluded.services_json,
        status = excluded.status,
        updated_at = excluded.updated_at
    `).bind(
      id, slug, name, city, country, propertyType, stars, rating, ratingScale, reviewCount,
      address, description, latitude, longitude, checkIn, checkOut, JSON.stringify(policies),
      canonicalKey, googleMaps, JSON.stringify(nearby), JSON.stringify(facts), JSON.stringify(fees),
      JSON.stringify(services), status, now, now
    ),
    env.HOTELS_DB.prepare('DELETE FROM hotel_amenities WHERE hotel_id = ?').bind(id),
    env.HOTELS_DB.prepare('DELETE FROM hotel_rooms WHERE hotel_id = ?').bind(id),
    env.HOTELS_DB.prepare('DELETE FROM hotel_sources WHERE hotel_id = ?').bind(id),
    env.HOTELS_DB.prepare('DELETE FROM hotel_translations WHERE hotel_id = ?').bind(id)
  ];

  const amenities = canonicalAmenities(draft.amenities, 120);
  amenities.forEach((amenity, index) => {
    statements.push(
      env.HOTELS_DB.prepare('INSERT INTO hotel_amenities (hotel_id, amenity, position) VALUES (?, ?, ?)')
        .bind(id, amenity, index)
    );
  });

  const rooms = Array.isArray(draft.rooms) ? draft.rooms.slice(0, 200) : [];
  rooms.forEach((room, index) => {
    const roomID = safeID(room?.id) || crypto.randomUUID();
    const roomName = cleanText(room?.name, 240);
    if (!roomName || !isPlausibleRoomName(roomName)) return;
    statements.push(
      env.HOTELS_DB.prepare(`
        INSERT INTO hotel_rooms (
          id, hotel_id, name, max_guests, size_m2, beds, view, description, amenities_json,
          smoking, accessibility_json, category, bathroom_json, position
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        roomID,
        id,
        roomName,
        nullableInteger(room?.maxGuests, 1, 30),
        nullableNumber(room?.sizeM2, 1, 3000),
        safeHumanText(room?.beds, 300),
        safeHumanText(room?.view, 300),
        safeHumanText(room?.description, 1200),
        JSON.stringify(uniqueStrings(room?.amenities, 60, 180)),
        safeHumanText(room?.smoking, 160),
        JSON.stringify(uniqueStrings(room?.accessibility, 24, 220)),
        safeHumanText(room?.category, 160),
        JSON.stringify(uniqueStrings(room?.bathroom, 24, 220)),
        index
      )
    );
  });

  const sources = Array.isArray(draft.sources) ? draft.sources.slice(0, 10) : [];
  sources.forEach(source => {
    const sourceURL = cleanURL(source?.sourceURL);
    const provider = cleanText(source?.provider, 80);
    if (!sourceURL || !provider) return;
    const sourceNearby = safeObjectArray(source?.nearby, 220, 64_000);
    const sourceFacts = safeObjectArray(source?.facts, 420, 160_000);
    const sourceFees = safeObjectArray(source?.fees, 220, 80_000);
    const sourceServices = uniqueStrings(source?.services, 300, 240);
    statements.push(
      env.HOTELS_DB.prepare(`
        INSERT INTO hotel_sources (
          id, hotel_id, provider, source_url, source_name, city, country, property_type,
          address, description, stars, rating, rating_scale, review_count, latitude, longitude,
          check_in, check_out, images_json, amenities_json, room_names_json, room_details_json,
          policies_json, provider_hotel_id, canonical_url, google_maps_url, nearby_json, facts_json,
          fees_json, services_json, checked_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        safeID(source?.id) || crypto.randomUUID(),
        id,
        provider,
        sourceURL,
        safeHumanText(source?.name, 300),
        canonicalCity(source?.city) || cleanText(source?.city, 80),
        safeHumanText(source?.country, 120),
        safeHumanText(source?.propertyType, 120),
        safeHumanText(source?.address, 900),
        null,
        nullableInteger(source?.stars, 1, 5),
        nullableNumber(source?.rating, 0, 10),
        nullableNumber(source?.ratingScale, 1, 10),
        nullableInteger(source?.reviewCount, 0, 100000000),
        nullableNumber(source?.latitude, -90, 90),
        nullableNumber(source?.longitude, -180, 180),
        safeHumanText(source?.checkIn, 120),
        safeHumanText(source?.checkOut, 120),
        '[]',
        '[]',
        '[]',
        '[]',
        '[]',
        cleanText(source?.providerHotelID, 220),
        cleanURL(source?.canonicalURL),
        cleanURL(source?.googleMapsURL) || googleMapsURL(source?.latitude, source?.longitude, source?.address),
        '[]',
        '[]',
        '[]',
        '[]',
        now
      )
    );
  });

  await env.HOTELS_DB.batch(statements);

  await env.HOTELS_DB.prepare(`
    UPDATE hotels
    SET brand=?, chain_name=?, postal_code=?, highlights_json=?, important_information_json=?,
        food_json=?, parking_transport_json=?, accessibility_json=?, lifecycle_state=?,
        data_quality_json=?, last_verified_at=?, catalog_profile='core-v1', source_room_count=?, updated_at=?
    WHERE id=?
  `).bind(
    brand,
    chainName,
    postalCode,
    JSON.stringify(highlights),
    JSON.stringify(importantInformation),
    JSON.stringify(food),
    JSON.stringify(parkingTransport),
    JSON.stringify(accessibility),
    lifecycleState,
    JSON.stringify(dataQuality),
    now,
    rooms.filter(room => isPlausibleRoomName(room?.name)).length,
    now,
    id
  ).run();

  for (const source of sources) {
    const sourceURL = cleanURL(source?.sourceURL);
    const provider = cleanText(source?.provider, 80);
    if (!sourceURL || !provider) continue;
    await env.HOTELS_DB.prepare(`
      UPDATE hotel_sources
      SET brand=?, chain_name=?, postal_code=?, highlights_json=?, important_information_json=?,
          food_json=?, parking_transport_json=?, accessibility_json=?, raw_identity_json=?
      WHERE hotel_id=? AND LOWER(provider)=LOWER(?) AND source_url=?
    `).bind(
      safeHumanText(source?.brand, 180),
      safeHumanText(source?.chain, 180) || safeHumanText(source?.chainName, 180),
      safeHumanText(source?.postalCode, 40),
      '[]',
      '[]',
      '[]',
      '[]',
      '[]',
      '{}',
      id,
      provider,
      sourceURL
    ).run();
  }

  const importedPriceAvailable = await persistImportedHotelPriceSnapshots(env, id, sources);

  console.log('HOTEL_SAVED', {
    hotelID: id,
    status,
    actor: user?.login || user?.email || 'staff',
    amenities: amenities.length,
    rooms: rooms.length,
    sources: sources.length,
    importedPriceAvailable,
    nearby: nearby.length,
    facts: facts.length
  });

  const row = await summaryRow(env, id);
  return { ok: true, hotel: hotelSummary(row), hotelID: id, importedPriceAvailable };
}


async function checkDuplicateRequest(request, env) {
  const payload = await readJSON(request, 600_000);
  if (!payload.ok) return payload.response;
  const duplicate = await findDuplicateHotel(env, payload.value || {}, null);
  if (isRepairableDuplicate(duplicate)) {
    return json({ ok: true, duplicate: null, repairable: duplicate });
  }
  return json({ ok: true, duplicate: duplicate || null });
}

async function findDuplicateHotel(env, draft, excludeID = null) {
  const sourceURLs = [];
  if (cleanURL(draft?.sourceURL)) sourceURLs.push(cleanURL(draft.sourceURL));
  for (const source of Array.isArray(draft?.sources) ? draft.sources : []) {
    const url = cleanURL(source?.sourceURL);
    if (url) sourceURLs.push(url);
  }

  for (const sourceURL of [...new Set(sourceURLs)]) {
    const canonicalSource = canonicalSourceURL(sourceURL);
    const row = await env.HOTELS_DB.prepare(`
      SELECT h.id, h.name, h.city, h.address, h.latitude, h.longitude, h.brand, h.chain_name, h.status, h.lifecycle_state, hs.provider, hs.source_url
      FROM hotel_sources hs JOIN hotels h ON h.id = hs.hotel_id
      WHERE (hs.source_url = ? OR hs.canonical_url = ?) ${excludeID ? 'AND h.id != ?' : ''}
      LIMIT 1
    `).bind(...(excludeID ? [sourceURL, canonicalSource, excludeID] : [sourceURL, canonicalSource])).first();
    if (row) return duplicateSummary(row, 'same_source', 'definitive', 1);
  }

  for (const source of Array.isArray(draft?.sources) ? draft.sources : []) {
    const provider = cleanText(source?.provider, 80);
    const providerHotelID = cleanText(source?.providerHotelID, 220);
    if (!provider || !providerHotelID) continue;
    const row = await env.HOTELS_DB.prepare(`
      SELECT h.id, h.name, h.city, h.address, h.latitude, h.longitude, h.brand, h.chain_name, h.status, h.lifecycle_state, hs.provider, hs.source_url
      FROM hotel_sources hs JOIN hotels h ON h.id = hs.hotel_id
      WHERE LOWER(hs.provider) = LOWER(?) AND hs.provider_hotel_id = ? ${excludeID ? 'AND h.id != ?' : ''}
      LIMIT 1
    `).bind(...(excludeID ? [provider, providerHotelID, excludeID] : [provider, providerHotelID])).first();
    if (row) return duplicateSummary(row, 'provider_id', 'definitive', 1);
  }

  const name = cleanText(draft?.name, 180);
  const city = resolveHotelCityDraft(draft);
  if (!name || !city) return null;

  const latitude = nullableNumber(draft?.latitude, -90, 90);
  const longitude = nullableNumber(draft?.longitude, -180, 180);
  const address = cleanText(draft?.address, 900) || '';
  const requestedBrand = cleanText(draft?.brand, 180) || cleanText(draft?.chain, 180) || '';
  const candidates = await env.HOTELS_DB.prepare(`
    SELECT id, name, city, address, latitude, longitude, brand, chain_name, status, lifecycle_state
    FROM hotels
    WHERE LOWER(city) = LOWER(?) ${excludeID ? 'AND id != ?' : ''}
    ORDER BY updated_at DESC
    LIMIT 600
  `).bind(...(excludeID ? [city, excludeID] : [city])).all();

  const requestedTokens = hotelNameTokens(name);
  const requestedAddress = normalizedAddress(address);
  const requestedBrandTokens = hotelNameTokens(requestedBrand);
  let bestPossible = null;

  for (const row of candidates.results || []) {
    const nameScore = tokenSimilarity(requestedTokens, hotelNameTokens(row.name));
    const addressScore = requestedAddress && row.address
      ? tokenSimilarity(addressTokens(requestedAddress), addressTokens(normalizedAddress(row.address)))
      : 0;
    const candidateBrand = `${row.brand || ''} ${row.chain_name || ''}`.trim();
    const brandScore = requestedBrandTokens.size && candidateBrand
      ? tokenSimilarity(requestedBrandTokens, hotelNameTokens(candidateBrand))
      : 0;
    const geoMeters = latitude != null && longitude != null && row.latitude != null && row.longitude != null
      ? haversineMeters(latitude, longitude, Number(row.latitude), Number(row.longitude))
      : null;

    // Definitive physical-property matches require two strong independent signals.
    if (geoMeters != null && geoMeters <= 80 && nameScore >= 0.55) {
      const confidence = Math.min(0.99, 0.90 + nameScore * 0.08 + (brandScore > 0.6 ? 0.01 : 0));
      return duplicateSummary(row, 'same_property_geo', 'definitive', confidence, { nameScore, addressScore, brandScore, geoMeters });
    }
    if (nameScore >= 0.88 && addressScore >= 0.70) {
      const confidence = Math.min(0.99, 0.88 + nameScore * 0.06 + addressScore * 0.05);
      return duplicateSummary(row, 'same_property_address', 'definitive', confidence, { nameScore, addressScore, brandScore, geoMeters });
    }

    // A similar name alone is never enough to auto-block; surface it for human review.
    let possibleConfidence = 0;
    let possibleMatch = null;
    if (geoMeters != null && geoMeters <= 250 && nameScore >= 0.45) {
      possibleConfidence = 0.72 + Math.min(0.12, nameScore * 0.10) + (geoMeters <= 120 ? 0.05 : 0);
      possibleMatch = 'possible_property_geo';
    } else if (nameScore >= 0.70 && addressScore >= 0.40) {
      possibleConfidence = 0.68 + nameScore * 0.10 + addressScore * 0.08;
      possibleMatch = 'possible_property_address';
    } else if (nameScore >= 0.90) {
      possibleConfidence = 0.72 + nameScore * 0.08 + (brandScore >= 0.60 ? 0.04 : 0);
      possibleMatch = 'possible_property_name';
    }

    if (possibleMatch) {
      const candidate = duplicateSummary(row, possibleMatch, 'possible', Math.min(0.89, possibleConfidence), { nameScore, addressScore, brandScore, geoMeters });
      if (!bestPossible || candidate.confidence > bestPossible.confidence) bestPossible = candidate;
    }
  }

  return bestPossible;
}

function duplicateSummary(row, match, certainty = 'definitive', confidence = 1, signals = null) {
  return {
    id: row.id,
    name: row.name,
    city: row.city,
    address: row.address || '',
    latitude: row.latitude == null ? null : Number(row.latitude),
    longitude: row.longitude == null ? null : Number(row.longitude),
    brand: row.brand || null,
    chain: row.chain_name || null,
    provider: row.provider || null,
    sourceURL: row.source_url || null,
    status: row.status || null,
    lifecycleState: row.lifecycle_state || row.status || null,
    match,
    certainty,
    confidence: Math.round(Math.max(0, Math.min(1, Number(confidence) || 0)) * 1000) / 1000,
    signals: signals || null
  };
}

function isRepairableDuplicate(duplicate) {
  if (!duplicate || duplicate.certainty !== 'definitive') return false;
  const status = String(duplicate.status || '').toLowerCase();
  const lifecycle = String(duplicate.lifecycleState || status).toLowerCase();
  if (status === 'published' || lifecycle === 'published' || lifecycle === 'importing') return false;
  return ['draft','failed','ready','archived'].includes(status) || ['draft','failed','ready','archived'].includes(lifecycle);
}


async function recoverSourceRooms(request, env) {
  const payload = await readJSON(request, 100_000);
  if (!payload.ok) return payload.response;
  const sourceURL = cleanURL(payload.value?.sourceURL);
  if (!sourceURL) return json({ ok: false, error: 'INVALID_SOURCE_URL' }, 400);

  let input;
  try { input = new URL(sourceURL); } catch (_) { return json({ ok: false, error: 'INVALID_SOURCE_URL' }, 400); }
  const inputHost = input.hostname.toLowerCase();
  const hintedProvider = inputHost === 'expe.onelink.me' || inputHost.endsWith('.expe.onelink.me')
    ? 'Expedia'
    : detectRoomProvider(input);
  if (!hintedProvider) return json({ ok: false, error: 'UNSUPPORTED_SOURCE_PROVIDER' }, 400);

  const headers = new Headers({
    'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
    'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language': 'en-US,en;q=0.9',
    'cache-control': 'no-cache'
  });

  let response;
  try {
    response = await fetch(sourceURL, { headers, redirect: 'follow', cf: { cacheTtl: 0 } });
  } catch (error) {
    return json({ ok: false, error: 'SOURCE_ROOM_FETCH_FAILED', detail: String(error?.message || error).slice(0, 500) }, 502);
  }
  if (!response.ok) return json({ ok: false, error: `SOURCE_ROOM_HTTP_${response.status}` }, 502);

  const finalURL = response.url || sourceURL;
  let finalParsed;
  try { finalParsed = new URL(finalURL); } catch (_) { return json({ ok: false, error: 'SOURCE_ROOM_BAD_REDIRECT' }, 502); }
  const provider = detectRoomProvider(finalParsed) || hintedProvider;
  if (!provider || !providerRoomHostAllowed(finalParsed, provider)) {
    return json({ ok: false, error: 'SOURCE_REDIRECT_OUTSIDE_PROVIDER' }, 400);
  }
  const expectedPropertyID = providerPropertyIDFromURL(finalParsed, provider)
    || providerPropertyIDFromURL(input, provider);
  if (provider === 'Expedia' && !expectedPropertyID) {
    return json({ ok: false, error: 'SOURCE_PROPERTY_ID_MISSING', detail: 'Resolved Expedia URL has no stable .h<propertyID> identity.' }, 422);
  }

  const html = await response.text();
  if (!html || html.length < 500) return json({ ok: false, error: 'SOURCE_ROOM_EMPTY_PAGE' }, 502);
  if (html.length > 8_000_000) return json({ ok: false, error: 'SOURCE_ROOM_PAGE_TOO_LARGE' }, 502);
  if (isProviderChallengeHTML(html)) {
    return json({ ok: false, error: 'SOURCE_PROVIDER_CHALLENGE', detail: 'Provider returned an anti-bot verification page instead of the hotel property.' }, 409);
  }

  let rooms = extractProviderRoomsFromHTML(html, provider, expectedPropertyID);
  let recoveryURL = finalURL;
  let method = rooms.length ? 'server-property-page-v3' : 'server-property-page-no-room-match';

  // Room cards are availability-driven on both Expedia and Booking. Probe only the
  // exact resolved property URL with deterministic future dates; this never searches
  // by hotel name and therefore cannot drift to a different physical hotel.
  if (rooms.length < 4) {
    const candidates = roomRecoveryProbeURLs(finalParsed, provider);
    for (const fallbackURL of candidates) {
      try {
        const fallbackResponse = await fetch(fallbackURL, { headers, redirect: 'follow', cf: { cacheTtl: 0 } });
        if (!fallbackResponse.ok) continue;
        const fallbackFinal = new URL(fallbackResponse.url || fallbackURL);
        if (!providerRoomHostAllowed(fallbackFinal, provider)) continue;
        if (!sameProviderPropertyIdentity(fallbackFinal, finalParsed, provider)) continue;
        const fallbackHTML = await fallbackResponse.text();
        if (!fallbackHTML || fallbackHTML.length > 8_000_000) continue;
        const recovered = extractProviderRoomsFromHTML(fallbackHTML, provider, expectedPropertyID);
        if (!recovered.length) continue;
        rooms = mergeRecoveredRooms(rooms, recovered);
        recoveryURL = fallbackResponse.url || fallbackURL;
        method = 'server-property-page-dated-probe-v3';
        if (rooms.length >= 4) break;
      } catch (_) {}
    }
  }

  return json({
    ok: true,
    provider,
    sourceURL: recoveryURL,
    roomCount: rooms.length,
    rooms,
    method,
    propertyID: expectedPropertyID || null
  });
}

function isProviderChallengeHTML(html) {
  const text = String(html || '').toLowerCase();
  return [
    'bot or not', 'verify you are human', 'are you a robot', 'security check',
    'robot check', 'unusual traffic', 'captcha', 'access denied'
  ].some(marker => text.includes(marker));
}

function detectRoomProvider(url) {
  const host = String(url?.hostname || '').toLowerCase();
  if (host === 'booking.com' || host.endsWith('.booking.com')) return 'Booking';
  if (host === 'expedia.com' || host.endsWith('.expedia.com') || host.includes('expedia.')) return 'Expedia';
  return null;
}

function providerPropertyIDFromURL(url, provider) {
  if (provider !== 'Expedia') return null;
  try {
    const explicit = url.searchParams.get('expediaPropertyId') || url.searchParams.get('propertyId');
    if (explicit && /^[0-9]{4,}$/.test(explicit)) return explicit;
    const match = String(url.pathname || '').match(/\.h([0-9]{4,})\.Hotel-Information/i);
    return match ? match[1] : null;
  } catch (_) {
    return null;
  }
}

function sameProviderPropertyIdentity(candidateURL, expectedURL, provider) {
  if (!providerRoomHostAllowed(candidateURL, provider)) return false;
  if (provider !== 'Expedia') return true;
  const expected = providerPropertyIDFromURL(expectedURL, provider);
  const actual = providerPropertyIDFromURL(candidateURL, provider);
  return !!expected && actual === expected;
}

function providerRoomHostAllowed(url, provider) {
  const host = String(url?.hostname || '').toLowerCase();
  return provider === 'Booking'
    ? host === 'booking.com' || host.endsWith('.booking.com')
    : host === 'expedia.com' || host.endsWith('.expedia.com') || host.includes('expedia.');
}

function roomRecoveryProbeURLs(propertyURL, provider) {
  const offsets = [14, 45];
  const output = [];
  const seen = new Set();
  const dateFor = offset => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
  const push = url => {
    const value = url.toString();
    if (!seen.has(value)) { seen.add(value); output.push(value); }
  };

  for (const offset of offsets) {
    const url = new URL(propertyURL.toString());
    const checkIn = dateFor(offset);
    const checkOut = dateFor(offset + 2);
    if (provider === 'Expedia') {
      url.searchParams.set('chkin', checkIn);
      url.searchParams.set('chkout', checkOut);
      url.searchParams.set('rm1', 'a2');
      url.searchParams.set('useRewards', 'false');
      push(url);

      // Regional Expedia properties share the same .h<propertyID> identity/path.
      // The .com render is often richer server-side, but the path is never changed.
      const canonical = new URL(url.toString());
      canonical.hostname = 'www.expedia.com';
      push(canonical);
    } else {
      url.searchParams.set('checkin', checkIn);
      url.searchParams.set('checkout', checkOut);
      url.searchParams.set('group_adults', '2');
      url.searchParams.set('group_children', '0');
      url.searchParams.set('no_rooms', '1');
      push(url);
    }
  }
  return output.slice(0, 6);
}

function mergeRecoveredRooms(primary, recovered) {
  const out = [];
  const seen = new Set();
  for (const room of [...(primary || []), ...(recovered || [])]) {
    if (!room || !isPlausibleRoomName(room.name)) continue;
    const key = normalizeRoomIdentity(room.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(room);
    if (out.length >= 140) break;
  }
  return out;
}

function extractProviderRoomsFromHTML(html, provider, expectedPropertyID = null) {
  const visible = htmlToReadableText(html);
  const roomStart = visible.search(/\b(?:room options|rooms and rates|available rooms|choose your room|room types)\b/i);
  let roomText = roomStart >= 0 ? visible.slice(roomStart, roomStart + 180_000) : visible;
  const end = roomText.slice(800).search(/\b(?:about this property|property amenities|location|policies|reviews|getting around|you may also like|similar properties|recommended)\b/i);
  if (end >= 0) roomText = roomText.slice(0, Math.max(2_500, end + 800));

  const anchors = [];
  const patterns = provider === 'Expedia' ? [
    { source: 'photo', regex: /View all photos for\s+([^\n]{3,220})/gi },
    { source: 'detail', regex: /More details(?:\s+More details)? for\s+([^\n]{3,220})/gi },
    { source: 'price', regex: /View prices(?: for your dates)?(?: for)?\s+([^\n]{3,220})/gi }
  ] : [
    { source: 'room', regex: /(?:Room type|Room name)\s*[:\-]?\s*([^\n]{3,220})/gi }
  ];
  for (const entry of patterns) {
    let match;
    while ((match = entry.regex.exec(roomText)) !== null && anchors.length < 500) {
      anchors.push({ name: cleanRoomAnchor(match[1]), index: match.index, source: entry.source });
    }
  }
  anchors.sort((a, b) => a.index - b.index);

  // Expedia repeats the room name in “More details …” / “View prices …”. When a
  // photo anchor exists for that name, use the photo anchor because the sellable
  // details live between it and the action footer. This prevents details from the
  // next room card leaking into the previous room.
  const photoNames = new Set(anchors.filter(a => a.source === 'photo').map(a => normalizeRoomIdentity(a.name)));
  const visibleAnchors = anchors.filter(a => !['detail','price'].includes(a.source) || !photoNames.has(normalizeRoomIdentity(a.name)));

  // Explicit room-name keys from application state are useful only as a fallback
  // for names not already represented by visible room cards.
  const rawJSONAnchors = [];
  const rawJSONPatterns = [
    /["']roomTypeName["']\s*:\s*["']([^"']{3,220})["']/gi,
    /["']roomName["']\s*:\s*["']([^"']{3,220})["']/gi,
    /["']unitName["']\s*:\s*["']([^"']{3,220})["']/gi
  ];
  // Expedia SSR/app-state contains other properties on the same HTML document. Do not
  // accept unscoped room-name JSON; the visible Room options/action labels are the safe
  // property-specific source. Booking keeps the legacy structured fallback.
  if (provider !== 'Expedia') {
    for (const pattern of rawJSONPatterns) {
      let match;
      while ((match = pattern.exec(html)) !== null && rawJSONAnchors.length < 300) {
        rawJSONAnchors.push({ name: cleanRoomAnchor(decodeHTMLEntities(match[1])), index: -1, source: 'json' });
      }
    }
  }

  // SSR room cards frequently expose the room name only through aria-label/title
  // attributes. htmlToReadableText intentionally removes tags, so capture those
  // attributes directly before the markup is stripped. Expedia appends cross-sell
  // properties after the current property's room section, so never scan those cards.
  const recommendationBoundary = provider === 'Expedia'
    ? String(html || '').search(/(?:You may also like|Similar properties|Recommended properties)/i)
    : -1;
  const propertyScopedHTML = recommendationBoundary >= 0 ? String(html || '').slice(0, recommendationBoundary) : String(html || '');
  const rawAttributePatterns = provider === 'Expedia' ? [
    /aria-label=["'][^"']*View all photos for\s+([^"']{3,220})["']/gi,
    /aria-label=["'][^"']*More details(?:\s+More details)? for\s+([^"']{3,220})["']/gi,
    /title=["'][^"']*View all photos for\s+([^"']{3,220})["']/gi
  ] : [
    /data-testid=["'][^"']*room[^"']*["'][^>]*>\s*([^<]{3,220})</gi,
    /aria-label=["'][^"']*(?:room|suite)\s*[:\-]?\s*([^"']{3,220})["']/gi
  ];
  for (const pattern of rawAttributePatterns) {
    let match;
    while ((match = pattern.exec(propertyScopedHTML)) !== null && rawJSONAnchors.length < 420) {
      rawJSONAnchors.push({ name: cleanRoomAnchor(decodeHTMLEntities(match[1])), index: -1, source: 'attribute' });
    }
  }

  // Expedia application state is often JSON-escaped inside another script string.
  // Normalize only quoting/unicode escapes and then reuse the strict room-name keys.
  const normalizedStructuredHTML = String(html || '')
    .replace(/\\u([0-9a-f]{4})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\"/g, '"');
  if (provider !== 'Expedia' && normalizedStructuredHTML !== html) {
    for (const pattern of rawJSONPatterns) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(normalizedStructuredHTML)) !== null && rawJSONAnchors.length < 500) {
        rawJSONAnchors.push({ name: cleanRoomAnchor(decodeHTMLEntities(match[1])), index: -1, source: 'escaped-json' });
      }
    }
  }

  const processAnchors = [...visibleAnchors];
  const visibleNames = new Set(processAnchors.map(a => normalizeRoomIdentity(a.name)));
  for (const anchor of rawJSONAnchors) {
    if (!visibleNames.has(normalizeRoomIdentity(anchor.name))) processAnchors.push(anchor);
  }

  const result = [];
  const seen = new Set();
  for (let i = 0; i < processAnchors.length; i += 1) {
    const anchor = processAnchors[i];
    const name = safeHumanText(anchor.name, 240);
    if (!name || !isPlausibleRoomName(name)) continue;

    let context = name;
    if (anchor.index >= 0) {
      const nextVisible = anchors.find(other => other.index > anchor.index);
      const endIndex = nextVisible ? Math.min(nextVisible.index, anchor.index + 2_200) : Math.min(roomText.length, anchor.index + 2_200);
      context = roomText.slice(Math.max(0, anchor.index), endIndex);
    }
    const room = roomFromTextContext(name, context);
    const key = [normalizeRoomIdentity(room.name), room.beds || '', room.maxGuests || '', room.sizeM2 || '', room.view || '']
      .join('|').toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(room);
    if (result.length >= 140) break;
  }
  return result;
}

function normalizeRoomIdentity(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u0400-\u04ff\u0600-\u06ff]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function roomFromTextContext(name, context) {
  const compact = String(context || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n');
  const guest = compact.match(/\bSleeps?\s*(\d{1,2})\b/i) || compact.match(/\b(?:up to|max(?:imum)?)\s*(\d{1,2})\s*(?:guests?|people)\b/i);
  const metricSize = compact.match(/\b(\d{1,4}(?:\.\d+)?)\s*(?:sq\s*m|m²|square meters?)\b/i);
  const imperialSize = compact.match(/\b(\d{2,5}(?:\.\d+)?)\s*(?:sq\s*ft|ft²|square feet)\b/i);
  const sizeM2 = metricSize ? Number(metricSize[1]) : imperialSize ? Math.round(Number(imperialSize[1]) * 0.092903 * 10) / 10 : null;
  const bed = compact.match(/\b(?:\d+\s+)?(?:King|Queen|Twin|Double|Single|Large Twin|Sofa)\s+Beds?(?:\s+(?:and|or)\s+(?:\d+\s+)?(?:King|Queen|Twin|Double|Single|Large Twin|Sofa)\s+Beds?)*/i);
  const view = compact.match(/\b(?:city|kaaba|kabba|haram|landmark|mountain|courtyard|garden|sea)\s+view\b/i);
  const category = name.match(/\b(standard|superior|deluxe|executive|premier|classic|family|studio|junior suite|suite|presidential|royal)\b/i);
  return {
    id: crypto.randomUUID(),
    name,
    maxGuests: guest ? Number(guest[1]) : null,
    sizeM2: Number.isFinite(sizeM2) ? sizeM2 : null,
    beds: bed ? cleanText(bed[0], 260) : null,
    view: view ? cleanText(view[0], 180) : null,
    description: null,
    amenities: /free wi[- ]?fi/i.test(compact) ? ['Free WiFi'] : [],
    smoking: /non[- ]smoking|smoke[- ]free/i.test(compact) ? 'Non-smoking' : null,
    accessibility: [],
    category: category ? category[1] : null,
    bathroom: []
  };
}

function cleanRoomAnchor(value) {
  return String(value || '')
    .replace(/\\u002F/gi, '/')
    .replace(/\\u0026/gi, '&')
    .replace(/\\"/g, '"')
    .replace(/\s+(?:image|photo)\s*:\s*.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

function htmlToReadableText(html) {
  return decodeHTMLEntities(String(html || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '\n')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '\n')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '\n')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(?:p|div|section|article|li|h1|h2|h3|h4|button|a)>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeHTMLEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(parseInt(num, 10)));
}



function prioritizeImportImages(images, limit = 48) {
  const input = Array.isArray(images) ? images : [];
  const output = [];
  const seenURL = new Set();
  const take = image => {
    if (!image?.url || output.length >= limit) return;
    const key = canonicalImageSourceKey(image.url) || image.url;
    if (seenURL.has(key)) return;
    seenURL.add(key);
    output.push({ ...image, position: output.length });
  };

  input.filter(image => image.isCover).forEach(take);

  // First preserve room diversity: one photo per named room, then a second pass.
  const namedRooms = new Map();
  for (const image of input) {
    const room = cleanText(image?.roomName, 260);
    if (!room) continue;
    if (!namedRooms.has(room)) namedRooms.set(room, []);
    namedRooms.get(room).push(image);
  }
  for (let pass = 0; pass < 2 && output.length < limit; pass += 1) {
    for (const roomImages of namedRooms.values()) {
      if (roomImages[pass]) take(roomImages[pass]);
      if (output.length >= limit) break;
    }
  }

  const categoryOrder = ['exterior','lobby','room','bathroom','restaurant','breakfast','view','pool','gym','spa','lounge','facility','gallery'];
  for (const category of categoryOrder) {
    const candidate = input.find(image => image.category === category);
    if (candidate) take(candidate);
  }

  for (const image of input) take(image);
  if (output.length && !output.some(image => image.isCover)) output[0].isCover = true;
  return output;
}

function compactHotelImportSnapshot(draft, images) {
  const source = Array.isArray(draft?.sources) ? draft.sources[0] : null;
  const rooms = Array.isArray(draft?.rooms)
    ? draft.rooms.filter(room => isPlausibleRoomName(room?.name)).slice(0, 140).map(room => ({
        id: safeID(room?.id) || crypto.randomUUID(),
        name: safeHumanText(room?.name, 240),
        maxGuests: nullableInteger(room?.maxGuests, 1, 30),
        sizeM2: nullableNumber(room?.sizeM2, 1, 3000),
        beds: safeHumanText(room?.beds, 260),
        view: safeHumanText(room?.view, 220),
        category: safeHumanText(room?.category, 160),
        amenities: uniqueStrings(room?.amenities, 40, 180)
      }))
    : [];
  return {
    version: 'core-v1',
    id: safeID(draft?.id),
    name: safeHumanText(draft?.name, 180),
    city: canonicalCity(draft?.city),
    country: safeHumanText(draft?.country, 120),
    propertyType: safeHumanText(draft?.propertyType, 120),
    brand: safeHumanText(draft?.brand, 180),
    chain: safeHumanText(draft?.chain, 180),
    postalCode: safeHumanText(draft?.postalCode, 40),
    stars: nullableInteger(draft?.stars, 1, 5),
    rating: nullableNumber(draft?.rating, 0, 10),
    ratingScale: nullableNumber(draft?.ratingScale, 1, 10),
    reviewCount: nullableInteger(draft?.reviewCount, 0, 100000000),
    address: safeHumanText(draft?.address, 900),
    latitude: nullableNumber(draft?.latitude, -90, 90),
    longitude: nullableNumber(draft?.longitude, -180, 180),
    checkIn: safeHumanText(draft?.checkIn, 120),
    checkOut: safeHumanText(draft?.checkOut, 120),
    amenities: canonicalAmenities(draft?.amenities, 120),
    nearby: safeObjectArray(draft?.nearby, 24, 24_000),
    food: safeObjectArray(draft?.food, 16, 24_000),
    parkingTransport: safeObjectArray(draft?.parkingTransport, 16, 24_000),
    rooms,
    images: (Array.isArray(images) ? images : []).slice(0, 240).map(image => ({
      url: cleanURL(image?.url),
      provider: cleanText(image?.provider, 80),
      sourcePageURL: cleanURL(image?.sourcePageURL),
      category: validImageCategory(image?.category) || validImageCategory(image?.kind) || 'gallery',
      roomName: safeHumanText(image?.roomName, 260),
      isCover: image?.isCover === true,
      position: boundedInteger(image?.position, 0, 10000, 0)
    })).filter(image => image.url),
    source: source ? {
      provider: cleanText(source?.provider, 80),
      sourceURL: cleanURL(source?.sourceURL),
      canonicalURL: cleanURL(source?.canonicalURL),
      providerHotelID: cleanText(source?.providerHotelID, 220),
      checkedAt: new Date().toISOString()
    } : null
  };
}

async function createImportJob(request, env, user) {
  const payload = await readJSON(request, 4_000_000);
  if (!payload.ok) return payload.response;
  const draft = payload.value?.hotel || payload.value;
  const selectedImages = Array.isArray(payload.value?.images)
    ? payload.value.images
    : Array.isArray(draft?.images) ? draft.images.filter(image => image?.selected !== false) : [];
  const idempotencyKey = cleanText(payload.value?.idempotencyKey || request.headers.get('idempotency-key'), 180);
  const allowPossibleDuplicate = payload.value?.allowPossibleDuplicate === true;

  if (idempotencyKey) {
    const existing = await env.HOTELS_DB.prepare('SELECT id FROM hotel_import_jobs WHERE idempotency_key=? LIMIT 1').bind(idempotencyKey).first();
    if (existing?.id) return importJobDetail(env, existing.id, 200);
  }

  const duplicate = await findDuplicateHotel(env, draft, null);
  const repairDuplicate = isRepairableDuplicate(duplicate) ? duplicate : null;
  if (duplicate?.certainty === 'definitive' && !repairDuplicate) {
    return json({ ok: false, error: 'HOTEL_ALREADY_EXISTS', duplicate }, 409);
  }
  if (duplicate?.certainty === 'possible' && !allowPossibleDuplicate) {
    return json({ ok: false, error: 'POSSIBLE_DUPLICATE', duplicate }, 409);
  }

  const cleanedImages = selectedImages.slice(0, 240).map((image, index) => ({
    url: cleanURL(image?.url),
    provider: cleanText(image?.provider, 80) || 'unknown',
    sourcePageURL: cleanURL(image?.sourcePageURL),
    category: validImageCategory(image?.kind) || validImageCategory(image?.category) || 'gallery',
    label: cleanText(image?.label, 600),
    roomName: cleanText(image?.roomName, 260),
    isCover: image?.isCover === true,
    position: index
  })).filter(image => image.url && image.category !== 'other');
  const images = prioritizeImportImages(cleanedImages, 48);

  if (!images.length) return json({ ok: false, error: 'NO_IMAGES_SELECTED' }, 400);

  const plausibleRooms = Array.isArray(draft?.rooms) ? draft.rooms.filter(room => isPlausibleRoomName(room?.name)) : [];
  // Price extraction is best-effort for imports. A hotel with confirmed identity,
  // room types and media may be published without a source price; staff can set
  // a manual nightly price later from iumrah Business. Do not block an otherwise
  // complete hotel because Expedia/Booking did not expose a machine-readable rate.
  const importedPriceAvailable = hasImportedHotelPrice(draft?.sources);
  if (payload.value?.publishWhenComplete === true && plausibleRooms.length === 0) {
    return json({ ok: false, error: 'ROOM_TYPES_REQUIRED', detail: 'Published hotel requires at least one confirmed room type.' }, 422);
  }
  // Publishing only requires one general property photo. Room/bathroom media is enrichment,
  // not a gate: a hotel with confirmed room types must be publishable even when Expedia
  // exposes no room-specific photos.
  const hotelLevelImages = images.filter(image => !['room', 'bathroom', 'other'].includes(image.category));
  if (payload.value?.publishWhenComplete === true && hotelLevelImages.length === 0) {
    return json({ ok: false, error: 'HOTEL_PHOTO_REQUIRED', detail: 'Published hotel requires at least one general hotel photo; room photos are optional.' }, 422);
  }
  const canPublish = Boolean(payload.value?.publishWhenComplete) && hotelLevelImages.length > 0 && plausibleRooms.length > 0;
  const safeDraft = { ...draft, id: repairDuplicate?.id || draft?.id, status: 'draft', lifecycleState: 'importing' };
  const persisted = await persistHotelDraft(safeDraft, env, user, { checkDuplicate: false });
  if (!persisted.ok) return persisted.response;

  const hotelID = persisted.hotelID;
  if (repairDuplicate) {
    // Re-importing a failed/draft record repairs the same canonical hotel instead of
    // creating a duplicate. Old partial media is removed before the immutable new job starts.
    await deleteAllHotelImagesInternal(env, hotelID);
  }
  const jobID = `hotel-import-${crypto.randomUUID()}`;
  const snapshotJSON = JSON.stringify(compactHotelImportSnapshot(safeDraft, images));
  const snapshotHash = await sha256Hex(snapshotJSON);
  const now = new Date().toISOString();

  try {
    await env.HOTELS_DB.prepare(`
      INSERT INTO hotel_import_jobs (
        id, hotel_id, hotel_name, source_provider, source_url, status, stage, progress,
        total_images, stored_images, failed_images, images_json, publish_when_complete, updated_at,
        idempotency_key, hotel_snapshot_json, snapshot_hash, retry_count, possible_duplicate_json
      ) VALUES (?, ?, ?, ?, ?, 'queued', 'queued', 0, ?, 0, 0, ?, ?, ?, ?, ?, ?, 0, ?)
    `).bind(
      jobID,
      hotelID,
      cleanText(draft?.name, 180) || hotelID,
      cleanText(draft?.sources?.[0]?.provider, 80),
      cleanURL(draft?.sources?.[0]?.sourceURL),
      images.length,
      JSON.stringify(images),
      canPublish ? 1 : 0,
      now,
      idempotencyKey,
      snapshotJSON,
      snapshotHash,
      duplicate?.certainty === 'possible' ? JSON.stringify(duplicate) : null
    ).run();
  } catch (error) {
    if (idempotencyKey) {
      const existing = await env.HOTELS_DB.prepare('SELECT id FROM hotel_import_jobs WHERE idempotency_key=? LIMIT 1').bind(idempotencyKey).first();
      if (existing?.id) return importJobDetail(env, existing.id, 200);
    }
    throw error;
  }

  await env.HOTELS_DB.prepare("UPDATE hotels SET lifecycle_state='importing', status='draft', updated_at=? WHERE id=?")
    .bind(now, hotelID).run();

  try {
    const instance = await env.HOTEL_IMPORT_WORKFLOW.create({
      id: jobID,
      params: { jobID, hotelID, images, publishWhenComplete: canPublish, snapshotHash }
    });
    await env.HOTELS_DB.prepare(`
      UPDATE hotel_import_jobs SET workflow_instance_id = ?, updated_at = ?, heartbeat_at = ? WHERE id = ?
    `).bind(instance.id, new Date().toISOString(), new Date().toISOString(), jobID).run();
  } catch (error) {
    console.error('HOTEL_WORKFLOW_START_FAILED', error);
    const failedAt = new Date().toISOString();
    await env.HOTELS_DB.batch([
      env.HOTELS_DB.prepare(`
        UPDATE hotel_import_jobs SET status = 'failed', stage = 'start_failed', error = ?, last_error_code='WORKFLOW_START_FAILED', completed_at = ?, updated_at = ?, heartbeat_at = ? WHERE id = ?
      `).bind(String(error?.message || error).slice(0, 1200), failedAt, failedAt, failedAt, jobID),
      env.HOTELS_DB.prepare("UPDATE hotels SET lifecycle_state='failed', status='draft', updated_at=? WHERE id=?").bind(failedAt, hotelID)
    ]);
    return json({ ok: false, error: 'IMPORT_WORKFLOW_START_FAILED', jobID }, 503);
  }

  return importJobDetail(env, jobID, 202);
}


async function reconcileStaleImportJobs(env) {
  const cutoffMs = Date.now() - 15 * 60 * 1000;
  const result = await env.HOTELS_DB.prepare(`
    SELECT id, hotel_id, workflow_instance_id, status, stage, updated_at, heartbeat_at
    FROM hotel_import_jobs
    WHERE status IN ('queued','running')
    ORDER BY updated_at ASC
    LIMIT 40
  `).all();

  for (const row of result.results || []) {
    const heartbeat = Date.parse(row.heartbeat_at || row.updated_at || '');
    if (Number.isFinite(heartbeat) && heartbeat >= cutoffMs) continue;

    let workflowStatus = 'unknown';
    let workflowError = null;
    if (row.workflow_instance_id) {
      try {
        const instance = await env.HOTEL_IMPORT_WORKFLOW.get(row.workflow_instance_id);
        const details = await instance.status();
        workflowStatus = details?.status || 'unknown';
        workflowError = details?.error?.message || null;
        if (['running','queued','waiting','waitingForPause','paused'].includes(workflowStatus)) {
          await instance.terminate().catch(() => {});
          workflowStatus = 'terminated';
        }
      } catch (error) {
        workflowError = String(error?.message || error).slice(0, 500);
      }
    }

    const now = new Date().toISOString();
    const reason = workflowError
      ? `STALE_IMPORT_RECOVERED: ${workflowError}`
      : `STALE_IMPORT_RECOVERED: workflow=${workflowStatus}`;
    await env.HOTELS_DB.batch([
      env.HOTELS_DB.prepare(`
        UPDATE hotel_import_jobs
        SET status='failed', stage='stale_recovered', progress=MIN(progress, 99), error=?, last_error_code='STALE_IMPORT',
            completed_at=COALESCE(completed_at, ?), updated_at=?, heartbeat_at=?
        WHERE id=? AND status IN ('queued','running')
      `).bind(reason.slice(0, 1200), now, now, now, row.id),
      env.HOTELS_DB.prepare(`
        UPDATE hotels SET status='draft', lifecycle_state='failed', updated_at=?
        WHERE id=? AND status!='published'
      `).bind(now, row.hotel_id)
    ]);
  }
}

async function terminateWorkflowForJob(env, row) {
  if (!row?.workflow_instance_id) return;
  try {
    const instance = await env.HOTEL_IMPORT_WORKFLOW.get(row.workflow_instance_id);
    const status = await instance.status().catch(() => null);
    if (!status || !['complete','errored','terminated'].includes(status.status)) {
      await instance.terminate().catch(() => {});
    }
  } catch (_) {}
}

async function cancelImportJob(env, jobID) {
  const row = await env.HOTELS_DB.prepare('SELECT * FROM hotel_import_jobs WHERE id=?').bind(jobID).first();
  if (!row) return json({ ok: false, error: 'IMPORT_JOB_NOT_FOUND' }, 404);
  if (!['queued','running'].includes(row.status)) return importJobDetail(env, jobID, 200);

  await terminateWorkflowForJob(env, row);
  const now = new Date().toISOString();
  await env.HOTELS_DB.batch([
    env.HOTELS_DB.prepare(`
      UPDATE hotel_import_jobs
      SET status='failed', stage='cancelled', error='Импорт остановлен пользователем.', last_error_code='CANCELLED',
          cancel_requested_at=?, completed_at=?, updated_at=?, heartbeat_at=?
      WHERE id=?
    `).bind(now, now, now, now, jobID),
    env.HOTELS_DB.prepare(`
      UPDATE hotels SET status='draft', lifecycle_state='failed', updated_at=?
      WHERE id=? AND status!='published'
    `).bind(now, row.hotel_id)
  ]);
  return importJobDetail(env, jobID, 200);
}

async function deleteImportJob(env, jobID) {
  const row = await env.HOTELS_DB.prepare('SELECT * FROM hotel_import_jobs WHERE id=?').bind(jobID).first();
  if (!row) return json({ ok: false, error: 'IMPORT_JOB_NOT_FOUND' }, 404);
  await terminateWorkflowForJob(env, row);
  await env.HOTELS_DB.prepare('DELETE FROM hotel_import_jobs WHERE id=?').bind(jobID).run();
  return json({ ok: true, deletedJobID: jobID, hotelID: row.hotel_id });
}

async function listImportJobs(env, url) {
  await reconcileStaleImportJobs(env);
  const activeOnly = url.searchParams.get('active') === '1';
  const sql = `
    SELECT * FROM hotel_import_jobs
    ${activeOnly ? "WHERE status IN ('queued','running')" : ''}
    ORDER BY created_at DESC
    LIMIT 80
  `;
  const result = await env.HOTELS_DB.prepare(sql).all();
  return json({ ok: true, jobs: (result.results || []).map(importJobRow) });
}

async function importJobDetail(env, jobID, status = 200) {
  await reconcileStaleImportJobs(env);
  const row = await env.HOTELS_DB.prepare('SELECT * FROM hotel_import_jobs WHERE id = ?').bind(jobID).first();
  if (!row) return json({ ok: false, error: 'IMPORT_JOB_NOT_FOUND' }, 404);
  return json({ ok: true, job: importJobRow(row) }, status);
}

async function retryImportJob(env, jobID) {
  const row = await env.HOTELS_DB.prepare('SELECT * FROM hotel_import_jobs WHERE id = ?').bind(jobID).first();
  if (!row) return json({ ok: false, error: 'IMPORT_JOB_NOT_FOUND' }, 404);
  if (!['failed'].includes(row.status)) return json({ ok: false, error: 'IMPORT_JOB_NOT_RETRYABLE' }, 409);

  const images = prioritizeImportImages(parseJSONArray(row.images_json), 48);
  const retryAt = new Date().toISOString();
  await env.HOTELS_DB.batch([
    env.HOTELS_DB.prepare(`
      UPDATE hotel_import_jobs
      SET status='queued', stage='retry_queued', progress=0, stored_images=0, failed_images=0, error=NULL, warning=NULL,
          current_image=0, current_image_label=NULL, compression_mode=NULL, last_error_code=NULL, cancel_requested_at=NULL,
          retry_count=retry_count+1, started_at=NULL, completed_at=NULL, updated_at=?, heartbeat_at=? WHERE id=?
    `).bind(retryAt, retryAt, jobID),
    env.HOTELS_DB.prepare("UPDATE hotels SET status='draft', lifecycle_state='importing', updated_at=? WHERE id=?")
      .bind(retryAt, row.hotel_id)
  ]);
  await deleteAllHotelImagesInternal(env, row.hotel_id);

  try {
    const instance = await env.HOTEL_IMPORT_WORKFLOW.create({
      id: `${jobID}-retry-${crypto.randomUUID().slice(0, 8)}`,
      params: { jobID, hotelID: row.hotel_id, images, publishWhenComplete: Number(row.publish_when_complete) === 1, snapshotHash: row.snapshot_hash || null }
    });
    await env.HOTELS_DB.prepare('UPDATE hotel_import_jobs SET workflow_instance_id=?, updated_at=?, heartbeat_at=? WHERE id=?')
      .bind(instance.id, new Date().toISOString(), new Date().toISOString(), jobID).run();
  } catch (error) {
    const failedAt = new Date().toISOString();
    await env.HOTELS_DB.batch([
      env.HOTELS_DB.prepare("UPDATE hotel_import_jobs SET status='failed', stage='start_failed', error=?, last_error_code='WORKFLOW_START_FAILED', updated_at=?, heartbeat_at=? WHERE id=?")
        .bind(String(error?.message || error).slice(0, 1200), failedAt, failedAt, jobID),
      env.HOTELS_DB.prepare("UPDATE hotels SET lifecycle_state='failed', status='draft', updated_at=? WHERE id=?")
        .bind(failedAt, row.hotel_id)
    ]);
    return json({ ok: false, error: 'IMPORT_WORKFLOW_START_FAILED' }, 503);
  }
  return importJobDetail(env, jobID, 202);
}

function importJobRow(row) {
  return {
    id: row.id,
    hotelID: row.hotel_id,
    hotelName: row.hotel_name,
    sourceProvider: row.source_provider || null,
    sourceURL: row.source_url || null,
    status: row.status,
    stage: row.stage,
    progress: Number(row.progress || 0),
    totalImages: Number(row.total_images || 0),
    storedImages: Number(row.stored_images || 0),
    failedImages: Number(row.failed_images || 0),
    publishWhenComplete: Number(row.publish_when_complete || 0) === 1,
    error: row.error || null,
    createdAt: row.created_at,
    startedAt: row.started_at || null,
    completedAt: row.completed_at || null,
    updatedAt: row.updated_at,
    retryCount: Number(row.retry_count || 0),
    snapshotHash: row.snapshot_hash || null,
    possibleDuplicate: parseJSONObject(row.possible_duplicate_json),
    currentImage: Number(row.current_image || 0),
    currentImageLabel: row.current_image_label || null,
    warning: row.warning || null,
    compressionMode: row.compression_mode || null,
    heartbeatAt: row.heartbeat_at || row.updated_at || null,
    lastErrorCode: row.last_error_code || null,
    cancelRequestedAt: row.cancel_requested_at || null
  };
}

export class HotelImportWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    const { jobID, hotelID, images = [], publishWhenComplete = false, snapshotHash = null } = event.payload || {};
    if (!safeID(jobID) || !safeID(hotelID) || !Array.isArray(images)) {
      throw new Error('INVALID_IMPORT_WORKFLOW_PAYLOAD');
    }

    await step.do('validate immutable snapshot', async () => {
      const row = await this.env.HOTELS_DB.prepare('SELECT snapshot_hash, hotel_snapshot_json FROM hotel_import_jobs WHERE id=? AND hotel_id=?')
        .bind(jobID, hotelID).first();
      if (!row) throw new Error('IMPORT_JOB_NOT_FOUND');
      const storedHash = cleanText(row.snapshot_hash, 128);
      if (snapshotHash && storedHash && snapshotHash !== storedHash) throw new Error('IMPORT_SNAPSHOT_MISMATCH');
      if (storedHash) {
        const recomputed = await sha256Hex(String(row.hotel_snapshot_json || '{}'));
        if (recomputed !== storedHash) throw new Error('IMPORT_SNAPSHOT_CORRUPTED');
      }
      return { ok: true, snapshotHash: storedHash || null };
    });

    await step.do('mark job running', async () => {
      const now = new Date().toISOString();
      await this.env.HOTELS_DB.batch([
        this.env.HOTELS_DB.prepare(`
          UPDATE hotel_import_jobs
          SET status='running', stage='preparing_media', progress=1, current_image=0, current_image_label=NULL, warning=NULL, started_at=COALESCE(started_at, ?), updated_at=?, heartbeat_at=?
          WHERE id=?
        `).bind(now, now, now, jobID),
        this.env.HOTELS_DB.prepare("UPDATE hotels SET status='draft', lifecycle_state='importing', updated_at=? WHERE id=?")
          .bind(now, hotelID)
      ]);
      return { ok: true };
    });

    let stored = 0;
    let failed = 0;
    const total = images.length;

    for (let index = 0; index < total; index += 1) {
      const item = images[index];
      const itemLabel = cleanText(item?.label || item?.roomName || item?.category || `Фото ${index + 1}`, 220);
      const startProgress = Math.min(92, Math.max(2, Math.round((index / Math.max(total, 1)) * 90)));
      await step.do(`announce image ${String(index + 1).padStart(3, '0')}`, async () => {
        await this.env.HOTELS_DB.prepare(`
          UPDATE hotel_import_jobs
          SET stage='downloading_image', progress=?, current_image=?, current_image_label=?, error=NULL, updated_at=?, heartbeat_at=?
          WHERE id=?
        `).bind(startProgress, index + 1, itemLabel, new Date().toISOString(), new Date().toISOString(), jobID).run();
        return { index: index + 1, label: itemLabel };
      });

      let result;
      try {
        result = await step.do(
          `store image ${String(index + 1).padStart(3, '0')}`,
          { retries: { limit: 2, delay: '3 seconds', backoff: 'exponential' }, timeout: '45 seconds' },
          async () => storeRemoteHotelImage(this.env, jobID, hotelID, item, index)
        );
      } catch (error) {
        result = { ok: false, error: String(error?.message || error).slice(0, 900) };
      }

      if (result?.ok) stored += 1;
      else failed += 1;

      const progress = Math.min(96, Math.max(3, Math.round(((index + 1) / Math.max(total, 1)) * 94)));
      await step.do(`record progress ${String(index + 1).padStart(3, '0')}`, async () => {
        await this.env.HOTELS_DB.prepare(`
          UPDATE hotel_import_jobs
          SET stored_images=?, failed_images=?, progress=?, stage=?, error=?, compression_mode=COALESCE(?, compression_mode), updated_at=?, heartbeat_at=?
          WHERE id=?
        `).bind(
          stored,
          failed,
          progress,
          result?.ok ? 'media_progress' : 'image_retry_exhausted',
          result?.ok ? null : result?.error || 'IMAGE_FAILED',
          result?.compressionMode || null,
          new Date().toISOString(),
          new Date().toISOString(),
          jobID
        ).run();
        return { stored, failed, progress };
      });
    }

    const finalState = await step.do('finalize hotel import', async () => {
      const now = new Date().toISOString();
      const [roomRow, coverRow, hotelPhotoRow] = await Promise.all([
        this.env.HOTELS_DB.prepare('SELECT COUNT(*) AS count FROM hotel_rooms WHERE hotel_id=?').bind(hotelID).first(),
        this.env.HOTELS_DB.prepare('SELECT COUNT(*) AS count FROM hotel_images WHERE hotel_id=? AND is_cover=1').bind(hotelID).first(),
        this.env.HOTELS_DB.prepare("SELECT COUNT(*) AS count FROM hotel_images WHERE hotel_id=? AND category NOT IN ('room','bathroom','other')").bind(hotelID).first()
      ]);
      const roomCount = Number(roomRow?.count || 0);
      let coverCount = Number(coverRow?.count || 0);
      const hotelPhotoCount = Number(hotelPhotoRow?.count || 0);

      // If the provider's nominated cover failed but another general hotel image was saved,
      // promote that image instead of failing the whole import.
      if (coverCount === 0 && hotelPhotoCount > 0) {
        const fallbackCover = await this.env.HOTELS_DB.prepare("SELECT id FROM hotel_images WHERE hotel_id=? AND category NOT IN ('room','bathroom','other') ORDER BY position ASC, created_at ASC LIMIT 1")
          .bind(hotelID).first();
        if (fallbackCover?.id) {
          await this.env.HOTELS_DB.prepare('UPDATE hotel_images SET is_cover=0 WHERE hotel_id=?').bind(hotelID).run();
          await this.env.HOTELS_DB.prepare('UPDATE hotel_images SET is_cover=1 WHERE id=?').bind(fallbackCover.id).run();
          coverCount = 1;
        }
      }

      const mediaReady = stored > 0 && hotelPhotoCount > 0 && coverCount > 0;
      const roomsReady = !publishWhenComplete || roomCount > 0;
      const completed = mediaReady && roomsReady;
      const withWarnings = completed && failed > 0;
      const warning = withWarnings ? `${failed} из ${total} фотографий недоступны у источника; сохранено ${stored}.` : null;
      let failureReason = null;
      if (!mediaReady) failureReason = 'Не удалось сохранить ни одного общего фото отеля с обложкой; фото комнат для публикации не требуются.';
      else if (!roomsReady) failureReason = 'Не найдено ни одного подтверждённого типа номера; публикация остановлена.';

      if (completed && publishWhenComplete) {
        await this.env.HOTELS_DB.prepare("UPDATE hotels SET status='published', lifecycle_state='published', updated_at=? WHERE id=?")
          .bind(now, hotelID).run();
      } else if (completed) {
        await this.env.HOTELS_DB.prepare("UPDATE hotels SET status='draft', lifecycle_state='ready', updated_at=? WHERE id=?")
          .bind(now, hotelID).run();
      } else {
        await this.env.HOTELS_DB.prepare("UPDATE hotels SET status='draft', lifecycle_state='failed', updated_at=? WHERE id=?")
          .bind(now, hotelID).run();
      }
      await this.env.HOTELS_DB.prepare(`
        UPDATE hotel_import_jobs
        SET status=?, stage=?, progress=100, stored_images=?, failed_images=?, current_image=?, current_image_label=NULL,
            completed_at=?, updated_at=?, heartbeat_at=?, error=?, warning=?
        WHERE id=?
      `).bind(
        completed ? 'completed' : 'failed',
        completed ? (withWarnings ? 'completed_with_warnings' : 'completed') : 'integrity_failed',
        stored,
        failed,
        total,
        now,
        now,
        now,
        completed ? null : failureReason || 'IMPORT_INTEGRITY_FAILED',
        warning,
        jobID
      ).run();
      return { completed, stored, failed, total, hotelID, roomCount, coverCount, hotelPhotoCount, warning };
    });

    if (finalState.completed && publishWhenComplete) {
      await step.do('prewarm hotel translations', { retries: { limit: 2, delay: '5 seconds', backoff: 'exponential' }, timeout: '2 minutes' }, async () => {
        try {
          await prewarmHotelTranslations(this.env, hotelID);
          return { ok: true };
        } catch (error) {
          console.error('HOTEL_TRANSLATION_PREWARM_FAILED', { hotelID, error: String(error?.message || error) });
          return { ok: false };
        }
      });
    }

    await step.do('notify business device', async () => {
      try {
        const row = await this.env.HOTELS_DB.prepare('SELECT hotel_name FROM hotel_import_jobs WHERE id=?').bind(jobID).first();
        const title = finalState.completed ? 'Импорт отеля завершён' : 'Ошибка импорта отеля';
        const body = finalState.completed
          ? `${row?.hotel_name || 'Отель'} · сохранено ${finalState.stored} фото${finalState.warning ? ' · есть предупреждение' : ''}.`
          : `${row?.hotel_name || 'Отель'} · импорт требует проверки.`;
        return await sendStaffPush(this.env, title, body, { event: 'hotel_import', jobID, hotelID });
      } catch (error) {
        console.error('BUSINESS_PUSH_FAILED', String(error?.message || error));
        return { ok: false };
      }
    });

    return finalState;
  }
}

async function storeRemoteHotelImage(env, jobID, hotelID, item, fallbackPosition) {
  const sourceURL = cleanURL(item?.url);
  if (!sourceURL) throw new Error('INVALID_IMAGE_URL');
  const category = validImageCategory(item?.category) || 'gallery';
  const isCover = item?.isCover === true ? 1 : 0;
  const optimizedSourceURL = optimizeProviderImageURL(sourceURL, category, isCover === 1);
  const headers = new Headers({
    'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 Version/17.6 Mobile/15E148 Safari/604.1',
    'accept': 'image/avif,image/webp,image/jpeg,image/png,image/*;q=0.8',
    'accept-language': 'en-US,en;q=0.9'
  });
  if (cleanURL(item?.sourcePageURL)) headers.set('referer', item.sourcePageURL);

  const response = await fetch(optimizedSourceURL, { headers, redirect: 'follow' });
  if (!response.ok) throw new Error(`IMAGE_HTTP_${response.status}`);
  const sourceContentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!['image/jpeg','image/jpg','image/png','image/webp','image/avif'].includes(sourceContentType)) {
    throw new Error(`UNSUPPORTED_IMAGE_TYPE_${sourceContentType || 'unknown'}`);
  }
  const announced = Number(response.headers.get('content-length') || 0);
  if (announced > 12 * 1024 * 1024) throw new Error('IMAGE_TOO_LARGE');
  const sourceBytes = await response.arrayBuffer();
  if (!sourceBytes.byteLength) throw new Error('EMPTY_IMAGE');
  if (sourceBytes.byteLength > 12 * 1024 * 1024) throw new Error('IMAGE_TOO_LARGE');

  const provider = cleanText(item?.provider, 80) || 'unknown';
  const label = cleanText(item?.label, 600);
  const roomName = cleanText(item?.roomName, 260);
  const position = boundedInteger(item?.position, 0, 10000, fallbackPosition);
  const sourceDedupeKey = canonicalImageSourceKey(sourceURL);

  await updateImportJobStage(env, jobID, 'optimizing_image');
  const transformed = await optimizeHotelImageBytes(env, sourceBytes, { category, isCover: isCover === 1, sourceContentType });
  await updateImportJobStage(env, jobID, 'saving_to_r2');
  const contentHash = await sha256HexBytes(transformed.bytes);

  const existing = await env.HOTELS_DB.prepare(`
    SELECT id, object_key FROM hotel_images
    WHERE hotel_id=? AND (content_hash=? OR (? IS NOT NULL AND source_dedupe_key=?))
    LIMIT 1
  `).bind(hotelID, contentHash, sourceDedupeKey, sourceDedupeKey).first();
  if (existing?.id) {
    if (isCover) {
      await env.HOTELS_DB.batch([
        env.HOTELS_DB.prepare('UPDATE hotel_images SET is_cover=0 WHERE hotel_id=?').bind(hotelID),
        env.HOTELS_DB.prepare('UPDATE hotel_images SET is_cover=1, category=?, label=COALESCE(?, label), room_name=COALESCE(?, room_name), position=? WHERE id=?')
          .bind(category, label, roomName, position, existing.id)
      ]);
    }
    return { ok: true, imageID: existing.id, byteSize: transformed.bytes.byteLength, deduplicated: true, compressionMode: transformed.transformVersion };
  }

  const imageID = crypto.randomUUID();
  const objectKey = `hotels/${hotelID}/${contentHash.slice(0, 32)}.${transformed.extension}`;
  await env.HOTELS_MEDIA.put(objectKey, transformed.bytes, {
    httpMetadata: {
      contentType: transformed.contentType,
      cacheControl: 'public, max-age=31536000, immutable'
    },
    customMetadata: {
      hotelID,
      provider,
      category,
      roomName: roomName || '',
      source: 'background-import',
      contentHash,
      transformVersion: transformed.transformVersion
    }
  });

  try {
    const statements = [];
    if (isCover) statements.push(env.HOTELS_DB.prepare('UPDATE hotel_images SET is_cover=0 WHERE hotel_id=?').bind(hotelID));
    statements.push(env.HOTELS_DB.prepare(`
      INSERT INTO hotel_images (
        id, hotel_id, object_key, source_provider, source_url, category, label, room_name,
        content_type, byte_size, position, is_cover, content_hash, width, height,
        original_byte_size, transform_version, source_dedupe_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      imageID,
      hotelID,
      objectKey,
      provider,
      sourceURL,
      category,
      label,
      roomName,
      transformed.contentType,
      transformed.bytes.byteLength,
      position,
      isCover,
      contentHash,
      transformed.width,
      transformed.height,
      sourceBytes.byteLength,
      transformed.transformVersion,
      sourceDedupeKey
    ));
    await env.HOTELS_DB.batch(statements);
  } catch (error) {
    // Concurrent imports can legitimately race on the deterministic content-hash object key.
    // If another transaction already claimed the same optimized image, treat this write as
    // an idempotent success and never delete the shared R2 object out from under the winner.
    const concurrent = await env.HOTELS_DB.prepare(`
      SELECT id FROM hotel_images
      WHERE hotel_id=? AND (content_hash=? OR object_key=?)
      LIMIT 1
    `).bind(hotelID, contentHash, objectKey).first().catch(() => null);
    if (concurrent?.id) {
      if (isCover) {
        await env.HOTELS_DB.batch([
          env.HOTELS_DB.prepare('UPDATE hotel_images SET is_cover=0 WHERE hotel_id=?').bind(hotelID),
          env.HOTELS_DB.prepare('UPDATE hotel_images SET is_cover=1, category=?, label=COALESCE(?, label), room_name=COALESCE(?, room_name), position=? WHERE id=?')
            .bind(category, label, roomName, position, concurrent.id)
        ]).catch(() => {});
      }
      return { ok: true, imageID: concurrent.id, byteSize: transformed.bytes.byteLength, deduplicated: true, raced: true, compressionMode: transformed.transformVersion };
    }
    await env.HOTELS_MEDIA.delete(objectKey).catch(() => {});
    throw error;
  }

  return {
    ok: true,
    imageID,
    byteSize: transformed.bytes.byteLength,
    originalByteSize: sourceBytes.byteLength,
    width: transformed.width,
    height: transformed.height,
    contentHash,
    compressionMode: transformed.transformVersion
  };
}

async function updateImportJobStage(env, jobID, stage) {
  if (!safeID(jobID)) return;
  await env.HOTELS_DB.prepare('UPDATE hotel_import_jobs SET stage=?, updated_at=?, heartbeat_at=? WHERE id=?')
    .bind(stage, new Date().toISOString(), new Date().toISOString(), jobID).run().catch(() => {});
}

async function optimizeHotelImageBytes(env, sourceBytes, { category = 'gallery', isCover = false, sourceContentType = 'image/jpeg' } = {}) {
  const primary = imageTransformProfile(category, isCover, false);
  if (env.IMAGES) {
    try {
      let result = await runImageTransform(env, sourceBytes, primary);
      if (result.bytes.byteLength > primary.maxBytes) {
        const fallback = imageTransformProfile(category, isCover, true);
        result = await runImageTransform(env, sourceBytes, fallback);
        if (result.bytes.byteLength > fallback.maxBytes) throw new Error('OPTIMIZED_IMAGE_TOO_LARGE');
      }
      return { ...result, contentType: 'image/webp', extension: 'webp' };
    } catch (error) {
      console.warn('CLOUDFLARE_IMAGE_TRANSFORM_FALLBACK', String(error?.message || error));
    }
  }

  // Resilient fallback: the source URL itself is requested at a bounded provider
  // resolution. If that already-compressed representation fits our R2 budget, keep
  // it; never fall back to a multi-megabyte original.
  const fallback = imageTransformProfile(category, isCover, true);
  if (sourceBytes.byteLength > fallback.maxBytes) throw new Error('IMAGE_COMPRESSION_UNAVAILABLE_AND_SOURCE_TOO_LARGE');
  const normalizedType = sourceContentType === 'image/jpg' ? 'image/jpeg' : sourceContentType;
  const extension = normalizedType === 'image/png' ? 'png' : normalizedType === 'image/webp' ? 'webp' : normalizedType === 'image/avif' ? 'avif' : 'jpg';
  return {
    bytes: sourceBytes,
    width: null,
    height: null,
    transformVersion: 'provider-sized-fallback-v1',
    contentType: normalizedType,
    extension
  };
}

function imageTransformProfile(category, isCover, fallback) {
  const detailed = ['room','bathroom','restaurant','breakfast','lobby','view','spa','gym','pool','lounge'].includes(category);
  if (isCover) {
    return fallback
      ? { width: 1440, height: 1080, quality: 74, maxBytes: 700_000, transformVersion: 'cf-webp-cover-v3' }
      : { width: 1600, height: 1200, quality: 80, maxBytes: 900_000, transformVersion: 'cf-webp-cover-v3' };
  }
  return fallback
    ? { width: detailed ? 1120 : 1024, height: detailed ? 840 : 768, quality: 70, maxBytes: 480_000, transformVersion: 'cf-webp-standard-v3' }
    : { width: detailed ? 1280 : 1120, height: detailed ? 960 : 840, quality: 76, maxBytes: 650_000, transformVersion: 'cf-webp-standard-v3' };
}

async function runImageTransform(env, sourceBytes, profile) {
  const sourceStream = new Blob([sourceBytes]).stream();
  const transformedResponse = (
    await env.IMAGES
      .input(sourceStream)
      .transform({ width: profile.width, height: profile.height, fit: 'scale-down' })
      .output({ format: 'image/webp', quality: profile.quality, anim: false })
  ).response();

  if (!transformedResponse.ok) throw new Error(`IMAGE_TRANSFORM_HTTP_${transformedResponse.status}`);
  const bytes = await transformedResponse.arrayBuffer();
  if (!bytes.byteLength) throw new Error('IMAGE_TRANSFORM_EMPTY');
  const info = await env.IMAGES.info(new Blob([bytes], { type: 'image/webp' }).stream()).catch(() => null);
  return {
    bytes,
    width: nullableInteger(info?.width, 1, 20000),
    height: nullableInteger(info?.height, 1, 20000),
    transformVersion: profile.transformVersion
  };
}

function optimizeProviderImageURL(value, category = 'gallery', isCover = false) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const detailed = ['room','bathroom','restaurant','breakfast','lobby','view','spa','gym','pool','lounge'].includes(category);
    const width = isCover ? 1600 : (detailed ? 1280 : 1120);
    const height = isCover ? 1200 : (detailed ? 960 : 840);
    if (host.includes('trvl-media.com') || host.includes('expedia')) {
      url.searchParams.set('impolicy', 'resizecrop');
      url.searchParams.set('rw', String(width));
      url.searchParams.set('ra', 'fit');
    }
    if (host.includes('bstatic.com') || host.includes('booking.com')) {
      url.pathname = url.pathname.replace(/\/(?:max|square|smart)[0-9x_-]+\//ig, `/max${width}x${height}/`);
    }
    return url.toString();
  } catch {
    return value;
  }
}

function canonicalImageSourceKey(value) {
  try {
    const url = new URL(String(value || ''));
    url.hash = '';
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/(?:max|square|smart)[0-9x_-]+\//ig, '/SIZE/');
    for (const key of [...url.searchParams.keys()]) {
      if (['rw','ra','quality','impolicy','w','h','width','height'].includes(key.toLowerCase())) url.searchParams.delete(key);
    }
    return cleanText(url.toString(), 3000);
  } catch {
    return null;
  }
}

async function deleteAllHotelImagesInternal(env, hotelID) {
  const rows = await env.HOTELS_DB.prepare('SELECT object_key FROM hotel_images WHERE hotel_id=?').bind(hotelID).all();
  await Promise.allSettled((rows.results || []).map(row => env.HOTELS_MEDIA.delete(row.object_key)));
  await env.HOTELS_DB.prepare('DELETE FROM hotel_images WHERE hotel_id=?').bind(hotelID).run();
}

async function hotelTranslation(env, hotelID, rawLocale) {
  const locale = normalizeLocale(rawLocale);
  if (!locale) return json({ ok: false, error: 'UNSUPPORTED_LOCALE' }, 400);
  const hotelResponse = await hotelDataForTranslation(env, hotelID);
  if (!hotelResponse) return json({ ok: false, error: 'HOTEL_NOT_FOUND' }, 404);

  try {
    const result = await getOrCreateHotelTranslation(env, hotelID, locale, hotelResponse);
    return json({ ok: true, locale, cached: result.cached, translation: result.translation }, 200, PUBLIC_CACHE_HEADERS);
  } catch (error) {
    console.error('HOTEL_TRANSLATION_FAILED', { hotelID, locale, error: String(error?.message || error) });
    return json({ ok: false, error: 'TRANSLATION_UNAVAILABLE' }, 503);
  }
}

async function getOrCreateHotelTranslation(env, hotelID, locale, hotelResponse) {
  if (locale === 'en') return { cached: true, translation: hotelResponse };

  const version = locale === 'uz-Cyrl' ? 'uz-cyrl-deterministic-v1' : 'ai-json-v2';
  const sourceHash = await sha256Hex(`${version}|${JSON.stringify(hotelResponse)}`);
  const cached = await env.HOTELS_DB.prepare('SELECT source_hash, payload_json FROM hotel_translations WHERE hotel_id=? AND locale=?')
    .bind(hotelID, locale).first();
  if (cached?.source_hash === sourceHash) {
    try {
      return { cached: true, translation: JSON.parse(cached.payload_json) };
    } catch {}
  }

  let translated;
  if (locale === 'uz-Cyrl') {
    // Uzbek Cyrillic is derived from the cached/validated Uzbek Latin payload so
    // we do not spend a second LLM request and do not get two semantically
    // divergent Uzbek translations for one hotel.
    const latin = await getOrCreateHotelTranslation(env, hotelID, 'uz-Latn', hotelResponse);
    translated = transliterateUzbekObject(latin.translation);
  } else {
    const languageName = locale === 'ru' ? 'Russian' : 'Uzbek in Latin script';
    const system = `You are a hotel localization engine. Translate all human-readable hotel content in the supplied JSON into ${languageName}. Preserve JSON keys, IDs, URLs, numbers, measurements, times, hotel/brand/chain names and source provenance. Never invent missing information, amenities, fees, room data or distances. Do not summarize. Return ONLY valid JSON with exactly the same structure.`;
    const ai = await env.AI.run('@cf/zai-org/glm-4.7-flash', {
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify(hotelResponse) }
      ],
      max_tokens: 14000,
      temperature: 0.03
    });
    const answer = ai?.response ?? ai?.result?.response ?? ai?.choices?.[0]?.message?.content;
    translated = parseJSONEnvelope(answer);
    if (!translated || typeof translated !== 'object') throw new Error('TRANSLATION_INVALID');
  }

  const now = new Date().toISOString();
  await env.HOTELS_DB.prepare(`
    INSERT INTO hotel_translations (hotel_id, locale, source_hash, payload_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(hotel_id, locale) DO UPDATE SET source_hash=excluded.source_hash, payload_json=excluded.payload_json, updated_at=excluded.updated_at
  `).bind(hotelID, locale, sourceHash, JSON.stringify(translated), now, now).run();
  return { cached: false, translation: translated };
}

async function prewarmHotelTranslations(env, hotelID) {
  const hotelResponse = await hotelDataForTranslation(env, hotelID);
  if (!hotelResponse) return;
  await getOrCreateHotelTranslation(env, hotelID, 'ru', hotelResponse);
  await getOrCreateHotelTranslation(env, hotelID, 'uz-Latn', hotelResponse);
  await getOrCreateHotelTranslation(env, hotelID, 'uz-Cyrl', hotelResponse);
}

function transliterateUzbekObject(value, key = '') {
  if (Array.isArray(value)) return value.map(item => transliterateUzbekObject(item, key));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [childKey, child] of Object.entries(value)) out[childKey] = transliterateUzbekObject(child, childKey);
    return out;
  }
  if (typeof value !== 'string') return value;
  const preserveKeys = new Set(['id','url','sourceURL','canonicalURL','googleMapsURL','name','brand','chain','postalCode']);
  if (preserveKeys.has(key) || /^https?:\/\//i.test(value)) return value;
  return uzbekLatinToCyrillic(value);
}

function uzbekLatinToCyrillic(input) {
  const replacements = [
    [/O[‘’ʻʼ'`]/g, 'Ў'], [/o[‘’ʻʼ'`]/g, 'ў'],
    [/G[‘’ʻʼ'`]/g, 'Ғ'], [/g[‘’ʻʼ'`]/g, 'ғ'],
    [/Sh/g, 'Ш'], [/SH/g, 'Ш'], [/sh/g, 'ш'],
    [/Ch/g, 'Ч'], [/CH/g, 'Ч'], [/ch/g, 'ч'],
    [/Yo/g, 'Ё'], [/YO/g, 'Ё'], [/yo/g, 'ё'],
    [/Yu/g, 'Ю'], [/YU/g, 'Ю'], [/yu/g, 'ю'],
    [/Ya/g, 'Я'], [/YA/g, 'Я'], [/ya/g, 'я'],
    [/Ts/g, 'Ц'], [/TS/g, 'Ц'], [/ts/g, 'ц']
  ];
  let text = String(input || '');
  for (const [pattern, replacement] of replacements) text = text.replace(pattern, replacement);
  const map = {
    A:'А', B:'Б', C:'С', D:'Д', E:'Е', F:'Ф', G:'Г', H:'Ҳ', I:'И', J:'Ж', K:'К', L:'Л', M:'М', N:'Н', O:'О', P:'П', Q:'Қ', R:'Р', S:'С', T:'Т', U:'У', V:'В', W:'В', X:'Х', Y:'Й', Z:'З',
    a:'а', b:'б', c:'с', d:'д', e:'е', f:'ф', g:'г', h:'ҳ', i:'и', j:'ж', k:'к', l:'л', m:'м', n:'н', o:'о', p:'п', q:'қ', r:'р', s:'с', t:'т', u:'у', v:'в', w:'в', x:'х', y:'й', z:'з'
  };
  return [...text].map(ch => map[ch] || ch).join('');
}

async function hotelDataForTranslation(env, hotelID) {
  const hotel = await env.HOTELS_DB.prepare("SELECT * FROM hotels WHERE id=? AND status='published'").bind(hotelID).first();
  if (!hotel) return null;
  const [amenities, rooms] = await Promise.all([
    env.HOTELS_DB.prepare('SELECT amenity FROM hotel_amenities WHERE hotel_id=? ORDER BY position').bind(hotelID).all(),
    env.HOTELS_DB.prepare('SELECT id,name,max_guests,size_m2,beds,view,description,amenities_json,smoking,accessibility_json,category,bathroom_json FROM hotel_rooms WHERE hotel_id=? ORDER BY position').bind(hotelID).all()
  ]);
  return {
    name: hotel.name,
    city: hotel.city,
    country: hotel.country,
    propertyType: hotel.property_type || null,
    brand: hotel.brand || null,
    chain: hotel.chain_name || null,
    postalCode: hotel.postal_code || null,
    address: hotel.address || '',
    description: hotel.description || '',
    checkIn: hotel.check_in || null,
    checkOut: hotel.check_out || null,
    amenities: (amenities.results || []).map(x => x.amenity),
    policies: parseJSONArray(hotel.policies_json),
    nearby: parseJSONArray(hotel.nearby_json),
    facts: parseJSONArray(hotel.facts_json),
    fees: parseJSONArray(hotel.fees_json),
    services: parseJSONArray(hotel.services_json),
    highlights: parseJSONArray(hotel.highlights_json),
    importantInformation: parseJSONArray(hotel.important_information_json),
    food: parseJSONArray(hotel.food_json),
    parkingTransport: parseJSONArray(hotel.parking_transport_json),
    accessibility: parseJSONArray(hotel.accessibility_json),
    rooms: (rooms.results || []).map(row => ({
      id: row.id,
      name: row.name,
      maxGuests: row.max_guests == null ? null : Number(row.max_guests),
      sizeM2: row.size_m2 == null ? null : Number(row.size_m2),
      beds: row.beds || null,
      view: row.view || null,
      description: row.description || null,
      amenities: parseJSONArray(row.amenities_json),
      smoking: row.smoking || null,
      accessibility: parseJSONArray(row.accessibility_json),
      category: row.category || null,
      bathroom: parseJSONArray(row.bathroom_json)
    }))
  };
}

function normalizeLocale(value) {
  const raw = String(value || '').trim().replace('_', '-').toLowerCase();
  if (raw === 'en' || raw.startsWith('en-')) return 'en';
  if (raw === 'ru' || raw.startsWith('ru-')) return 'ru';
  if (['uz','uz-latn','uz-latin'].includes(raw)) return 'uz-Latn';
  if (['uz-cyrl','uz-cyrillic','uz-uz-cyrl'].includes(raw)) return 'uz-Cyrl';
  return null;
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  return sha256HexBytes(bytes);
}

async function sha256HexBytes(value) {
  const bytes = value instanceof ArrayBuffer
    ? value
    : ArrayBuffer.isView(value)
      ? value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)
      : new Uint8Array(value).buffer;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
}

function parseJSONEnvelope(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(trimmed); } catch {}
  const start = Math.min(...['{','['].map(ch => trimmed.indexOf(ch)).filter(i => i >= 0));
  const end = Math.max(trimmed.lastIndexOf('}'), trimmed.lastIndexOf(']'));
  if (Number.isFinite(start) && start >= 0 && end > start) {
    try { return JSON.parse(trimmed.slice(start, end + 1)); } catch {}
  }
  return null;
}

async function deleteAllHotelImages(env, hotelID) {
  const hotel = await env.HOTELS_DB.prepare('SELECT id FROM hotels WHERE id = ?').bind(hotelID).first();
  if (!hotel) return json({ ok: false, error: 'HOTEL_NOT_FOUND' }, 404);

  const rows = await env.HOTELS_DB.prepare(
    'SELECT object_key FROM hotel_images WHERE hotel_id = ?'
  ).bind(hotelID).all();

  await Promise.allSettled((rows.results || []).map(row => env.HOTELS_MEDIA.delete(row.object_key)));
  await env.HOTELS_DB.batch([
    env.HOTELS_DB.prepare('DELETE FROM hotel_images WHERE hotel_id = ?').bind(hotelID),
    env.HOTELS_DB.prepare("UPDATE hotels SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").bind(hotelID)
  ]);

  return json({ ok: true, deleted: (rows.results || []).length }, 200);
}

async function uploadHotelImage(request, env, hotelID) {
  const hotel = await env.HOTELS_DB.prepare('SELECT id, status FROM hotels WHERE id = ?').bind(hotelID).first();
  if (!hotel) return json({ ok: false, error: 'HOTEL_NOT_FOUND' }, 404);

  const contentType = (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/avif'].includes(contentType)) {
    return json({ ok: false, error: 'UNSUPPORTED_IMAGE_TYPE' }, 415);
  }

  const sourceBytes = await request.arrayBuffer();
  if (!sourceBytes.byteLength) return json({ ok: false, error: 'EMPTY_IMAGE' }, 400);
  if (sourceBytes.byteLength > 12 * 1024 * 1024) return json({ ok: false, error: 'IMAGE_TOO_LARGE' }, 413);

  const provider = cleanText(request.headers.get('x-iumrah-source'), 80) || 'manual';
  const category = validImageCategory(request.headers.get('x-iumrah-category')) || 'gallery';
  const sourceURL = cleanURL(request.headers.get('x-iumrah-source-url'));
  const label = cleanText(request.headers.get('x-iumrah-label'), 600);
  const roomName = cleanText(request.headers.get('x-iumrah-room'), 260);
  const position = boundedInteger(request.headers.get('x-iumrah-position'), 0, 10000, 0);
  const isCover = request.headers.get('x-iumrah-cover') === '1' ? 1 : 0;

  const transformed = await optimizeHotelImageBytes(env, sourceBytes, { category, isCover: isCover === 1, sourceContentType: contentType });
  const contentHash = await sha256HexBytes(transformed.bytes);
  const sourceDedupeKey = sourceURL ? canonicalImageSourceKey(sourceURL) : null;
  const existing = await env.HOTELS_DB.prepare('SELECT id FROM hotel_images WHERE hotel_id=? AND content_hash=? LIMIT 1')
    .bind(hotelID, contentHash).first();
  if (existing?.id) {
    if (isCover) {
      await env.HOTELS_DB.batch([
        env.HOTELS_DB.prepare('UPDATE hotel_images SET is_cover=0 WHERE hotel_id=?').bind(hotelID),
        env.HOTELS_DB.prepare('UPDATE hotel_images SET is_cover=1, category=?, label=COALESCE(?, label), room_name=COALESCE(?, room_name), position=? WHERE id=?')
          .bind(category, label, roomName, position, existing.id)
      ]);
    }
    return json({ ok: true, deduplicated: true, image: { id: existing.id, url: publicImagePath(hotelID, existing.id) } }, 200);
  }

  const imageID = crypto.randomUUID();
  const objectKey = `hotels/${hotelID}/${contentHash.slice(0, 32)}.${transformed.extension}`;
  await env.HOTELS_MEDIA.put(objectKey, transformed.bytes, {
    httpMetadata: { contentType: transformed.contentType, cacheControl: 'public, max-age=31536000, immutable' },
    customMetadata: { hotelID, provider, category, roomName: roomName || '', contentHash, transformVersion: transformed.transformVersion }
  });

  const statements = [];
  if (isCover) statements.push(env.HOTELS_DB.prepare('UPDATE hotel_images SET is_cover = 0 WHERE hotel_id = ?').bind(hotelID));
  statements.push(
    env.HOTELS_DB.prepare(`
      INSERT INTO hotel_images (
        id, hotel_id, object_key, source_provider, source_url, category, label, room_name, content_type,
        byte_size, position, is_cover, content_hash, width, height, original_byte_size, transform_version, source_dedupe_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      imageID, hotelID, objectKey, provider, sourceURL, category, label, roomName, transformed.contentType,
      transformed.bytes.byteLength, position, isCover, contentHash, transformed.width, transformed.height,
      sourceBytes.byteLength, transformed.transformVersion, sourceDedupeKey
    )
  );
  statements.push(env.HOTELS_DB.prepare("UPDATE hotels SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").bind(hotelID));

  try {
    await env.HOTELS_DB.batch(statements);
  } catch (error) {
    // Same race protection as the background workflow: a unique content-hash collision
    // means the optimized object is already owned by this hotel, not that R2 should delete it.
    const concurrent = await env.HOTELS_DB.prepare(`
      SELECT id FROM hotel_images
      WHERE hotel_id=? AND (content_hash=? OR object_key=?)
      LIMIT 1
    `).bind(hotelID, contentHash, objectKey).first().catch(() => null);
    if (concurrent?.id) {
      if (isCover) {
        await env.HOTELS_DB.batch([
          env.HOTELS_DB.prepare('UPDATE hotel_images SET is_cover=0 WHERE hotel_id=?').bind(hotelID),
          env.HOTELS_DB.prepare('UPDATE hotel_images SET is_cover=1, category=?, label=COALESCE(?, label), room_name=COALESCE(?, room_name), position=? WHERE id=?')
            .bind(category, label, roomName, position, concurrent.id)
        ]).catch(() => {});
      }
      return json({ ok: true, deduplicated: true, raced: true, image: { id: concurrent.id, url: publicImagePath(hotelID, concurrent.id) } }, 200);
    }
    await env.HOTELS_MEDIA.delete(objectKey).catch(() => {});
    throw error;
  }

  return json({
    ok: true,
    image: {
      id: imageID,
      url: publicImagePath(hotelID, imageID),
      position,
      isCover: isCover === 1,
      category,
      roomName: roomName || '',
      width: transformed.width,
      height: transformed.height,
      byteSize: transformed.bytes.byteLength,
      originalByteSize: sourceBytes.byteLength,
      format: transformed.extension
    }
  }, 201);
}

async function serveHotelImage(env, hotelID, imageID, admin) {
  const row = await env.HOTELS_DB.prepare(`
    SELECT hi.object_key, hi.content_type, h.status
    FROM hotel_images hi
    JOIN hotels h ON h.id = hi.hotel_id
    WHERE hi.hotel_id = ? AND hi.id = ?
  `).bind(hotelID, imageID).first();

  if (!row) return new Response('Not Found', { status: 404 });
  if (!admin && row.status !== 'published') return new Response('Not Found', { status: 404 });

  const object = await env.HOTELS_MEDIA.get(row.object_key);
  if (!object) return new Response('Not Found', { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('content-type', row.content_type || headers.get('content-type') || 'image/jpeg');
  headers.set('cache-control', admin ? 'private, max-age=60' : 'public, max-age=86400, s-maxage=604800');
  if (object.httpEtag) headers.set('etag', object.httpEtag);
  return new Response(object.body, { headers });
}

async function deleteHotel(env, hotelID) {
  const hotel = await env.HOTELS_DB.prepare('SELECT id FROM hotels WHERE id=?').bind(hotelID).first();
  if (!hotel) return json({ ok: false, error: 'HOTEL_NOT_FOUND' }, 404);

  const [images, jobs] = await Promise.all([
    env.HOTELS_DB.prepare('SELECT object_key FROM hotel_images WHERE hotel_id = ?').bind(hotelID).all(),
    env.HOTELS_DB.prepare("SELECT * FROM hotel_import_jobs WHERE hotel_id=? AND status IN ('queued','running')").bind(hotelID).all()
  ]);

  // Never delete a canonical row while a workflow can still write into it.
  for (const job of jobs.results || []) await terminateWorkflowForJob(env, job);

  const result = await env.HOTELS_DB.prepare('DELETE FROM hotels WHERE id = ?').bind(hotelID).run();
  if (!result.meta?.changes) return json({ ok: false, error: 'HOTEL_NOT_FOUND' }, 404);

  await Promise.allSettled((images.results || []).map(row => env.HOTELS_MEDIA.delete(row.object_key)));
  return json({ ok: true, deletedHotelID: hotelID });
}

async function summaryRow(env, hotelID) {
  return env.HOTELS_DB.prepare(`
    SELECT
      h.id,
      h.name,
      h.city,
      h.stars,
      h.rating,
      h.review_count,
      h.status,
      h.lifecycle_state,
      h.updated_at,
      hps.provider AS locked_source_provider,
      hps.source_url AS locked_source_url,
      ${HOTEL_PRICE_SELECT},
      (SELECT COUNT(*) FROM hotel_images hi WHERE hi.hotel_id = h.id) AS image_count,
      (SELECT COUNT(*) FROM hotel_rooms hr WHERE hr.hotel_id = h.id) AS room_count,
      (
        SELECT hi.id FROM hotel_images hi
        WHERE hi.hotel_id = h.id
        ORDER BY hi.is_cover DESC, hi.position ASC, hi.created_at ASC
        LIMIT 1
      ) AS cover_image_id
    FROM hotels h
    LEFT JOIN hotel_price_cache hp ON hp.hotel_id = h.id
    LEFT JOIN hotel_price_overrides hpo ON hpo.hotel_id = h.id
    LEFT JOIN hotel_price_sources hps ON hps.hotel_id = h.id
    WHERE h.id = ?
  `).bind(hotelID).first();
}

function hotelSummary(row, includeSource = true, options = {}) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    city: resolveHotelCityRow(row),
    stars: row.stars == null ? null : Number(row.stars),
    rating: row.rating == null ? null : Number(row.rating),
    reviewCount: row.review_count == null ? null : Number(row.review_count),
    status: row.status,
    lifecycleState: row.lifecycle_state || row.status,
    coverImageURL: row.cover_image_id ? publicImagePath(row.id, row.cover_image_id) : null,
    imageCount: Number(row.image_count || 0),
    roomCount: Number(row.room_count || 0),
    price: hotelPriceFromRow(row, { publicUsable: options.publicUsablePrice === true, manualOnly: options.manualOnlyPrice === true }),
    sourceProvider: includeSource ? (row.locked_source_provider || row.price_provider || null) : null,
    sourceURL: includeSource ? (row.locked_source_url || row.price_source_url || null) : null,
    updatedAt: row.updated_at
  };
}

function sourceRow(row) {
  return {
    id: row.id,
    provider: row.provider,
    sourceURL: row.source_url,
    name: row.source_name,
    city: row.city,
    country: row.country,
    propertyType: row.property_type,
    brand: row.brand || null,
    chain: row.chain_name || null,
    postalCode: row.postal_code || null,
    address: row.address,
    description: row.description,
    stars: row.stars == null ? null : Number(row.stars),
    rating: row.rating == null ? null : Number(row.rating),
    ratingScale: row.rating_scale == null ? null : Number(row.rating_scale),
    reviewCount: row.review_count == null ? null : Number(row.review_count),
    latitude: row.latitude == null ? null : Number(row.latitude),
    longitude: row.longitude == null ? null : Number(row.longitude),
    checkIn: row.check_in,
    checkOut: row.check_out,
    images: parseJSONArray(row.images_json),
    amenities: parseJSONArray(row.amenities_json),
    roomNames: parseJSONArray(row.room_names_json),
    rooms: parseJSONArray(row.room_details_json),
    policies: parseJSONArray(row.policies_json),
    providerHotelID: row.provider_hotel_id || null,
    canonicalURL: row.canonical_url || null,
    googleMapsURL: row.google_maps_url || null,
    nearby: parseJSONArray(row.nearby_json),
    facts: parseJSONArray(row.facts_json),
    fees: parseJSONArray(row.fees_json),
    services: parseJSONArray(row.services_json),
    highlights: parseJSONArray(row.highlights_json),
    importantInformation: parseJSONArray(row.important_information_json),
    food: parseJSONArray(row.food_json),
    parkingTransport: parseJSONArray(row.parking_transport_json),
    accessibility: parseJSONArray(row.accessibility_json),
    rawIdentity: parseJSONObject(row.raw_identity_json),
    checkedAt: row.checked_at
  };
}

async function uniqueSlug(env, hotelID, seed) {
  const base = slugify(seed) || `hotel-${hotelID.toLowerCase()}`;
  let candidate = base;
  for (let index = 0; index < 20; index += 1) {
    const row = await env.HOTELS_DB.prepare('SELECT id FROM hotels WHERE slug = ? AND id != ? LIMIT 1').bind(candidate, hotelID).first();
    if (!row) return candidate;
    candidate = `${base}-${index + 2}`;
  }
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

function publicImagePath(hotelID, imageID) {
  return `/api/catalog/hotels/${encodeURIComponent(hotelID)}/images/${encodeURIComponent(imageID)}`;
}

function pathParts(pathname, prefix) {
  const suffix = pathname.slice(prefix.length).replace(/^\/+|\/+$/g, '');
  return suffix ? suffix.split('/').map(decodeURIComponent) : [];
}

function safeID(value) {
  const text = String(value || '').trim();
  return /^[A-Za-z0-9._:-]{1,128}$/.test(text) ? text : null;
}

function cleanText(value, maxLength = 1000) {
  if (value == null) return null;
  const text = String(value).replace(/\u0000/g, '').trim();
  if (!text) return null;
  return text.slice(0, maxLength);
}

function detectUmrahCity(...values) {
  for (const value of values.flat(Infinity)) {
    if (value == null) continue;
    const text = String(value)
      .toLowerCase()
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) continue;
    if (/\b(?:makkah|mecca|makkah al mukarramah|makkah almukarramah)\b/.test(text) || text.includes('مكة')) return 'Makkah';
    if (/\b(?:ajyad|jabal omar|ibrahim al khalil|ibrahim alkhalil|al hajlah|al misfalah)\b/.test(text)) return 'Makkah';
    if (/\b(?:madinah|medina|al madinah|madinah al munawwarah|medina al munawwarah)\b/.test(text) || text.includes('المدينة')) return 'Madinah';
    if (/\b(?:abi ayoub al ansari|abi ayyub al ansari|abu ayoub al ansari|abu ayyub al ansari|masjid an nabawi|masjid al nabawi|prophet'?s mosque)\b/.test(text)) return 'Madinah';
  }
  return null;
}

function cityFromCoordinates(latitude, longitude) {
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const makkahDistance = (lat - 21.4225) * (lat - 21.4225) + (lon - 39.8262) * (lon - 39.8262);
  const madinahDistance = (lat - 24.4672) * (lat - 24.4672) + (lon - 39.6111) * (lon - 39.6111);
  if (makkahDistance <= 0.20 && makkahDistance < madinahDistance) return 'Makkah';
  if (madinahDistance <= 0.20 && madinahDistance < makkahDistance) return 'Madinah';
  return null;
}

function resolveHotelCityRow(row) {
  return detectUmrahCity(
    row?.city,
    row?.name,
    row?.address,
    row?.source_city_hint,
    row?.source_address_hint,
    row?.locked_source_url,
    row?.price_source_url
  ) || cityFromCoordinates(row?.latitude, row?.longitude)
    || cityFromCoordinates(row?.source_latitude_hint, row?.source_longitude_hint)
    || cleanText(row?.city, 80) || 'Unknown';
}

function resolveHotelCityDraft(draft) {
  const sources = Array.isArray(draft?.sources) ? draft.sources.slice(0, 10) : [];
  const textualHints = [
    draft?.city, draft?.name, draft?.address, draft?.googleMapsURL,
    ...sources.flatMap(source => [source?.city, source?.name, source?.address, source?.sourceURL, source?.canonicalURL, source?.googleMapsURL])
  ];
  const textual = detectUmrahCity(textualHints);
  if (textual) return textual;
  const directCoordinates = cityFromCoordinates(draft?.latitude, draft?.longitude);
  if (directCoordinates) return directCoordinates;
  for (const source of sources) {
    const sourceCoordinates = cityFromCoordinates(source?.latitude, source?.longitude);
    if (sourceCoordinates) return sourceCoordinates;
  }
  return canonicalCity(draft?.city);
}

function canonicalCity(value) {
  const original = String(value || '').trim();
  return detectUmrahCity(original) || cleanText(original, 80);
}

function cleanURL(value) {
  try {
    const url = new URL(String(value || ''));
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url.toString().slice(0, 3000);
  } catch {
    return null;
  }
}

function nullableInteger(value, min, max) {
  if (value == null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const integer = Math.trunc(number);
  return integer >= min && integer <= max ? integer : null;
}

function boundedInteger(value, min, max, fallback) {
  const parsed = nullableInteger(value, min, max);
  return parsed == null ? fallback : parsed;
}

function nullableNumber(value, min, max) {
  if (value == null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) return null;
  return number;
}


function isStructuredNoiseText(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  const lower = text.toLowerCase();
  const tokens = [
    '\\"', '__typename', 'agencybusinessmodels', 'availability_group',
    'bedroomfilter', 'bed_type_group', 'startdate', 'trip-type',
    'shoppingproductcontent', 'egdsplaintext'
  ];
  if (tokens.some(token => lower.includes(token))) return true;
  if (text.includes('{') && (text.includes('"') || text.includes(':'))) return true;
  if (text.includes('[') && text.includes('"')) return true;
  if (lower.includes('see all about this property') && lower.includes('explore the area')) return true;
  if (lower.includes('free wififree cribs') || lower.includes('breakfast for a feerestaurant')) return true;
  return false;
}

function safeHumanText(value, maxLength = 1200) {
  const text = cleanText(value, maxLength);
  if (!text || isStructuredNoiseText(text)) return null;
  return text.replace(/\s+/g, ' ').trim();
}

function canonicalAmenity(value) {
  const text = safeHumanText(value, 240);
  if (!text) return null;
  const lower = text.toLowerCase();
  if (/free wi[- ]?fi|complimentary wi[- ]?fi/.test(lower)) return 'Free WiFi';
  if (/wi[- ]?fi|wireless internet/.test(lower)) return 'Wi‑Fi';
  if (/restaurants?/.test(lower)) return 'Restaurant';
  if (/coffee shop|café|cafe/.test(lower)) return 'Coffee shop';
  if (/24[- ]hour front desk|24 hour front desk/.test(lower)) return '24-hour front desk';
  if (/fitness cent(?:er|re)|\bgym\b/.test(lower)) return 'Fitness center';
  if (/swimming pool|outdoor pool|indoor pool/.test(lower)) return 'Swimming pool';
  if (/airport shuttle|shuttle service/.test(lower)) return 'Airport shuttle';
  if (/valet parking/.test(lower)) return 'Valet parking';
  if (/luggage storage|baggage storage/.test(lower)) return 'Luggage storage';
  return text;
}

function canonicalAmenities(value, maxItems = 320) {
  if (!Array.isArray(value)) return [];
  const result = [];
  const seen = new Set();
  for (const raw of value) {
    const item = canonicalAmenity(raw);
    if (!item) continue;
    const key = item.toLowerCase();
    if (key === 'wi‑fi' && seen.has('free wifi')) continue;
    if (key === 'free wifi') {
      const index = result.findIndex(x => x.toLowerCase() === 'wi‑fi');
      if (index >= 0) result.splice(index, 1);
      seen.delete('wi‑fi');
    }
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
    if (result.length >= maxItems) break;
  }
  return result;
}

function uniqueStrings(value, maxItems, maxLength) {
  if (!Array.isArray(value)) return [];
  const result = [];
  const seen = new Set();
  for (const item of value) {
    const text = safeHumanText(item, maxLength);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(text);
    if (result.length >= maxItems) break;
  }
  return result;
}


function safeObjectArray(value, maxItems = 120, maxBytes = 30_000) {
  if (!Array.isArray(value)) return [];
  const result = [];
  const seen = new Set();
  let used = 2;
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const clean = {};
    let rejected = false;
    for (const [key, raw] of Object.entries(item)) {
      const safeKey = String(key).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
      if (!safeKey) continue;
      if (typeof raw === 'string') {
        const text = safeHumanText(raw, 1200);
        if (!text && String(raw || '').trim()) { rejected = true; break; }
        clean[safeKey] = text;
      } else if (typeof raw === 'number' && Number.isFinite(raw)) clean[safeKey] = raw;
      else if (typeof raw === 'boolean') clean[safeKey] = raw;
      else if (raw == null) clean[safeKey] = null;
    }
    if (rejected) continue;
    const encoded = JSON.stringify(clean);
    if (encoded === '{}' || used + encoded.length > maxBytes) continue;
    const signature = encoded.toLowerCase();
    if (seen.has(signature)) continue;
    seen.add(signature);
    result.push(clean);
    used += encoded.length + 1;
    if (result.length >= maxItems) break;
  }
  return result;
}

function sanitizeObject(value, maxBytes = 30_000) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const clean = {};
  for (const [key, raw] of Object.entries(value)) {
    const safeKey = String(key).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
    if (!safeKey) continue;
    if (typeof raw === 'string') clean[safeKey] = cleanText(raw, 2000);
    else if (typeof raw === 'number' && Number.isFinite(raw)) clean[safeKey] = raw;
    else if (typeof raw === 'boolean') clean[safeKey] = raw;
    else if (raw == null) clean[safeKey] = null;
  }
  const encoded = JSON.stringify(clean);
  return encoded.length <= maxBytes ? clean : {};
}

function cleanLifecycleState(value) {
  const state = cleanText(value, 40);
  return ['draft','importing','ready','published','failed','archived'].includes(state) ? state : null;
}

function parseJSONObject(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value || '{}') : value;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function validImageCategory(value) {
  const category = cleanText(typeof value === 'string' ? value : value?.rawValue, 30);
  return ['exterior','room','bathroom','lobby','restaurant','breakfast','gym','spa','pool','lounge','facility','amenity','view','gallery','other'].includes(category) ? category : null;
}

function isPlausibleRoomName(value) {
  const text = cleanText(value, 260);
  if (!text || text.length < 4 || text.length > 240) return false;
  const lower = text.toLowerCase();
  const roomToken = /(room|suite|studio|apartment|villa|king|queen|twin|double|triple|quad|family|deluxe|superior|classic|standard|executive|premier|номер|люкс|комнат|غرفة|جناح)/i;
  const blocked = /(how much|parking|breakfast|restaurant|front desk|reception|concierge|room service|meeting room|prayer room|laundry room|locker room|non-smoking rooms|family rooms|guest rooms|choose your room|select room|room amenities|frequently asked|question|answer|policy|check[- ]?in|check[- ]?out)/i;
  if (!roomToken.test(text) || blocked.test(text)) return false;
  if (/[?؟]$/.test(text)) return false;
  const words = lower.split(/\s+/).filter(Boolean);
  if (words.length > 24) return false;
  return true;
}

function canonicalSourceURL(value) {
  try {
    const url = new URL(String(value || ''));
    url.hash = '';
    const keep = new Set(['hotelid','hotel_id','propertyid','property_id','id']);
    for (const key of [...url.searchParams.keys()]) {
      if (!keep.has(key.toLowerCase())) url.searchParams.delete(key);
    }
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url.toString().slice(0, 3000);
  } catch {
    return null;
  }
}

function canonicalHotelKey(name, city, address, latitude, longitude) {
  const namePart = [...hotelNameTokens(name)].sort().join('-');
  const cityPart = slugify(canonicalCity(city) || city || '');
  let locationPart = '';
  const lat = nullableNumber(latitude, -90, 90);
  const lng = nullableNumber(longitude, -180, 180);
  if (lat != null && lng != null) locationPart = `${lat.toFixed(3)}:${lng.toFixed(3)}`;
  else locationPart = [...addressTokens(normalizedAddress(address))].slice(0, 8).join('-');
  return cleanText(`${cityPart}|${namePart}|${locationPart}`, 600);
}

function normalizedAddress(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(saudi arabia|kingdom of saudi arabia|ksa)\b/g, ' ')
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hotelNameTokens(value) {
  const stop = new Set(['hotel','hotels','resort','resorts','by','the','makkah','mecca','madinah','medina','saudi','arabia','ksa','فندق']);
  const text = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, ' ');
  return new Set(text.split(/\s+/).filter(token => token.length > 1 && !stop.has(token)));
}

function addressTokens(value) {
  const stop = new Set(['street','st','road','rd','district','area','saudi','arabia','makkah','mecca','madinah','medina']);
  return new Set(String(value || '').split(/\s+/).filter(token => token.length > 1 && !stop.has(token)));
}

function tokenSimilarity(a, b) {
  if (!(a instanceof Set) || !(b instanceof Set) || !a.size || !b.size) return 0;
  let overlap = 0;
  for (const token of a) if (b.has(token)) overlap += 1;
  return overlap / Math.max(a.size, b.size);
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const toRad = deg => deg * Math.PI / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function googleMapsURL(latitude, longitude, address) {
  const lat = nullableNumber(latitude, -90, 90);
  const lng = nullableNumber(longitude, -180, 180);
  const query = lat != null && lng != null ? `${lat},${lng}` : cleanText(address, 900);
  return query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : null;
}

function slugify(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 140);
}

function parseJSONArray(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function readJSON(request, maxBytes) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > maxBytes) {
    return { ok: false, response: json({ ok: false, error: 'PAYLOAD_TOO_LARGE' }, 413) };
  }

  let text;
  try {
    text = await request.text();
  } catch {
    return { ok: false, response: json({ ok: false, error: 'INVALID_BODY' }, 400) };
  }

  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    return { ok: false, response: json({ ok: false, error: 'PAYLOAD_TOO_LARGE' }, 413) };
  }

  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, response: json({ ok: false, error: 'INVALID_JSON' }, 400) };
  }
}

function methodNotAllowed() {
  return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
}

function json(value, status = 200, extraHeaders) {
  const headers = new Headers(JSON_HEADERS);
  if (extraHeaders) {
    Object.entries(extraHeaders).forEach(([key, value]) => headers.set(key, value));
  }
  return new Response(JSON.stringify(value), { status, headers });
}

function corsHeaders(request) {
  const origin = request.headers.get('origin') || '';
  const allowed = origin === 'https://iumrah.app' || origin === 'https://www.iumrah.app';
  return {
    'access-control-allow-origin': allowed ? origin : 'https://iumrah.app',
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'Content-Type,Authorization,Idempotency-Key,X-Iumrah-Business-Session,X-Iumrah-Allow-Possible-Duplicate,X-Iumrah-Source,X-Iumrah-Position,X-Iumrah-Cover,X-Iumrah-Category,X-Iumrah-Source-URL,X-Iumrah-Label,X-Iumrah-Room',
    'vary': 'Origin'
  };
}

function withCors(response, request) {
  const headers = new Headers(response.headers);
  Object.entries(corsHeaders(request)).forEach(([key, value]) => headers.set(key, value));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
