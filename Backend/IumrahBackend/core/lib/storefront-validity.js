// Ported from iumrah-web-main 5.zip: lib/storefront-validity.ts
import { requestEnv, backendFetch } from "../runtime.js";
import { isBookableDeparture } from "./flights/validity.js";
/** Product policy: publish packages starting on Tashkent's calendar date + 3 days.
 * Checking actual departure instants too closes the late-evening stale-flight gap. */
export function earliestPackageDate(now = Date.now()) {
    // formatToParts is stable across Node and Cloudflare ICU variants;
    // `en-CA` formatted strings are not guaranteed to be YYYY-MM-DD everywhere.
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Tashkent", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(new Date(now));
    const get = (kind) => Number(parts.find(part => part.type === kind)?.value ?? 0);
    return new Date(Date.UTC(get("year"), get("month") - 1, get("day") + 3)).toISOString().slice(0, 10);
}
export function isCurrentStorefrontPackage(item, now = Date.now()) {
    if (!item?.outbound?.departureAt || !item?.inbound?.departureAt)
        return false;
    return item.startDate >= earliestPackageDate(now)
        && isBookableDeparture(item.outbound.departureAt, item.outbound.origin, now)
        && isBookableDeparture(item.inbound.departureAt, item.inbound.origin, now, 0);
}
/** Hotel First must remain 3 variants per hotel, never show incomplete sets. */
export function currentStorefrontItems(items, now = Date.now()) {
    const valid = items.filter(item => isCurrentStorefrontPackage(item, now));
    const groups = new Map();
    for (const item of valid.filter(item => item.entryMode === "hotel-first")) {
        const key = `${item.originCode}:${item.hotelFirstAnchorHotelId ?? item.hotelName}`;
        groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    return valid.filter(item => item.entryMode !== "hotel-first"
        || groups.get(`${item.originCode}:${item.hotelFirstAnchorHotelId ?? item.hotelName}`)?.length === 3);
}
