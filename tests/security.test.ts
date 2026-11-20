import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptWith, encryptWith, keyIdOf, parseKeyRing } from "@/lib/crypto";
import { redact } from "@/lib/log";
import { signSession, verifySession } from "@/lib/auth/session-token";
import { missingScopes, PERSONAL_SCOPES, SCHOOL_SCOPES } from "@/lib/google/scopes";

const k = () => randomBytes(32).toString("base64");

describe("token encryption", () => {
  it("round-trips and never stores plaintext", () => {
    const ring = parseKeyRing(`1:${k()}`);
    const stored = encryptWith(ring, "1//refresh-token-abc");
    expect(stored).not.toContain("refresh-token");
    expect(decryptWith(ring, stored)).toBe("1//refresh-token-abc");
  });

  it("uses a fresh IV each time", () => {
    const ring = parseKeyRing(`1:${k()}`);
    expect(encryptWith(ring, "x")).not.toBe(encryptWith(ring, "x"));
  });

  it("detects tampering", () => {
    const ring = parseKeyRing(`1:${k()}`);
    const parts = encryptWith(ring, "secret").split(".");
    parts[3] = Buffer.from("evil").toString("base64url");
    expect(() => decryptWith(ring, parts.join("."))).toThrow();
  });

  it("supports key rotation: new key encrypts, old key still decrypts", () => {
    const oldKey = k();
    const before = encryptWith(parseKeyRing(`1:${oldKey}`), "tok");
    const rotated = parseKeyRing(`2:${k()},1:${oldKey}`);
    expect(decryptWith(rotated, before)).toBe("tok");
    const after = encryptWith(rotated, "tok");
    expect(keyIdOf(after)).toBe("2");
  });

  it("rejects wrong-size keys", () => {
    expect(() => parseKeyRing(`1:${Buffer.from("short").toString("base64")}`)).toThrow(/32 bytes/);
  });
});

describe("session allowlist", () => {
  const secret = randomBytes(48).toString("base64");
  const allow = ["you@example.com"];

  it("accepts the owner", async () => {
    const t = await signSession({ email: "you@example.com" }, secret);
    expect(await verifySession(t, secret, allow)).toEqual({ email: "you@example.com" });
  });

  it("rejects anyone else, even with a validly signed cookie", async () => {
    const t = await signSession({ email: "intruder@gmail.com" }, secret);
    expect(await verifySession(t, secret, allow)).toBeNull();
  });

  it("rejects a cookie signed with a different secret", async () => {
    const t = await signSession({ email: "you@example.com" }, randomBytes(48).toString("base64"));
    expect(await verifySession(t, secret, allow)).toBeNull();
  });

  it("rejects garbage and missing cookies", async () => {
    expect(await verifySession("not-a-jwt", secret, allow)).toBeNull();
    expect(await verifySession(undefined, secret, allow)).toBeNull();
  });
});

describe("log redaction", () => {
  it("hides secrets and email bodies", () => {
    const out = redact({
      refresh_token: "1//abc",
      body: "Dear David, your appointment…",
      nested: { Authorization: "Bearer x", ok: "fine" },
    }) as Record<string, unknown>;
    expect(out.refresh_token).toBe("[redacted]");
    expect(out.body).toBe("[redacted]");
    expect(out.nested).toEqual({ Authorization: "[redacted]", ok: "fine" });
  });

  it("truncates long strings", () => {
    expect(String(redact("x".repeat(1000))).length).toBeLessThan(230);
  });
});

describe("OAuth scopes", () => {
  it("school accounts are read-only", () => {
    expect(SCHOOL_SCOPES.join(" ")).not.toMatch(/send|auth\/calendar(\s|$)|modify/);
    expect(SCHOOL_SCOPES).toContain("https://www.googleapis.com/auth/gmail.readonly");
    expect(SCHOOL_SCOPES).toContain("https://www.googleapis.com/auth/calendar.readonly");
  });

  it("detects permissions the user un-ticked on Google's consent screen", () => {
    const granted = PERSONAL_SCOPES.filter((s) => !s.endsWith("gmail.send"));
    expect(missingScopes("personal", granted)).toEqual(["https://www.googleapis.com/auth/gmail.send"]);
    expect(missingScopes("personal", PERSONAL_SCOPES)).toEqual([]);
  });
});
