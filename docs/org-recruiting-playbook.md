# Organisation recruiting playbook

Internship intake follows the [restricted sourcing and direct Interns onboarding policy](internship-intake.md) (#73). Internship roles remain unlisted, reject generic candidate intake, and follow the separate direct Interns onboarding path under #73. For general recruiting, #76 supersedes the cancelled no-interviews policy: candidates observe daily stand-up, then remain for a one-to-one working interview.

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
policy. Record the loaded policy version with subsequent workflow evidence through the durable working-interview actions (#76/#78/#79).

## Stacked delivery

This branch is based on `feat/recruiter-pipeline-filters` at `8072cb5` (open PR #75,
itself based on `feat/admin-operations-66`). Target the pipeline branch until its
stack lands, then retarget/rebase to main. This PR implements #77 under #76;
workflow UI and the remaining integration are follow-ups. Do not merge or deploy
as part of this task.

## Recruiter workflow UI (#78)

The authenticated `/playbook` route preserves organisation/brand scope and sign-in
return destinations. Recruiters have a read-only view. Only the organisation
creator with owner access receives the JSON replacement editor. Saves use the
loaded expected version; conflicts require reloading and reviewing the policy.
Because even owner reads redact secrets, the editor explicitly requires restoring
required secret references before confirming a complete replacement save.

Candidate detail includes an additive working-interview preview without changing
the existing generic interview stages. Invitations require a configured HH:mm time
and IANA timezone, and describe observing the daily stand-up followed by remaining
for a one-to-one interview. Join details are always a placeholder. Redacted reads
cannot verify secure join configuration: staff must confirm it privately before
recording an invitation already sent through the approved mail workflow.

Working-interview invitations and outcomes are now durable append-only versions in
`working_interview_records` (migration 0048). The UI reloads them from guarded
registered actions; records survive reload and are shared with authorised staff.
No email is sent by these actions. Historical applications show “No working
interview recorded”; invitation-only records have nullable outcome/completion fields.

`create_working_interview_invitation` requires organisation, brand, application,
record ID, invitation text, active owner/recruiter assignee, current playbook version,
operation ID and explicit private secure-join confirmation. Missing playbook or
meeting timing prevents creation. Store the approved invitation without secure join
URLs or credentials. The server never copies policy payload or secrets into records.
`get_working_interview_records` returns latest versions only to current scoped owners
and recruiters; other roles receive no rows (including reviewers and auditors).
`record_working_interview_outcome` accepts record ID, expected version, outcome,
exceptions and operation ID in the same application scope. Only the owning recruiter
or an active owner (the existing manager equivalent) can append an outcome revision.
Stale versions abort; reload and review before retrying. Duplicate operations cannot
create another version. Each version atomically creates a content-free audit event;
audit failure rolls back the write. Previous invitation and outcome versions remain
immutable. No new manager role or public/secret-read capability is introduced.

Delivery is stacked on `feat/org-recruiting-playbook-77` (PR #80), references #78
and parent #76, and preserves the #74 pipeline-filter work. No merge or deployment.

## Agent read contract (#79)

Registered reads now include `schema_version: 1` independently of the stored policy
`version`. See [the agent integration contract](agent-playbook-contract.md) for the
machine-readable response schema, tested caller adapter, bootstrap and operational
migration guidance. No live agent configuration has been changed.

## Parent completion (#76)

The child issues #77, #78 and #79 already define the delivery breakdown. The
stack notes above describe their original delivery dependencies; #74 pipeline
filters are present on main. The durable workflow follow-up uses the owner's
authorised direct-main delivery approach. No PR merge or manual deployment is
performed. A main push invokes the repository's normal deployment workflow.

Working-interview history is protected content under the existing indefinite
retention policy. Store-deletion verification counts every retained version and
reports protected records; it cannot falsely declare whole-subject erasure while
these records remain. Outcomes and exceptions are private staff records, not a
public candidate packet. Any future retention change needs an explicitly governed
purge design, consistent with the existing protected interview and mail archives.
