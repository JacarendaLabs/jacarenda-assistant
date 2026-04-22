/**
 * Slack outbound approval dispatcher (Phase 2.3b1).
 *
 * Mocks readCredential at the module level so we can drive the
 * channel-configured / token-missing / slack-error matrix without
 * touching real Slack. Also asserts the non-fatal contract — dispatch
 * returns a structured { dispatched, skipReason } rather than throwing.
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";

const readCredentialMock = mock(
  async (_account: string) => "xoxb-test-bot-token",
);
mock.module("../credential-reader.js", () => ({
  readCredential: readCredentialMock,
}));

const { dispatchApprovalToSlack } =
  await import("../jacarenda/runtime/slack-approval-dispatcher.js");
import type { Agent } from "../jacarenda/agent-store.js";

const AGENT: Agent = {
  id: "agent-test-1",
  tenantId: "jacarenda-labs",
  templateId: "social-media-manager",
  name: "Social Media Manager",
  description: "",
  personality: "",
  rules: "",
  toolAllowlist: ["fibery.create"],
  trustMode: "draft",
  triggerConfig: {},
  spendCapCents: 500,
  status: "paused",
  createdAt: 0,
  updatedAt: 0,
};

let originalFetch: typeof fetch;

beforeEach(() => {
  originalFetch = global.fetch;
  readCredentialMock.mockClear();
  readCredentialMock.mockImplementation(async () => "xoxb-test-bot-token");
  delete process.env.JACARENDA_SLACK_APPROVALS_CHANNEL;
});

afterEach(() => {
  global.fetch = originalFetch;
  delete process.env.JACARENDA_SLACK_APPROVALS_CHANNEL;
});

describe("dispatchApprovalToSlack", () => {
  test("skips with 'channel_not_configured' when the env var is unset", async () => {
    const fetchMock = mock(async () => new Response("{}"));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await dispatchApprovalToSlack({
      agent: AGENT,
      approvalId: "approval-1",
      question: "test",
      proposedAction: { toolId: "fibery.create", input: {} },
      publicBaseUrl: "https://assistant.jacarendalabs.com",
    });

    expect(result.dispatched).toBe(false);
    expect(result.skipReason).toBe("channel_not_configured");
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  test("skips with 'token_missing' when Slack bot token isn't configured", async () => {
    process.env.JACARENDA_SLACK_APPROVALS_CHANNEL = "C0123ABCDEF";
    readCredentialMock.mockImplementationOnce(async () => undefined);

    const result = await dispatchApprovalToSlack({
      agent: AGENT,
      approvalId: "approval-1",
      question: "test",
      proposedAction: { toolId: "fibery.create", input: {} },
      publicBaseUrl: "https://assistant.jacarendalabs.com",
    });

    expect(result.dispatched).toBe(false);
    expect(result.skipReason).toBe("token_missing");
  });

  test("happy path — posts chat.postMessage with Block Kit to the configured channel", async () => {
    process.env.JACARENDA_SLACK_APPROVALS_CHANNEL = "C0123ABCDEF";
    let capturedInit: RequestInit | undefined;
    const fetchMock = mock(async (_url: string, init?: RequestInit) => {
      capturedInit = init;
      return new Response(
        JSON.stringify({ ok: true, ts: "1700000000.000100" }),
        { status: 200 },
      );
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await dispatchApprovalToSlack({
      agent: AGENT,
      approvalId: "approval-abc123",
      question:
        'Social Media Manager wants to create a Marketing/Content entity named "Week 14".',
      proposedAction: {
        toolId: "fibery.create",
        input: { type: "Marketing/Content", name: "Week 14" },
      },
      publicBaseUrl: "https://assistant.jacarendalabs.com",
    });

    expect(result.dispatched).toBe(true);
    expect(result.slackTs).toBe("1700000000.000100");

    const body = JSON.parse(String(capturedInit?.body ?? "{}")) as {
      channel: string;
      text: string;
      blocks: Array<{ type: string }>;
    };
    expect(body.channel).toBe("C0123ABCDEF");
    expect(body.text).toContain("Social Media Manager");
    expect(body.blocks.length).toBeGreaterThan(0);
    expect(body.blocks.some((b) => b.type === "header")).toBe(true);
    expect(body.blocks.some((b) => b.type === "actions")).toBe(true);
  });

  test("returns 'slack_error' when Slack API replies ok=false; error message never echoes the token", async () => {
    process.env.JACARENDA_SLACK_APPROVALS_CHANNEL = "C0123ABCDEF";
    const fetchMock = mock(
      async () =>
        new Response(
          JSON.stringify({
            ok: false,
            error:
              "channel_not_found — debug hint: xoxb-test-bot-token in reply",
          }),
          { status: 200 },
        ),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await dispatchApprovalToSlack({
      agent: AGENT,
      approvalId: "approval-1",
      question: "q",
      proposedAction: { toolId: "fibery.create", input: {} },
      publicBaseUrl: "https://assistant.jacarendalabs.com",
    });

    expect(result.dispatched).toBe(false);
    expect(result.skipReason).toBe("slack_error");
    expect(result.error).toContain("channel_not_found");
  });

  test("never throws on network failure — returns a skip result instead", async () => {
    process.env.JACARENDA_SLACK_APPROVALS_CHANNEL = "C0123ABCDEF";
    const fetchMock = mock(async () => {
      throw new Error("ECONNREFUSED");
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await dispatchApprovalToSlack({
      agent: AGENT,
      approvalId: "approval-1",
      question: "q",
      proposedAction: { toolId: "fibery.create", input: {} },
      publicBaseUrl: "https://assistant.jacarendalabs.com",
    });

    expect(result.dispatched).toBe(false);
    expect(result.skipReason).toBe("slack_error");
    expect(result.error).toContain("ECONNREFUSED");
    // Non-fatal contract — caller can handle gracefully
  });

  test("token travels only in Authorization header", async () => {
    process.env.JACARENDA_SLACK_APPROVALS_CHANNEL = "C0123ABCDEF";
    let capturedInit: RequestInit | undefined;
    let capturedUrl: string | undefined;
    const fetchMock = mock(async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return new Response(JSON.stringify({ ok: true, ts: "x" }), {
        status: 200,
      });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await dispatchApprovalToSlack({
      agent: AGENT,
      approvalId: "approval-1",
      question: "q",
      proposedAction: { toolId: "fibery.create", input: {} },
      publicBaseUrl: "https://assistant.jacarendalabs.com",
    });

    expect(capturedUrl).not.toContain("xoxb-test-bot-token");
    const bodyStr =
      typeof capturedInit?.body === "string" ? capturedInit.body : "";
    expect(bodyStr).not.toContain("xoxb-test-bot-token");
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer xoxb-test-bot-token");
  });

  test("posts into the originating thread when slackThreadTs is provided", async () => {
    // Global approvals channel is DIFFERENT from the thread channel — so
    // we can assert the thread wins the routing.
    process.env.JACARENDA_SLACK_APPROVALS_CHANNEL = "C-GLOBAL";
    let capturedInit: RequestInit | undefined;
    const fetchMock = mock(async (_url: string, init?: RequestInit) => {
      capturedInit = init;
      return new Response(JSON.stringify({ ok: true, ts: "x" }), {
        status: 200,
      });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await dispatchApprovalToSlack({
      agent: AGENT,
      approvalId: "approval-thread",
      question: "q",
      proposedAction: { toolId: "fibery.create", input: {} },
      publicBaseUrl: "https://assistant.jacarendalabs.com",
      slackThreadTs: "C-DM123:1700000000.0001",
    });

    const parsed = JSON.parse(String(capturedInit?.body ?? "{}")) as {
      channel: string;
      thread_ts?: string;
    };
    expect(parsed.channel).toBe("C-DM123");
    expect(parsed.thread_ts).toBe("1700000000.0001");
  });

  test("falls back to global channel when thread ref is malformed", async () => {
    process.env.JACARENDA_SLACK_APPROVALS_CHANNEL = "C-GLOBAL";
    let capturedInit: RequestInit | undefined;
    const fetchMock = mock(async (_url: string, init?: RequestInit) => {
      capturedInit = init;
      return new Response(JSON.stringify({ ok: true, ts: "x" }));
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await dispatchApprovalToSlack({
      agent: AGENT,
      approvalId: "approval-mangled",
      question: "q",
      proposedAction: { toolId: "fibery.create", input: {} },
      publicBaseUrl: "https://assistant.jacarendalabs.com",
      slackThreadTs: "not-a-valid-ref",
    });

    const parsed = JSON.parse(String(capturedInit?.body ?? "{}")) as {
      channel: string;
      thread_ts?: string;
    };
    expect(parsed.channel).toBe("C-GLOBAL");
    expect(parsed.thread_ts).toBeUndefined();
  });
});
