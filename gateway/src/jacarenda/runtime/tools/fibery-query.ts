/**
 * fibery.query — read entities from the tenant's Fibery workspace.
 *
 * Credential source: `FIBERY_API_TOKEN` + `FIBERY_WORKSPACE_URL` from
 * gateway Fly secrets. NOT CES-gated today — see
 * docs/RUNTIME_SECURITY.md §1 for the exception + reassess at Phase 3.
 *
 * Read-only → `isMutating: false`. No trust-mode gate; runs in any mode.
 *
 * Response is bounded: max 50 rows, max 30 fields, each field's value
 * stringified to a hard 500 chars so a single malformed Fibery record
 * can't blow the event-log or the LLM context.
 */

import { z } from "zod";

import type { ToolImpl, ToolContext } from "../tool-context.js";
import { ToolExecutionError } from "../tool-context.js";

const inputSchema = z
  .object({
    type: z
      .string()
      .min(1)
      .max(200)
      .describe(
        "Fully qualified Fibery type, e.g. 'Brand/Brand' or 'Marketing/Campaign'.",
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(10)
      .describe("Max rows to return. Hard-capped at 50."),
  })
  .strict();

type FiberyQueryInput = z.infer<typeof inputSchema>;

const MAX_FIELD_CHARS = 500;
const MAX_FIBERY_TIMEOUT_MS = 15_000;

export const fiberyQueryTool: ToolImpl<FiberyQueryInput> = {
  id: "fibery.query",
  isMutating: false,
  inputSchema,
  description:
    "Read entities of a given type from the Fibery workspace. Returns id, name, and public-id for each entity (up to `limit`). Use this to discover what exists in the workspace before acting on it.",
  anthropicInputSchema: {
    type: "object",
    properties: {
      type: {
        type: "string",
        description:
          "Fully qualified Fibery type, e.g. 'Brand/Brand' or 'Marketing/Campaign'.",
      },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 50,
        description: "Max rows to return. Hard-capped at 50.",
      },
    },
    required: ["type"],
    additionalProperties: false,
  },

  async execute(input, _ctx: ToolContext): Promise<unknown> {
    const url = process.env.FIBERY_WORKSPACE_URL;
    const token = process.env.FIBERY_API_TOKEN;
    if (!url || !token) {
      throw new ToolExecutionError(
        "Fibery credentials are not configured.",
        "credential_missing",
      );
    }

    const body = [
      {
        command: "fibery.entity/query",
        args: {
          query: {
            "q/from": input.type,
            "q/select": {
              id: "fibery/id",
              "public-id": "fibery/public-id",
              name: "fibery/name",
            },
            "q/limit": input.limit,
          },
        },
      },
    ];

    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), MAX_FIBERY_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(`${url.replace(/\/$/, "")}/api/commands`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Token ${token}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ToolExecutionError(
        `Fibery request failed: ${msg.slice(0, 200)}`,
        "upstream_failure",
      );
    } finally {
      clearTimeout(to);
    }

    if (!res.ok) {
      throw new ToolExecutionError(
        `Fibery returned HTTP ${res.status}.`,
        "upstream_failure",
      );
    }

    let parsed: unknown;
    try {
      parsed = await res.json();
    } catch {
      throw new ToolExecutionError(
        "Fibery returned a non-JSON response.",
        "upstream_failure",
      );
    }

    // Expected shape: [{ success: true, result: [row, row, ...] }]
    if (
      !Array.isArray(parsed) ||
      parsed.length === 0 ||
      typeof parsed[0] !== "object" ||
      parsed[0] === null ||
      !(parsed[0] as { success?: boolean }).success
    ) {
      throw new ToolExecutionError(
        "Fibery query did not succeed.",
        "upstream_failure",
      );
    }

    const rawRows = (parsed[0] as { result?: unknown }).result;
    if (!Array.isArray(rawRows)) {
      return { rows: [] };
    }

    const rows = rawRows.slice(0, input.limit).map((r) => {
      if (!r || typeof r !== "object") return {};
      const src = r as Record<string, unknown>;
      return {
        id: truncate(String(src["id"] ?? ""), MAX_FIELD_CHARS),
        publicId: truncate(String(src["public-id"] ?? ""), MAX_FIELD_CHARS),
        name: truncate(String(src["name"] ?? ""), MAX_FIELD_CHARS),
      };
    });

    return { rows, count: rows.length, type: input.type };
  },
};

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}
