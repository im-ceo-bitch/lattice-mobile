import type { Env } from "./env";
import { formatIumrahID, publicIdentityURL } from "./public-identity";
import {
  ICON_PNG,
  ICON_2X_PNG,
  ICON_3X_PNG,
  LOGO_PNG,
  LOGO_2X_PNG,
  THUMBNAIL_PNG,
  THUMBNAIL_2X_PNG,
  THUMBNAIL_3X_PNG,
} from "./wallet-pass-assets";

type WalletAccountProfile = {
  iumrahID: string;
  displayName: string;
  firstName: string;
  lastName: string;
};

type WalletConfiguration = {
  passTypeIdentifier: string;
  teamIdentifier: string;
  organizationName: string;
  certificateDER: Uint8Array;
  wwdrCertificateDER: Uint8Array;
  privateKeyDER: Uint8Array;
};

type DERNode = {
  tag: number;
  start: number;
  contentStart: number;
  end: number;
};

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function base64Bytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function pemBytes(value: string | undefined, label: string) {
  const normalized = (value ?? "").replace(/\\n/g, "\n").trim();
  if (!normalized) return null;
  const body = normalized
    .replace(new RegExp(`-----BEGIN ${label}-----`, "g"), "")
    .replace(new RegExp(`-----END ${label}-----`, "g"), "")
    .replace(/\s+/g, "");
  if (!body) return null;
  try {
    return base64Bytes(body);
  } catch {
    return null;
  }
}

function walletConfiguration(env: Env): WalletConfiguration | null {
  const passTypeIdentifier = (env.WALLET_PASS_TYPE_ID ?? "").trim();
  const teamIdentifier = (env.WALLET_TEAM_ID ?? "").trim();
  const certificateDER = pemBytes(env.WALLET_CERT_PEM, "CERTIFICATE");
  const wwdrCertificateDER = pemBytes(env.WALLET_WWDR_CERT_PEM, "CERTIFICATE");
  const privateKeyDER = pemBytes(env.WALLET_KEY_PEM, "PRIVATE KEY");

  if (!passTypeIdentifier || !teamIdentifier || !certificateDER || !wwdrCertificateDER || !privateKeyDER) {
    return null;
  }

  return {
    passTypeIdentifier,
    teamIdentifier,
    organizationName: (env.WALLET_ORGANIZATION_NAME ?? "iumrah").trim() || "iumrah",
    certificateDER,
    wwdrCertificateDER,
    privateKeyDER,
  };
}

function concatBytes(...parts: Uint8Array[]) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function derLength(length: number) {
  if (length < 0x80) return new Uint8Array([length]);
  const bytes: number[] = [];
  let value = length;
  while (value > 0) {
    bytes.unshift(value & 0xff);
    value >>>= 8;
  }
  return new Uint8Array([0x80 | bytes.length, ...bytes]);
}

function der(tag: number, content: Uint8Array) {
  return concatBytes(new Uint8Array([tag]), derLength(content.length), content);
}

function derSequence(parts: Uint8Array[]) {
  return der(0x30, concatBytes(...parts));
}

