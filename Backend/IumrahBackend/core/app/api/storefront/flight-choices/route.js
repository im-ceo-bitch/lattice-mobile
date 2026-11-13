// Ported from iumrah-web-main 5.zip: app/api/storefront/flight-choices/route.ts
import { requestEnv, backendFetch } from "../../../../runtime.js";
import { NextResponse } from "../../../../runtime.js";
import { readStorefrontPackageSnapshot } from "../../../../lib/storefront-cache.js";
import { STORE_ORIGINS } from "../../../../lib/storefront-packages.js";
import { fetchPublishedOneWayFlightOptions } from "../../../../lib/web-package.js";
export const dynamic = "force-dynamic";
function isSaudi(code) {
    const value = code.trim().toUpperCase();
    return value === "JED" || value === "MED";
}
function sameDay(value, other) {
    return value.slice(0, 10) === other.slice(0, 10);
}
function legMatches(left, right) {
    return left.airline_code.toUpperCase() === right.airlineCode.toUpperCase()
        && left.flight_number.toUpperCase() === right.flightNumber.toUpperCase()
        && left.origin.toUpperCase() === right.origin.toUpperCase()
        && left.destination.toUpperCase() === right.destination.toUpperCase()
        && sameDay(left.departure_at, right.departureAt);
}
function dateGap(from, to) {
    const first = new Date(`${from.slice(0, 10)}T00:00:00Z`).getTime();
    const second = new Date(`${to.slice(0, 10)}T00:00:00Z`).getTime();
    return Math.round((second - first) / 86_400_000);
}
function notDeparted(value) {
    const today = new Date();
    const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    const departure = Date.parse(`${value.slice(0, 10)}T00:00:00Z`);
    return Number.isFinite(departure) && departure >= start;
}
async function allOneWayOptions(baseUrl) {
    const settled = await Promise.allSettled(Array.from(STORE_ORIGINS).map((origin) => fetchPublishedOneWayFlightOptions(origin, baseUrl)));
    const merged = new Map();
    for (const result of settled) {
        if (result.status !== "fulfilled")
            continue;
        for (const option of result.value) {
            if (!notDeparted(option.outbound.departure_at))
                continue;
            merged.set(option.id, option);
        }
    }
    return [...merged.values()];
}
export async function GET(request) {
    const packageId = request.nextUrl.searchParams.get("packageId") ?? "";
    const direction = request.nextUrl.searchParams.get("direction") === "inbound" ? "inbound" : "outbound";
    const currentOutboundOfferId = request.nextUrl.searchParams.get("outboundOfferId") ?? "";
    const currentInboundOfferId = request.nextUrl.searchParams.get("inboundOfferId") ?? "";
    const snapshot = await readStorefrontPackageSnapshot(packageId);
    const current = snapshot?.isExpired ? null : snapshot?.item;
    if (!current) {
        return NextResponse.json({ ok: false, error: snapshot?.isExpired ? "PACKAGE_EXPIRED" : "PACKAGE_NOT_FOUND", choices: [] }, { status: snapshot?.isExpired ? 410 : 404 });
    }
    try {
        const baseUrl = "https://iumrah-backend.helloiumrah.workers.dev";
        const options = await allOneWayOptions(baseUrl);
        const effectiveOutbound = options.find((option) => option.id === currentOutboundOfferId);
        const effectiveInbound = options.find((option) => option.id === currentInboundOfferId);
        const origin = (effectiveOutbound?.outbound.origin ?? current.originCode).toUpperCase();
        const expectedSaudi = direction === "outbound"
            ? (effectiveOutbound?.outbound.destination ?? current.outbound.destination).toUpperCase()
            : (effectiveInbound?.outbound.origin ?? current.inbound.origin).toUpperCase();
        const outboundArrival = effectiveOutbound?.outbound.arrival_at ?? current.outbound.arrivalAt ?? current.outbound.departureAt;
        const directional = options.filter((option) => {
            const leg = option.outbound;
            if (direction === "outbound") {
                if (isSaudi(leg.origin) || !isSaudi(leg.destination))
                    return false;
                // A short Makkah-only package is JED/JED by contract. Two-city packages
                // can expose every current Saudi arrival exactly like the iOS picker.
                return current.kind !== "makkah-only" || leg.destination.toUpperCase() === "JED";
            }
            const destination = leg.destination.toUpperCase();
            const gap = dateGap(outboundArrival, leg.departure_at);
            return leg.origin.toUpperCase() === expectedSaudi
                && isSaudi(leg.origin)
                && !isSaudi(destination)
                && (destination === origin || (origin !== "TAS" && destination === "TAS"))
                && gap >= 2
                && gap <= 15;
        });
        const hasExactInbound = direction === "inbound" && directional.some((option) => (option.outbound.origin.toUpperCase() === expectedSaudi
            && option.outbound.destination.toUpperCase() === origin));
        const preferredReturnDestination = hasExactInbound ? origin : (origin === "TAS" ? origin : "TAS");
        const choices = directional
            .map((option) => {
            const leg = option.outbound;
            const isPrimary = direction === "outbound"
                ? leg.origin.toUpperCase() === origin && leg.destination.toUpperCase() === expectedSaudi
                : leg.origin.toUpperCase() === expectedSaudi && leg.destination.toUpperCase() === preferredReturnDestination;
            const selectedId = direction === "outbound" ? currentOutboundOfferId : currentInboundOfferId;
            const selectedLeg = direction === "outbound" ? current.outbound : current.inbound;
            return {
                id: option.id,
                leg,
                observedAt: option.observedAt,
                isPrimary,
                isSelected: selectedId ? option.id === selectedId : legMatches(leg, selectedLeg),
            };
        })
            .sort((a, b) => {
            if (a.isPrimary !== b.isPrimary)
                return a.isPrimary ? -1 : 1;
            if (a.leg.origin !== b.leg.origin)
                return a.leg.origin.localeCompare(b.leg.origin);
            if (a.leg.departure_at !== b.leg.departure_at)
                return a.leg.departure_at.localeCompare(b.leg.departure_at);
            return a.id.localeCompare(b.id);
        });
        return NextResponse.json({
            ok: true,
            direction,
            currentOrigin: origin,
            expectedSaudi,
            originOptions: Array.from(new Set(choices.map((choice) => choice.leg.origin.toUpperCase()).filter((code) => !isSaudi(code)))).sort(),
            choices,
        }, { headers: { "Cache-Control": "no-store" } });
    }
    catch (error) {
        console.error("[storefront-flight-choices] failed", error);
        return NextResponse.json({ ok: false, error: "FLIGHT_CHOICES_UNAVAILABLE", choices: [] }, { status: 503 });
    }
}
