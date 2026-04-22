/**
 * Approvals read helpers.
 *
 * Phase 1: no writes (approvals are minted by the runtime in Phase 2).
 * Exposes a typed list so the admin UI can render the queue. Joins
 * agents.name/template_id in so the frontend doesn't need a second
 * round-trip.
 */

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
    question: r.question,
    proposedAction: safeJsonObject(r.proposedActionJson),
    decision: r.decision as ApprovalWithAgent["decision"],
    decidedBy: r.decidedBy,
    decidedAt: r.decidedAt,
    createdAt: r.createdAt,
  }));
}
