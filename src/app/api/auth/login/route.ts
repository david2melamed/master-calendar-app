import { startOAuth } from "@/lib/auth/oauth-flow";
import { LOGIN_SCOPES } from "@/lib/google/scopes";

/** Step 1 of signing in: send the browser to Google's account picker. */
export async function GET() {
  return startOAuth({ purpose: "login", scopes: LOGIN_SCOPES });
}
