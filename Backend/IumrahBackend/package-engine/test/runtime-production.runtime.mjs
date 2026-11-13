import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../.runtime-dist/index.js';
import { publicAviasalesData } from '../.runtime-dist/aviasales-data.js';
import { resolveAviasalesSelection } from '../.runtime-dist/package-search.js';
import { curatedPrimaryHotel } from '../.runtime-dist/generator-components.js';
import { searchIgnavFlightsForCuration } from '../.runtime-dist/ignav-flights.js';
import { resolvePublicCuratedFlightRecommendation, saveCuratedFlightAdmin } from '../.runtime-dist/curated-flights.js';

function statementFor(handler) {
  return {
    values: [],
    bind(...values) { this.values = values; return this; },
    async first() { return handler('first', this.values); },
    async all() { return handler('all', this.values); },
    async run() { return handler('run', this.values) ?? { success: true }; },
  };
}

function hotelDb({ curated = null, fallback = null, publishedHotel = null, sources = [] } = {}) {
  return {
    prepare(sql) {
      assert.equal(sql.includes('%COLUMN%'), false, 'Primary Hotel SQL must not leak the normalization placeholder into D1');
      if (sql.includes('FROM primary_hotels p')) return statementFor(async () => curated);
      if (sql.includes('FROM hotels h') && sql.includes('ORDER BY h.rating DESC')) return statementFor(async () => fallback);
      if (sql.includes("SELECT id FROM hotels WHERE id = ?")) return statementFor(async (_kind, values) => values[0] === publishedHotel?.id ? publishedHotel : null);
      if (sql.includes('FROM hotel_sources')) return statementFor(async () => ({ results: sources }));
      throw new Error(`Unexpected SQL in runtime test: ${sql}`);
    },
  };
}

test('curated Primary Hotel resolves from Business-approved last-known/manual-priced catalog inventory', async () => {
  const env = { HOTELS_DB: hotelDb({ curated: { position: 1, hotel_id: 'makkah-5', stars: 5, city: 'Makkah' } }) };
  const response = await curatedPrimaryHotel(new URL('https://iumrah.app/api/package/primary-hotel?stars=5&city=Makkah&tier=comfort'), env);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.hotelId, 'makkah-5');
  assert.equal(body.matchType, 'curatedPrimary');
  assert.equal(body.pricingMode, 'catalog48h');
  assert.equal('amount' in body, false);
  assert.equal('basePriceUsd' in body, false);
});

test('Primary Hotel canonicalizes Medina/Madina aliases before querying Business curation', async () => {
  const env = { HOTELS_DB: hotelDb({ curated: { position: 1, hotel_id: 'madinah-5', stars: 5, city: 'Medina' } }) };
  for (const alias of ['Medina', 'Madina', 'Medinah', 'Al Medina', 'Al Madina']) {
    const response = await curatedPrimaryHotel(new URL(`https://iumrah.app/api/package/primary-hotel?stars=5&city=${encodeURIComponent(alias)}&tier=luxury`), env);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.hotelId, 'madinah-5');
    assert.equal(body.city, 'Madinah');
  }
});

test('catalog fallback can select a Business-approved priced hotel without returning supplier price data', async () => {
  const env = { HOTELS_DB: hotelDb({ fallback: { id: 'catalog-3', stars: 3, city: 'Makkah' } }) };
  const response = await curatedPrimaryHotel(new URL('https://iumrah.app/api/package/primary-hotel?stars=3&city=Makkah&tier=standard'), env);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.hotelId, 'catalog-3');
  assert.equal(body.isFallback, true);
  assert.equal(body.pricingMode, 'catalog48h');
  assert.equal('amount' in body, false);
});

test('invalid Primary Hotel query fails closed', async () => {
  const response = await curatedPrimaryHotel(new URL('https://iumrah.app/api/package/primary-hotel?stars=9&city=Makkah'), { HOTELS_DB: hotelDb() });
  assert.equal(response.status, 400);
});

test('removed legacy package routes stay 404 on the active worker', async () => {
  const removed = [
    '/api/package/flights/provider-search',
    '/api/package/search-sessions',
    '/api/package/search-sessions/abc',
    '/api/package/flight-options/quote',
    '/api/package/bookings',
    '/api/package/hotel-component-price',
  ];
  for (const path of removed) {
    const response = await worker.fetch(new Request(`https://iumrah.app${path}`, { method: path.includes('primary-hotels') ? 'GET' : 'POST' }), {});
    assert.equal(response.status, 404, `${path} must stay removed`);
  }
});

test('server package quote route is active and rejects malformed input without writing anything', async () => {
  const response = await worker.fetch(new Request('https://iumrah.app/api/package/quote', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{',
  }), {});
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'INVALID_JSON');
});

function searchBody(overrides = {}) {
  return {
    legs: [
      { origin: 'TAS', destination: 'JED', departure_date: '2027-03-03', max_stops: 1, departure_time_range: { earliest_hour: 6, latest_hour: 17 } },
      { origin: 'MED', destination: 'TAS', departure_date: '2027-03-10', max_stops: 1, departure_time_range: { earliest_hour: 6, latest_hour: 23 } },
    ],
    adults: 2,
    children: 1,
    infants_on_lap: 1,
    cabin_class: 'economy',
    min_carry_on_bags: 1,
    min_checked_bags: 1,
    max_price: 1500,
    airlines_include: ['HY'],
    allow_self_transfer: false,
    ...overrides,
  };
}

