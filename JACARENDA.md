# Jacarenda Assistant

> Jacarenda Labs' productisation of the open-source
> [vellum-ai/vellum-assistant](https://github.com/vellum-ai/vellum-assistant)
> platform into a multi-tenant AI agent runtime.

**Jacarenda Labs is tenant #1.** The endgame is a SaaS for solo consultants
(advisors, coaches, fractional execs, small agency owners, ~€50 k–500 k ARR)
who need AI leverage but can't hire. One agent per function — marketing,
sales, support, ops, books — all running in Slack / WhatsApp / email.
Target pricing €99–199 / month + LLM overage.

Live URL: [`assistant.jacarendalabs.com/admin`](https://assistant.jacarendalabs.com/admin)

---

## What this fork adds on top of upstream Vellum

Vellum gives us: a personal AI assistant runtime with memory, tools,
identity, and multi-channel delivery. What we've built **additively**
(without modifying upstream code where we can help it):

| Addition | Location |
|---|---|
| Multi-tenant **agent platform** — schema, CRUD, templates, tool registry | `gateway/src/jacarenda/` |
| **Admin command-center SPA** — password + TOTP 2FA, Channels / Agents / Approvals tabs | `gateway/admin-ui/` |
| **Agent creation wizard** — 65-year-old-consultant UX, voice capture via style cards or pasted writing | `gateway/admin-ui/src/components/agents/AgentWizardView.tsx` |
| **Runtime orchestrator** — one-turn LLM calls, Anthropic SDK, redacted audit trail | `gateway/src/jacarenda/runtime/` |
| **Fibery workspace scaffold** — 11 spaces / 38 types / 34 relations as the org knowledge base | `scripts/setup-fibery-marketing.py` |
| **Fly combined deploy** — gateway + assistant daemon + CES in one container | `deploy/` |
| **Design system** (Jacarenda Labs monochrome + Lucide) | `DESIGN_SYSTEM.md` |

## Read these in order

For working on the project (whether you're human or AI):

1. **[`CLAUDE.md`](./CLAUDE.md)** — project-level rules. Design system,
   admin-UI stack, Fibery model, deploy config, agent-platform
   architecture decisions already locked in.
2. **[`UPSTREAM_SYNC.md`](./UPSTREAM_SYNC.md)** — **non-negotiable**. The
   fork relationship, which identifiers must stay `vellum`, which files
   are safe zones, and the sync process. Read before renaming anything
   or editing any upstream file.
3. **[`docs/RUNTIME_SECURITY.md`](./docs/RUNTIME_SECURITY.md)** —
   **non-negotiable** for any agent-runtime work. Eight security
   requirements, each mapped to a concrete enforcement point, plus a
   tool-submission checklist. Every tool added from Phase 2.2 onwards
   must complete this checklist at PR time.
4. **[`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md)** — canonical visual spec
   for every surface.
5. **[`FIBERY_SETUP.md`](./FIBERY_SETUP.md)** — how to stand up the
   Fibery workspace from scratch (spaces, types, relations, seeded
   entities, webhook URLs).

## Roadmap — where we are

**Milestone: Agent platform, self-hosted.** Dogfood on Jacarenda Labs
for 6–12 weeks before onboarding a second tenant.

| Phase | Scope | Status |
|---|---|---|
| 1 | Config only — schema, CRUD API, wizard, detail, approvals scaffold, test-drive stub | ✅ Shipped |
| 2.1a | Runtime orchestrator (non-tool), security policy, live Test drive | ✅ Shipped |
| 2.2 | Tool library — `fibery.query`, `fibery.create`, `slack.post-to-channel`, `slack.dm`. Allowlist + Zod + CES-gated creds | ⏭ Next |
| 2.3 | Approval gate + Slack Block Kit dispatch + callback resume | |
| 2.4 | Scheduler tick loop — weekly / daily triggers | |
| 2.5 | Spend-cap hard enforcement + cost tracking | |
| 3 | Fibery bridge — webhook receiver, `agent_memory` sync (org scope) | |
| 4 | Channel-first ops — WhatsApp / email inline interactions | |
| 5 | Template fanout — CS Triage, Bookkeeper, Sales Nurture, Ops Assistant, etc. | |

## Strategic principles locked in

**Multi-tenant from day 1.** Every table (`agents`, `agent_runs`,
`agent_memory`, `agent_approvals`) has `tenant_id`. Jacarenda Labs is
`tenant-id = "jacarenda-labs"`. The SaaS retrofit is a config change,
not a code rewrite.

**Security is load-bearing, not optional.** Commercial multi-tenant
means a credential leak or cross-tenant break is a product-ending
event. Eight non-negotiable requirements documented in
[`docs/RUNTIME_SECURITY.md`](./docs/RUNTIME_SECURITY.md) gate every
tool addition.

**Upstream sync is load-bearing.** This is a fork of an active
open-source project (~20 500 commits, PRs in the 27 000s). We **do not**
rename internal `vellum:*` identifiers, paths, JWT claims, or env vars —
that would break the daemon runtime and sever upstream merges. Product
renaming is purely at the user-facing + `origin`-owned layers. See
[`UPSTREAM_SYNC.md`](./UPSTREAM_SYNC.md) for the full list of
identifiers that stay `vellum` and why.

**Templates are code-owned, configs are DB-owned.** The Social Media
Manager template lives in `gateway/src/jacarenda/templates.ts`.
Tenants get database-backed instances with personality / rules / tool
overrides — the template is never mutated.

**65-year-old consultant test.** Every creation surface must feel
friendly to a non-technical senior consultant. Wizard over form,
template always pre-fills 80 %, style cards over tone prose, Draft →
Ask → Autopilot trust ladder visible from day one, plain-English errors,
no emoji anywhere.

## Operational

**Repo layout (high level):**

```
jacarenda-assistant/
├── assistant/                # upstream — daemon runtime (DO NOT rename internals)
├── cli/                      # upstream — CLI
├── credential-executor/      # upstream — CES
├── gateway/                  # upstream + Jacarenda additions
│   ├── src/                  # upstream gateway code (we've modified a few files)
│   ├── src/admin/            # Jacarenda — password + TOTP admin auth
│   ├── src/jacarenda/        # Jacarenda — agent-platform backend
│   │   ├── schema.ts         # drizzle tables (agents, runs, events, approvals, memory)
│   │   ├── db.ts             # own sqlite: jacarenda.sqlite
│   │   ├── agent-store.ts    # CRUD + seedIfEmpty
│   │   ├── templates.ts      # code-owned template library
│   │   ├── tools.ts          # tool-spec catalogue
│   │   ├── approval-store.ts # pending approvals read API
│   │   ├── routes.ts         # /admin/api/jacarenda/*
│   │   └── runtime/          # Phase 2 — LLM orchestrator, tools
│   └── admin-ui/             # Jacarenda — React SPA at /admin
├── deploy/                   # Jacarenda — Fly combined container
├── docs/
│   └── RUNTIME_SECURITY.md   # mandatory policy for agent-runtime work
├── scripts/
│   └── setup-fibery-marketing.py  # Fibery workspace scaffold
├── CLAUDE.md                 # project-level agent instructions
├── DESIGN_SYSTEM.md          # visual spec
├── FIBERY_SETUP.md           # Fibery setup guide
├── JACARENDA.md              # this file
└── UPSTREAM_SYNC.md          # fork + sync rules
```

**Deploy:**

```bash
flyctl deploy \
  --config deploy/fly/combined.toml \
  --dockerfile deploy/Dockerfile.combined \
  --remote-only \
  --app vellum-gateway
```

Fly app name stays `vellum-gateway` for upstream-sync compatibility
(rename deferred — only visible in the Fly dashboard; public domain is
already `assistant.jacarendalabs.com`).

**Upstream sync:**

```bash
git fetch upstream
git merge upstream/main
# resolve — prefer upstream behaviour, re-apply Jacarenda deltas on top
flyctl deploy ...   # redeploy + smoke test /admin after every merge
```

Upstream remote is configured as read-only (`git remote set-url --push
upstream DISABLE`). See [`UPSTREAM_SYNC.md`](./UPSTREAM_SYNC.md) for the
full process.

**Live at:** [`https://assistant.jacarendalabs.com/admin`](https://assistant.jacarendalabs.com/admin)
