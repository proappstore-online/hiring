# Job status and LinkedIn mapping

The publication is the source of truth for job availability. The legacy `hiring_requisitions.status` column remains `draft` because its applied CHECK permits only that value. Staff list tools return an effective status from the publication, pause control and lifecycle state. `hiring_requisitions.lifecycle_status` mirrors new publication and pause changes; older records can have a null mirror until their next change.

| App status | LinkedIn observation | Public discovery |
| --- | --- | --- |
| `draft` | No posting | Hidden |
| `published` | `active` | Visible while the expiry date is in the future or absent |
| `paused` | `paused` | Hidden |
| `expired` | `expired` | Hidden; can be republished on the same requisition |
| `closed` | `closed` | Hidden; final closure |

`record_linkedin_status` accepts `active`, `paused`, `expired`, or `closed`, an optional Unix-seconds `expiry_date`, a reason, expected publication version and unique operation ID. Active and paused observations update an open posting and its pause control. Expired and closed observations close public discovery; an expired posting can be changed to final `closed`. A new active observation cannot reopen an expired or closed posting. Every accepted observation increments the publication version and writes an audit event. This tool records an observation; it does not query LinkedIn.

`set_linkedin_job_id` records the current external ID and optionally the expiry date. `get_job_linkedin_status` reads them; `find_job_by_linkedin_id` searches current and historical IDs within authorized scope. `set_job_expiry_date` changes or clears the date separately. The date hides a job from public reads and candidate submission when reached. Record an `expired` observation to make the stored lifecycle state explicit.

`republish_job_requisition` moves an expired posting to `published` with a new LinkedIn ID on the **same requisition ID**. Existing applications retain that ID. The immutable `hiring_linkedin_repost_history` stores each ID assignment or change with previous and new ID, actor, reason and timestamp. `list_linkedin_repost_history` exposes it to authorized staff.

The lifecycle schema is introduced in `0059_job_lifecycle`; `0060_requisition_linkedin_state` adds the requisition mirror. Migration `0061_expire_freegamestore_intern` targets the single FreeGameStore Developer Intern requisition whose ID begins `658e8dce`, records an audit event, and expires its published posting. It acts only when the ID prefix, title, brand and current publication state match exactly one requisition. The migrations are additive.
