/**
 * Slack inbound → Personal Assistant router (Phase 2.3c1).
 *
 * Covers the sync "should claim?" predicate and the async run path
 * (happy reply, needs-approval reply, empty-message drop). `runAgent`
 * is mocked so we don't drag the LLM into unit tests.
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

type RunAgentStub = (...args: unknown[]) => Promise<unknown>;
const runAgentMock = mock<RunAgentStub>(async () => ({
  kind: "done" as const,
  run: { id: "r1" },
  responseText: "hello from PA",
}));
// Stub out the full orchestrator surface — bun's mock.module shares the
// module cache across test files, so any other file touching this
// module needs to find both `runAgent` and `resumeAgent` here.
const resumeAgentStubForShared = mock(async () => ({
  kind: "done" as const,
  run: { id: "r-resume" },
  responseText: "ok",
}));
mock.module("../jacarenda/runtime/orchestrator.js", () => ({
  runAgent: runAgentMock,
  resumeAgent: resumeAgentStubForShared,
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
const { createAgent } = await import("../jacarenda/agent-store.js");
const { shouldPersonalAssistantClaim, runPersonalAssistantForSlackEvent } =
  await import("../jacarenda/runtime/slack-inbound.js");

const TEST_DIRS: string[] = [];

async function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), "jacarenda-slack-inbound-"));
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

function buildEvent(overrides?: {
  sourceChannel?: "slack" | "telegram" | "whatsapp" | "email";
  chatType?: string;
  rawType?: string;
  isEdit?: boolean;
  callbackData?: string;
  actorExternalId?: string;
  content?: string;
  threadTs?: string;
  messageTs?: string;
  channel?: string;
}): Parameters<typeof shouldPersonalAssistantClaim>[0] {
  const src = overrides?.sourceChannel ?? "slack";
  return {
    event: {
      version: "v1",
      sourceChannel: src as "slack",
      receivedAt: "2026-04-22T00:00:00Z",
      message: {
        content: overrides?.content ?? "hello",
        conversationExternalId: overrides?.channel ?? "C-DM",
        externalMessageId: "msg-1",
        ...(overrides?.isEdit ? { isEdit: true } : {}),
        ...(overrides?.callbackData
          ? { callbackData: overrides.callbackData }
          : {}),
      },
      actor: {
        actorExternalId: overrides?.actorExternalId ?? "U-user-1",
      },
      source: {
        updateId: "u-1",
        messageId: overrides?.messageTs ?? "1700000000.0001",
        chatType: overrides?.chatType ?? "im",
        ...(overrides?.threadTs ? { threadId: overrides.threadTs } : {}),
      },
      raw: overrides?.rawType ? { type: overrides.rawType } : {},
    } as never,
    routing: {
      assistantId: "a1",
    } as never,
    channel: overrides?.channel ?? "C-DM",
    threadTs: overrides?.threadTs,
  };
}

let originalFetch: typeof fetch;

beforeEach(() => {
  originalFetch = global.fetch;
  runAgentMock.mockClear();
  readCredentialMock.mockClear();
  readCredentialMock.mockImplementation(async () => "xoxb-test-bot-token");
});

afterEach(() => {
  global.fetch = originalFetch;
  delete process.env.JACARENDA_SLACK_DEFAULT_AGENT_ID;
});

describe("shouldPersonalAssistantClaim", () => {
  test("returns false when env var is unset", () => {
    expect(shouldPersonalAssistantClaim(buildEvent())).toBe(false);
  });

  test("claims DMs when env var is set", () => {
    process.env.JACARENDA_SLACK_DEFAULT_AGENT_ID = "agent-pa";
    expect(shouldPersonalAssistantClaim(buildEvent({ chatType: "im" }))).toBe(
      true,
    );
  });

  test("claims @mentions (app_mention raw type)", () => {
    process.env.JACARENDA_SLACK_DEFAULT_AGENT_ID = "agent-pa";
    expect(
      shouldPersonalAssistantClaim(
        buildEvent({ chatType: "channel", rawType: "app_mention" }),
      ),
    ).toBe(true);
  });

  test("passes on plain channel chatter (no mention)", () => {
    process.env.JACARENDA_SLACK_DEFAULT_AGENT_ID = "agent-pa";
    expect(
      shouldPersonalAssistantClaim(
        buildEvent({ chatType: "channel", rawType: "message" }),
      ),
    ).toBe(false);
  });

  test("passes on edits and callback clicks", () => {
    process.env.JACARENDA_SLACK_DEFAULT_AGENT_ID = "agent-pa";
    expect(shouldPersonalAssistantClaim(buildEvent({ isEdit: true }))).toBe(
      false,
    );
    expect(
      shouldPersonalAssistantClaim(buildEvent({ callbackData: "apr:x:y" })),
    ).toBe(false);
  });

  test("passes on non-Slack channels", () => {
    process.env.JACARENDA_SLACK_DEFAULT_AGENT_ID = "agent-pa";
    expect(
      shouldPersonalAssistantClaim(buildEvent({ sourceChannel: "telegram" })),
    ).toBe(false);
  });
});

describe("runPersonalAssistantForSlackEvent", () => {
  test("dispatches runAgent with triggeredBy=channel and thread ts", async () => {
    await freshDb();
    const agent = createAgent({ templateId: "personal-assistant" });
    process.env.JACARENDA_SLACK_DEFAULT_AGENT_ID = agent.id;

    const calls: Array<{ url: string; body: string }> = [];
    global.fetch = mock(async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        body: typeof init?.body === "string" ? init.body : "",
      });
      return new Response(JSON.stringify({ ok: true, ts: "x" }));
    }) as unknown as typeof fetch;

    await runPersonalAssistantForSlackEvent(
      buildEvent({
        chatType: "im",
        content: "what's my week look like?",
        messageTs: "1700000000.0123",
        channel: "D-BOB",
      }),
    );

    expect(runAgentMock).toHaveBeenCalledTimes(1);
    const callArgs = runAgentMock.mock.calls[0] as unknown as unknown[];
    const arg = callArgs?.[0] as Record<string, unknown>;
    expect(arg.agentId).toBe(agent.id);
    expect(arg.triggeredBy).toBe("channel");
    expect(String(arg.triggeredByActor)).toStartWith("slack:");
    expect(arg.slackThreadTs).toBe("D-BOB:1700000000.0123");

    const postCall = calls.find((c) => c.url.includes("chat.postMessage"));
    expect(postCall).toBeDefined();
    const parsed = JSON.parse(postCall!.body) as {
      channel: string;
      thread_ts: string;
      text: string;
    };
    expect(parsed.channel).toBe("D-BOB");
    expect(parsed.thread_ts).toBe("1700000000.0123");
    expect(parsed.text).toBe("hello from PA");
  });

  test("posts an approval-queued affordance on needs_approval outcome", async () => {
    await freshDb();
    const agent = createAgent({ templateId: "personal-assistant" });
    process.env.JACARENDA_SLACK_DEFAULT_AGENT_ID = agent.id;

    runAgentMock.mockImplementationOnce(async () => ({
      kind: "needs_approval" as const,
      run: { id: "r1" },
      approvalId: "a-1",
      question: "Create thing?",
      proposedAction: { toolId: "fibery.create", input: {} },
    }));

    const calls: string[] = [];
    global.fetch = mock(async (_url: string, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? init.body : "";
      calls.push(body);
      return new Response(JSON.stringify({ ok: true }));
    }) as unknown as typeof fetch;

    await runPersonalAssistantForSlackEvent(
      buildEvent({ chatType: "im", content: "save that to fibery" }),
    );

    const approvalNudge = calls.find((b) =>
      b.includes("queued that for your approval"),
    );
    expect(approvalNudge).toBeDefined();
  });

  test("drops empty messages silently (no runAgent call)", async () => {
    await freshDb();
    const agent = createAgent({ templateId: "personal-assistant" });
    process.env.JACARENDA_SLACK_DEFAULT_AGENT_ID = agent.id;

    global.fetch = mock(
      async () => new Response(JSON.stringify({ ok: true })),
    ) as unknown as typeof fetch;

    await runPersonalAssistantForSlackEvent(
      buildEvent({ chatType: "im", content: "   " }),
    );

    expect(runAgentMock).toHaveBeenCalledTimes(0);
  });

  test("does nothing when the configured agent doesn't exist", async () => {
    await freshDb();
    process.env.JACARENDA_SLACK_DEFAULT_AGENT_ID = "agent-that-does-not-exist";

    global.fetch = mock(
      async () => new Response(JSON.stringify({ ok: true })),
    ) as unknown as typeof fetch;

    await runPersonalAssistantForSlackEvent(buildEvent({ chatType: "im" }));

    expect(runAgentMock).toHaveBeenCalledTimes(0);
  });
});

describe("thread continuity", () => {
  test("injects prior run summaries as a preamble on a second message in the same thread", async () => {
    await freshDb();
    const agent = createAgent({ templateId: "personal-assistant" });
    process.env.JACARENDA_SLACK_DEFAULT_AGENT_ID = agent.id;

    // Seed a prior run on this thread via the run-store directly.
    const { startRun, finishRun } =
      await import("../jacarenda/runtime/run-store.js");
    const slackThreadTs = "D-BOB:1700000000.0001";
    const prior = startRun({
      agentId: agent.id,
      tenantId: agent.tenantId,
      triggeredBy: "channel",
      triggeredByActor: "slack:U-old",
      slackThreadTs,
    });
    finishRun({
      runId: prior.id,
      status: "succeeded",
      totalCostCents: 10,
      summary: "Yes — Acme renewed last Tuesday.",
    });

    global.fetch = mock(
      async () => new Response(JSON.stringify({ ok: true })),
    ) as unknown as typeof fetch;

    await runPersonalAssistantForSlackEvent(
      buildEvent({
        chatType: "im",
        content: "remind me what you said about Acme",
        messageTs: "1700000000.0001",
        channel: "D-BOB",
      }),
    );

    expect(runAgentMock).toHaveBeenCalledTimes(1);
    const callArgs = runAgentMock.mock.calls[0] as unknown as unknown[];
    const arg = callArgs?.[0] as Record<string, unknown>;
    const userInput = String(arg.userInput);
    expect(userInput).toContain("Acme renewed last Tuesday");
    expect(userInput).toContain("remind me what you said about Acme");
  });

  test("no preamble when there are no prior runs in the thread", async () => {
    await freshDb();
    const agent = createAgent({ templateId: "personal-assistant" });
    process.env.JACARENDA_SLACK_DEFAULT_AGENT_ID = agent.id;

    global.fetch = mock(
      async () => new Response(JSON.stringify({ ok: true })),
    ) as unknown as typeof fetch;

    await runPersonalAssistantForSlackEvent(
      buildEvent({ chatType: "im", content: "first message", channel: "D-X" }),
    );

    const callArgs = runAgentMock.mock.calls[0] as unknown as unknown[];
    const arg = callArgs?.[0] as Record<string, unknown>;
    expect(String(arg.userInput)).toBe("first message");
  });
});
