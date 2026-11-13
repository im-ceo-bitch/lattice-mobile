// Ported from iumrah-web-main 5.zip: lib/flights/validity.ts
import { requestEnv, backendFetch } from "../../runtime.js";
/** Supplier wall-clock departures use the departure airport timezone.
 * Explicit offset timestamps remain valid globally even for unmapped airports. */
const DEPARTURE_ZONES = {
    TAS: "Asia/Tashkent", FEG: "Asia/Tashkent", NMA: "Asia/Tashkent", AZN: "Asia/Tashkent",
    SKD: "Asia/Samarkand", BHK: "Asia/Samarkand", KSQ: "Asia/Samarkand", TMJ: "Asia/Samarkand", UGC: "Asia/Samarkand", NCU: "Asia/Samarkand", NAV: "Asia/Samarkand",
    JED: "Asia/Riyadh", MED: "Asia/Riyadh", RUH: "Asia/Riyadh", DMM: "Asia/Riyadh", TIF: "Asia/Riyadh",
    IST: "Europe/Istanbul", SAW: "Europe/Istanbul", DXB: "Asia/Dubai", SHJ: "Asia/Dubai",
    AUH: "Asia/Dubai", DOH: "Asia/Qatar", KWI: "Asia/Kuwait", MCT: "Asia/Muscat",
    GYD: "Asia/Baku", ALA: "Asia/Almaty", NQZ: "Asia/Almaty", FRU: "Asia/Bishkek",
    DYU: "Asia/Dushanbe", ISB: "Asia/Karachi", DEL: "Asia/Kolkata", BOM: "Asia/Kolkata",
    KHI: "Asia/Karachi", LHE: "Asia/Karachi", DAC: "Asia/Dhaka", KTM: "Asia/Kathmandu", CMB: "Asia/Colombo",
    BAH: "Asia/Bahrain", ESB: "Europe/Istanbul", OSS: "Asia/Bishkek", TBS: "Asia/Tbilisi", IKA: "Asia/Tehran",
    LHR: "Europe/London", LGW: "Europe/London", STN: "Europe/London", LTN: "Europe/London", MAN: "Europe/London", EDI: "Europe/London",
    CDG: "Europe/Paris", ORY: "Europe/Paris", AMS: "Europe/Amsterdam", BRU: "Europe/Brussels",
    FRA: "Europe/Berlin", MUC: "Europe/Berlin", BER: "Europe/Berlin", DUS: "Europe/Berlin", HAM: "Europe/Berlin",
    FCO: "Europe/Rome", MXP: "Europe/Rome", LIN: "Europe/Rome", MAD: "Europe/Madrid", BCN: "Europe/Madrid",
    VIE: "Europe/Vienna", ZRH: "Europe/Zurich", GVA: "Europe/Zurich", PRG: "Europe/Prague", WAW: "Europe/Warsaw", KRK: "Europe/Warsaw",
    CPH: "Europe/Copenhagen", OSL: "Europe/Oslo", ARN: "Europe/Stockholm", ATH: "Europe/Athens", OTP: "Europe/Bucharest",
    JFK: "America/New_York", EWR: "America/New_York", LGA: "America/New_York", BOS: "America/New_York", IAD: "America/New_York", DCA: "America/New_York", PHL: "America/New_York", MIA: "America/New_York", ATL: "America/New_York", MCO: "America/New_York",
    ORD: "America/Chicago", DFW: "America/Chicago", IAH: "America/Chicago", AUS: "America/Chicago", MSP: "America/Chicago",
    DEN: "America/Denver", LAX: "America/Los_Angeles", SFO: "America/Los_Angeles", SEA: "America/Los_Angeles", PDX: "America/Los_Angeles", LAS: "America/Los_Angeles",
    YYZ: "America/Toronto", YUL: "America/Toronto", YVR: "America/Vancouver",
    CAI: "Africa/Cairo", CMN: "Africa/Casablanca", ALG: "Africa/Algiers", TUN: "Africa/Tunis", ADD: "Africa/Addis_Ababa", NBO: "Africa/Nairobi", JNB: "Africa/Johannesburg",
    PEK: "Asia/Shanghai", PKX: "Asia/Shanghai", PVG: "Asia/Shanghai", SHA: "Asia/Shanghai", CAN: "Asia/Shanghai", SZX: "Asia/Shanghai", HKG: "Asia/Hong_Kong",
    SIN: "Asia/Singapore", BKK: "Asia/Bangkok", KUL: "Asia/Kuala_Lumpur", CGK: "Asia/Jakarta", DPS: "Asia/Makassar", NRT: "Asia/Tokyo", HND: "Asia/Tokyo", KIX: "Asia/Tokyo", ICN: "Asia/Seoul", GMP: "Asia/Seoul",
};
function partsInZone(instant, zone) {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(instant);
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, Number(value)]));
    return Date.UTC(values.year, values.month - 1, values.day, values.hour, values.minute, values.second);
}
export function departureInstant(value, airport) {
    if (typeof value !== "string")
        return null;
    const validTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})?$/i.test(value);
    if (!validTime)
        return null;
    if (/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
        const result = Date.parse(value);
        return Number.isFinite(result) ? result : null;
    }
    const zone = DEPARTURE_ZONES[airport.trim().toUpperCase()];
    if (!zone)
        return null;
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
    if (!match)
        return null;
    const [, yr, mo, day, hr, min, sec] = match;
    const localAsUtc = Date.UTC(+yr, +mo - 1, +day, +hr, +min, +(sec ?? 0));
    if (new Date(localAsUtc).toISOString().slice(0, 16) !== `${yr}-${mo}-${day}T${hr}:${min}`)
        return null;
    let instant = localAsUtc;
    for (let index = 0; index < 4; index += 1) {
        const diff = localAsUtc - partsInZone(instant, zone);
        instant += diff;
        if (!diff)
            break;
    }
    // Reject nonexistent DST wall times instead of silently shifting the departure.
    return partsInZone(instant, zone) === localAsUtc ? instant : null;
}
export function isBookableDeparture(value, airport, now = Date.now(), minimumLeadMinutes = 180) {
    const instant = departureInstant(value, airport);
    if (instant !== null)
        return instant >= now + minimumLeadMinutes * 60_000;
    // Airports beyond the known mapping: don't delete all international flights.
    // For wall-clock-only values, assume the earliest possible global instant
    // (UTC+14) and require that even that instant meets the booking cutoff.
    // This is intentionally conservative: it can hide near-term unknown routes,
    // but it never labels a previously departed flight as bookable.
    if (!DEPARTURE_ZONES[airport.trim().toUpperCase()]
        && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?$/.test(value)) {
        const wall = Date.parse(`${value}Z`);
        if (Number.isFinite(wall) && new Date(wall).toISOString().slice(0, 16) === value.slice(0, 16)) {
            return wall - 14 * 60 * 60_000 >= now + minimumLeadMinutes * 60_000;
        }
    }
    return false;
}
