/**
 * Prints fresh random secrets to paste into .env (or Vercel's env settings).
 * Run: npm run gen:secrets
 * Nothing is saved anywhere — copy the lines you need.
 */
import { randomBytes } from "node:crypto";

const b64 = (n: number) => randomBytes(n).toString("base64");

console.log(`SESSION_SECRET=${b64(48)}`);
console.log(`TOKEN_ENCRYPTION_KEYS=1:${b64(32)}`);
console.log(`CRON_SECRET=${randomBytes(32).toString("hex")}`);
