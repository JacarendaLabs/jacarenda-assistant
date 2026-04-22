/**
 * Slack inbound approval interactivity (Phase 2.3b2).
 *
 * Covers the action_id routing contract, idempotent double-click
 * handling, the decide → resume pipeline fan-out, and the fire-and-
 * forget Slack message update. resumeAgent is mocked — its own tests
 * live in the orchestrator suite.
 */

import {
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
  afterAll,
  mock,
} from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const readCredentialMock = mock(
  async (_account: string) => "xoxb-test-bot-token",
);
mock.module("../credential-reader.js", () => ({
  readCredential: readCredentialMock,
}));

const resumeAgentMock = mock(async () => ({
  kind: "done" as const,
  run: { id: "run-1", status: "succeeded" } as unknown,
  responseText: "ok",
}));
mock.module("../jacarenda/runtime/orchestrator.js", () => ({
  resumeAgent: resumeAgentMock,
  RuntimeError: class extends Error {
    constructor(
      msg: string,
      public readonly code: string,
    ) {
      super(msg);
      this.name = "RuntimeError";
    }
  },
}));

const { __resetJacarendaDbForTests, initJacarendaDb } =
  await import("../jacarenda/db.js");
const { createApproval, decideApproval, getApproval } =
  await import("../jacarenda/approval-store.js");
const { createAgent } = await import("../jacarenda/agent-store.js");
const { startRun } = await import("../jacarenda/runtime/run-store.js");
const { handleApprovalBlockAction } =
  await import("../jacarenda/runtime/slack-approval-interactivity.js");
const { APPROVAL_ACTION_APPROVE, APPROVAL_ACTION_REJECT } =
  await import("../jacarenda/runtime/slack-approval-dispatcher.js");

const TEST_DIRS: string[] = [];

async function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), "jacarenda-slack-interactivity-"));
  TEST_DIRS.push(dir);
  process.env.GATEWAY_SECURITY_DIR = dir;
  __resetJacarendaDbForTests();
  await initJacarendaDb();
}

async function seedPendingApproval() {
  const agent = createAgent({ templateId: "social-media-manager" });
  const run = startRun({
    agentId: agent.id,
    tenantId: agent.tenantId,
    triggeredBy: "manual",
    triggeredByActor: "admin",
  });
  const approval = createApproval({
    runId: run.id,
    channel: "slack",
    question: "Post a welcome message to #general?",
    proposedAction: {
      toolId: "slack.post-to-channel",
      input: { channelId: "C0001", text: "hello" },
    },
  });
  return { agent, run, approval };
}

function buildPayload(
  actionId: string,
  value: string | undefined,
  extras?: {
    channel?: string;
    ts?: string;
    userId?: string;
    userName?: string;
  },
): Parameters<typeof handleApprovalBlockAction>[0] {
  return {
    type: "block_actions",
    trigger_id: "trigger-1",
    user: {
      id: extras?.userId ?? "U123",
      username: extras?.userName ?? "alice",
      name: extras?.userName ?? "Alice",
    },
    channel: { id: extras?.channel ?? "C999" },
    message: { ts: extras?.ts ?? "1700000000.0001" },
    actions: [{ action_id: actionId, value, type: "button" }] as Parameters<
      typeof handleApprovalBlockAction
    >[0]["actions"],
  };
}

let originalFetch: typeof fetch;

beforeEach(() => {
  originalFetch = global.fetch;
  resumeAgentMock.mockClear();
  readCredentialMock.mockClear();
  readCredentialMock.mockImplementation(async () => "xoxb-test-bot-token");
});

afterEach(() => {
  global.fetch = originalFetch;
});

afterAll(() => {
  for (const d of TEST_DIRS) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
});

