# Master Calendar + To-Do — Plan

## Context
You have events scattered across 3 Gmail inboxes, 3 sets of Google Calendars, and Blackbaud. This app merges them into one polished calendar (Year/Month/Week/Day), uses Claude to find events in incoming Primary email, and has a To-Do page whose Urgent items land on the calendar. It's a PWA for Mac and iPhone, hosted for free, with about $1/month in AI costs. Philosophy: **add when in doubt**, and mark it AI-guessed.

The project folder `~/master-calendar` is empty, so we start from scratch.

**Verified today:**
- `other-school.example.org` and `school.example.org` both route mail through Google (MX = aspmx.l.google.com). **Both school accounts are Google Workspace**, so no Microsoft Graph or IMAP code is needed. One Gmail/Calendar code path covers all 3 accounts.

---

## 1. Hosting comparison and recommendation

| | **Vercel Hobby + Supabase Free** ✅ recommended | Cloudflare Workers/Pages + D1 | Vercel Hobby + Neon Free |
|---|---|---|---|
| Next.js support | Native (Vercel makes Next.js) | Works via OpenNext adapter. More moving parts, and the free plan's 10 ms CPU/request and 3 MB bundle limits are tight for SSR | Native |
| Database | Real Postgres, 500 MB, **Realtime included** (for instant Mac↔iPhone sync) | D1 = SQLite, 5 GB; no realtime | Postgres 0.5 GB; compute hours are metered, and our 5-min pings would use a large share |
| Cron | Hobby = **1 job/day only**, so we use the free **cron-job.org** (every 5 min) | 5 free Cron Triggers, any frequency | Same as Vercel |
| Pausing | Pauses after 7 days with no DB activity. Our 5-min jobs keep it active | Never | Scales to zero, wakes on demand |
| Learning curve | Lowest; most tutorials | Highest | Low |

**Pick: Vercel Hobby + Supabase Free + cron-job.org.** It's the simplest and most reliable stack for a beginner using Next.js, and Supabase Realtime gives "updates within seconds" for free. Cloudflare's free CPU limits are the main risk for a Next.js app.

**Schedulers (all free, layered):**
- **cron-job.org**
  - Calls `/api/cron/tick` every 5 min with a secret header.
  - Has a separate job pinned to **5:00 PM America/New_York** for Blackbaud (cron-job.org handles the timezone, including DST).
  - Has a job at **00:05 ET** for rollover.
- **Vercel's 1 daily cron** is a backup heartbeat.
- **Opening the app** also triggers a sync.
- Every job is recorded in a `job_runs` table with an idempotency key (e.g. `rollover:2026-11-20`). Duplicate or late ticks do nothing; missed ones catch up on the next tick.

### Free-tier usage estimates (how close we'll be)
| Service | Limit | Expected use |
|---|---|---|
| Vercel functions | ~1M invocations, 4 h active CPU/mo | ~15k invocations (≈1.5%); CPU mostly waiting on I/O, est. <15% |
| Supabase DB | 500 MB, 5 GB egress | <20 MB (we store IDs + extracted events, **never email bodies**); egress <0.5 GB |
| Supabase Realtime | 200 concurrent, 2M msgs | 2 devices, a few thousand msgs |
| Google Pub/Sub | 10 GiB/mo free | ~2–5 MB/mo (≈0.05%) |
| Gmail/Calendar API | free quotas (1B units/day Gmail) | negligible |
| cron-job.org | free, 1-min resolution | 3 jobs |

---

## 2. Monthly cost, per service
| Service | Plan | Expected $/mo | Notes |
|---|---|---|---|
| Vercel | Hobby | **$0** | Personal, non-commercial use is allowed |
| Supabase | Free | **$0** | |
| cron-job.org | Free | **$0** | |
| GitHub | Free | **$0** | Private repo; Vercel deploys from it |
| Google Cloud (OAuth, Gmail, Calendar, Pub/Sub) | Free tier | **$0** | ⚠️ Enabling Pub/Sub likely requires linking a billing account (credit card). I'll have you set a **$1 budget alert**. If you'd rather not add a card, the fallback is to check Gmail history every 5 min via cron (still $0, ~5 min delay instead of seconds). |
| Anthropic API | Pay-as-you-go | **~$0.30–$0.90** | Console requires **prepaid credits (min ~$5)**, which should last 5+ months. See the AI budget below |
| Domain | none | **$0** | Use `your-app.vercel.app` |
| **Total** | | **≈ $0.30–$0.90/mo** | Under your $1 target |

