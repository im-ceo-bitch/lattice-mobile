import { handleGuestBookingEmail } from "./booking-email-verification";
import { flushBookingStatusEmails } from "./booking-email";
import { bookingLogoResponse } from "./booking-email-logo";
import { requirePackageAdmin } from "./admin-auth";
import { handleGuestBookingPhone } from "./booking-contact-verification";
import { applyPilgrimFriendCredit, deleteAdminBooking, deletePilgrimBooking, getPilgrimFriendsSummary, redeemPilgrimFriendGift, updatePilgrimContact, updatePilgrimCustomization, updatePilgrimHotel } from "./booking-control";
import { listHotelRoomCategories } from "./room-categories";
import type { Env } from "./env";
import { curatedPrimaryHotel } from "./generator-components";
import { searchIgnavFlights, searchIgnavFlightsForCuration } from "./ignav-flights";
import { publicAviasalesData } from "./aviasales-data";
import { hotelPricingSources } from "./hotel-pricing-sources";
import { handleClientAccountSecurity } from "./client-account-security";
import { handlePublicIdentityRequest } from "./public-identity";
import { cleanupExpiredFlightCache, flightCalendarResponse } from "./flight-cache";
import { deleteCuratedFlightAdmin, listCuratedFlightsAdmin, publicCuratedFlightRecommendations, resolvePublicCuratedFlightRecommendation, saveCuratedFlightAdmin } from "./curated-flights";
import { appleAppSiteAssociation, hotelWebFallback, publicStorefrontFlightBoard } from "./storefront";
import { generatePackageQuote, generateStorefrontPackageQuote } from "./package-search";
import { commitPackageQuoteReport } from "./booking-gateway";
import { quoteSealingMode } from "./quote-audit";
import { createCarePackageRequest, listCarePackageRequests, updateCarePackageRequest } from "./care-requests";
import { createTelegramBookingLink, getTelegramBookingStatus } from "./telegram-bridge";
import { getBookingItineraryPlan } from "./itinerary-planner";
import { handleNuiteeHotelRequest, refreshNuiteeHotelCatalog } from "./nuitee-hotels";

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

