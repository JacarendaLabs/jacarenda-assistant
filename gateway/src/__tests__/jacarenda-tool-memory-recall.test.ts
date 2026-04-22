/**
 * memory.recall tool — Phase 2.3c1.
 *
 * Per RUNTIME_SECURITY.md §"Tool submission checklist":
 *   - input validation rejection
 *   - happy path
 *   - scope rules: org visible everywhere, private visible only to owner
 *   - tenant isolation (never cross-tenant reads)
 *   - bounded output (limit, truncation)
 *
 * The tool reads directly from the Jacarenda DB, so each test uses a
 * fresh temp dir + init. No external network mocks required.
 */

import { describe, test, expect, afterAll } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  __resetJacarendaDbForTests,
  getJacarendaDb,
  initJacarendaDb,
} from "../jacarenda/db.js";
import { createAgent } from "../jacarenda/agent-store.js";
import { memoryRecallTool } from "../jacarenda/runtime/tools/memory-recall.js";
import { agentMemory } from "../jacarenda/schema.js";
import type { ToolContext } from "../jacarenda/runtime/tool-context.js";
import type { Agent } from "../jacarenda/agent-store.js";

const TEST_DIRS: string[] = [];

async function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), "jacarenda-memory-recall-"));
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

function seedAgent(templateId = "personal-assistant"): Agent {
  return createAgent({ templateId });
}

function agentWithoutRow(id: string): Agent {
  return {
    id,
    tenantId: "jacarenda-labs",
    templateId: "personal-assistant",
    name: `Agent ${id}`,
    description: "",
    personality: "",
    rules: "",
    toolAllowlist: ["memory.recall"],
    trustMode: "draft",
    triggerConfig: {},
    spendCapCents: 500,
    status: "active",
    createdAt: 0,
    updatedAt: 0,
  };
}

function makeCtx(agent: Agent): ToolContext {
  return { agent, tenantId: agent.tenantId, runId: "run-test" };
}

function insertMemory(row: {
  tenantId?: string;
  ownerAgentId?: string | null;
  scope: "org" | "private";
  source?: string;
  content: string;
  createdAt?: number;
}) {
  getJacarendaDb()
    .insert(agentMemory)
    .values({
      id: randomUUID(),
      tenantId: row.tenantId ?? "jacarenda-labs",
      ownerAgentId: row.ownerAgentId ?? null,
      scope: row.scope,
      source: row.source ?? "manual",
      content: row.content,
      aclJson: "{}",
      createdAt: row.createdAt ?? Date.now(),
    })
    .run();
}

describe("memory.recall — shape + validation", () => {
  test("exposes the required ToolImpl fields", () => {
    expect(memoryRecallTool.id).toBe("memory.recall");
    expect(memoryRecallTool.isMutating).toBe(false);
    expect(typeof memoryRecallTool.execute).toBe("function");
    expect(memoryRecallTool.anthropicInputSchema).toHaveProperty(
      "type",
      "object",
    );
  });

  test("rejects limit > 20", () => {
    const parsed = memoryRecallTool.inputSchema.safeParse({ limit: 100 });
    expect(parsed.success).toBe(false);
  });

  test("rejects unknown fields (strict)", () => {
    const parsed = memoryRecallTool.inputSchema.safeParse({
      query: "x",
      __proto__dangerous: true,
    } as unknown);
    expect(parsed.success).toBe(false);
  });

  test("query + limit defaults parse cleanly", () => {
    const parsed = memoryRecallTool.inputSchema.safeParse({});
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data?.limit).toBe(10);
      expect(parsed.data?.query).toBeUndefined();
    }
  });
});

