# Organisation recruiting playbook

Hiring is the source of truth for the versioned organisation recruiting policy
(#77, parent #76). No application or interview schema or historical record changes.

## Access and actions

Both actions require authentication and active, tenant-matched
`hiring_effective_access`. Requisition-only grants do not permit org policy access.
The existing schema has no manager or agent role: the organisation creator with
active owner access is the policy manager. Only that owner may save. Owners and
recruiters with non-requisition-scoped access may read the shared org policy.
An agent must act as an authenticated principal explicitly granted recruiter access;
an instance identifier or agent claim alone grants nothing. Revocations and suspended
organisations take effect immediately. Recruiters cannot save this policy.

- `get_org_recruiting_playbook(organization_id)` returns the latest `version`,
  redacted JSON text `payload`, `updated_at`, `actor_user_id`, and `message`.
  Authorised reads with no policy return version 0, null payload/metadata and
  "No playbook configured". Unauthorised reads return no rows, including the fallback.
- `save_org_recruiting_playbook(organization_id, payload, expected_version, operation_id)`
  accepts a JSON object encoded as a string and an integer expected version.
  Use 0 for initial creation. Every save inserts a new immutable version.
  A stale expected version aborts with "version conflict: playbook was modified concurrently".
  Reload, review the intervening policy, and explicitly retry with a fresh operation ID.
  A duplicate operation ID fails; it cannot create a duplicate version.
  The final batch statement returns `version` and `updated_at`.
  No write permission or invalid version/blank operation ID yields no inserted row.
  Invalid JSON/non-object policy aborts; callers must verify the batch result.

An insert trigger creates `hiring_org_playbook_audit` evidence in the same transaction:
organisation, version, actor, operation ID, timestamp and action. This dedicated
org-level ledger avoids inventing a brand for the existing brand-required audit
table. Audit failure rolls back the policy insert. Both tables reject updates and
deletes; audit metadata contains no policy content or meeting secrets.

## Payload contract

Policy is a JSON object so categories can evolve without invalidating past versions.
Recommended structure (example only, never a default or authorisation to act):

```json
{
  "intake": {
    "allowed_channels": ["linkedin"],
    "campaign_identifiers": [{"campaign_id": "approved-campaign", "ad_id": "approved-ad"}]
  },
  "provenance": {
    "required_fields": ["source", "source_detail", "lawful_basis", "evidence_reference", "notice_version"]
  },
  "role_to_interns": [
    {"role_id": "role", "pd_reference": "approved-pd-version", "onboarding_reference": "approved-onboarding"}
  ],
  "approved_templates": [{"template_id": "template", "version": 1}],
  "meeting": {
    "cadence": "daily",
    "timezone": "Australia/Melbourne",
    "join_instructions": "Request an approved candidate invitation",
    "secret_meeting_reference": "secure-reference"
  },
  "working_interview": {
    "stages": ["invite_to_daily", "observe_team_standup", "remain_for_one_to_one"],
    "approval_required": true
  },
  "candidate_rules": {"statuses": [], "owner_assignment": "recruiter assigns explicitly"},
  "discord_handoff": {"approval_required": true},
  "exceptions": {"approver": "organisation owner", "evidence_required": true},
  "privacy": {"notice_reference": "approved-notice"},
  "retention": {"policy_reference": "approved-retention-policy"}
}
```

All `secret_*` and `meeting_password` keys are removed recursively, including in
arrays, from every registered read (even owner reads). Matching is case insensitive.
Store secure meeting references only under these keys; do not copy credentials into
ordinary join instructions, templates or prose. The stored immutable policy retains
the original references. This feature supplies no public or unredacted secret-read
action and does not authorise invitations, email delivery or Discord handoffs.

## Agent bootstrap and fallback

Keep instance configuration concise: "Before recruiting activity, load Hiring's
get_org_recruiting_playbook for the authorised organisation and follow its current
version. Do not cache mutable recruiting policy in instance instructions."

If the policy is absent, access is denied, or loading fails, stop policy-dependent
outreach, invitations and handoffs and request configuration from the organisation
owner. Do not infer permission from this example, another tenant, or an old cached
policy. Record the loaded policy version with subsequent workflow evidence when
the working-interview integration is implemented (#78/#79).

## Stacked delivery

This branch is based on `feat/recruiter-pipeline-filters` at `8072cb5` (open PR #75,
itself based on `feat/admin-operations-66`). Target the pipeline branch until its
stack lands, then retarget/rebase to main. This PR implements #77 under #76;
workflow UI and the remaining integration are follow-ups. Do not merge or deploy
as part of this task.