// Read-only production smoke check. No room seeding, schema changes, or
// booking writes on a public GET. Empty inventories are not network failures.
async function publicHealth(env: Env) {
  const common = {
    service: "iumrah-package-engine",
    hotelsDbConfigured: Boolean(env.HOTELS_DB),
    bookingsDbConfigured: Boolean(env.BOOKINGS_DB),
    flightProvider: "ignav",
    flightProviderConfigured: Boolean(env.IGNAV_API_KEY),
    flightDiscoveryProvider: "aviasales-data",
    flightDiscoveryConfigured: Boolean(env.TRAVELPAYOUTS_API_TOKEN),
    smsProvider: "devsms",
    smsProviderConfigured: Boolean(env.DEVSMS_API_TOKEN),
    emailProviderConfigured: Boolean(env.RESEND_API_KEY),
    quoteSealingMode: quoteSealingMode(env),
    telegramBotConfigured: Boolean(env.TELEGRAM_BOT_ORIGIN),
  };
  if (!env.HOTELS_DB || !env.BOOKINGS_DB) return json({ ...common, ok: false, error: "PACKAGE_DATABASE_BINDING_MISSING" }, 503);
  try {
    const hotels = env.HOTELS_DB;
    // Prepare/execute actual reads of the base tables, including the account
    // credentials/session schema. No user rows are returned to the caller.
    await hotels.prepare("SELECT id, status FROM hotels LIMIT 0").all();
    await hotels.prepare("SELECT id, email, phone FROM pilgrims LIMIT 0").all();
    await hotels.prepare("SELECT pilgrim_id, password_hash, password_iterations FROM iumrah_accounts LIMIT 0").all();
    await hotels.prepare("SELECT token_hash, pilgrim_id, expires_at, revoked_at FROM iumrah_account_sessions LIMIT 0").all();
    await hotels.prepare("SELECT pilgrim_id, booking_id FROM pilgrim_trips LIMIT 0").all();
    await env.BOOKINGS_DB.prepare("SELECT id, access_token_hash, payload_json FROM bookings LIMIT 0").all();
    const result = await hotels.prepare(
      `SELECT LOWER(p.city) AS city, COUNT(*) AS count
       FROM primary_hotels p INNER JOIN hotels h ON h.id = p.hotel_id
       INNER JOIN hotel_price_cache hp ON hp.hotel_id = h.id
       WHERE h.status = 'published' AND hp.status = 'fresh'
         AND hp.nightly_price_usd IS NOT NULL AND hp.expires_at > ?1
       GROUP BY LOWER(p.city)`,
    ).bind(new Date().toISOString()).all<{ city: string; count: number | string }>();
    const rows = result.results ?? [];
    const makkahCount = Number(rows.find(row => row.city === "makkah")?.count ?? 0);
    const madinahCount = Number(rows.find(row => row.city === "madinah")?.count ?? 0);
    const tableRows = await hotels.prepare("SELECT name FROM sqlite_master WHERE type='table'").all<{ name: string }>();
    const tables = new Set((tableRows.results ?? []).map(row => row.name));
    const roomCategoryCount = tables.has("hotel_room_categories") ? Number((await hotels.prepare("SELECT COUNT(*) AS count FROM hotel_room_categories WHERE active = 1").first<{count: number}>())?.count ?? 0) : 0;
    const bookingColumns = await env.BOOKINGS_DB.prepare('PRAGMA table_info("bookings")').all<{name: string}>();
    const columns = new Set((bookingColumns.results ?? []).map(row => row.name));
    const accountsReady = ["iumrah_client_devices", "iumrah_client_session_bindings", "iumrah_client_security_audit", "iumrah_client_account_emails", "iumrah_client_email_challenges", "iumrah_client_account_phones", "iumrah_client_sms_challenges", "iumrah_client_apple_links", "iumrah_client_google_links"].every(table => tables.has(table));
    return json({ ...common, ok: true,
      primaryHotelConfigCount: makkahCount + madinahCount,
      primaryHotelConfigByCity: { Makkah: makkahCount, Madinah: madinahCount },
      primaryHotelsReady: makkahCount > 0,
      roomCategoriesReady: roomCategoryCount > 0, roomCategoryCount,
      bookingRoomColumnsReady: ["makkah_room_category", "makkah_room_name", "makkah_room_id"].every(column => columns.has(column)),
      accountsReady, databaseReadsVerified: true,
    });
  } catch (error) {
    console.error("PACKAGE_HEALTH_DB_READ_FAILED", error instanceof Error ? error.message : "unknown");
    return json({ ...common, ok: false, error: "PACKAGE_DATABASE_SCHEMA_NOT_READY" }, 503);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/.well-known/apple-app-site-association") {
      return appleAppSiteAssociation();
    }

    if (request.method === "GET" && (/^\/hotel\/[^/]+$/.test(url.pathname) || /^\/h\/[^/]+$/.test(url.pathname))) {
      return hotelWebFallback(url);
    }

    if (url.pathname.startsWith("/api/package/public/id/")) {
      return handlePublicIdentityRequest(request, env, url);
    }

    if (url.pathname.startsWith("/api/package/nuitee/")) {
      return handleNuiteeHotelRequest(request, env, url);
    }

    if (url.pathname.startsWith("/api/package/client/account/")) {
      return handleClientAccountSecurity(request, env, url);
    }

    if (url.pathname.startsWith("/api/admin/package")) {
      const auth = await requirePackageAdmin(request);
      if (!auth.ok) return auth.response;

      if (url.pathname === "/api/admin/package/flights/curation-search") {
        if (request.method === "POST") return searchIgnavFlightsForCuration(request, env);
        return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
      }

      if (url.pathname === "/api/admin/package/flights/curated") {
        if (request.method === "GET") return listCuratedFlightsAdmin(env.HOTELS_DB);
        if (request.method === "POST") return saveCuratedFlightAdmin(request, env.HOTELS_DB, auth.user.login ?? auth.user.email ?? auth.user.id ?? "staff");
        return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
      }

      const curatedFlightMatch = url.pathname.match(/^\/api\/admin\/package\/flights\/curated\/([^/]+)$/);
      if (curatedFlightMatch) {
        if (request.method === "DELETE") return deleteCuratedFlightAdmin(decodeURIComponent(curatedFlightMatch[1]), env.HOTELS_DB);
        return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
      }

      const adminBookingMatch = url.pathname.match(/^\/api\/admin\/package\/booking\/(IUM-\d{4}-[A-Z2-9]{7})$/);
      if (adminBookingMatch) {
        if (request.method === "DELETE") return deleteAdminBooking(adminBookingMatch[1], env);
        return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
      }

      if (url.pathname === "/api/admin/package/care-requests") {
        if (request.method === "GET") return listCarePackageRequests(url, env);
        return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
      }

      const adminCareRequestMatch = url.pathname.match(/^\/api\/admin\/package\/care-requests\/(CARE-\d{4}-[A-Z2-9]{7})$/);
      if (adminCareRequestMatch) {
        if (request.method === "PATCH") return updateCarePackageRequest(request, adminCareRequestMatch[1], env);
        return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
      }
      return json({ ok: false, error: "NOT_FOUND" }, 404);
    }


    if (request.method === "GET" && url.pathname === "/api/package/email-brand/logo.png") return bookingLogoResponse();
    if (url.pathname === "/api/package/booking-contact/email/start" ||
        url.pathname === "/api/package/booking-contact/email/confirm" ||
        /^\/api\/package\/booking\/IUM-\d{4}-[A-Z2-9]{7}\/verified-email$/.test(url.pathname)) {
      return handleGuestBookingEmail(request, env, url);
    }

    if (url.pathname === "/api/package/booking-contact/sms/start" ||
        url.pathname === "/api/package/booking-contact/sms/confirm" ||
        /^\/api\/package\/booking\/IUM-\d{4}-[A-Z2-9]{7}\/verified-phone$/.test(url.pathname)) {
      return handleGuestBookingPhone(request, env, url);
    }

    const bookingTelegramLinkMatch = url.pathname.match(/^\/api\/package\/booking\/(IUM-\d{4}-[A-Z2-9]{7})\/telegram-link$/);
    if (bookingTelegramLinkMatch) {
      if (request.method === "POST") return createTelegramBookingLink(request, bookingTelegramLinkMatch[1], env);
      return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
    }

    const bookingTelegramStatusMatch = url.pathname.match(/^\/api\/package\/booking\/(IUM-\d{4}-[A-Z2-9]{7})\/telegram-status$/);
    if (bookingTelegramStatusMatch) {
      if (request.method === "GET") return getTelegramBookingStatus(request, bookingTelegramStatusMatch[1], env);
      return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
    }

    const bookingItineraryMatch = url.pathname.match(/^\/api\/package\/booking\/(IUM-\d{4}-[A-Z2-9]{7})\/itinerary$/);
    if (bookingItineraryMatch) {
      if (request.method === "GET") return getBookingItineraryPlan(request, bookingItineraryMatch[1], env, url);
      return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
    }

    const bookingFriendsRedeemMatch = url.pathname.match(/^\/api\/package\/booking\/(IUM-\d{4}-[A-Z2-9]{7})\/friends\/redeem$/);
    if (bookingFriendsRedeemMatch) {
      if (request.method === "POST") return redeemPilgrimFriendGift(request, bookingFriendsRedeemMatch[1], env);
      return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
    }

    const bookingFriendsCreditMatch = url.pathname.match(/^\/api\/package\/booking\/(IUM-\d{4}-[A-Z2-9]{7})\/friends\/credit$/);
    if (bookingFriendsCreditMatch) {
      if (request.method === "POST") return applyPilgrimFriendCredit(request, bookingFriendsCreditMatch[1], env);
      return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
    }

    const bookingFriendsMatch = url.pathname.match(/^\/api\/package\/booking\/(IUM-\d{4}-[A-Z2-9]{7})\/friends$/);
    if (bookingFriendsMatch) {
      if (request.method === "GET") return getPilgrimFriendsSummary(request, bookingFriendsMatch[1], env);
      return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
    }

    const bookingContactMatch = url.pathname.match(/^\/api\/package\/booking\/(IUM-\d{4}-[A-Z2-9]{7})\/contact$/);
    if (bookingContactMatch) {
      if (request.method === "PATCH") return updatePilgrimContact(request, bookingContactMatch[1], env);
      return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
    }

    const bookingCustomizationMatch = url.pathname.match(/^\/api\/package\/booking\/(IUM-\d{4}-[A-Z2-9]{7})\/customization$/);
    if (bookingCustomizationMatch) {
      if (request.method === "PATCH") return updatePilgrimCustomization(request, bookingCustomizationMatch[1], env);
      return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
    }

    const bookingMatch = url.pathname.match(/^\/api\/package\/booking\/(IUM-\d{4}-[A-Z2-9]{7})$/);
    if (bookingMatch) {
      const bookingId = bookingMatch[1];
      if (request.method === "DELETE") return deletePilgrimBooking(request, bookingId, env);
      if (request.method === "PATCH") return updatePilgrimHotel(request, bookingId, env);
      return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
    }

    if (request.method === "POST" && url.pathname === "/api/package/care-requests") {
      return createCarePackageRequest(request, env);
    }

    if (request.method === "GET" && (url.pathname === "/health" || url.pathname === "/api/package/health")) {
      return publicHealth(env);
    }

    if (request.method === "POST" && url.pathname === "/api/package/quote") {
      return generatePackageQuote(request, env);
    }

    if (request.method === "POST" && url.pathname === "/api/package/storefront/quote") {
      return generateStorefrontPackageQuote(request, env);
    }

    const quoteCommitMatch = url.pathname.match(/^\/api\/package\/quote\/commit\/(IUM-\d{4}-[A-Z2-9]{7})$/);
    if (request.method === "POST" && quoteCommitMatch) {
      return commitPackageQuoteReport(request, quoteCommitMatch[1], env);
    }

    if (request.method === "POST" && url.pathname === "/api/package/flights/search") {
      return searchIgnavFlights(request, env);
    }

    if (request.method === "GET" && url.pathname === "/api/package/flights/data") {
      return publicAviasalesData(url, env);
    }

    if (request.method === "GET" && url.pathname === "/api/package/flights/calendar") {
      return flightCalendarResponse(url, env.HOTELS_DB);
    }

    if (request.method === "GET" && url.pathname === "/api/package/flights/recommendations") {
      return publicCuratedFlightRecommendations(url, env.HOTELS_DB);
    }

    if (request.method === "POST" && url.pathname === "/api/package/flights/recommendations/resolve") {
      return resolvePublicCuratedFlightRecommendation(request, env.HOTELS_DB);
    }

    if (request.method === "GET" && url.pathname === "/api/package/storefront/flights") {
      return publicStorefrontFlightBoard(url, env.HOTELS_DB);
    }

    const hotelPricingSourcesMatch = url.pathname.match(/^\/api\/package\/hotel\/([^/]+)\/pricing-sources$/);
    if (request.method === "GET" && hotelPricingSourcesMatch) {
      const hotelId = decodeURIComponent(hotelPricingSourcesMatch[1]).trim();
      return hotelPricingSources(hotelId, env);
    }

    const hotelRoomCategoriesMatch = url.pathname.match(/^\/api\/package\/hotel\/([^/]+)\/room-categories$/);
    if (request.method === "GET" && hotelRoomCategoriesMatch) {
      if (!env.HOTELS_DB) return json({ ok: false, error: "HOTELS_DB binding is not configured" }, 503);
      try {
        const hotelId = decodeURIComponent(hotelRoomCategoriesMatch[1]).trim();
        if (!hotelId || hotelId.length > 180) return json({ ok: false, error: "INVALID_HOTEL" }, 400);
        const categories = await listHotelRoomCategories(env.HOTELS_DB, hotelId);
        if (!categories) return json({ ok: false, error: "HOTEL_NOT_FOUND" }, 404);
        return json({
          ok: true,
          hotelId,
          categories: categories.map((row) => ({
            id: row.id,
            hotelId: row.hotel_id,
            category: row.category,
            displayName: row.display_name,
            maxGuests: Number(row.max_guests),
            bedConfiguration: row.bed_configuration,
            position: Number(row.position),
            source: row.source,
          })),
        });
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "ROOM_CATEGORIES_FAILED" }, 500);
      }
    }

    if (request.method === "GET" && url.pathname === "/api/package/primary-hotel") {
      return curatedPrimaryHotel(url, env);
    }

    return json({ ok: false, error: "Not found" }, 404);
  },

  async scheduled(controller: { cron?: string }, env: Env): Promise<void> {
    if (controller.cron === "0 3 * * *") await refreshNuiteeHotelCatalog(env);
    if (controller.cron === "23 * * * *") await refreshNuiteeHotelCatalog(env, false);
    if (!env.HOTELS_DB) return;
    if (controller.cron === "17 0 * * *") await cleanupExpiredFlightCache(env.HOTELS_DB);
    if (controller.cron === "*/5 * * * *") await flushBookingStatusEmails(env);
  },
};