function byteCompare(left: Uint8Array, right: Uint8Array) {
  const count = Math.min(left.length, right.length);
  for (let index = 0; index < count; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return left.length - right.length;
}

function derSet(parts: Uint8Array[]) {
  return der(0x31, concatBytes(...parts.slice().sort(byteCompare)));
}

function derInteger(value: number) {
  const bytes: number[] = [];
  let current = value;
  while (current > 0) {
    bytes.unshift(current & 0xff);
    current >>>= 8;
  }
  if (bytes.length === 0) bytes.push(0);
  if ((bytes[0] & 0x80) !== 0) bytes.unshift(0);
  return der(0x02, new Uint8Array(bytes));
}

function derNull() {
  return new Uint8Array([0x05, 0x00]);
}

function derOctetString(bytes: Uint8Array) {
  return der(0x04, bytes);
}

function derOID(value: string) {
  const arcs = value.split(".").map((part) => Number(part));
  if (arcs.length < 2 || arcs.some((part) => !Number.isInteger(part) || part < 0)) {
    throw new Error("INVALID_OID");
  }
  const output: number[] = [(arcs[0] * 40) + arcs[1]];
  for (const arc of arcs.slice(2)) {
    const encoded = [arc & 0x7f];
    let current = Math.floor(arc / 128);
    while (current > 0) {
      encoded.unshift((current & 0x7f) | 0x80);
      current = Math.floor(current / 128);
    }
    output.push(...encoded);
  }
  return der(0x06, new Uint8Array(output));
}

function derUTCTime(date: Date) {
  const year = String(date.getUTCFullYear()).slice(-2);
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  const second = String(date.getUTCSeconds()).padStart(2, "0");
  return der(0x17, new TextEncoder().encode(`${year}${month}${day}${hour}${minute}${second}Z`));
}

function derAlgorithmIdentifier(oid: string) {
  return derSequence([derOID(oid), derNull()]);
}

function readDERNode(bytes: Uint8Array, offset: number): DERNode {
  if (offset + 2 > bytes.length) throw new Error("INVALID_DER");
  const tag = bytes[offset];
  const lengthByte = bytes[offset + 1];
  let length = 0;
  let contentStart = offset + 2;
  if ((lengthByte & 0x80) === 0) {
    length = lengthByte;
  } else {
    const count = lengthByte & 0x7f;
    if (count === 0 || count > 4 || contentStart + count > bytes.length) throw new Error("INVALID_DER_LENGTH");
    for (let index = 0; index < count; index += 1) length = (length * 256) + bytes[contentStart + index];
    contentStart += count;
  }
  const end = contentStart + length;
  if (end > bytes.length) throw new Error("INVALID_DER_BOUNDS");
  return { tag, start: offset, contentStart, end };
}

function derChildren(bytes: Uint8Array, node: DERNode) {
  const children: DERNode[] = [];
  let offset = node.contentStart;
  while (offset < node.end) {
    const child = readDERNode(bytes, offset);
    children.push(child);
    offset = child.end;
  }
  if (offset !== node.end) throw new Error("INVALID_DER_CHILDREN");
  return children;
}

function derSlice(bytes: Uint8Array, node: DERNode) {
  return bytes.slice(node.start, node.end);
}

function certificateIssuerAndSerial(certificate: Uint8Array) {
  const root = readDERNode(certificate, 0);
  if (root.tag !== 0x30 || root.end !== certificate.length) throw new Error("INVALID_CERTIFICATE");
  const certificateChildren = derChildren(certificate, root);
  const tbs = certificateChildren[0];
  if (!tbs || tbs.tag !== 0x30) throw new Error("INVALID_CERTIFICATE_TBS");
  const tbsChildren = derChildren(certificate, tbs);
  const base = tbsChildren[0]?.tag === 0xa0 ? 1 : 0;
  const serial = tbsChildren[base];
  const issuer = tbsChildren[base + 2];
  if (!serial || serial.tag !== 0x02 || !issuer || issuer.tag !== 0x30) throw new Error("INVALID_CERTIFICATE_ID");
  return {
    serialDER: derSlice(certificate, serial),
    issuerDER: derSlice(certificate, issuer),
  };
}

async function digest(name: "SHA-1" | "SHA-256", bytes: Uint8Array) {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Uint8Array(await crypto.subtle.digest(name, buffer));
}

async function sha1Hex(bytes: Uint8Array) {
  const value = await digest("SHA-1", bytes);
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function signManifest(manifest: Uint8Array, configuration: WalletConfiguration) {
  const dataOID = "1.2.840.113549.1.7.1";
  const signedDataOID = "1.2.840.113549.1.7.2";
  const contentTypeAttributeOID = "1.2.840.113549.1.9.3";
  const messageDigestAttributeOID = "1.2.840.113549.1.9.4";
  const signingTimeAttributeOID = "1.2.840.113549.1.9.5";
  const sha256OID = "2.16.840.1.101.3.4.2.1";
  const rsaEncryptionOID = "1.2.840.113549.1.1.1";

  const messageDigest = await digest("SHA-256", manifest);
  const attributes = [
    derSequence([derOID(contentTypeAttributeOID), derSet([derOID(dataOID)])]),
    derSequence([derOID(messageDigestAttributeOID), derSet([derOctetString(messageDigest)])]),
    derSequence([derOID(signingTimeAttributeOID), derSet([derUTCTime(new Date())])]),
  ];
  const signedAttributesSet = derSet(attributes);
  const signedAttributesNode = readDERNode(signedAttributesSet, 0);
  const signedAttributesImplicit = der(0xa0, signedAttributesSet.slice(signedAttributesNode.contentStart, signedAttributesNode.end));

  const privateKeyBuffer = configuration.privateKeyDER.buffer.slice(
    configuration.privateKeyDER.byteOffset,
    configuration.privateKeyDER.byteOffset + configuration.privateKeyDER.byteLength,
  ) as ArrayBuffer;
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    privateKeyBuffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signedAttributesBuffer = signedAttributesSet.buffer.slice(
    signedAttributesSet.byteOffset,
    signedAttributesSet.byteOffset + signedAttributesSet.byteLength,
  ) as ArrayBuffer;
  const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, signedAttributesBuffer));

  const signerIdentity = certificateIssuerAndSerial(configuration.certificateDER);
  const signerInfo = derSequence([
    derInteger(1),
    derSequence([signerIdentity.issuerDER, signerIdentity.serialDER]),
    derAlgorithmIdentifier(sha256OID),
    signedAttributesImplicit,
    derAlgorithmIdentifier(rsaEncryptionOID),
    derOctetString(signature),
  ]);

  const certificates = [configuration.certificateDER, configuration.wwdrCertificateDER].sort(byteCompare);
  const signedData = derSequence([
    derInteger(1),
    derSet([derAlgorithmIdentifier(sha256OID)]),
    derSequence([derOID(dataOID)]),
    der(0xa0, concatBytes(...certificates)),
    derSet([signerInfo]),
  ]);

  return derSequence([
    derOID(signedDataOID),
    der(0xa0, signedData),
  ]);
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array) {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function little16(value: number) {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff]);
}

