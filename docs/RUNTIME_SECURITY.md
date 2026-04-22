# Agent Runtime — Security Policy

This document governs the Jacarenda Assistant agent runtime. **No tool may
land in `gateway/src/jacarenda/runtime/tools/` without passing the
checklist at the bottom of this file**, reviewed by the author and
cross-checked before merge.

Security is load-bearing here. Jacarenda Labs is tenant #1 of what will
become a commercial multi-tenant SaaS for solo consultants; a credential
leak or cross-tenant break is a product-ending event. We do not move fast
by taking security shortcuts. Every control below exists because breaking
it has a concrete, identifiable failure mode.

## Threat model

Primary concerns, in order of priority:

1. **Credential exfiltration.** Secrets (Slack tokens, Twilio, Fibery,
   LLM keys) must never be exposed to the LLM, logged, or persisted
   outside their owner (CES for CES-held secrets; Fly secrets for
   gateway-level ones).
2. **Cross-tenant data bleed.** A Jacarenda Labs agent must never read
   or write another tenant's Fibery, Slack, or memory. This matters now
   even with one tenant because the retrofit later is painful.
3. **Prompt-injection-driven tool misuse.** User input, Fibery content,
   email bodies — any untrusted text — reaches the LLM and may try to
   argue the agent into invoking tools it shouldn't, or into mutating
   fields it shouldn't. Defenses must not live in the prompt; they must
   live in code.
4. **Runaway spend.** An infinite tool-call loop could burn thousands of
   cents of LLM tokens. Spend caps are hard-enforced in the orchestrator.
5. **Privilege escalation via approvals.** A compromised approval link
   must not grant the holder the ability to resolve arbitrary approvals
   — each approval is bound to a single run and single actor.

## The eight non-negotiable requirements

Each requirement maps to a specific enforcement point. **If a tool or
runtime change violates one, it is not merged — no exceptions for
demo/milestone pressure.**

### 1. All sensitive credentials flow through CES

- Credentials owned by CES (Slack bot tokens, Twilio, WhatsApp, email
  providers) are **never** read from `process.env` by the runtime.
- Each tool that needs a CES-owned credential resolves it at call time
  via the gateway's existing CES client (`CES_CREDENTIAL_URL` +
  `CES_SERVICE_TOKEN` — see `gateway/CLAUDE.md` "Credential Access in
  Docker Mode").
- The credential is held in a local variable inside the tool function,
  passed to the outbound call, and immediately goes out of scope. Never
  stored in `agent_run_events`, never returned from the tool function,
  never rendered in the UI.
- Exception: `ANTHROPIC_API_KEY` and `FIBERY_API_TOKEN` currently live
  as Fly secrets on the gateway, not CES. This is consistent with
  upstream's placement of `ANTHROPIC_API_KEY`; Fibery is our addition.
  Document this in `UPSTREAM_SYNC.md` and reassess at Phase 3
  (Fibery bridge) whether Fibery creds should migrate to CES.

**Enforced in:** individual tool modules under
`gateway/src/jacarenda/runtime/tools/*.ts`. Each must begin with a comment
declaring the credential source.

### 2. Tool allowlist enforced in code, not prompt

- The orchestrator filters the tool list by the agent's
  `tool_allowlist_json` **before** constructing the Anthropic API
  request. The LLM cannot invoke a tool whose spec it never saw.
- Even if the LLM hallucinates a tool name, the orchestrator's tool-call
  dispatcher rejects any `name` not in the allowlist with a hard error
  logged to `agent_run_events`.

**Enforced in:** `gateway/src/jacarenda/runtime/orchestrator.ts`, in the
tool-dispatch branch (Phase 2.2+).

### 3. Per-tenant scoping on every tool call

- Every tool function takes a `ToolContext` with `tenantId`, `agentId`,
  and `runId`. The tool uses `tenantId` to scope its credential lookup
  and its data access — never a hardcoded URL or token.
- Example: `fibery.query` reads the Fibery workspace URL + token from
  the tenant's config, not a gateway-wide singleton. (Currently single
  tenant; the wiring is nevertheless parameterised so multi-tenant
  is a config change, not a code refactor.)

**Enforced in:** tool module signatures (they must accept `ToolContext`)
and the orchestrator's tool-dispatch code path.

### 4. Zod-validated tool inputs

- Every tool has a Zod schema for its input. LLM-generated JSON is
  parsed through the schema; failure aborts the tool call with a
  validated error surfaced to the LLM (so it can self-correct) and
  logged as an event.
- Schemas are strict — they reject unknown fields, enforce type
  narrowness (e.g. URL fields must `.url()`), and cap string sizes.
- No `z.any()` in tool input schemas, ever. If a field is unclear,
  make it `z.string()` with a length cap, not `z.unknown()`.

**Enforced in:** each tool's `inputSchema` export + the dispatcher's
`schema.safeParse(rawInput)` call in the orchestrator.

### 5. Trust-mode gate in code

- The orchestrator evaluates `agent.trustMode` before executing any
  tool marked `isMutating: true`:
  - `draft`: mutating tools **never execute automatically**. The
    orchestrator writes an `agent_approvals` row, logs
    `approval_required`, and pauses the run (`status=needs_approval`).
  - `ask`: same pause + approval row, plus a channel dispatch (Slack
    Block Kit / WhatsApp interactive). Run resumes on explicit approve.
  - `autopilot`: tool executes, result logged. Rules still apply —
    the LLM's own rule-list is advisory but the allowlist+schema+cap
    enforcements below are not skippable by autopilot.
