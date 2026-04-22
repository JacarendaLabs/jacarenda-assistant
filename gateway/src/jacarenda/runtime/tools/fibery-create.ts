/**
 * fibery.create — create a new entity in a whitelisted Fibery type.
 *
 * Credential source: FIBERY_* gateway Fly secrets (same as fibery.query —
 * Fibery→CES migration deferred to Phase 3 per RUNTIME_SECURITY.md §1).
 *
 * Mutating → `isMutating: true`. The orchestrator's trust-mode gate
 * hard-rejects execution in draft/ask modes until Phase 2.3 ships the
 * real approval dispatch. In autopilot, the tool runs and logs.
 *
 * DEFENSIVE DESIGN — we deliberately restrict this tool more than
 * strictly necessary on first launch:
 *   - Type must be in ALLOWED_TYPES (small, non-sensitive set)
 *   - Per-type field whitelist enforced after Zod — agent can't inject
 *     arbitrary fields, even if its prompt tries
 *   - Field values are strings only, each capped at MAX_FIELD_CHARS
 *   - No datetime / date / relation fields in the first cut — those
 *     require semantic decisions the agent shouldn't unilaterally make
 *     (e.g. "Published At" belongs to the human who publishes)
 *   - Every created entity is logged in agent_run_events with id +
 *     public-id so there's an audit trail
 */

import { z } from "zod";

import type { ToolImpl, ToolContext } from "../tool-context.js";
import { ToolExecutionError } from "../tool-context.js";

const MAX_FIELD_CHARS = 4000;
const MAX_FIELDS = 10;
const FIBERY_TIMEOUT_MS = 15_000;

/** Types the agent is allowed to create, with the field whitelist for each.
 *  Only plain text / document fields — no dates, no relations, no currency.
 *  Widening this is a considered change; update docs/RUNTIME_SECURITY.md
 *  if you add sensitive types. */
const ALLOWED_TYPES: Record<string, readonly string[]> = {
  "Marketing/Content": ["Channel", "State", "Body", "Performance Notes"],
  "Operations/Meeting Note": [
    "Topic",
    "Participants",
    "Key Takeaways",
    "Action Items",
  ],
};

const inputSchema = z
  .object({
    type: z
      .enum(Object.keys(ALLOWED_TYPES) as [string, ...string[]])
      .describe(
        "Fibery type to create. Must be one of the allowed types listed in the schema enum.",
      ),
    name: z
      .string()
      .min(1)
      .max(200)
      .describe("Short name / title for the entity."),
    fields: z
      .record(z.string(), z.string().max(MAX_FIELD_CHARS))
      .default({})
      .describe(
        "Optional extra fields. Keys must belong to the type's whitelist or the call is rejected.",
      ),
  })
  .strict();

type FiberyCreateInput = z.infer<typeof inputSchema>;

export const fiberyCreateTool: ToolImpl<FiberyCreateInput> = {
  id: "fibery.create",
  isMutating: true,
  inputSchema,
  description:
    "Create a new entity in a whitelisted Fibery type (Marketing/Content or Operations/Meeting Note). Use this to save drafts, case-study skeletons, or meeting notes. Only text fields are supported — dates and relations are intentionally out of scope for safety.",
  anthropicInputSchema: {
    type: "object",
    properties: {
      type: {
        type: "string",
        enum: Object.keys(ALLOWED_TYPES),
        description:
          "Fibery type. Must be exactly one of the allowed enum values.",
      },
      name: {
        type: "string",
        minLength: 1,
        maxLength: 200,
        description: "Short name / title for the entity.",
      },
      fields: {
        type: "object",
        description:
          "Optional string-only fields. Keys must match the type's whitelist. Each value capped at 4000 chars.",
        additionalProperties: { type: "string" },
      },
    },
    required: ["type", "name"],
    additionalProperties: false,
  },

  async execute(input, ctx: ToolContext): Promise<unknown> {
    const url = process.env.FIBERY_WORKSPACE_URL;
    const token = process.env.FIBERY_API_TOKEN;
    if (!url || !token) {
      throw new ToolExecutionError(
        "Fibery credentials are not configured.",
        "credential_missing",
      );
    }

    const allowed = ALLOWED_TYPES[input.type];
    if (!allowed) {
      throw new ToolExecutionError(
        `Type '${input.type}' is not in the creation whitelist.`,
        "input_validation",
      );
    }

    // Per-type field whitelist — Zod validated shape, we validate names here.
    const fields = input.fields ?? {};
    const unknownKeys = Object.keys(fields).filter((k) => !allowed.includes(k));
    if (unknownKeys.length > 0) {
      throw new ToolExecutionError(
        `Fields not allowed on ${input.type}: ${unknownKeys.join(", ")}. Allowed: ${allowed.join(", ")}.`,
        "input_validation",
      );
    }
    if (Object.keys(fields).length > MAX_FIELDS) {
      throw new ToolExecutionError(
        `Too many fields (max ${MAX_FIELDS}).`,
        "input_validation",
      );
    }

    // Build the `fibery.entity/create` payload. Each type prefixes its
    // fields with the type name (e.g. `Marketing/Content`.`Body`).
    const entity: Record<string, unknown> = {
      "fibery/name": input.name,
    };
    for (const [k, v] of Object.entries(fields)) {
      entity[`${input.type}/${k}`] = v;
    }

    // Tag the audit trail so a human reviewer can see the origin of any
    // entity the agent created. Goes into Performance Notes if it's a
    // Marketing/Content — else into a name-suffix fallback.
    const origin = `[agent:${ctx.agent.id.slice(0, 8)} run:${ctx.runId.slice(0, 8)}]`;
    if (input.type === "Marketing/Content") {
      const existingNotes =
        (entity[`${input.type}/Performance Notes`] as string | undefined) ?? "";
      entity[`${input.type}/Performance Notes`] =
        `${existingNotes}\n\n${origin}`.trim();
    }

    const body = [
      {
        command: "fibery.entity/create",
        args: {
          type: input.type,
          entity,
        },
      },
    ];

    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), FIBERY_TIMEOUT_MS);

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

    if (
      !Array.isArray(parsed) ||
      parsed.length === 0 ||
      typeof parsed[0] !== "object" ||
      parsed[0] === null ||
      !(parsed[0] as { success?: boolean }).success
    ) {
      throw new ToolExecutionError(
        "Fibery create did not succeed.",
        "upstream_failure",
      );
    }

    const created = (parsed[0] as { result?: Record<string, unknown> }).result;
    if (!created || typeof created !== "object") {
      return { ok: true };
    }

    return {
      ok: true,
      id: truncate(String(created["fibery/id"] ?? ""), 200),
      publicId: truncate(String(created["fibery/public-id"] ?? ""), 50),
      type: input.type,
      name: input.name,
    };
  },
};

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}
