# Hiring

Hiring is an early multi-brand applicant tracking system. The first private recruiter workflow is live; public intake and communication sending remain closed. The implementation baseline is [docs/README.md](docs/README.md). Navigation uses [public and scoped recruiter routes](docs/routing.md).

- `web/`: Vite/React shell with PAS-native Google and GitHub staff sign-in; candidate intake remains closed.
- `marketing/`: Astro starter copy and draft legal pages, not approved Hiring claims.
- `migrations.json`, `mcp.json`: a default-closed public intake gate plus the authenticated internal recruiter workspace schema and actions; the legacy `items` table remains unused.

Recruiters and agents add candidates with `create_application`, recording any source (email,
referral, LinkedIn, job board, manual import or a custom source) and an optional profile URL.
The workspace form is **Add candidate**. The older `create_linkedin_application` action remains
available for existing callers. Source and contact evidence, assignment, tenant access and the
creation audit are recorded together. Creating an application does not send email.

For a trusted Hiring agent in ProAgentStore, grant **Read & write access to this server** for
`https://mcp.proappstore.online/mcp/apps/hiring` once. This also covers newly added Hiring
actions; individual tool selection remains available under Advanced permissions. The Hiring
server continues to enforce the connected user's organization and brand access.
- `.github/workflows/`: CI, compliance and main-branch deploy.

See [internal workspace setup](docs/internal-workspace.md). Run `pnpm install && pnpm dev`, `pnpm test`, and `pnpm build`. Main is the delivery branch; no PRs. A push to main triggers deployment. Follow [CLAUDE.md](CLAUDE.md) and the [platform guide](https://proappstore.online/skills.md). Do not treat the starter's placeholder owner, copy, schema or tools as product decisions.

Google sign-in uses the shared PAS OAuth client. The [operator setup note](docs/google-sign-in.md) records the exact Google Cloud Console redirect URI and platform secrets; Hiring does not need a Google secret.

## CI

Every workflow begins with a `router` job that calls
[`ProAgentStore/runner-router`](https://github.com/ProAgentStore/runner-router)
(`.github/workflows/router.yml@v1`), and every other job runs wherever the router says. Which
runner that is depends on whether the repo is public.

**Public repos build on GitHub's own runners, always.** GitHub gives public repos unlimited free
minutes on `ubuntu-latest`, so there is nothing to save, and a public repo must never run on our
self-hosted machines: anyone can open a pull request against it, and that would run their code on
our hardware. The router sees the repo is public, runs itself on `ubuntu-latest`, and sends every
job there. It does not check billing and does not read any secret.

**Private repos use GitHub's runners until the month's included minutes run out.** The router reads
the org's Actions usage. While included minutes remain, jobs run on `ubuntu-latest`. Once they are
spent, or if the usage check fails for any reason, jobs move to the self-hosted `pags` runners so
the pipeline keeps going.

**Secrets.** The router reads usage with a billing token stored as the repo-level secret
`RUNNER_BILLING_TOKEN`, on private repos only. We never use org-level secrets: on GitHub's free
plan a public repo can read them. A private repo without the secret still builds; it just always
uses the self-hosted runners.

**The self-hosted runner group is private-only** and stays that way.

When adding a workflow or job, copy the `router` job and give every job `needs: router` and
`runs-on: ${{ fromJSON(needs.router.outputs.runner) }}`. Never write a runner label on a job
directly.
