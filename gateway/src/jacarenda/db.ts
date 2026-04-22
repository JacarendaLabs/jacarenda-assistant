/**
 * Jacarenda Assistant — SQLite connection (agent-platform state).
 *
 * Kept separate from the upstream gateway DB (`gateway.sqlite`) so that
 * schema changes here don't conflict with upstream migrations. Same
 * connection pattern as `gateway/src/db/connection.ts`:
 *   - bun:sqlite, WAL, synchronous=FULL, FK on
 *   - drizzle-kit pushSQLiteSchema auto-diffs at startup
 *
 * See UPSTREAM_SYNC.md for the why.
 */

import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { getGatewaySecurityDir } from "../paths.js";
import * as schema from "./schema.js";

export type JacarendaDb = ReturnType<typeof drizzle<typeof schema>>;

let db: JacarendaDb | null = null;

function getDbPath(): string {
  const securityDir = getGatewaySecurityDir();
  if (!existsSync(securityDir)) {
    mkdirSync(securityDir, { recursive: true });
  }
  return join(securityDir, "jacarenda.sqlite");
}

export async function initJacarendaDb(): Promise<void> {
  if (db) return;

  const raw = new Database(getDbPath());
  raw.exec("PRAGMA journal_mode=WAL");
  raw.exec("PRAGMA synchronous=FULL");
  raw.exec("PRAGMA busy_timeout=5000");
  raw.exec("PRAGMA foreign_keys=ON");

  db = drizzle(raw, { schema });

  const { pushSQLiteSchema } = await import("drizzle-kit/api");
  const { statementsToExecute, apply } = await pushSQLiteSchema(
    schema,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- duck-type compatible
    db as any,
  );
  if (statementsToExecute.length > 0) {
    await apply();
  }
}

export function getJacarendaDb(): JacarendaDb {
  if (!db) {
    throw new Error("Jacarenda DB not initialized — call initJacarendaDb()");
  }
  return db;
}

/**
 * Test-only: drops the singleton so the next initJacarendaDb() picks up a
 * new GATEWAY_SECURITY_DIR. Never call from production code.
 */
export function __resetJacarendaDbForTests(): void {
  db = null;
}
