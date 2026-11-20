import { beforeAll, describe, expect, it } from "vitest";
import { createPgliteDb, type DB } from "@/lib/db/client";
import { runOnce, withRetry } from "@/lib/jobs/runner";

beforeAll(async () => {
  // Point the app's database handle at a fresh in-memory database.
  (globalThis as unknown as { __mcDb?: Promise<DB> }).__mcDb = createPgliteDb();
}, 30_000);

describe("runOnce (idempotent jobs)", () => {
  it("runs a job once per key, no matter how often it's called", async () => {
    let n = 0;
    const job = async () => ++n;
    const a = await runOnce("rollover:2026-11-20", job);
    const b = await runOnce("rollover:2026-11-20", job);
    const c = await runOnce("rollover:2026-11-21", job);
    expect([a.ran, b.ran, c.ran]).toEqual([true, false, true]);
    expect(n).toBe(2);
  });

  it("concurrent calls only run it once", async () => {
    let n = 0;
    const job = async () => {
      await new Promise((r) => setTimeout(r, 30));
      return ++n;
    };
    const results = await Promise.all([1, 2, 3].map(() => runOnce("summary:2026-11-20", job)));
    expect(results.filter((r) => r.ran)).toHaveLength(1);
    expect(n).toBe(1);
  });

  it("a failed run can be retried later", async () => {
    await expect(runOnce("flaky:1", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    const again = await runOnce("flaky:1", async () => "ok");
    expect(again).toMatchObject({ ran: true, result: "ok" });
  });
});

describe("withRetry", () => {
  it("retries transient errors, then succeeds", async () => {
    let n = 0;
    const v = await withRetry(async () => {
      if (++n < 3) throw Object.assign(new Error("503"), { code: 503 });
      return "ok";
    }, { baseMs: 1 });
    expect(v).toBe("ok");
    expect(n).toBe(3);
  });

  it("does not retry permanent errors like 404", async () => {
    let n = 0;
    await expect(
      withRetry(async () => {
        n++;
        throw Object.assign(new Error("nope"), { code: 404 });
      }, { baseMs: 1 }),
    ).rejects.toThrow();
    expect(n).toBe(1);
  });
});
