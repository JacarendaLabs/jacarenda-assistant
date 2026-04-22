import { describe, test, expect, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as schema from "../jacarenda/schema.js";
import {
  __resetJacarendaDbForTests,
  initJacarendaDb,
} from "../jacarenda/db.js";
import * as storeModule from "../jacarenda/agent-store.js";

/**
 * The db.ts singleton is reset between tests via __resetJacarendaDbForTests.
 * Each test points GATEWAY_SECURITY_DIR at a fresh tmp dir so it gets its
 * own sqlite file.
 */

const TEST_DIRS: string[] = [];

async function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), "jacarenda-test-"));
  TEST_DIRS.push(dir);
  process.env.GATEWAY_SECURITY_DIR = dir;
  __resetJacarendaDbForTests();
  await initJacarendaDb();
  return { storeModule };
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

describe("jacarenda agent-store", () => {
  test("schema compiles: tables + indexes can be created in a fresh sqlite", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jacarenda-schema-"));
    TEST_DIRS.push(dir);
    const raw = new Database(join(dir, "test.sqlite"));
    const db = drizzle(raw, { schema });
    const { pushSQLiteSchema } = await import("drizzle-kit/api");
    const { statementsToExecute, apply } = await pushSQLiteSchema(
      schema,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db as any,
    );
    expect(statementsToExecute.length).toBeGreaterThan(0);
    await apply();
    // Sanity: the five tables we declared exist
    const names = raw
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
      )
      .all()
      .map((r) => (r as { name: string }).name)
      .sort();
    expect(names).toEqual([
      "agent_approvals",
      "agent_memory",
      "agent_run_events",
      "agent_runs",
      "agents",
    ]);
  });

  test("seedIfEmpty creates a paused/draft Social Media Manager on empty workspace", async () => {
    const { storeModule } = await freshDb();
    expect(storeModule.listAgents()).toEqual([]);
    storeModule.seedIfEmpty();
    const agents = storeModule.listAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0].templateId).toBe("social-media-manager");
    expect(agents[0].status).toBe("paused");
    expect(agents[0].trustMode).toBe("draft");
    expect(agents[0].toolAllowlist.length).toBeGreaterThan(0);
  });

  test("seedIfEmpty is idempotent — second call does not create a second agent", async () => {
    const { storeModule } = await freshDb();
    storeModule.seedIfEmpty();
    storeModule.seedIfEmpty();
    storeModule.seedIfEmpty();
    expect(storeModule.listAgents()).toHaveLength(1);
  });

  test("createAgent merges defaults from the template and persists overrides", async () => {
    const { storeModule } = await freshDb();
    const agent = storeModule.createAgent({
      templateId: "social-media-manager",
      name: "Marketing Bot",
      trustMode: "ask",
      toolAllowlist: ["fibery.query", "llm.compose"],
    });
    expect(agent.name).toBe("Marketing Bot");
    expect(agent.trustMode).toBe("ask");
    expect(agent.toolAllowlist).toEqual(["fibery.query", "llm.compose"]);
    // Personality defaulted from template (not overridden)
    expect(agent.personality.length).toBeGreaterThan(0);
    // Trigger defaulted from template
    expect(agent.triggerConfig.schedule).toBe("weekly");

    const fetched = storeModule.getAgent(agent.id);
    expect(fetched?.name).toBe("Marketing Bot");
  });

  test("createAgent with unknown template throws", async () => {
    const { storeModule } = await freshDb();
    expect(() =>
      storeModule.createAgent({ templateId: "does-not-exist" }),
    ).toThrow(/Unknown template/);
  });

  test("updateAgent patches only provided fields and bumps updatedAt", async () => {
    const { storeModule } = await freshDb();
    const a1 = storeModule.createAgent({ templateId: "social-media-manager" });
    const original = { ...a1 };
    await new Promise((r) => setTimeout(r, 5));

    const a2 = storeModule.updateAgent(a1.id, {
      name: "Renamed",
      trustMode: "autopilot",
    });
    expect(a2?.name).toBe("Renamed");
    expect(a2?.trustMode).toBe("autopilot");
    // Unchanged fields stay
    expect(a2?.templateId).toBe(original.templateId);
    expect(a2?.personality).toBe(original.personality);
    // updatedAt bumped
    expect(a2!.updatedAt).toBeGreaterThan(original.updatedAt);
  });

  test("updateAgent on missing id returns null", async () => {
    const { storeModule } = await freshDb();
    expect(storeModule.updateAgent("does-not-exist", { name: "x" })).toBeNull();
  });

  test("deleteAgent removes the row and returns true, then false", async () => {
    const { storeModule } = await freshDb();
    const a = storeModule.createAgent({ templateId: "social-media-manager" });
    expect(storeModule.deleteAgent(a.id)).toBe(true);
    expect(storeModule.getAgent(a.id)).toBeNull();
    expect(storeModule.deleteAgent(a.id)).toBe(false);
  });

  test("listAgents filters by tenant_id", async () => {
    const { storeModule } = await freshDb();
    storeModule.createAgent({
      templateId: "social-media-manager",
      tenantId: "tenant-a",
      name: "A",
    });
    storeModule.createAgent({
      templateId: "social-media-manager",
      tenantId: "tenant-b",
      name: "B",
    });
    expect(storeModule.listAgents("tenant-a")).toHaveLength(1);
    expect(storeModule.listAgents("tenant-a")[0].name).toBe("A");
    expect(storeModule.listAgents("tenant-b")).toHaveLength(1);
    expect(storeModule.listAgents("tenant-b")[0].name).toBe("B");
  });
});
