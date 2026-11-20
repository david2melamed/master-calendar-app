import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Encrypts OAuth refresh tokens before they are stored in the database
 * (AES-256-GCM: encryption + tamper detection).
 *
 * Keys come from TOKEN_ENCRYPTION_KEYS = "2:<base64>,1:<base64>".
 * The FIRST key encrypts new data; every listed key can decrypt. To rotate:
 * put a new key first, run `npm run rotate-keys`, then remove the old key.
 *
 * Stored format: "k<id>.<iv>.<authTag>.<ciphertext>" (each part base64url).
 */
export type KeyRing = { current: { id: string; key: Buffer }; all: Map<string, Buffer> };

export function parseKeyRing(spec: string): KeyRing {
  const all = new Map<string, Buffer>();
  let current: KeyRing["current"] | undefined;
  for (const part of spec.split(",").map((s) => s.trim()).filter(Boolean)) {
    const idx = part.indexOf(":");
    if (idx < 1) throw new Error("TOKEN_ENCRYPTION_KEYS entries must look like id:base64key");
    const id = part.slice(0, idx);
    const key = Buffer.from(part.slice(idx + 1), "base64");
    if (key.length !== 32) throw new Error(`Encryption key "${id}" must be 32 bytes (base64).`);
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`Invalid encryption key id "${id}".`);
    all.set(id, key);
    current ??= { id, key };
  }
  if (!current) throw new Error("TOKEN_ENCRYPTION_KEYS is empty.");
  return { current, all };
}

export function encryptWith(ring: KeyRing, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", ring.current.key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["k" + ring.current.id, iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptWith(ring: KeyRing, stored: string): string {
  const [kid, ivB, tagB, ctB] = stored.split(".");
  if (!kid?.startsWith("k") || !ivB || !tagB || ctB === undefined) {
    throw new Error("Encrypted value is malformed.");
  }
  const key = ring.all.get(kid.slice(1));
  if (!key) throw new Error(`No decryption key with id "${kid.slice(1)}" is configured.`);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ctB, "base64url")), decipher.final()]).toString("utf8");
}

/** Which key id encrypted this value (used by key rotation). */
export function keyIdOf(stored: string): string {
  return stored.split(".")[0].slice(1);
}

let ring: KeyRing | undefined;
function defaultRing(): KeyRing {
  const spec = process.env.TOKEN_ENCRYPTION_KEYS;
  if (!spec) throw new Error("TOKEN_ENCRYPTION_KEYS is not set.");
  return (ring ??= parseKeyRing(spec));
}

export const encryptSecret = (plaintext: string) => encryptWith(defaultRing(), plaintext);
export const decryptSecret = (stored: string) => decryptWith(defaultRing(), stored);
export const currentKeyId = () => defaultRing().current.id;