function little32(value: number) {
  return new Uint8Array([
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ]);
}

function zipStore(files: Record<string, Uint8Array>) {
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const [name, data] of Object.entries(files)) {
    const nameBytes = new TextEncoder().encode(name);
    const checksum = crc32(data);
    const local = concatBytes(
      little32(0x04034b50),
      little16(20),
      little16(0),
      little16(0),
      little16(0),
      little16(0),
      little32(checksum),
      little32(data.length),
      little32(data.length),
      little16(nameBytes.length),
      little16(0),
      nameBytes,
      data,
    );
    locals.push(local);

    central.push(concatBytes(
      little32(0x02014b50),
      little16(20),
      little16(20),
      little16(0),
      little16(0),
      little16(0),
      little16(0),
      little32(checksum),
      little32(data.length),
      little32(data.length),
      little16(nameBytes.length),
      little16(0),
      little16(0),
      little16(0),
      little16(0),
      little32(0),
      little32(offset),
      nameBytes,
    ));
    offset += local.length;
  }

  const centralDirectory = concatBytes(...central);
  const end = concatBytes(
    little32(0x06054b50),
    little16(0),
    little16(0),
    little16(central.length),
    little16(central.length),
    little32(centralDirectory.length),
    little32(offset),
    little16(0),
  );
  return concatBytes(...locals, centralDirectory, end);
}

function localizedName(profile: WalletAccountProfile) {
  const displayName = profile.displayName.trim();
  if (displayName) return displayName;
  const fullName = [profile.firstName.trim(), profile.lastName.trim()].filter(Boolean).join(" ");
  return fullName || "Iumrah Pilgrim";
}

export async function buildIumrahWalletPass(env: Env, profile: WalletAccountProfile) {
  const configuration = walletConfiguration(env);
  if (!configuration) return json({ ok: false, error: "WALLET_PASS_NOT_CONFIGURED" }, 503);

  const normalizedID = formatIumrahID(profile.iumrahID);
  const numericID = Number(String(profile.iumrahID).replace(/\D/g, ""));
  const verificationURL = Number.isSafeInteger(numericID) && numericID > 0
    ? await publicIdentityURL(env, numericID)
    : "https://iumrah.app/account";
  const pass = {
    formatVersion: 1,
    passTypeIdentifier: configuration.passTypeIdentifier,
    serialNumber: `iumrah-id-${normalizedID}`,
    teamIdentifier: configuration.teamIdentifier,
    organizationName: configuration.organizationName,
    description: "iumrah ID",
    foregroundColor: "rgb(255,255,255)",
    backgroundColor: "rgb(8,8,11)",
    labelColor: "rgb(151,151,160)",
    generic: {
      primaryFields: [{ key: "pilgrim", label: "PILGRIM", value: localizedName(profile) }],
      secondaryFields: [{ key: "iumrah-id", label: "IUMRAH ID", value: normalizedID }],
      backFields: [
        {
          key: "about",
          label: "ABOUT IUMRAH ID",
          value: "Your permanent digital pilgrim ID for the iumrah platform. This is not a government identity document.",
        },
        { key: "website", label: "WEBSITE", value: "https://iumrah.app" },
      ],
    },
    barcodes: [{
      format: "PKBarcodeFormatQR",
      message: verificationURL,
      messageEncoding: "iso-8859-1",
    }],
  };

  const encoder = new TextEncoder();
  const files: Record<string, Uint8Array> = {
    "pass.json": encoder.encode(JSON.stringify(pass)),
    "icon.png": base64Bytes(ICON_PNG),
    "icon@2x.png": base64Bytes(ICON_2X_PNG),
    "icon@3x.png": base64Bytes(ICON_3X_PNG),
    "logo.png": base64Bytes(LOGO_PNG),
    "logo@2x.png": base64Bytes(LOGO_2X_PNG),
    "thumbnail.png": base64Bytes(THUMBNAIL_PNG),
    "thumbnail@2x.png": base64Bytes(THUMBNAIL_2X_PNG),
    "thumbnail@3x.png": base64Bytes(THUMBNAIL_3X_PNG),
  };

  const manifestEntries = await Promise.all(
    Object.entries(files).map(async ([name, bytes]) => [name, await sha1Hex(bytes)] as const),
  );
  const manifest = encoder.encode(JSON.stringify(Object.fromEntries(manifestEntries)));
  files["manifest.json"] = manifest;
  files.signature = await signManifest(manifest, configuration);

  const archive = zipStore(files);
  return new Response(archive, {
    status: 200,
    headers: {
      "content-type": "application/vnd.apple.pkpass",
      "content-disposition": `attachment; filename="iumrah-id-${normalizedID}.pkpass"`,
      "cache-control": "private, no-store, max-age=0",
      "x-content-type-options": "nosniff",
    },
  });
}
