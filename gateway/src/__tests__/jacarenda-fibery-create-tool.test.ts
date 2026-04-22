/**
 * fibery.create tool — RUNTIME_SECURITY.md submission checklist coverage.
 * Input validation rejection, happy path, credential redaction, type
 * whitelist enforcement, per-type field whitelist enforcement, and
 * token-never-in-body-or-URL.
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";

import { fiberyCreateTool } from "../jacarenda/runtime/tools/fibery-create.js";
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
    toolAllowlist: ["fibery.create"],
    trustMode: "autopilot",
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

describe("fibery.create tool", () => {
  test("has the required ToolImpl shape and is marked mutating", () => {
    expect(fiberyCreateTool.id).toBe("fibery.create");
    expect(fiberyCreateTool.isMutating).toBe(true);
    expect(typeof fiberyCreateTool.execute).toBe("function");
    const schema = fiberyCreateTool.anthropicInputSchema as {
      additionalProperties?: boolean;
      properties?: { type?: { enum?: string[] } };
    };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties?.type?.enum).toEqual(
      expect.arrayContaining(["Marketing/Content", "Operations/Meeting Note"]),
    );
  });

  test("rejects type outside the whitelist via Zod enum", () => {
    const parsed = fiberyCreateTool.inputSchema.safeParse({
      type: "CRM/Company",
      name: "Evil Corp",
    });
    expect(parsed.success).toBe(false);
  });

  test("rejects extra top-level fields (strict)", () => {
    const parsed = fiberyCreateTool.inputSchema.safeParse({
      type: "Marketing/Content",
      name: "A post",
      sneaky: "extra",
    });
    expect(parsed.success).toBe(false);
  });

  test("rejects missing name", () => {
    const parsed = fiberyCreateTool.inputSchema.safeParse({
      type: "Marketing/Content",
    });
    expect(parsed.success).toBe(false);
  });

  test("rejects fields outside the per-type whitelist (execute-time)", async () => {
    const parsed = fiberyCreateTool.inputSchema.safeParse({
      type: "Marketing/Content",
      name: "x",
      fields: { "Not A Real Field": "hi" },
    });
    expect(parsed.success).toBe(true);
    try {
      await fiberyCreateTool.execute(parsed.data!, MOCK_CTX);
      throw new Error("expected execute to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ToolExecutionError);
      expect((err as ToolExecutionError).kind).toBe("input_validation");
    }
  });

  test("happy path — posts to Fibery entity/create and returns id + publicId", async () => {
    let capturedInit: RequestInit | undefined;
    const fetchMock = mock(async (_url: string, init?: RequestInit) => {
      capturedInit = init;
      return new Response(
        JSON.stringify([
          {
            success: true,
            result: {
              "fibery/id": "uuid-99",
              "fibery/public-id": "99",
            },
          },
        ]),
        { status: 200 },
      );
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const parsed = fiberyCreateTool.inputSchema.safeParse({
      type: "Marketing/Content",
      name: "Week 14 SCOPE post",
      fields: {
        Channel: "LinkedIn",
        State: "Draft",
        Body: "Hello world.",
      },
    });
    expect(parsed.success).toBe(true);
    const out = (await fiberyCreateTool.execute(parsed.data!, MOCK_CTX)) as {
      ok: boolean;
      id: string;
      publicId: string;
      type: string;
    };

    expect(out.ok).toBe(true);
    expect(out.id).toBe("uuid-99");
    expect(out.publicId).toBe("99");
    expect(out.type).toBe("Marketing/Content");

    // Body prefixes the type to each field (Fibery command shape)
    const bodyStr = String(capturedInit?.body ?? "");
    expect(bodyStr).toContain(`"Marketing/Content/Body":"Hello world."`);
    expect(bodyStr).toContain(`"fibery/name":"Week 14 SCOPE post"`);
    // Audit origin tag is appended into Performance Notes
    expect(bodyStr).toContain(`[agent:agent-te`);
  });

  test("throws credential_missing when env is absent", async () => {
    delete process.env.FIBERY_WORKSPACE_URL;
    delete process.env.FIBERY_API_TOKEN;
    const parsed = fiberyCreateTool.inputSchema.safeParse({
      type: "Marketing/Content",
      name: "x",
    });
    expect(parsed.success).toBe(true);
    try {
      await fiberyCreateTool.execute(parsed.data!, MOCK_CTX);
      throw new Error("expected execute to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ToolExecutionError);
      expect((err as ToolExecutionError).kind).toBe("credential_missing");
    }
  });

  test("upstream_failure response never echoes the token", async () => {
    const fetchMock = mock(
      async () =>
        new Response(`err — token test-token-not-a-real-secret in body`, {
          status: 500,
        }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const parsed = fiberyCreateTool.inputSchema.safeParse({
      type: "Marketing/Content",
      name: "x",
    });
    try {
      await fiberyCreateTool.execute(parsed.data!, MOCK_CTX);
      throw new Error("expected execute to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ToolExecutionError);
      expect((err as Error).message).not.toContain(
        "test-token-not-a-real-secret",
      );
    }
  });

  test("token travels only via Authorization header", async () => {
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;
    const fetchMock = mock(async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return new Response(
        JSON.stringify([{ success: true, result: { "fibery/id": "x" } }]),
        { status: 200 },
      );
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const parsed = fiberyCreateTool.inputSchema.safeParse({
      type: "Marketing/Content",
      name: "x",
    });
    await fiberyCreateTool.execute(parsed.data!, MOCK_CTX);

    expect(capturedUrl).not.toContain("test-token-not-a-real-secret");
    const bodyStr =
      typeof capturedInit?.body === "string" ? capturedInit.body : "";
    expect(bodyStr).not.toContain("test-token-not-a-real-secret");
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Token test-token-not-a-real-secret");
  });
});
