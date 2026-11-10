// iumrah Intelligence — privacy-constrained event collection and Gemini analysis.
// This module deliberately does not ingest freeform event properties, text, IDs of
// bookings, device identifiers, passport fields, search queries or chat content.
const EVENT_NAMES = new Set([
  'app_first_open', 'app_open', 'app_background', 'screen_view', 'screen_exit',
  'tap', 'onboarding_step', 'onboarding_completed', 'search_started',
  'search_results', 'flight_selected', 'hotel_selected', 'price_viewed',
  'checkout_started', 'booking_submitted', 'booking_completed', 'error', 'crash'
]);
const FUNNEL = [
  ['app_open', 'Запуски'],
  ['onboarding_completed', 'Онбординг'],
  ['search_started', 'Поиск'],
  ['flight_selected', 'Рейс'],
  ['hotel_selected', 'Отель'],
  ['checkout_started', 'Оформление'],
  ['booking_completed', 'Бронирование']
];
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const respond = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
const code = (value, max = 64) => typeof value === 'string' && value.length <= max && /^[A-Za-z0-9_.-]+$/.test(value) ? value : null;
// Identifier fields must be random UUIDv4, never names, passport numbers or device IDs.
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value.toLowerCase() : null;
const count = value => Number.isFinite(Number(value)) ? Number(value) : 0;

export function validateIntelligenceBatch(body, currentTime = Date.now()) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const visitorId = uuid(body.visitorId);
  const sessionId = uuid(body.sessionId);
  const platform = body.platform === 'ios' || body.platform === 'android' ? body.platform : null;
  const appVersion = body.appVersion === undefined || body.appVersion === '' ? '' : code(body.appVersion, 32);
  if (!visitorId || visitorId.length < 12 || !sessionId || sessionId.length < 12 || !platform || appVersion === null) return null;
  if (!Array.isArray(body.events) || body.events.length === 0 || body.events.length > 30) return null;
  const ids = new Set();
  const events = [];
  for (const item of body.events) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const eventId = uuid(item.id);
    const eventName = code(item.name, 40);
    const screen = item.screen === undefined || item.screen === '' ? '' : code(item.screen, 64);
    const elementId = item.elementId === undefined || item.elementId === '' ? '' : code(item.elementId, 64);
    const stamp = item.occurredAt;
    const timestamp = typeof stamp === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(stamp) ? Date.parse(stamp) : (stamp === undefined ? currentTime : NaN);
    const durationMs = item.durationMs === undefined ? null : item.durationMs;
    if (!Number.isFinite(timestamp) || timestamp > currentTime + 300000 || timestamp < currentTime - 7 * 86400000) return null;
    if (durationMs !== null && (eventName !== 'screen_exit' || !Number.isInteger(durationMs) || durationMs < 0 || durationMs > 3600000)) return null;
    if (!eventId || eventId.length < 12 || !EVENT_NAMES.has(eventName) || screen === null || elementId === null || ids.has(eventId)) return null;
    ids.add(eventId);
    events.push({ eventId, eventName, screen, elementId, occurredAt: new Date(timestamp).toISOString(), durationMs });
  }
  return { visitorId, sessionId, platform, appVersion, events };
}

