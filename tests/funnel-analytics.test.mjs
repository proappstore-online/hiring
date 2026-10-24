import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fixture, A, B, application } from './receipt-fixture.mjs'

function add(f, n, scope = A, prefix = 'a') {
  for (let i = 0; i < n; i++) {
    f.advance()
    const user = `worker-${prefix}-${i}`
    f.call('save_my_worker_profile', user, { display_name: 'Candidate' })
    f.call('submit_job_application', user, application(scope, `${prefix}-${i}`))
  }
}
const counts = rows => Object.fromEntries(rows.map(r => [r.milestone, r.count]))
test('analytics enforce current full-brand grants and return only aggregate fields', () => {
  const f = fixture(); try {
    f.publish(); add(f,5); add(f,1,B,'b')
    for (const user of ['owner','staff-a']) {
      const rows=f.call('get_funnel_analytics',user,A)
      assert.deepEqual(counts(rows),{received:5,reviewed:0,interviewed:0,offered:0,hired:0})
      for(const row of rows) assert.deepEqual(Object.keys(row).sort(),['count','milestone','suppressed'])
    }
    for(const user of ['worker','outsider','staff-b']) assert.deepEqual(f.call('get_funnel_analytics',user,A),[])
    f.call('grant_workspace_access','owner',{...A,grant_id:'limited',member_user_id:'limited',role:'recruiter',requisition_id:A.requisition_id,operation_id:'limited'})
    assert.deepEqual(f.call('get_funnel_analytics','limited',A),[])
    assert.ok(f.call('get_funnel_analytics','owner',B).every(r=>r.count===null))
    f.db.exec("UPDATE hiring_organizations SET status='suspended' WHERE id='org'")
    assert.deepEqual(f.call('get_funnel_analytics','owner',A),[])
  } finally { f.db.close() }
})
test('empty, below-threshold, exact-threshold and complementary cells are protected in SQL', () => {
  const f=fixture(); try {
    f.publish()
    assert.equal(counts(f.call('get_funnel_analytics','owner',A)).received,0)
    add(f,4)
    assert.ok(f.call('get_funnel_analytics','owner',A).every(r=>r.count===null&&r.suppressed===1))
    add(f,1,A,'extra')
    assert.equal(counts(f.call('get_funnel_analytics','owner',A)).received,5)
    // A single conversion hides the total and every other metric too.
    f.db.exec("UPDATE hiring_applications SET stage='hired' WHERE id='application-a-0'")
    assert.ok(f.call('get_funnel_analytics','owner',A).every(r=>r.count===null))
    add(f,5,A,'more')
    f.db.exec("UPDATE hiring_applications SET stage='hired' WHERE id LIKE 'application-more-%'")
    // Six hired plus four unconverted: complement remains unsafe.
    assert.ok(f.call('get_funnel_analytics','owner',A).every(r=>r.count===null))
    add(f,1,A,'last')
    assert.deepEqual(counts(f.call('get_funnel_analytics','owner',A)),{received:11,reviewed:6,interviewed:0,offered:6,hired:6})
  } finally { f.db.close() }
})
test('historical milestones count once, with small intersections suppressed even when marginals are large', () => {
  const f=fixture(); try {
    f.publish(); add(f,10)
    f.db.exec("UPDATE hiring_applications SET stage='offered' WHERE id IN ('application-a-0','application-a-1','application-a-2','application-a-3','application-a-4')")
    for(let i=0;i<5;i++) f.db.prepare("INSERT INTO hiring_stage_events(id,organization_id,brand_id,application_id,from_stage,to_stage,version,reason,actor_user_id,created_at) VALUES(?,'org','a',?,'in_review','interviewing',2,'reason','owner',1)").run(`event-${i}`,`application-a-${i}`)
    assert.deepEqual(counts(f.call('get_funnel_analytics','owner',A)),{received:10,reviewed:5,interviewed:5,offered:5,hired:0})
    // Marginal interviewed count is six, but the intersection has only one.
    f.db.exec("UPDATE hiring_applications SET stage='interviewing' WHERE id='application-a-5'")
    assert.ok(f.call('get_funnel_analytics','owner',A).every(r=>r.count===null))
  } finally { f.db.close() }
})

test('multiple applications from the same candidate cannot satisfy the privacy threshold', () => {
  const f=fixture(); try {
    f.publish(); add(f,5)
    f.db.exec("UPDATE hiring_applications SET candidate_id='candidate-a-0'")
    assert.ok(f.call('get_funnel_analytics','owner',A).every(r=>r.count===null&&r.suppressed===1))
  } finally { f.db.close() }
})