function segment({ carrier, number, origin, destination, departureLocal, departureZone, departureUTC, arrivalLocal, arrivalZone, arrivalUTC, duration }) {
  return {
    marketing_carrier_code: carrier,
    flight_number: number,
    operating_carrier_name: carrier === 'HY' ? 'Uzbekistan Airways' : 'flydubai',
    departure_airport: origin,
    departure_time_local: departureLocal,
    departure_timezone: departureZone,
    departure_time_utc: departureUTC,
    arrival_airport: destination,
    arrival_time_local: arrivalLocal,
    arrival_timezone: arrivalZone,
    arrival_time_utc: arrivalUTC,
    duration_minutes: duration,
    aircraft: 'Airbus A321neo',
  };
}

function validIgnavItinerary({ id = '5e4fcd2f1dc340649eb19f6ee2afb57a', amount = 612, status = 'verified', firstDepartureUTC = '2027-03-03T03:10:00Z' } = {}) {
  return {
    price: { amount, currency: 'USD', status },
    legs: [
      {
        carrier: 'Uzbekistan Airways',
        duration_minutes: 410,
        segments: [segment({ carrier: 'HY', number: '337', origin: 'TAS', destination: 'JED', departureLocal: '2027-03-03T08:10:00', departureZone: 'Asia/Tashkent', departureUTC: firstDepartureUTC, arrivalLocal: '2027-03-03T11:00:00', arrivalZone: 'Asia/Riyadh', arrivalUTC: '2027-03-03T08:00:00Z', duration: 410 })],
      },
      {
        carrier: 'flydubai',
        duration_minutes: 555,
        segments: [segment({ carrier: 'FZ', number: '1942', origin: 'MED', destination: 'TAS', departureLocal: '2027-03-10T10:20:00', departureZone: 'Asia/Riyadh', departureUTC: '2027-03-10T07:20:00Z', arrivalLocal: '2027-03-10T18:35:00', arrivalZone: 'Asia/Tashkent', arrivalUTC: '2027-03-10T13:35:00Z', duration: 555 })],
      },
    ],
    cabin_class: 'economy',
    bags: { carry_on: 1, checked: 1 },
    requires_self_transfer: false,
    ignav_id: id,
  };
}

function validIgnavResponse(itineraries = [validIgnavItinerary()]) {
  return {
    legs: [
      { origin: 'TAS', destination: 'JED', departure_date: '2027-03-03' },
      { origin: 'MED', destination: 'TAS', departure_date: '2027-03-10' },
    ],
    itineraries,
  };
}

test('hotel pricing-source endpoint exposes Business-maintained provider identity for a published hotel', async () => {
  const env = {
    HOTELS_DB: hotelDb({
      publishedHotel: { id: 'hotel-1' },
      sources: [
        { provider: 'booking.com', source_url: 'https://www.booking.com/hotel/sa/example.html', provider_hotel_id: '12345', canonical_url: 'https://www.booking.com/hotel/sa/example.html' },
        { provider: 'expedia', source_url: 'https://www.expedia.com/Hotel-Information-Example.h123.Hotel-Information', provider_hotel_id: '123', canonical_url: null },
      ],
    }),
  };
  const response = await worker.fetch(new Request('https://iumrah.app/api/package/hotel/hotel-1/pricing-sources'), env);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.sources.length, 2);
  assert.deepEqual(body.sources.map((x) => x.provider), ['booking', 'expedia']);
  assert.equal(body.sources[0].providerHotelID, '12345');
});

test('Ignav flight route fails closed when Worker secret is missing', async () => {
  const response = await worker.fetch(new Request('https://iumrah.app/api/package/flights/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(searchBody()),
  }), {});
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'FLIGHT_PROVIDER_NOT_CONFIGURED');
});

