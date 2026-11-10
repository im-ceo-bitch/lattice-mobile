// iumrah Intelligence uses the authoritative Business device-session service.
// During the unified-backend migration, iumrah.app issues the protected device
// token while the new Worker may be bound to a different D1 database. Never
// accept a site login cookie alone in place of the registered device session.
const SESSION_PATH = '/api/admin/hotels/security/sessions';
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,512}$/;

export async function verifyIntelligenceBusinessSession(request, env, fetcher = fetch) {
  const cookie = request.headers.get('cookie') || '';
  const token = request.headers.get('x-iumrah-business-session') || '';
  if (!cookie || !TOKEN_PATTERN.test(token)) return {ok: false, status: 401, error: 'BUSINESS_SESSION_REQUIRED'};

  let url;
  try {
    const authority = new URL(String(env.AUTH_SESSION_URL || 'https://iumrah.app/api/auth/staff/session'));
    // The credentials must only reach the same trusted first-party host that
    // already validated the staff account. Never follow external redirects.
    if (authority.protocol !== 'https:' || !['iumrah.app','www.iumrah.app'].includes(authority.hostname)) {
      return {ok: false, status: 503, error: 'BUSINESS_SESSION_AUTHORITY_UNAVAILABLE'};
    }
    url = new URL(SESSION_PATH, authority.origin);
  } catch {
    return {ok: false, status: 503, error: 'BUSINESS_SESSION_AUTHORITY_UNAVAILABLE'};
  }

  let response;
  try {
    response = await fetcher(url.toString(), {
      method: 'GET',
      headers: {
        cookie,
        'x-iumrah-business-session': token,
        accept: 'application/json',
        'user-agent': request.headers.get('user-agent') || 'iumrah-business'
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(10000)
    });
  } catch {
    return {ok: false, status: 503, error: 'BUSINESS_SESSION_AUTHORITY_UNAVAILABLE'};
  }
  // No fallback to an unverified cookie: expired/revoked sessions remain invalid.
  if (response.status === 401 || response.status === 403) {
    return {ok: false, status: 401, error: 'BUSINESS_SESSION_REQUIRED'};
  }
  if (!response.ok) {
    return {ok: false, status: 503, error: 'BUSINESS_SESSION_AUTHORITY_UNAVAILABLE'};
  }
  const payload = await response.json().catch(() => null);
  const sessionId = payload?.currentSessionID;
  if (payload?.ok !== true || typeof sessionId !== 'string' || sessionId.length < 16) {
    return {ok: false, status: 503, error: 'BUSINESS_SESSION_AUTHORITY_INVALID_RESPONSE'};
  }
  return {ok: true, session: {session_id: sessionId}};
}
