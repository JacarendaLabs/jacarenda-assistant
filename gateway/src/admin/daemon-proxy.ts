/**
 * Proxies authenticated admin requests to the daemon's /v1/integrations/*
 * endpoints. The browser never handles JWTs — the gateway mints a short-lived
 * daemon JWT per request using the same signing key the daemon verifies with.
 */

import { mintToken } from "../auth/token-service.js";
import type { GatewayConfig } from "../config.js";

const ADMIN_SUB = "actor:admin:integrations-ui";
const TOKEN_TTL_SECONDS = 60;

function mintAdminDaemonToken(): string {
  return mintToken({
    aud: "vellum-daemon",
    sub: ADMIN_SUB,
    scope_profile: "actor_client_v1",
    policy_epoch: 1,
    ttlSeconds: TOKEN_TTL_SECONDS,
  });
}

/** Forward an admin request to a daemon integrations path with a fresh JWT. */
export async function adminProxyToDaemon(
  config: GatewayConfig,
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown,
): Promise<Response> {
  const upstream = `${config.assistantRuntimeBaseUrl}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${mintAdminDaemonToken()}`,
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(upstream, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const resBody = await res.text();
  return new Response(resBody, {
    status: res.status,
    headers: {
      "Content-Type": res.headers.get("content-type") ?? "application/json",
    },
  });
}
