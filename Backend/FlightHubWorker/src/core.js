// Shared schema/identity rules. Never infer a route/date or make up an airline.
export const AIRLINES = Object.freeze({ C6: 'centrum', HY: 'uzbekistan', XY: 'flynas' });
export const PROVIDERS = new Set(['ignav', 'aerodatabox', 'centrum', 'uzbekistan', 'flynas', 'legacy_import']);
export const BOT_PROVIDERS = new Set(['centrum', 'uzbekistan', 'flynas']);
const CODE = /^[A-Z0-9]{2}$/;
const IATA = /^[A-Z]{3}$/;
const FLIGHT_NUMBER = /^[A-Z0-9]{2}\d{1,5}[A-Z]?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY = /^[A-Z]{3}$/;
export function clean(value) { return String(value ?? '').trim().toUpperCase(); }
export function validDay(day) {
  if (!DATE.test(day || '')) return false;
  const parsed = new Date(day + 'T00:00:00Z');
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day;
}
export function normaliseFlight(raw, provider) {
  if (!PROVIDERS.has(provider)) throw Error('UNKNOWN_PROVIDER');
  const airline_code = clean(raw.airline_code || raw.airlineCode);
  const flight_number = clean(raw.flight_number || raw.flightNumber).replace(/[-\s]/g, '');
  const origin = clean(raw.origin);
  const destination = clean(raw.destination);
  const departure_date = String(raw.departure_date || raw.departureDate || '').trim();
  if (!CODE.test(airline_code) || !FLIGHT_NUMBER.test(flight_number) ||
      !flight_number.startsWith(airline_code) || !IATA.test(origin) || !IATA.test(destination) ||
      origin === destination || !validDay(departure_date)) throw Error('INVALID_FLIGHT_IDENTITY');
  if (BOT_PROVIDERS.has(provider) && AIRLINES[airline_code] !== provider) throw Error('AIRLINE_SOURCE_MISMATCH');
  const dt = raw.departure_at || raw.departureAt || null;
  const at = raw.arrival_at || raw.arrivalAt || null;
  for (const item of [dt, at]) {
    if (item != null && (typeof item !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(item) ||
      !/[Zz]|[+-]\d{2}:\d{2}$/.test(item) || Number.isNaN(Date.parse(item)))) throw Error('INVALID_SCHEDULE_TIMESTAMP');
  }
  if (dt && dt.slice(0, 10) !== departure_date) throw Error('DEPARTURE_DATE_MISMATCH');
  return { airline_code, flight_number, origin, destination, departure_date,
    departure_at: dt, arrival_at: at,
    key: [airline_code, flight_number, origin, destination, departure_date].join('|') };
}
export function normaliseOffer(raw, provider, now) {
  const amount_minor = Number(raw.amount_minor);
  const currency = clean(raw.currency);
  if (!Number.isSafeInteger(amount_minor) || amount_minor <= 0 || amount_minor > 200000000000 || !CURRENCY.test(currency)) {
    throw Error('INVALID_FARE');
  }
  const adults = raw.adults == null ? 1 : Number(raw.adults);
  const children = raw.children == null ? 0 : Number(raw.children);
  const infants = raw.infants == null ? 0 : Number(raw.infants);
  if (![adults, children, infants].every(Number.isSafeInteger) || adults < 1 || adults > 9 || children < 0 || children > 9 || infants < 0 || infants > adults) throw Error('INVALID_PASSENGERS');
  const fare_brand = String(raw.fare_brand ?? '').trim().slice(0, 64);
  const price_scope = String(raw.price_scope || (provider === 'ignav' ? 'api_observed_not_bookable' : 'site_displayed_not_checkout_verified')).slice(0, 90);
  const checked_at = String(raw.observed_at || raw.checked_at || now);
  if (Number.isNaN(Date.parse(checked_at))) throw Error('INVALID_OBSERVATION_DATE');
  const drift = Date.parse(now) - Date.parse(checked_at);
  if (drift < -300000 || drift > 48 * 3600000) throw Error('OBSERVATION_OUTSIDE_WINDOW');
  function optionalNumber(v, max) { if (v == null) return null; const n = Number(v); if (!Number.isFinite(n) || n < 0 || n > max) throw Error('INVALID_OPTIONAL_VALUE'); return n; }
  const seats_left = optionalNumber(raw.seats_left, 600);
  if (seats_left != null && !Number.isInteger(seats_left)) throw Error('INVALID_SEAT_COUNT');
  const source_url = raw.source_url || null;
  if (source_url && (!/^https:\/\//i.test(source_url) || String(source_url).length > 1024)) throw Error('INVALID_SOURCE_URL');
  return { amount_minor, currency, fare_brand, adults, children, infants, price_scope, checked_at,
    baggage_checked_kg: optionalNumber(raw.baggage_checked_kg, 100),
    baggage_cabin_kg: optionalNumber(raw.baggage_cabin_kg, 50), seats_left, source_url };
}
export function allowCreateFlight(provider) { return provider === 'ignav' || provider === 'aerodatabox' || provider === 'legacy_import'; }
export function needsPrice(provider) { return provider !== 'aerodatabox' && provider !== 'legacy_import'; }
export function publicOfferIsFresh(offer, now = Date.now()) {
  const hours = offer.provider === 'ignav' ? 4 : offer.provider === 'legacy_import' ? 0 : 24;
  return Date.parse(offer.checked_at) > now - hours * 3600000;
}
export function sanitiseError(error) { return String(error?.message || error || 'UNKNOWN').slice(0, 140); }
