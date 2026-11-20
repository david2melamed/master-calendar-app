# Request to school IT admins

You don't need to send this until you're ready. The app works fully with only the personal account, and the school accounts become a "Connect" button in Settings once they're approved.

Both schools use Google Workspace (confirmed through their mail servers):
- **SCHOOL:** student@school.example.org
- **Other school:** student@other-school.example.org

**OAuth Client ID:** `<your-client-id>.apps.googleusercontent.com`
(Find it in Google Cloud → Google Auth Platform → Clients. It's public, not secret.)

---

## Email to send (copy and paste)

> **Subject:** Request to allow a personal read-only calendar app for my school account
>
> Hi,
>
> I've built a personal calendar app for my own use that combines my school and personal calendars so I don't miss deadlines. Could you please allow it to access **my account only**, read-only?
>
> - **App name:** Master Calendar (personal project, not distributed)
> - **OAuth Client ID:** `<your-client-id>.apps.googleusercontent.com`
> - **Scopes requested (read-only):**
>   - `https://www.googleapis.com/auth/gmail.readonly`: to detect event dates in emails
>   - `https://www.googleapis.com/auth/calendar.readonly`: to show my school calendars
>   - plus the standard `openid` and `email` scopes to identify the account
>
> The app can't send email, change, or delete anything in my school account.
>
> **How to allow it (Google Admin console):**
> 1. Go to **Security → Access and data control → API controls**.
> 2. Click **Manage Third-Party App Access → Configure new app**.
> 3. Search for the OAuth Client ID above and select **Master Calendar**.
> 4. Scope it to my user (or an OU or group containing only me).
> 5. Set access to **Trusted**. ("Limited" may also work if Gmail and Calendar aren't restricted services.)
>
> If you'd rather not grant Gmail access, approving only Calendar (read-only) would still help a lot.
>
> Thank you!
> [Your name]

---

## Fallbacks if they say no
- **Calendar only:** if they allow `calendar.readonly` but not Gmail, the app still shows your school calendars.
- **Auto-forwarding:** if Gmail access is denied but auto-forwarding to you@example.com is allowed, set it up in the school Gmail (Settings → Forwarding). The AI pipeline will catch those emails from your personal inbox.
- **No access at all:** the app keeps working with your personal account and Blackbaud.
