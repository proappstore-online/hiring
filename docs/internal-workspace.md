# Internal recruiter workspace

The first staff workflow is available to authenticated PAS users at `https://hiring.proappstore.online/`. Sign in with a supported PAS provider. Google is optional; GitHub remains available. A new user can create a private organization, brand and draft requisition. The creator receives the brand owner grant. Owners can add a colleague as a recruiter using that colleague's exact PAS user ID, displayed in the workspace after sign-in. Google and GitHub identities have distinct IDs and are not merged by email.

Staff can create a candidate/application from a `https://www.linkedin.com/` profile, with name, optional email/phone, source detail, recruitment basis reference, contact context, requisition and assignee. Every application starts at `submitted`. Staff can change stage with a reason and optimistic version check, add private notes and save communication drafts addressed to the candidate's recorded email. The outbox has only `draft` status and there is no send action, dispatcher, scheduled task, MAIL connection or public intake route. Drafts never contact candidates.

Migration `0003_internal_workspace` adds organization, brand, membership, draft requisition, candidate, application, stage event, note, draft outbox and audit tables. Registered PAS actions use `:__user_id` and membership checks in every read/write statement. Mutations use atomic batches; application creation writes the candidate, application, initial stage event and audit record together. Stage change requires the current stage and version. Audit rows contain actor, action, scope and operation ID, without candidate text. Lists are bounded to 100 rows. Client-supplied IDs and unique constraints make retries nonduplicating; the UI treats a zero-change result as a conflict or access failure. Tests exercise signed-in access, cross-user denial, assignment checks, stale stage changes, notes and draft isolation.

## Operator steps

1. Confirm main deploy applied migration `0003_internal_workspace`, registered the new actions, and uploaded the frontend. A failed migration or action registration stops the deploy.
2. Sign in at `https://hiring.proappstore.online/` with GitHub or configured Google, then create the internal workspace. Use a real organization and brand name. The initial requisition remains draft and is for internal sourcing only.
3. Have each recruiter sign in once and send the owner their displayed PAS staff ID. The owner grants that exact ID under **Workspace setup**. Do not grant access based on a matching email address.
4. Before entering live candidate data, confirm the organization's lawful basis, privacy notice, retention/deletion process, and authority to contact that candidate. The UI records basis and contact context, but policy approval is an operator responsibility.

Current limits: one brand is created per workspace; additional brands, grant revocation, candidate editing/deletion/rights requests, attachments, public application intake and communication sending require later issues. Draft requisitions cannot be published through this workflow. The public intake gate remains closed.
