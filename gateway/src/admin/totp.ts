/**
 * RFC 6238 TOTP verification + secret generation.
 *
 * No external deps — relies only on node:crypto. Compatible with every
 * major authenticator app (Google Authenticator, 1Password, Authy, Bitwarden).
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const STEP_SECONDS = 30;
const DIGITS = 6;
const ALGO = "sha1"; // RFC 6238 default — what all authenticators speak

/** RFC 4648 base32 alphabet (no padding). */
const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function toBase32(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += B32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

function fromBase32(s: string): Buffer {
  const clean = s.toUpperCase().replace(/=+$/, "").replace(/\s+/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error("invalid base32");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function totpCodeForCounter(secret: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  // Write 64-bit big-endian counter
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);

  const hmac = createHmac(ALGO, secret).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (code % 10 ** DIGITS).toString().padStart(DIGITS, "0");
}

/** Generate a new TOTP secret. Returns both raw bytes and base32 string. */
export function generateTotpSecret(): { raw: Buffer; base32: string } {
  const raw = randomBytes(20);
  return { raw, base32: toBase32(raw) };
}

export function secretToBase32(raw: Buffer): string {
  return toBase32(raw);
}

export function secretFromBase32(base32: string): Buffer {
  return fromBase32(base32);
}

/**
 * Verify a submitted TOTP code against a secret. Allows a ±1 step window
 * (±30s) to accommodate clock drift between server and authenticator.
 */
export function verifyTotp(secretBase32: string, submitted: string): boolean {
  const code = submitted.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(code)) return false;
  const secret = fromBase32(secretBase32);
  const now = Math.floor(Date.now() / 1000 / STEP_SECONDS);
  for (const delta of [-1, 0, 1]) {
    const expected = totpCodeForCounter(secret, now + delta);
    const a = Buffer.from(expected);
    const b = Buffer.from(code);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  return false;
}

/** Build an otpauth:// URI suitable for rendering as a QR code. */
export function buildOtpauthUri(params: {
  issuer: string;
  account: string;
  secretBase32: string;
}): string {
  const issuer = encodeURIComponent(params.issuer);
  const account = encodeURIComponent(params.account);
  const label = `${issuer}:${account}`;
  const query = new URLSearchParams({
    secret: params.secretBase32,
    issuer: params.issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}
