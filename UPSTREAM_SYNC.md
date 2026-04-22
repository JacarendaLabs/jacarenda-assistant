# Upstream Sync & Rename Decision Record

This repo is a **fork** of [vellum-ai/vellum-assistant](https://github.com/vellum-ai/vellum-assistant).
We productize it as **Jacarenda Assistant** for Jacarenda Labs (and eventually for a SaaS
aimed at solo consultants). One of our top constraints is **continuing to pull improvements
from upstream** — so the rename is deliberately surgical: only Jacarenda-authored files and
user-facing product strings change, never upstream-bound identifiers.

Read this before renaming anything, before merging from upstream, and before adding new
Jacarenda-specific code. It is the single source of truth for where our fork is allowed
to diverge.

---

## Remotes

- `origin` → `https://github.com/JacarendaLabs/jacarenda-assistant.git` (our fork)
- `upstream` → `https://github.com/vellum-ai/vellum-assistant.git` (read-only; push disabled via `--push DISABLE`)

## Sync process

```bash
git fetch upstream
git checkout main
git merge upstream/main
# resolve conflicts — prefer upstream behaviour, re-apply Jacarenda deltas on top
git push origin main
```

Prefer **merge** over **rebase** so the upstream-integration history stays legible. If
upstream rewrites history, we re-align manually rather than force-pushing.

After every upstream merge, redeploy (`fly deploy`) and smoke-test `/admin` login + Slack
channel integration.

## What MUST stay "vellum" forever (upstream-bound identifiers)

Renaming any of these will break upstream sync, the daemon runtime, JWT auth, the macOS
client, or on-disk state. Treat as read-only:

| Category | Identifier | Why it's locked |
|---|---|---|
| Env var | `VELLUM_WORKSPACE_DIR` | upstream daemon reads it |
| Env var / path | `CES_DATA_ROOT` pointing at `/data/vellum/ces-data` | upstream CES reads it |
| Path | `/root/.vellum`, `/data/vellum`, `~/.vellum/` | upstream `homedir()/.vellum` default layout |
| JWT claim | `iss: "vellum-auth"`, `aud: "vellum-daemon"` | upstream validator checks these literals |
| Metadata prefix | `vellum:*` (migration / credential store keys) | upstream DB migrations + restore logic |
| Upstream source trees | `assistant/`, `cli/`, `meta/`, `credential-executor/`, `clients/` | upstream-owned |
| Upstream docs | `README.md`, `LICENSE`, `assets/banner.png` | upstream-owned |
| Filepath references in docs | e.g. `clients/macos/vellum-assistant/...` | that is upstream's real path |

If a future feature needs to reference one of these by a friendlier name, wrap it in a
Jacarenda-owned abstraction — do **not** rename the upstream identifier itself.

## Jacarenda safe zones (edit freely — no upstream merge conflicts expected)

These files were authored by Jacarenda Labs (commits `969354904`, `47ac8d7dd`, and later).
Upstream has never touched them, so rename + refactor at will:

| Location | Owner |
|---|---|
| `CLAUDE.md` (gitignored by upstream) | Jacarenda |
| `JACARENDA.md` | Jacarenda |
| `DESIGN_SYSTEM.md` | Jacarenda |
| `FIBERY_SETUP.md` | Jacarenda |
| `UPSTREAM_SYNC.md` (this file) | Jacarenda |
| `docs/RUNTIME_SECURITY.md` | Jacarenda |
| `gateway/AGENTS.md` | Jacarenda addition |
| `gateway/admin-ui/` (entire React SPA) | Jacarenda |
| `gateway/src/admin/session.ts`, `totp.ts`, `totp-store.ts`, `rate-limit.ts` | Jacarenda additions |
| `gateway/src/jacarenda/` (entire agent-platform backend incl. `runtime/`) | Jacarenda |
| `gateway/src/__tests__/jacarenda-*.test.ts` | Jacarenda |
| `deploy/` (Dockerfile.combined, entrypoint-combined.sh, fly/, mint-admin-token.ts) | Jacarenda |
| `scripts/setup-fibery-*.py` | Jacarenda |

## Upstream-authored files we've modified (higher merge-conflict risk)

Expect to resolve conflicts manually when upstream updates any of these:

- `gateway/src/admin/routes.ts`
- `gateway/src/admin/daemon-proxy.ts`
- `gateway/src/index.ts`
- `gateway/src/auth/token-service.ts`
- `gateway/package.json`

**Guideline for future diverging changes:** prefer adding new files in the safe zones
over editing upstream files. When we have to touch upstream code, keep the diff minimal
and factored so conflict resolution is obvious.

## Rename (2026-04-22)

- Product renamed from **Vellum Assistant** to **Jacarenda Assistant**.
- GitHub repo renamed: `JacarendaLabs/vellum-assistant` → `JacarendaLabs/jacarenda-assistant` (GitHub auto-redirects the old URL).
- Local directory renamed: `/Users/mccoy/vellum-assistant` → `/Users/mccoy/jacarenda-assistant`.
- Admin UI package renamed: `@vellumai/vellum-admin-ui` → `@jacarendalabs/jacarenda-admin-ui`.
- Fibery Property seed label: `Vellum (assistant.jacarendalabs.com)` → `Jacarenda Assistant (assistant.jacarendalabs.com)`.

### Deferred (do later, or never)

- **Fly app names** (`vellum-gateway`, `vellum-assistant`, `vellum-ces`) and volume names
  (`vellum_workspace`, `vellum_ces_security`, `vellum_ces_data`, `vellum_gateway_security`,
  `vellum_data`). Renaming requires: create new Fly apps, migrate secrets, snapshot+restore
  volumes, update DNS CNAME from `vellum-gateway.fly.dev` → `jacarenda-gateway.fly.dev`.
  High-risk, non-atomic. Only visible in the Fly dashboard — public domain is already
  `assistant.jacarendalabs.com`. Not blocking.
- **Internal container paths** (`/root/.vellum`, `/data/vellum`). Upstream-bound (see table
  above). Users never see these. Leave.

### Why not a full find-and-replace?

The fork has ~20,500 upstream commits and active PRs numbered 27,000+. A wholesale `vellum`
→ `jacarenda` replacement in code would create an enormous diff, make every future upstream
merge a conflict, and break runtime identifiers (JWT claims, env vars, on-disk paths). The
cost of product-name purity inside the codebase is not worth losing upstream sync. We rename
only what users see; upstream keeps its name in the plumbing.
