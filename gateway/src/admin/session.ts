/**
 * Admin session management.
 *
 * A stateless, HMAC-signed cookie (`admin_session`) authenticates the
 * admin UI. No server-side session store — verification is purely by
 * signature + expiry check. The HMAC uses the same signing key as the
 * JWT service so there's only one secret to protect.
 *
 * Cookie format: base64url(JSON{exp, nonce}).base64url(sig)
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { getSigningKey } from "../auth/token-service.js";

const COOKIE_NAME = "admin_session";
const SESSION_TTL_SECONDS = 60 * 60; // 1 hour (standard)
const REMEMBER_ME_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

interface SessionClaims {
  exp: number;
  nonce: string;
}

function b64url(data: Buffer | string): string {
  const buf = typeof data === "string" ? Buffer.from(data, "utf-8") : data;
  return buf.toString("base64url");
}

function b64urlDecode(s: string): Buffer {
  return Buffer.from(s, "base64url");
}

function signPayload(payload: string): string {
  return b64url(createHmac("sha256", getSigningKey()).update(payload).digest());
}

export function mintAdminSessionCookie(rememberMe = false): {
  token: string;
  maxAge: number;
} {
  const maxAge = rememberMe ? REMEMBER_ME_TTL_SECONDS : SESSION_TTL_SECONDS;
  const claims: SessionClaims = {
    exp: Math.floor(Date.now() / 1000) + maxAge,
    nonce: randomBytes(16).toString("hex"),
  };
  const payload = b64url(JSON.stringify(claims));
  const sig = signPayload(payload);
  return { token: `${payload}.${sig}`, maxAge };
}

export function verifyAdminSession(cookie: string | undefined): boolean {
  if (!cookie) return false;
  const parts = cookie.split(".");
  if (parts.length !== 2) return false;

  const [payload, sig] = parts;
  const expectedSig = signPayload(payload);
  const actualSig = b64urlDecode(sig);
  const expectedSigBuf = b64urlDecode(expectedSig);
  if (actualSig.length !== expectedSigBuf.length) return false;
  if (!timingSafeEqual(actualSig, expectedSigBuf)) return false;

  let claims: SessionClaims;
  try {
    claims = JSON.parse(b64urlDecode(payload).toString("utf-8"));
  } catch {
    return false;
  }
  const now = Math.floor(Date.now() / 1000);
  return claims.exp > now;
}

/** Parse a Cookie header into a plain name→value map. */
export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function requireAdminSession(req: Request): boolean {
  const cookies = parseCookies(req.headers.get("cookie"));
  return verifyAdminSession(cookies[COOKIE_NAME]);
}

export function setSessionCookieHeader(
  rememberMe = false,
): Record<string, string> {
  const { token, maxAge } = mintAdminSessionCookie(rememberMe);
  return {
    "Set-Cookie": `${COOKIE_NAME}=${token}; Max-Age=${maxAge}; Path=/admin; HttpOnly; Secure; SameSite=Strict`,
  };
}

export function clearSessionCookieHeader(): Record<string, string> {
  return {
    "Set-Cookie": `${COOKIE_NAME}=; Max-Age=0; Path=/admin; HttpOnly; Secure; SameSite=Strict`,
  };
}

export function verifyAdminPassword(submitted: string): boolean {
  const expected = process.env.ADMIN_PASSWORD ?? "";
  if (!expected) return false;
  const a = Buffer.from(submitted);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
