/**
 * Tiny structured (JSON) logger.
 *
 * Safety rule: secrets and email content must never reach the logs. Any field
 * whose NAME looks sensitive is replaced with "[redacted]", and long strings
 * are cut short so a whole email body can't slip through by accident.
 */
const SENSITIVE_KEY =
  /token|secret|password|authorization|cookie|key|code_verifier|body|html|snippet|payload|refresh|credential/i;
const MAX_STRING = 200;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[deep]";
  if (typeof value === "string") {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…[truncated]` : value;
  }
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  if (value instanceof Error) return { name: value.name, message: redact(value.message, depth + 1) };
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEY.test(k) ? "[redacted]" : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

type Level = "debug" | "info" | "warn" | "error";

function write(level: Level, msg: string, fields?: Record<string, unknown>) {
  if (process.env.NODE_ENV === "test" && level === "debug") return;
  const line = JSON.stringify({
    t: new Date().toISOString(),
    level,
    msg,
    ...(fields ? (redact(fields) as Record<string, unknown>) : {}),
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (msg: string, f?: Record<string, unknown>) => write("debug", msg, f),
  info: (msg: string, f?: Record<string, unknown>) => write("info", msg, f),
  warn: (msg: string, f?: Record<string, unknown>) => write("warn", msg, f),
  error: (msg: string, f?: Record<string, unknown>) => write("error", msg, f),
};
