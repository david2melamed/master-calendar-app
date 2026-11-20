# Master Calendar + To-Do

A private PWA that merges three Google accounts' calendars, events the AI finds in email, Blackbaud assignments, and a to-do list into one calendar. It's built for one user and locked to that user's Google account.

> Portfolio copy of a personal app I designed and built with Claude Code as an AI pair-programmer, in 7 planned phases (see the plan). Personal details are replaced with placeholders; to run your own, follow [docs/SETUP.md](docs/SETUP.md) and set the emails in `.env`.

**Stack:** Next.js 16 (App Router) · TypeScript · Tailwind v4 · Drizzle ORM + Postgres (Supabase) · Google OAuth / Calendar / Gmail APIs · Claude API (Haiku 5.5 + Sonnet 5.5, structured outputs) · Vitest + Playwright · Vercel

- **Plan and progress:** [docs/PLAN.md](docs/PLAN.md)
- **First-time setup:** [docs/SETUP.md](docs/SETUP.md)
- **School admin request:** [docs/ADMIN-REQUEST.md](docs/ADMIN-REQUEST.md)

## What it does
| Feature | How |
|---|---|
| **One calendar** | Year / Month / Week / Day views of every Google calendar you connect (synced incrementally), with swipe paging on iPhone and keyboard shortcuts on Mac |
| **Events from email** | Every 30 min, new Primary-inbox emails pass free filters, then Claude Haiku 5.5 (Sonnet 5.5 for "maybe" emails) extracts events into an **Auto-added** Google calendar. Duplicates skipped, low-confidence marked AI-guessed, overlaps emailed once |
| **Blackbaud** | Assignments feed checked hourly + guaranteed 5 PM ET; due 11:59 PM on the due date |
| **To-Do** | Urgent (on your calendar via a **To-Do** Google calendar), If I Have Time, My Lists; quick add like "essay fri"; midnight rollover + 7 AM overdue email |
| **Never silent** | Every failure lands on Settings → Problems; anything lasting 6 h+ is emailed once a day |

**Monthly cost:** hosting $0 (Vercel Hobby, Supabase Free, cron-job.org). AI is capped in code: Sonnet ≤ $0.50, Haiku-only from $1.50, paused at $2.00 (real usage so far: about 1¢).

**Security:** sign-in allowlist (one email), AES-256-GCM-encrypted Google tokens, secrets only in env vars, school accounts read-only, the app only writes to calendars it created, email bodies are never logged or stored, cron protected by a secret, security headers (no framing).

## Run it locally
```bash
npm install
cp .env.example .env      # then fill in values (see docs/SETUP.md)
npm run gen:secrets       # prints random secrets for .env
npm run dev               # http://localhost:3000
```
Without `DATABASE_URL`, the app uses a local database in `.data/pglite`, which needs no setup.

## Useful commands
| Command | What it does |
|---|---|
| `npm run dev` | Start the app locally |
| `npm test` | Run the automated tests |
| `npm run typecheck` | Check TypeScript types |
| `npm run db:generate` | Create a migration after editing `src/lib/db/schema.ts` |
| `npm run db:migrate` | Apply migrations (to Supabase if `DATABASE_URL` is set) |
| `npm run gen:secrets` | Print fresh random secrets |

## Reconnecting an account
Go to **Settings → Connected accounts → Reconnect**. When Google access expires or is revoked, the Status page shows "Needs reconnect" (and from Phase 5, you'll also get an email).

## Rotating secrets
- **Token encryption key:** add a new key **first** in `TOKEN_ENCRYPTION_KEYS` (e.g. `2:<new>,1:<old>`). New tokens use key 2, and old ones still decrypt. Reconnect each account (or run the rotate script we'll add in Phase 7), then remove `1:<old>`.
- **Session secret:** change `SESSION_SECRET`. This signs you out everywhere.
- **Anthropic API key:** this section is completed in Phase 5. Create a new key in the Console, update `ANTHROPIC_API_KEY` locally and in Vercel, redeploy, then delete the old key.

## Deployment (live)
- **App:** https://your-app.vercel.app (Vercel Hobby, $0). Every `git push` to `main` deploys automatically in about a minute.
- **Settings:** Vercel → project → Environment Variables (same names as `.env`, but `APP_URL` is the live URL and there is never a `DEMO_MODE`). After changing one, redeploy.
- **Database:** Supabase Free (`DATABASE_URL` = transaction pooler, port 6543). Run `npm run db:migrate` after adding a migration; it uses `DATABASE_URL` from `.env`.
- **Background jobs:** cron-job.org calls `/api/cron/tick` every 30 minutes with the header `Authorization: Bearer <CRON_SECRET>`. Vercel's once-a-day cron (`vercel.json`) is a backup.
- **Google:** the OAuth client lists both `http://localhost:3000` and the live URL as origins/redirects. The consent screen is published "In production" with no logo (so no verification is needed).
- **Install:** Mac Chrome → install icon in the address bar. iPhone Safari → Share → Add to Home Screen.