**AI estimate.** Assumes ~30 Primary emails/day, ~60% left after free filtering, and bodies trimmed to ≤1.5k tokens.
- **Haiku 5.5** ($0.10 in / $0.50 out per MTok): ~600 calls × ~2.3k in / 300 out ≈ **$0.23/mo**
- **Sonnet 5.5** ($2/$10): only for "possible event" emails, **hard cap $0.50/mo**

**Enforced in code:**
- At $0.50 Sonnet spend → Sonnet stops for the month.
- At $1.50 total → Haiku only.
- At $2.00 → AI pauses and I email you. Calendar, Blackbaud, and To-Do keep working.

I'll also have you set a spending limit in the Anthropic Console as a second safety net.

---

## 3. Architecture

```
iPhone/Mac PWA (Next.js React UI)
   │  HTTPS (Auth.js session cookie, allowlist: you@example.com)
   ▼
Vercel (Next.js App Router: pages + API routes)
   ├─ /api/webhooks/gmail     ◄── Google Pub/Sub push (OIDC JWT verified)
   ├─ /api/cron/*             ◄── cron-job.org + Vercel cron (CRON_SECRET)
   ├─ /api/oauth/connect      ── "Connect account" (per-account Google OAuth, offline)
   ├─ services: calendarSync, gmailPipeline, aiExtractor, blackbaudSync,
   │            dedupe, conflicts, todoCalendarBridge, mailer, budget
   ▼
Supabase Postgres (Drizzle ORM) ── Realtime broadcast → open devices refresh instantly
   ▲
Google APIs (Gmail, Calendar, Pub/Sub) · Anthropic API · Blackbaud ICS
```

**Key design decisions**
- **One Google OAuth client for everything.**
  - Sign-in requests only `openid email profile`; anyone not on the allowlist is rejected in the Auth.js `signIn` callback.
  - "Connect account" is a separate flow per mailbox that stores an **AES-256-GCM-encrypted refresh token** (key in `TOKEN_ENCRYPTION_KEY`, with a key-version column so the key can be rotated).
  - Scopes per account:
    - Personal: `gmail.readonly gmail.send calendar`
    - School: `gmail.readonly calendar.readonly`
- **Google Calendar is the source of truth for app-created events.**
  - Every event we create carries `extendedProperties.private.mcId = <our id>`. Before creating, we look up that id, so a retry can never make a duplicate.
- **Unified `events` read model in the DB.**
  - All sources (Google calendars, AI, Blackbaud, To-Do) are normalized into one table, keyed by `(source, external_id)`.
  - The UI reads one fast query, and dedupe and conflicts run against it.
- **Gmail:**
  - `users.watch` filtered to label `INBOX`, delivered via Pub/Sub, then `history.list` from the stored historyId.
  - We check `CATEGORY_PERSONAL` per message; if the account has tabs disabled, we use INBOX plus newsletter heuristics.
  - Each message ID is inserted into `processed_messages` (unique constraint) **before** it's processed, so nothing is processed twice.
  - Watches are renewed daily. If a historyId is too old (404), we fall back to a bounded resync (last 3 days).
- **Calendar sync:** incremental `syncToken` per calendar, on app open + every 10 min. On a 410 response we do a full resync. Push channels are skipped for now (polling is simpler and free); they're an optional Phase 7 add-on.
- **Realtime:** the server publishes a "changed" broadcast on a private Supabase channel. Clients re-fetch through TanStack Query, with optimistic updates for To-Do.
- **Errors:**
  - Each source has its own try/catch, plus retries with exponential backoff and jitter.
  - Errors go to the `sync_errors` table and the Status page.
  - Problems lasting more than 6 h, and expired or revoked tokens (`invalid_grant`), trigger an email with a Reconnect link.

