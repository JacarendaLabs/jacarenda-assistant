/**
 * Approval store + pause/resume store primitives — Phase 2.3a foundation.
 *
 * Tests the write path we just added: createApproval, decideApproval
 * idempotency, getApproval round-trips, and the run-store
 * pauseRun / loadPauseState / markRunRunning triple.
 */

import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  __resetJacarendaDbForTests,
  initJacarendaDb,
} from "../jacarenda/db.js";
import {
  ApprovalAlreadyDecidedError,
  createApproval,
  decideApproval,
  getApproval,
  listPendingApprovals,
} from "../jacarenda/approval-store.js";
import {
  loadPauseState,
  markRunRunning,
  pauseRun,
  startRun,
} from "../jacarenda/runtime/run-store.js";
import { createAgent } from "../jacarenda/agent-store.js";

const TEST_DIRS: string[] = [];

async function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), "jacarenda-approval-"));
  TEST_DIRS.push(dir);
  process.env.GATEWAY_SECURITY_DIR = dir;
  __resetJacarendaDbForTests();
  await initJacarendaDb();
}

afterAll(() => {
  for (const d of TEST_DIRS) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
});

async function seedAgentAndRun() {
  const agent = createAgent({ templateId: "social-media-manager" });
  const run = startRun({
    agentId: agent.id,
    tenantId: agent.tenantId,
    triggeredBy: "manual",
    triggeredByActor: "admin",
  });
  return { agent, run };
}

describe("approval store — write path", () => {
  test("createApproval persists a pending row visible via listPendingApprovals", async () => {
    await freshDb();
    const { run } = await seedAgentAndRun();
    const a = createApproval({
      runId: run.id,
      channel: "admin_ui",
      question: "Agent wants to create a Marketing/Content entity.",
      proposedAction: {
        toolId: "fibery.create",
        input: { type: "Marketing/Content", name: "Week 14" },
      },
    });
    expect(a.decision).toBe("pending");
    expect(a.channel).toBe("admin_ui");

    const list = listPendingApprovals();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(a.id);
    expect(list[0].proposedAction.toolId).toBe("fibery.create");
  });

  test("decideApproval transitions pending → approved and returns the updated row", async () => {
    await freshDb();
    const { run } = await seedAgentAndRun();
    const a = createApproval({
      runId: run.id,
      channel: "admin_ui",
      question: "q",
      proposedAction: {},
    });

    const updated = decideApproval({
      id: a.id,
      decision: "approved",
      decidedBy: "admin",
    });
    expect(updated.decision).toBe("approved");
    expect(updated.decidedBy).toBe("admin");
    expect(updated.decidedAt).not.toBeNull();

    // No longer appears in pending list
    expect(listPendingApprovals()).toHaveLength(0);
  });

  test("decideApproval throws ApprovalAlreadyDecidedError on second attempt", async () => {
    await freshDb();
    const { run } = await seedAgentAndRun();
    const a = createApproval({
      runId: run.id,
      channel: "admin_ui",
      question: "q",
      proposedAction: {},
    });
    decideApproval({ id: a.id, decision: "approved", decidedBy: "admin" });
    expect(() =>
      decideApproval({ id: a.id, decision: "rejected", decidedBy: "admin" }),
    ).toThrow(ApprovalAlreadyDecidedError);

    // Original decision preserved
    const stored = getApproval(a.id);
    expect(stored?.decision).toBe("approved");
  });

  test("getApproval with wrong tenantId returns null (cross-tenant safety)", async () => {
    await freshDb();
    const { run } = await seedAgentAndRun();
    const a = createApproval({
      runId: run.id,
      channel: "admin_ui",
      question: "q",
      proposedAction: {},
    });
    expect(getApproval(a.id, "other-tenant")).toBeNull();
    expect(getApproval(a.id)).not.toBeNull();
  });
});

describe("run-store — pause / resume round-trip", () => {
  test("pauseRun writes needs_approval + pauseStateJson; loadPauseState round-trips", async () => {
    await freshDb();
    const { run } = await seedAgentAndRun();

    const state = {
      messages: [{ role: "user", content: "hi" }],
      turn: 2,
      totalCostCents: 15,
      pendingToolUseId: "toolu_abc",
      pendingToolImplId: "fibery.create",
      pendingToolInput: { type: "Marketing/Content", name: "x" },
      priorToolResults: [],
      finalText: "drafting…",
    };

    const paused = pauseRun({
      runId: run.id,
      pauseStateJson: JSON.stringify(state),
      summary: "Awaiting approval",
    });
    expect(paused?.status).toBe("needs_approval");
    expect(paused?.summary).toBe("Awaiting approval");

    const loaded = loadPauseState<typeof state>(run.id);
    expect(loaded).not.toBeNull();
    expect(loaded?.turn).toBe(2);
    expect(loaded?.pendingToolImplId).toBe("fibery.create");
  });

  test("loadPauseState returns null when run is not paused", async () => {
    await freshDb();
    const { run } = await seedAgentAndRun();
    // Run is in 'running' state — not paused
    expect(loadPauseState(run.id)).toBeNull();
  });

  test("markRunRunning clears pause state", async () => {
    await freshDb();
    const { run } = await seedAgentAndRun();
    pauseRun({
      runId: run.id,
      pauseStateJson: JSON.stringify({ foo: 1 }),
      summary: "x",
    });
    const resumed = markRunRunning(run.id);
    expect(resumed?.status).toBe("running");
    expect(resumed?.pauseStateJson).toBeNull();
    expect(loadPauseState(run.id)).toBeNull();
  });
});
