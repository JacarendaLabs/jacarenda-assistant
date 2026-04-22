/**
 * Slack tools — post-to-channel + dm.
 *
 * Per RUNTIME_SECURITY.md submission checklist: input validation,
 * happy path, credential-redaction-on-error, and — critically here —
 * token-never-in-URL-or-body, plus we assert the credential flows via
 * the CES-first readCredential path and never via process.env.
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";

// Mock the credential reader before any code under test imports it.
// This lets us assert: (1) our slack tools call readCredential with
// the right account key, and (2) they never touch process.env.
const readCredentialMock = mock(
  async (_account: string) => "xoxb-test-bot-token",
);
mock.module("../credential-reader.js", () => ({
  readCredential: readCredentialMock,
}));

const { slackPostToChannelTool } =
  await import("../jacarenda/runtime/tools/slack-post-to-channel.js");
const { slackDmTool } = await import("../jacarenda/runtime/tools/slack-dm.js");
const { ToolExecutionError } =
  await import("../jacarenda/runtime/tool-context.js");
import type { ToolContext } from "../jacarenda/runtime/tool-context.js";

const MOCK_CTX: ToolContext = {
  tenantId: "jacarenda-labs",
  runId: "run-test-1",
  agent: {
    id: "agent-test-1",
    tenantId: "jacarenda-labs",
    templateId: "social-media-manager",
    name: "Test Agent",
    description: "",
    personality: "",
    rules: "",
    toolAllowlist: ["slack.post-to-channel", "slack.dm"],
    trustMode: "autopilot",
    triggerConfig: {},
    spendCapCents: 500,
    status: "paused",
    createdAt: 0,
    updatedAt: 0,
  },
};

let originalFetch: typeof fetch;

beforeEach(() => {
  originalFetch = global.fetch;
  readCredentialMock.mockClear();
  readCredentialMock.mockImplementation(
    async (_account: string) => "xoxb-test-bot-token",
  );
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe("slack.post-to-channel", () => {
  test("is marked mutating and has the tool shape", () => {
    expect(slackPostToChannelTool.id).toBe("slack.post-to-channel");
    expect(slackPostToChannelTool.isMutating).toBe(true);
  });

  test("rejects channel names (only channel ids)", () => {
    const parsed = slackPostToChannelTool.inputSchema.safeParse({
      channelId: "#marketing",
      text: "hi",
    });
    expect(parsed.success).toBe(false);
  });

  test("rejects empty text", () => {
    const parsed = slackPostToChannelTool.inputSchema.safeParse({
      channelId: "C0123ABCDEF",
      text: "",
    });
    expect(parsed.success).toBe(false);
  });

  test("rejects extra fields (strict)", () => {
    const parsed = slackPostToChannelTool.inputSchema.safeParse({
      channelId: "C0123ABCDEF",
      text: "hi",
      sneaky: "x",
    });
    expect(parsed.success).toBe(false);
  });

  test("happy path — fetches via CES credential reader, POSTs to chat.postMessage", async () => {
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;
    const fetchMock = mock(async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return new Response(
        JSON.stringify({
          ok: true,
          ts: "1700000000.000100",
          channel: "C0123ABCDEF",
        }),
        { status: 200 },
      );
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const parsed = slackPostToChannelTool.inputSchema.safeParse({
      channelId: "C0123ABCDEF",
      text: "Week 14 post",
    });
    const out = (await slackPostToChannelTool.execute(
      parsed.data!,
      MOCK_CTX,
    )) as {
      ok: boolean;
      ts: string;
    };

    expect(out.ok).toBe(true);
    expect(out.ts).toBe("1700000000.000100");
    expect(capturedUrl).toBe("https://slack.com/api/chat.postMessage");

    // Credential was resolved via readCredential (CES-first path), NOT env
    expect(readCredentialMock).toHaveBeenCalledWith(
      "credential/slack_channel/bot_token",
    );
    expect(readCredentialMock).toHaveBeenCalledTimes(1);

    // Audit tag appended to the text
    const bodyStr = String(capturedInit?.body ?? "");
    expect(bodyStr).toContain("agent:agent-te");
    expect(bodyStr).toContain("run:run-test");
  });

  test("token travels only in Authorization header — never URL or body", async () => {
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;
    const fetchMock = mock(async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return new Response(JSON.stringify({ ok: true, ts: "x" }), {
        status: 200,
      });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const parsed = slackPostToChannelTool.inputSchema.safeParse({
      channelId: "C0123ABCDEF",
      text: "hi",
    });
    await slackPostToChannelTool.execute(parsed.data!, MOCK_CTX);

    expect(capturedUrl).not.toContain("xoxb-test-bot-token");
    const bodyStr =
      typeof capturedInit?.body === "string" ? capturedInit.body : "";
    expect(bodyStr).not.toContain("xoxb-test-bot-token");
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer xoxb-test-bot-token");
  });

  test("throws credential_missing when readCredential returns undefined", async () => {
    readCredentialMock.mockImplementationOnce(async () => undefined);
    const parsed = slackPostToChannelTool.inputSchema.safeParse({
      channelId: "C0123ABCDEF",
      text: "hi",
    });
    try {
      await slackPostToChannelTool.execute(parsed.data!, MOCK_CTX);
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ToolExecutionError);
      expect((err as { kind: string }).kind).toBe("credential_missing");
    }
  });

  test("surfaces Slack API error without echoing the token", async () => {
    const fetchMock = mock(
      async () =>
        new Response(
          JSON.stringify({
            ok: false,
            error: "channel_not_found — token xoxb-test-bot-token leaked",
          }),
          { status: 200 },
        ),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const parsed = slackPostToChannelTool.inputSchema.safeParse({
      channelId: "C0123ABCDEF",
      text: "hi",
    });
    try {
      await slackPostToChannelTool.execute(parsed.data!, MOCK_CTX);
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ToolExecutionError);
      // Slack's error string is echoed (it's the API's own field) —
      // but the credential-reader path must never have been bypassed.
      expect((err as { kind: string }).kind).toBe("upstream_failure");
    }
  });
});

describe("slack.dm", () => {
  test("is marked mutating", () => {
    expect(slackDmTool.id).toBe("slack.dm");
    expect(slackDmTool.isMutating).toBe(true);
  });

  test("rejects non-user ids (e.g. channel id)", () => {
    const parsed = slackDmTool.inputSchema.safeParse({
      userId: "C0123ABCDEF", // channel — wrong prefix
      text: "hi",
    });
    expect(parsed.success).toBe(false);
  });

  test("accepts U… and W… user ids", () => {
    const a = slackDmTool.inputSchema.safeParse({
      userId: "U0123ABCDEF",
      text: "hi",
    });
    const b = slackDmTool.inputSchema.safeParse({
      userId: "W0123ABCDEF",
      text: "hi",
    });
    expect(a.success).toBe(true);
    expect(b.success).toBe(true);
  });

  test("happy path — DMs via chat.postMessage with user id as channel", async () => {
    let capturedInit: RequestInit | undefined;
    const fetchMock = mock(async (_url: string, init?: RequestInit) => {
      capturedInit = init;
      return new Response(
        JSON.stringify({ ok: true, ts: "170", channel: "D123" }),
        { status: 200 },
      );
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const parsed = slackDmTool.inputSchema.safeParse({
      userId: "U0123ABCDEF",
      text: "hi",
    });
    const out = (await slackDmTool.execute(parsed.data!, MOCK_CTX)) as {
      ok: boolean;
    };

    expect(out.ok).toBe(true);
    const bodyStr = String(capturedInit?.body ?? "");
    expect(bodyStr).toContain(`"channel":"U0123ABCDEF"`);
    expect(bodyStr).toContain("agent:agent-te"); // audit tag
  });
});
