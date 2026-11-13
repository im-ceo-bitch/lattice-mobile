// Ported from iumrah-web-main 5.zip: lib/web-package.ts
import { requestEnv, backendFetch } from "../runtime.js";
export const PACKAGE_DRAFT_KEY = "iumrah.web.package-draft.v1";
export const BOOKING_KEY = "iumrah.web.booking.v1";
const TIER_STARS = {
    economy: 2,
    standard: 3,
    comfort: 4,
    luxury: 5,
};
export function hotelStarsForTier(tier) {
    return TIER_STARS[tier];
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
export function nightsBetween(start, end) {
    const ms = utcDate(end).getTime() - utcDate(start).getTime();
    return Math.max(1, Math.round(ms / 86_400_000));
}
export function stayPlanForJourney(journey) {
    const startDate = dateOnly(journey.outbound.arrival_at || journey.outbound.departure_at);
    const endDate = dateOnly(journey.inbound.departure_at);
    const totalNights = nightsBetween(startDate, endDate);
    const makkahNights = totalNights > 1 ? Math.max(1, Math.min(totalNights - 1, Math.ceil(totalNights * 0.6))) : totalNights;
    const madinahNights = totalNights > 1 ? Math.max(1, totalNights - makkahNights) : 0;
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
export function isOneWayRecommendation(item) {
    return (item.offerType ?? (item.inbound ? "paired_one_way" : "one_way")) === "one_way";
}
export function recommendationRole(item) {
    if (item.journeyRole)
        return item.journeyRole;
    return isOneWayRecommendation(item) ? "outbound" : "complete";
}
function futureDate(days) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}
function apiUrl(path, baseUrl) {
    if (!baseUrl)
        return path;
    return new URL(path, baseUrl).toString();
}
export async function fetchCuratedRecommendations(origin, baseUrl) {
    const params = new URLSearchParams({
        umrah_origin: origin.toUpperCase(),
        from: futureDate(0),
        to: futureDate(365),
        // The PackageEngine recommendation endpoint historically defaults to a small
        // storefront page. Ask for the complete currently published inventory in one
        // read so the web catalogue is not silently narrowed to that default page.
        limit: "500",
    });
    // Browser traffic can arrive through both iumrah.app and iumrah.uz. The
    // PackageEngine route is canonical on iumrah.app, while a relative /api/package
    // request on another public domain may hit a different/stale worker route.
    // Keep browser reads on a same-origin storefront proxy; that proxy forwards to
    // the canonical PackageEngine without CORS and makes desktop/mobile identical.
    const endpoint = baseUrl
        ? apiUrl(`/api/package/flights/recommendations?${params.toString()}`, baseUrl)
        : `/api/storefront/flight-recommendations?${params.toString()}`;
    const response = await backendFetch(endpoint, { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.ok)
        throw new Error(body?.error || "FLIGHTS_UNAVAILABLE");
    return (Array.isArray(body.recommendations) ? body.recommendations : []).filter((item) => item.nonstop);
}
export async function fetchStorefrontFlightBoard(origin = "TAS", baseUrl) {
    const params = new URLSearchParams({
        origin: origin.toUpperCase(),
        // Keep the optional storefront board from becoming the accidental 12-item
        // source of truth when the backend supports a larger page size.
        limit: "500",
    });
    const response = await backendFetch(apiUrl(`/api/package/storefront/flights?${params.toString()}`, baseUrl), { cache: "no-store" });
    const body = await response.json();
    if (!response.ok || !body.ok || !Array.isArray(body.options)) {
        throw new Error(body.error || "STOREFRONT_FLIGHTS_UNAVAILABLE");
    }
    return {
        ...body,
        options: body.options.filter((item) => item.outbound?.stops === 0 && (item.inbound?.stops ?? 0) === 0),
    };
}
function publicOneWayOption(item) {
    if (item.inbound || !item.nonstop)
        return null;
    return {
        id: item.id,
        kind: "curated-one-way",
        priority: 0,
        currency: "USD",
        travelerCount: 2,
        // Recommendation feeds intentionally hide supplier fare. Callers must never
        // price from these placeholders; PackageEngine resolves the real D1 fare.
        totalFare: 2,
        perTravelerFare: 1,
        observedAt: item.observedAt,
        outbound: item.outbound,
        inbound: null,
    };
}
export async function fetchPublishedOneWayFlightOptions(origin, baseUrl) {
    const [recommendations, board] = await Promise.all([
        fetchCuratedRecommendations(origin, baseUrl),
        fetchStorefrontFlightBoard(origin, baseUrl).catch(() => null),
    ]);
    const merged = new Map();
    for (const recommendation of recommendations) {
        const option = publicOneWayOption(recommendation);
        if (option)
            merged.set(option.id, option);
    }
    // Preserve richer metadata from the optional storefront board for the same
    // offer ID, but never let board availability narrow the published inventory.
    for (const option of board?.options ?? []) {
        if (option.inbound || option.outbound?.stops !== 0 || option.currency.toUpperCase() !== "USD" || !(option.perTravelerFare > 0))
            continue;
        merged.set(option.id, option);
    }
    return [...merged.values()];
}
export function publishedFlightGroups(recommendations, origin, outboundDestination = "MED", returnOrigin = "JED") {
    const code = origin.toUpperCase();
    const outboundCode = outboundDestination.toUpperCase();
    const returnCode = returnOrigin.toUpperCase();
    // Match the same route rules as the iOS generator/calendar. The selected
    // pilgrimage route is authoritative: do not mix JED and MED publications.
    const outbound = recommendations
        .filter((item) => !item.inbound && item.outbound.origin.toUpperCase() === code && item.outbound.destination.toUpperCase() === outboundCode)
        .sort((a, b) => a.outboundDate.localeCompare(b.outboundDate));
    const returns = recommendations
        .filter((item) => !item.inbound && item.outbound.origin.toUpperCase() === returnCode && item.outbound.destination.toUpperCase() === code)
        .sort((a, b) => a.outboundDate.localeCompare(b.outboundDate));
    const complete = recommendations
        .filter((item) => {
        const inbound = item.inbound;
        if (!inbound)
            return false;
        return item.outbound.origin.toUpperCase() === code
            && item.outbound.destination.toUpperCase() === outboundCode
            && inbound.origin.toUpperCase() === returnCode
            && inbound.destination.toUpperCase() === code
            && Boolean(item.inboundDate);
    })
        .sort((a, b) => a.outboundDate.localeCompare(b.outboundDate));
    return { outbound, returns, complete };
}
function publicLeg(leg) {
    return {
        airline: leg.airline,
        flight_number: leg.flightNumber,
        airline_code: leg.airlineCode ?? "",
        origin: leg.origin,
        destination: leg.destination,
        departure_at: leg.departureAt,
        arrival_at: leg.arrivalAt,
        duration_minutes: leg.durationMinutes,
        stops: 0,
        cabin_class: leg.cabinClass ?? "economy",
    };
}
export async function resolvePublishedSelection(input, baseUrl) {
    // The customer-facing generator is served from iumrah.uz as well as
    // iumrah.app. Resolve selected flights through the same-origin Next proxy,
    // like recommendations and quotes, instead of posting to a route that only
    // exists on the canonical PackageEngine worker.
    const endpoint = baseUrl
        ? apiUrl("/api/package/flights/recommendations/resolve", baseUrl)
        : "/api/storefront/flight-resolve";
    const response = await backendFetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
            completeID: input.selection.completeID,
            outboundID: input.selection.outboundID,
            returnID: input.selection.returnID,
            travelerCount: input.travelerCount,
            origin: input.origin.toUpperCase(),
            outboundDestination: input.outboundDestination ?? "MED",
            returnOrigin: input.returnOrigin ?? "JED",
            returnDestination: input.origin.toUpperCase(),
        }),
    });
    // Safari can surface an HTML error page as an opaque parsing exception.
    // Keep UI failures machine-readable and do not proceed with an invalid fare.
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.ok || !body.providerItineraryID || !body.outbound || !body.inbound) {
        throw new Error(body?.error || "FLIGHT_SELECTION_UNAVAILABLE");
    }
    return {
        id: body.providerItineraryID,
        providerItineraryId: body.providerItineraryID,
        outboundOfferId: input.selection.completeID ?? input.selection.outboundID ?? body.outbound.id,
        inboundOfferId: input.selection.completeID ?? input.selection.returnID ?? body.inbound.id,
        outbound: publicLeg(body.outbound),
        inbound: publicLeg(body.inbound),
        currency: body.currency,
        observedAt: body.resolvedAt,
    };
}
export async function fetchPrimaryHotel(tier, city, baseUrl) {
    const stars = hotelStarsForTier(tier);
    const path = `/api/package/primary-hotel?tier=${tier}&stars=${stars}&city=${encodeURIComponent(city)}`;
    const url = baseUrl ? apiUrl(path, baseUrl) : `/api/storefront/primary-hotel?tier=${tier}&stars=${stars}&city=${encodeURIComponent(city)}`;
    const response = await backendFetch(url, { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.ok)
        throw new Error(body?.error || "HOTEL_UNAVAILABLE");
    return body;
}
export async function fetchHotelDetail(id, baseUrl) {
    const url = baseUrl
        ? apiUrl(`/api/catalog/hotels/${encodeURIComponent(id)}`, baseUrl)
        : `/api/storefront/hotel-detail?id=${encodeURIComponent(id)}`;
    const response = await backendFetch(url, { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.hotel)
        throw new Error(body?.error || "HOTEL_DETAIL_UNAVAILABLE");
    return body.hotel;
}
export async function fetchRoomCategories(hotelId, baseUrl) {
    const url = baseUrl
        ? apiUrl(`/api/package/hotel/${encodeURIComponent(hotelId)}/room-categories`, baseUrl)
        : `/api/storefront/hotel-rooms?id=${encodeURIComponent(hotelId)}`;
    const response = await backendFetch(url, { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.ok)
        throw new Error(body?.error || "ROOMS_UNAVAILABLE");
    return body.categories ?? [];
}
export function preferredRoomId(categories, travelers) {
    const perRoom = Math.ceil((travelers.adults + travelers.children) / Math.max(1, travelers.rooms));
    const sorted = [...categories].filter((item) => item.maxGuests >= perRoom).sort((a, b) => a.maxGuests - b.maxGuests);
    return sorted[0]?.id ?? categories[0]?.id ?? null;
}
export async function resolveHotelForTier(tier, city, travelers, baseUrl) {
    const primary = await fetchPrimaryHotel(tier, city, baseUrl);
    const [hotel, categories] = await Promise.all([
        fetchHotelDetail(primary.hotelId, baseUrl),
        fetchRoomCategories(primary.hotelId, baseUrl),
    ]);
    return {
        hotel,
        roomId: preferredRoomId(categories, travelers) ?? primary.roomId,
    };
}
export async function resolveHotelsForTier(tier, travelers, baseUrl) {
    const [makkah, madinah] = await Promise.all([
        resolveHotelForTier(tier, "Makkah", travelers, baseUrl),
        resolveHotelForTier(tier, "Madinah", travelers, baseUrl),
    ]);
    return {
        makkahHotel: makkah.hotel,
        madinahHotel: madinah.hotel,
        makkahRoomId: makkah.roomId,
        madinahRoomId: madinah.roomId,
    };
}
export async function requestPackageQuote(input, baseUrl) {
    const includeMadinah = input.stay.madinahNights > 0 && Boolean(input.madinahHotelId);
    const body = {
        tier: input.tier,
        tripType: "roundTrip",
        includeMadinah,
        travelers: input.travelers,
        meals: input.meals,
        transferVehicle: input.transferVehicle,
        haramain: {
            enabled: input.haramainEnabled,
            fareClass: input.haramainFareClass,
            ticketCount: input.haramainTicketCount,
        },
        flight: {
            providerItineraryId: input.journey.providerItineraryId,
            cabinClass: "economy",
            infantsInSeat: input.travelers.infants,
            infantsOnLap: 0,
            legs: [
                { origin: input.journey.outbound.origin, destination: input.journey.outbound.destination, departureDate: dateOnly(input.journey.outbound.departure_at) },
                { origin: input.journey.inbound.origin, destination: input.journey.inbound.destination, departureDate: dateOnly(input.journey.inbound.departure_at) },
            ],
        },
        hotels: {
            makkah: { hotelId: input.makkahHotelId, roomId: input.makkahRoomId, nights: input.stay.makkahNights },
            ...(includeMadinah && input.madinahHotelId
                ? { madinah: { hotelId: input.madinahHotelId, roomId: input.madinahRoomId, nights: input.stay.madinahNights } }
                : {}),
        },
    };
    const quoteUrl = baseUrl ? apiUrl("/api/package/quote", baseUrl) : "/api/storefront/package-quote";
    const response = await backendFetch(quoteUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.ok || !result.quote)
        throw new Error(result?.error || "QUOTE_UNAVAILABLE");
    return result.quote;
}
export async function requestHotelStorefrontQuote(input, baseUrl) {
    const response = await backendFetch(apiUrl("/api/package/storefront/quote", baseUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            tier: input.tier,
            travelers: input.travelers,
            rooms: input.rooms,
            hotelId: input.hotelId,
            hotelNights: input.hotelNights,
            flight: {
                outboundOfferId: input.outboundOfferId,
                inboundOfferId: input.inboundOfferId,
                outboundOrigin: input.outboundOrigin,
                outboundDestination: input.outboundDestination,
                outboundDate: input.outboundDate,
                inboundOrigin: input.inboundOrigin,
                inboundDestination: input.inboundDestination,
                inboundDate: input.inboundDate,
            },
        }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok || !result.quote)
        throw new Error(result.error || "STOREFRONT_QUOTE_UNAVAILABLE");
    return result.quote;
}
export function buildGeneratorTrace(draft) {
    const flightSnapshot = (leg, candidateId) => ({
        candidateId,
        airline: leg.airline,
        flightNumbers: leg.flight_number,
        origin: leg.origin,
        destination: leg.destination,
        departureAt: leg.departure_at,
        arrivalAt: leg.arrival_at,
        source: "iumrah Published",
        stops: leg.stops,
        durationMinutes: leg.duration_minutes,
        segments: [{
                airline: leg.airline,
                airlineCode: leg.airline_code,
                flightNumber: leg.flight_number,
                origin: leg.origin,
                destination: leg.destination,
                departureAt: leg.departure_at,
                arrivalAt: leg.arrival_at,
                originTerminal: null,
                destinationTerminal: null,
                aircraft: null,
                operatingCarrier: null,
                cabin: leg.cabin_class,
            }],
        connectionAirports: [],
    });
    const hotelSnapshot = (hotel, roomId) => {
        const room = hotel.rooms.find((item) => item.id === roomId);
        return { hotelId: hotel.id, hotelName: hotel.name, city: hotel.city, roomId, roomName: room?.name ?? null, roomCategory: null };
    };
    return {
        quoteId: draft.quote.quoteId,
        outbound: flightSnapshot(draft.journey.outbound, draft.journey.outboundOfferId),
        inbound: flightSnapshot(draft.journey.inbound, draft.journey.inboundOfferId),
        makkahHotel: hotelSnapshot(draft.makkahHotel, draft.makkahRoomId),
        madinahHotel: hotelSnapshot(draft.madinahHotel, draft.madinahRoomId),
    };
}
export async function reconcileStoredBooking(booking) {
    let current = booking;
    let commitOk = !booking.pendingQuoteProof;
    if (booking.pendingQuoteProof) {
        try {
            const response = await backendFetch(`/api/package/quote/commit/${encodeURIComponent(booking.id)}`, {
                method: "POST",
                headers: { "content-type": "application/json", "x-booking-token": booking.accessToken },
                body: JSON.stringify({ quoteProof: booking.pendingQuoteProof }),
            });
            commitOk = response.ok;
            if (response.ok) {
                const settled = { ...booking };
                delete settled.pendingQuoteProof;
                current = settled;
                saveBooking(current);
            }
        }
        catch {
            commitOk = false;
        }
    }
    let syncOk = false;
    try {
        const profile = current.profile;
        const trace = current.generatorTrace ?? buildGeneratorTrace(current.draft);
        const response = await backendFetch(`/api/catalog/hotels/client/trips/${encodeURIComponent(current.id)}/sync`, {
            method: "POST",
            headers: { "content-type": "application/json", "x-booking-token": current.accessToken },
            body: JSON.stringify({ ...(profile ?? {}), displayName: profile ? `${profile.firstName} ${profile.lastName}`.trim() : "", generatorTrace: trace }),
        });
        syncOk = response.ok;
        if (response.ok) {
            try {
                const payload = await response.json();
                const record = (value) => typeof value === "object" && value !== null ? value : null;
                const root = record(payload);
                const candidates = [root, record(root?.trip), record(root?.booking), record(root?.data), record(record(root?.data)?.trip), record(record(root?.data)?.booking)].filter(Boolean);
                const firstString = (...keys) => {
                    for (const item of candidates)
                        for (const key of keys) {
                            const value = item[key];
                            if (typeof value === "string" && value.trim())
                                return value.trim();
                        }
                    return null;
                };
                const firstNumber = (...keys) => {
                    for (const item of candidates)
                        for (const key of keys) {
                            const value = item[key];
                            if (typeof value === "number" && Number.isFinite(value))
                                return value;
                            if (typeof value === "string" && /^\d+$/.test(value.trim()))
                                return Number(value.trim());
                        }
                    return null;
                };
                const bookingNumber = firstNumber("bookingNumber", "booking_number");
                const bookingDisplayNumber = firstString("bookingDisplayNumber", "booking_display_number", "displayBookingNumber", "display_number");
                const pilgrimID = firstString("pilgrimID", "pilgrimId", "pilgrim_id", "iumrahID", "iumrahId", "iumrah_id");
                const iumrahID = firstString("iumrahID", "iumrahId", "iumrah_id", "pilgrimID", "pilgrimId", "pilgrim_id");
                if (bookingNumber !== null || bookingDisplayNumber || pilgrimID || iumrahID) {
                    current = {
                        ...current,
                        bookingNumber: bookingNumber ?? current.bookingNumber ?? null,
                        bookingDisplayNumber: bookingDisplayNumber ?? current.bookingDisplayNumber ?? null,
                        pilgrimID: pilgrimID ?? current.pilgrimID ?? null,
                        iumrahID: iumrahID ?? current.iumrahID ?? null,
                    };
                    saveBooking(current);
                }
            }
            catch { /* Some sync implementations return an empty body; the booking remains valid. */ }
        }
    }
    catch {
        syncOk = false;
    }
    return { booking: current, commitOk, syncOk };
}
export function savePackageDraft(draft) {
    window.sessionStorage.setItem(PACKAGE_DRAFT_KEY, JSON.stringify(draft));
}
export function loadPackageDraft() {
    try {
        const value = window.sessionStorage.getItem(PACKAGE_DRAFT_KEY);
        if (!value)
            return null;
        const parsed = JSON.parse(value);
        return parsed?.version === 1 ? parsed : null;
    }
    catch {
        return null;
    }
}
export function saveBooking(booking) {
    window.localStorage.setItem(BOOKING_KEY, JSON.stringify(booking));
}
export function loadBooking() {
    try {
        const value = window.localStorage.getItem(BOOKING_KEY);
        return value ? JSON.parse(value) : null;
    }
    catch {
        return null;
    }
}
export function clearPackageDraft() {
    window.sessionStorage.removeItem(PACKAGE_DRAFT_KEY);
}
export function formatMoney(value, currency = "USD") {
    return new Intl.NumberFormat("ru-RU", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
}
export function formatTripDate(value) {
    const date = new Date(value);
    return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(date);
}
export function formatLongTripDate(value) {
    const date = new Date(value);
    return new Intl.DateTimeFormat("ru-RU", { weekday: "short", day: "numeric", month: "long" }).format(date);
}
export function formatTime(value) {
    const date = new Date(value);
    return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(date);
}
export function formatDuration(minutes) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${hours} ч ${rest} мин` : `${hours} ч`;
}
export function selectableHotelStarsForTier(tier) {
    return tier === "economy" ? [2, 1] : [hotelStarsForTier(tier)];
}
function normalizeHotelListItem(hotel) {
    return {
        id: hotel.id,
        name: hotel.name,
        city: hotel.city,
        country: "Saudi Arabia",
        stars: hotel.stars,
        rating: hotel.rating,
        reviewCount: hotel.reviewCount ?? null,
        address: "",
        description: "",
        checkIn: null,
        checkOut: null,
        status: hotel.status ?? "active",
        amenities: [],
        images: hotel.coverImageURL ? [{ id: `cover:${hotel.id}`, url: hotel.coverImageURL, isCover: true, position: 0 }] : [],
        rooms: [],
    };
}
export async function fetchHotelsByCity(city, baseUrl) {
    // Browser traffic may be served from iumrah.uz while the canonical Hotels Worker
    // is routed on iumrah.app. Keep the browser same-origin and let our Next route
    // proxy the canonical database API. Server builders receive baseUrl explicitly
    // and continue talking to the canonical backend directly.
    if (!baseUrl) {
        const response = await backendFetch(`/api/storefront/hotels?city=${encodeURIComponent(city)}`, { cache: "no-store" });
        const body = await response.json();
        if (!response.ok)
            throw new Error(body.error || "HOTELS_UNAVAILABLE");
        return (body.hotels ?? []).map(normalizeHotelListItem).sort((a, b) => {
            const starDelta = (b.stars ?? 0) - (a.stars ?? 0);
            return starDelta || a.name.localeCompare(b.name);
        });
    }
    const aliases = city === "Makkah"
        ? ["Makkah"]
        : ["Madinah", "Medina", "Madina", "Medinah", "Al Madinah", "Al Medina", "Madinah Al Munawwarah", "Al Madinah Al Munawwarah"];
    const settled = await Promise.allSettled(aliases.map(async (alias) => {
        const response = await backendFetch(apiUrl(`/api/catalog/hotels?city=${encodeURIComponent(alias)}`, baseUrl), { cache: "no-store" });
        const body = await response.json();
        if (!response.ok)
            throw new Error(body.error || "HOTELS_UNAVAILABLE");
        return (body.hotels ?? []).map(normalizeHotelListItem);
    }));
    const merged = new Map();
    for (const result of settled) {
        if (result.status !== "fulfilled")
            continue;
        for (const hotel of result.value)
            merged.set(hotel.id, hotel);
    }
    return [...merged.values()].sort((a, b) => {
        const starDelta = (b.stars ?? 0) - (a.stars ?? 0);
        return starDelta || a.name.localeCompare(b.name);
    });
}
export async function resolveHotelRoom(hotelId, travelers) {
    const categories = await fetchRoomCategories(hotelId);
    return preferredRoomId(categories, travelers);
}