export async function intelligenceIngest(request, env) {
  if (request.method !== 'POST') return respond({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
  const type = request.headers.get('content-type') || '';
  if (!/^application\/json(?:\s*;|$)/i.test(type)) return respond({ ok: false, error: 'JSON_REQUIRED' }, 415);
  if (Number(request.headers.get('content-length') || 0) > 16384) return respond({ ok: false, error: 'PAYLOAD_TOO_LARGE' }, 413);
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > 16384) return respond({ ok: false, error: 'PAYLOAD_TOO_LARGE' }, 413);
  let value;
  try { value = JSON.parse(raw); } catch { return respond({ ok: false, error: 'INVALID_JSON' }, 400); }
  const batch = validateIntelligenceBatch(value);
  if (!batch) return respond({ ok: false, error: 'INVALID_ANALYTICS_BATCH' }, 400);
  if (!env.HOTELS_DB) return respond({ ok: false, error: 'DATABASE_UNAVAILABLE' }, 503);
  const now = new Date().toISOString();
  try {
    const statements = batch.events.map(event => env.HOTELS_DB.prepare(`
      INSERT OR IGNORE INTO intelligence_events
      (event_id, visitor_id, session_id, event_name, screen, element_id, platform, app_version, occurred_at, duration_ms, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(event.eventId, batch.visitorId, batch.sessionId, event.eventName, event.screen,
      event.elementId, batch.platform, batch.appVersion, event.occurredAt, event.durationMs, now));
    await env.HOTELS_DB.batch(statements);
  } catch (error) {
    console.error('INTELLIGENCE_INGEST_FAILED', String(error?.message || error));
    return respond({ ok: false, error: 'INGEST_UNAVAILABLE' }, 503);
  }
  return respond({ ok: true, accepted: batch.events.length }, 202);
}

function daysParam(url) {
  const requested = Number(url.searchParams.get('days') || 7);
  return [7, 14, 30].includes(requested) ? requested : 7;
}
function lowerBound(days, reference = Date.now()) {
  return new Date(reference - days * 86400000).toISOString();
}

export async function intelligenceOverview(env, days = 7) {
  const since = lowerBound(days);
  const [events, names, screens, daily, durations] = await Promise.all([
    env.HOTELS_DB.prepare(`SELECT COUNT(*) AS events, COUNT(DISTINCT visitor_id) AS visitors,
      COUNT(DISTINCT session_id) AS sessions FROM intelligence_events WHERE created_at>=?`).bind(since).first(),
    env.HOTELS_DB.prepare(`SELECT event_name, COUNT(*) AS events, COUNT(DISTINCT visitor_id) AS visitors
      FROM intelligence_events WHERE created_at>=? GROUP BY event_name ORDER BY events DESC`).bind(since).all(),
    env.HOTELS_DB.prepare(`SELECT screen, COUNT(*) AS views, COUNT(DISTINCT visitor_id) AS visitors
      FROM intelligence_events WHERE created_at>=? AND event_name='screen_view' AND screen<>''
      GROUP BY screen ORDER BY views DESC LIMIT 15`).bind(since).all(),
    env.HOTELS_DB.prepare(`SELECT substr(created_at,1,10) AS day, COUNT(DISTINCT visitor_id) AS visitors,
      COUNT(*) AS events FROM intelligence_events WHERE created_at>=?
      GROUP BY substr(created_at,1,10) ORDER BY day ASC`).bind(since).all(),
    env.HOTELS_DB.prepare(`SELECT screen, AVG(duration_ms) AS avg_duration_ms, COUNT(*) AS exits
      FROM intelligence_events WHERE created_at>=? AND event_name='screen_exit' AND screen<>''
      AND duration_ms IS NOT NULL GROUP BY screen`).bind(since).all()
  ]);
  const byName = new Map((names.results || []).map(row => [row.event_name, row]));
  const byScreenDuration = new Map((durations.results || []).map(row => [row.screen, row]));
  return {
    days, periodStart: since, periodEnd: new Date().toISOString(),
    events: count(events?.events), visitors: count(events?.visitors), sessions: count(events?.sessions),
    funnel: FUNNEL.map(([name, title]) => ({ event: name, title, visitors: count(byName.get(name)?.visitors) })),
    eventCounts: (names.results || []).map(row => ({ name: row.event_name, events: count(row.events), visitors: count(row.visitors) })),
    screens: (screens.results || []).map(row => ({ screen: row.screen, views: count(row.views), visitors: count(row.visitors),
      averageSeconds: byScreenDuration.has(row.screen) ? Math.round(count(byScreenDuration.get(row.screen).avg_duration_ms) / 1000) : null,
      timedExits: count(byScreenDuration.get(row.screen)?.exits) })),
    daily: (daily.results || []).map(row => ({ day: row.day, visitors: count(row.visitors), events: count(row.events) }))
  };
}

async function recentSessions(env, url) {
  const days = daysParam(url);
  const rows = await env.HOTELS_DB.prepare(`
    SELECT session_id, platform, MIN(occurred_at) AS started_at, MAX(occurred_at) AS last_event_at,
      COUNT(*) AS event_count FROM intelligence_events WHERE created_at>=?
    GROUP BY session_id, platform ORDER BY last_event_at DESC LIMIT 40
  `).bind(lowerBound(days)).all();
  return respond({ ok: true, days, sessions: (rows.results || []).map(row => ({
    sessionId: row.session_id, platform: row.platform, startedAt: row.started_at,
    lastEventAt: row.last_event_at, eventCount: count(row.event_count)
  })) });
}

async function sessionJourney(env, sessionId) {
  if (!uuid(sessionId)) return respond({ ok: false, error: 'INVALID_SESSION_ID' }, 400);
  const rows = await env.HOTELS_DB.prepare(`SELECT event_name, screen, element_id, occurred_at AS created_at
    FROM intelligence_events WHERE session_id=? ORDER BY occurred_at ASC, rowid ASC LIMIT 250`).bind(sessionId).all();
  return respond({ ok: true, sessionId, events: (rows.results || []).map(row => ({
    name: row.event_name, screen: row.screen, elementId: row.element_id, at: row.created_at
  })) });
}

async function listReports(env) {
  const reports = await env.HOTELS_DB.prepare(`SELECT id, status, model, period_start, period_end,
    event_count, report_json, error_code, created_at, completed_at
    FROM intelligence_reports ORDER BY created_at DESC LIMIT 12`).all();
  return respond({ ok: true, reports: (reports.results || []).map(row => ({
    id: row.id, status: row.status, model: row.model, periodStart: row.period_start,
    periodEnd: row.period_end, eventCount: count(row.event_count),
    report: row.report_json ? safeReportJSON(row.report_json) : null,
    error: row.error_code, createdAt: row.created_at, completedAt: row.completed_at
  })) });
}

function safeReportJSON(raw) {
  try { return JSON.parse(raw); } catch { return null; }
}

export async function intelligenceAdmin(request, env, url, user) {
  if (String(user?.role || '').toLowerCase() !== 'superadmin') {
    return respond({ ok: false, error: 'FORBIDDEN' }, 403);
  }
  const parts = url.pathname.replace(/^\/api\/admin\/hotels\/intelligence\/?/, '').split('/').filter(Boolean);
  if (!parts.length && request.method === 'GET') {
    return respond({ ok: true, overview: await intelligenceOverview(env, daysParam(url)) });
  }
  if (parts.length === 1 && parts[0] === 'sessions' && request.method === 'GET') return recentSessions(env, url);
  if (parts.length === 2 && parts[0] === 'sessions' && request.method === 'GET') return sessionJourney(env, parts[1]);
  if (parts.length === 1 && parts[0] === 'reports' && request.method === 'GET') return listReports(env);
  if (parts.length === 2 && parts[0] === 'reports' && parts[1] === 'generate' && request.method === 'POST') {
    const result = await runIntelligenceReport(env, { manual: true });
    return respond(result, result.ok ? 200 : result.code === 'GEMINI_KEY_MISSING' ? 503 : 400);
  }
  return respond({ ok: false, error: 'NOT_FOUND' }, 404);
}

function summarizeForGemini(overview, previous) {
  return { current: {
    periodStart: overview.periodStart, periodEnd: overview.periodEnd, days: overview.days,
    visitors: overview.visitors, sessions: overview.sessions, events: overview.events,
    funnel: overview.funnel, eventCounts: overview.eventCounts, screens: overview.screens,
    daily: overview.daily
  }, previous: {
    visitors: previous.visitors, sessions: previous.sessions, events: previous.events,
    funnel: previous.funnel
  } };
}

export async function runIntelligenceReport(env, { manual = false, now = new Date() } = {}) {
  const cadence = Number(env.INTELLIGENCE_REPORT_CADENCE_DAYS || 1) === 2 ? 2 : 1;
  const key = manual ? `manual_${crypto.randomUUID()}` : `scheduled_${now.toISOString().slice(0, 10)}`;
  if (!manual) {
    // Capped event retention prevents indefinite storage of journeys.
    await env.HOTELS_DB.prepare('DELETE FROM intelligence_events WHERE created_at < ?')
      .bind(lowerBound(90, now.getTime())).run();
    await env.HOTELS_DB.prepare('DELETE FROM intelligence_reports WHERE created_at < ?')
      .bind(lowerBound(180, now.getTime())).run();
  }
  if (!manual && cadence === 2) {
    const previous = await env.HOTELS_DB.prepare(`SELECT created_at FROM intelligence_reports
      WHERE report_key LIKE 'scheduled_%' ORDER BY created_at DESC LIMIT 1`).first();
    if (previous && now.getTime() - Date.parse(previous.created_at) < 46 * 3600000) return { ok: true, skipped: 'cadence' };
  }
  // Insert an idempotency record before paying for an AI request.
  const id = crypto.randomUUID();
  const overview = await intelligenceOverview(env, 7);
  const start = overview.periodStart;
  const end = overview.periodEnd;
  const inserted = await env.HOTELS_DB.prepare(`INSERT OR IGNORE INTO intelligence_reports
    (id, report_key, status, period_start, period_end, event_count, created_at)
    VALUES (?, ?, 'running', ?, ?, ?, ?)`).bind(id, key, start, end, overview.events, now.toISOString()).run();
  if (inserted.meta?.changes === 0) return { ok: true, skipped: 'already_running_or_done' };
  const finish = async (status, model = '', report = null, error = null) => {
    await env.HOTELS_DB.prepare(`UPDATE intelligence_reports SET status=?, model=?, report_json=?, error_code=?, completed_at=? WHERE id=?`)
      .bind(status, model, report ? JSON.stringify(report) : null, error, new Date().toISOString(), id).run();
  };
  if (overview.events < 10 || overview.visitors < 3) {
    await finish('no_data');
    return { ok: true, status: 'no_data', reason: 'INSUFFICIENT_EVENTS' };
  }
  const keyValue = String(env.GEMINI_API_KEY || '').trim();
  if (!keyValue) {
    await finish('failed', '', null, 'GEMINI_KEY_MISSING');
    return { ok: false, code: 'GEMINI_KEY_MISSING' };
  }
  const model = /^gemini-[a-z0-9.-]+$/.test(String(env.GEMINI_MODEL || '')) ? env.GEMINI_MODEL : 'gemini-2.5-flash';
  try {
    // Previous 7 days are calculated from safe aggregate metrics, not raw journeys.
    const previousStart = lowerBound(14, now.getTime());
    const previousEnd = lowerBound(7, now.getTime());
    const previousRows = await env.HOTELS_DB.prepare(`SELECT event_name, COUNT(DISTINCT visitor_id) AS visitors,
      COUNT(*) AS events FROM intelligence_events WHERE created_at>=? AND created_at<?
      GROUP BY event_name`).bind(previousStart, previousEnd).all();
    const prev = new Map((previousRows.results || []).map(row => [row.event_name, row]));
    const previousTotals = await env.HOTELS_DB.prepare(`SELECT COUNT(*) AS events,
      COUNT(DISTINCT visitor_id) AS visitors, COUNT(DISTINCT session_id) AS sessions
      FROM intelligence_events WHERE created_at>=? AND created_at<?`).bind(previousStart, previousEnd).first();
    const previous = {
      visitors: count(previousTotals?.visitors), sessions: count(previousTotals?.sessions), events: count(previousTotals?.events),
      funnel: FUNNEL.map(([name, title]) => ({ event: name, title, visitors: count(prev.get(name)?.visitors) }))
    };
    const prompt = [
      'Ты продуктовый аналитик iumrah, B2C приложения для самостоятельной организации умры с перелётом, отелями, гидом и бронированием.',
      'Анализируй только агрегированные показатели. Не придумывай причины или подтверждённые результаты A/B-тестов.',
      'Предлагай конкретные проверяемые улучшения UI/UX, онбординга, доверия, поиска, конверсии и маркетинга.',
      'Для каждой рекомендации укажи наблюдение из данных, гипотезу, действие и метрику проверки.',
      'Если данных мало или воронка неполная, прямо скажи об этом. Данные являются агрегатами, не отдельными пользователями.',
      'Ответ по-русски. Верни JSON строго по схеме.',
      JSON.stringify(summarizeForGemini(overview, previous))
    ].join('\n');
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': keyValue },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2, maxOutputTokens: 2500,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              summary: { type: 'STRING' },
              recommendations: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
                area: { type: 'STRING' }, priority: { type: 'STRING' },
                finding: { type: 'STRING' }, recommendation: { type: 'STRING' },
                metric: { type: 'STRING' }
              }, required: ['area', 'priority', 'finding', 'recommendation', 'metric'] } }
            }, required: ['summary', 'recommendations']
          }
        }
      }),
      signal: AbortSignal.timeout(60000)
    });
    if (!response.ok) throw new Error(`GEMINI_HTTP_${response.status}`);
    const result = await response.json();
    const content = result?.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('') || '';
    const parsed = JSON.parse(content);
    if (typeof parsed?.summary !== 'string' || !Array.isArray(parsed?.recommendations)) throw new Error('INVALID_GEMINI_RESPONSE');
    const safe = {
      summary: parsed.summary.slice(0, 3000),
      recommendations: parsed.recommendations.slice(0, 8).map(item => ({
        area: String(item.area || '').slice(0, 100), priority: String(item.priority || '').slice(0, 40),
        finding: String(item.finding || '').slice(0, 1100),
        recommendation: String(item.recommendation || '').slice(0, 1400),
        metric: String(item.metric || '').slice(0, 350)
      }))
    };
    await finish('ready', model, safe);
    return { ok: true, status: 'ready', reportId: id, report: safe };
  } catch (error) {
    // Never log prompts, input data, model output, secrets, or user identifiers.
    const message = String(error?.message || 'UNKNOWN');
    const errorCode = /^GEMINI_HTTP_\d+$/.test(message) ? message : 'GEMINI_REPORT_FAILED';
    console.error('INTELLIGENCE_REPORT_FAILED', errorCode);
    await finish('failed', model, null, errorCode);
    return { ok: false, code: errorCode };
  }
}