## 4. Tech stack (with reasons)
| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript (strict) | One language end to end |
| Framework | Next.js 15+ App Router | Your default, and the best fit for Vercel |
| Styling | Tailwind CSS v4 + CSS variables design tokens | Fast to iterate, easy dark mode, consistent design |
| UI primitives | Radix UI (Dialog, Popover, Toggle Group) | Accessible slide-overs, sheets, and segmented controls |
| Animation | Motion (Framer Motion) | Subtle 150–250 ms transitions and bottom sheets |
| Calendar views | **Custom-built** (no FullCalendar) | Full control for Linear/Apple-level polish; overlap layout written in-house |
| Data fetching | TanStack Query | Optimistic updates, cache, refetch on focus |
| Drag & drop | dnd-kit | Touch + keyboard accessible |
| Dates/TZ | date-fns v4 + `@date-fns/tz` (TZDate), chrono-node | Correct ET/DST math; natural-language "essay fri" |
| DB/ORM | Supabase Postgres + Drizzle ORM + drizzle-kit migrations | Typed SQL, simple migrations |
| Auth | Google OAuth (google-auth-library) + `jose` signed session cookie (Next 16 docs pattern) | Fewer moving parts; same OAuth client also powers "Connect account" |
| Google | `googleapis`, `google-auth-library` (Pub/Sub JWT verify) | Official libraries |
| AI | `@anthropic-ai/sdk`, structured outputs (`output_config.format` JSON schema via Zod) | Official SDK; guaranteed-valid JSON |
| ICS | `ical.js` | Handles recurrence, timezones, and raw properties |
| Similarity | Custom normalized-token Dice/Jaccard + date window | Free first pass before any Haiku call |
| PWA | `app/manifest.ts`, Serwist service worker, iOS meta tags | Installable on Chrome (Mac) and Safari (iPhone) |
| Tests | Vitest (unit), Playwright (E2E smoke) | Fast, TS-native |
| Logging | Small JSON logger with secret/body redaction | Structured, never prints secrets or email bodies |

**AI call details:**
- Haiku 5.5 runs at low effort / thinking off for classification and extraction.
- Sonnet 5.5 runs at low effort, with `fallbacks: "default"` enabled for refusals.
- Every call's tokens and cost are written to `ai_usage`.

## 5. File structure
```
master-calendar/
├─ CLAUDE.md                     project context for future chats
├─ README.md                     setup, deploy, key rotation, reconnecting
├─ docs/PLAN.md                  this plan + phase checklist (kept updated)
├─ docs/ADMIN-REQUEST.md         what to send school IT
├─ .env.example                  every variable, no values (.env is gitignored)
├─ drizzle/                      SQL migrations
├─ public/icons/                 app icon (navy/blue calendar), apple-touch-icon, maskable
├─ src/
│  ├─ app/
│  │  ├─ (app)/calendar/page.tsx        Year/Month/Week/Day
│  │  ├─ (app)/todo/page.tsx
│  │  ├─ (app)/settings/page.tsx        Status, accounts, AI spend, activity, allow/deny list
│  │  ├─ login/page.tsx
│  │  ├─ manifest.ts · layout.tsx · globals.css
│  │  └─ api/
│  │     ├─ auth/[...nextauth]/route.ts
│  │     ├─ oauth/connect/route.ts · oauth/callback/route.ts
│  │     ├─ webhooks/gmail/route.ts      Pub/Sub push (JWT verified)
│  │     ├─ cron/tick/route.ts · cron/blackbaud-5pm/route.ts · cron/rollover/route.ts
│  │     ├─ events/… · todos/… · sync/route.ts (on-open sync)
│  ├─ components/calendar/{DayView,WeekView,MonthView,YearView,EventCard,DetailPanel,…}.tsx
│  ├─ components/todo/… · components/ui/… (SegmentedControl, Sheet, Toast, Skeleton)
│  ├─ lib/
│  │  ├─ db/{schema.ts,client.ts}
│  │  ├─ auth.ts · crypto.ts (token encryption) · log.ts · time.ts (ET helpers)
│  │  ├─ google/{oauth.ts,calendar.ts,gmail.ts,pubsub-verify.ts}
│  │  ├─ ai/{extract.ts,prompts.ts,schema.ts,budget.ts}
│  │  ├─ pipeline/{filter.ts,clean-body.ts,gmail-pipeline.ts}
│  │  ├─ blackbaud/{fetch.ts,parse.ts,sync.ts}
│  │  ├─ events/{dedupe.ts,conflicts.ts,layout.ts (overlap columns)}
│  │  ├─ todo/{urgent-bridge.ts,rollover.ts,crosscheck.ts,nl-date.ts}
│  │  ├─ mail/{send.ts,templates.ts}
│  │  └─ jobs/{runner.ts (idempotent job_runs),retry.ts}
│  └─ demo/seed.ts                fake data mode (DEMO_MODE=1)
├─ scripts/pipeline-dry-run.ts    npm run pipeline:dry -- --account X --since 3d [--no-ai]
└─ tests/ (Vitest + Playwright)
```

