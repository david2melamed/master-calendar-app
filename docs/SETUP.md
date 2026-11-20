# Setup guide (step by step)

Do these in order. Anything marked 🔒 is a secret: paste it only into `.env` (or Vercel's settings later), never into chat, email, or git.

**Accounts needed now (Phase 1):**
- **A. Google Cloud.** Required now. Free.
- **B. Supabase.** Optional now, required by Phase 3. Free.
- **C. Anthropic.** Wait until Phase 5. Prepaid credits, about $5 once.

---

## A. Google Cloud project + OAuth (≈15 min, $0)

Sign in to every Google page below as **you@example.com**.

### 1. Create the project
1. Go to <https://console.cloud.google.com/>. Accept the terms if it's your first visit.
2. Open the project picker in the top bar and choose **New project**.
3. Set **Project name** to `Master Calendar` and **Location** to "No organization". Click **Create**.
4. Make sure the project picker now shows **Master Calendar**.

### 2. Turn on the APIs
1. Go to **APIs & Services → Library**: <https://console.cloud.google.com/apis/library>.
2. Search for and **Enable** each of these:
   - **Gmail API**
   - **Google Calendar API**

Cloud Pub/Sub is for Phase 5 and may ask for a billing card, so we'll enable it then.

### 3. Set up the consent screen (Google Auth Platform)
Google shows this page differently depending on your account. First check the top bar says **Master Calendar**. If not, pick it in the project picker. Then match what you see:
- **"Select a project" or a blank page:** pick the project, then reload.
- **An "Overview" page with charts and no "Get started" button:** the consent screen already exists. Skip ahead to *Branding / Data Access / Audience* below.
- **"OAuth consent screen" with a "User Type" choice (older layout):**
  1. Under **APIs & Services → OAuth consent screen**, choose External → Create.
  2. Fill in the app name and the two emails → Save and continue.
  3. On the scopes page, add the scopes listed below → Save and continue.
  4. Skip the test users page.
  5. Click **Publish app**.
  6. Then go to step 4. In this layout, clients are under **APIs & Services → Credentials → Create credentials → OAuth client ID**.

New layout: go to <https://console.cloud.google.com/auth/overview> and click **Get started**.
1. **App information:**
   - App name: `Master Calendar`
   - User support email: you@example.com
2. **Audience:** **External**.
3. **Contact information:** you@example.com
4. Agree to the policy, then click **Create**.

Then in the left sidebar:
1. **Branding:** nothing else is required (skip the logo, because a logo triggers a verification review).
2. **Data Access → Add or remove scopes.** Tick these, or paste them into "Manually add scopes":
   ```
   openid
   https://www.googleapis.com/auth/userinfo.email
   https://www.googleapis.com/auth/userinfo.profile
   https://www.googleapis.com/auth/gmail.readonly
   https://www.googleapis.com/auth/gmail.send
   https://www.googleapis.com/auth/calendar
   https://www.googleapis.com/auth/calendar.readonly
   ```
   Click **Update**, then **Save**.
3. **Audience → Publishing status → Publish app → Confirm.** Status should read **In production**.
   - ⚠️ This step is the important one. In "Testing" mode, Google expires your connection every 7 days.
   - Google will say verification is needed for sensitive or restricted scopes. **Don't submit for verification.** A personal app used only by you is allowed to run unverified.

### 4. Create the OAuth client
1. Go to **Clients → Create client**.
2. Set **Application type** to **Web application** and **Name** to `Master Calendar web`.
3. Under **Authorized JavaScript origins**, add `http://localhost:3000`.
4. Under **Authorized redirect URIs**, add `http://localhost:3000/api/auth/google/callback`. (We'll add the Vercel address in Phase 3.)
5. Click **Create**.
6. A dialog shows the **Client ID** and 🔒 **Client secret**. Click **Download JSON** as a backup and keep the file somewhere private. **The secret is only shown once.**

### 5. Put them in `.env`
Open `master-calendar/.env` in VS Code and fill in:
```
GOOGLE_CLIENT_ID=<the client ID, ends in .apps.googleusercontent.com>
GOOGLE_CLIENT_SECRET=<the client secret>
```
The other secrets (`SESSION_SECRET`, `TOKEN_ENCRYPTION_KEYS`, `CRON_SECRET`) are already filled in with random values.

### 6. What you'll see when signing in and connecting
- **Sign in:** a normal Google account picker.
- **Connect account:** a warning screen saying **"Google hasn't verified this app."** This is expected for a private app.
  1. Click **Advanced**.
  2. Click **Go to Master Calendar (unsafe)**.
  3. On the permissions screen, **tick every checkbox**. If you skip one, the Settings page shows "Missing permissions".

---

## B. Supabase database (≈5 min, $0)
You can skip this during local development, because the app uses a built-in local database (`.data/pglite`). It's required for Phase 3 (deploy).

1. Go to <https://supabase.com/dashboard> and sign up. "Continue with GitHub" is easiest once you have GitHub.
2. Click **New project**:
   - Name: `master-calendar`
   - 🔒 Database password: click **Generate**, then save it in your password manager
   - Region: **East US (North Virginia)**
   - Plan: **Free**
3. Once it's ready, click **Connect** (top bar) and choose **ORMs → Drizzle**, or **Connection string → Transaction pooler**.
4. Copy the URI. It looks like `postgresql://postgres.xxxx:[YOUR-PASSWORD]@aws-0-us-east-1.pooler.supabase.com:6543/postgres`.
5. Replace `[YOUR-PASSWORD]` with your database password and paste the result into `.env` as `DATABASE_URL=...`.
6. Run `npm run db:migrate`.

---

## C. Anthropic API key (Phase 5)
1. Go to <https://console.anthropic.com/> and sign up.
2. In **Billing**, buy the minimum prepaid credits (about $5, which should last 5+ months for this app).
3. In **Limits**, set a monthly spend limit of **$2**. This is a safety net; the app itself goes Haiku-only at $1.50 and pauses AI at $2.
4. In **API Keys → Create key**, name it `master-calendar`. Copy the 🔒 key into `.env` as `ANTHROPIC_API_KEY=...` and into Vercel → Environment Variables (Secret, Production), then redeploy.
5. Check what the AI would do without changing anything: `npm run pipeline:dry -- --since 3d` (add `--no-ai` to test only the free filters).


## D. Blackbaud assignments feed (Phase 4)
1. In Blackbaud: **Calendar → the feed (RSS) icon → My Calendars → ▸ Individual Filter Feeds**.
2. Right-click **Assignments** → **Copy Link Address**.
3. Paste it into `.env` as `BLACKBAUD_ICS_URL=<link>` and into Vercel → Environment Variables (Secret, Production), then redeploy.
4. Treat the link like a password: anyone with it can read your assignments. If it leaks, reset it in Blackbaud and repeat these steps.
