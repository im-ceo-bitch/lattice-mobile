import type { Env } from "./env";
import type { GeneratorPricingSnapshot } from "./pricing";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const QUOTE_TTL_MS = 24 * 60 * 60 * 1000;

type SealedQuoteEnvelope = {
  v: 1;
  issuedAt: string;
  expiresAt: string;
  snapshot: GeneratorPricingSnapshot;
};

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}


function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function quoteKey(env: Env): Promise<CryptoKey> {
  const dedicated = String(env.PACKAGE_QUOTE_SEAL_KEY ?? "").trim();
  let raw: Uint8Array;
  if (dedicated) {
    try {
      raw = fromBase64Url(dedicated);
    } catch {
      throw new Error("INVALID_PACKAGE_QUOTE_SEAL_KEY");
    }
    if (raw.byteLength !== 32) throw new Error("INVALID_PACKAGE_QUOTE_SEAL_KEY");
  } else {
    const fallback = String(env.IGNAV_API_KEY ?? "").trim();
    if (!fallback) throw new Error("QUOTE_SEAL_NOT_CONFIGURED");
    const digest = await crypto.subtle.digest("SHA-256", encoder.encode(`iumrah:package-quote:v1:${fallback}`));
    raw = new Uint8Array(digest);
  }
  return crypto.subtle.importKey("raw", toArrayBuffer(raw), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export function quoteSealingMode(env: Env): "dedicated" | "derived" | "unavailable" {
  if (String(env.PACKAGE_QUOTE_SEAL_KEY ?? "").trim()) return "dedicated";
  if (String(env.IGNAV_API_KEY ?? "").trim()) return "derived";
  return "unavailable";
}

export async function sealPricingSnapshot(snapshot: GeneratorPricingSnapshot, env: Env): Promise<string> {
  const key = await quoteKey(env);
  const issuedAt = new Date();
  const envelope: SealedQuoteEnvelope = {
    v: 1,
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + (snapshot.nuiteeRooms ? 10 * 60 * 1000 : QUOTE_TTL_MS)).toISOString(),
    snapshot,
  };
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, encoder.encode(JSON.stringify(envelope)));
  return `q1.${base64Url(nonce)}.${base64Url(new Uint8Array(encrypted))}`;
}

export async function unsealPricingSnapshot(token: string, env: Env): Promise<GeneratorPricingSnapshot> {
  const parts = String(token ?? "").split(".");
  if (parts.length !== 3 || parts[0] !== "q1") throw new Error("INVALID_QUOTE_PROOF");
  const nonce = fromBase64Url(parts[1]);
  const ciphertext = fromBase64Url(parts[2]);
  if (nonce.byteLength !== 12 || ciphertext.byteLength < 32) throw new Error("INVALID_QUOTE_PROOF");
  const key = await quoteKey(env);
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: toArrayBuffer(nonce) }, key, toArrayBuffer(ciphertext));
  } catch {
    throw new Error("INVALID_QUOTE_PROOF");
  }
  let envelope: SealedQuoteEnvelope;
  try { envelope = JSON.parse(decoder.decode(plaintext)) as SealedQuoteEnvelope; }
  catch { throw new Error("INVALID_QUOTE_PROOF"); }
  if (envelope.v !== 1 || !envelope.snapshot?.quoteId) throw new Error("INVALID_QUOTE_PROOF");
  const expires = Date.parse(envelope.expiresAt);
  if (!Number.isFinite(expires) || expires <= Date.now()) throw new Error("QUOTE_EXPIRED");
  return envelope.snapshot;
}
