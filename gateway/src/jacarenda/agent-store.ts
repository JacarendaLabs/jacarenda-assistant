/**
 * Agent CRUD helpers — the only module that talks to the agents table
 * directly. Routes import from here, never from schema.
 */

import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";

import { getJacarendaDb } from "./db.js";
import { agents, DEFAULT_TENANT_ID } from "./schema.js";
import { getTemplate } from "./templates.js";

export interface Agent {
  id: string;
  tenantId: string;
  templateId: string;
  name: string;
  description: string;
  personality: string;
  rules: string;
  toolAllowlist: string[];
  trustMode: "draft" | "ask" | "autopilot";
  triggerConfig: Record<string, unknown>;
  spendCapCents: number;
  status: "active" | "paused" | "archived";
  createdAt: number;
  updatedAt: number;
}

export interface CreateAgentInput {
  tenantId?: string;
  templateId: string;
  name?: string;
  description?: string;
  personality?: string;
  rules?: string;
  toolAllowlist?: string[];
  trustMode?: "draft" | "ask" | "autopilot";
  triggerConfig?: Record<string, unknown>;
  spendCapCents?: number;
  status?: "active" | "paused" | "archived";
}

export type UpdateAgentInput = Partial<Omit<CreateAgentInput, "templateId">>;

type AgentRow = typeof agents.$inferSelect;

function rowToAgent(row: AgentRow): Agent {
  return {
    id: row.id,
    tenantId: row.tenantId,
    templateId: row.templateId,
    name: row.name,
    description: row.description,
    personality: row.personality,
    rules: row.rules,
    toolAllowlist: safeJsonArray(row.toolAllowlistJson),
    trustMode: row.trustMode as Agent["trustMode"],
    triggerConfig: safeJsonObject(row.triggerConfigJson),
    spendCapCents: row.spendCapCents,
    status: row.status as Agent["status"],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function safeJsonArray(s: string): string[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function safeJsonObject(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function listAgents(tenantId: string = DEFAULT_TENANT_ID): Agent[] {
  const rows = getJacarendaDb()
    .select()
    .from(agents)
    .where(eq(agents.tenantId, tenantId))
    .all();
  return rows.map(rowToAgent).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getAgent(
  id: string,
  tenantId: string = DEFAULT_TENANT_ID,
): Agent | null {
  const row = getJacarendaDb()
    .select()
    .from(agents)
    .where(and(eq(agents.id, id), eq(agents.tenantId, tenantId)))
    .get();
  return row ? rowToAgent(row) : null;
}

export function createAgent(input: CreateAgentInput): Agent {
  const template = getTemplate(input.templateId);
  if (!template) {
    throw new Error(`Unknown template: ${input.templateId}`);
  }
  const now = Date.now();
  const id = randomUUID();
  const row: AgentRow = {
    id,
    tenantId: input.tenantId ?? DEFAULT_TENANT_ID,
    templateId: input.templateId,
    name: input.name ?? template.name,
    description: input.description ?? template.description,
    personality: input.personality ?? template.defaultPersonality,
    rules: input.rules ?? template.defaultRules,
    toolAllowlistJson: JSON.stringify(
      input.toolAllowlist ?? template.defaultTools,
    ),
    trustMode: input.trustMode ?? template.defaultTrustMode,
    triggerConfigJson: JSON.stringify(
      input.triggerConfig ?? template.defaultTriggerConfig,
    ),
    spendCapCents: input.spendCapCents ?? template.defaultSpendCapCents,
    status: input.status ?? "active",
    createdAt: now,
    updatedAt: now,
  };
  getJacarendaDb().insert(agents).values(row).run();
  return rowToAgent(row);
}

export function updateAgent(
  id: string,
  input: UpdateAgentInput,
  tenantId: string = DEFAULT_TENANT_ID,
): Agent | null {
  const existing = getAgent(id, tenantId);
  if (!existing) return null;

  const now = Date.now();
  const patch: Partial<AgentRow> = { updatedAt: now };
  if (input.name !== undefined) patch.name = input.name;
  if (input.description !== undefined) patch.description = input.description;
  if (input.personality !== undefined) patch.personality = input.personality;
  if (input.rules !== undefined) patch.rules = input.rules;
  if (input.toolAllowlist !== undefined) {
    patch.toolAllowlistJson = JSON.stringify(input.toolAllowlist);
  }
  if (input.trustMode !== undefined) patch.trustMode = input.trustMode;
  if (input.triggerConfig !== undefined) {
    patch.triggerConfigJson = JSON.stringify(input.triggerConfig);
  }
  if (input.spendCapCents !== undefined) {
    patch.spendCapCents = input.spendCapCents;
  }
  if (input.status !== undefined) patch.status = input.status;

  getJacarendaDb()
    .update(agents)
    .set(patch)
    .where(and(eq(agents.id, id), eq(agents.tenantId, tenantId)))
    .run();

  return getAgent(id, tenantId);
}

export function deleteAgent(
  id: string,
  tenantId: string = DEFAULT_TENANT_ID,
): boolean {
  const existing = getAgent(id, tenantId);
  if (!existing) return false;
  getJacarendaDb()
    .delete(agents)
    .where(and(eq(agents.id, id), eq(agents.tenantId, tenantId)))
    .run();
  return true;
}

/**
 * Idempotent seed: if the tenant has zero agents, create one instance
 * of each template so the admin UI shows something meaningful on a
 * fresh install. Safe to call on every startup.
 */
export function seedIfEmpty(tenantId: string = DEFAULT_TENANT_ID): void {
  const existing = listAgents(tenantId);
  if (existing.length > 0) return;

  // Seed Social Media Manager as a draft-mode agent — nothing ships
  // until the operator actively flips it on.
  createAgent({
    tenantId,
    templateId: "social-media-manager",
    status: "paused",
    trustMode: "draft",
  });
}

/**
 * Idempotent seed for the Personal Assistant: ensures every tenant has
 * exactly one active PA on startup. Safe to call alongside
 * `seedIfEmpty` — only creates a PA if none of this template exists
 * yet for the tenant.
 *
 * Returns the PA agent (existing or newly created) so the Slack
 * router can resolve it without consulting an env var.
 */
export function ensurePersonalAssistant(
  tenantId: string = DEFAULT_TENANT_ID,
): Agent {
  const existing = listAgents(tenantId).find(
    (a) => a.templateId === "personal-assistant",
  );
  if (existing) return existing;
  return createAgent({
    tenantId,
    templateId: "personal-assistant",
    status: "active",
    trustMode: "draft",
  });
}

/**
 * Look up the canonical Personal Assistant for a tenant. Returns null
 * if none exists — the caller (e.g. the Slack inbound router) should
 * fall through to a passthrough rather than silently creating one
 * mid-request.
 */
export function findPersonalAssistant(
  tenantId: string = DEFAULT_TENANT_ID,
): Agent | null {
  const found = listAgents(tenantId).find(
    (a) => a.templateId === "personal-assistant",
  );
  return found ?? null;
}
