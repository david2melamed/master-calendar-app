import "server-only";
import { z } from "zod";

/**
 * All configuration comes from environment variables (never hard-coded secrets).
 * We validate lazily so a missing variable gives a clear error naming the
 * variable — but never printing its value.
 */
const csv = (fallback: string) =>
  z
    .string()
    .default(fallback)
    .transform((s) =>
      s
        .split(",")
        .map((x) => x.trim().toLowerCase())
        .filter(Boolean),
    );

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),

  GOOGLE_CLIENT_ID: z.string().min(10),
  GOOGLE_CLIENT_SECRET: z.string().min(10),

  /** Signs the login session cookie. 32+ random bytes, base64. */
  SESSION_SECRET: z.string().min(32),
  /** "id:base64key,id:base64key" — the FIRST entry encrypts; all entries can decrypt. */
  TOKEN_ENCRYPTION_KEYS: z.string().min(10),

  /** Who may sign in to the app. */
  ALLOWED_EMAILS: csv("you@example.com"),
  /** The main account: the only one the app writes to. */
  PRIMARY_EMAIL: z.string().default("you@example.com").transform((s) => s.toLowerCase()),
  /** Mailboxes that may be connected as data sources. */
  CONNECTABLE_EMAILS: csv(
    "you@example.com,student@school.example.org",
  ),

  /** Empty = local PGlite database in .data/ (development only). */
  DATABASE_URL: z.string().optional(),
  CRON_SECRET: z.string().min(16).optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  /** Blackbaud calendar feed (webcal:// or https://). Secret: it works without a password. */
  BLACKBAUD_ICS_URL: z
    .string()
    .optional()
    .transform((v) => v?.trim() || undefined)
    .refine((v) => !v || /^(webcals?|https?):\/\//i.test(v), "must start with webcal:// or https://"),
  DEMO_MODE: z
    .string()
    .optional()
    .transform((v) => v === "1" || v === "true"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Missing or invalid environment variables (see .env.example):\n${problems}`,
    );
  }
  if (parsed.data.NODE_ENV === "production" && parsed.data.DEMO_MODE) {
    throw new Error("DEMO_MODE must never be enabled in production.");
  }
  cached = parsed.data;
  return cached;
}

/** The single OAuth redirect URI registered in Google Cloud. */
export function googleRedirectUri(): string {
  return `${env().APP_URL}/api/auth/google/callback`;
}
