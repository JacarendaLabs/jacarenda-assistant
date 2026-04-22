#!/usr/bin/env bun
/**
 * Mint a short-lived admin JWT for authenticating against the assistant
 * daemon HTTP API (Jacarenda Assistant — upstream identifiers below keep
 * the `vellum` prefix for runtime compatibility; see UPSTREAM_SYNC.md).
 *
 * Use from inside the Fly machine:
 *   flyctl ssh console -a vellum-gateway -C \
 *     "bun run /app/deploy/mint-admin-token.ts"
 *
 * Then use the emitted token as a Bearer:
 *   curl -H "Authorization: Bearer <token>" http://127.0.0.1:3001/...
 *
 * Replaces the DISABLE_HTTP_AUTH + VELLUM_UNSAFE_AUTH_BYPASS bypass used
 * during bootstrap — those env vars must now be removed from Fly secrets.
 *
 * Design:
 *   - Reads the HMAC signing key from disk (same key the daemon uses).
 *     Falls back across the daemon's known lookup paths so this script
 *     stays working if the key location shifts in a future upstream release.
 *   - Mints a JWT with `actor_client_v1` scope profile, which grants
 *     settings.read/write + chat.read/write + the other baseline scopes
 *     needed to POST integration configs.
 *   - TTL defaults to 15 minutes; override with `TOKEN_TTL_SECONDS`.
 */

import { createHmac, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const SIGNING_KEY_CANDIDATES = [
  // Canonical: workspace/deprecated/actor-token-signing-key
  join(
    process.env.VELLUM_WORKSPACE_DIR ?? join(homedir(), ".vellum", "workspace"),
    "deprecated",
    "actor-token-signing-key",
  ),
  // Gateway-side: GATEWAY_SECURITY_DIR/actor-token-signing-key
  ...(process.env.GATEWAY_SECURITY_DIR
    ? [join(process.env.GATEWAY_SECURITY_DIR, "actor-token-signing-key")]
    : []),
  // Legacy: ~/.vellum/protected/actor-token-signing-key
  join(homedir(), ".vellum", "protected", "actor-token-signing-key"),
];

function loadSigningKey(): Buffer {
  for (const path of SIGNING_KEY_CANDIDATES) {
    if (!existsSync(path)) continue;
    const buf = readFileSync(path);
    if (buf.length !== 32) {
      console.error(`signing key at ${path} has wrong length ${buf.length}`);
      continue;
    }
    return buf;
  }
  throw new Error(
    `Signing key not found. Looked in:\n  ${SIGNING_KEY_CANDIDATES.join("\n  ")}`,
  );
}

function base64url(data: Buffer | string): string {
  const buf = typeof data === "string" ? Buffer.from(data, "utf-8") : data;
  return buf.toString("base64url");
}

function mintAdminToken(): string {
  const ttl = Number(process.env.TOKEN_TTL_SECONDS ?? "900");
  const now = Math.floor(Date.now() / 1000);

  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const claims = {
    iss: "vellum-auth",
    aud: "vellum-daemon",
    sub: "actor:admin:mint-admin-token",
    scope_profile: "actor_client_v1",
    exp: now + ttl,
    iat: now,
    // Matches CURRENT_POLICY_EPOCH in
    // assistant/src/runtime/auth/policy.ts — bump this when the daemon
    // constant bumps.
    policy_epoch: 1,
    jti: randomBytes(16).toString("hex"),
  };
  const payload = base64url(JSON.stringify(claims));
  const sig = createHmac("sha256", loadSigningKey())
    .update(`${header}.${payload}`)
    .digest();
  return `${header}.${payload}.${base64url(sig)}`;
}

const token = mintAdminToken();
process.stdout.write(token);
if (process.stdout.isTTY) process.stdout.write("\n");
