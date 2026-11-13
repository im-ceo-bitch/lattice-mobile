// Ported from iumrah-web-main 5.zip: lib/storefront-packages.ts
import { requestEnv, backendFetch } from "../runtime.js";
import { fetchCuratedRecommendations, fetchHotelDetail, fetchHotelsByCity, fetchPublishedOneWayFlightOptions, recommendationRole, requestPackageQuote, resolveHotelForTier, } from "./web-package.js";
import { storefrontDepartureIsEligible } from "./storefront-date-policy.js";
export const HOTEL_FIRST_ENGINE_VERSION = 8; // v8: minimum departure is Tashkent business day + 3
export const FLIGHT_FIRST_ENGINE_VERSION = 6; // v6: minimum departure is Tashkent business day + 3
export const STORE_ORIGINS = ["TAS", "SKD", "FEG", "NMA", "UGC", "BHK", "NCU", "TMJ", "KSQ", "AZN"];
const ORIGIN_CITY_MAP = {
    TAS: "Tashkent",
    SKD: "Samarkand",
    FEG: "Fergana",
    NMA: "Namangan",
    UGC: "Urgench",
    BHK: "Bukhara",
    NCU: "Nukus",
    TMJ: "Termez",
    KSQ: "Karshi",
    AZN: "Andijan",
};
export function storefrontOriginCity(code) {
    const normalized = code.trim().toUpperCase();
    return ORIGIN_CITY_MAP[normalized] ?? normalized;
}
function dateOnly(value) {
    return value.slice(0, 10);
}
function utcDate(value) {
    return new Date(`${dateOnly(value)}T00:00:00Z`);
}
function addDays(value, days) {
    const date = utcDate(value);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}
