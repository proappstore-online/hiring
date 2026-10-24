import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fixture, A, B, application } from './receipt-fixture.mjs'
const counts = rows => Object.fromEntries(rows.map(row => [row.stage, row.count]))
test('current pipeline counts exceed list limits, use effective current stages and isolate brands', () => {
  const f = fixture()
  try {
    f.publish()
    for (let i = 0; i < 101; i++) {
      f.advance()
      f.call('save_my_worker_profile', `worker-${i}`, { display_name: 'Candidate' })
      assert.ok(f.call('submit_job_application', `worker-${i}`, application(A, String(i))).some(n => n > 0))
    }
    f.advance(); f.call('submit_job_application', 'other-worker', application(B, 'other'))
    f.db.exec("UPDATE hiring_applications SET stage='in_review' WHERE id='application-0'")
    f.db.exec("UPDATE hiring_applications SET stage='in_review',stage_extension='shortlisted' WHERE id='application-1'")
    f.db.exec("UPDATE hiring_applications SET stage='interviewing' WHERE id='application-2'")
    assert.deepEqual(counts(f.call('get_current_pipeline', 'staff-a', A)), { submitted: 98, in_review: 1, shortlisted: 1, interviewing: 1 })
    assert.deepEqual(counts(f.call('get_current_pipeline', 'owner', B)), { submitted: 1 })
    for (const user of ['worker', 'outsider', 'staff-b']) assert.deepEqual(f.call('get_current_pipeline', user, A), [])
    for (const row of f.call('get_current_pipeline', 'owner', A)) assert.deepEqual(Object.keys(row).sort(), ['count', 'stage'])
    f.db.exec("UPDATE hiring_applications SET stage='rejected',stage_extension=NULL,accepted_stage=NULL WHERE brand_id='a'")
    assert.deepEqual(counts(f.call('get_current_pipeline', 'owner', A)), { rejected: 101 })
  } finally { f.db.close() }
})
test('current pipeline respects requisition grants, reviewer assignments, revoked access and suspended tenants', () => {
  const f = fixture()
  try {
    f.submit()
    for (const [user, role] of [['limited', 'recruiter'], ['reviewer', 'reviewer'], ['auditor', 'auditor']]) {
      f.call('grant_workspace_access', 'owner', { ...A, grant_id: user, member_user_id: user, role, requisition_id: A.requisition_id, operation_id: user })
    }
    f.call('create_requisition', 'owner', { ...A, requisition_id: 'second', title: 'Second role', operation_id: 'second-role' })
    f.call('create_linkedin_application', 'staff-a', { ...A, requisition_id: 'second', candidate_id: 'second-candidate', application_id: 'second-application', operation_id: 'second-application', candidate_name: 'Second', email: '', phone: '', linkedin_url: '', source_detail: 'Manual', basis_reference: 'Policy', contact_context: 'Direct', assignee_user_id: 'staff-a' })
    assert.deepEqual(counts(f.call('get_current_pipeline', 'owner', A)), { submitted: 2 })
    assert.deepEqual(counts(f.call('get_current_pipeline', 'limited', A)), { submitted: 1 })
    assert.deepEqual(f.call('get_current_pipeline', 'reviewer', A), [])
    assert.deepEqual(f.call('get_current_pipeline', 'auditor', A), [])
    f.db.exec("UPDATE hiring_applications SET assignee_user_id='reviewer' WHERE id='application-a'")
    assert.deepEqual(counts(f.call('get_current_pipeline', 'reviewer', A)), { submitted: 1 })
    f.call('revoke_workspace_grant', 'owner', { ...A, grant_id: 'limited', operation_id: 'revoke-limited' })
    assert.deepEqual(f.call('get_current_pipeline', 'limited', A), [])

    f.db.exec("UPDATE hiring_organizations SET status='suspended' WHERE id='org'")
    assert.deepEqual(f.call('get_current_pipeline', 'owner', A), [])
  } finally { f.db.close() }
})
