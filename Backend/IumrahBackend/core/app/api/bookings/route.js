// Ported from iumrah-web-main 5.zip: app/api/bookings/route.ts
import { requestEnv, backendFetch } from "../../../runtime.js";
import { NextResponse } from "../../../runtime.js";
import { isTripInput, } from "../../../lib/domain.js";
import { cents, ensureBookingSchema, getBookingDb, getPassportBucket, hashBookingToken, makeBookingId, makeBookingToken, normalizeLanguage, } from "../../../lib/booking-store.js";
import { consentStatements, deliverTelegramNotice, ensureTelegramBookingSchema, findValidConsent, queueTelegramNotice } from "../../../lib/telegram-booking.js";
export const dynamic = "force-dynamic";
const plans = new Set(["economy", "standard", "comfort", "luxury"]);
const services = new Set(["flight", "makkahHotel", "madinahHotel", "visa", "meals", "transfer", "accompaniment", "ziyaratMakkah", "ziyaratMadinah", "care", "haramainTrain", "esim"]);
const FILE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const MAX_FILE_BYTES = 6 * 1024 * 1024;
function record(value) { return typeof value === "object" && value !== null; }
function string(value, max = 180) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
function finite(value) { return typeof value === "number" && Number.isFinite(value) ? value : NaN; }
function optionalString(value, max = 220) { return typeof value === "string" ? value.trim().slice(0, max) : null; }
function currency(value) { return value === "SAR" ? "SAR" : "USD"; }
function dateOnly(value) { const result = string(value, 10); return /^\d{4}-\d{2}-\d{2}$/.test(result) ? result : ""; }
function evidence(value) {
    if (!Array.isArray(value))
        return [];
    return value.slice(0, 8).flatMap((item) => {
        if (!record(item))
            return [];
        const url = string(item.url, 700);
        if (!/^https?:\/\//i.test(url))
            return [];
        return [{ url, title: string(item.title, 240) || url, observedAt: string(item.observedAt, 80), faviconUrl: optionalString(item.faviconUrl, 700), imageUrl: optionalString(item.imageUrl, 700) }];
    });
}
function flightDetails(value) {
    if (!record(value))
        return null;
    const id = string(value.id, 180);
    const airline = string(value.airline, 180);
    if (!id || !airline)
        return null;
    return {
        id, airline,
        outboundOrigin: string(value.outboundOrigin, 8), outboundDestination: string(value.outboundDestination, 8), outboundDate: string(value.outboundDate, 10),
        outboundPrice: Math.max(0, finite(value.outboundPrice) || 0), outboundCurrency: currency(value.outboundCurrency),
        returnOrigin: string(value.returnOrigin, 8), returnDestination: string(value.returnDestination, 8), returnDate: string(value.returnDate, 10),
        returnPrice: Math.max(0, finite(value.returnPrice) || 0), returnCurrency: currency(value.returnCurrency),
        outboundStops: Math.max(0, Math.min(8, Math.round(finite(value.outboundStops) || 0))), returnStops: Math.max(0, Math.min(8, Math.round(finite(value.returnStops) || 0))),
        outboundDepartureTime: optionalString(value.outboundDepartureTime, 40), outboundArrivalTime: optionalString(value.outboundArrivalTime, 40),
        returnDepartureTime: optionalString(value.returnDepartureTime, 40), returnArrivalTime: optionalString(value.returnArrivalTime, 40),
        outboundDuration: optionalString(value.outboundDuration, 80), returnDuration: optionalString(value.returnDuration, 80), logoUrl: optionalString(value.logoUrl, 700), evidence: evidence(value.evidence),
    };
}
function hotelDetails(value) {
    if (!record(value))
        return null;
    const id = string(value.id, 180);
    const name = string(value.name, 220);
    const rawStars = Math.round(finite(value.stars) || 3);
    if (!id || !name)
        return null;
    const stars = Math.max(1, Math.min(5, rawStars));
    const rawRating = finite(value.rating);
    const rawDistance = finite(value.distanceMeters);
    return {
        id, city: value.city === "madinah" ? "madinah" : "makkah", name, stars,
        rating: Number.isFinite(rawRating) ? rawRating : null, distanceMeters: Number.isFinite(rawDistance) ? Math.max(0, rawDistance) : null,
        checkIn: string(value.checkIn, 10), checkOut: string(value.checkOut, 10), totalPrice: Math.max(0, finite(value.totalPrice) || 0), currency: currency(value.currency),
        imageUrl: optionalString(value.imageUrl, 700), evidence: evidence(value.evidence),
    };
}
function selectionDetails(value) {
    if (!record(value))
        return undefined;
    const mode = value.pricingMode;
    const pricingMode = mode === "live" || mode === "search" || mode === "mixed" ? mode : "estimate";
    return { generatedAt: string(value.generatedAt, 80) || undefined, pricingMode, pricingNote: string(value.pricingNote, 500) || undefined, flight: flightDetails(value.flight), makkahHotel: hotelDetails(value.makkahHotel), madinahHotel: hotelDetails(value.madinahHotel) };
}
function customization(value) {
    if (!record(value))
        return null;
    return { accompaniment: Boolean(value.accompaniment), guideMeetingPoint: value.guideMeetingPoint === "airport" ? "airport" : "hotel", ziyaratMakkah: Boolean(value.ziyaratMakkah), ziyaratMadinah: Boolean(value.ziyaratMadinah), meals: Boolean(value.meals), esim: Boolean(value.esim) };
}
function generatorTrace(value) {
    if (!record(value))
        return undefined;
    try {
        const json = JSON.stringify(value);
        if (json.length > 32_000)
            return undefined;
        return JSON.parse(json);
    }
    catch {
        return undefined;
    }
}
function pilgrimProfile(value) {
    if (!record(value))
        return undefined;
    const firstName = string(value.firstName, 120);
    const lastName = string(value.lastName, 120);
    const phone = string(value.phone, 60);
    const telegram = string(value.telegram, 120);
    const whatsapp = string(value.whatsapp, 100);
    if (!firstName && !lastName && !phone && !telegram && !whatsapp)
        return undefined;
    return { firstName, lastName, phone, telegram, whatsapp };
}
function selection(value) {
    if (!record(value))
        return undefined;
    const flightId = string(value.flightId, 160);
    const makkahHotelId = string(value.makkahHotelId, 160);
    const madinahHotelId = value.madinahHotelId === null ? null : string(value.madinahHotelId, 160);
    if (!flightId || !makkahHotelId)
        return undefined;
    return { flightId, makkahHotelId, madinahHotelId };
}
function sixMonthsAfter(iso) {
    const date = new Date(`${iso}T00:00:00Z`);
    if (Number.isNaN(date.getTime()))
        return "";
    date.setUTCMonth(date.getUTCMonth() + 6);
    return date.toISOString().slice(0, 10);
}
function travelerDetails(value, input) {
    if (value === undefined)
        return undefined;
    if (!record(value) || !record(value.contact) || !Array.isArray(value.travelers))
        return null;
    const expected = input.travelers.adults + input.travelers.children + input.travelers.infants;
    if (value.travelers.length !== expected || expected < 1 || expected > 16)
        return null;
    const contact = value.contact;
    const email = string(contact.email, 180);
    const phone = string(contact.phone, 60);
    const emergencyName = string(contact.emergencyName, 180);
    const emergencyPhone = string(contact.emergencyPhone, 60);
    if (!/^\S+@\S+\.\S+$/.test(email) || !phone || !emergencyName || !emergencyPhone)
        return null;
    const minExpiry = sixMonthsAfter(input.startDate);
    const parsed = value.travelers.map((item, index) => {
        if (!record(item))
            return null;
        const kind = item.kind === "child" ? "child" : item.kind === "infant" ? "infant" : item.kind === "adult" ? "adult" : null;
        const gender = item.gender === "female" ? "female" : item.gender === "male" ? "male" : null;
        const firstName = string(item.firstName, 100), lastName = string(item.lastName, 100), passportNumber = string(item.passportNumber, 60).toUpperCase().replace(/\s+/g, "");
        const birthDate = dateOnly(item.birthDate), passportIssueDate = dateOnly(item.passportIssueDate), passportExpiryDate = dateOnly(item.passportExpiryDate);
        const placeOfBirth = string(item.placeOfBirth, 160), nationality = string(item.nationality, 100), countryOfResidence = string(item.countryOfResidence, 100), passportIssuingCountry = string(item.passportIssuingCountry, 100);
        if (!kind || !gender || !firstName || !lastName || !birthDate || !placeOfBirth || !nationality || !countryOfResidence || !passportNumber || !passportIssueDate || !passportExpiryDate || !passportIssuingCountry)
            return null;
        if (minExpiry && passportExpiryDate < minExpiry)
            return null;
        return { index, kind, firstName, middleName: string(item.middleName, 100), lastName, gender, birthDate, placeOfBirth, nationality, countryOfResidence, passportNumber, passportIssueDate, passportExpiryDate, passportIssuingCountry };
    });
    if (parsed.some((item) => !item))
        return null;
    return {
        contact: { email, phone, whatsapp: string(contact.whatsapp, 60), emergencyName, emergencyPhone, emergencyRelation: string(contact.emergencyRelation, 100), notes: string(contact.notes, 1200) },
        travelers: parsed,
        consentAt: string(value.consentAt, 80) || new Date().toISOString(),
    };
}
function parsePayload(value) {
    if (!record(value) || !isTripInput(value.input) || !record(value.route) || !record(value.stay))
        return null;
    const planId = value.planId;
    if (typeof planId !== "string" || !plans.has(planId))
        return null;
    const totalUsd = finite(value.totalUsd), perPilgrimUsd = finite(value.perPilgrimUsd);
    if (!Number.isFinite(totalUsd) || !Number.isFinite(perPilgrimUsd) || totalUsd <= 0 || perPilgrimUsd <= 0 || totalUsd > 250000 || perPilgrimUsd > 100000)
        return null;
    const route = value.route;
    const originCode = string(route.originCode, 3).toUpperCase();
    const outboundDestination = route.outboundDestination;
    const returnOrigin = route.returnOrigin;
    if (!/^[A-Z]{3}$/.test(originCode) || (outboundDestination !== "JED" && outboundDestination !== "MED") || (returnOrigin !== "JED" && returnOrigin !== "MED"))
        return null;
    const stay = value.stay;
    const rawCustomization = customization(value.customization);
    if (!rawCustomization)
        return null;
    const rawTravelerDetails = travelerDetails(value.travelerDetails, value.input);
    if (rawTravelerDetails === null)
        return null;
    const rawHotels = record(value.hotelNames) ? value.hotelNames : {};
    const includedServices = Array.isArray(value.includedServices) ? value.includedServices.filter((item) => typeof item === "string" && services.has(item)).slice(0, 20) : [];
    return {
        planId: planId, totalUsd, perPilgrimUsd, input: value.input,
        route: { originCode, outboundDestination, returnOrigin },
        stay: { totalDays: Math.max(0, finite(stay.totalDays) || 0), totalNights: Math.max(0, finite(stay.totalNights) || 0), makkahCheckIn: string(stay.makkahCheckIn, 10) || value.input.startDate, makkahCheckOut: string(stay.makkahCheckOut, 10) || value.input.endDate, makkahNights: Math.max(0, finite(stay.makkahNights) || 0), madinahCheckIn: typeof stay.madinahCheckIn === "string" ? stay.madinahCheckIn.slice(0, 10) : null, madinahCheckOut: typeof stay.madinahCheckOut === "string" ? stay.madinahCheckOut.slice(0, 10) : null, madinahNights: Math.max(0, finite(stay.madinahNights) || 0) },
        selection: selection(value.selection), customization: rawCustomization, includedServices,
        hotelNames: { makkah: string(rawHotels.makkah, 200), madinah: string(rawHotels.madinah, 200) }, flight: string(value.flight, 200),
        travelerDetails: rawTravelerDetails,
        generatorTrace: generatorTrace(value.generatorTrace),
        pilgrimProfile: pilgrimProfile(value.pilgrimProfile),
        selectionDetails: selectionDetails(value.selectionDetails),
    };
}
function extension(contentType) { return contentType === "application/pdf" ? "pdf" : contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg"; }
function safeFileName(value) { return value.replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 160) || "passport"; }
export async function POST(request) {
    const contentType = request.headers.get("content-type") ?? "";
    const multipart = contentType.toLowerCase().includes("multipart/form-data");
    const length = Number(request.headers.get("content-length") ?? 0);
    if ((!multipart && length > 160_000) || (multipart && length > 70_000_000))
        return NextResponse.json({ error: "PAYLOAD_TOO_LARGE" }, { status: 413 });
    let rawBooking;
    let rawLang;
    let rawConsent;
    let rawQuoteProof;
    let form = null;
    try {
        if (multipart) {
            form = await request.formData();
            rawLang = form.get("lang");
            rawConsent = form.get("telegramConsentTicket");
            rawQuoteProof = form.get("quoteProof");
            const raw = form.get("booking");
            if (typeof raw !== "string")
                throw new Error("INVALID_BOOKING");
            rawBooking = JSON.parse(raw);
        }
        else {
            const body = await request.json();
            rawBooking = record(body) ? body.booking : undefined;
            rawLang = record(body) ? body.lang : undefined;
            rawConsent = record(body) ? body.telegramConsentTicket : undefined;
            rawQuoteProof = record(body) ? body.quoteProof : undefined;
        }
    }
    catch {
        return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
    }
    const input = parsePayload(rawBooking);
    if (!input)
        return NextResponse.json({ error: "INVALID_BOOKING" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    // Authenticate the server quote BEFORE any D1 or R2 writes. Never accept a
    // price or commercial configuration merely because the client supplied it.
    const verifyQuote = requestEnv().IUMRAH_VERIFY_BOOKING_QUOTE;
    if (typeof verifyQuote !== "function") return NextResponse.json({error:"QUOTE_VALIDATION_UNAVAILABLE"},{status:503,headers:{"Cache-Control":"no-store"}});
    let verified;
    try { verified = await verifyQuote(input, rawQuoteProof ?? rawBooking?.quoteProof); }
    catch (error) {
        const code = error?.message;
        const allowed = typeof code === "string" && /^(BOOKING_QUOTE_[A-Z_]+|QUOTE_PROOF_REQUIRED|QUOTE_EXPIRED|INVALID_QUOTE_PROOF|SANDBOX_QUOTE_NOT_BOOKABLE|QUOTE_SEAL_NOT_CONFIGURED|INVALID_PACKAGE_QUOTE_SEAL_KEY)$/.test(code);
        return NextResponse.json({error:allowed ? code : "QUOTE_VALIDATION_UNAVAILABLE"},{status:!allowed || code.includes("CONFIGURED") || code.includes("SEAL_KEY") ? 503 : 409,headers:{"Cache-Control":"no-store"}});
    }
    // Persist canonical public totals, never the decrypted cost report or proof.
    input.totalUsd = verified.totalUsd;
    input.perPilgrimUsd = verified.perPilgrimUsd;
    const db = getBookingDb();
    if (!db)
        return NextResponse.json({ error: "BOOKING_DB_NOT_CONFIGURED" }, { status: 503, headers: { "Cache-Control": "no-store" } });
    const travelerCount = input.input.travelers.adults + input.input.travelers.children + input.input.travelers.infants;
    const passportFiles = [];
    if (multipart) {
        if (!input.travelerDetails)
            return NextResponse.json({ error: "TRAVELER_DETAILS_REQUIRED" }, { status: 400 });
        for (let index = 0; index < travelerCount; index += 1) {
            const item = form?.get(`passport_${index}`);
            if (!(item instanceof File) || !FILE_TYPES.has(item.type) || item.size <= 0 || item.size > MAX_FILE_BYTES)
                return NextResponse.json({ error: "PASSPORT_FILE_REQUIRED", travelerIndex: index }, { status: 400 });
            passportFiles.push(item);
        }
    }
    const bucket = multipart ? getPassportBucket() : null;
    if (multipart && !bucket)
        return NextResponse.json({ error: "DOCUMENT_STORAGE_NOT_CONFIGURED" }, { status: 503 });
    const uploadedKeys = [];
    try {
        await ensureBookingSchema(db);
        const consentTicket = typeof rawConsent === "string" ? rawConsent : "";
        let verifiedConsent = null;
        if (consentTicket) {
            try {
                await ensureTelegramBookingSchema(db);
                verifiedConsent = await findValidConsent(db, consentTicket);
            }
            catch (consentError) {
                // An optional Telegram setup issue must never prevent checkout.
                console.error("booking-telegram-consent-unavailable", consentError);
            }
        }
        const now = new Date().toISOString();
        const id = makeBookingId(input.input.startDate.slice(0, 4));
        const accessToken = makeBookingToken();
        const accessTokenHash = await hashBookingToken(accessToken);
        const lang = normalizeLanguage(rawLang);
        const status = "AVAILABILITY_CHECK";
        const booking = { ...input, id, status, createdAt: now, updatedAt: now };
        const documentRows = [];
        if (bucket) {
            for (let index = 0; index < passportFiles.length; index += 1) {
                const file = passportFiles[index];
                const key = `${id}/traveler-${index + 1}/passport-${crypto.randomUUID()}.${extension(file.type)}`;
                await bucket.put(key, file.stream(), { httpMetadata: { contentType: file.type }, customMetadata: { bookingId: id, travelerIndex: String(index), kind: "passport" } });
                uploadedKeys.push(key);
                documentRows.push({ travelerIndex: index, key, fileName: safeFileName(file.name), contentType: file.type, size: file.size });
            }
        }
        const statements = [
            db.prepare(`INSERT INTO bookings (id, access_token_hash, status, created_at, updated_at, lang, plan_id, total_cents, per_pilgrim_cents, traveler_count, rooms, origin_code, outbound_destination, return_origin, start_date, end_date, flight_name, makkah_hotel, madinah_hotel, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .bind(id, accessTokenHash, status, now, now, lang, input.planId, cents(input.totalUsd), cents(input.perPilgrimUsd), travelerCount, input.input.travelers.rooms, input.route.originCode, input.route.outboundDestination, input.route.returnOrigin, input.input.startDate, input.input.endDate, input.flight, input.hotelNames.makkah, input.hotelNames.madinah, JSON.stringify(booking)),
            db.prepare("INSERT INTO booking_events (booking_id, status, actor_type, actor_id, note, created_at) VALUES (?, ?, 'system', 'booking-api', ?, ?)").bind(id, status, input.travelerDetails ? "Traveller and passport details submitted; availability confirmation started." : "Booking submitted; availability confirmation started.", now),
            ...documentRows.map((doc) => db.prepare("INSERT INTO booking_documents (booking_id, traveler_index, kind, r2_key, file_name, content_type, size_bytes, created_at) VALUES (?, ?, 'passport', ?, ?, ?, ?, ?)").bind(id, doc.travelerIndex, doc.key, doc.fileName, doc.contentType, doc.size, now)),
            ...(verifiedConsent ? consentStatements(db, id, verifiedConsent.ticketHash, now) : []),
        ];
        await db.batch(statements);
        // Delivery failures must never roll back a successfully committed booking.
        let telegramNotification = "not_requested";
        if (verifiedConsent) {
            telegramNotification = "pending";
            try {
                await queueTelegramNotice(db, id, status);
                if (await deliverTelegramNotice(db, id, status))
                    telegramNotification = "sent";
            }
            catch (noticeError) {
                console.error("telegram-booking-initial-notice-failed", noticeError);
            }
        }
        return NextResponse.json({ booking, accessToken, telegramNotification, telegramConsentExpired: Boolean(consentTicket && !verifiedConsent) }, { status: 201, headers: { "Cache-Control": "no-store" } });
    }
    catch (error) {
        if (bucket)
            await Promise.allSettled(uploadedKeys.map((key) => bucket.delete(key)));
        console.error("booking-create-failed", error);
        return NextResponse.json({ error: "BOOKING_CREATE_FAILED" }, { status: 500, headers: { "Cache-Control": "no-store" } });
    }
}
