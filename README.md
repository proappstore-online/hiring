# Hiring

Hiring is a planned multi-brand applicant tracking system. This repository currently contains a ProAppStore starter, not a working ATS. The implementation baseline is [docs/README.md](docs/README.md).

- `web/`: Vite/React starter UI.
- `marketing/`: Astro starter copy and draft legal pages, not approved Hiring claims.
- `migrations.json`, `mcp.json`: a default-closed Hiring intake gate and its public read action; the legacy `items` table remains from the starter migration but its tools are retired.
- `.github/workflows/`: CI, compliance and main-branch deploy.

Run `pnpm install && pnpm dev`, `pnpm test`, and `pnpm build`. Main is the delivery branch; no PRs. A push to main triggers deployment. Follow [CLAUDE.md](CLAUDE.md) and the [platform guide](https://proappstore.online/skills.md). Do not treat the starter's placeholder owner, copy, schema or tools as product decisions.
