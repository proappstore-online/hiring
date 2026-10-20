# Hiring

Hiring is a planned multi-brand applicant tracking system. This repository currently contains a ProAppStore starter, not a working ATS. The implementation baseline is [docs/README.md](docs/README.md).

- `web/`: Vite/React shell with PAS-native Google and GitHub staff sign-in; candidate intake remains closed.
- `marketing/`: Astro starter copy and draft legal pages, not approved Hiring claims.
- `migrations.json`, `mcp.json`: a default-closed public intake gate plus the authenticated internal recruiter workspace schema and actions; the legacy `items` table remains unused.
- `.github/workflows/`: CI, compliance and main-branch deploy.

See [internal workspace setup](docs/internal-workspace.md). Run `pnpm install && pnpm dev`, `pnpm test`, and `pnpm build`. Main is the delivery branch; no PRs. A push to main triggers deployment. Follow [CLAUDE.md](CLAUDE.md) and the [platform guide](https://proappstore.online/skills.md). Do not treat the starter's placeholder owner, copy, schema or tools as product decisions.

Google sign-in uses the shared PAS OAuth client. The [operator setup note](docs/google-sign-in.md) records the exact Google Cloud Console redirect URI and platform secrets; Hiring does not need a Google secret.
