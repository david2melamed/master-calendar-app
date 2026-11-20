import { Suspense } from "react";
import { Skeleton } from "@/components/ui/Skeleton";
import { aiStats } from "@/lib/ai/stats";
import { getBlackbaudState } from "@/lib/blackbaud/sync";
import { listAccounts, roleForEmail, type Account } from "@/lib/accounts";
import { requireSession } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { calendarsFor } from "@/lib/google/calendar";
import { missingScopes, shortScope } from "@/lib/google/scopes";
import { openErrors, recentActivity } from "@/lib/status";
import { fmtET } from "@/lib/time";

const BANNERS: Record<string, { tone: "ok" | "bad"; text: (email?: string) => string }> = {
  connected: { tone: "ok", text: (e) => `Connected ${e}.` },
  blocked: { tone: "bad", text: (e) => `${e} is blocked by the school's Google admin. See docs/ADMIN-REQUEST.md.` },
  cancelled: { tone: "bad", text: () => "Connection was cancelled." },
  google: { tone: "bad", text: () => "Google couldn't complete the connection. Try again." },
  not_connectable: { tone: "bad", text: () => "That account isn't one of your three configured accounts." },
  no_refresh_token: { tone: "bad", text: (e) => `Google didn't grant offline access for ${e}. Try Reconnect.` },
  bb_ok: { tone: "ok", text: () => "Blackbaud checked." },
  bb_error: { tone: "bad", text: () => "Blackbaud check failed — see Problems below." },
};

export default function SettingsPage({ searchParams }: PageProps<"/settings">) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-4 pb-16 pt-[max(2rem,env(safe-area-inset-top))] sm:px-6">
        <Suspense fallback={<SettingsSkeleton />}>
          <SettingsContent searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}

function SettingsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading settings">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="mt-2 h-4 w-72" />
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="mt-8 h-40 w-full rounded-2xl" />
      ))}
    </div>
  );
}

