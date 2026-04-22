# Gateway — Agent Instructions

## Public API / Webhook Ingress

All inbound HTTP endpoints — APIs, webhooks, OAuth callbacks, or any route that receives requests from the internet — **MUST** be routed through the **gateway** (`gateway/`). Never add ingresses, routes, or listeners directly to the daemon runtime (`assistant/`).

Concretely:

- Define new routes in the gateway and have the gateway forward requests to the assistant over the internal HTTP transport.
- The gateway's public URL is controlled by the **public ingress URL** setting. All externally-facing URLs you generate or advertise (callback URLs, webhook registration URLs, etc.) must be derived from this setting — never hardcode a hostname or port.
- The daemon should remain unreachable from the public internet. It only receives traffic from the gateway over the internal network.

Why: the gateway is the single point of ingress, handling TLS termination, auth, rate limiting, and routing. Exposing the daemon directly bypasses these protections and breaks the deployment model.

### Gateway-Only API Consumption

All assistant API requests from clients, CLI, skills, and user-facing tooling **MUST** target gateway URLs. Never construct URLs using the daemon runtime port (`7821`) or `RUNTIME_HTTP_PORT` for external API consumption.

**Exception boundary:** The gateway service itself may call the runtime internally. Tests may use direct runtime URLs for isolated unit/integration scenarios. Intentional local daemon-control paths are exempt:

- `clients/shared/Network/DaemonClient.swift`
- `clients/macos/vellum-assistant/Features/Settings/SettingsConnectTab.swift` (health probe)

**Migration rule:** If a needed endpoint is not available at the gateway, add a gateway route/proxy first, then consume it. Do not work around a missing gateway endpoint by hitting the runtime directly.

**Ban on hardcoded runtime hosts/ports:** Do not embed `localhost:7821`, `127.0.0.1:7821`, or runtime-port-derived URLs in docs, skills, or user-facing guidance. Always reference gateway URLs instead. A CI guard test (`gateway-only-guard.test.ts`) enforces this — any new direct runtime URL reference in production code or skills will fail CI.

**SKILL.md retrieval contract:** For config/status retrieval in bundled skills, use `bash` + canonical CLI surfaces. Start with `assistant config get` for generic config keys and secure credential surfaces (`credential_store`, `assistant keys`) for secrets. Do not use direct gateway `curl` for read-only retrieval paths. Do not use credential store lookup commands (`security find-generic-password`, `secret-tool`) in SKILL.md. `host_bash` is not allowed for Vellum CLI retrieval commands unless a documented exception is intentionally allowlisted.

**SKILL.md proxied outbound pattern:** For outbound third-party API calls from skills that require stored credentials, default to `bash` with `network_mode: "proxied"` and `credential_ids` instead of manual token/credential store plumbing. This keeps credentials out of chat and enforces credential policies consistently.

**SKILL.md gateway URL pattern:** For gateway control-plane writes/actions that are not exposed through a CLI read command, use `$INTERNAL_GATEWAY_BASE_URL` (injected by `bash` and `host_bash`). Do not hardcode `localhost`/ports in skill examples, and do not instruct users/agents to manually export the variable from Settings. For public ingress URLs (e.g. OAuth redirect URIs, webhook registration), use `assistant config get ingress.publicBaseUrl` or load the `public-ingress` skill — do not inject public URLs as environment variables.

### Trust Management in Docker Mode

In Docker mode, the gateway is the sole owner of trust rule storage. Trust files (`trust.json`, `actor-token-signing-key`) live on the gateway security volume (`/gateway-security`), configured via `GATEWAY_SECURITY_DIR`. No other container has access to this volume.

The assistant reads and writes trust rules via the gateway's HTTP trust API instead of accessing the filesystem directly. This ensures the security boundary is enforced at the container level — even if the assistant container is compromised, it cannot tamper with trust rules without going through the gateway's API.

### Credential Access in Docker Mode

In Docker mode, the gateway accesses stored credentials via the CES HTTP API (`CES_CREDENTIAL_URL`), authenticated with `CES_SERVICE_TOKEN`. The gateway does not have direct filesystem access to credential encryption keys (`keys.enc`, `store.key`), which reside on the CES security volume.

### Channel Identity Vocabulary

Gateway inbound events use a channel-discriminated union model (`GatewayInboundEvent`) with explicit identity fields:

- **`conversationExternalId`**: Delivery/conversation address (e.g., Telegram chat ID, phone number). Used for conversation binding and message routing. **Not** used for trust classification.
- **`actorExternalId`**: Sender identity (e.g., Telegram user ID, WhatsApp phone number). Used for trust classification, guardian binding, and ACL enforcement. **Required** for all public channel ingress.
- **"conversation"** is canonical vocabulary for delivery addresses. "thread" is reserved for provider-specific fields (Slack `thread_ts`, email thread IDs).
- **"actor"** is canonical vocabulary for sender identity.

Trust/guardian decisions must be keyed on `actorExternalId` only — never fall back to `conversationExternalId` for actor identity.

Physical DB column names (`externalUserId`, `externalChatId`) are unchanged; the rename is at the API/type layer only.

## Admin UI (`gateway/admin-ui/`)

The admin command-center SPA served at `/admin`:

- **Stack:** Vite + React 18 + TypeScript + Tailwind 3 + shadcn/ui + lucide-react.
- **Design system:** must follow [`DESIGN_SYSTEM.md`](../DESIGN_SYSTEM.md) at repo root — monochrome, Inter, `rounded-md` buttons, `rounded-2xl` cards with `hover-lift`, black `w-14 h-14 rounded-xl` icon tiles. Never roll a new button primitive; extend the shadcn one.
- **Serving:** `gateway/src/admin/routes.ts` → `serveSpaIndex()` at `GET /admin`, `serveSpaFile()` for `/admin/assets/*` (hashed bundles, immutable cache) and root-level public files (logo, favicon).
- **Build:** `cd gateway/admin-ui && bun install && bun run build`. Docker bakes this into the runtime stage in `deploy/Dockerfile.combined`.
- **Adding pages/components:** create under `src/components/` following the signature card pattern. Use the `api()` helper in `src/lib/api.ts` for same-origin `/admin/api/*` calls with session cookies.

### Admin auth

- Login flow: password (+ remember-me) → TOTP (or first-run enrolment with QR + copy-secret). Session cookie is HMAC-signed with the shared `ACTOR_TOKEN_SIGNING_KEY` — the same key the daemon JWTs use, so gateway + daemon verify each other's tokens.
- Per-IP rate limit on `/admin/api/login` (5 fails / 15 min / IP → 15-min lockout).
- Admin-bound API calls to the daemon are proxied via `adminProxyToDaemon()` which mints a fresh `actor_client_v1` JWT with 60s TTL per request.

## Fibery integration

Business state (brand, services, clients, campaigns, invoices, contracts, etc.) lives in Fibery at `jacarendalabs.fibery.io`. Jacarenda Assistant agents read from / write to it via the API. Agent _config_ (soul, guardrails, tools, triggers) stays in the gateway's local DB — do not mirror it into Fibery.

- **Setup script:** `scripts/setup-fibery-marketing.py` — idempotent, re-runnable.
- **Setup guide:** [`FIBERY_SETUP.md`](../FIBERY_SETUP.md) at repo root (prerequisite UI steps + script usage).
- **Credentials:** `FIBERY_WORKSPACE_URL` + `FIBERY_API_TOKEN` stashed as Fly secrets on `vellum-gateway`.
- **Webhook URL:** `POST https://assistant.jacarendalabs.com/webhooks/fibery` — receiver route to be built in agent platform Phase 2.
