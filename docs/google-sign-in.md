# Google sign-in operator setup

Hiring uses PAS-native Google OAuth through `app.auth.signIn('google')`. The installed `@proappstore/sdk` supports `google` as an auth provider, and the PAS host marks `hiring.proappstore.online` for its same-origin, HttpOnly cookie flow. Hiring does not exchange OAuth codes, store Google tokens or handle a Google client secret.

## Current production configuration

The live PAS Google start endpoint redirected to Google on 2026-10-20 with the callback below. This confirms that the PAS Google client ID is configured and Hiring's return URL is accepted. It does not prove an end-user login has completed; an operator should test that with an authorized Google account.

| Setting | Value |
| --- | --- |
| Google Cloud Console client type | Web application |
| Authorized redirect URI | `https://api.proappstore.online/v1/auth/google/callback` |
| OAuth scopes requested by PAS | `openid email profile` |
| PAS backend base URL | `APP_BASE=https://api.proappstore.online` |
| PAS backend credentials | `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, stored as secrets on the PAS API Worker |
| Hiring repo variables or secrets | None for Google sign-in |

If creating or replacing the shared PAS Google OAuth client, the PAS operator configures its consent screen and test users or publication status in Google Cloud Console, adds the **exact** authorized redirect URI above, and sets the ID and secret on the PAS API Worker. The callback belongs to PAS, not `hiring.proappstore.online`; no Hiring callback URL, browser client secret or JavaScript origin is required for this flow. The existing PAS `SESSION_SIGNING_KEY` remains a platform secret for sessions.

Google's [web-server OAuth guide](https://developers.google.com/identity/protocols/oauth2/web-server) requires an exact redirect URI match and keeping the client secret outside the source tree.

After a credential change, check that `/.pas/auth/start?provider=google&return_to=%2F` on the Hiring host redirects through PAS to Google, then complete a sign-in with an authorized account and confirm the Hiring page loads. GitHub remains available as a second native provider. A Google account and a GitHub account have different PAS user IDs even if their emails match; Hiring membership and brand grants must use the stable PAS user ID and never infer access from email equality.

Candidate intake remains closed. Staff sign-in does not grant access to another organization or brand by itself. The internal workspace grants the creator owner access and lets that owner add recruiters by exact PAS user ID; see [internal workspace](internal-workspace.md).
