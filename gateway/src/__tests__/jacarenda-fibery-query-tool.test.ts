/**
 * Per RUNTIME_SECURITY.md §"Tool submission checklist", every new tool
 * has a test covering:
 *   - input validation rejection
 *   - happy path
 *   - credential-redaction-on-error
 *
 * Fibery API is mocked via global.fetch so we test the tool's logic
 * without hitting the network.
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";

import { fiberyQueryTool } from "../jacarenda/runtime/tools/fibery-query.js";
import { ToolExecutionError } from "../jacarenda/runtime/tool-context.js";
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
    toolAllowlist: ["fibery.query"],
    trustMode: "draft",
    triggerConfig: {},
    spendCapCents: 500,
    status: "paused",
    createdAt: 0,
    updatedAt: 0,
  },
};

let originalFetch: typeof fetch;
let originalUrl: string | undefined;
let originalToken: string | undefined;

beforeEach(() => {
  originalFetch = global.fetch;
  originalUrl = process.env.FIBERY_WORKSPACE_URL;
  originalToken = process.env.FIBERY_API_TOKEN;
  process.env.FIBERY_WORKSPACE_URL = "https://test.fibery.io";
  process.env.FIBERY_API_TOKEN = "test-token-not-a-real-secret";
});

afterEach(() => {
  global.fetch = originalFetch;
  if (originalUrl !== undefined) {
    process.env.FIBERY_WORKSPACE_URL = originalUrl;
  } else {
    delete process.env.FIBERY_WORKSPACE_URL;
  }
  if (originalToken !== undefined) {
    process.env.FIBERY_API_TOKEN = originalToken;
  } else {
    delete process.env.FIBERY_API_TOKEN;
  }
});

describe("fibery.query tool", () => {
  test("has the required ToolImpl shape", () => {
    expect(fiberyQueryTool.id).toBe("fibery.query");
    expect(fiberyQueryTool.isMutating).toBe(false);
    expect(typeof fiberyQueryTool.execute).toBe("function");
    expect(fiberyQueryTool.anthropicInputSchema).toEqual(
      expect.objectContaining({
        type: "object",
        additionalProperties: false,
      }),
    );
  });

  test("input schema rejects missing `type`", () => {
    const parsed = fiberyQueryTool.inputSchema.safeParse({ limit: 10 });
    expect(parsed.success).toBe(false);
  });

  test("input schema rejects limit > 50 (hard cap)", () => {
    const parsed = fiberyQueryTool.inputSchema.safeParse({
      type: "Brand/Brand",
      limit: 100,
    });
    expect(parsed.success).toBe(false);
  });

  test("input schema rejects unknown extra fields (strict)", () => {
    const parsed = fiberyQueryTool.inputSchema.safeParse({
      type: "Brand/Brand",
      sneaky: "extra",
    });
    expect(parsed.success).toBe(false);
  });

  test("input schema applies default limit of 10", () => {
    const parsed = fiberyQueryTool.inputSchema.safeParse({
      type: "Brand/Brand",
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.limit).toBe(10);
  });

  test("happy path — returns normalised rows from Fibery response", async () => {
    const fetchMock = mock(
      async () =>
        new Response(
          JSON.stringify([
            {
              success: true,
              result: [
                {
                  id: "uuid-1",
                  "public-id": "1",
                  name: "Jacarenda Labs",
                },
                {
                  id: "uuid-2",
                  "public-id": "2",
                  name: "Acme Corp",
                },
              ],
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const parsed = fiberyQueryTool.inputSchema.safeParse({
      type: "Brand/Brand",
      limit: 5,
    });
    expect(parsed.success).toBe(true);

    const out = (await fiberyQueryTool.execute(parsed.data!, MOCK_CTX)) as {
      rows: Array<{ id: string; name: string; publicId: string }>;
      count: number;
    };
    expect(out.count).toBe(2);
    expect(out.rows[0].name).toBe("Jacarenda Labs");
    expect(out.rows[1].publicId).toBe("2");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("throws credential_missing when env is absent", async () => {
    delete process.env.FIBERY_WORKSPACE_URL;
    delete process.env.FIBERY_API_TOKEN;
    const parsed = fiberyQueryTool.inputSchema.safeParse({
      type: "Brand/Brand",
    });
    expect(parsed.success).toBe(true);
    try {
      await fiberyQueryTool.execute(parsed.data!, MOCK_CTX);
      throw new Error("expected execute to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ToolExecutionError);
      expect((err as ToolExecutionError).kind).toBe("credential_missing");
    }
  });

  test("throws upstream_failure on non-200 and does NOT echo the token", async () => {
    const fetchMock = mock(
      async () =>
        new Response(
          `fibery 500 — token test-token-not-a-real-secret leaked in body`,
          { status: 500 },
        ),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const parsed = fiberyQueryTool.inputSchema.safeParse({
      type: "Brand/Brand",
    });
    try {
      await fiberyQueryTool.execute(parsed.data!, MOCK_CTX);
      throw new Error("expected execute to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ToolExecutionError);
      expect((err as ToolExecutionError).kind).toBe("upstream_failure");
      expect((err as Error).message).not.toContain(
        "test-token-not-a-real-secret",
      );
    }
  });

  test("sends the token only via the Authorization header, never in body or URL", async () => {
    let capturedInit: RequestInit | undefined;
    let capturedUrl: string | undefined;
    const fetchMock = mock(async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return new Response(JSON.stringify([{ success: true, result: [] }]), {
        status: 200,
      });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const parsed = fiberyQueryTool.inputSchema.safeParse({
      type: "Brand/Brand",
    });
    await fiberyQueryTool.execute(parsed.data!, MOCK_CTX);

    expect(capturedUrl).not.toContain("test-token-not-a-real-secret");
    const bodyStr =
      typeof capturedInit?.body === "string" ? capturedInit.body : "";
    expect(bodyStr).not.toContain("test-token-not-a-real-secret");
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Token test-token-not-a-real-secret");
  });
});
