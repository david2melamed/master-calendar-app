/**
 * Applies database migrations (drizzle/*.sql).
 *   npm run db:migrate          → uses DATABASE_URL from .env (Supabase)
 * Without DATABASE_URL it migrates the local PGlite database in .data/.
 */
import "dotenv/config";
import path from "node:path";

async function main() {
  const folder = path.join(process.cwd(), "drizzle");
  const url = process.env.DATABASE_URL;
  if (url) {
    const postgres = (await import("postgres")).default;
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    const client = postgres(url, { prepare: false, max: 1, max_pipeline: 1 });
    await migrate(drizzle(client), { migrationsFolder: folder });
    await client.end();
    console.log("✓ Migrations applied to DATABASE_URL");
  } else {
    const { createPgliteDb } = await import("../src/lib/db/client");
    await createPgliteDb(path.join(process.cwd(), ".data", "pglite"));
    console.log("✓ Migrations applied to local PGlite (.data/pglite)");
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error("Migration failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
