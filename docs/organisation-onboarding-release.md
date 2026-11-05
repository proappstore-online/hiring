# Organisation-configurable onboarding: review and release

Issue queue: #115 (feature), #117 (schema/MCP/gate), #116 (recruiter UI).

## Local review

Migration `0073_organization_onboarding` is additive. It adds immutable
organisation policy versions, a frozen policy assignment per application,
candidate step events and a required-step completion guard on both existing
lifecycle ledgers. It leaves historical stages, offers and evidence untouched.
The old FreeAppStore Interns invitation trigger remains deployed; a new guard
allows its pending status and note only when the latest organisation policy
explicitly uses `freeappstore_interns`.

The owner publishes a criteria version in organisation settings. Each step
defines a stable key, label, type and required flag. Changing a policy creates
a new version. An onboarding candidate is assigned one version; later policy
changes do not silently alter that candidate's checklist. Recruiters record
status, value, comments and evidence for individual steps. The acting recruiter
is the verifier of a completed step. Hiring-team reminder tasks stay separate.

Review the migration, MCP SQL, docs, focused tests, `pnpm test`, `pnpm typecheck`
and `pnpm build` on the final revision. Test a second organisation with Slack
criteria and no Interns integration, and a FreeAppStore organisation that opts
into its existing reminder. Use synthetic data only for local checks.

## Production release, after separate approval

Pushing `main` triggers deployment and applies `migrations.json` before MCP
registration and frontend upload. Do not push this work as part of local
review. Before a later release, back up D1, verify that production has no
unreviewed onboarding completions in flight, and plan owners' initial policy
versions. Once deployed, each owner must publish criteria and a recruiter must
assign a policy to each already-onboarding candidate before completion. There
is no automatic conversion of historical evidence into completed steps.
Check the migration and action registration run, then verify scoped policy,
step and lifecycle refusal/readback behaviour with authorised production test
fixtures. No production candidate data should be altered merely to verify the
release.

No tool here signs an agreement, decides an offer, sends an invitation, or
changes a real Discord/Slack/Interns membership.
