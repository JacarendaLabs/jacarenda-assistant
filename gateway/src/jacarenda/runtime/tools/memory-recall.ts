/**
 * memory.recall — read-only query over the tenant's agent memory.
 *
 * Credential source: none. Reads from `agent_memory` in the local
 * Jacarenda SQLite DB. Tenant-scoped in code; never crosses tenants.
 *
 * Visibility rules (applied in code, not prompt):
 *  - `scope = 'org'` rows are visible to every agent in the tenant.
 *  - `scope = 'private'` rows are visible only when `owner_agent_id`
 *    matches the calling agent. This keeps per-agent notebooks isolated
 *    even when multiple agents share the same tenant's memory table.
 *
 * Response is bounded: max 20 rows, each `content` truncated to 600
 * chars. Agents that need the full text of a memory should use a future
 * `memory.get(id)` tool (not yet shipped). For Phase 2.3c1 the recall
 * surface is deliberately narrow — "what do you remember about X" — not
 * a semantic search.
 */

import { and, desc, eq, like, or, sql } from "drizzle-orm";
import { z } from "zod";

import { getJacarendaDb } from "../../db.js";
import { agentMemory } from "../../schema.js";
import type { ToolImpl, ToolContext } from "../tool-context.js";

const inputSchema = z
  .object({
    query: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .optional()
      .describe(
        "Optional keyword to match against memory content (case-insensitive substring). Omit to see the most recent memories.",
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(20)
      .default(10)
      .describe("Max rows to return. Hard-capped at 20."),
  })
  .strict();

type MemoryRecallInput = z.infer<typeof inputSchema>;

const MAX_CONTENT_CHARS = 600;

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export const memoryRecallTool: ToolImpl<MemoryRecallInput> = {
  id: "memory.recall",
  isMutating: false,
  inputSchema,
  description:
    "Recall memory the agent has about the user, the business, or past conversations. Returns the most recent matching memories (or the most recent overall if no query is given). Use this at the start of a conversation before asking the user to repeat context.",
  anthropicInputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Optional keyword to substring-match against memory content. Case-insensitive.",
      },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 20,
        description: "Max rows to return. Hard-capped at 20.",
      },
    },
    additionalProperties: false,
  },

  async execute(input, ctx: ToolContext): Promise<unknown> {
    const whereClauses = [
      eq(agentMemory.tenantId, ctx.tenantId),
      or(
        eq(agentMemory.scope, "org"),
        and(
          eq(agentMemory.scope, "private"),
          eq(agentMemory.ownerAgentId, ctx.agent.id),
        ),
      ),
    ];

    if (input.query) {
      whereClauses.push(
        like(
          sql`lower(${agentMemory.content})`,
          `%${escapeLike(input.query.toLowerCase())}%`,
        ),
      );
    }

    const rows = getJacarendaDb()
      .select({
        id: agentMemory.id,
        scope: agentMemory.scope,
        source: agentMemory.source,
        content: agentMemory.content,
        createdAt: agentMemory.createdAt,
      })
      .from(agentMemory)
      .where(and(...whereClauses))
      .orderBy(desc(agentMemory.createdAt))
      .limit(input.limit)
      .all();

    return {
      matches: rows.map((r) => ({
        id: r.id,
        scope: r.scope,
        source: r.source,
        createdAt: r.createdAt,
        content: truncate(r.content, MAX_CONTENT_CHARS),
      })),
      total: rows.length,
    };
  },
};