describe("memory.recall — scope rules", () => {
  test("org rows are visible to any agent in the tenant", async () => {
    await freshDb();
    const pa = agentWithoutRow("pa-1");
    insertMemory({ scope: "org", content: "Org-level fact A" });
    insertMemory({ scope: "org", content: "Org-level fact B" });

    const out = (await memoryRecallTool.execute(
      { limit: 10 },
      makeCtx(pa),
    )) as { matches: Array<{ content: string }>; total: number };

    expect(out.total).toBe(2);
    expect(out.matches.map((m) => m.content).sort()).toEqual([
      "Org-level fact A",
      "Org-level fact B",
    ]);
  });

  test("private rows are visible only to their owner agent", async () => {
    await freshDb();
    // Real rows because agentMemory.ownerAgentId FKs agents.id
    const pa = seedAgent("personal-assistant");
    const smm = seedAgent("social-media-manager");
    insertMemory({
      scope: "private",
      ownerAgentId: pa.id,
      content: "PA's private note",
    });
    insertMemory({
      scope: "private",
      ownerAgentId: smm.id,
      content: "SMM's private note",
    });

    const paOut = (await memoryRecallTool.execute(
      { limit: 10 },
      makeCtx(pa),
    )) as { matches: Array<{ content: string }>; total: number };
    const smmOut = (await memoryRecallTool.execute(
      { limit: 10 },
      makeCtx(smm),
    )) as { matches: Array<{ content: string }>; total: number };

    expect(paOut.matches.map((m) => m.content)).toEqual(["PA's private note"]);
    expect(smmOut.matches.map((m) => m.content)).toEqual([
      "SMM's private note",
    ]);
  });

  test("never returns rows from other tenants", async () => {
    await freshDb();
    const pa = agentWithoutRow("pa-1");
    insertMemory({
      tenantId: "other-tenant",
      scope: "org",
      content: "Other tenant's secret",
    });
    insertMemory({
      tenantId: "jacarenda-labs",
      scope: "org",
      content: "Our own fact",
    });

    const out = (await memoryRecallTool.execute(
      { limit: 10 },
      makeCtx(pa),
    )) as { matches: Array<{ content: string }>; total: number };

    expect(out.matches.map((m) => m.content)).toEqual(["Our own fact"]);
  });
});

describe("memory.recall — query + ordering + truncation", () => {
  test("query substring-matches case-insensitively", async () => {
    await freshDb();
    const pa = agentWithoutRow("pa-1");
    insertMemory({ scope: "org", content: "Met with Acme on Tuesday" });
    insertMemory({ scope: "org", content: "Invoice paid for Beta Corp" });
    insertMemory({ scope: "org", content: "ACME renewed the contract" });

    const out = (await memoryRecallTool.execute(
      { query: "acme", limit: 10 },
      makeCtx(pa),
    )) as { matches: Array<{ content: string }>; total: number };

    expect(out.total).toBe(2);
    expect(
      out.matches.every((m) => m.content.toLowerCase().includes("acme")),
    ).toBe(true);
  });

  test("rows come back newest-first", async () => {
    await freshDb();
    const pa = agentWithoutRow("pa-1");
    insertMemory({ scope: "org", content: "Oldest", createdAt: 1 });
    insertMemory({ scope: "org", content: "Middle", createdAt: 10 });
    insertMemory({ scope: "org", content: "Newest", createdAt: 100 });

    const out = (await memoryRecallTool.execute({ limit: 3 }, makeCtx(pa))) as {
      matches: Array<{ content: string }>;
    };

    expect(out.matches.map((m) => m.content)).toEqual([
      "Newest",
      "Middle",
      "Oldest",
    ]);
  });

  test("truncates long content to 600 chars (with ellipsis)", async () => {
    await freshDb();
    const pa = agentWithoutRow("pa-1");
    insertMemory({ scope: "org", content: "x".repeat(2000) });

    const out = (await memoryRecallTool.execute({ limit: 1 }, makeCtx(pa))) as {
      matches: Array<{ content: string }>;
    };

    expect(out.matches[0]!.content.length).toBe(600);
    expect(out.matches[0]!.content.endsWith("…")).toBe(true);
  });

  test("respects the limit cap", async () => {
    await freshDb();
    const pa = agentWithoutRow("pa-1");
    for (let i = 0; i < 30; i++) {
      insertMemory({ scope: "org", content: `item ${i}`, createdAt: i });
    }

    const out = (await memoryRecallTool.execute({ limit: 5 }, makeCtx(pa))) as {
      matches: Array<unknown>;
      total: number;
    };

    expect(out.total).toBe(5);
    expect(out.matches.length).toBe(5);
  });
});
