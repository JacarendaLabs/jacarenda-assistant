# Jacarenda Assistant — Fly.io deployment

> Fly app names (`vellum-gateway`, `vellum-assistant`, `vellum-ces`) and volume names
> (`vellum_*`) keep the upstream-fork naming — renaming them requires creating new apps
> and migrating secrets/volumes. Only visible in the Fly dashboard; the public domain
> is `assistant.jacarendalabs.com`. See [`../../UPSTREAM_SYNC.md`](../../UPSTREAM_SYNC.md).

Three-service deployment: a public **gateway**, an internal **assistant** runtime daemon, and an isolated **credential-executor** (CES).

```
Internet
   │
   ▼
[vellum-gateway]  ── public, assistant.jacarendalabs.com, :7830
   │
   ▼  (internal Fly DNS)
[vellum-assistant]  ── private, .internal only, :3001
   │
   ▼  (internal Fly DNS)
[vellum-ces]  ── private, .internal only, :8090
```

## Prerequisites

- `flyctl` installed and authenticated (`flyctl auth login`)
- Org access to the Fly org you're deploying into
- Anthropic (or OpenAI / Gemini) API key
- `jacarendalabs.com` DNS access (Vercel DNS — manage with `vercel dns ...`)

## First-time deploy

```bash
cd /Users/mccoy/jacarenda-assistant

# 1. Create the apps (no deploy yet)
flyctl apps create vellum-gateway   --org jacarenda-labs
flyctl apps create vellum-assistant --org jacarenda-labs
flyctl apps create vellum-ces       --org jacarenda-labs

# 2. Create volumes (one per app, in primary region)
flyctl volumes create vellum_workspace        -a vellum-assistant -r lhr -s 10
flyctl volumes create vellum_ces_security     -a vellum-ces       -r lhr -s 1
flyctl volumes create vellum_ces_data         -a vellum-ces       -r lhr -s 1
flyctl volumes create vellum_gateway_security -a vellum-gateway   -r lhr -s 1

# 3. Set secrets (assistant needs the LLM key; gateway needs JWT keys)
flyctl secrets set -a vellum-assistant \
  ANTHROPIC_API_KEY="sk-ant-..."

# 4. Deploy in dependency order: CES → assistant → gateway
flyctl deploy --config deploy/fly/ces.toml        --remote-only
flyctl deploy --config deploy/fly/assistant.toml  --remote-only
flyctl deploy --config deploy/fly/gateway.toml    --remote-only

# 5. Attach custom domain
flyctl certs add -a vellum-gateway assistant.jacarendalabs.com
# then add CNAME in Vercel DNS:
#   vercel dns add jacarendalabs.com assistant CNAME vellum-gateway.fly.dev
```

## Ongoing operations

```bash
flyctl status -a vellum-gateway
flyctl logs   -a vellum-assistant
flyctl ssh console -a vellum-assistant
flyctl secrets list -a vellum-assistant
```

## What each config does

| File | App | Public | Volume | Memory |
|------|-----|--------|--------|--------|
| `gateway.toml` | `vellum-gateway` | ✅ :7830 → :443 | `vellum_gateway_security` → `/security` | 512 MB |
| `assistant.toml` | `vellum-assistant` | ❌ internal only | `vellum_workspace` → `/workspace` (10 GB) | 2 GB |
| `ces.toml` | `vellum-ces` | ❌ internal only | `vellum_ces_security` + `vellum_ces_data` | 512 MB |

## Ports

- Gateway binds `:7830` (`GATEWAY_PORT`) — exposed publicly as `:443` via `[http_service]`.
- Assistant binds `:3001` (`RUNTIME_HTTP_PORT`, matching `assistant/Dockerfile` EXPOSE).
- CES binds `:8090` (`CES_HEALTH_PORT`, matching `credential-executor/Dockerfile` EXPOSE).
