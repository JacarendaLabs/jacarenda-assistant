/**
 * Agent-run + agent-run-event persistence.
 *
 * All writes go through this module so the orchestrator never touches the
 * schema directly. Keeps the audit-trail shape consistent and makes it
 * trivial to add redaction, redaction metadata, and retention later.
 *
 * Security notes (enforced here, re-enforced in orchestrator):
 * - Every run has tenant_id; never write a run without one.
 * - Event payloads are JSON strings — serialisation happens here, so we
 *   have one chokepoint to add redaction (e.g. stripping API-key-shaped
 *   strings from tool results) before it ever hits disk.
 */

import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";

import { getJacarendaDb } from "../db.js";
import { agentRunEvents, agentRuns, DEFAULT_TENANT_ID } from "../schema.js";

export type RunStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "needs_approval"
  | "cancelled";

export type TriggeredBy = "manual" | "schedule" | "webhook" | "channel";

export type EventKind =
  | "run_started"
  | "llm_call"
  | "llm_response"
  | "tool_call"
  | "tool_result"
  | "approval_required"
  | "approval_resolved"
  | "error"
  | "info"
  | "run_completed";

export interface RunRow {
  id: string;
  agentId: string;
  tenantId: string;
  status: RunStatus;
  triggeredBy: TriggeredBy;
  triggeredByActor: string | null;
  startedAt: number;
  completedAt: number | null;
  totalCostCents: number;
  summary: string;
  pauseStateJson: string | null;
  slackThreadTs: string | null;
}

export interface RunEventRow {
  id: string;
  runId: string;
  ts: number;
  kind: EventKind;
  payload: Record<string, unknown>;
}

export interface StartRunInput {
  agentId: string;
  tenantId?: string;
  triggeredBy: TriggeredBy;
  triggeredByActor?: string;
  /** When set, links the run to a Slack thread for conversation continuity. */
  slackThreadTs?: string;
}

export function startRun(input: StartRunInput): RunRow {
  const now = Date.now();
  const id = randomUUID();
  const row = {
    id,
    agentId: input.agentId,
    tenantId: input.tenantId ?? DEFAULT_TENANT_ID,
    status: "running" as RunStatus,
    triggeredBy: input.triggeredBy,
    triggeredByActor: input.triggeredByActor ?? null,
    startedAt: now,
    completedAt: null as number | null,
    totalCostCents: 0,
    summary: "",
    pauseStateJson: null as string | null,
    slackThreadTs: input.slackThreadTs ?? null,
  };
  getJacarendaDb().insert(agentRuns).values(row).run();
  return row;
}

export interface PauseRunInput {
  runId: string;
  pauseStateJson: string;
  summary: string;
}

/** Pauses the run in needs_approval state. Orchestrator is the only caller. */
export function pauseRun(input: PauseRunInput): RunRow | null {
  getJacarendaDb()
    .update(agentRuns)
    .set({
      status: "needs_approval",
      pauseStateJson: input.pauseStateJson,
      summary: input.summary,
    })
    .where(eq(agentRuns.id, input.runId))
    .run();
  return getRun(input.runId);
}

/** Clears pauseStateJson and transitions a run back to running. Used on resume. */
export function markRunRunning(runId: string): RunRow | null {
  getJacarendaDb()
    .update(agentRuns)
    .set({ status: "running", pauseStateJson: null })
    .where(eq(agentRuns.id, runId))
    .run();
  return getRun(runId);
}

export interface FinishRunInput {
  runId: string;
  status: Extract<RunStatus, "succeeded" | "failed" | "cancelled">;
  totalCostCents: number;
  summary: string;
}

export function finishRun(input: FinishRunInput): RunRow | null {
  const now = Date.now();
  getJacarendaDb()
    .update(agentRuns)
    .set({
      status: input.status,
      completedAt: now,
      totalCostCents: input.totalCostCents,
      summary: input.summary,
    })
    .where(eq(agentRuns.id, input.runId))
    .run();
  return getRun(input.runId);
}

