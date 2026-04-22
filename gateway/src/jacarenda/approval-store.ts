/**
 * Approvals read + write helpers.
 *
 * Phase 2.3a adds the write path. Approvals are only created by the
 * orchestrator when a mutating tool hits the trust-mode gate, and only
 * decided via the admin-session-gated route or the Slack callback
 * (phase 2.3b). Decision transitions are idempotent — the second
 * decide attempt returns the already-decided row without mutation.
 */

import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";

import { getJacarendaDb } from "./db.js";
import {
  agentApprovals,
  agentRuns,
  agents,
  DEFAULT_TENANT_ID,
} from "./schema.js";

export interface ApprovalWithAgent {
  id: string;
  runId: string;
  agentId: string;
  agentName: string;
  agentTemplateId: string;
  channel: string;
  externalMessageId: string | null;
  slackThreadTs: string | null;
  question: string;
  proposedAction: Record<string, unknown>;
  decision: "pending" | "approved" | "rejected" | "expired";
  decidedBy: string | null;
  decidedAt: number | null;
  createdAt: number;
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

export function listPendingApprovals(
  tenantId: string = DEFAULT_TENANT_ID,
): ApprovalWithAgent[] {
  const rows = getJacarendaDb()
    .select({
      id: agentApprovals.id,
      runId: agentApprovals.runId,
      channel: agentApprovals.channel,
      externalMessageId: agentApprovals.externalMessageId,
      slackThreadTs: agentApprovals.slackThreadTs,
      question: agentApprovals.question,
      proposedActionJson: agentApprovals.proposedActionJson,
      decision: agentApprovals.decision,
      decidedBy: agentApprovals.decidedBy,
      decidedAt: agentApprovals.decidedAt,
      createdAt: agentApprovals.createdAt,
      agentId: agents.id,
      agentName: agents.name,
      agentTemplateId: agents.templateId,
    })
    .from(agentApprovals)
    .innerJoin(agentRuns, eq(agentRuns.id, agentApprovals.runId))
    .innerJoin(agents, eq(agents.id, agentRuns.agentId))
    .where(
      and(
        eq(agentApprovals.tenantId, tenantId),
        eq(agentApprovals.decision, "pending"),
      ),
    )
    .orderBy(desc(agentApprovals.createdAt))
    .all();

  return rows.map((r) => ({
    id: r.id,
    runId: r.runId,
    agentId: r.agentId,
    agentName: r.agentName,
    agentTemplateId: r.agentTemplateId,
    channel: r.channel,
    externalMessageId: r.externalMessageId,
    slackThreadTs: r.slackThreadTs,
    question: r.question,
    proposedAction: safeJsonObject(r.proposedActionJson),
    decision: r.decision as ApprovalWithAgent["decision"],
    decidedBy: r.decidedBy,
    decidedAt: r.decidedAt,
    createdAt: r.createdAt,
  }));
}

/* -------------------------------------------------------------- write path */

export interface ApprovalRow {
  id: string;
  runId: string;
  tenantId: string;
  channel: string;
  externalMessageId: string | null;
  slackThreadTs: string | null;
  question: string;
  proposedActionJson: string;
  decision: "pending" | "approved" | "rejected" | "expired";
  decidedBy: string | null;
  decidedAt: number | null;
  createdAt: number;
}

export interface CreateApprovalInput {
  runId: string;
  tenantId?: string;
  channel: "admin_ui" | "slack" | "whatsapp" | "telegram";
  externalMessageId?: string;
  /**
   * Slack originating thread, in `<channelId>:<threadTs>` form. When
   * present, the dispatcher replies in this thread instead of posting
   * to the global approvals channel. Ignored for non-Slack channels.
   */
  slackThreadTs?: string;
  question: string;
  proposedAction: Record<string, unknown>;
}

export function createApproval(input: CreateApprovalInput): ApprovalRow {
  const id = randomUUID();
  const now = Date.now();
  const row = {
    id,
    runId: input.runId,
    tenantId: input.tenantId ?? DEFAULT_TENANT_ID,
    channel: input.channel,
    externalMessageId: input.externalMessageId ?? null,
    slackThreadTs: input.slackThreadTs ?? null,
    question: input.question,
    proposedActionJson: JSON.stringify(input.proposedAction),
    decision: "pending" as const,
    decidedBy: null as string | null,
    decidedAt: null as number | null,
    createdAt: now,
  };
  getJacarendaDb().insert(agentApprovals).values(row).run();
  return row;
}

export function getApproval(
  id: string,
  tenantId: string = DEFAULT_TENANT_ID,
): ApprovalRow | null {
  const row = getJacarendaDb()
    .select()
    .from(agentApprovals)
    .where(
      and(eq(agentApprovals.id, id), eq(agentApprovals.tenantId, tenantId)),
    )
    .get();
  return row ? (row as ApprovalRow) : null;
}

export type DecisionKind = "approved" | "rejected";

export interface DecideApprovalInput {
  id: string;
  tenantId?: string;
  decision: DecisionKind;
  decidedBy: string;
}

export class ApprovalAlreadyDecidedError extends Error {
  constructor(public readonly currentDecision: string) {
    super(`Approval already decided as '${currentDecision}'.`);
    this.name = "ApprovalAlreadyDecidedError";
  }
}

/**
 * Idempotency-preserving decide. If the approval was already decided
 * (by a prior click or a Slack callback race) we throw — the caller
 * should treat it as a conflict, not silently overwrite.
 */
export function decideApproval(input: DecideApprovalInput): ApprovalRow {
  const tenantId = input.tenantId ?? DEFAULT_TENANT_ID;
  const existing = getApproval(input.id, tenantId);
  if (!existing) {
    throw new Error(`Approval ${input.id} not found.`);
  }
  if (existing.decision !== "pending") {
    throw new ApprovalAlreadyDecidedError(existing.decision);
  }
  const now = Date.now();
  getJacarendaDb()
    .update(agentApprovals)
    .set({
      decision: input.decision,
      decidedBy: input.decidedBy,
      decidedAt: now,
    })
    .where(
      and(
        eq(agentApprovals.id, input.id),
        eq(agentApprovals.tenantId, tenantId),
      ),
    )
    .run();
  const updated = getApproval(input.id, tenantId);
  if (!updated) throw new Error("Decide succeeded but row disappeared.");
  return updated;
}