**Main tables:**
- `accounts` (email, role, encrypted_refresh_token, key_version, status, gmail_history_id, watch_expiry)
- `calendars` (account, google_id, sync_token, color, enabled)
- `events` (source, external_id, account, calendar, title, start, end, all_day, location, description, ai_confidence, ai_guessed, quote, gmail_link, blackbaud_meta jsonb, todo_item_id, status, deleted_at)
- `processed_messages`, `ai_usage`, `sync_state`, `sync_errors`, `activity_log`, `job_runs`
- `todo_lists`, `todo_items` (section, list_id, position, due, created_event_id, linked_event_id, rolled_days, done_at)
- `pending_conflicts` (batched email), `sender_rules` (allow/deny)

## 6. Accounts and services you'll create (all free)
1. **Google Cloud project** "Master Calendar"
   - Enable Gmail API, Google Calendar API, and Cloud Pub/Sub API.
   - Set up the OAuth consent screen (External, then **publish to "In production"**).
   - Create a Web OAuth Client ID.
   - Link a billing account for Pub/Sub ($0 expected) and set a $1 budget alert.
2. **Anthropic Console**: buy $5 credits, set a monthly spend limit, create an API key (you paste it into `.env`).
3. **Supabase**: free project in region us-east-1.
4. **GitHub**: free account and private repo.
5. **Vercel**: Hobby account, signed in with GitHub.
6. **cron-job.org**: free account (Phase 3).

