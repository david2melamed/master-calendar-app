@AGENTS.md

# Master Calendar + To-Do

Personal PWA for one user (you@example.com). It merges 3 Google accounts' calendars, Gmail-detected events (via Claude), and a Blackbaud ICS feed into one calendar, plus a To-Do page whose Urgent items go onto Google Calendar.

- **Plan and phase checklist:** `docs/PLAN.md` (keep the checklist updated when a phase finishes).
- **User setup steps:** `docs/SETUP.md`. **School admin request:** `docs/ADMIN-REQUEST.md`.
- **User:** a beginner who wants to learn. Explain changes in plain language. Stop after each phase for approval.

## Stack
- Next.js 16 App Router + TypeScript (strict) + Tailwind v4.
  - Next 16: `proxy.ts` replaces `middleware.ts`, and request APIs (`cookies()`, `headers()`, `params`) are async.
  - Read `node_modules/next/dist/docs/` before using unfamiliar Next APIs.
- Postgres via Drizzle ORM:
  - `DATABASE_URL` set → postgres.js (Supabase in prod).
  - Unset → local PGlite file in `.data/` (dev) or in-memory (tests).
- Auth: Google OAuth (`google-auth-library`) + `jose`-signed session cookie.
  - Allowlist is `ALLOWED_EMAILS`.
  - Login and "Connect account" share one OAuth client and one callback, `/api/auth/google/callback`.
- Hosting: Vercel Hobby + Supabase Free + cron-job.org calling `/api/cron/*` with `CRON_SECRET`.
- AI: `@anthropic-ai/sdk`.
  - `claude-haiku-5-5` is the default; `claude-sonnet-5-5` only for "possible" emails.
  - Budget caps: Sonnet $0.50, Haiku-only at $1.50, pause at $2.00 per month.

## Hard rules
- **Timezone:** everything is `America/New_York`. Use helpers in `src/lib/time.ts`; never rely on the server's local TZ (Vercel runs in UTC).
- **Secrets:** env vars only. Never log secrets, tokens, or email bodies (use `src/lib/log.ts`, which redacts).
- **OAuth refresh tokens:** encrypted with AES-256-GCM (`src/lib/crypto.ts`) before hitting the DB.
- **School accounts:** read-only (`gmail.readonly`, `calendar.readonly`). Writes go only to the "Auto-added" and "To-Do" calendars in the personal account.
- **Idempotency:** every job must be idempotent (processed message IDs, `job_runs` keys, `extendedProperties.private.mcId` on created Google events).
- **Errors:** one failing source must never stop the others. Errors go to `sync_errors` and show on the Status page.
- **Philosophy:** when in doubt, add the event (and mark it AI-guessed).

## Commands
- `npm run dev`: local dev at http://localhost:3000
- `npm test`: Vitest
- `npm run db:generate`: create a migration after editing `src/lib/db/schema.ts`
- `npm run db:migrate`: apply migrations
- `npm run gen:secrets`: print fresh random secrets for `.env`