test('Ignav proxy uses one flexible open-jaw request and returns multiple complete itinerary fares', async () => {
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url: String(url), headers: init.headers, body: JSON.parse(init.body) };
    return new Response(JSON.stringify(validIgnavResponse([
      validIgnavItinerary(),
      validIgnavItinerary({ id: '6e4fcd2f1dc340649eb19f6ee2afb57b', amount: 655 }),
    ])), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const response = await worker.fetch(new Request('https://iumrah.app/api/package/flights/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(searchBody()),
    }), { IGNAV_API_KEY: 'test-secret' });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.source, 'ignav');
    assert.equal(body.itineraries.length, 2);
    assert.equal(body.itineraries[0].legs.length, 2);
    assert.equal(body.itineraries[0].legs[0].flight_number, 'HY 337');
    assert.equal(body.itineraries[0].legs[1].flight_number, 'FZ 1942');
    assert.equal(body.itineraries[0].fare_scope, 'total_party');
    assert.equal(body.itineraries[0].price.amount, 612);
    assert.equal(body.itineraries[0].legs[0].segments[0].departure_time_utc, '2027-03-03T03:10:00Z');
    assert.equal(captured.url, 'https://ignav.com/api/fares/search');
    assert.equal(captured.headers['x-api-key'], 'test-secret');
    assert.equal(captured.body.market, 'US');
    assert.equal(captured.body.adults, 2);
    assert.equal(captured.body.children, 1);
    assert.equal(captured.body.infants_on_lap, 1);
    assert.equal(captured.body.legs.length, 2);
    assert.equal(captured.body.legs[0].max_stops, undefined);
    assert.equal(captured.body.legs[1].origin, 'MED');
    assert.equal(captured.body.max_price, undefined);
    assert.equal(captured.body.min_checked_bags, undefined);
    assert.equal(captured.body.airlines_include, undefined);
    assert.equal(captured.body.allow_self_transfer, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Ignav proxy rejects unverified fares, accepts local-time fallback and rejects malformed timestamps', async () => {
  const originalFetch = globalThis.fetch;
  let call = 0;
  globalThis.fetch = async () => {
    call += 1;
    let itinerary;
    if (call === 1) {
      itinerary = validIgnavItinerary({ status: 'unverified' });
    } else if (call === 2) {
      itinerary = validIgnavItinerary({ firstDepartureUTC: null });
    } else {
      itinerary = validIgnavItinerary({ firstDepartureUTC: null });
      itinerary.legs[0].segments[0].departure_time_local = 'not-a-date';
    }
    return new Response(JSON.stringify(validIgnavResponse([itinerary])), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const indicative = await worker.fetch(new Request('https://iumrah.app/api/package/flights/search', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(searchBody()),
    }), { IGNAV_API_KEY: 'test-secret' });
    assert.equal(indicative.status, 200);
    const indicativeBody = await indicative.json();
    assert.deepEqual(indicativeBody.itineraries, []);

    const localFallback = await worker.fetch(new Request('https://iumrah.app/api/package/flights/search', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(searchBody()),
    }), { IGNAV_API_KEY: 'test-secret' });
    assert.equal(localFallback.status, 200);
    const localFallbackBody = await localFallback.json();
    assert.equal(localFallbackBody.itineraries.length, 1);
    assert.equal(localFallbackBody.itineraries[0].legs[0].segments[0].departure_time_utc, '2027-03-03T03:10:00.000Z');

    const malformed = await worker.fetch(new Request('https://iumrah.app/api/package/flights/search', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(searchBody()),
    }), { IGNAV_API_KEY: 'test-secret' });
    assert.equal(malformed.status, 200);
    assert.deepEqual((await malformed.json()).itineraries, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Ignav proxy does not retry non-retryable authentication failures', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: { code: 'invalid_api_key' } }), { status: 401, headers: { 'content-type': 'application/json' } });
  };
  try {
    const response = await worker.fetch(new Request('https://iumrah.app/api/package/flights/search', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(searchBody()),
    }), { IGNAV_API_KEY: 'bad-secret' });
    assert.equal(response.status, 502);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Ignav proxy rejects malformed one-to-two-leg requests before upstream call', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error('must not call upstream'); };
  try {
    const invalidBodies = [
      { ...searchBody(), legs: [] },
      { ...searchBody(), legs: [
        { origin: 'TAS', destination: 'JED', departure_date: '2027-03-03' },
        { origin: 'MED', destination: 'TAS', departure_date: '2027-03-10' },
        { origin: 'TAS', destination: 'DXB', departure_date: '2027-03-11' },
      ] },
      { ...searchBody(), legs: [{ origin: 'TAS', destination: 'JED', departure_date: '2026-02-31' }, { origin: 'MED', destination: 'TAS', departure_date: '2027-03-10' }] },
      { ...searchBody(), allow_self_transfer: 'false' },
      { ...searchBody(), legs: [{ origin: 'TAS', destination: 'JED', departure_date: '2027-03-10' }, { origin: 'MED', destination: 'TAS', departure_date: '2027-03-03' }] },
    ];
    for (const body of invalidBodies) {
      const response = await worker.fetch(new Request('https://iumrah.app/api/package/flights/search', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      }), { IGNAV_API_KEY: 'test-secret' });
      assert.equal(response.status, 400);
    }
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Ignav proxy accepts one-way searches and returns the complete one-leg fare', async () => {
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (_url, init) => {
    captured = JSON.parse(init.body);
    const itinerary = validIgnavItinerary();
    itinerary.legs = [itinerary.legs[0]];
    return new Response(JSON.stringify({
      legs: [{ origin: 'TAS', destination: 'JED', departure_date: '2027-03-03' }],
      itineraries: [itinerary],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const body = searchBody({ legs: [{ origin: 'TAS', destination: 'JED', departure_date: '2027-03-03' }] });
    const response = await worker.fetch(new Request('https://iumrah.app/api/package/flights/search', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }), { IGNAV_API_KEY: 'test-secret' });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(captured.legs.length, 1);
    assert.equal(payload.itineraries.length, 1);
    assert.equal(payload.itineraries[0].legs.length, 1);
    assert.equal(payload.itineraries[0].price.amount, 612);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function flightCacheDb() {
  const searches = new Map();
  const locks = new Map();
  const calendar = new Map();
  return {
    searches,
    calendar,
    prepare(sql) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      return {
        values: [],
        bind(...values) { this.values = values; return this; },
        async first() {
          if (normalized.startsWith('SELECT response_json, provider_observed_at, cached_at, fresh_until FROM flight_search_cache')) {
            const [key, now, today] = this.values;
            const row = searches.get(key);
            if (!row || row.fresh_until <= now || row.outbound_date < today) return null;
            return row;
          }
          throw new Error(`Unexpected cache first SQL: ${normalized}`);
        },
        async all() {
          if (normalized.startsWith('SELECT outbound_date, inbound_date, min_total_fare, min_per_traveler_fare, currency, observed_at FROM flight_calendar_fares')) {
            const [outOrigin, outDestination, inOrigin, inDestination, signature, cabin, from, to, selectedOutbound] = this.values;
            const results = [...calendar.values()].filter((row) =>
              row.outbound_origin === outOrigin && row.outbound_destination === outDestination &&
              (row.inbound_origin ?? '') === (inOrigin ?? '') && (row.inbound_destination ?? '') === (inDestination ?? '') &&
              row.passenger_signature === signature && row.cabin_class === cabin &&
              row.outbound_date >= from && row.outbound_date <= to &&
              (selectedOutbound == null || row.outbound_date === selectedOutbound)
            );
            return { results };
          }
          return { results: [] };
        },
        async run() {
          if (normalized.startsWith('CREATE TABLE') || normalized.startsWith('CREATE INDEX')) return { success: true, meta: { changes: 0 } };
          if (normalized.startsWith('DELETE FROM flight_search_cache WHERE fresh_until <= ? OR outbound_date < ?')) {
            const [now, today] = this.values;
            for (const [key, row] of searches) if (row.fresh_until <= now || row.outbound_date < today) searches.delete(key);
            return { success: true, meta: { changes: 1 } };
          }
          if (normalized.startsWith('DELETE FROM flight_calendar_fares WHERE delete_after < ? OR outbound_date < ?')) {
            const [today] = this.values;
            for (const [key, row] of calendar) if (row.delete_after < today || row.outbound_date < today) calendar.delete(key);
            return { success: true, meta: { changes: 1 } };
          }
          if (normalized.startsWith('DELETE FROM flight_search_locks WHERE expires_at <= ?')) {
            const [now] = this.values;
            for (const [key, expires] of locks) if (expires <= now) locks.delete(key);
            return { success: true, meta: { changes: 1 } };
          }
          if (normalized.startsWith('DELETE FROM flight_search_locks WHERE cache_key = ? AND expires_at <= ?')) {
            const [key, now] = this.values;
            if ((locks.get(key) ?? '') <= now) locks.delete(key);
            return { success: true, meta: { changes: 1 } };
          }
          if (normalized.startsWith('INSERT OR IGNORE INTO flight_search_locks')) {
            const [key, expires] = this.values;
            if (locks.has(key)) return { success: true, meta: { changes: 0 } };
            locks.set(key, expires);
            return { success: true, meta: { changes: 1 } };
          }
          if (normalized.startsWith('DELETE FROM flight_search_locks WHERE cache_key = ?')) {
            locks.delete(this.values[0]);
            return { success: true, meta: { changes: 1 } };
          }
          if (normalized.startsWith('INSERT INTO ignav_api_usage_monthly')) return { success: true, meta: { changes: 1 } };
          if (normalized.startsWith('INSERT INTO flight_search_cache')) {
            const [cache_key, request_json, response_json, outbound_origin, outbound_destination, outbound_date, inbound_origin, inbound_destination, inbound_date, passenger_signature, cabin_class, provider_observed_at, cached_at, fresh_until, delete_after] = this.values;
            searches.set(cache_key, { request_json, response_json, outbound_origin, outbound_destination, outbound_date, inbound_origin, inbound_destination, inbound_date, passenger_signature, cabin_class, provider_observed_at, cached_at, fresh_until, delete_after });
            return { success: true, meta: { changes: 1 } };
          }
          if (normalized.startsWith('INSERT INTO flight_calendar_fares')) {
            const [calendar_key, outbound_origin, outbound_destination, inbound_origin, inbound_destination, passenger_signature, cabin_class, outbound_date, inbound_date, min_total_fare, min_per_traveler_fare, currency, observed_at, updated_at, delete_after] = this.values;
            calendar.set(calendar_key, { outbound_origin, outbound_destination, inbound_origin, inbound_destination, passenger_signature, cabin_class, outbound_date, inbound_date, min_total_fare, min_per_traveler_fare, currency, observed_at, updated_at, delete_after });
            return { success: true, meta: { changes: 1 } };
          }
          throw new Error(`Unexpected cache run SQL: ${normalized}`);
        },
      };
    },
  };
}

test('same provider search is served from D1 cache without a second upstream request, even when UI filters differ', async () => {
  const originalFetch = globalThis.fetch;
  let upstreamCalls = 0;
  globalThis.fetch = async () => {
    upstreamCalls += 1;
    return new Response(JSON.stringify(validIgnavResponse()), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const db = flightCacheDb();
  const env = { IGNAV_API_KEY: 'test-secret', HOTELS_DB: db };
  try {
    const makeRequest = (body = searchBody()) => new Request('https://iumrah.app/api/package/flights/search', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const first = await worker.fetch(makeRequest(), env);
    assert.equal(first.status, 200);
    assert.equal((await first.json()).cache.status, 'miss');
    const second = await worker.fetch(makeRequest(searchBody({
      max_price: 900,
      airlines_include: ['FZ'],
      min_checked_bags: 2,
      allow_self_transfer: true,
    })), env);
    assert.equal(second.status, 200);
    const secondBody = await second.json();
    assert.equal(secondBody.cache.status, 'hit');
    assert.equal(secondBody.itineraries.length, 1);
    assert.equal(upstreamCalls, 1);
    assert.equal(db.searches.size, 1);
    assert.equal(db.calendar.size, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test('flight fare calendar reads accumulated D1 observations without calling upstream', async () => {
  const originalFetch = globalThis.fetch;
  let upstreamCalls = 0;
  globalThis.fetch = async () => {
    upstreamCalls += 1;
    return new Response(JSON.stringify(validIgnavResponse()), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const db = flightCacheDb();
  const env = { IGNAV_API_KEY: 'test-secret', HOTELS_DB: db };
  try {
    const search = await worker.fetch(new Request('https://iumrah.app/api/package/flights/search', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(searchBody()),
    }), env);
    assert.equal(search.status, 200);
    assert.equal(upstreamCalls, 1);

    const calendarResponse = await worker.fetch(new Request('https://iumrah.app/api/package/flights/calendar?outbound_origin=TAS&outbound_destination=JED&inbound_origin=MED&inbound_destination=TAS&adults=2&children=1&infants_in_seat=0&infants_on_lap=1&cabin_class=economy&from=2027-03-01&to=2027-03-31'), env);
    assert.equal(calendarResponse.status, 200);
    const body = await calendarResponse.json();
    assert.equal(body.ok, true);
    assert.equal(body.prices.length, 1);
    assert.equal(body.prices[0].outbound_date, '2027-03-03');
    assert.equal(body.prices[0].inbound_date, '2027-03-10');
    assert.equal(body.prices[0].min_total_fare, 612);
    assert.equal(body.prices[0].min_per_traveler_fare, 153);
    assert.equal(upstreamCalls, 1, 'calendar endpoint must never buy a provider search');
  } finally {
    globalThis.fetch = originalFetch;
  }
});


function curationRequest({ mode = 'round_trip', inboundOrigin = 'JED', inboundDestination = 'TAS' } = {}) {
  const legs = mode === 'outbound_one_way'
    ? [{ origin: 'TAS', destination: 'JED', departure_date: '2027-03-03', max_stops: 0 }]
    : mode === 'return_one_way'
      ? [{ origin: inboundOrigin, destination: inboundDestination, departure_date: '2027-03-10', max_stops: 0 }]
      : [
          { origin: 'TAS', destination: 'JED', departure_date: '2027-03-03', max_stops: 0 },
          { origin: inboundOrigin, destination: inboundDestination, departure_date: '2027-03-10', max_stops: 0 },
        ];
  return new Request('https://iumrah.app/api/admin/package/flights/curation-search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      legs,
      adults: 1,
      children: 0,
      infants_in_seat: 0,
      infants_on_lap: 0,
      cabin_class: 'economy',
      airlines_include: ['HY'],
      allow_self_transfer: false,
      curation_mode: mode,
    }),
  });
}

function curationProviderLeg({ origin, destination, date, number }) {
  const departure = `${date}T08:00:00Z`;
  const arrival = `${date}T12:00:00Z`;
  return {
    carrier: 'Uzbekistan Airways',
    duration_minutes: 240,
    segments: [segment({
      carrier: 'HY', number, origin, destination,
      departureLocal: `${date}T13:00:00`, departureZone: 'Asia/Tashkent', departureUTC: departure,
      arrivalLocal: `${date}T15:00:00`, arrivalZone: 'Asia/Riyadh', arrivalUTC: arrival,
      duration: 240,
    })],
  };
}

function curationOneWayProviderResponse({ origin, destination, date, amount, number, id }) {
  return {
    itineraries: [{
      price: { amount, currency: 'USD', status: 'verified' },
      outbound: curationProviderLeg({ origin, destination, date, number }),
      cabin_class: 'economy',
      bags: { carry_on: 1, checked: 1 },
      requires_self_transfer: false,
      ignav_id: id,
    }],
  };
}

function curationRoundTripProviderResponse({ amount = 430, id = 'rt-provider-1' } = {}) {
  return {
    itineraries: [{
      price: { amount, currency: 'USD', status: 'verified' },
      outbound: curationProviderLeg({ origin: 'TAS', destination: 'JED', date: '2027-03-03', number: '337' }),
      inbound: curationProviderLeg({ origin: 'JED', destination: 'TAS', date: '2027-03-10', number: '338' }),
      cabin_class: 'economy',
      bags: { carry_on: 1, checked: 1 },
      requires_self_transfer: false,
      ignav_id: id,
    }],
  };
}

test('Business curation exact-return mode compares true Ignav round-trip against our summed one-way pair', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const endpoint = new URL(String(url)).pathname;
    const body = JSON.parse(init.body);
    calls.push({ endpoint, body });
    if (endpoint.endsWith('/fares/round-trip')) {
      return new Response(JSON.stringify(curationRoundTripProviderResponse({ amount: 430 })), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (body.origin === 'TAS') {
      return new Response(JSON.stringify(curationOneWayProviderResponse({ origin: 'TAS', destination: 'JED', date: '2027-03-03', amount: 260, number: '337', id: 'ow-out-1' })), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify(curationOneWayProviderResponse({ origin: 'JED', destination: 'TAS', date: '2027-03-10', amount: 250, number: '338', id: 'ow-ret-1' })), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const response = await searchIgnavFlightsForCuration(curationRequest(), { IGNAV_API_KEY: 'test-secret' });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.diagnostics.mode, 'round_trip_compare');
    assert.equal(payload.diagnostics.dedicated_round_trip_count, 1);
    assert.equal(payload.diagnostics.paired_one_way_count, 1);
    assert.deepEqual(calls.map((x) => x.endpoint), ['/api/fares/one-way', '/api/fares/one-way', '/api/fares/round-trip']);
    const trueReturn = payload.itineraries.find((x) => x.offer_type === 'round_trip');
    const paired = payload.itineraries.find((x) => x.offer_type === 'paired_one_way');
    assert.equal(trueReturn.price.amount, 430);
    assert.equal(trueReturn.journey_role, 'complete');
    assert.equal(paired.price.amount, 510, 'paired fare must be exact outbound + return one-way sum');
    assert.equal(paired.journey_role, 'complete');
    assert.equal(payload.itineraries[0].offer_type, 'round_trip', 'cheapest complete product should sort first');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Business curation open-jaw mode never mislabels a system pair as a true round-trip', async () => {
  const originalFetch = globalThis.fetch;
  const endpoints = [];
  globalThis.fetch = async (url, init) => {
    const endpoint = new URL(String(url)).pathname;
    const body = JSON.parse(init.body);
    endpoints.push(endpoint);
    if (endpoint.endsWith('/fares/round-trip')) throw new Error('round-trip endpoint must not be called for open-jaw');
    const isOutbound = body.origin === 'TAS';
    const data = isOutbound
      ? curationOneWayProviderResponse({ origin: 'TAS', destination: 'JED', date: '2027-03-03', amount: 260, number: '337', id: 'open-out' })
      : curationOneWayProviderResponse({ origin: 'MED', destination: 'TAS', date: '2027-03-10', amount: 270, number: '501', id: 'open-ret' });
    return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const response = await searchIgnavFlightsForCuration(curationRequest({ inboundOrigin: 'MED' }), { IGNAV_API_KEY: 'test-secret' });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.diagnostics.mode, 'open_jaw_one_way_pairing');
    assert.equal(payload.diagnostics.round_trip_available, false);
    assert.deepEqual(endpoints, ['/api/fares/one-way', '/api/fares/one-way']);
    assert.equal(payload.itineraries.length, 1);
    assert.equal(payload.itineraries[0].offer_type, 'paired_one_way');
    assert.equal(payload.itineraries[0].price.amount, 530);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Business curation one-way modes return a single typed outbound or return product', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    const isOutbound = body.origin === 'TAS';
    const data = isOutbound
      ? curationOneWayProviderResponse({ origin: 'TAS', destination: 'JED', date: '2027-03-03', amount: 260, number: '337', id: 'typed-out' })
      : curationOneWayProviderResponse({ origin: 'JED', destination: 'TAS', date: '2027-03-10', amount: 250, number: '338', id: 'typed-ret' });
    return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const outboundResponse = await searchIgnavFlightsForCuration(curationRequest({ mode: 'outbound_one_way' }), { IGNAV_API_KEY: 'test-secret' });
    const outbound = await outboundResponse.json();
    assert.equal(outbound.itineraries[0].offer_type, 'one_way');
    assert.equal(outbound.itineraries[0].journey_role, 'outbound');

    const returnResponse = await searchIgnavFlightsForCuration(curationRequest({ mode: 'return_one_way' }), { IGNAV_API_KEY: 'test-secret' });
    const back = await returnResponse.json();
    assert.equal(back.itineraries[0].offer_type, 'one_way');
    assert.equal(back.itineraries[0].journey_role, 'return');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function curatedSaveDb() {
  let row = null;
  return {
    get row() { return row; },
    prepare(sql) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      return {
        values: [],
        bind(...values) { this.values = values; return this; },
        async all() {
          if (normalized.includes('FROM curated_flight_offers WHERE fingerprint IS NULL')) return { results: [] };
          if (normalized.includes('SELECT id, itinerary_json, offer_type, journey_role, fingerprint FROM curated_flight_offers LIMIT 1000')) {
            return { results: row ? [{
              id: row.id,
              itinerary_json: row.itinerary_json,
              offer_type: row.offer_type,
              journey_role: row.journey_role,
              fingerprint: row.fingerprint,
            }] : [] };
          }
          throw new Error(`Unexpected curated all SQL: ${normalized}`);
        },
        async first() {
          if (normalized.startsWith('SELECT id, created_at FROM curated_flight_offers')) {
            return row && (this.values[0] === row.fingerprint || (this.values[1] === row.source_candidate_id && this.values[2] === row.outbound_date))
              ? { id: row.id, created_at: row.created_at }
              : null;
          }
          if (normalized.startsWith('SELECT * FROM curated_flight_offers WHERE id=')) return row && this.values[0] === row.id ? row : null;
          throw new Error(`Unexpected curated first SQL: ${normalized}`);
        },
        async run() {
          if (normalized.startsWith('CREATE TABLE') || normalized.startsWith('ALTER TABLE') || normalized.startsWith('CREATE INDEX')) return { success: true };
          if (normalized.startsWith('INSERT INTO curated_flight_offers')) {
            const v = this.values;
            row = {
              id: v[0], source_candidate_id: v[1], source_provider: v[2],
              outbound_origin: v[3], outbound_destination: v[4], inbound_origin: v[5], inbound_destination: v[6],
              outbound_date: v[7], inbound_date: v[8], cabin_class: v[9], airline_codes_json: v[10], airline_names_json: v[11],
              flight_numbers_json: v[12], itinerary_json: v[13], total_fare: v[14], per_traveler_fare: v[15], currency: v[16],
              traveler_count: v[17], observed_at: v[18], published: v[19], priority: v[20], created_by: v[21], created_at: v[22], updated_at: v[23],
              offer_type: v[24], journey_role: v[25], fingerprint: v[26],
            };
            return { success: true, meta: { changes: 1 } };
          }
          if (normalized.startsWith('UPDATE curated_flight_offers SET offer_type=')) return { success: true };
          throw new Error(`Unexpected curated run SQL: ${normalized}`);
        },
      };
    },
  };
}

function curatedSaveItinerary(id) {
  return {
    id,
    source: 'ignav',
    source_name: 'Ignav',
    observed_at: '2026-09-06T08:00:00Z',
    fare_scope: 'total_party',
    price: { amount: 430, currency: 'USD', status: 'verified' },
    cabin_class: 'economy',
    bags: null,
    requires_self_transfer: false,
    offer_type: 'round_trip',
    journey_role: 'complete',
    legs: [
      { airline: 'Uzbekistan Airways', flight_number: 'HY 337', airline_code: 'HY', origin: 'TAS', destination: 'JED', departure_at: '2027-03-03T08:00:00Z', arrival_at: '2027-03-03T12:00:00Z', duration_minutes: 240, stops: 0, cabin_class: 'economy' },
      { airline: 'Uzbekistan Airways', flight_number: 'HY 338', airline_code: 'HY', origin: 'JED', destination: 'TAS', departure_at: '2027-03-10T08:00:00Z', arrival_at: '2027-03-10T12:00:00Z', duration_minutes: 240, stops: 0, cabin_class: 'economy' },
    ],
  };
}

test('publishing the same physical curated fare twice with a new Ignav candidate id updates one row instead of duplicating', async () => {
  const db = curatedSaveDb();
  const makeRequest = (id) => new Request('https://iumrah.app/api/admin/package/flights/curated', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ itinerary: curatedSaveItinerary(id), travelerCount: 1, published: true, priority: 100 }),
  });

  const first = await saveCuratedFlightAdmin(makeRequest('provider-candidate-A'), db, 'test-admin');
  assert.equal(first.status, 200);
  const firstBody = await first.json();
  const firstID = firstBody.offer.id;
  assert.ok(firstID.startsWith('curated-'));

  const second = await saveCuratedFlightAdmin(makeRequest('provider-candidate-B'), db, 'test-admin');
  assert.equal(second.status, 200);
  const secondBody = await second.json();
  assert.equal(secondBody.offer.id, firstID, 'structurally identical fare must retain the existing curated row id');
  assert.equal(db.row.source_candidate_id, 'provider-candidate-B', 'latest provider candidate metadata updates the same row');
});


test('published direct resolver prices the saved D1 itinerary without a provider fetch', async () => {
  const db = curatedSaveDb();
  const publish = new Request('https://iumrah.app/api/admin/package/flights/curated', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ itinerary: curatedSaveItinerary('provider-direct-resolve'), travelerCount: 1, published: true, priority: 100 }),
  });
  const savedResponse = await saveCuratedFlightAdmin(publish, db, 'test-admin');
  const saved = await savedResponse.json();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('published resolver must never call a flight provider'); };
  try {
    const request = new Request('https://iumrah.app/api/package/flights/recommendations/resolve', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        completeID: saved.offer.id,
        travelerCount: 2,
        origin: 'TAS',
        outboundDestination: 'JED',
        returnOrigin: 'JED',
        returnDestination: 'TAS',
      }),
    });
    const response = await resolvePublicCuratedFlightRecommendation(request, db);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.totalFare, 860);
    assert.equal(body.fareScope, 'totalParty');
    assert.equal(body.outbound.origin, 'TAS');
    assert.equal(body.outbound.destination, 'JED');
    assert.equal(body.inbound.origin, 'JED');
    assert.equal(body.inbound.destination, 'TAS');
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test('Data API never invents a return carrier from an unrelated same-day flight', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (request) => {
    const url = new URL(request);
    const reverse = url.searchParams.get('origin') === 'JED';
    const data = reverse ? [{ origin: 'JED', destination: 'TAS', price: 230, airline: 'HY', flight_number: 998, departure_at: '2027-03-10T19:20:00+03:00' }] : [{
      origin: 'TAS', destination: 'JED', price: 550, airline: 'XY', flight_number: 634,
      departure_at: '2027-03-03T14:30:00+05:00', return_at: '2027-03-10T08:25:00+03:00',
      duration_to: 405, duration_back: 360,
    }];
    return Response.json({ success: true, data, currency: 'usd' });
  };
  try {
    const result = await publicAviasalesData(new URL('https://iumrah.app/api/package/flights/data?origin=TAS&destination=JED&departure=2027-03-03&return=2027-03-10&view=offers'), { TRAVELPAYOUTS_API_TOKEN: 'test' });
    assert.equal(result.status, 200);
    const data = await result.json();
    assert.equal(data.offers[0].returnAirlineCode, null);
    assert.equal(data.offers[0].returnFlightNumber, null);
    assert.equal(data.offers[0].returnAt, '2027-03-10T08:25:00+03:00');
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('Data API does not assign an unverified return carrier even when departure timestamps match', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (request) => {
    const url = new URL(request);
    const reverse = url.searchParams.get('origin') === 'JED';
    const data = reverse ? [{ origin: 'JED', destination: 'TAS', price: 230, airline: 'HY', flight_number: 777, departure_at: '2027-03-10T05:25:00Z', duration: 360 }] : [{
      origin: 'TAS', destination: 'JED', price: 550, airline: 'XY', flight_number: 634,
      departure_at: '2027-03-03T14:30:00+05:00', return_at: '2027-03-10T08:25:00+03:00',
      duration_to: 405, duration_back: 360,
    }];
    return Response.json({ success: true, data, currency: 'usd' });
  };
  try {
    const result = await publicAviasalesData(new URL('https://iumrah.app/api/package/flights/data?origin=TAS&destination=JED&departure=2027-03-03&return=2027-03-10&view=offers'), { TRAVELPAYOUTS_API_TOKEN: 'test' });
    assert.equal(result.status, 200);
    const data = await result.json();
    assert.equal(data.offers[0].returnAirlineCode, null);
    assert.equal(data.offers[0].returnFlightNumber, null);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('Flight First server checks actual RT fare without requiring reverse one-way cache', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (request) => {
    const url = new URL(request);
    const reverse = url.searchParams.get('origin') === 'JED';
    return Response.json({ success: true, currency: 'usd', data: reverse ? [] : [{
      origin: 'TAS', destination: 'JED', airline: 'XY', flight_number: '634', price: 550,
      departure_at: '2027-03-03T14:30:00+05:00', return_at: '2027-03-10T08:25:00+03:00',
      duration_to: 405, duration_back: 360,
    }] });
  };
  try {
    const env = { TRAVELPAYOUTS_API_TOKEN: 'test' };
    const rt = await resolveAviasalesSelection('aviasales:rt:TAS:JED:2027-03-03:2027-03-10:XY:634:-:-', env);
    assert.equal(rt.perTravelerUsd, 550);
    assert.equal(rt.inbound?.origin, 'JED');
    assert.equal(rt.inbound?.destination, 'TAS');
    await assert.rejects(
      resolveAviasalesSelection('aviasales:rt:TAS:JED:2027-03-03:2027-03-10:XY:999:-:-', env),
      /AVIASALES_FARE_NOT_FOUND/,
    );
    await assert.rejects(
      resolveAviasalesSelection('aviasales:rt:TAS:JED:2027-03-03:2027-03-10:XY:634:HY:777', env),
      /AVIASALES_RETURN_IDENTITY_UNVERIFIED/,
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});


test('Data API forced fare recheck bypasses its public edge TTL', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ success: true, currency: 'usd', data: [{
    origin: 'TAS', destination: 'JED', price: 620, airline: 'XY', flight_number: '634',
    departure_at: '2027-03-03T14:30:00+05:00',
  }] });
  try {
    const response = await publicAviasalesData(new URL('https://iumrah.app/api/package/flights/data?origin=TAS&destination=JED&departure=2027-03-03&view=offers&fresh=1'), { TRAVELPAYOUTS_API_TOKEN: 'test' });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await response.json()).offers[0].price, 620);
  } finally {
    globalThis.fetch = previousFetch;
  }
});


test('Data API preserves supplier arrival timestamps and leaves absent arrivals unknown', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ success: true, currency: 'usd', data: [
    { origin: 'TAS', destination: 'JED', price: 320, airline: 'XY', flight_number: '634',
      departure_at: '2027-03-03T14:30:00+05:00', arrival_at: '2027-03-03T19:15:00+03:00', duration: 405 },
    { origin: 'TAS', destination: 'JED', price: 350, airline: 'HY', flight_number: '335',
      departure_at: '2027-03-04T14:30:00+05:00', duration: 405 }
  ] });
  try {
    const response = await publicAviasalesData(new URL('https://iumrah.app/api/package/flights/data?origin=TAS&destination=JED&departure=2027-03&view=offers'), { TRAVELPAYOUTS_API_TOKEN: 'test' });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.offers.find(x => x.flightNumber === '634').arrivalAt, '2027-03-03T19:15:00+03:00');
    assert.equal(body.offers.find(x => x.flightNumber === '335').arrivalAt, null);
  } finally { globalThis.fetch = previousFetch; }
});
