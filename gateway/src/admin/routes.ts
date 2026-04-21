/**
 * Admin UI routes.
 *
 * Hardened login: password + TOTP 2FA, per-IP rate limiting, HMAC-signed
 * session cookies. First-time TOTP enrolment is handled inline — the
 * first successful password login (before any TOTP secret exists) returns
 * the otpauth URI + base32 secret so the admin can scan the QR before
 * being locked in.
 *
 * Endpoints:
 *   GET    /admin                                — serves the HTML UI
 *   POST   /admin/api/login                      — { password, totp? } → session cookie
 *                                                    OR { setup: { otpauthUri, secretBase32 } } on first run
 *   POST   /admin/api/login/confirm-totp         — { totp } → finalises TOTP enrolment during setup
 *   POST   /admin/api/logout                     — clears session cookie
 *   GET    /admin/api/integrations/:channel      — current integration status (session)
 *   POST   /admin/api/integrations/:channel      — activate (session)
 *   DELETE /admin/api/integrations/:channel      — deactivate (session)
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import QRCode from "qrcode";

import type { GatewayConfig } from "../config.js";
import type { RouteDefinition } from "../http/router.js";
import { getLogger } from "../logger.js";
import { adminProxyToDaemon } from "./daemon-proxy.js";
import {
  checkLoginAllowed,
  recordLoginFailure,
  recordLoginSuccess,
} from "./rate-limit.js";
import {
  clearSessionCookieHeader,
  requireAdminSession,
  setSessionCookieHeader,
  verifyAdminPassword,
} from "./session.js";
import { buildOtpauthUri, generateTotpSecret, verifyTotp } from "./totp.js";
import { loadTotpSecret, saveTotpSecret, totpEnrolled } from "./totp-store.js";

const log = getLogger("admin-routes");

const CHANNELS = ["slack", "telegram", "whatsapp"] as const;
type Channel = (typeof CHANNELS)[number];

const DAEMON_PATH_BY_CHANNEL: Record<Channel, string> = {
  slack: "/v1/integrations/slack/channel/config",
  telegram: "/v1/integrations/telegram/config",
  whatsapp: "/v1/integrations/whatsapp/config",
};

function isChannel(s: string): s is Channel {
  return (CHANNELS as readonly string[]).includes(s);
}

function json(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}

function unauthorized(): Response {
  return json({ error: "Unauthorized" }, 401);
}

// Resolve paths at module load.
// gateway/src/admin/routes.ts → ../../admin-ui/dist
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const SPA_DIST_DIR = join(MODULE_DIR, "..", "..", "admin-ui", "dist");
const SPA_INDEX_PATH = join(SPA_DIST_DIR, "index.html");

// CSP tuned for a Vite build served same-origin at /admin:
//   - bundled JS/CSS live at /admin/assets/* (hashed filenames) → 'self' covers it
//   - Vite inlines a tiny module-preload polyfill as an inline script on older
//     browsers → keep 'unsafe-inline' in script-src
//   - Google Fonts stylesheet on fonts.googleapis.com, font files on
//     fonts.gstatic.com
const ADMIN_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "connect-src 'self'",
  "img-src 'self' data:",
  "frame-ancestors 'none'",
].join("; ");

const COMMON_HTML_HEADERS: Record<string, string> = {
  "Content-Security-Policy": ADMIN_CSP,
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
};

function serveSpaIndex(): Response {
  try {
    const html = readFileSync(SPA_INDEX_PATH, "utf-8");
    return new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache",
        ...COMMON_HTML_HEADERS,
      },
    });
  } catch (err) {
    log.error({ err, SPA_INDEX_PATH }, "admin SPA index missing");
    return json({ error: "admin UI not built", detail: String(err) }, 500);
  }
}

const ASSET_MIME: Record<string, string> = {
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

/**
 * Serve a file from the built Vite SPA. `relPath` is a path **relative to
 * the dist root** (e.g. "assets/index-abc.js" or "logo-256.png"). Path
 * traversal is defended against by rejecting anything that doesn't resolve
 * under SPA_DIST_DIR.
 */
function serveSpaFile(relPath: string): Response {
  // Allowlist: no leading slash, no '..', only safe chars.
  if (!/^[a-zA-Z0-9._/-]+$/.test(relPath) || relPath.includes("..")) {
    return json({ error: "not found" }, 404);
  }
  const full = join(SPA_DIST_DIR, relPath);
  const safeBase = SPA_DIST_DIR.endsWith("/")
    ? SPA_DIST_DIR
    : SPA_DIST_DIR + "/";
  if (full !== SPA_DIST_DIR && !full.startsWith(safeBase)) {
    return json({ error: "not found" }, 404);
  }
  if (!existsSync(full)) return json({ error: "not found" }, 404);
  const dot = relPath.lastIndexOf(".");
  const ext = dot >= 0 ? relPath.slice(dot).toLowerCase() : "";
  const mime = ASSET_MIME[ext] ?? "application/octet-stream";
  const body = readFileSync(full);

  // Fingerprinted /admin/assets/<hash>.<ext> → immutable cache.
  // Everything else (root-level logo.png etc.) → short revalidate window.
  const cacheControl = relPath.startsWith("assets/")
    ? "public, max-age=31536000, immutable"
    : "public, max-age=3600";

  return new Response(body, {
    status: 200,
    headers: { "Content-Type": mime, "Cache-Control": cacheControl },
  });
}

