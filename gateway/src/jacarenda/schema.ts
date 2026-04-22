/**
 * Jacarenda Assistant — agent platform schema.
 *
 * Stored in a separate SQLite DB (`jacarenda.sqlite` alongside
 * `gateway.sqlite`) so this file can evolve without conflicting with
 * upstream schema changes. See UPSTREAM_SYNC.md.
 *
 * Phase 1 scope: agent config + run log + approvals + memory. No runtime.
 * All identifiers are tenant-scoped from day 1 — Jacarenda Labs is
 * `tenant_id = 'jacarenda-labs'`, SaaS tenants come later.
 */

import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const DEFAULT_TENANT_ID = "jacarenda-labs";

export const agents = sqliteTable(
  "agents",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull().default(DEFAULT_TENANT_ID),
    templateId: text("template_id").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    // Plain-English personality — "Personality" in the UI. Free-form.
    personality: text("personality").notNull().default(""),
    // Plain-English rules / guardrails — "Rules" in the UI.
    rules: text("rules").notNull().default(""),
    // JSON array of tool ids the agent is allowed to call.
    toolAllowlistJson: text("tool_allowlist_json").notNull().default("[]"),
    // draft | ask | autopilot
    trustMode: text("trust_mode").notNull().default("draft"),
    // JSON: schedule spec, webhook filter, channel hooks. Shape refined
    // in phase 2 when runtime reads it.
    triggerConfigJson: text("trigger_config_json").notNull().default("{}"),
    spendCapCents: integer("spend_cap_cents").notNull().default(500),
    // active | paused | archived
    status: text("status").notNull().default("active"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("idx_agents_tenant").on(t.tenantId)],
);

export const agentRuns = sqliteTable(
  "agent_runs",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    tenantId: text("tenant_id").notNull().default(DEFAULT_TENANT_ID),
    // pending | running | succeeded | failed | needs_approval | cancelled
    status: text("status").notNull().default("pending"),
    // manual | schedule | webhook | channel
    triggeredBy: text("triggered_by").notNull().default("manual"),
    triggeredByActor: text("triggered_by_actor"),
    startedAt: integer("started_at").notNull(),
    completedAt: integer("completed_at"),
    totalCostCents: integer("total_cost_cents").notNull().default(0),
    summary: text("summary").notNull().default(""),
    // Serialised loop state when status='needs_approval'. Null otherwise.
    // JSON shape is internal to the orchestrator — callers never parse it.
    pauseStateJson: text("pause_state_json"),
    // Originating Slack thread for channel-triggered runs, in
    // `<channelId>:<threadTs>` form. Used to chain consecutive messages
    // in the same Slack thread as a single conversation (Phase 2.3c1 —
    // thread continuity) and to route approvals back into the thread.
    slackThreadTs: text("slack_thread_ts"),
  },
  (t) => [
    index("idx_agent_runs_agent").on(t.agentId),
    index("idx_agent_runs_tenant_started").on(t.tenantId, t.startedAt),
    index("idx_agent_runs_slack_thread").on(t.slackThreadTs, t.startedAt),
  ],
);

export const agentRunEvents = sqliteTable(
  "agent_run_events",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    ts: integer("ts").notNull(),
    // llm_call | llm_response | tool_call | tool_result | approval_required
    // | approval_resolved | error | info
    kind: text("kind").notNull(),
    payloadJson: text("payload_json").notNull().default("{}"),
  },
  (t) => [index("idx_agent_run_events_run_ts").on(t.runId, t.ts)],
);

export const agentApprovals = sqliteTable(
  "agent_approvals",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    tenantId: text("tenant_id").notNull().default(DEFAULT_TENANT_ID),
    // slack | whatsapp | telegram | admin_ui
    channel: text("channel").notNull(),
    externalMessageId: text("external_message_id"),
    // When the run was triggered from a Slack thread, the dispatcher
    // prefers to reply-in-thread instead of posting to the global
    // approvals channel. Null = no originating thread → global channel.
    // Format: "<channelId>:<threadTs>" for portability across workspaces.
    slackThreadTs: text("slack_thread_ts"),
    question: text("question").notNull(),
    proposedActionJson: text("proposed_action_json").notNull().default("{}"),
    // pending | approved | rejected | expired
    decision: text("decision").notNull().default("pending"),
    decidedBy: text("decided_by"),
    decidedAt: integer("decided_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("idx_agent_approvals_tenant_decision").on(t.tenantId, t.decision),
    index("idx_agent_approvals_run").on(t.runId),
  ],
);

export const agentMemory = sqliteTable(
  "agent_memory",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull().default(DEFAULT_TENANT_ID),
    // null = org-scope memory; non-null = agent-private
    ownerAgentId: text("owner_agent_id").references(() => agents.id, {
      onDelete: "cascade",
    }),
    // private | org
    scope: text("scope").notNull().default("private"),
    // manual | fibery | chat | run
    source: text("source").notNull().default("manual"),
    content: text("content").notNull(),
    // JSON ACL — { readers: string[], writers: string[] } — optional extra
    // restriction on top of scope. Default empty = scope alone governs.
    aclJson: text("acl_json").notNull().default("{}"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("idx_agent_memory_tenant_scope").on(t.tenantId, t.scope),
    index("idx_agent_memory_owner").on(t.ownerAgentId),
  ],
);
