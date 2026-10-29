# Job status and LinkedIn mapping

The publication is the source of truth for job availability. The legacy `hiring_requisitions.status` column remains `draft` because its applied CHECK permits only that value. Staff list tools return an effective status from the publication, pause control and lifecycle state. `hiring_requisitions.lifecycle_status` mirrors new publication and pause changes; older records can have a null mirror until their next change.

| App status | LinkedIn observation | Public discovery |
| --- | --- | --- |
| `draft` | No posting | Hidden |
| `published` | `active` | Visible while the expiry date is in the future or absent |
| `paused` | `paused` | Hidden |
| `expired` | `expired` | Hidden; can be republished on the same requisition |
| `closed` | `closed` | Hidden; final closure |

`record_linkedin_status` accepts `active`, `paused`, `expired`, or `closed`, an optional `expiry_date`, a reason, `expected_version` and a unique operation ID. Active and paused observations can update a published or paused posting. Expired and closed observations can update a published, paused, or already expired posting. Recording `expired` again on an expired posting is accepted and advances its version. A new active observation cannot reopen an expired or closed posting. Every accepted observation increments the publication version and writes audit and activity rows. This tool records an observation; it does not query LinkedIn.

`set_linkedin_job_id` records the current external ID and optionally the expiry date. `get_job_linkedin_status` reads them; `find_job_by_linkedin_id` searches current and historical IDs within authorized scope. `set_job_expiry_date` changes or clears the date separately. The date hides a job from public reads and candidate submission when reached. Record an `expired` observation to make the stored lifecycle state explicit.

`republish_job_requisition` moves an expired posting to `published` with a new LinkedIn ID on the **same requisition ID**. Existing applications retain that ID. The immutable `hiring_linkedin_repost_history` stores each ID assignment or change with previous and new ID, actor, reason and timestamp. `list_linkedin_repost_history` exposes it to authorized staff.

All timestamps exposed by these tools use **Unix seconds**: `expiry_date`, `performed_at`, `since`, `from_ts`, `to_ts`, and `reposted_at`. `from_ts` and `since` are inclusive; `to_ts` is exclusive. `session_start` defaults to the last 24 hours. `log_external_action` also accepts a millisecond `performed_at` from older clients and converts it to seconds before storing it. The remaining timestamp inputs are seconds.

`expected_version` is `hiring_job_publications.version`, not the requisition version. Read it from `get_job_linkedin_status`, `find_job_by_linkedin_id`, or `list_requisitions` and pass it to lifecycle write tools. A stale value raises `version_mismatch_current_<version>`; invalid state changes raise `invalid_transition_from_<state>_to_<state>`. A missing or unauthorized requisition raises `not_found`. Other invalid values raise specific errors. The SQL batch rolls back on refusal.

`set_linkedin_job_id`, `set_job_expiry_date`, `expire_job_requisition`, `record_linkedin_status`, and `republish_job_requisition` each update the publication and append a `hiring_audit_events` row and an `mcp_audit_log` activity row in one batch. `log_external_action` writes to `external_actions` and both audit tables in one batch. `query_audit_log` and `get_activity_timeline` also include historical hiring audit events, including the migration 0061 FreeGameStore correction. `session_start` includes these events when they fall in the requested window.

The lifecycle schema is introduced in `0059_job_lifecycle`; `0060_requisition_linkedin_state` adds the requisition mirror. Migration `0061_expire_freegamestore_intern` targets the single FreeGameStore Developer Intern requisition whose ID begins `658e8dce`, records an audit event, and expires its published posting. It acts only when the ID prefix, title, brand and current publication state match exactly one requisition. The migrations are additive.
