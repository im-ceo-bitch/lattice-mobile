// Ported from iumrah-web-main 5.zip: app/api/account/dashboard/route.ts
import { requestEnv, backendFetch } from "../../../../runtime.js";
import { NextResponse } from "../../../../runtime.js";
import { accountAuthedUpstream, formatIumrahID, jsonPayload, normalizedAccount } from "../../../../lib/iumrah-account.js";
export const dynamic = "force-dynamic";
function object(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function string(value) {
    return typeof value === "string" ? value : "";
}
function tripDetailSummary(value) {
    const root = object(value);
    const trip = object(root.trip);
    const booking = object(root.booking);
    const input = object(booking.input);
    const route = object(booking.route);
    const hotelNames = object(booking.hotelNames);
    const selection = object(booking.selectionDetails);
    const flight = object(selection.flight);
    const makkahHotel = object(selection.makkahHotel);
    const madinahHotel = object(selection.madinahHotel);
    return {
        bookingID: string(trip.bookingID) || string(booking.id),
        bookingDisplayNumber: string(trip.bookingDisplayNumber),
        status: string(trip.status) || string(booking.status),
        pilgrimID: formatIumrahID(trip.pilgrimID),
        startDate: string(trip.startDate) || string(input.startDate),
        endDate: string(trip.endDate) || string(input.endDate),
        route: {
            origin: string(flight.outboundOrigin) || string(route.originCode) || string(input.originCode),
            destination: string(flight.outboundDestination) || string(route.outboundDestination),
            returnOrigin: string(flight.returnOrigin) || string(route.returnOrigin),
            returnDestination: string(flight.returnDestination),
        },
        flight: {
            airline: string(flight.airline),
            outboundAt: string(flight.outboundDepartureAt) || string(flight.outboundAt),
            inboundAt: string(flight.returnDepartureAt) || string(flight.inboundAt),
            summary: string(booking.flight),
        },
        hotels: {
            makkah: string(hotelNames.makkah) || string(makkahHotel.name),
            madinah: string(hotelNames.madinah) || string(madinahHotel.name),
        },
    };
}
export async function GET(request) {
    const [sessionResponse, tripsResponse] = await Promise.all([
        accountAuthedUpstream(request, "/api/catalog/hotels/client/account/session"),
        accountAuthedUpstream(request, "/api/catalog/hotels/client/trips"),
    ]);
    if (!sessionResponse || !tripsResponse)
        return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    if (!sessionResponse.ok || !tripsResponse.ok) {
        const failed = !sessionResponse.ok ? sessionResponse : tripsResponse;
        const payload = await jsonPayload(failed);
        return NextResponse.json(payload, { status: failed.status, headers: { "Cache-Control": "no-store" } });
    }
    const sessionPayload = await jsonPayload(sessionResponse);
    const tripsPayload = await jsonPayload(tripsResponse);
    const account = normalizedAccount(sessionPayload.account);
    if (!account)
        return NextResponse.json({ error: "INVALID_ACCOUNT_RESPONSE" }, { status: 502, headers: { "Cache-Control": "no-store" } });
    const trips = Array.isArray(tripsPayload.trips) ? tripsPayload.trips.slice(0, 20) : [];
    const details = await Promise.all(trips.map(async (item) => {
        const trip = object(item);
        const bookingID = string(trip.bookingID);
        if (!bookingID)
            return tripDetailSummary({ trip });
        const response = await accountAuthedUpstream(request, `/api/catalog/hotels/client/trips/${encodeURIComponent(bookingID)}`);
        if (!response?.ok)
            return tripDetailSummary({ trip });
        return tripDetailSummary(await jsonPayload(response));
    }));
    let publicCard = null;
    const publicCardResponse = await accountAuthedUpstream(request, "/api/package/client/account/public-card");
    if (publicCardResponse?.ok)
        publicCard = await jsonPayload(publicCardResponse);
    return NextResponse.json({ ok: true, account, trips: details, publicCard }, { headers: { "Cache-Control": "no-store" } });
}
