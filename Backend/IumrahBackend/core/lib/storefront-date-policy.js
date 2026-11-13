// Ported from iumrah-web-main 5.zip: lib/storefront-date-policy.ts
import { requestEnv, backendFetch } from "../runtime.js";
/**
 * Booking lead time for the automatically published Flight First and Hotel First
 * catalogues. The published origin cities are all in Uzbekistan (UTC+05:00),
 * so the business day is determined in Asia/Tashkent, NOT by the Worker UTC day.
 *
 * This rule concerns the DEPARTURE date only. The length of the trip does not
 * change the earliest permitted departure day.
 */
export const STOREFRONT_DEPARTURE_LEAD_DAYS = 3;
export const STOREFRONT_BUSINESS_TIME_ZONE = "Asia/Tashkent";
const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/;
export function storefrontBusinessToday(now = new Date()) {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: STOREFRONT_BUSINESS_TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(now);
    const part = (kind) => parts.find((item) => item.type === kind)?.value ?? "";
    return `${part("year")}-${part("month")}-${part("day")}`;
}
export function addStorefrontCalendarDays(day, days) {
    if (!YYYY_MM_DD.test(day))
        throw new Error("INVALID_STOREFRONT_DAY");
    const date = new Date(`${day}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== day) {
        throw new Error("INVALID_STOREFRONT_DAY");
    }
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}
export function earliestStorefrontDepartureDay(now = new Date()) {
    return addStorefrontCalendarDays(storefrontBusinessToday(now), STOREFRONT_DEPARTURE_LEAD_DAYS);
}
export function storefrontDepartureIsEligible(day, now = new Date()) {
    return YYYY_MM_DD.test(day) && day >= earliestStorefrontDepartureDay(now);
}
/** The next business midnight in UTC. Uzbekistan does not observe DST. */
export function nextStorefrontBusinessMidnight(now = new Date()) {
    const nextDay = addStorefrontCalendarDays(storefrontBusinessToday(now), 1);
    return new Date(`${nextDay}T00:00:00+05:00`);
}
/** Regenerate on each new Tashkent calendar day, even before the 24h cache TTL. */
export function storefrontGenerationIsOutdated(generatedAt, now = new Date()) {
    const generated = new Date(generatedAt);
    return Number.isNaN(generated.getTime()) || storefrontBusinessToday(generated) !== storefrontBusinessToday(now);
}
