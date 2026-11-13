export const SEO_ORIGIN = "https://iumrah.app";
export const SEO_LOCALES = ["ru", "uz", "en", "uz-Cyrl", "tr", "id", "ms"];
export const isSeoLocale = (value) => SEO_LOCALES.includes(value);
export const seoPath = (locale, key = "") => `/${locale}/umrah${key ? `/${key}` : ""}`;
export function windowDates(now = new Date()) {
    const start = now.toISOString().slice(0, 10);
    const end = new Date(now);
    const day = end.getUTCDate();
    end.setUTCDate(1);
    end.setUTCMonth(end.getUTCMonth() + 2);
    const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
    end.setUTCDate(Math.min(day, last));
    return { start, end: end.toISOString().slice(0, 10) };
}
export function eligiblePackage(item, now = new Date()) {
    const range = windowDates(now);
    return item.status === "ready" && /^\d{10}$/.test(item.id)
        && /^[A-Z]{3}$/.test(item.originCode) && ["JED", "MED"].includes(item.destinationCode)
        && item.startDate >= range.start && item.startDate <= range.end && item.endDate > item.startDate
        && Date.parse(item.outbound?.departureAt) > now.getTime()
        && Number.isFinite(item.pricePerPerson) && Number(item.pricePerPerson) > 0
        && Number.isFinite(item.totalPackagePrice) && Number(item.totalPackagePrice) > 0
        && Boolean(item.makkahHotelId && item.hotelName && item.outboundOfferId && item.inboundOfferId);
}
export function descriptors(item) {
    const origin = item.originCode.toLowerCase();
    const base = { origin: item.originCode, originCity: item.originCity };
    const result = [
        { key: "", kind: "all" },
        { key: `from-${origin}`, kind: "origin", ...base },
        { key: `from-${origin}/via-${item.destinationCode.toLowerCase()}`, kind: "route", ...base, destination: item.destinationCode },
        { key: `from-${origin}/month-${item.startDate.slice(0, 7)}`, kind: "month", ...base, month: item.startDate.slice(0, 7) },
    ];
    // Hex encoding is reversible and avoids collisions for arbitrary supplier hotel IDs.
    for (const [id, name, city] of [[item.makkahHotelId, item.hotelName, "makkah"], [item.madinahHotelId, item.hotelSecondaryName, "madinah"]]) {
        if (!id || !name)
            continue;
        const token = Buffer.from(id, "utf8").toString("hex");
        result.push({ key: `hotels/${token}`, kind: "hotel", hotelId: id, hotelName: name, city });
        result.push({ key: `in-${city}`, kind: "city", city });
    }
    return result;
}
export function groupPackages(items, now = new Date()) {
    const groups = new Map();
    const seen = new Set();
    for (const item of items) {
        if (!eligiblePackage(item, now) || seen.has(item.id))
            continue;
        seen.add(item.id);
        for (const descriptor of descriptors(item)) {
            const group = groups.get(descriptor.key) ?? { descriptor, items: [] };
            group.items.push(item);
            groups.set(descriptor.key, group);
        }
    }
    for (const group of groups.values())
        group.items.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id));
    return groups;
}
