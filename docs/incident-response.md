# Incident response and breach decisions (#48)

Version 1 — 2026-10-24. Accountable commander: Serge (`serge-ivo`).
This is the canonical incident playbook; [release operations](release-operations.md)
continues to govern rollback and recovery. Review after every incident, exercise,
processor or jurisdiction change; increment version and retain previous revisions
in Git. Readiness is blocked by the approvals listed below, not implied by tests.

## Command and escalation

| Responsibility | Current assignment | Required private record |
| --- | --- | --- |
| Commander and release authority | Serge (`serge-ivo`) | Verified paging channel and acknowledgement |
| Backup commander | Unconfirmed | Named distinct person, authority and tested contact |
| Platform operations | Unconfirmed | Auth/session, D1/R2 and containment escalation route |
| MAIL and installed processors | Unconfirmed | Contract security contact, fallback, response commitment |
| Notification decision authority | Unconfirmed | Owner-appointed authority for each approved jurisdiction |

Keep the contact register in restricted operator storage, referenced by incident
ID. Do not place personal contacts, secrets or candidate evidence in GitHub.
At detection page commander and backup concurrently. Target acknowledgement in
15 minutes; if absent, escalate to platform operations and continue paging every
15 minutes until a responsible operator acknowledges. These are internal targets,
not statutory deadlines. If no verified route exists, record failed escalation and
keep intake/dispatch held; never invent a successful contact or a backup identity.

## Triage and containment

1. Open a restricted incident record using the template below. Record UTC detection,
   earliest suspected exposure and awareness times separately; preserve uncertainty.
2. Treat suspected cross-brand access, stolen session or credential exposure as
   critical until bounded. Delivery-only outages follow [monitoring](operational-monitoring.md);
   promote to a privacy incident if unintended recipient/data access is possible.
3. Use exact organization/brand scope. Inspect `get_operational_health` and
   `inspect_operational_jobs` with current owner/auditor authority; preserve the
   deployed SHA and audit references before changing access.
4. For staff exposure use `revoke_workspace_grant` or
   `revoke_workspace_membership` for every overlapping applicable grant. See
   [permissions](permissions.md): owner/self revocation is unavailable. Escalate
   unsupported revocation and session invalidation to platform operations.
5. Candidate tokens require authenticated ownership, exact application and purpose,
   expire after 15 minutes, and are not anonymous bearer links. There is no dedicated
   token revocation action. Do not claim issuing a replacement invalidates earlier
   tokens. For suspected session theft request platform session invalidation and
   restrict the affected service through supported platform controls until denial
   is verified. Token expiry alone does not invalidate a stolen session, which can
   issue more tokens and use compatibility actions. See [candidate intake](candidate-intake.md).
6. Pause affected intake/dispatch through approved controls where available; if
   unavailable request platform containment and keep release held. Hiding UI is
   insufficient. Verify containment with fresh authenticated requests, including
   existing sessions, alternate grants and candidate compatibility actions.

## Affected-tenant and candidate assessment

Build a private scope matrix: organization, brand, requisition, application,
subject count, categories, exposure interval, successful/denied reads, exports,
attachments, recipient and processor copies. Distinguish confirmed exposure,
possible exposure and verified exclusions with supporting references. Bound both
source and destination brands; do not infer isolation from a single denied request.
Use least-privilege authorized queries, not a new global search or audit bypass.
Record confidentiality, integrity and availability impact, possible withdrawal or
field changes, and whether sensitive content may have been supplied despite form
policy. Unknown access logs mean unknown impact, not zero affected candidates.

## Evidence handling and processor contact

Preserve append-only audit, deployed code/schema version, request times and safe
provider references. In restricted storage record collector, UTC collection time,
source, checksum, each access/transfer and custodian. Minimize copies, encrypt and
restrict access; preserve relevant evidence under an authorized hold and review its
retention with the owner. Never copy live tokens, candidate content or message
bodies into source control, alerts or public issues. Do not destroy evidence by
resetting queues or overwriting logs.

Contact platform, MAIL and each involved installed processor through verified
contract channels. Send incident ID, minimum necessary scope/time range and a
preservation/containment request. Record acknowledgement, onward recipients,
subprocessors, confirmed copies, deletion/rectification needs and next update.
Escalate missed contract response times to commander; no acknowledgement means
processor impact remains unknown. Reconcile ambiguous sends using the existing
[recovery procedure](release-operations.md), never blind resend.

## Jurisdiction and notification decision

No approved jurisdiction list or notification authority has been supplied. The
[owner policy](privacy-governance.md) does not invent either and requires no
external legal review gate. Serge appoints and records the appropriate decision
authority; do not substitute a hard-coded universal deadline or assert compliance.
For each affected controller and subject jurisdiction, authority must record:

| Decision field | Required record |
| --- | --- |
| Applicability | Approved jurisdiction, controller/processor role, authority and approved policy/legal source version |
| Clock | Relevant awareness trigger and UTC timestamp, uncertainty, deadline rule, computed UTC due time |
| Threshold | Facts, risk/severity, affected categories/counts and reason notification is or is not required |
| Recipients | Controller, regulator, affected candidates, processor or other required recipients |
| Approval | Named decision authority, decision time, approved message version and channel |
| Delivery | Sent time, receipt/reference, failures, follow-up and next review time |

Missing jurisdiction, trigger or authority is an urgent unresolved decision:
escalate immediately, preserve earliest plausible clock and arrange prompt review.
Do not wait for full investigation to assess deadlines; authority records whether
phased reporting is required. A no-notify decision requires rationale and review
on new facts. Keep each decision append-only, superseding earlier entries by ID.
Only publish the exact approved notice; no unreviewed public claim, compliance
assurance or statement that no candidates were affected. This approval concerns
incident communications and does not add an external legal review launch gate.

## Recovery and closure

Fix root cause; test fresh and existing sessions, cross-brand reads/search/exports,
assignment limits and affected candidate actions. Confirm containment privately,
reconcile uncertain provider outcomes and preserve holds/tombstones across rollback.
Commander records evidence and authorizes staged reopening, watches recurrence,
and owns residual risk. Within two working days target a retrospective recording
root cause, candidate impact, decisions, remediation owner/due date, retests and
follow-up review. Operational targets do not replace applicable notification clocks.

## Restricted incident record template

- Incident ID, playbook version, status, environment and deployed SHA.
- Reporter; UTC detection, suspected exposure and awareness times; uncertainty.
- Commander, backup acknowledgement, escalation attempts and contact-register reference.
- Severity, affected-tenant matrix, candidate impact and processor scope.
- Containment action/time/actor, fresh-request evidence and unresolved access.
- Evidence inventory/checksums/custody and preservation/hold decisions.
- Processor contact, acknowledgement, obligations and next update.
- Per-jurisdiction notification decision fields from the table above.
- Remediation, verification, reopening authority/time and residual risk.
- Follow-up actions, owners, due dates, closure and next review.

## Exercises and readiness

[Tabletop walkthroughs](incident-tabletops.json) record two synthetic desk exercises
performed during repository review on 2026-10-24. They are reasoning walkthroughs,
not live drills or owner/backup participation. Their containment outcomes remain
unverified. `tests/incident-response.test.mjs` checks coverage and prevents these
records being mistaken for launch evidence. Before marking #48 operationally ready,
confirm the private contact register, backup and jurisdiction decisions; run both
scenarios with named operators in isolation; attach actual detection, contact,
denial, notification decision and remediation evidence to the launch register.