// ---------------------------------------------------------------------
// First-time TOTP setup state
// ---------------------------------------------------------------------
// After a valid password is submitted and no TOTP secret exists yet, we
// generate a candidate secret and hold it in memory, keyed by a setup
// token returned to the browser. The browser POSTs the confirming code
// + setup token; if the code verifies against the candidate, we persist
// the secret and sign the user in.
//
// The candidate lives at most 10 minutes and can't be reused.

interface PendingSetup {
  secretBase32: string;
  createdAt: number;
}
const pendingSetups = new Map<string, PendingSetup>();
const SETUP_TTL_MS = 10 * 60 * 1000;

function gcPendingSetups(): void {
  const now = Date.now();
  for (const [k, v] of pendingSetups.entries()) {
    if (now - v.createdAt > SETUP_TTL_MS) pendingSetups.delete(k);
  }
}

function randomSetupToken(): string {
  return (
    Math.random().toString(36).slice(2) +
    Math.random().toString(36).slice(2) +
    Math.random().toString(36).slice(2)
  );
}

// ---------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------

async function handleLogin(req: Request, clientIp: string): Promise<Response> {
  const gate = checkLoginAllowed(clientIp);
  if (!gate.allowed) {
    return json(
      { error: "too many attempts", retryAfterSeconds: gate.retryAfterSeconds },
      429,
      { "Retry-After": String(gate.retryAfterSeconds ?? 900) },
    );
  }

  let body: { password?: string; totp?: string; rememberMe?: boolean };
  try {
    body = (await req.json()) as {
      password?: string;
      totp?: string;
      rememberMe?: boolean;
    };
  } catch {
    return json({ error: "invalid body" }, 400);
  }
  const rememberMe = body.rememberMe === true;

  // Step 1 — password
  if (!body.password || !verifyAdminPassword(body.password)) {
    recordLoginFailure(clientIp);
    log.warn({ clientIp }, "admin login: invalid password");
    return unauthorized();
  }

  // First-time setup: no TOTP secret persisted yet.
  if (!totpEnrolled()) {
    gcPendingSetups();
    const { base32 } = generateTotpSecret();
    const setupToken = randomSetupToken();
    pendingSetups.set(setupToken, {
      secretBase32: base32,
      createdAt: Date.now(),
    });
    const otpauthUri = buildOtpauthUri({
      issuer: "Jacarenda Labs",
      account: "admin",
      secretBase32: base32,
    });
    const qrSvg = await QRCode.toString(otpauthUri, {
      type: "svg",
      errorCorrectionLevel: "M",
      margin: 1,
      width: 200,
      color: { dark: "#0a0a0a", light: "#ffffff" },
    });
    log.info({ clientIp }, "admin login: TOTP setup initiated");
    return json({
      setup: {
        setupToken,
        secretBase32: base32,
        otpauthUri,
        qrSvg,
      },
    });
  }

  // Step 2 — TOTP verification
  const secret = loadTotpSecret();
  if (!secret) {
    log.error(
      "admin login: totpEnrolled() true but loadTotpSecret() returned null",
    );
    return json({ error: "admin 2FA not configured correctly" }, 500);
  }
  // Password is valid but no TOTP supplied yet — tell the UI to advance
  // to the 2FA step. Do NOT count this as a failed attempt.
  if (!body.totp) {
    log.info({ clientIp }, "admin login: password ok, TOTP required");
    return json({ needsTotp: true }, 200);
  }
  if (!verifyTotp(secret, body.totp)) {
    recordLoginFailure(clientIp);
    log.warn({ clientIp }, "admin login: invalid TOTP");
    return unauthorized();
  }

  recordLoginSuccess(clientIp);
  log.info({ clientIp, rememberMe }, "admin login: success");
  return json({ success: true }, 200, setSessionCookieHeader(rememberMe));
}