- Read-only tools (`isMutating: false`) execute in any trust mode
  without approval.

**Enforced in:** orchestrator tool-dispatch + approval-dispatcher module
(Phase 2.3).

### 6. Audit trail in `agent_run_events`

- Every LLM call → `llm_call`/`llm_response` events with token counts,
  stop reason, model, and cost estimate.
- Every tool call → `tool_call` (name + validated input) and
  `tool_result` (sanitised output) events.
- Every approval interaction → `approval_required` and
  `approval_resolved` events with actor and decision.
- Every error → `error` event with a sanitised message (no stack
  traces, no credentials — `run-store.ts` runs a `redact()` pass on
  every payload before write).

**Enforced in:** `gateway/src/jacarenda/runtime/run-store.ts`'s
`appendEvent()`. Never bypass it; never call `db.insert(agentRunEvents)`
directly from tools.

### 7. Output redaction

- `run-store.redact()` runs on every event payload before persistence,
  stripping Anthropic (`sk-ant-…`), OpenAI (`sk-…`), Slack (`xox[abps]-…`),
  and Twilio (`AC…`) credential shapes.
- Tool result payloads are truncated to a hard byte limit (currently
  implicit in the 4-KB-ish event size; Phase 2.2 will codify it).
- UI never renders HTML — React's text interpolation escapes
  everything. Tool outputs that legitimately contain HTML (e.g. email
  drafts) are rendered inside `<pre>` blocks, never `dangerouslySetInnerHTML`.

**Enforced in:** `run-store.ts` + UI review checklist.

### 8. Spend cap enforced in code

- Each run accumulates `totalCostCents` from `llm-client.estimateCostCents()`
  on every LLM round trip.
- The orchestrator checks `totalCostCents > agent.spendCapCents` before
  dispatching the next LLM call. If exceeded: run ends with
  `status=failed`, summary `"spend cap reached"`, logged as `error`.
- Caps are per-run, not per-day — a scheduler can still fire multiple
  runs; per-day/per-tenant caps land in Phase 2.5 with the rest of
  spend tracking.

**Enforced in:** orchestrator's main loop (Phase 2.5; Phase 2.1a logs
cost but does not enforce — only one LLM call per run so runaway cost
is not a 2.1a risk).

## Tool submission checklist

Every new tool must:

- [ ] Live in `gateway/src/jacarenda/runtime/tools/<name>.ts`.
- [ ] Begin with a comment declaring its credential source
      (CES / Fly secret / none).
- [ ] Export `inputSchema` — a strict Zod schema, no `z.any()` or
      `z.unknown()`.
- [ ] Export `isMutating: boolean`.
- [ ] Export an `execute(input, ctx)` function that takes a validated
      input and the `ToolContext`.
- [ ] Never read `process.env` for a CES-owned credential.
- [ ] Return data safe to log — no raw credentials, no other tenants'
      identifiers.
- [ ] Declare a concrete cost estimate (tokens or cents) if non-trivial.
- [ ] Have a test under
      `gateway/src/__tests__/jacarenda-tool-<name>.test.ts` covering:
      input validation rejection, happy path, credential-redaction-on-error.
- [ ] Appear in `TOOLS` registry (`gateway/src/jacarenda/tools.ts`) with
      its `plainEnglish`, `riskTier`, and `category`.
- [ ] Be referenced in a template's `defaultTools` only if its risk
      tier is appropriate for that template.

## What we give up by not extending the daemon

Vellum's upstream has in-house agent-loop hardening — their own
prompt-injection tactics they've tested, tool-sandboxing patterns,
rate-limit heuristics. We deliberately **do not inherit these** (the
merge-conflict cost of extending their agent loop is higher than
rebuilding the pieces we need). This is a conscious trade.

Mitigations:

1. **Read upstream for reference.** When adding a new tool category,
   grep upstream for their equivalent and copy the defensive patterns
   (not the code — that'd fight merges).
2. **Keep the surface small.** Our tool set is narrower by design
   (Social Media Manager first, then CS / Bookkeeper / etc). Narrow
   surface = smaller threat model.
3. **Defense in depth.** The eight requirements above overlap
   intentionally — a prompt injection that slips past one gate
   (e.g. a rule in the system prompt) still hits the next (allowlist
   in code, Zod schema, trust-mode gate, audit log).

## Review cadence

- Every new tool: mandatory walk-through of the checklist above, at
  PR time.
- Every Phase boundary (2.1 → 2.2 → 2.3 → 2.4 → 2.5): a 15-minute
  re-read of this document before starting the next phase. If the
  phase reveals a new threat not covered here, update the document
  **first**, then implement.
- Before onboarding the first non-Jacarenda tenant: a structured
  security review against this document + one external second opinion.

## Phase 2.1a — what is and isn't enforced right now

Phase 2.1a is deliberately tool-free. The security surface is:

- One outbound Anthropic call using `ANTHROPIC_API_KEY` (existing Fly
  secret).
- User input capped at 4000 chars.
- Run + events persisted with redaction pass.
- LLM call wrapped in a 60s timeout.
- Errors sanitised before hitting the UI.

The following are **deferred to their phases** and documented here so
it's visible they're outstanding:

- Tool allowlist enforcement — **2.2**
- Per-tenant tool scoping — **2.2**
- Zod input schemas — **2.2**
- Trust-mode gate for tools — **2.3**
- Slack dispatch for approvals — **2.3**
- Scheduler auth (only the scheduler triggers scheduled runs) — **2.4**
- Spend cap hard enforcement — **2.5**

Each later phase's first task is: "implement the corresponding section
above, before adding features."
