// Ported from iumrah-web-main 5.zip: app/api/storefront/packages/snapshot/route.ts
import { requestEnv, backendFetch } from "../../../../../runtime.js";
import { NextResponse } from "../../../../../runtime.js";
import { createStorefrontPackageSnapshot, isPublicPackageId } from "../../../../../lib/storefront-cache.js";
import { storefrontStayForPackage } from "../../../../../lib/storefront-packages.js";
import { requestPackageQuote } from "../../../../../lib/web-package.js";
export const dynamic = "force-dynamic";
function validPackage(value) {
    if (!value || typeof value !== "object")
        return false;
    const item = value;
    return (item.entryMode === "flight-first" || item.entryMode === "hotel-first")
        && item.status === "ready"
        && typeof item.originCode === "string"
        && typeof item.outboundOfferId === "string"
        && typeof item.inboundOfferId === "string"
        && typeof item.providerItineraryId === "string"
        && typeof item.hotelName === "string"
        && typeof item.imageUrl === "string"
        && typeof item.makkahHotelId === "string"
        && item.makkahHotelId.length > 0
        && (item.kind !== "makkah-madinah" || (typeof item.madinahHotelId === "string" && item.madinahHotelId.length > 0))
        && Boolean(item.outbound?.origin)
        && Boolean(item.outbound?.destination)
        && Boolean(item.outbound?.departureAt)
        && Boolean(item.inbound?.origin)
        && Boolean(item.inbound?.destination)
        && Boolean(item.inbound?.departureAt);
}
function packageLeg(leg) {
    return {
        airline: leg.airline,
        airline_code: leg.airlineCode,
        flight_number: leg.flightNumber,
        origin: leg.origin,
        destination: leg.destination,
        departure_at: leg.departureAt,
        arrival_at: leg.arrivalAt,
        duration_minutes: leg.durationMinutes,
        stops: leg.stops,
        cabin_class: leg.cabinClass,
    };
}
export async function POST(request) {
    const body = await request.json().catch(() => null);
    if (!validPackage(body?.package)) {
        return NextResponse.json({ ok: false, error: "INVALID_PACKAGE_SNAPSHOT" }, { status: 400 });
    }
    const input = body.package;
    const makkahHotelId = input.makkahHotelId;
    if (!makkahHotelId) {
        return NextResponse.json({ ok: false, error: "INVALID_MAKKAH_HOTEL" }, { status: 400 });
    }
    const parentPackageId = typeof body?.parentPackageId === "string" && isPublicPackageId(body.parentPackageId)
        ? body.parentPackageId
        : null;
    const config = input.configuration ?? {
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
        makkahRoomId: null,
        madinahRoomId: null,
    };
    try {
        // Never trust a client-supplied total. The immutable snapshot is persisted only
        // after the same server Package Engine re-prices the exact selected package.
        const stay = storefrontStayForPackage(input.kind, input.startDate, input.endDate, {
            makkahNights: input.makkahNights,
            madinahNights: input.madinahNights,
            anchorCity: input.hotelFirstAnchorCity,
        });
        const quote = await requestPackageQuote({
            tier: input.tier,
            travelers: {
                adults: Math.max(1, config.adults),
                children: Math.max(0, config.children),
                infants: Math.max(0, config.infants),
                rooms: Math.max(1, config.rooms),
            },
            journey: {
                id: input.providerItineraryId,
                providerItineraryId: input.providerItineraryId,
                outboundOfferId: input.outboundOfferId,
                inboundOfferId: input.inboundOfferId,
                outbound: packageLeg(input.outbound),
                inbound: packageLeg(input.inbound),
                currency: "USD",
                observedAt: new Date().toISOString(),
            },
            stay,
            meals: {
                makkahLunch: config.makkahLunch,
                makkahDinner: config.makkahDinner,
                madinahDinner: config.madinahDinner,
            },
            transferVehicle: config.transferVehicle,
            haramainEnabled: config.haramainEnabled,
            haramainFareClass: config.haramainFareClass,
            haramainTicketCount: Math.max(0, config.haramainTicketCount),
            makkahHotelId,
            makkahRoomId: config.makkahRoomId,
            madinahHotelId: input.kind === "makkah-madinah" ? input.madinahHotelId : null,
            madinahRoomId: input.kind === "makkah-madinah" ? config.madinahRoomId : null,
        }, "https://iumrah-backend.helloiumrah.workers.dev");
        const verified = {
            ...input,
            id: "",
            startDate: stay.startDate,
            endDate: stay.endDate,
            totalDays: stay.totalDays,
            totalNights: stay.totalNights,
            makkahNights: stay.makkahNights,
            madinahNights: stay.madinahNights,
            pricePerPerson: quote.pricePerPerson,
            totalPackagePrice: quote.totalPackagePrice,
            currency: quote.currency,
            isEstimated: quote.isEstimated,
            configuration: config,
        };
        const snapshot = await createStorefrontPackageSnapshot(verified, { parentPackageId });
        if (!snapshot) {
            return NextResponse.json({ ok: false, error: "PACKAGE_SNAPSHOT_UNAVAILABLE" }, { status: 503 });
        }
        return NextResponse.json({
            ok: true,
            package: snapshot.item,
            generatedAt: snapshot.generatedAt,
            expiresAt: snapshot.expiresAt,
            parentPackageId: snapshot.parentPackageId,
        }, { status: 201, headers: { "Cache-Control": "no-store" } });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "PACKAGE_REPRICE_FAILED";
        return NextResponse.json({ ok: false, error: message }, { status: 409, headers: { "Cache-Control": "no-store" } });
    }
}
