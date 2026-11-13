// Ported from iumrah-web-main 5.zip: lib/iumrah-account.ts
import { requestEnv, backendFetch } from "../runtime.js";
import { readCookie } from "./staff-auth.js";
export const IUMRAH_ACCOUNT_COOKIE = "iumrah_account_session";
export const IUMRAH_ACCOUNT_COOKIE_MAX_AGE = 60 * 60 * 24 * 90;
function cleanOrigin(value) {
    const trimmed = value?.trim().replace(/\/+$/, "");
    return trimmed || "https://iumrah-backend.helloiumrah.workers.dev";
}
export function accountApiOrigin() {
    return "https://iumrah-backend.helloiumrah.workers.dev";
}
export function formatIumrahID(value) {
    const digits = String(value ?? "").replace(/\D/g, "");
    if (!digits)
        return "";
    return digits.length >= 8 ? digits : digits.padStart(8, "0");
}
export function accountToken(request) {
    return readCookie(request.headers.get("cookie"), IUMRAH_ACCOUNT_COOKIE);
}
export async function accountUpstream(path, init = {}) {
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    if (init.body && !headers.has("content-type"))
        headers.set("content-type", "application/json");
    return backendFetch(`${accountApiOrigin()}${path}`, {
        ...init,
        headers,
        cache: "no-store",
    });
}
export async function accountAuthedUpstream(request, path, init = {}) {
    const token = accountToken(request);
    if (!token)
        return null;
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${token}`);
    return accountUpstream(path, { ...init, headers });
}
export async function jsonPayload(response) {
    try {
        return await response.json();
    }
    catch {
        return { error: response.ok ? "INVALID_UPSTREAM_RESPONSE" : "ACCOUNT_SERVICE_UNAVAILABLE" };
    }
}
export function normalizedAccount(value) {
    if (!value || typeof value !== "object")
        return null;
    const item = value;
    const iumrahID = formatIumrahID(item.iumrahID);
    if (!iumrahID)
        return null;
    const string = (key) => typeof item[key] === "string" ? item[key] : "";
    return {
        iumrahID,
        displayName: string("displayName"),
        firstName: string("firstName"),
        lastName: string("lastName"),
        phone: string("phone"),
        email: string("email"),
        telegram: string("telegram"),
        whatsapp: string("whatsapp"),
    };
}
export function accountCookieOptions(maxAge = IUMRAH_ACCOUNT_COOKIE_MAX_AGE) {
    return {
        httpOnly: true,
        secure: requestEnv().NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge,
    };
}