describe("handleApprovalBlockAction — action_id routing", () => {
  test("passthrough for unknown action_ids", async () => {
    await freshDb();
    global.fetch = mock(
      async () => new Response("{}"),
    ) as unknown as typeof fetch;

    const result = await handleApprovalBlockAction(
      buildPayload("some_other_button", "ignored"),
    );

    expect(result).toBe("passthrough");
  });

  test("handled with a no-op when approval id is missing", async () => {
    await freshDb();
    const fetchMock = mock(
      async () => new Response(JSON.stringify({ ok: true })),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await handleApprovalBlockAction(
      buildPayload(APPROVAL_ACTION_APPROVE, undefined),
    );

    expect(result).toBe("handled");
    expect(resumeAgentMock).toHaveBeenCalledTimes(0);
  });

  test("handled with a no-op when approval id is unknown", async () => {
    await freshDb();
    global.fetch = mock(
      async () => new Response(JSON.stringify({ ok: true })),
    ) as unknown as typeof fetch;

    const result = await handleApprovalBlockAction(
      buildPayload(APPROVAL_ACTION_APPROVE, "00000000-does-not-exist"),
    );

    expect(result).toBe("handled");
    expect(resumeAgentMock).toHaveBeenCalledTimes(0);
  });
});

describe("handleApprovalBlockAction — happy path", () => {
  test("approve click flips approval to approved and invokes resumeAgent", async () => {
    await freshDb();
    const { approval } = await seedPendingApproval();
    global.fetch = mock(
      async () => new Response(JSON.stringify({ ok: true })),
    ) as unknown as typeof fetch;

    const result = await handleApprovalBlockAction(
      buildPayload(APPROVAL_ACTION_APPROVE, approval.id),
    );

    expect(result).toBe("handled");

    const row = getApproval(approval.id);
    expect(row?.decision).toBe("approved");
    expect(row?.decidedBy).toContain("slack:");

    // Resume is fired fire-and-forget; flush microtasks so the .then()
    // callback runs before we assert call count.
    await new Promise((r) => setImmediate(r));
    expect(resumeAgentMock).toHaveBeenCalledTimes(1);
    const firstCall = resumeAgentMock.mock.calls[0] as unknown as unknown[];
    expect(firstCall?.[1]).toBe("approved");
  });

  test("reject click flips approval to rejected and invokes resumeAgent with 'rejected'", async () => {
    await freshDb();
    const { approval } = await seedPendingApproval();
    global.fetch = mock(
      async () => new Response(JSON.stringify({ ok: true })),
    ) as unknown as typeof fetch;

    await handleApprovalBlockAction(
      buildPayload(APPROVAL_ACTION_REJECT, approval.id),
    );

    const row = getApproval(approval.id);
    expect(row?.decision).toBe("rejected");

    await new Promise((r) => setImmediate(r));
    expect(resumeAgentMock).toHaveBeenCalledTimes(1);
    const firstCall = resumeAgentMock.mock.calls[0] as unknown as unknown[];
    expect(firstCall?.[1]).toBe("rejected");
  });
});

describe("handleApprovalBlockAction — idempotency", () => {
  test("second click on an already-decided approval does not re-run resumeAgent", async () => {
    await freshDb();
    const { approval } = await seedPendingApproval();

    // Simulate the admin UI decided it first
    decideApproval({
      id: approval.id,
      decision: "approved",
      decidedBy: "admin",
    });

    global.fetch = mock(
      async () => new Response(JSON.stringify({ ok: true })),
    ) as unknown as typeof fetch;

    const result = await handleApprovalBlockAction(
      buildPayload(APPROVAL_ACTION_REJECT, approval.id),
    );

    expect(result).toBe("handled");

    const row = getApproval(approval.id);
    // Original decision preserved — the Slack click was swallowed.
    expect(row?.decision).toBe("approved");
    expect(row?.decidedBy).toBe("admin");

    await new Promise((r) => setImmediate(r));
    expect(resumeAgentMock).toHaveBeenCalledTimes(0);
  });
});

describe("handleApprovalBlockAction — Slack message update", () => {
  test("decoded action posts a chat.update with the terminal tombstone", async () => {
    await freshDb();
    const { approval } = await seedPendingApproval();
    const calls: Array<{ url: string; body: string }> = [];
    global.fetch = mock(async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        body: typeof init?.body === "string" ? init.body : "",
      });
      return new Response(JSON.stringify({ ok: true }));
    }) as unknown as typeof fetch;

    await handleApprovalBlockAction(
      buildPayload(APPROVAL_ACTION_APPROVE, approval.id, {
        channel: "C-APP",
        ts: "1700000000.0042",
        userName: "bob",
      }),
    );

    const updateCall = calls.find((c) => c.url.includes("chat.update"));
    expect(updateCall).toBeDefined();
    const parsed = JSON.parse(updateCall!.body) as {
      channel: string;
      ts: string;
      blocks: unknown[];
    };
    expect(parsed.channel).toBe("C-APP");
    expect(parsed.ts).toBe("1700000000.0042");
    expect(updateCall!.body).toContain("Approved");
    expect(updateCall!.body).toContain("bob");
  });

  test("update failure does not derail the decision", async () => {
    await freshDb();
    const { approval } = await seedPendingApproval();
    global.fetch = mock(async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;

    const result = await handleApprovalBlockAction(
      buildPayload(APPROVAL_ACTION_APPROVE, approval.id),
    );

    expect(result).toBe("handled");
    const row = getApproval(approval.id);
    expect(row?.decision).toBe("approved");
  });
});