async function SettingsContent({ searchParams }: { searchParams: PageProps<"/settings">["searchParams"] }) {
  const session = await requireSession();
  const sp = await searchParams;
  const [accounts, errors, activity, bb] = await Promise.all([
    listAccounts(),
    openErrors(),
    recentActivity(),
    getBlackbaudState(),
  ]);
  const ai = await aiStats();
  const aiOn = !!env().ANTHROPIC_API_KEY;
  const bbConfigured = !!env().BLACKBAUD_ICS_URL;
  const byEmail = new Map(accounts.map((a) => [a.email, a]));

  const bannerKey =
    typeof sp.connected === "string"
      ? "connected"
      : typeof sp.error === "string"
        ? sp.error
        : typeof sp.bb === "string"
          ? `bb_${sp.bb}`
          : null;
  const bannerEmail = (typeof sp.connected === "string" ? sp.connected : sp.email) as string | undefined;
  const banner = bannerKey ? BANNERS[bannerKey] ?? BANNERS.google : null;

  return (
    <>
      <header className="mb-8 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Settings &amp; Status</h1>
          <p className="mt-1 text-sm text-muted">Signed in as {session.email}</p>
        </div>
        <form action="/api/auth/logout" method="post">
          <button className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-text">
            Sign out
          </button>
        </form>
      </header>

      {banner && (
        <div
          role="status"
          className={`mb-6 rounded-xl px-4 py-3 text-sm ${banner.tone === "ok" ? "bg-success-soft text-success" : "bg-danger-soft text-danger"}`}
        >
          {banner.text(bannerEmail)}
        </div>
      )}

      <Section title="Connected accounts" subtitle="Calendars and Primary inbox from each account.">
        <ul className="divide-y divide-border">
          {env().CONNECTABLE_EMAILS.map((email) => (
            <AccountRow key={email} email={email} account={byEmail.get(email)} />
          ))}
        </ul>
      </Section>

      <Section title="Blackbaud" subtitle="Assignments from your Blackbaud feed. Checked every hour, and always at 5 PM.">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div className="min-w-0 text-sm">
            {!bbConfigured ? (
              <p className="text-muted">Not set up yet — add BLACKBAUD_ICS_URL (see docs/SETUP.md).</p>
            ) : (
              <>
                <p className="font-medium">{bb.count ?? 0} assignments</p>
                <p className="mt-0.5 text-xs text-muted">
                  {bb.lastCheckedAt ? `Last checked ${fmtET(new Date(bb.lastCheckedAt), "MMM d, h:mm a")}` : "Not checked yet"}
                  {bb.lastChangedAt && ` · last change ${fmtET(new Date(bb.lastChangedAt), "MMM d, h:mm a")}`}
                </p>
              </>
            )}
          </div>
          {bbConfigured && (
            <form action="/api/blackbaud/check" method="post">
              <button className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-surface-2">
                Check now
              </button>
            </form>
          )}
        </div>
      </Section>

      <Section title="Email AI" subtitle="New Primary-inbox emails are checked every 5 minutes for events.">
        <div className="px-5 py-4 text-sm">
          {!aiOn ? (
            <p className="text-muted">Not set up yet — add ANTHROPIC_API_KEY (see docs/SETUP.md).</p>
          ) : (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p>
                  <span className="text-lg font-semibold tabular-nums">${ai.spend.total.toFixed(2)}</span>
                  <span className="text-muted"> of ${ai.caps.pause.toFixed(2)} this month</span>
                </p>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    ai.mode === "normal" ? "bg-success-soft text-success" : ai.mode === "haiku_only" ? "bg-warning-soft text-warning" : "bg-danger-soft text-danger"
                  }`}
                >
                  {ai.mode === "normal" ? "Active" : ai.mode === "haiku_only" ? "Haiku only (over $1.50)" : "Paused until next month"}
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${Math.min(100, (ai.spend.total / ai.caps.pause) * 100)}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-muted">
                Haiku ${ai.spend.haiku.toFixed(3)} · Sonnet ${ai.spend.sonnet.toFixed(3)} (cap ${ai.caps.sonnet.toFixed(2)}) ·{" "}
                {ai.spend.calls} AI calls
              </p>
              <p className="mt-3">
                <span className="font-medium">{ai.added}</span> events added from{" "}
                <span className="font-medium">{ai.emails.checked}</span> emails read by AI ·{" "}
                <span className="text-muted">{ai.emails.skipped} skipped free (newsletters, promos…)</span>
                {ai.emails.waiting > 0 && <span className="text-muted"> · {ai.emails.waiting} waiting</span>}
              </p>
              {ai.ignoredSenders.length > 0 && (
                <p className="mt-2 text-xs text-muted">Ignored senders: {ai.ignoredSenders.join(", ")}</p>
              )}
            </>
          )}
        </div>
      </Section>

      <Section title="Problems" subtitle="Anything failing shows up here — nothing fails silently.">
        {errors.length === 0 ? (
          <p className="px-5 py-4 text-sm text-muted">All clear.</p>
        ) : (
          <ul className="divide-y divide-border">
            {errors.map((e) => (
              <li key={e.id} className="px-5 py-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">{e.source}</span>
                  <span className="text-xs text-faint">
                    {e.count}× · last {fmtET(e.lastSeenAt, "MMM d, h:mm a")}
                  </span>
                </div>
                <p className="mt-0.5 text-danger">{e.message}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Recent activity">
        {activity.length === 0 ? (
          <p className="px-5 py-4 text-sm text-muted">Nothing yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {activity.map((a) => (
              <li key={a.id} className="flex justify-between gap-3 px-5 py-2.5 text-sm">
                <span>{a.message}</span>
                <span className="shrink-0 text-xs text-faint">{fmtET(a.at, "MMM d, h:mm a")}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="mb-6 overflow-hidden rounded-2xl border border-border bg-bg shadow-sm">
      <div className="border-b border-border bg-surface px-5 py-3.5">
        <h2 className="text-sm font-semibold">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

const STATUS: Record<string, { label: string; cls: string }> = {
  connected: { label: "Connected", cls: "bg-success-soft text-success" },
  missing_scopes: { label: "Missing permissions", cls: "bg-warning-soft text-warning" },
  needs_reconnect: { label: "Needs reconnect", cls: "bg-danger-soft text-danger" },
  blocked: { label: "Blocked by admin", cls: "bg-danger-soft text-danger" },
  error: { label: "Error", cls: "bg-danger-soft text-danger" },
  none: { label: "Not connected", cls: "bg-surface-2 text-muted" },
};

async function AccountRow({ email, account }: { email: string; account?: Account }) {
  const role = roleForEmail(email);
  const connected = !!account?.encryptedRefreshToken;
  const status = STATUS[account?.status && (connected || account.status !== "connected") ? account.status : "none"];
  const cals = account && connected ? await calendarsFor(account.id) : [];
  const missing = account ? missingScopes(role, account.scopes) : [];
  const synced = cals.map((c) => c.lastSyncedAt).filter((d): d is Date => !!d);
  const lastSync = synced.length ? new Date(Math.max(...synced.map(Number))) : null;

  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{email}</span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${status.cls}`}>{status.label}</span>
          </div>
          <p className="mt-0.5 text-xs text-muted">
            {role === "personal" ? "Main account · read & write" : "School account · read-only"}
            {account?.lastConnectedAt && ` · connected ${fmtET(account.lastConnectedAt, "MMM d, h:mm a")}`}
            {lastSync && ` · calendars synced ${fmtET(lastSync, "MMM d, h:mm a")}`}
          </p>
        </div>
        <a
          href={`/api/accounts/connect?email=${encodeURIComponent(email)}`}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors duration-150 ${
            connected
              ? "border border-border text-text hover:bg-surface-2"
              : "bg-accent text-accent-fg hover:bg-accent-hover"
          }`}
        >
          {connected ? "Reconnect" : "Connect"}
        </a>
      </div>

      {account?.statusDetail && <p className="mt-2 text-xs text-danger">{account.statusDetail}</p>}
      {connected && missing.length > 0 && (
        <p className="mt-2 text-xs text-warning">
          Not granted: {missing.map(shortScope).join(", ")}. Click Reconnect and tick every box.
        </p>
      )}

      {cals.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {cals.map((c) => (
            <li
              key={c.id}
              className="flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-xs"
            >
              <span className="size-2 rounded-full" style={{ background: c.colorHex ?? "var(--accent)" }} />
              {c.summary}
              {c.isPrimary && <span className="text-faint">· primary</span>}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