async function handleConfirmTotpSetup(
  req: Request,
  clientIp: string,
): Promise<Response> {
  const gate = checkLoginAllowed(clientIp);
  if (!gate.allowed) {
    return json(
      { error: "too many attempts", retryAfterSeconds: gate.retryAfterSeconds },
      429,
    );
  }
  gcPendingSetups();

  let body: { setupToken?: string; totp?: string; rememberMe?: boolean };
  try {
    body = (await req.json()) as {
      setupToken?: string;
      totp?: string;
      rememberMe?: boolean;
    };
  } catch {
    return json({ error: "invalid body" }, 400);
  }
  if (!body.setupToken || !body.totp) {
    return json({ error: "setupToken and totp required" }, 400);
  }
  const rememberMe = body.rememberMe === true;
  const pending = pendingSetups.get(body.setupToken);
  if (!pending) {
    recordLoginFailure(clientIp);
    return json({ error: "setup expired or invalid" }, 400);
  }
  if (!verifyTotp(pending.secretBase32, body.totp)) {
    recordLoginFailure(clientIp);
    log.warn({ clientIp }, "admin login: TOTP setup confirm failed");
    return unauthorized();
  }

  saveTotpSecret(pending.secretBase32);
  pendingSetups.delete(body.setupToken);
  recordLoginSuccess(clientIp);
  log.info({ clientIp, rememberMe }, "admin login: TOTP enrolled successfully");
  return json({ success: true }, 200, setSessionCookieHeader(rememberMe));
}

function handleLogout(): Response {
  return json({ success: true }, 200, clearSessionCookieHeader());
}

async function handleIntegrationGet(
  config: GatewayConfig,
  channel: Channel,
): Promise<Response> {
  return adminProxyToDaemon(config, "GET", DAEMON_PATH_BY_CHANNEL[channel]);
}

async function handleIntegrationPost(
  config: GatewayConfig,
  channel: Channel,
  req: Request,
): Promise<Response> {
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid body" }, 400);
  }
  return adminProxyToDaemon(
    config,
    "POST",
    DAEMON_PATH_BY_CHANNEL[channel],
    body,
  );
}

async function handleIntegrationDelete(
  config: GatewayConfig,
  channel: Channel,
): Promise<Response> {
  return adminProxyToDaemon(config, "DELETE", DAEMON_PATH_BY_CHANNEL[channel]);
}

/**
 * Build the admin route table. Spliced into the gateway's main route
 * list before the catch-all runtime proxy.
 */
export function createAdminRoutes(config: GatewayConfig): RouteDefinition[] {
  return [
    // SPA entry — always serves dist/index.html (React then takes over).
    {
      path: /^\/admin\/?$/,
      method: "GET",
      auth: "custom",
      handler: () => serveSpaIndex(),
    },
    // Hashed Vite bundle output: dist/assets/<hash>.js|css|map
    {
      path: /^\/admin\/assets\/([A-Za-z0-9._-]+)$/,
      method: "GET",
      auth: "custom",
      handler: (_req, params) => serveSpaFile("assets/" + params[0]),
    },
    // Root-level files the Vite `public/` folder ships (logo-256.png,
    // favicon-256.png, etc.) — simple filename, no subdirs.
    {
      path: /^\/admin\/([A-Za-z0-9._-]+\.(?:png|svg|webp|ico|txt|json))$/,
      method: "GET",
      auth: "custom",
      handler: (_req, params) => serveSpaFile(params[0]),
    },

    // Login / setup / logout
    {
      path: "/admin/api/login",
      method: "POST",
      auth: "custom",
      handler: (req, _params, getClientIp) => handleLogin(req, getClientIp()),
    },
    {
      path: "/admin/api/login/confirm-totp",
      method: "POST",
      auth: "custom",
      handler: (req, _params, getClientIp) =>
        handleConfirmTotpSetup(req, getClientIp()),
    },
    {
      path: "/admin/api/logout",
      method: "POST",
      auth: "custom",
      handler: () => handleLogout(),
    },

    // Integrations — one parameterised route per method, gated by session
    {
      path: /^\/admin\/api\/integrations\/([a-z]+)$/,
      method: "GET",
      auth: "custom",
      handler: (req, params) => {
        if (!requireAdminSession(req)) return unauthorized();
        const channel = params[0];
        if (!isChannel(channel)) return json({ error: "unknown channel" }, 400);
        return handleIntegrationGet(config, channel);
      },
    },
    {
      path: /^\/admin\/api\/integrations\/([a-z]+)$/,
      method: "POST",
      auth: "custom",
      handler: (req, params) => {
        if (!requireAdminSession(req)) return unauthorized();
        const channel = params[0];
        if (!isChannel(channel)) return json({ error: "unknown channel" }, 400);
        return handleIntegrationPost(config, channel, req);
      },
    },
    {
      path: /^\/admin\/api\/integrations\/([a-z]+)$/,
      method: "DELETE",
      auth: "custom",
      handler: (req, params) => {
        if (!requireAdminSession(req)) return unauthorized();
        const channel = params[0];
        if (!isChannel(channel)) return json({ error: "unknown channel" }, 400);
        return handleIntegrationDelete(config, channel);
      },
    },
  ];
}
