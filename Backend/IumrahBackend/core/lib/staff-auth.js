// Ported from iumrah-web-main 5.zip: lib/staff-auth.ts
import { requestEnv, backendFetch } from "../runtime.js";
import { getCloudflareContext } from "../runtime.js";
export const STAFF_SESSION_COOKIE = "iumrah_staff_session";
export const STAFF_SESSION_MAX_AGE = 60 * 60 * 12;
function normalize(value) {
    const trimmed = value?.trim();
    if (!trimmed)
        return undefined;
    if (trimmed.length > 1 &&
        ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
            (trimmed.startsWith("'") && trimmed.endsWith("'")))) {
        return trimmed.slice(1, -1).trim();
    }
    return trimmed;
}
function environment() {
    const fromProcess = {
        IUMRAH_SUPERADMIN_LOGIN: normalize(requestEnv().IUMRAH_SUPERADMIN_LOGIN),
        IUMRAH_SUPERADMIN_PASSWORD: normalize(requestEnv().IUMRAH_SUPERADMIN_PASSWORD),
        IUMRAH_SESSION_SECRET: normalize(requestEnv().IUMRAH_SESSION_SECRET),
    };
    try {
        const cloudflareEnv = getCloudflareContext().env;
        return {
            IUMRAH_SUPERADMIN_LOGIN: fromProcess.IUMRAH_SUPERADMIN_LOGIN ?? normalize(cloudflareEnv.IUMRAH_SUPERADMIN_LOGIN),
            IUMRAH_SUPERADMIN_PASSWORD: fromProcess.IUMRAH_SUPERADMIN_PASSWORD ?? normalize(cloudflareEnv.IUMRAH_SUPERADMIN_PASSWORD),
            IUMRAH_SESSION_SECRET: fromProcess.IUMRAH_SESSION_SECRET ?? normalize(cloudflareEnv.IUMRAH_SESSION_SECRET),
        };
    }
    catch {
        return fromProcess;
    }
}
export function staffAuthConfig() {
    const env = environment();
    return {
        login: env.IUMRAH_SUPERADMIN_LOGIN ?? "superadmin",
        password: env.IUMRAH_SUPERADMIN_PASSWORD,
        sessionSecret: env.IUMRAH_SESSION_SECRET,
        ready: Boolean(env.IUMRAH_SUPERADMIN_PASSWORD && env.IUMRAH_SESSION_SECRET),
    };
}
function toBase64Url(bytes) {
    let binary = "";
    for (const byte of bytes)
        binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function fromBase64Url(value) {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
    const binary = atob(padded);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
function encodeJson(value) {
    return toBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}
function decodeJson(value) {
    try {
        const json = new TextDecoder().decode(fromBase64Url(value));
        return JSON.parse(json);
    }
    catch {
        return null;
    }
}
async function hmac(secret, message) {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
    return new Uint8Array(signature);
}
function constantTimeEqual(a, b) {
    if (a.length !== b.length)
        return false;
    let diff = 0;
    for (let index = 0; index < a.length; index += 1)
        diff |= a[index] ^ b[index];
    return diff === 0;
}
export async function verifyStaffCredentials(login, password) {
    const config = staffAuthConfig();
    if (!config.ready || !config.password || !config.sessionSecret) {
        return { ok: false, reason: "NOT_CONFIGURED" };
    }
    const normalizedLogin = login.trim().toLowerCase();
    const expectedLogin = config.login.trim().toLowerCase();
    const [loginDigest, expectedLoginDigest, passwordDigest, expectedPasswordDigest] = await Promise.all([
        hmac(config.sessionSecret, `login:${normalizedLogin}`),
        hmac(config.sessionSecret, `login:${expectedLogin}`),
        hmac(config.sessionSecret, `password:${password}`),
        hmac(config.sessionSecret, `password:${config.password}`),
    ]);
    const valid = constantTimeEqual(loginDigest, expectedLoginDigest) && constantTimeEqual(passwordDigest, expectedPasswordDigest);
    return valid
        ? { ok: true, login: config.login }
        : { ok: false, reason: "INVALID_CREDENTIALS" };
}
export async function createStaffSession(login) {
    const config = staffAuthConfig();
    if (!config.sessionSecret)
        throw new Error("IUMRAH_SESSION_SECRET is not configured");
    const payload = {
        v: 1,
        sub: login,
        role: "superadmin",
        displayName: "Super Administrator",
        exp: Math.floor(Date.now() / 1000) + STAFF_SESSION_MAX_AGE,
    };
    const encoded = encodeJson(payload);
    const signature = toBase64Url(await hmac(config.sessionSecret, encoded));
    return `${encoded}.${signature}`;
}
export async function verifyStaffSessionToken(token) {
    const config = staffAuthConfig();
    if (!config.sessionSecret || !token)
        return null;
    const separator = token.lastIndexOf(".");
    if (separator <= 0)
        return null;
    const encoded = token.slice(0, separator);
    const signature = token.slice(separator + 1);
    let suppliedSignature;
    try {
        suppliedSignature = fromBase64Url(signature);
    }
    catch {
        return null;
    }
    const expectedSignature = await hmac(config.sessionSecret, encoded);
    if (!constantTimeEqual(suppliedSignature, expectedSignature))
        return null;
    const payload = decodeJson(encoded);
    if (!payload || payload.v !== 1 || payload.role !== "superadmin" || !payload.sub || !payload.exp)
        return null;
    if (payload.exp <= Math.floor(Date.now() / 1000))
        return null;
    return payload;
}
export function readCookie(cookieHeader, name) {
    if (!cookieHeader)
        return null;
    const parts = cookieHeader.split(";");
    for (const part of parts) {
        const [rawName, ...rest] = part.trim().split("=");
        if (rawName === name)
            return decodeURIComponent(rest.join("="));
    }
    return null;
}
