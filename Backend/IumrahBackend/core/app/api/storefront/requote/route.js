// Ported from iumrah-web-main 5.zip: app/api/storefront/requote/route.ts
import { requestEnv, backendFetch } from "../../../../runtime.js";
import { NextResponse } from "../../../../runtime.js";
import { createStorefrontPackageSnapshot, readStorefrontCache, readStorefrontPackageSnapshot } from "../../../../lib/storefront-cache.js";
import { STORE_ORIGINS, storefrontOriginCity, storefrontPublicFlight, storefrontStayForPackage, } from "../../../../lib/storefront-packages.js";
import { fetchPublishedOneWayFlightOptions, requestPackageQuote, } from "../../../../lib/web-package.js";
export const dynamic = "force-dynamic";
function isSaudi(code) {
    const value = code.trim().toUpperCase();
    return value === "JED" || value === "MED";
}
function sameFlight(leg, publicLeg) {
    return leg.airline_code.toUpperCase() === publicLeg.airlineCode.toUpperCase()
        && leg.flight_number.toUpperCase() === publicLeg.flightNumber.toUpperCase()
        && leg.origin.toUpperCase() === publicLeg.origin.toUpperCase()
        && leg.destination.toUpperCase() === publicLeg.destination.toUpperCase()
        && leg.departure_at.slice(0, 10) === publicLeg.departureAt.slice(0, 10);
}
async function allOneWayOptions(baseUrl) {
    const settled = await Promise.allSettled(Array.from(STORE_ORIGINS).map((origin) => fetchPublishedOneWayFlightOptions(origin, baseUrl)));
    const merged = new Map();
    for (const result of settled) {
        if (result.status !== "fulfilled")
            continue;
        for (const option of result.value)
            merged.set(option.id, option);
    }
    return [...merged.values()];
}
function gapDays(outbound, inbound) {
    const from = outbound.arrival_at || outbound.departure_at;
    const first = new Date(`${from.slice(0, 10)}T00:00:00Z`).getTime();
    const second = new Date(`${inbound.departure_at.slice(0, 10)}T00:00:00Z`).getTime();
    return Math.round((second - first) / 86_400_000);
}
function validGap(kind, gap) {
    return kind === "makkah-only" ? gap >= 2 && gap <= 3 : gap >= 4 && gap <= 15;
}
function allowedReturnDestination(destination, outboundOrigin) {
    const value = destination.toUpperCase();
    const preferred = outboundOrigin.toUpperCase();
    return value === preferred || (preferred !== "TAS" && value === "TAS");
}
function returnCompatible(kind, outbound, inbound, expectedReturnOrigin) {
    if (!isSaudi(outbound.destination) || !isSaudi(inbound.origin))
        return false;
    if (kind === "makkah-only" && (outbound.destination.toUpperCase() !== "JED" || inbound.origin.toUpperCase() !== "JED"))
        return false;
    if (inbound.origin.toUpperCase() !== expectedReturnOrigin.toUpperCase())
        return false;
    if (!allowedReturnDestination(inbound.destination, outbound.origin))
        return false;
    return validGap(kind, gapDays(outbound, inbound));
}
function bestReturn(options, kind, outbound, expectedReturnOrigin) {
    const origin = outbound.origin.toUpperCase();
    const candidates = options.filter((option) => returnCompatible(kind, outbound, option.outbound, expectedReturnOrigin));
    const hasExactDestination = candidates.some((option) => option.outbound.destination.toUpperCase() === origin);
    const preferredDestination = hasExactDestination ? origin : (origin === "TAS" ? origin : "TAS");
    const targetGap = kind === "makkah-only" ? 3 : 7;
    return candidates.sort((a, b) => {
        const aPreferred = a.outbound.destination.toUpperCase() === preferredDestination;
        const bPreferred = b.outbound.destination.toUpperCase() === preferredDestination;
        if (aPreferred !== bPreferred)
            return aPreferred ? -1 : 1;
        const aDistance = Math.abs(gapDays(outbound, a.outbound) - targetGap);
        const bDistance = Math.abs(gapDays(outbound, b.outbound) - targetGap);
        if (aDistance !== bDistance)
            return aDistance - bDistance;
        if (a.outbound.departure_at !== b.outbound.departure_at)
            return a.outbound.departure_at.localeCompare(b.outbound.departure_at);
        if (a.perTravelerFare !== b.perTravelerFare)
            return a.perTravelerFare - b.perTravelerFare;
        return a.id.localeCompare(b.id);
    })[0] ?? null;
}
export async function POST(request) {
    const body = await request.json().catch(() => null);
    const packageId = body?.packageId ?? "";
    const direction = body?.direction === "inbound" ? "inbound" : "outbound";
    const choiceId = body?.choiceId ?? "";
    const snapshot = await readStorefrontPackageSnapshot(packageId);
    if (snapshot?.isExpired) {
        return NextResponse.json({ ok: false, error: "PACKAGE_EXPIRED" }, { status: 410 });
    }
    const cache = snapshot ? null : await readStorefrontCache("flight-first");
    const current = snapshot?.item ?? cache?.items.find((item) => item.id === packageId);
    if (!current || !current.makkahHotelId) {
        return NextResponse.json({ ok: false, error: "PACKAGE_NOT_FOUND" }, { status: 404 });
    }
    try {
        const baseUrl = "https://iumrah-backend.helloiumrah.workers.dev";
        const options = await allOneWayOptions(baseUrl);
        const selected = options.find((option) => option.id === choiceId);
        if (!selected) {
            return NextResponse.json({ ok: false, error: "FLIGHT_OPTION_NOT_FOUND" }, { status: 404 });
        }
        const currentOutboundOption = options.find((option) => option.id === body?.outboundOfferId)
            ?? options.find((option) => option.id === current.outboundOfferId)
            ?? options.find((option) => sameFlight(option.outbound, current.outbound));
        const currentInboundOption = options.find((option) => option.id === body?.inboundOfferId)
            ?? options.find((option) => option.id === current.inboundOfferId)
            ?? options.find((option) => sameFlight(option.outbound, current.inbound));
        let outboundOption = currentOutboundOption ?? null;
        let inboundOption = currentInboundOption ?? null;
        const expectedReturnOrigin = current.inbound.origin.toUpperCase();
        if (direction === "outbound") {
            const leg = selected.outbound;
            if (isSaudi(leg.origin) || !isSaudi(leg.destination) || (current.kind === "makkah-only" && leg.destination.toUpperCase() !== "JED")) {
                return NextResponse.json({ ok: false, error: "FLIGHT_OPTION_INCOMPATIBLE" }, { status: 409 });
            }
            outboundOption = selected;
            if (!inboundOption || !returnCompatible(current.kind, leg, inboundOption.outbound, expectedReturnOrigin)) {
                inboundOption = bestReturn(options, current.kind, leg, expectedReturnOrigin);
            }
        }
        else {
            if (!outboundOption || !returnCompatible(current.kind, outboundOption.outbound, selected.outbound, expectedReturnOrigin)) {
                return NextResponse.json({ ok: false, error: "FLIGHT_OPTION_INCOMPATIBLE" }, { status: 409 });
            }
            inboundOption = selected;
        }
        if (!outboundOption || !inboundOption || !returnCompatible(current.kind, outboundOption.outbound, inboundOption.outbound, expectedReturnOrigin)) {
            return NextResponse.json({ ok: false, error: "NO_COMPATIBLE_RETURN" }, { status: 409 });
        }
        const outbound = outboundOption.outbound;
        const inbound = inboundOption.outbound;
        const startDate = outbound.departure_at.slice(0, 10);
        const endDate = inbound.departure_at.slice(0, 10);
        const stay = storefrontStayForPackage(current.kind, startDate, endDate);
        const providerItineraryId = `curated:${outboundOption.id}+${inboundOption.id}`;
        const config = current.configuration;
        const quote = await requestPackageQuote({
            tier: current.tier,
            travelers: config ? {
                adults: config.adults,
                children: config.children,
                infants: config.infants,
                rooms: config.rooms,
            } : { adults: 2, children: 0, infants: 0, rooms: 1 },
            journey: {
                id: providerItineraryId,
                providerItineraryId,
                outboundOfferId: outboundOption.id,
                inboundOfferId: inboundOption.id,
                outbound,
                inbound,
                currency: "USD",
                observedAt: new Date().toISOString(),
            },
            stay,
            meals: config ? {
                makkahLunch: config.makkahLunch,
                makkahDinner: config.makkahDinner,
                madinahDinner: config.madinahDinner,
            } : { makkahLunch: false, makkahDinner: false, madinahDinner: false },
            transferVehicle: config?.transferVehicle ?? null,
            haramainEnabled: config?.haramainEnabled ?? false,
            haramainFareClass: config?.haramainFareClass ?? "economy",
            haramainTicketCount: config?.haramainTicketCount ?? 0,
            makkahHotelId: current.makkahHotelId,
            makkahRoomId: config?.makkahRoomId ?? null,
            madinahHotelId: current.kind === "makkah-madinah" ? current.madinahHotelId : null,
            madinahRoomId: config?.madinahRoomId ?? null,
        }, baseUrl);
        const updated = {
            ...current,
            id: "",
            originCode: outbound.origin.toUpperCase(),
            originCity: storefrontOriginCity(outbound.origin),
            destinationCode: outbound.destination.toUpperCase(),
            startDate: stay.startDate,
            endDate: stay.endDate,
            totalDays: stay.totalDays,
            totalNights: stay.totalNights,
            outbound: storefrontPublicFlight(outbound),
            inbound: storefrontPublicFlight(inbound),
            providerItineraryId,
            outboundOfferId: outboundOption.id,
            inboundOfferId: inboundOption.id,
            routeSummary: `${outbound.origin} → ${outbound.destination} + ${inbound.origin} → ${inbound.destination} · ${stay.totalDays} d`,
            pricePerPerson: quote.pricePerPerson,
            totalPackagePrice: quote.totalPackagePrice,
            currency: quote.currency,
            isEstimated: quote.isEstimated,
        };
        const persisted = await createStorefrontPackageSnapshot(updated, { parentPackageId: current.id });
        if (!persisted) {
            return NextResponse.json({ ok: false, error: "PACKAGE_SNAPSHOT_UNAVAILABLE" }, { status: 503 });
        }
        return NextResponse.json({ ok: true, package: persisted.item, expiresAt: persisted.expiresAt }, { headers: { "Cache-Control": "no-store" } });
    }
    catch (error) {
        console.error("[storefront-requote] failed", error);
        return NextResponse.json({ ok: false, error: "PACKAGE_REQUOTE_UNAVAILABLE" }, { status: 503 });
    }
}
