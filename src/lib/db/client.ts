import { drizzle as drizzlePg, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import path from "node:path";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * One database handle for the whole app.
 *  - DATABASE_URL set   → real Postgres (Supabase in production).
 *  - DATABASE_URL unset → local PGlite (Postgres compiled to WebAssembly) stored
 *    in .data/pglite, so development works before any cloud account exists.
 * PGlite applies migrations automatically; for real Postgres run `npm run db:migrate`.
 */
export type DB = PostgresJsDatabase<typeof schema>;

const g = globalThis as unknown as { __mcDb?: Promise<DB> };

export function getDb(): Promise<DB> {
  return (g.__mcDb ??= createDb());
}

export const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

async function createDb(): Promise<DB> {
  const url = process.env.DATABASE_URL;
  if (url) {
    // Supabase's pooler (port 6543) runs in transaction mode:
    //  - prepared statements off
    //  - max_pipeline 1: never send a second query down a connection before the
    //    first answers. The pooler stalls forever on pipelined queries, which
    //    made any page running queries in parallel (e.g. Settings) hang.
    const client = postgres(url, { prepare: false, max: 3, max_pipeline: 1, idle_timeout: 20 });
    return drizzlePg(client, { schema });
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("DATABASE_URL is required in production.");
  }
  return createPgliteDb(path.join(process.cwd(), ".data", "pglite"));
}

/** Local/in-memory Postgres. `dataDir` undefined = in-memory (tests). */
export async function createPgliteDb(dataDir?: string): Promise<DB> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  if (dataDir) (await import("node:fs")).mkdirSync(dataDir, { recursive: true });
  const client = new PGlite(dataDir);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  // Same query API at runtime; cast so the rest of the app has one type.
  return db as unknown as DB;
}

export { schema };
