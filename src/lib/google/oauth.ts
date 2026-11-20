import "server-only";
import { CodeChallengeMethod, OAuth2Client } from "google-auth-library";
import { env, googleRedirectUri } from "@/lib/env";

export function oauthClient(): OAuth2Client {
  return new OAuth2Client({
    clientId: env().GOOGLE_CLIENT_ID,
    clientSecret: env().GOOGLE_CLIENT_SECRET,
    redirectUri: googleRedirectUri(),
  });
}

export type AuthUrlOptions = {
  scopes: string[];
  state: string;
  codeChallenge: string;
  /** offline = we want a refresh token (data accounts). */
  offline: boolean;
  loginHint?: string;
};

export function buildAuthUrl(o: AuthUrlOptions): string {
  return oauthClient().generateAuthUrl({
    scope: o.scopes,
    state: o.state,
    code_challenge: o.codeChallenge,
    code_challenge_method: CodeChallengeMethod.S256,
    access_type: o.offline ? "offline" : "online",
    // "consent" guarantees Google re-issues a refresh token on every connect.
    prompt: o.offline ? "consent" : "select_account",
    ...(o.loginHint ? { login_hint: o.loginHint } : {}),
  });
}

export async function newPkce() {
  const { codeVerifier, codeChallenge } = await oauthClient().generateCodeVerifierAsync();
  if (!codeChallenge) throw new Error("Could not create PKCE challenge");
  return { codeVerifier, codeChallenge };
}

/** Exchange the one-time code for tokens and verify the ID token's signature + audience. */
export async function exchangeCode(code: string, codeVerifier: string) {
  const client = oauthClient();
  const { tokens } = await client.getToken({ code, codeVerifier });
  if (!tokens.id_token) throw new Error("Google did not return an ID token");
  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token,
    audience: env().GOOGLE_CLIENT_ID,
  });
  const p = ticket.getPayload();
  if (!p?.email || !p.email_verified) throw new Error("Google account email is not verified");
  return {
    email: p.email.toLowerCase(),
    name: p.name ?? null,
    refreshToken: tokens.refresh_token ?? null,
    accessToken: tokens.access_token ?? null,
    grantedScopes: (tokens.scope ?? "").split(" ").filter(Boolean),
  };
}