function dayDistance(from, to) {
    const first = utcDate(from).getTime();
    const second = utcDate(to).getTime();
    return Math.round((second - first) / 86_400_000);
}
function hotelImageUrls(images, limit = 6) {
    const seen = new Set();
    const ordered = [...images].sort((a, b) => Number(b.isCover) - Number(a.isCover));
    const values = [];
    for (const image of ordered) {
        const url = image.url?.trim();
        if (!url || seen.has(url))
            continue;
        seen.add(url);
        values.push(url);
        if (values.length >= limit)
            break;
    }
    return values.length ? values : ["/iumrah/hotels-showcase.jpeg"];
}
function coverImage(images) {
    return hotelImageUrls(images, 1)[0];
}
function buildStay(kind, startDate, endDate) {
    const totalNights = Math.max(1, dayDistance(startDate, endDate));
    if (kind === "makkah-only") {
        return {
            startDate,
            endDate,
            totalNights,
            totalDays: totalNights + 1,
            makkahNights: totalNights,
            madinahNights: 0,
            makkahCheckIn: startDate,
            makkahCheckOut: endDate,
            madinahCheckIn: startDate,
            madinahCheckOut: startDate,
        };
    }
    const madinahNights = totalNights > 1 ? Math.max(1, Math.min(totalNights - 1, Math.floor(totalNights * 0.42))) : 0;
    const makkahNights = Math.max(1, totalNights - madinahNights);
    const madinahCheckIn = startDate;
    const madinahCheckOut = addDays(startDate, madinahNights);
    return {
        startDate,
        endDate,
        totalNights,
        totalDays: totalNights + 1,
        makkahNights,
        madinahNights,
        makkahCheckIn: madinahCheckOut,
        makkahCheckOut: endDate,
        madinahCheckIn,
        madinahCheckOut,
    };
}
function publicFlight(leg) {
    return {
        airline: leg.airline,
        airlineCode: leg.airline_code,
        flightNumber: leg.flight_number,
        origin: leg.origin,
        destination: leg.destination,
        departureAt: leg.departure_at,
        arrivalAt: leg.arrival_at,
        durationMinutes: leg.duration_minutes,
        stops: leg.stops,
        cabinClass: leg.cabin_class,
    };
}
function isSaudiAirport(code) {
    const value = code.trim().toUpperCase();
    return value === "JED" || value === "MED";
}
function packageKindForLegs(outbound, inbound) {
    const gap = dayDistance(outbound.departure_at, inbound.departure_at);
    if (!isSaudiAirport(outbound.destination) || !isSaudiAirport(inbound.origin))
        return null;
    if (outbound.destination.toUpperCase() === "JED" && inbound.origin.toUpperCase() === "JED" && gap >= 2 && gap <= 3) {
        return { kind: "makkah-only", tier: "comfort", gap };
    }
    if (gap >= 4 && gap <= 15) {
        return { kind: "makkah-madinah", tier: "standard", gap };
    }
    return null;
}
function allowedReturnDestination(returnDestination, outboundOrigin) {
    const destination = returnDestination.trim().toUpperCase();
    const preferred = outboundOrigin.trim().toUpperCase();
    return destination === preferred || (preferred !== "TAS" && destination === "TAS");
}
function oneWayReturnCandidates(outbound, options, outboundOrigin) {
    return options
        .filter((candidate) => {
        if (candidate.inbound)
            return false;
        if (candidate.currency.toUpperCase() !== "USD")
            return false;
        if (!Number.isFinite(candidate.perTravelerFare) || candidate.perTravelerFare <= 0)
            return false;
        if (!isSaudiAirport(candidate.outbound.origin))
            return false;
        if (!allowedReturnDestination(candidate.outbound.destination, outboundOrigin))
            return false;
        return packageKindForLegs(outbound, candidate.outbound) !== null;
    })
        .sort((a, b) => {
        const aType = packageKindForLegs(outbound, a.outbound);
        const bType = packageKindForLegs(outbound, b.outbound);
        const aGap = aType?.gap ?? 99;
        const bGap = bType?.gap ?? 99;
        if (aGap !== bGap)
            return aGap - bGap;
        if (a.outbound.departure_at !== b.outbound.departure_at) {
            return a.outbound.departure_at.localeCompare(b.outbound.departure_at);
        }
        if (a.priority !== b.priority)
            return a.priority - b.priority;
        return a.perTravelerFare - b.perTravelerFare;
    });
}
function candidateFromPair(outboundOption, inboundOption) {
    const type = packageKindForLegs(outboundOption.outbound, inboundOption.outbound);
    if (!type)
        return null;
    return {
        key: `storefront-pair:${outboundOption.id}:${inboundOption.id}`,
        selection: { completeID: null, outboundID: outboundOption.id, returnID: inboundOption.id },
        originCode: outboundOption.outbound.origin.toUpperCase(),
        destinationCode: outboundOption.outbound.destination.toUpperCase(),
        tier: type.tier,
        kind: type.kind,
        startDate: dateOnly(outboundOption.outbound.departure_at),
        endDate: dateOnly(inboundOption.outbound.departure_at),
        outbound: outboundOption.outbound,
        inbound: inboundOption.outbound,
    };
}
function buildCandidatesFromStorefrontBoard(options, origins) {
    const allowedOrigins = new Set(origins.map((value) => value.toUpperCase()));
    const candidates = [];
    const anchors = options
        .filter((option) => {
        const origin = option.outbound.origin.toUpperCase();
        return allowedOrigins.has(origin) && !isSaudiAirport(origin) && isSaudiAirport(option.outbound.destination);
    })
        .sort((a, b) => {
        if (a.outbound.departure_at !== b.outbound.departure_at)
            return a.outbound.departure_at.localeCompare(b.outbound.departure_at);
        if (a.priority !== b.priority)
            return a.priority - b.priority;
        return a.perTravelerFare - b.perTravelerFare;
    });
    for (const option of anchors) {
        if (option.currency.toUpperCase() !== "USD")
            continue;
        if (!Number.isFinite(option.perTravelerFare) || option.perTravelerFare <= 0)
            continue;
        if (option.inbound) {
            const type = packageKindForLegs(option.outbound, option.inbound);
            if (!type || !allowedReturnDestination(option.inbound.destination, option.outbound.origin))
                continue;
            candidates.push({
                key: `storefront-complete:${option.id}`,
                selection: { completeID: option.id, outboundID: null, returnID: null },
                originCode: option.outbound.origin.toUpperCase(),
                destinationCode: option.outbound.destination.toUpperCase(),
                tier: type.tier,
                kind: type.kind,
                startDate: dateOnly(option.outbound.departure_at),
                endDate: dateOnly(option.inbound.departure_at),
                outbound: option.outbound,
                inbound: option.inbound,
            });
            continue;
        }
        const returnOptions = oneWayReturnCandidates(option.outbound, options, option.outbound.origin.toUpperCase());
        for (const returnOption of returnOptions) {
            const candidate = candidateFromPair(option, returnOption);
            if (candidate)
                candidates.push(candidate);
        }
    }
    const deduped = new Map();
    for (const item of candidates) {
        const selectionKey = item.selection.completeID ?? `${item.selection.outboundID}:${item.selection.returnID}`;
        if (!deduped.has(selectionKey))
            deduped.set(selectionKey, item);
    }
    return Array.from(deduped.values()).sort((a, b) => a.startDate.localeCompare(b.startDate));
}
function buildCandidatesForOrigin(originCode, recommendations) {
    const complete = recommendations.filter((item) => item.inbound && item.outbound.origin === originCode && allowedReturnDestination(item.inbound.destination, originCode));
    const outbound = recommendations.filter((item) => !item.inbound && recommendationRole(item) === "outbound" && item.outbound.origin === originCode);
    const returns = recommendations.filter((item) => !item.inbound && recommendationRole(item) === "return" && allowedReturnDestination(item.outbound.destination, originCode));
    const candidates = [];
    for (const item of [...complete].sort((a, b) => a.outboundDate.localeCompare(b.outboundDate))) {
        if (!item.inboundDate || !item.inbound)
            continue;
        const type = packageKindForLegs(item.outbound, item.inbound);
        if (!type)
            continue;
        candidates.push({
            key: `complete:${item.id}`,
            selection: { completeID: item.id, outboundID: null, returnID: null },
            originCode,
            destinationCode: item.outbound.destination,
            tier: type.tier,
            kind: type.kind,
            startDate: item.outboundDate,
            endDate: item.inboundDate,
            outbound: item.outbound,
            inbound: item.inbound,
        });
    }
    for (const outward of [...outbound].sort((a, b) => a.outboundDate.localeCompare(b.outboundDate))) {
        const matching = returns
            .filter((item) => allowedReturnDestination(item.outbound.destination, originCode))
            .map((item) => ({ item, type: packageKindForLegs(outward.outbound, item.outbound) }))
            .filter((value) => value.type !== null)
            .sort((a, b) => {
            if (a.type.gap !== b.type.gap)
                return a.type.gap - b.type.gap;
            return a.item.outboundDate.localeCompare(b.item.outboundDate);
        });
        for (const match of matching) {
            candidates.push({
                key: `pair:${outward.id}:${match.item.id}`,
                selection: { completeID: null, outboundID: outward.id, returnID: match.item.id },
                originCode,
                destinationCode: outward.outbound.destination,
                tier: match.type.tier,
                kind: match.type.kind,
                startDate: outward.outboundDate,
                endDate: match.item.outboundDate,
                outbound: outward.outbound,
                inbound: match.item.outbound,
            });
        }
    }
    const deduped = new Map();
    for (const item of candidates.sort((a, b) => a.startDate.localeCompare(b.startDate))) {
        const key = item.selection.completeID ?? `${item.selection.outboundID}:${item.selection.returnID}`;
        if (!deduped.has(key))
            deduped.set(key, item);
    }
    return Array.from(deduped.values());
}
// Each bounded pricing batch should serve several departure cities, including
// Tashkent. Pure date sorting could fill the first batch with offers from one
// city, leaving every other origin with an empty public catalogue for hours.
// Stable round-robin ordering also makes persisted candidate offsets repeatable.
function orderStorefrontCandidates(items) {
    const byOrigin = new Map();
    for (const item of items) {
        const group = byOrigin.get(item.originCode) ?? [];
        group.push(item);
        byOrigin.set(item.originCode, group);
    }
    for (const group of byOrigin.values()) {
        group.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.key.localeCompare(b.key));
    }
    const origins = [
        ...STORE_ORIGINS.filter((origin) => byOrigin.has(origin)),
        ...[...byOrigin.keys()].filter((origin) => !STORE_ORIGINS.includes(origin)).sort(),
    ];
    const result = [];
    let remaining = items.length;
    let index = 0;
    while (remaining > 0) {
        for (const origin of origins) {
            const group = byOrigin.get(origin);
            if (index < group.length) {
                result.push(group[index]);
                remaining -= 1;
            }
        }
        index += 1;
    }
    return result;
}
async function candidatesForOrigins(origins, baseUrl) {
    // The public Flights inventory must be driven by the complete published one-way
    // recommendation feed. The optional storefront board can enrich an offer, but it
    // is intentionally not authoritative: a small board response must never hide the
    // rest of the flights already published in D1. fetchPublishedOneWayFlightOptions
    // merges both sources while preserving every published offer ID.
    const publishedResults = await Promise.allSettled(origins.map((originCode) => fetchPublishedOneWayFlightOptions(originCode, baseUrl)));
    const mergedOptions = new Map();
    for (const result of publishedResults) {
        if (result.status !== "fulfilled")
            continue;
        for (const option of result.value)
            mergedOptions.set(option.id, option);
    }
    const publishedCandidates = buildCandidatesFromStorefrontBoard([...mergedOptions.values()], origins);
    if (publishedCandidates.length)
        return orderStorefrontCandidates(publishedCandidates.filter((item) => storefrontDepartureIsEligible(item.startDate)));
    // Compatibility fallback for an older PackageEngine that exposes only the
    // recommendations projection. Keep this path only when the merged publication
    // inventory could not produce any valid outbound/return pairs at all.
    const settled = await Promise.allSettled(origins.map(async (originCode) => {
        const recommendations = await fetchCuratedRecommendations(originCode, baseUrl);
        return buildCandidatesForOrigin(originCode, recommendations);
    }));
    return orderStorefrontCandidates(settled
        .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
        .filter((item) => storefrontDepartureIsEligible(item.startDate)));
}
async function mapWithConcurrency(items, concurrency, task) {
    const output = new Array(items.length).fill(null);
    let cursor = 0;
    async function worker() {
        while (true) {
            const index = cursor;
            cursor += 1;
            if (index >= items.length)
                return;
            output[index] = await task(items[index]);
        }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
    return output.filter((item) => item !== null);
}
function normalizeHotelName(value) {
    return value
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}
function fixedStorefrontHotel(hotels, preferredNames, requiredTokenGroups) {
    const exact = new Set(preferredNames.map(normalizeHotelName));
    const exactHotel = hotels.find((hotel) => exact.has(normalizeHotelName(hotel.name)));
    if (exactHotel)
        return exactHotel;
    return hotels.find((hotel) => {
        const normalized = normalizeHotelName(hotel.name);
        return requiredTokenGroups.every((alternatives) => alternatives.some((token) => normalized.includes(token)));
    }) ?? null;
}
async function fallbackPrimaryHotel(tier, city, travelers, baseUrl) {
    try {
        return await resolveHotelForTier(tier, city, travelers, baseUrl);
    }
    catch {
        return null;
    }
}
async function enrichHotelMedia(hotel, baseUrl) {
    if (!hotel || hotel.images.some((image) => Boolean(image.url)))
        return hotel;
    try {
        const detail = await fetchHotelDetail(hotel.id, baseUrl);
        return detail.images.some((image) => Boolean(image.url)) ? detail : hotel;
    }
    catch {
        return hotel;
    }
}
async function resolveFlightFirstHotelPolicy(baseUrl) {
    const travelers = { adults: 2, children: 0, infants: 0, rooms: 1 };
    const [makkahResult, madinahResult] = await Promise.allSettled([
        fetchHotelsByCity("Makkah", baseUrl),
        fetchHotelsByCity("Madinah", baseUrl),
    ]);
    const makkahHotels = makkahResult.status === "fulfilled" ? makkahResult.value : [];
    const madinahHotels = madinahResult.status === "fulfilled" ? madinahResult.value : [];
    const standardMakkah = fixedStorefrontHotel(makkahHotels, ["Nawazi Hotel", "Nawazi Watheer Hotel", "Nawazi Towers Hotel"], [["nawazi"]]);
    const standardMadinah = fixedStorefrontHotel(madinahHotels, ["Mihrab Tayyiba", "Mihrab Tayba", "Mihrab Taiba"], [["mihrab"], ["tayyiba", "tayba", "taiba"]]);
    const comfortMakkah = fixedStorefrontHotel(makkahHotels, ["Shohada Hotel", "Al Shohada Hotel", "Shuhada Hotel", "Al Shuhada Hotel"], [["shohada", "shuhada"]]);
    const [standardMakkahWithMedia, standardMadinahWithMedia, comfortMakkahWithMedia] = await Promise.all([
        enrichHotelMedia(standardMakkah, baseUrl),
        enrichHotelMedia(standardMadinah, baseUrl),
        enrichHotelMedia(comfortMakkah, baseUrl),
    ]);
    const [primaryStandardMakkah, primaryStandardMadinah, primaryComfortMakkah] = await Promise.all([
        fallbackPrimaryHotel("standard", "Makkah", travelers, baseUrl),
        fallbackPrimaryHotel("standard", "Madinah", travelers, baseUrl),
        fallbackPrimaryHotel("comfort", "Makkah", travelers, baseUrl),
    ]);
    const uniqueChoices = (values) => {
        const seen = new Set();
        return values.filter((value) => {
            if (!value || seen.has(value.hotel.id))
                return false;
            seen.add(value.hotel.id);
            return true;
        });
    };
    return {
        standard: {
            makkah: uniqueChoices([
                standardMakkahWithMedia ? { hotel: standardMakkahWithMedia, roomId: null } : null,
                primaryStandardMakkah,
            ]),
            madinah: uniqueChoices([
                standardMadinahWithMedia ? { hotel: standardMadinahWithMedia, roomId: null } : null,
                primaryStandardMadinah,
            ]),
        },
        comfort: {
            makkah: uniqueChoices([
                comfortMakkahWithMedia ? { hotel: comfortMakkahWithMedia, roomId: null } : null,
                primaryComfortMakkah,
            ]),
            madinah: [],
        },
    };
}
function candidateOfferIds(candidate) {
    const completeID = candidate.selection.completeID;
    const outboundID = candidate.selection.outboundID;
    const returnID = candidate.selection.returnID;
    if (completeID) {
        return {
            providerItineraryId: `curated:${completeID}`,
            outboundOfferId: completeID,
            inboundOfferId: completeID,
        };
    }
    if (outboundID && returnID) {
        return {
            providerItineraryId: `curated:${outboundID}+${returnID}`,
            outboundOfferId: outboundID,
            inboundOfferId: returnID,
        };
    }
    return null;
}
function readyFlightFirstPackage(candidate, quote, makkah, madinah) {
    const stay = buildStay(candidate.kind, candidate.startDate, candidate.endDate);
    return {
        id: `${candidate.key}:${quote.quoteId}`,
        entryMode: "flight-first",
        status: "ready",
        flightFirstEngineVersion: FLIGHT_FIRST_ENGINE_VERSION,
        originCode: candidate.originCode,
        originCity: ORIGIN_CITY_MAP[candidate.originCode] ?? candidate.originCode,
        destinationCode: candidate.destinationCode,
        tier: candidate.tier,
        kind: candidate.kind,
        startDate: stay.startDate,
        endDate: stay.endDate,
        totalDays: stay.totalDays,
        totalNights: stay.totalNights,
        outbound: publicFlight(candidate.outbound),
        inbound: publicFlight(candidate.inbound),
        providerItineraryId: candidateOfferIds(candidate)?.providerItineraryId ?? candidate.key,
        outboundOfferId: candidateOfferIds(candidate)?.outboundOfferId ?? candidate.key,
        inboundOfferId: candidateOfferIds(candidate)?.inboundOfferId ?? candidate.key,
        imageUrl: coverImage(makkah.hotel.images),
        hotelImages: hotelImageUrls(makkah.hotel.images),
        hotelName: makkah.hotel.name,
        hotelSecondaryName: candidate.kind === "makkah-only" ? null : (madinah?.hotel.name ?? null),
        makkahHotelId: makkah.hotel.id,
        madinahHotelId: candidate.kind === "makkah-only" ? null : (madinah?.hotel.id ?? null),
        routeSummary: candidate.kind === "makkah-only"
            ? `${candidate.outbound.origin} → ${candidate.outbound.destination} + ${candidate.inbound.origin} → ${candidate.inbound.destination} · ${stay.totalDays} d · Makkah only`
            : `${candidate.outbound.origin} → ${candidate.outbound.destination} + ${candidate.inbound.origin} → ${candidate.inbound.destination} · ${stay.totalDays} d · Makkah + Madinah`,
        pricePerPerson: quote.pricePerPerson,
        totalPackagePrice: quote.totalPackagePrice,
        currency: quote.currency,
        isEstimated: quote.isEstimated,
    };
}
/**
 * Build Flight First incrementally. A full published catalogue can contain
 * dozens/hundreds of outbound-return combinations, and pricing each candidate
 * requires a PackageEngine subrequest. Doing all of them inside one Cloudflare
 * request exhausts the subrequest budget and historically left the public page
 * stuck around the first ~12 successfully quoted packages.
 *
 * Each invocation prices one bounded candidate batch; the API route merges that
 * batch into the persistent D1 storefront cache and advances the cursor until the
 * complete candidate catalogue has been attempted. There is no public UI limit.
 */
export async function buildPricedStorefrontPackagesDetailed(options) {
    const origins = options?.origins?.length ? options.origins : Array.from(STORE_ORIGINS);
    const baseUrl = options?.baseUrl;
    const allCandidates = await candidatesForOrigins(origins, baseUrl);
    const candidateCount = allCandidates.length;
    const offset = Math.min(candidateCount, Math.max(0, Math.trunc(options?.candidateOffset ?? 0)));
    // Keep well below the Cloudflare per-request subrequest ceiling. One candidate
    // can retry multiple hotel combinations, so 8 candidates is deliberately small.
    const batchSize = Math.max(1, Math.min(8, Math.trunc(options?.candidateBatchSize ?? 8)));
    const candidates = allCandidates.slice(offset, offset + batchSize);
    if (!candidates.length) {
        return {
            items: [],
            candidateCount,
            attemptedCandidateCount: 0,
            failedCandidateCount: 0,
            nextCandidateOffset: candidateCount,
            complete: offset >= candidateCount,
        };
    }
    const policy = await resolveFlightFirstHotelPolicy(baseUrl);
    const travelers = { adults: 2, children: 0, infants: 0, rooms: 1 };
    const items = await mapWithConcurrency(candidates, 4, async (candidate) => {
        const ids = candidateOfferIds(candidate);
        if (!ids)
            return null;
        const selected = candidate.tier === "comfort" ? policy.comfort : policy.standard;
        const makkahChoices = selected.makkah;
        const madinahChoices = candidate.kind === "makkah-madinah" ? policy.standard.madinah : [null];
        if (!makkahChoices.length || (candidate.kind === "makkah-madinah" && !madinahChoices.length))
            return null;
        const stay = buildStay(candidate.kind, candidate.startDate, candidate.endDate);
        for (const makkah of makkahChoices) {
            for (const madinah of madinahChoices) {
                try {
                    const quote = await requestPackageQuote({
                        tier: candidate.tier,
                        travelers,
                        journey: {
                            id: ids.providerItineraryId,
                            providerItineraryId: ids.providerItineraryId,
                            outboundOfferId: ids.outboundOfferId,
                            inboundOfferId: ids.inboundOfferId,
                            outbound: candidate.outbound,
                            inbound: candidate.inbound,
                            currency: "USD",
                            observedAt: new Date().toISOString(),
                        },
                        stay,
                        meals: { makkahLunch: false, makkahDinner: false, madinahDinner: false },
                        transferVehicle: null,
                        haramainEnabled: false,
                        haramainFareClass: "economy",
                        haramainTicketCount: 0,
                        makkahHotelId: makkah.hotel.id,
                        makkahRoomId: makkah.roomId,
                        madinahHotelId: madinah?.hotel.id ?? null,
                        madinahRoomId: madinah?.roomId ?? null,
                    }, baseUrl);
                    if (!(quote.pricePerPerson > 0) || !(quote.totalPackagePrice > 0))
                        continue;
                    return readyFlightFirstPackage(candidate, quote, makkah, madinah);
                }
                catch {
                    // A failed quote must not abort the rest of the catalogue. Continue with
                    // the next configured hotel and then the next candidate in this batch.
                }
            }
        }
        return null;
    });
    const nextCandidateOffset = Math.min(candidateCount, offset + candidates.length);
    return {
        items,
        candidateCount,
        attemptedCandidateCount: candidates.length,
        failedCandidateCount: Math.max(0, candidates.length - items.length),
        nextCandidateOffset,
        complete: nextCandidateOffset >= candidateCount,
    };
}
export async function buildPricedStorefrontPackages(options) {
    const origins = options?.origins?.length ? options.origins : Array.from(STORE_ORIGINS);
    const baseUrl = options?.baseUrl;
    const allCandidates = await candidatesForOrigins(origins, baseUrl);
    const candidates = typeof options?.maxPackages === "number"
        ? allCandidates.slice(0, Math.max(1, Math.trunc(options.maxPackages)))
        : allCandidates;
    if (!candidates.length)
        return [];
    // Compatibility helper for callers that explicitly ask for a one-shot build.
    // The production storefront route uses the detailed incremental builder above.
    const policy = await resolveFlightFirstHotelPolicy(baseUrl);
    const travelers = { adults: 2, children: 0, infants: 0, rooms: 1 };
    return mapWithConcurrency(candidates, 4, async (candidate) => {
        const ids = candidateOfferIds(candidate);
        if (!ids)
            return null;
        const selected = candidate.tier === "comfort" ? policy.comfort : policy.standard;
        const makkahChoices = selected.makkah;
        const madinahChoices = candidate.kind === "makkah-madinah" ? policy.standard.madinah : [null];
        if (!makkahChoices.length || (candidate.kind === "makkah-madinah" && !madinahChoices.length))
            return null;
        const stay = buildStay(candidate.kind, candidate.startDate, candidate.endDate);
        for (const makkah of makkahChoices) {
            for (const madinah of madinahChoices) {
                try {
                    const quote = await requestPackageQuote({
                        tier: candidate.tier,
                        travelers,
                        journey: {
                            id: ids.providerItineraryId,
                            providerItineraryId: ids.providerItineraryId,
                            outboundOfferId: ids.outboundOfferId,
                            inboundOfferId: ids.inboundOfferId,
                            outbound: candidate.outbound,
                            inbound: candidate.inbound,
                            currency: "USD",
                            observedAt: new Date().toISOString(),
                        },
                        stay,
                        meals: { makkahLunch: false, makkahDinner: false, madinahDinner: false },
                        transferVehicle: null,
                        haramainEnabled: false,
                        haramainFareClass: "economy",
                        haramainTicketCount: 0,
                        makkahHotelId: makkah.hotel.id,
                        makkahRoomId: makkah.roomId,
                        madinahHotelId: madinah?.hotel.id ?? null,
                        madinahRoomId: madinah?.roomId ?? null,
                    }, baseUrl);
                    if (!(quote.pricePerPerson > 0) || !(quote.totalPackagePrice > 0))
                        continue;
                    return readyFlightFirstPackage(candidate, quote, makkah, madinah);
                }
                catch {
                    // Continue with the next configured hotel combination.
                }
            }
        }
        return null;
    });
}
function automaticTierForHotel(hotel) {
    const stars = hotel.stars ?? 3;
    if (stars >= 5)
        return "luxury";
    if (stars === 4)
        return "comfort";
    return "standard";
}
function hotelFirstDurationTargets(anchorCity) {
    return anchorCity === "Madinah"
        ? { minDays: 4, maxDays: 14, targets: [5, 8, 11] }
        : { minDays: 2, maxDays: 14, targets: [3, 7, 10] };
}
/**
 * Pick short / balanced / extended from the return dates that are actually
 * published for this outbound. The previous implementation hard-gated Makkah
 * on fixed 2-4 / 5-8 / 9-11(14) bands. A perfectly valid Makkah hotel therefore
 * stayed forever in "package forming" whenever the first available return was
 * day 5 or 6, even though the hotel price itself was present in HOTELS_DB.
 *
 * We still preserve the product contract: one outbound, three distinct return
 * flights, and three strictly increasing trip durations. We simply choose the
 * best available trio instead of requiring an arbitrary calendar shape.
 */
function hotelFirstVariantSpecsForOutbound(options, origin, outbound, anchorCity) {
    const { minDays, maxDays, targets } = hotelFirstDurationTargets(anchorCity);
    const durations = [...new Set(options
            .filter((option) => {
            if (!usableHotelFirstOneWay(option))
                return false;
            if (!isSaudiAirport(option.outbound.origin))
                return false;
            if (!allowedReturnDestination(option.outbound.destination, origin))
                return false;
            const gap = dayDistance(outbound.outbound.departure_at, option.outbound.departure_at);
            return gap >= minDays && gap <= maxDays;
        })
            .map((option) => dayDistance(outbound.outbound.departure_at, option.outbound.departure_at)))]
        .sort((a, b) => a - b);
    if (durations.length < 3)
        return [];
    let best = null;
    for (let i = 0; i < durations.length - 2; i += 1) {
        for (let j = i + 1; j < durations.length - 1; j += 1) {
            for (let k = j + 1; k < durations.length; k += 1) {
                const values = [durations[i], durations[j], durations[k]];
                const score = values.reduce((sum, value, index) => sum + Math.abs(value - targets[index]), 0);
                if (!best || score < best.score || (score === best.score && values[2] < best.values[2])) {
                    best = { values, score };
                }
            }
        }
    }
    if (!best)
        return [];
    const [shortDays, balancedDays, extendedDays] = best.values;
    return [
        { key: "short", index: 0, minDays: shortDays, maxDays: shortDays, targetDays: shortDays },
        { key: "balanced", index: 1, minDays: balancedDays, maxDays: balancedDays, targetDays: balancedDays },
        { key: "extended", index: 2, minDays: extendedDays, maxDays: extendedDays, targetDays: extendedDays },
    ];
}
function hotelFirstAnchorCity(hotel) {
    const city = hotel.city.toLowerCase();
    return city.includes("mad") || city.includes("med") ? "Madinah" : "Makkah";
}
function hotelFirstStay(anchorCity, outbound, inbound) {
    const startDate = dateOnly(outbound.departure_at);
    const endDate = dateOnly(inbound.departure_at);
    const totalNights = Math.max(1, dayDistance(startDate, endDate));
    // 2–3 day Makkah hotel packages stay in Makkah only. From four days onward,
    // Madinah is fixed at two nights and the remaining nights stay in Makkah:
    // 4 = 2+2, 5 = 3+2, 7 = 5+2, etc. Madinah-anchored packages always include
    // Makkah and therefore start at four days.
    const includeMadinah = anchorCity === "Madinah" || totalNights >= 4;
    const madinahNights = includeMadinah ? Math.min(2, Math.max(1, totalNights - 2)) : 0;
    const makkahNights = Math.max(1, totalNights - madinahNights);
    if (anchorCity === "Madinah") {
        const madinahCheckIn = startDate;
        const madinahCheckOut = addDays(startDate, madinahNights);
        return {
            startDate,
            endDate,
            totalNights,
            totalDays: totalNights,
            makkahNights,
            madinahNights,
            makkahCheckIn: madinahCheckOut,
            makkahCheckOut: endDate,
            madinahCheckIn,
            madinahCheckOut,
        };
    }
    const makkahCheckIn = startDate;
    const makkahCheckOut = addDays(startDate, makkahNights);
    return {
        startDate,
        endDate,
        totalNights,
        totalDays: totalNights,
        makkahNights,
        madinahNights,
        makkahCheckIn,
        makkahCheckOut,
        madinahCheckIn: makkahCheckOut,
        madinahCheckOut: endDate,
    };
}
function usableHotelFirstOneWay(option) {
    return !option.inbound
        && option.currency.toUpperCase() === "USD"
        && Number.isFinite(option.perTravelerFare)
        && option.perTravelerFare > 0;
}
function hotelFirstReturnPool(options, origin, outbound, spec) {
    return options.filter((option) => {
        if (!usableHotelFirstOneWay(option))
            return false;
        if (!isSaudiAirport(option.outbound.origin))
            return false;
        if (!allowedReturnDestination(option.outbound.destination, origin))
            return false;
        const gap = dayDistance(outbound.outbound.departure_at, option.outbound.departure_at);
        return gap >= spec.minDays && gap <= spec.maxDays;
    });
}
function hasDistinctHotelFirstReturns(outbound, specs, pools) {
    const order = specs.map((_, index) => index).sort((a, b) => pools[a].length - pools[b].length);
    const usedIDs = new Set();
    const usedDurations = new Set();
    function search(position) {
        if (position >= order.length)
            return true;
        const specIndex = order[position];
        for (const candidate of pools[specIndex]) {
            const duration = dayDistance(outbound.outbound.departure_at, candidate.outbound.departure_at);
            if (usedIDs.has(candidate.id) || usedDurations.has(duration))
                continue;
            usedIDs.add(candidate.id);
            usedDurations.add(duration);
            if (search(position + 1))
                return true;
            usedIDs.delete(candidate.id);
            usedDurations.delete(duration);
        }
        return false;
    }
    return search(0);
}
function hotelFirstOutboundCandidates(options, origin, anchorCity, limit = 3) {
    const preferredSaudi = anchorCity === "Madinah" ? "MED" : "JED";
    return options
        .filter((option) => usableHotelFirstOneWay(option)
        && option.outbound.origin.toUpperCase() === origin.toUpperCase()
        && storefrontDepartureIsEligible(dateOnly(option.outbound.departure_at))
        && isSaudiAirport(option.outbound.destination))
        .map((option) => {
        const specs = hotelFirstVariantSpecsForOutbound(options, origin, option, anchorCity);
        const assignable = specs.length === 3;
        const distancePenalty = assignable
            ? specs.reduce((sum, spec, index) => sum + Math.abs(spec.targetDays - hotelFirstDurationTargets(anchorCity).targets[index]), 0)
            : 999;
        return { option, assignable, distancePenalty };
    })
        .filter((row) => row.assignable)
        .sort((a, b) => {
        const aPreferred = a.option.outbound.destination.toUpperCase() === preferredSaudi ? 0 : 1;
        const bPreferred = b.option.outbound.destination.toUpperCase() === preferredSaudi ? 0 : 1;
        if (aPreferred !== bPreferred)
            return aPreferred - bPreferred;
        if (a.option.outbound.departure_at !== b.option.outbound.departure_at)
            return a.option.outbound.departure_at.localeCompare(b.option.outbound.departure_at);
        if (a.distancePenalty !== b.distancePenalty)
            return a.distancePenalty - b.distancePenalty;
        if (a.option.priority !== b.option.priority)
            return a.option.priority - b.option.priority;
        return a.option.perTravelerFare - b.option.perTravelerFare;
    })
        .slice(0, Math.max(1, limit))
        .map((row) => row.option);
}
function hotelFirstReturnCandidates(options, origin, outbound, anchorCity, spec, usedReturnIDs, usedDurations, limit = 3) {
    const preferredSaudiOrigin = anchorCity === "Madinah" ? "JED" : (spec.key === "short" ? "JED" : "MED");
    return hotelFirstReturnPool(options, origin, outbound, spec)
        .filter((option) => {
        if (usedReturnIDs.has(option.id))
            return false;
        const gap = dayDistance(outbound.outbound.departure_at, option.outbound.departure_at);
        return !usedDurations.has(gap);
    })
        .sort((a, b) => {
        const aGap = dayDistance(outbound.outbound.departure_at, a.outbound.departure_at);
        const bGap = dayDistance(outbound.outbound.departure_at, b.outbound.departure_at);
        const aPreferredSaudi = a.outbound.origin.toUpperCase() === preferredSaudiOrigin ? 0 : 1;
        const bPreferredSaudi = b.outbound.origin.toUpperCase() === preferredSaudiOrigin ? 0 : 1;
        if (aPreferredSaudi !== bPreferredSaudi)
            return aPreferredSaudi - bPreferredSaudi;
        const aPreferredHome = a.outbound.destination.toUpperCase() === origin.toUpperCase() ? 0 : 1;
        const bPreferredHome = b.outbound.destination.toUpperCase() === origin.toUpperCase() ? 0 : 1;
        if (aPreferredHome !== bPreferredHome)
            return aPreferredHome - bPreferredHome;
        const target = Math.abs(aGap - spec.targetDays) - Math.abs(bGap - spec.targetDays);
        if (target !== 0)
            return target;
        if (a.perTravelerFare !== b.perTravelerFare)
            return a.perTravelerFare - b.perTravelerFare;
        return a.outbound.departure_at.localeCompare(b.outbound.departure_at);
    })
        .slice(0, Math.max(1, limit));
}
function fallbackCompanionHotels(hotels, tier, limit = 3) {
    const targetStars = tier === "luxury" ? 5 : tier === "comfort" ? 4 : 3;
    return [...hotels]
        .filter((candidate) => Boolean(candidate.id) && Boolean(candidate.name))
        .sort((a, b) => {
        const starGap = Math.abs((a.stars ?? 3) - targetStars) - Math.abs((b.stars ?? 3) - targetStars);
        if (starGap !== 0)
            return starGap;
        const ratingGap = (b.rating ?? 0) - (a.rating ?? 0);
        if (ratingGap !== 0)
            return ratingGap;
        return a.name.localeCompare(b.name);
    })
        .slice(0, Math.max(1, limit))
        .map((hotel) => ({ hotel, roomId: null }));
}
function hotelFirstBuildError(error) {
    return error instanceof Error ? error.message : String(error);
}
function selectHotelFirstBatch(hotels, origins, skippedKeys, offset, batchSize) {
    if (!hotels.length)
        return { hotels: [], nextOffset: 0 };
    const normalizedOffset = ((Math.trunc(offset) % hotels.length) + hotels.length) % hotels.length;
    const selected = [];
    let scanned = 0;
    while (scanned < hotels.length && selected.length < batchSize) {
        const index = (normalizedOffset + scanned) % hotels.length;
        const hotel = hotels[index];
        const hasPendingOrigin = origins.some((origin) => !skippedKeys.has(`${origin}:${hotel.id}`));
        if (hasPendingOrigin)
            selected.push(hotel);
        scanned += 1;
    }
    return {
        hotels: selected,
        nextOffset: (normalizedOffset + Math.max(1, scanned)) % hotels.length,
    };
}
/**
 * Builds Hotel First as an atomic 3-variant group per hotel.
 *
 * Contract:
 * - one concrete anchor hotel;
 * - one outbound flight shared by short / balanced / extended;
 * - three different return flights create the duration difference;
 * - the dedicated PackageEngine storefront quote resolves independent one-way fares + hotel D1 pricing;
 * - a hotel enters the public cache only when all three variants are ready;
 * - work is intentionally batched so a Cloudflare request never has to quote the
 *   complete hotel catalogue in one fan-out burst.
 */
export async function buildHotelFirstStorefrontPackagesDetailed(options) {
    const baseUrl = options?.baseUrl;
    const origins = (options?.origins?.length ? options.origins : ["TAS"])
        .map((value) => value.trim().toUpperCase())
        .filter((value, index, list) => value && list.indexOf(value) === index);
    const maxHotels = options?.maxHotels ? Math.max(1, options.maxHotels) : null;
    const skippedKeys = new Set(options?.skipHotelKeys ?? []);
    const requestedBatchSize = Math.max(1, Math.trunc(options?.hotelBatchSize ?? 3));
    // Three hotels per request leaves enough Cloudflare subrequest budget to retry
    // each hotel's full trio instead of abandoning lower catalogue rows early.
    const batchSize = Math.min(3, requestedBatchSize);
    const maxQuoteAttemptsPerHotel = 10;
    const travelers = { adults: 2, children: 0, infants: 0, rooms: 1 };
    const [makkahResult, madinahResult, boardRows] = await Promise.all([
        fetchHotelsByCity("Makkah", baseUrl).catch((error) => {
            console.error("[hotel-first] Makkah catalogue unavailable", error);
            return [];
        }),
        fetchHotelsByCity("Madinah", baseUrl).catch((error) => {
            console.error("[hotel-first] Madinah catalogue unavailable", error);
            return [];
        }),
        mapWithConcurrency(origins, 4, async (origin) => {
            try {
                // Flight First already succeeds from this endpoint. Hotel First now reuses
                // that exact published inventory instead of maintaining a parallel flight
                // source. /storefront/flights is optional enrichment only.
                const inventory = await fetchPublishedOneWayFlightOptions(origin, baseUrl);
                if (!inventory.length)
                    throw new Error("NO_PUBLISHED_ONE_WAY_FLIGHTS");
                return {
                    origin,
                    board: {
                        ok: true,
                        origin,
                        generatedAt: new Date().toISOString(),
                        options: inventory,
                    },
                };
            }
            catch (error) {
                console.error(`[hotel-first] published flight inventory unavailable for ${origin}`, error);
                return null;
            }
        }),
    ]);
    const allCatalogHotels = [...makkahResult, ...madinahResult]
        .filter((hotel, index, list) => hotel.id && hotel.name && list.findIndex((item) => item.id === hotel.id) === index);
    const catalogHotels = maxHotels ? allCatalogHotels.slice(0, maxHotels) : allCatalogHotels;
    const expectedHotelKeys = origins.flatMap((origin) => catalogHotels.map((hotel) => `${origin}:${hotel.id}`));
    const expectedPackageCount = expectedHotelKeys.length * 3;
    const availableBoardOrigins = new Set(boardRows.map((row) => row.origin));
    if (!catalogHotels.length || !origins.length) {
        return {
            items: [],
            expectedPackageCount,
            completedHotelCount: 0,
            expectedHotelKeys,
            attemptedHotelKeys: [],
            failedHotelKeys: expectedHotelKeys,
            nextHotelOffset: 0,
        };
    }
    const batch = selectHotelFirstBatch(catalogHotels, origins, skippedKeys, options?.hotelOffset ?? 0, batchSize);
    const attemptedHotelKeys = batch.hotels.flatMap((hotel) => origins
        .filter((origin) => !skippedKeys.has(`${origin}:${hotel.id}`))
        .map((origin) => `${origin}:${hotel.id}`));
    if (!batch.hotels.length || !boardRows.length) {
        return {
            items: [],
            expectedPackageCount,
            completedHotelCount: 0,
            expectedHotelKeys,
            attemptedHotelKeys,
            failedHotelKeys: expectedHotelKeys.filter((key) => !skippedKeys.has(key)),
            nextHotelOffset: batch.nextOffset,
        };
    }
    // Do not fetch every hotel detail from inside the same Cloudflare request.
    // The catalogue already carries the canonical identity and cover image used by
    // the card. Per-hotel detail fan-out was one of the reasons the old rebuild hit
    // the subrequest ceiling before the lower catalogue hotels were reached.
    const work = boardRows.flatMap(({ origin, board }) => batch.hotels
        .filter((hotel) => !skippedKeys.has(`${origin}:${hotel.id}`))
        .map((hotel) => ({ origin, board, hotel })));
    const companionPools = new Map();
    for (const tier of ["standard", "comfort", "luxury"]) {
        companionPools.set(`${tier}:Makkah`, fallbackCompanionHotels(makkahResult, tier, 3));
        companionPools.set(`${tier}:Madinah`, fallbackCompanionHotels(madinahResult, tier, 3));
    }
    const reusableOutboundPools = new Map();
    const failedHotelKeys = expectedHotelKeys.filter((key) => {
        const origin = key.slice(0, 3);
        return !availableBoardOrigins.has(origin) && !skippedKeys.has(key);
    });
    const quoted = await mapWithConcurrency(work, Math.min(3, work.length), async ({ origin, board, hotel }) => {
        const key = `${origin}:${hotel.id}`;
        const anchorCity = hotelFirstAnchorCity(hotel);
        const tier = automaticTierForHotel(hotel);
        const poolKey = `${origin}:${anchorCity}`;
        let outboundCandidates = reusableOutboundPools.get(poolKey);
        if (!outboundCandidates) {
            outboundCandidates = hotelFirstOutboundCandidates(board.options, origin, anchorCity, 12);
            reusableOutboundPools.set(poolKey, outboundCandidates);
        }
        if (!outboundCandidates.length) {
            failedHotelKeys.push(key);
            console.warn(`[hotel-first] ${key} has fewer than three distinct published return durations for Hotel First`);
            return null;
        }
        const companionChoices = anchorCity === "Makkah"
            ? (companionPools.get(`${tier}:Madinah`) ?? [])
            : (companionPools.get(`${tier}:Makkah`) ?? []);
        if (!companionChoices.length) {
            failedHotelKeys.push(key);
            console.warn(`[hotel-first] ${key} has no companion hotel for ${tier}`);
            return null;
        }
        // Companion hotel is metadata for the later full configurator only. Hotel
        // First preview pricing intentionally prices the selected anchor hotel via
        // /api/package/storefront/quote, so retrying the same flight trio against
        // multiple companions would only waste subrequests.
        const companion = companionChoices[0];
        let quoteAttempts = 0;
        for (const outboundOption of outboundCandidates) {
            const specs = hotelFirstVariantSpecsForOutbound(board.options, origin, outboundOption, anchorCity);
            if (specs.length !== 3)
                continue;
            const usedReturnIDs = new Set();
            const usedDurations = new Set();
            const variants = [];
            let failedSpec = null;
            for (const spec of specs) {
                const inboundCandidates = hotelFirstReturnCandidates(board.options, origin, outboundOption, anchorCity, spec, usedReturnIDs, usedDurations, 3);
                let builtVariant = null;
                for (const inboundOption of inboundCandidates) {
                    if (quoteAttempts >= maxQuoteAttemptsPerHotel)
                        break;
                    const stay = hotelFirstStay(anchorCity, outboundOption.outbound, inboundOption.outbound);
                    const requiresMadinah = stay.madinahNights > 0;
                    const makkahChoice = anchorCity === "Makkah"
                        ? { hotel, roomId: null }
                        : companion;
                    const madinahChoice = anchorCity === "Madinah"
                        ? { hotel, roomId: null }
                        : (requiresMadinah ? companion : null);
                    if (!makkahChoice || (requiresMadinah && !madinahChoice))
                        continue;
                    const providerItineraryId = `curated:${outboundOption.id}+${inboundOption.id}`;
                    quoteAttempts += 1;
                    try {
                        // Hotel First must use the same production quote path as Flight First.
                        // The old storefront-preview endpoint priced only the anchor hotel for
                        // stay.totalNights, even when the itinerary was split between Makkah and
                        // Madinah. That created a second pricing path which could reject Hotel
                        // First independently from the already-working Flight First engine.
                        // Build the exact two-city hotel allocation and let PackageEngine price
                        // the immutable selected hotels from HOTELS_DB through /api/package/quote.
                        const quote = await requestPackageQuote({
                            tier,
                            travelers,
                            journey: {
                                id: providerItineraryId,
                                providerItineraryId,
                                outboundOfferId: outboundOption.id,
                                inboundOfferId: inboundOption.id,
                                outbound: outboundOption.outbound,
                                inbound: inboundOption.outbound,
                                currency: "USD",
                                observedAt: new Date().toISOString(),
                            },
                            stay,
                            meals: { makkahLunch: false, makkahDinner: false, madinahDinner: false },
                            transferVehicle: null,
                            haramainEnabled: false,
                            haramainFareClass: "economy",
                            haramainTicketCount: 0,
                            makkahHotelId: makkahChoice.hotel.id,
                            makkahRoomId: makkahChoice.roomId,
                            madinahHotelId: madinahChoice?.hotel.id ?? null,
                            madinahRoomId: madinahChoice?.roomId ?? null,
                        }, baseUrl);
                        if (!(quote.pricePerPerson > 0) || !(quote.totalPackagePrice > 0))
                            continue;
                        builtVariant = {
                            id: `hotel-first:${origin}:${hotel.id}:${spec.key}:${outboundOption.id}:${inboundOption.id}:${quote.quoteId}`,
                            entryMode: "hotel-first",
                            status: "ready",
                            originCode: origin,
                            originCity: ORIGIN_CITY_MAP[origin] ?? origin,
                            destinationCode: outboundOption.outbound.destination.toUpperCase(),
                            tier,
                            kind: requiresMadinah ? "makkah-madinah" : "makkah-only",
                            startDate: stay.startDate,
                            endDate: stay.endDate,
                            totalDays: stay.totalDays,
                            totalNights: stay.totalNights,
                            makkahNights: stay.makkahNights,
                            madinahNights: stay.madinahNights,
                            hotelFirstVariant: spec.key,
                            hotelFirstVariantIndex: spec.index,
                            hotelFirstVariantMinDays: spec.minDays,
                            hotelFirstVariantMaxDays: spec.maxDays,
                            hotelFirstAnchorCity: anchorCity,
                            hotelFirstAnchorHotelId: hotel.id,
                            hotelFirstEngineVersion: HOTEL_FIRST_ENGINE_VERSION,
                            outbound: publicFlight(outboundOption.outbound),
                            inbound: publicFlight(inboundOption.outbound),
                            providerItineraryId,
                            outboundOfferId: outboundOption.id,
                            inboundOfferId: inboundOption.id,
                            imageUrl: coverImage(hotel.images),
                            hotelImages: hotelImageUrls(hotel.images),
                            hotelName: anchorCity === "Makkah" ? hotel.name : makkahChoice.hotel.name,
                            hotelSecondaryName: anchorCity === "Madinah" ? hotel.name : (madinahChoice?.hotel.name ?? null),
                            hotelCity: hotel.city,
                            hotelStars: hotel.stars,
                            hotelRating: hotel.rating,
                            hotelReviewCount: hotel.reviewCount,
                            makkahHotelId: makkahChoice.hotel.id,
                            madinahHotelId: madinahChoice?.hotel.id ?? null,
                            routeSummary: `${outboundOption.outbound.origin} → ${outboundOption.outbound.destination} + ${inboundOption.outbound.origin} → ${inboundOption.outbound.destination} · ${stay.totalDays} d · Hotel First ${spec.key}`,
                            pricePerPerson: quote.pricePerPerson,
                            totalPackagePrice: quote.totalPackagePrice,
                            currency: quote.currency,
                            isEstimated: quote.isEstimated,
                            configuration: {
                                adults: 2,
                                children: 0,
                                infants: 0,
                                rooms: 1,
                                makkahLunch: false,
                                makkahDinner: false,
                                madinahDinner: false,
                                transferVehicle: null,
                                haramainEnabled: false,
                                haramainFareClass: "economy",
                                haramainTicketCount: 0,
                                makkahRoomId: makkahChoice.roomId,
                                madinahRoomId: madinahChoice?.roomId ?? null,
                            },
                        };
                        usedReturnIDs.add(inboundOption.id);
                        usedDurations.add(dayDistance(outboundOption.outbound.departure_at, inboundOption.outbound.departure_at));
                        break;
                    }
                    catch (error) {
                        console.warn(`[hotel-first] quote rejected hotel=${hotel.id} origin=${origin} variant=${spec.key} outbound=${outboundOption.id} inbound=${inboundOption.id} companion=${companion?.hotel.id ?? "none"}: ${hotelFirstBuildError(error)}`);
                    }
                }
                if (!builtVariant) {
                    failedSpec = spec.key;
                    break;
                }
                variants.push(builtVariant);
            }
            if (variants.length === specs.length) {
                variants.sort((a, b) => (a.hotelFirstVariantIndex ?? 99) - (b.hotelFirstVariantIndex ?? 99));
                return variants;
            }
            console.warn(`[hotel-first] incomplete trio hotel=${hotel.id} origin=${origin} outbound=${outboundOption.id} companion=${companion.hotel.id} missing=${failedSpec ?? "unknown"} attempts=${quoteAttempts}/${maxQuoteAttemptsPerHotel}`);
            if (quoteAttempts >= maxQuoteAttemptsPerHotel)
                break;
        }
        failedHotelKeys.push(key);
        console.error(`[hotel-first] failed to build atomic three-variant package group for ${key} after ${quoteAttempts} quote attempts`);
        return null;
    });
    const items = quoted.flat();
    const completedHotelKeys = new Set(items
        .map((item) => item.hotelFirstAnchorHotelId ? `${item.originCode}:${item.hotelFirstAnchorHotelId}` : null)
        .filter((value) => Boolean(value)));
    return {
        items,
        expectedPackageCount,
        completedHotelCount: completedHotelKeys.size,
        expectedHotelKeys,
        attemptedHotelKeys,
        failedHotelKeys: [...new Set(failedHotelKeys)],
        nextHotelOffset: batch.nextOffset,
    };
}
export async function buildHotelFirstStorefrontPackages(options) {
    return (await buildHotelFirstStorefrontPackagesDetailed(options)).items;
}
export function hotelFirstPackagesFromFlightFirst(items) {
    return items
        .filter((item) => item.status === "ready" && item.makkahHotelId && storefrontDepartureIsEligible(item.startDate))
        .map((item) => ({ ...item, id: `hotel-first:${item.makkahHotelId}:${item.id}`, entryMode: "hotel-first" }));
}
export const STOREFRONT_CACHE_REFRESHED_EVENT = "iumrah:storefront-cache-refreshed";
const CLIENT_HOTEL_REFRESH_BATCH_SIZE = 3;
const CLIENT_HOTEL_MAX_REFRESH_PASSES = 24;
const clientRefreshPromises = new Map();
function refreshDelay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function triggerClientDailyRefresh(mode, origin, initialCursor = 0) {
    if (typeof window === "undefined")
        return;
    const normalizedOrigin = origin.trim().toUpperCase() || "TAS";
    const key = `${mode}:${normalizedOrigin}`;
    if (clientRefreshPromises.has(key))
        return;
    const task = (async () => {
        let cursor = Math.max(0, Math.trunc(initialCursor));
        if (mode === "flight-first") {
            // Flight First is intentionally unbounded from the UI perspective. Keep
            // asking the server for the next small pricing batch until it reports that
            // every published candidate has been attempted. The no-progress guard
            // prevents an unhealthy backend from creating an infinite browser loop.
            while (true) {
                let response;
                try {
                    response = await backendFetch("/api/storefront/packages", {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ mode, origin: normalizedOrigin, cursor, reason: "daily-prewarm" }),
                        cache: "no-store",
                    });
                }
                catch {
                    break;
                }
                if (!response.ok)
                    break;
                let body;
                try {
                    body = await response.json();
                }
                catch {
                    break;
                }
                if (!body.ok)
                    break;
                window.dispatchEvent(new Event(STOREFRONT_CACHE_REFRESHED_EVENT));
                if (body.complete === true)
                    break;
                const nextCursor = Math.max(0, Math.trunc(body.nextRefreshCursor ?? cursor));
                if (nextCursor <= cursor)
                    break;
                cursor = nextCursor;
                await refreshDelay(120);
            }
            return;
        }
        let maxPasses = CLIENT_HOTEL_MAX_REFRESH_PASSES;
        for (let pass = 0; pass < maxPasses; pass += 1) {
            let response;
            try {
                response = await backendFetch("/api/storefront/packages", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ mode, origin: normalizedOrigin, cursor, reason: "daily-prewarm" }),
                    cache: "no-store",
                });
            }
            catch {
                break;
            }
            if (!response.ok)
                break;
            let body;
            try {
                body = await response.json();
            }
            catch {
                break;
            }
            if (!body.ok)
                break;
            window.dispatchEvent(new Event(STOREFRONT_CACHE_REFRESHED_EVENT));
            if (body.complete === true)
                break;
            const nextCursor = Math.max(0, Math.trunc(body.nextRefreshCursor ?? cursor));
            if (nextCursor === cursor && pass > 0)
                break;
            cursor = nextCursor;
            const expected = Number(body.expectedItemCount ?? 0);
            if (Number.isFinite(expected) && expected > 0) {
                const expectedHotels = Math.ceil(expected / 3);
                // Two catalogue passes are enough to give transient quote failures a
                // second chance without turning a broken supplier price into an endless
                // browser loop.
                maxPasses = Math.min(CLIENT_HOTEL_MAX_REFRESH_PASSES, Math.max(2, Math.ceil(expectedHotels / CLIENT_HOTEL_REFRESH_BATCH_SIZE) * 2));
            }
            await refreshDelay(120);
        }
    })().finally(() => {
        clientRefreshPromises.delete(key);
    });
    clientRefreshPromises.set(key, task);
}
export async function loadStorefrontPackages(options) {
    const maxPackages = typeof options?.maxPackages === "number"
        ? Math.max(1, Math.trunc(options.maxPackages))
        : null;
    const mode = options?.mode ?? "flight-first";
    const params = new URLSearchParams({ mode });
    if (maxPackages !== null)
        params.set("limit", String(maxPackages));
    if (options?.origins?.length)
        params.set("origins", options.origins.join(","));
    try {
        const response = await backendFetch(`/api/storefront/packages?${params.toString()}`, { cache: "no-store" });
        const body = await response.json();
        const refreshOrigin = options?.origins?.[0]?.trim().toUpperCase() || "TAS";
        if (body.refreshRecommended) {
            triggerClientDailyRefresh(mode, refreshOrigin, body.nextRefreshCursor ?? 0);
        }
        if (response.ok && body.ok && Array.isArray(body.items)) {
            const readyItems = body.items
                .filter((item) => item.status === "ready" && item.pricePerPerson !== null && item.totalPackagePrice !== null);
            return maxPackages === null ? readyItems : readyItems.slice(0, maxPackages);
        }
    }
    catch {
        // A failed cache request must never leak supplier fares or create endless
        // client-side "calculating" cards. The next request retries the server cache.
    }
    return [];
}
export async function loadStorefrontPackageById(packageId) {
    if (!/^\d{10}$/.test(packageId.trim()))
        return null;
    try {
        const response = await backendFetch(`/api/storefront/packages/${encodeURIComponent(packageId)}`, { cache: "no-store" });
        if (!response.ok)
            return null;
        const body = await response.json();
        return body.ok && body.package ? body.package : null;
    }
    catch {
        return null;
    }
}
export function storefrontPublicFlight(leg) {
    return publicFlight(leg);
}
export function storefrontStayForPackage(kind, startDate, endDate, exact) {
    if (typeof exact?.makkahNights === "number" && typeof exact?.madinahNights === "number") {
        const totalNights = Math.max(1, exact.makkahNights + exact.madinahNights);
        const anchorCity = exact.anchorCity ?? "Madinah";
        if (anchorCity === "Makkah") {
            const makkahCheckOut = addDays(startDate, exact.makkahNights);
            return {
                startDate, endDate, totalNights, totalDays: totalNights,
                makkahNights: exact.makkahNights, madinahNights: exact.madinahNights,
                makkahCheckIn: startDate, makkahCheckOut,
                madinahCheckIn: makkahCheckOut, madinahCheckOut: endDate,
            };
        }
        const madinahCheckOut = addDays(startDate, exact.madinahNights);
        return {
            startDate, endDate, totalNights, totalDays: totalNights,
            makkahNights: exact.makkahNights, madinahNights: exact.madinahNights,
            makkahCheckIn: madinahCheckOut, makkahCheckOut: endDate,
            madinahCheckIn: startDate, madinahCheckOut,
        };
    }
    return buildStay(kind, startDate, endDate);
}