export function getRun(
  runId: string,
  tenantId: string = DEFAULT_TENANT_ID,
): RunRow | null {
  const row = getJacarendaDb()
    .select()
    .from(agentRuns)
    .where(and(eq(agentRuns.id, runId), eq(agentRuns.tenantId, tenantId)))
    .get();
  return row ? (row as RunRow) : null;
}

export function listRunsForAgent(
  agentId: string,
  tenantId: string = DEFAULT_TENANT_ID,
  limit = 20,
): RunRow[] {
  const rows = getJacarendaDb()
    .select()
    .from(agentRuns)
    .where(
      and(eq(agentRuns.agentId, agentId), eq(agentRuns.tenantId, tenantId)),
    )
    .orderBy(desc(agentRuns.startedAt))
    .limit(limit)
    .all();
  return rows as RunRow[];
}

/**
 * Prior runs for a given Slack thread, newest-first. Used by the
 * Personal Assistant to stitch conversation continuity across messages
 * in the same thread (Phase 2.3c1).
 */
export function listRunsForSlackThread(
  slackThreadTs: string,
  tenantId: string = DEFAULT_TENANT_ID,
  limit = 10,
): RunRow[] {
  const rows = getJacarendaDb()
    .select()
    .from(agentRuns)
    .where(
      and(
        eq(agentRuns.slackThreadTs, slackThreadTs),
        eq(agentRuns.tenantId, tenantId),
      ),
    )
    .orderBy(desc(agentRuns.startedAt))
    .limit(limit)
    .all();
  return rows as RunRow[];
}

/** Load a paused run's saved state. Returns null if run isn't paused or state is missing. */
export function loadPauseState<T>(runId: string): T | null {
  const run = getRun(runId);
  if (!run || run.status !== "needs_approval" || !run.pauseStateJson) {
    return null;
  }
  try {
    return JSON.parse(run.pauseStateJson) as T;
  } catch {
    return null;
  }
}

export function appendEvent(
  runId: string,
  kind: EventKind,
  payload: Record<string, unknown>,
): void {
  const id = randomUUID();
  getJacarendaDb()
    .insert(agentRunEvents)
    .values({
      id,
      runId,
      ts: Date.now(),
      kind,
      payloadJson: JSON.stringify(redact(payload)),
    })
    .run();
}

export function listEvents(runId: string): RunEventRow[] {
  const rows = getJacarendaDb()
    .select()
    .from(agentRunEvents)
    .where(eq(agentRunEvents.runId, runId))
    .orderBy(agentRunEvents.ts)
    .all();
  return rows.map((r) => ({
    id: r.id,
    runId: r.runId,
    ts: r.ts,
    kind: r.kind as EventKind,
    payload: safeJson(r.payloadJson),
  }));
}

/**
 * Redaction pass on any payload before it hits disk. Catches credentials
 * that might accidentally leak into logs (e.g. a tool result includes an
 * API key the model tried to echo). Conservative heuristics — false
 * positives are cheap (labelled `[redacted]`), false negatives are not.
 */
function redact(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (typeof v === "string" && looksLikeSecret(v)) {
      out[k] = "[redacted]";
    } else if (
      v &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      v.constructor === Object
    ) {
      out[k] = redact(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function looksLikeSecret(s: string): boolean {
  // Anthropic: sk-ant-…  OpenAI: sk-…  Slack: xoxb-/xoxa-  Twilio: AC…
  return (
    /\bsk-ant-[A-Za-z0-9_-]{20,}/.test(s) ||
    /\bsk-[A-Za-z0-9]{20,}/.test(s) ||
    /\bxox[abps]-[A-Za-z0-9-]{10,}/.test(s) ||
    /\bAC[a-f0-9]{32}\b/.test(s)
  );
}

function safeJson(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
