import { AppMark } from "@/components/ui/AppMark";

export const metadata = { title: "Privacy · Master Calendar" };

/** Public page required by Google's consent screen (Branding → privacy policy URL). */
export default function PrivacyPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-14 text-[15px] leading-relaxed">
      <div className="mb-6 flex items-center gap-3">
        <AppMark size={36} />
        <h1 className="text-2xl font-semibold tracking-tight">Privacy Policy</h1>
      </div>
      <p className="text-muted">Master Calendar is a private, personal app used by a single person (its owner). It is not offered to the public.</p>

      <h2 className="mt-8 font-semibold">What it accesses</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
        <li>Google Calendar events from the owner&apos;s own accounts, to show them in one calendar.</li>
        <li>New emails in the owner&apos;s Primary inbox, to detect event dates and deadlines.</li>
        <li>On the owner&apos;s personal account only: creating events on two app-specific calendars, and sending notification emails to the owner.</li>
      </ul>

      <h2 className="mt-8 font-semibold">What it stores</h2>
      <p className="mt-2 text-muted">
        Event details (title, time, location), message IDs to avoid processing an email twice, and short quotes that show why an
        event was detected. Full email bodies are not stored. OAuth tokens are encrypted at rest.
      </p>

      <h2 className="mt-8 font-semibold">Sharing</h2>
      <p className="mt-2 text-muted">
        Data is never sold or shared. To detect events, the text of new emails is sent to Anthropic&apos;s Claude API for
        processing. Google user data is used only to provide the app&apos;s features to the owner, in line with the Google API
        Services User Data Policy, including its Limited Use requirements.
      </p>

      <h2 className="mt-8 font-semibold">Deleting data</h2>
      <p className="mt-2 text-muted">
        The owner can disconnect any account at any time in Settings or at myaccount.google.com/permissions, which stops all
        access. Contact: you@example.com.
      </p>
    </main>
  );
}