## 7. What I need from you
- Installed on your Mac: Node.js LTS + git (I'll check and walk you through it), and Chrome.
- Clicking through each console (I'll give exact steps); pasting secrets into `.env` yourself. I'll never ask you to paste secrets into chat.
- **Phase 4:** the Blackbaud Feed URL, pasted into `.env` (`BLACKBAUD_ICS_URL`), not into chat.
- Sending the admin request when you're ready (doesn't block anything).
- Testing on your iPhone in Phases 3 and 7.
- Your OK after each phase.

## 8. OAuth "Testing" gotcha: what you'll see
- In **Testing** mode, refresh tokens die after 7 days. We publish the consent screen to **In production** and skip verification. Google allows this under its **personal-use exception** (up to 100 users, and you're the only one).
- **What you'll see when connecting:** "Google hasn't verified this app". Click **Advanced → Go to Master Calendar (unsafe)**, then approve the scopes. This is expected for your own private app.
- **Safety net:** a revoked or expired token (`invalid_grant`) marks the account "Needs reconnect" on the Status page and sends you an email with a one-click Reconnect link. We never fail silently.
- **School accounts:** your IT admin marks our Client ID as **Trusted** in Admin console → Security → API controls → App access control. That bypasses the unverified-app block for their domain.

### Admin request (prepared in Phase 1 as docs/ADMIN-REQUEST.md, with your real Client ID filled in)
> App: "Master Calendar" (personal, read-only). OAuth Client ID: `<filled in Phase 1>`.
> Scopes requested: `https://www.googleapis.com/auth/gmail.readonly`, `https://www.googleapis.com/auth/calendar.readonly`.
> Please add this client under Admin console → Security → Access and data control → API controls → Manage Third-Party App Access → Configure new app → OAuth Client ID, and set it to **Trusted** (or "Specific Google data" for Gmail + Calendar) for my account.

In Phase 1 I'll also try connecting each school account. The result (blocked by admin / allowed) shows on the Status page so you know what to send.

## 9. Pipeline specifics (summary)
**Free filters, applied before any AI call:**
- Primary category only.
- Skip senders matching no-reply, marketing, or newsletter patterns, `List-Unsubscribe` + bulk headers, and deny-listed senders.
- Skip Google Calendar invitation emails (`text/calendar` part or `calendar-notification@google.com`).
- Skip messages already in `processed_messages`.

**Cleaning:** strip HTML, quoted replies, and signatures; cap the body at ~6k characters.

**Pass 1, Haiku:** returns `{kind: none | clear | possible, events[]}`. Each event has: title, start, end, all_day, timezone, location, description, confidence, quote, and `action: create | update | cancel` + `refers_to`. The email's sent date in ET is the anchor for relative dates.

**Date rules, applied in code after extraction:**
- Missing times on deadlines become **11:59 PM ET**.
- Relative-date resolution is checked against a deterministic resolver (unit-tested).

**Pass 2, Sonnet:** for "possible" emails or confidence < 0.6, only while within budget.

**Saving events:**
- Everything gets added. Confidence < 0.8 means **AI-guessed** (dashed border).
- **Dedupe:** same day ±2 h (all-day: same date) **and** title similarity ≥ 0.6. On a match we link instead of creating.
- Updates and cancellations match earlier AI events from the same thread or similar titles.

**Conflicts:** any overlap with a timed event goes into `pending_conflicts`. A tick then sends **one batched email** once the queue has been quiet for 3 min.

**To-Do cross-check:** free string/date match first; Haiku is called only when the best similarity score falls in the ambiguous 0.35–0.6 band.

**Rollover:**
- At 00:05 ET (idempotent per date), unfinished Urgent items move to the next day at 11:59 PM, with `rolled_days += 1` and an Overdue flag.
- One summary email goes out at 7:00 AM ET, only if anything rolled.

## 10. Risks
1. **Google may still expire tokens or block restricted scopes for unverified apps.** Mitigation: personal-use exception + reconnect emails. Worst case is a quick reconnect now and then.
2. **School admins may refuse.** The app works fully without those accounts. Fallback: set up auto-forwarding from the school Gmail to your personal Gmail if the school allows it (the pipeline tags these emails by original recipient).
3. **Pub/Sub may require a billing card.** Fallback is 5-min Gmail polling.
4. **Free tiers change.** The Status page shows usage, and we keep it far below limits.
5. **Vercel Hobby function timeouts.** Jobs are chunked and resumable (process N messages per run, continue next tick).
6. **AI mis-extraction**, especially wrong dates. Mitigations: an "add, but flag it" policy, the original email quote and a Gmail link on each AI event, one-tap delete with undo, and a dry-run mode for tuning.
7. **Blackbaud ICS may lack points/status fields.** We parse whatever is present and show only what exists (to be confirmed with your real feed in Phase 4).
8. **iOS PWA limits:** no background sync (the server does it) and no Web Push unless added later. Emails cover alerts.
9. **DST edge cases** around 2 AM transitions and the 5 PM check. Mitigation: cron-job.org's native timezone setting, and every date calculation uses `America/New_York` (tested).

## 11. Phases (stop, run, demo, explain, wait for your OK after each)
- [x] **Phase 1 – Setup:** _(done Nov 19, 2026)_
  - [x] Scaffold (Next.js 16, TS, Tailwind v4, Drizzle, PGlite local DB), docs/PLAN.md, CLAUDE.md, .env with generated secrets
  - [x] Sign-in locked to allowlist (Google OAuth + PKCE + signed state, jose session cookie, proxy.ts guard)
  - [x] Encrypted "Connect account" flow (AES-256-GCM refresh tokens, scope checks, admin-block detection), Settings/Status page
  - [x] 21 tests passing (encryption, allowlist, redaction, scopes, ET/DST, DB idempotency, demo data)
  - [x] **You:** Google Cloud project + OAuth client (docs/SETUP.md §A) → in .env (Web client `Master Calendar web`)
    - Phase 3: client secret rotated (new secret in .env + Vercel). Old secret still to be **disabled** in Google Cloud → Clients.
    - Note: Google requires a public home page + privacy URL to publish. Stay in **Testing** (7-day tokens) until Phase 3, then set Branding home = APP_URL, privacy = APP_URL/privacy, authorized domain = the vercel.app host, and Publish.
  - [x] Real sign-in + connect you@example.com (9 calendars listed)
  - [x] Tried school accounts: both blocked (expected). Client ID filled into docs/ADMIN-REQUEST.md. User is contacting SCHOOL IT; Other school dropped as extraneous (removed from CONNECTABLE_EMAILS)
  - Create docs/PLAN.md + CLAUDE.md, `git init`, scaffold Next.js/TS/Tailwind/Drizzle.
  - Walk you through Google Cloud, Anthropic, and Supabase setup.
  - Get sign-in working, locked to your email (I'll show a different account being rejected).
  - Build the token-encrypted "Connect account" flow and connect your personal account (list its calendars as proof).
  - Test the school accounts and fill in docs/ADMIN-REQUEST.md.
  - Demo mode seed.
- [x] **Phase 2 – Calendar UI:** _(done Nov 19, 2026)_
  - [x] Incremental Google Calendar sync (syncToken, 410 → full resync, declined/cancelled removed): 2,442 events from 8 calendars in ~5 s; repeat syncs ~2 s
  - [x] Sync on app open, on return to the app, and every 10 min while open; "Synced X ago" indicator
  - [x] Year / Month / Week / Day views, custom-built; Day view with summary line, pinned items, live now-line, side-by-side overlaps
  - [x] Detail panel (slide-over on Mac, bottom sheet on iPhone); keyboard Y/M/W/D/T/←/→; swipe on iPhone; remembered view; Week default on Mac, Day on iPhone; deep links `?view=&date=`
  - [x] Curated color palette mapped from Google colors; legend + source toggles (remembered); dark mode; skeletons; empty state
  - [x] Tests: 41 unit (layout, ET date math, sync mapping…) + 16 end-to-end (demo mode, Mac + iPhone sizes)
  - Deferred by design: Edit/Delete + 5-second Undo for AI events → Phase 5; to-do checkboxes → Phase 6; background sync when the app is closed → Phase 3 (cron)
- [x] **Phase 3 – Deploy:** _(done Nov 19, 2026)_
  - [x] Private GitHub repo `<you>/master-calendar` (history checked: no secrets)
  - [x] Supabase Free (us-east-1, transaction pooler :6543, Data API off, RLS on), migrations applied
  - [x] Vercel Hobby → https://your-app.vercel.app ; 10 env vars (Secret, Production+Preview); every push to `main` auto-deploys
  - [x] Google: production origin + redirect URI, Branding home/privacy/domain, **published "In production"** (no logo), client secret rotated
  - [x] cron-job.org: `/api/cron/tick` every 5 min with Bearer CRON_SECRET → 200 OK; Vercel daily cron as backup
  - [x] Installed on Mac (Chrome) and iPhone (Safari → Add to Home Screen)
  - [x] Fix: postgres.js `max_pipeline: 1` (Supabase pooler hangs on pipelined queries → Settings never loaded)
  - [x] Extra: smooth iPhone swiping (page follows finger, neighbours pre-rendered, time of day kept)
- [x] **Phase 4 – Blackbaud:** _(done Nov 19, 2026)_
  - [x] Feed = Blackbaud "My Calendars → Individual Filter Feeds → Assignments" (webcal, `BLACKBAUD_ICS_URL` in .env + Vercel, Secret)
  - [x] Real feed shape: all date-only; DTSTART = assigned, DTEND (exclusive) = due + 1 → due 11:59 PM ET; titles "Course - Section: Title" → class split off; no ETag (content hash used instead)
  - [x] Add / update / remove (only within the window the feed covers: past 2 months + next 12); empty feed never wipes data; activity log
  - [x] Hourly + guaranteed 5 PM ET (full re-read) via the 5-min tick and runOnce keys; also on app open if >15 min; Settings "Check now"
  - [x] Errors on Status page, never containing the feed URL. 138 assignments live
  - [x] Fixes: runOnce Date binding on postgres.js (broke scheduled jobs in prod); jsonb key-order false "changed"
  - [x] Tests: 61 unit (14 Blackbaud)
- [x] **Phase 5 – Gmail → AI:** _(done Nov 20, 2026)_
  - [x] **Decision (user):** poll Gmail every 5 min via the cron tick instead of Pub/Sub — $0, no billing card, ≤5 min delay
  - [x] History API discovery (first run: last 2 days; expired → 3-day catch-up) into `processed_messages` (idempotent queue, claimed before any AI call)
  - [x] Free filters (Primary only, lists/bulk/automated senders, invites, login codes, sender allow/deny); body cleaned + capped, never logged/stored
  - [x] Haiku 5.5 (low effort, no thinking, structured output) → Sonnet 5.5 second pass for "possible"/low-confidence (server-side fallback); budget caps $0.50 / $1.50 / $2.00 + pause email
  - [x] ET rules incl. non-Eastern local times (flights, Israel), deadlines → 11:59 PM; dedupe (±2 h & title ≥ 0.6, or same day & shared code like a flight number); update/cancel only app-created events
  - [x] Writes only to "Auto-added" (mcId); Google-side edits/deletes mirrored back; batched conflict email (3 quiet minutes)
  - [x] UI: Delete + 5 s undo, Ignore this sender, Settings "Email AI" (spend bar, counts, ignored senders); `npm run pipeline:dry`
  - [x] Real-inbox test found and fixed: Central-time flight placed an hour early; return flight not matched to Google's own copy
  - [x] Tests: 87 unit (26 pipeline). First real cost: $0.012 for 12 calls
- [x] **Phase 6 – To-Do:** _(done Nov 20, 2026)_
  - [x] Urgent / If I Have Time / My Lists (create/delete lists) / Done (last 30 days); quick add with own ET date reader ("essay fri", "4pm", "12/1", "in 3 days"); inline rename; Move to… menu; due-date picker
  - [x] Urgent → app-owned "To-Do" Google calendar (default due today 11:59 PM, mcId), ✓ prefix when done; checkboxes on the calendar and To-Do page are the same item; moving out of Urgent / deleting removes the event
  - [x] Rollover once per ET day (first tick after midnight) → today 11:59 PM, overdue days counted; 7 AM ET email listing overdue items (only if any)
  - [x] Skipped to save usage (can add later): drag-and-drop (Move to… instead), Supabase realtime (refreshes on open/focus), AI to-do cross-check
  - [x] Cron moved to every 30 min (user's choice) — all jobs are "due-based", so nothing else changed
  - [x] Tests: 92 unit (5 to-do)
- [x] **Phase 7 – Polish:** _(done Nov 20, 2026)_
  - [x] Daily "problems" email (errors lasting 6 h+, accounts needing reconnect) from 8 AM ET
  - [x] Security headers (no framing, nosniff, referrer, permissions policy)
  - [x] Swipe flick speed uses the device clock; e2e swipe test fixed (drag lengths / driver speed)
  - [x] Full check: 92 unit + 16 e2e (×2) pass, production build, live tick
  - [x] README: features, costs, security summary
  - Later / optional: public "portfolio" copy without personal details; drag-and-drop; realtime sync; school account once SCHOOL approves

## 12. Verification (each phase)
- `npm run test` (Vitest) covers relative dates, dedupe, conflicts, ICS changes/removals, urgent bridge rules, rollover, and cross-check.
- `npm run e2e` (Playwright) runs in demo mode.
- Manual demo in the browser (and on your phone from Phase 3 on), with screenshots.
- Status page shows a green sync for each source.
- `npm run pipeline:dry` shows what the AI would add, without writing anything.
