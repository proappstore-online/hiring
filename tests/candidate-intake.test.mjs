import { seedApprovedTemplates } from './communication-fixture.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const migrations = JSON.parse(readFileSync(new URL('../migrations.json', import.meta.url))).migrations
const tools = JSON.parse(readFileSync(new URL('../mcp.json', import.meta.url))).tools
const tool = name => { const result = tools.find(t => t.name === name); assert.ok(result, name); return result }
const A = { organization_id: 'org', brand_id: 'a', requisition_id: 'req-a' }
const B = { organization_id: 'org', brand_id: 'b', requisition_id: 'req-b' }
const publication = (s = A) => ({ ...s, description: '<script>untrusted()</script> Engineer role', location: 'Remote', arrangement: 'Paid employment; 38 hours per week', compensation: 'AUD 100,000', notice_version: 'v1', notice_text: 'Application processing and indefinite retention. Optional talent pool and communications are separate.', contact: 'Hiring contact', operation_id: `publish-${s.brand_id}` })
const application = (s = A, suffix = 'a') => ({ ...s, candidate_id: `candidate-${suffix}`, application_id: `application-${suffix}`, operation_id: `submit-${suffix}`, idempotency_key: `retry-${suffix}`, candidate_name: 'Candidate', email: 'candidate@example.com', phone: '', statement: '<img src=x onerror=alert(1)>', notice_version: 'v1', expected_version: 1, notice_acknowledged: 1, talent_pool_consent: 0, communications_consent: 0 })
const attachment = (s = A, suffix = 'a') => ({ ...s, application_id: `application-${suffix}`, attachment_id: `file-${suffix}`, filename: 'resume.pdf', mime_type: 'application/pdf', size_bytes: 100, checksum: 'a'.repeat(64), operation_id: `file-create-${suffix}` })
function fixture({ open = true } = {}) {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys=ON')
  for (const m of migrations) db.exec(m.sql)
  let now = 1_000_000_000
  const call = (name, user = 'worker', values = {}) => {
    const t = tool(name)
    const params = { ...Object.fromEntries(Object.entries(t.params).filter(([,p]) => p.optional).map(([k]) => [k,null])), ...values, __user_id: user, __now: now, __uuid: crypto.randomUUID() }
    db.exec('BEGIN')
    try {
      const results = (t.statements ?? [t.sql]).map(statement => {
        const bindings = []
        const sql = statement.replace(/:([a-z_][a-z0-9_]*)/gi, (_, key) => { assert.notEqual(params[key], undefined, `${name}: ${key}`); bindings.push(params[key]); return '?' })
        return t.operation === 'query' ? db.prepare(sql).all(...bindings).map(r => ({ ...r })) : db.prepare(sql).run(...bindings).changes
      })
      db.exec('COMMIT')
      return t.operation === 'query' ? results[0] : results
    } catch (e) { db.exec('ROLLBACK'); throw e }
  }
  for (const scope of [A,B]) call('create_workspace','owner', { ...scope, organization_name: 'Org', brand_name: `Brand ${scope.brand_id}`, requisition_title: 'Engineer', operation_id: `boot-${scope.brand_id}` })
  call('add_workspace_member','owner', { ...A, member_user_id: 'staff-a', role: 'recruiter', operation_id: 'member-a' })
  call('add_workspace_member','owner', { ...B, member_user_id: 'staff-b', role: 'recruiter', operation_id: 'member-b' })
  call('save_my_worker_profile','worker', { display_name: 'Candidate' })
  call('save_my_worker_profile','other-worker', { display_name: 'Other' })
  if (open) db.exec("UPDATE hiring_runtime_gate SET intake_status='open' WHERE id=1")
  const publish = () => { for (const scope of [A,B]) assert.deepEqual(call('publish_job_requisition','owner',publication(scope)), [1,1]) }
  const submit = () => { publish(); assert.deepEqual(call('submit_job_application','worker',application()), [1,1,1,1,0,1,1]) }
  return { db, call, publish, submit, advance: (ms = 10001) => { now += ms } }
}
const counts = db => ['hiring_candidates','hiring_applications','hiring_intake_receipts','hiring_consent_records','hiring_stage_events','hiring_audit_events'].map(t => db.prepare(`SELECT count(*) AS n FROM ${t}`).get().n)

test('candidate withdrawal is exact-owner scoped, versioned, atomic and replay safe across brands', () => {
  const {db,call,submit,advance}=fixture();submit();advance()
  call('submit_job_application','worker',application(B,'b'))
  const input={...A,application_id:'application-a',expected_version:1,operation_id:'withdraw-a'}
  assert.equal(call('get_my_application','worker',{application_id:'application-a'})[0].version,1)
  for(const [user,p] of [['other-worker',input],['staff-a',input],['owner',input],['worker',{...input,brand_id:'b'}],['worker',{...input,expected_version:2}],['worker',{...input,operation_id:'submit-a'}]]) {
    assert.deepEqual(call('withdraw_my_application',user,p),[0,0,0])
  }
  assert.deepEqual(call('withdraw_my_application','worker',input),[1,1,1])
  assert.deepEqual(call('withdraw_my_application','worker',input),[0,0,0])
  assert.deepEqual(call('withdraw_my_application','worker',{...input,expected_version:2,operation_id:'again'}),[0,0,0])
  const row=call('get_my_application','worker',{application_id:'application-a'})[0]
  assert.equal(row.stage,'withdrawn');assert.equal(row.version,2)
  assert.equal(call('get_my_application','worker',{application_id:'application-b'})[0].stage,'submitted')
  const event=db.prepare("SELECT from_stage,to_stage,actor_user_id,version FROM hiring_stage_events WHERE id='withdraw-a'").get()
  assert.deepEqual({...event},{from_stage:'submitted',to_stage:'withdrawn',actor_user_id:'worker',version:2})
  assert.equal(db.prepare("SELECT actor_user_id FROM hiring_audit_events WHERE action='application.withdrawn'").get().actor_user_id,'worker')
  assert.deepEqual(call('change_application_stage','staff-a',{...A,application_id:'application-a',expected_version:2,from_stage:'withdrawn',to_stage:'in_review',reason:'Cannot reopen',operation_id:'reopen'}),[0,0,0,0])
  db.close()
})

test('candidate withdrawal rolls back stage and history when audit fails', () => {
  const {db,call,submit}=fixture();submit()
  db.exec("CREATE TRIGGER fail_withdraw_audit BEFORE INSERT ON hiring_audit_events WHEN NEW.action='application.withdrawn' BEGIN SELECT RAISE(ABORT,'audit unavailable'); END")
  assert.throws(()=>call('withdraw_my_application','worker',{...A,application_id:'application-a',expected_version:1,operation_id:'withdraw'}),/audit unavailable/)
  assert.equal(call('get_my_application','worker',{application_id:'application-a'})[0].stage,'submitted')
  assert.equal(call('get_my_application','worker',{application_id:'application-a'})[0].version,1)
  assert.equal(db.prepare("SELECT count(*) n FROM hiring_stage_events WHERE id='withdraw'").get().n,0)
  db.close()
})

test('withdrawal prevents new queue or claim attempts without pretending to recall existing provider attempts', () => {
  const {db,call,submit}=fixture();submit()
  const p={...A,application_id:'application-a',draft_id:'draft'}
  call('create_communication_draft','staff-a',{...p,recipient_email:'candidate@example.com',subject:'Hello',body:'Test',operation_id:'draft'})
  seedApprovedTemplates(db)
  call('queue_communication','staff-a',{...p,operation_id:'queue'})
  call('withdraw_my_application','worker',{...A,application_id:'application-a',expected_version:1,operation_id:'withdraw'})
  assert.throws(()=>call('claim_communication','staff-a',{...p,operation_id:'claim'}),/withdrawn application/)
  assert.equal(db.prepare("SELECT delivery_state FROM hiring_outbox WHERE id='draft'").get().delivery_state,'pending')
  const q={...p,draft_id:'later'}
  call('create_communication_draft','staff-a',{...q,recipient_email:'candidate@example.com',subject:'Hello',body:'Test',operation_id:'later'})
  seedApprovedTemplates(db)
  assert.throws(()=>call('queue_communication','staff-a',{...q,operation_id:'later-queue'}),/withdrawn application/)
  db.close()
})

test('publication requires an exact brand owner or recruiter grant', () => {
  const { db, call } = fixture()
  try {
    assert.equal(tool('publish_job_requisition').step_up, undefined)
    for (const user of ['staff-b','worker','outsider']) assert.deepEqual(call('publish_job_requisition',user,publication()), [0,0])
    assert.deepEqual(call('publish_job_requisition','staff-a',{ ...publication(), requisition_id: B.requisition_id }), [0,0])
    assert.deepEqual(call('publish_job_requisition','owner',{ ...publication(), notice_text: '' }), [0,0])
    assert.deepEqual(call('publish_job_requisition','staff-a',publication()), [1,1])
    assert.deepEqual(call('publish_job_requisition','owner',publication()), [0,0])
    assert.equal(db.prepare('SELECT status FROM hiring_requisitions WHERE id=?').get(A.requisition_id).status, 'draft')
    assert.throws(() => db.exec("UPDATE hiring_job_publications SET notice_text='changed'"), /immutable/)
    assert.equal(db.prepare("SELECT actor_user_id FROM hiring_audit_events WHERE action='requisition.published'").get().actor_user_id, 'staff-a')
  } finally { db.close() }
})

test('only a scoped owner or recruiter can open or close the audited intake gate', () => {
  const { db, call } = fixture({ open: false })
  try {
    const change = { ...A, intake_status: 'open', operation_id: 'intake-open' }
    assert.equal(tool('set_hiring_runtime_gate').step_up, undefined)
    assert.deepEqual(call('set_hiring_runtime_gate', 'staff-a', change), [1, 1])
    assert.deepEqual(call('set_hiring_runtime_gate', 'outsider', change), [0, 0])
    assert.equal(db.prepare('SELECT intake_status FROM hiring_runtime_gate WHERE id=1').get().intake_status, 'open')
    assert.equal(db.prepare("SELECT action FROM hiring_audit_events WHERE operation_id='intake-open'").get().action, 'intake.opened')
    assert.deepEqual(call('set_hiring_runtime_gate', 'owner', change), [0, 0])
    assert.deepEqual(call('set_hiring_runtime_gate', 'owner', { ...A, intake_status: 'closed', operation_id: 'intake-close' }), [1, 1])
    assert.equal(db.prepare('SELECT intake_status FROM hiring_runtime_gate WHERE id=1').get().intake_status, 'closed')
  } finally { db.close() }
})

test('public jobs expose only published approved snapshots, exact scope and bounded pagination', () => {
  const { db, call, publish } = fixture()
  try {
    assert.deepEqual(call('list_public_jobs',null,{ after_id: '' }), [])
    publish()
    assert.equal(call('list_public_jobs',null,{ after_id: '' }).length,2)
    assert.equal(call('list_public_jobs',null,{ after_id: A.requisition_id }).length,1)
    const job = call('get_public_job',null,A)[0]
    assert.equal(job.brand_name,'Brand a')
    assert.equal(job.notice_version,'v1')
    assert.equal('actor_user_id' in job,false)
    assert.deepEqual(call('get_public_job',null,{ ...A, brand_id: B.brand_id }), [])
    assert.deepEqual(call('close_job_requisition','staff-a',{ ...A, expected_version: 1, operation_id:'bad-close' }),[0,0])
    assert.deepEqual(call('close_job_requisition','owner',{ ...A, expected_version: 2, operation_id:'stale-close' }),[0,0])
    assert.deepEqual(call('close_job_requisition','owner',{ ...A, expected_version: 1, operation_id:'close' }),[1,1])
    assert.deepEqual(call('get_public_job',null,A),[])
    db.exec("UPDATE hiring_organizations SET status='suspended'")
    assert.deepEqual(call('list_public_jobs',null,{ after_id: '' }), [])
  } finally { db.close() }
})

test('candidate submission records exact brand, worker ownership, notice snapshot and optional affirmative consent', () => {
  const { db, call, publish, advance } = fixture()
  try {
    publish()
    assert.deepEqual(call('submit_job_application','worker',application()),[1,1,1,1,0,1,1])
    const a = db.prepare('SELECT * FROM hiring_applications').get()
    assert.equal(a.brand_id,A.brand_id)
    assert.equal(a.source,'linkedin') // immutable legacy compatibility constraint
    assert.equal(a.assignee_user_id,'owner')
    const consent = db.prepare('SELECT * FROM hiring_consent_records').all()
    assert.equal(consent.length,1)
    assert.equal(consent[0].legal_basis,'contract')
    assert.equal(consent[0].actor_user_id,'worker')
    assert.match(consent[0].evidence_reference,/indefinite retention/)
    assert.equal(consent[0].notice_version,'v1')
    assert.equal(JSON.parse(a.submitted_snapshot_json).statement,application().statement)
    advance()
    assert.deepEqual(call('submit_job_application','worker',{ ...application(B,'b'), talent_pool_consent:1, communications_consent:1 }),[1,1,1,1,2,1,1])
    assert.equal(call('list_my_job_applications','worker').length,2)
    assert.deepEqual(call('list_my_job_applications','other-worker'),[])
    assert.equal(call('list_applications','staff-a',A).length,1)
    assert.equal(call('list_applications','staff-b',B).length,1)
    assert.deepEqual(call('list_applications','staff-a',B),[])
    assert.equal(call('list_applications','staff-a',A)[0].source,'direct')
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[])
  } finally { db.close() }
})

test('invalid, closed, stale or mixed-scope submissions never leave partial records', () => {
  const { db, call, publish } = fixture()
  try {
    publish()
    const before = counts(db)
    for (const patch of [{ brand_id:'b' },{ organization_id:'wrong' },{ requisition_id:'req-b' },{ notice_acknowledged:0 },{ notice_version:'old' },{ expected_version:2 },{ candidate_name:' ' },{ email:'bad' },{ statement:'a'.repeat(10001) },{ talent_pool_consent:2 },{ idempotency_key:'' }]) {
      assert.ok(call('submit_job_application','worker',{ ...application(),...patch }).every(n => n === 0),JSON.stringify(patch))
      assert.deepEqual(counts(db),before)
    }
    assert.ok(call('submit_job_application','unknown-worker',application()).every(n => n === 0))
    call('close_job_requisition','owner',{ ...A, expected_version:1, operation_id:'close' })
    assert.ok(call('submit_job_application','worker',application()).every(n => n === 0))
  } finally { db.close() }
})

test('closed intake gate denies authenticated submissions even when jobs are public', () => {
  const { db, call, publish } = fixture({ open:false })
  try { publish(); const before=counts(db); assert.ok(call('submit_job_application','worker',application()).every(n => n===0)); assert.deepEqual(counts(db),before) } finally { db.close() }
})

test('idempotent retries preserve original receipt, reject payload changes and do not disclose other workers', () => {
  const { db, call, submit, advance } = fixture()
  try {
    submit(); const before=counts(db); advance()
    assert.ok(call('submit_job_application','worker',application()).every(n => n===0))
    assert.ok(call('submit_job_application','worker',{ ...application(), statement:'Changed' }).every(n => n===0))
    assert.deepEqual(counts(db),before)
    const r=call('get_my_application_receipt','worker',{ idempotency_key:'retry-a' })[0]
    assert.equal(r.application_id,'application-a')
    assert.equal(JSON.parse(r.payload_json).statement,application().statement)
    assert.deepEqual(call('get_my_application_receipt','other-worker',{ idempotency_key:'retry-a' }),[])
    assert.throws(() => db.exec("UPDATE hiring_intake_receipts SET worker_user_id='other-worker'"),/immutable/)
  } finally { db.close() }
})

test('submission abuse controls are enforced by SQL across brands and reject rapid and daily excess', () => {
  const { db, call, submit, advance } = fixture()
  try {
    submit()
    assert.ok(call('submit_job_application','worker',application(B,'rapid')).every(n => n===0))
    const freshScope = n => {
      const scope = { ...A, requisition_id: `rate-req-${n}` }
      db.prepare('INSERT INTO hiring_requisitions(id,organization_id,brand_id,title,status,created_at) VALUES (?,?,?,?,?,?)').run(scope.requisition_id,'org','a','Engineer','draft',0)
      call('publish_job_requisition','owner', { ...publication(scope), operation_id:`rate-publish-${n}` })
      return scope
    }
    for (let n=1;n<10;n++) { advance(); assert.equal(call('submit_job_application','worker',application(freshScope(n),`rate-${n}`)).at(-1),1) }
    advance(); const excessScope=freshScope('excess'); const before=counts(db)
    assert.ok(call('submit_job_application','worker',application(excessScope,'excess')).every(n => n===0)); assert.deepEqual(counts(db),before)
    advance(86400001); assert.equal(call('submit_job_application','worker',application(freshScope('tomorrow'),'tomorrow')).at(-1),1)
  } finally { db.close() }
})

test('late consent failure rolls back candidate, application, receipt, history and audit', () => {
  const { db, call, publish } = fixture()
  try {
    publish()
    db.exec("CREATE TRIGGER fail_consent BEFORE INSERT ON hiring_consent_records BEGIN SELECT RAISE(ABORT,'consent failure'); END")
    const before=counts(db)
    assert.throws(() => call('submit_job_application','worker',application()),/consent failure/)
    assert.deepEqual(counts(db),before)
  } finally { db.close() }
})

test('attachment reservation is worker-owned, quarantined, size/type/checksum limited and scoped', () => {
  const { db, call, submit } = fixture()
  try {
    submit()
    for (const user of ['other-worker','staff-a','staff-b','owner']) assert.deepEqual(call('create_application_attachment',user,attachment()),[0,0])
    for (const patch of [{brand_id:'b'},{application_id:'missing'},{size_bytes:5242881},{size_bytes:0},{mime_type:'text/html'},{checksum:'bad'},{attachment_id:'../../x'}]) assert.deepEqual(call('create_application_attachment','worker',{...attachment(),...patch}),[0,0])
    assert.deepEqual(call('create_application_attachment','worker',attachment()),[1,1])
    assert.deepEqual(call('create_application_attachment','worker',attachment()),[0,0])
    const row=call('list_application_attachments','worker',attachment())[0]
    assert.equal(row.scan_state,'pending')
    assert.equal('storage_path' in row,false)
    for (const user of ['worker','owner','staff-a','other-worker']) assert.deepEqual(call('get_application_attachment',user,attachment()),[])
    for (const user of ['staff-a','staff-b','other-worker']) assert.deepEqual(call('list_application_attachments',user,attachment()),[])
    assert.equal(call('list_application_attachments','owner',attachment()).length,1)
    assert.deepEqual(call('list_application_attachments','owner',{...attachment(),brand_id:'b'}),[])
    // Simulate a future trusted scanner directly; no user action can set clean.
    assert.ok(!tools.some(t => /UPDATE hiring_attachments SET scan_state='clean'/.test(JSON.stringify(t))))
    db.exec("UPDATE hiring_attachments SET scan_state='clean'")
    assert.equal(call('get_application_attachment','owner',attachment()).length,1)
    assert.deepEqual(call('get_application_attachment','staff-a',attachment()),[])
    assert.deepEqual(call('get_application_attachment','owner',{...attachment(),brand_id:'b'}),[])
    assert.throws(() => db.exec("UPDATE hiring_attachments SET storage_path='swapped'"),/immutable/)
  } finally { db.close() }
})

test('attachment deletion denies reads first, is owner-only and audits once', () => {
  const { db, call, submit } = fixture()
  try {
    submit(); call('create_application_attachment','worker',attachment())
    const p={...attachment(),operation_id:'delete-file'}
    for(const user of ['other-worker','owner','staff-a']) assert.deepEqual(call('delete_application_attachment',user,p),[0,0])
    assert.deepEqual(call('delete_application_attachment','worker',{...p,brand_id:'b'}),[0,0])
    assert.deepEqual(call('delete_application_attachment','worker',p),[1,1])
    assert.deepEqual(call('delete_application_attachment','worker',p),[0,0])
    assert.deepEqual(call('list_application_attachments','worker',p),[])
    assert.deepEqual(call('get_application_attachment','worker',p),[])
    assert.equal(db.prepare("SELECT count(*) AS n FROM hiring_audit_events WHERE action='attachment.deleted'").get().n,1)
  } finally { db.close() }
})

test('new action SQL has declared params, authenticated writes, no identity input or public PII', () => {
  for(const t of tools.slice(28)) {
    const statements=t.statements??[t.sql]
    const sql=statements.join(' ')
    assert.doesNotMatch(sql,/;/)
    for(const [,p] of sql.matchAll(/:([a-z_][a-z0-9_]*)/gi)) assert.ok(p.startsWith('__') || t.params[p],`${t.name}: ${p}`)
    assert.ok(!Object.keys(t.params).some(k => k.startsWith('__') || ['worker_user_id','uploader_user_id','actor_user_id','scan_state','storage_path'].includes(k)))
    if(t.operation!=='query') assert.equal(t.requires_auth,true)
    if(t.requires_auth) for(const [index, statement] of statements.entries()) assert.match(statement,/:__user_id/,`${t.name} statement[${index}] must bind the authenticated caller`)
    else { assert.match(sql,/LIMIT (1|25)$/); assert.doesNotMatch(sql,/hiring_candidates|hiring_applications|hiring_attachments/) }
  }
})

test('staged review binds exact content and classification with versioned staff approval', () => {
  const { db, call } = fixture()
  const draft = { ...publication(), compensation_type: 'unpaid', expected_version: 0, state: 'draft', operation_id: 'draft-save' }
  assert.deepEqual(call('save_requisition_review','staff-a',draft), [1,1])
  assert.deepEqual(call('save_requisition_review','owner',{ ...draft, requisition_id:B.requisition_id }), [0,0])
  assert.deepEqual(call('save_requisition_review','staff-a',{ ...draft, operation_id:'stale' }), [0,0])
  assert.deepEqual(call('publish_job_requisition','owner',{ ...publication(), compensation_type:'unpaid' }), [0,0])
  assert.deepEqual(call('save_requisition_review','staff-a',{ ...draft, state:'pending_review', expected_version:1, operation_id:'review-submit' }), [1,1])
  assert.deepEqual(call('publish_job_requisition','owner',{ ...publication(), compensation_type:'unpaid', notice_text:'changed notice' }), [0,0])
  assert.deepEqual(call('publish_job_requisition','owner',{ ...publication(), compensation_type:'unpaid' }), [1,1])
  assert.equal(call('get_public_job',null,A)[0].compensation_type,'unpaid')
  assert.throws(() => db.prepare("UPDATE hiring_job_publications SET compensation_type='paid'").run(), /immutable/)
  assert.deepEqual(call('save_requisition_review','owner',{ ...draft, expected_version:2, operation_id:'edit-published' }), [0,0])
  db.close()
})

test('pause hides discovery and denies submissions; resume and closure use optimistic versions', () => {
  const { db, call, publish } = fixture()
  publish()
  const change = { ...A, expected_version:1, operation_id:'pause' }
  assert.deepEqual(call('pause_job_requisition','staff-a',change), [0,0,0])
  assert.deepEqual(call('pause_job_requisition','owner',{ ...change, requisition_id:B.requisition_id }), [0,0,0])
  assert.deepEqual(call('pause_job_requisition','owner',change), [1,1,1])
  assert.equal(call('get_public_job',null,A).length,0)
  assert.equal(call('list_public_jobs',null,{ after_id:'' }).length,1)
  assert.ok(call('submit_job_application','worker',application()).every(n => n===0))
  assert.deepEqual(call('resume_job_requisition','owner',{ ...change, operation_id:'stale-resume' }), [0,0,0])
  assert.deepEqual(call('resume_job_requisition','owner',{ ...change, expected_version:2, operation_id:'resume' }), [1,1,1])
  assert.equal(call('get_public_job',null,A)[0].version,3)
  assert.deepEqual(call('pause_job_requisition','owner',{ ...change, expected_version:3, operation_id:'pause-again' }), [1,1,1])
  assert.deepEqual(call('close_job_requisition','owner',{ ...change, expected_version:4, operation_id:'close-paused' }), [1,1])
  assert.deepEqual(call('resume_job_requisition','owner',{ ...change, expected_version:5, operation_id:'resume-closed' }), [0,0,0])
  db.close()
})

test('lifecycle audit failure rolls back availability and version', () => {
  const { db, call, publish } = fixture()
  publish()
  db.exec("CREATE TRIGGER fail_pause BEFORE INSERT ON hiring_audit_events WHEN NEW.action='requisition.paused' BEGIN SELECT RAISE(ABORT,'audit failure'); END")
  assert.throws(() => call('pause_job_requisition','owner',{ ...A, expected_version:1, operation_id:'pause-fail' }), /audit failure/)
  assert.equal(call('get_public_job',null,A)[0].version,1)
  db.close()
})

test('protected candidate intake rejects bot and malformed fields without partial writes', () => {
  const { db, call, publish } = fixture()
  try {
    publish()
    for (const patch of [{ website:'https://bot.example' }, { candidate_name:' '.repeat(201)+'x' }, {email:'a@@example.com'}, {email:'a@localhost'}, {email:'a b@example.com'}, {email:'a@example.com\n'}, {email:'a@example.'}, {candidate_name:'a\0b'}, {statement:'x\0y'}, {phone:'x'.repeat(101)}, {statement:'x'.repeat(10001)}, {notice_acknowledged:0}, {talent_pool_consent:2}, {communications_consent:-1}, {operation_id:''}]) {
      const before=counts(db)
      assert.ok(call('submit_job_application','worker',{...application(),...patch}).every(n=>n===0), JSON.stringify(patch).slice(0,100))
      assert.deepEqual(counts(db),before)
    }
    assert.ok(call('submit_job_application','worker',{...application(),website:''}).some(n=>n===1))
    assert.equal(call('list_my_workspaces','worker').length,0)
  } finally { db.close() }
})

test('candidate and requisition deduplication survives new keys and preserves private receipt', () => {
  const { db, call, publish, advance } = fixture()
  try {
    publish()
    call('submit_job_application','worker',application())
    advance()
    const before=counts(db)
    assert.ok(call('submit_job_application','worker',application(A,'new-key')).every(n=>n===0))
    assert.deepEqual(counts(db),before)
    const receipt=call('get_my_requisition_receipt','worker',A)[0]
    assert.equal(receipt.application_id,'application-a')
    for (const user of ['other-worker','staff-a','owner']) assert.deepEqual(call('get_my_requisition_receipt',user,A),[])
    assert.deepEqual(call('get_my_requisition_receipt','worker',{...A,brand_id:'b'}),[])
    assert.ok(call('submit_job_application','worker',application(B,'brand-b')).some(n=>n===1))
    assert.equal(call('get_my_requisition_receipt','worker',B)[0].application_id,'application-brand-b')
  } finally { db.close() }
})

test('candidate browser calls scoped candidate actions and renders a canonical vacancy link', () => {
  const source=readFileSync(new URL('../web/src/Jobs.tsx',import.meta.url),'utf8')
  const routes=readFileSync(new URL('../web/src/routes.ts',import.meta.url),'utf8')
  assert.match(source,/name="website" autoComplete="off" tabIndex=\{-1\}/)
  assert.match(source,/website: val\(f, 'website'\)/)
  assert.match(source,/'get_my_requisition_receipt'/)
  assert.match(source,/applyUrl\(row.requisition_id\)/)
  assert.match(routes,/\/vacancies\/\$\{encodeURIComponent\(id\)\}/)
  assert.match(source,/provider="google"/)
  assert.doesNotMatch(source,/app\.db\.|app\.proxy\.|staff_token|D1_TOKEN|R2_SECRET|CLIENT_SECRET|dangerouslySetInnerHTML/)
  const action=tool('submit_job_application')
  assert.equal(action.requires_auth,true)
  assert.equal('worker_user_id' in action.params,false)
  assert.equal('staff_token' in action.params,false)
})

test('candidate detail lookup is owned, safe and independent of public availability', () => {
  const { db, call, submit, advance } = fixture()
  try {
    submit()
    advance()
    call('submit_job_application','worker',application(B,'detail-b'))
    assert.equal(call('get_my_application','worker',{ application_id:'application-detail-b' })[0].brand_id,'b')
    assert.deepEqual(call('get_my_application','other-worker',{ application_id:'application-detail-b' }),[])
    const row = call('get_my_application', 'worker', { application_id: 'application-a' })[0]
    assert.equal(row.stage, 'submitted')
    assert.equal(row.created_at, 1_000_000_000)
    assert.equal(row.brand_id, 'a')
    assert.equal(row.organization_name, 'Org')
    for (const key of ['email','phone','payload_json','assignee_user_id','reason','notes']) assert.equal(key in row, false)
    for (const user of ['other-worker','owner','staff-a',null]) assert.deepEqual(call('get_my_application', user, { application_id:'application-a' }), [])
    assert.deepEqual(call('get_my_application','worker',{ application_id:'missing' }),[])
    call('close_job_requisition','owner',{ ...A,expected_version:1,operation_id:'close-detail' })
    assert.equal(call('get_my_application','worker',{ application_id:'application-a' }).length,1)
  } finally { db.close() }
})

test('both brand forms reject unpublished jobs and stale snapshots without partial evidence', () => {
  for (const scope of [A, B]) {
    const { db, call } = fixture()
    try {
      const params = application(scope, scope.brand_id)
      const empty = counts(db)
      assert.deepEqual(call('get_public_job', null, scope), [])
      assert.ok(call('submit_job_application', 'worker', params).every(n => n === 0))
      assert.deepEqual(counts(db), empty)
      call('publish_job_requisition', 'owner', { ...publication(scope), notice_version: `notice-${scope.brand_id}` })
      const published = counts(db)
      assert.ok(call('submit_job_application', 'worker', params).every(n => n === 0))
      assert.deepEqual(counts(db), published)
      const current = { ...params, notice_version: `notice-${scope.brand_id}` }
      call('pause_job_requisition', 'owner', { ...scope, expected_version: 1, operation_id: 'pause-form' })
      assert.ok(call('submit_job_application', 'worker', current).every(n => n === 0))
      call('resume_job_requisition', 'owner', { ...scope, expected_version: 2, operation_id: 'resume-form' })
      const resumed = counts(db)
      assert.ok(call('submit_job_application', 'worker', current).every(n => n === 0))
      assert.deepEqual(counts(db), resumed)
      assert.equal(call('submit_job_application', 'worker', { ...current, expected_version: 3 }).at(-1), 1)
      const receipt = call('get_my_requisition_receipt', 'worker', scope)[0]
      const payload = JSON.parse(receipt.payload_json)
      assert.equal(payload.publication_version, 3)
      assert.equal(payload.notice_version, `notice-${scope.brand_id}`)
      assert.equal(payload.brand_id, scope.brand_id)
      const saved = counts(db)
      assert.ok(call('submit_job_application', 'worker', { ...current, expected_version: 3 }).every(n => n === 0))
      assert.deepEqual(counts(db), saved)
      assert.deepEqual(call('get_my_requisition_receipt', 'other-worker', scope), [])
      assert.deepEqual(call('get_my_requisition_receipt', 'worker', { ...scope, brand_id: scope.brand_id === 'a' ? 'b' : 'a' }), [])
      assert.deepEqual(call('get_my_requisition_receipt', 'worker', { ...scope, organization_id: 'another-org' }), [])
    } finally { db.close() }
  }
})

test('candidate tokens bind owner, application, purpose and server expiry with bounded issuance', () => {
  const {db,call,submit,advance}=fixture();submit();advance()
  call('submit_job_application','worker',application(B,'b'))
  const token='a'.repeat(64), p={application_id:'application-a',token,purpose:'status'}
  for (const user of ['other-worker','owner','staff-a',null]) assert.deepEqual(call('issue_candidate_access_token',user,p),[0])
  for (const bad of [{token:'short'},{token:'Z'.repeat(64)},{purpose:'admin'},{application_id:'missing'}]) assert.deepEqual(call('issue_candidate_access_token','worker',{...p,...bad}),[0])
  assert.deepEqual(call('issue_candidate_access_token','worker',p),[1])
  assert.deepEqual(call('issue_candidate_access_token','worker',p),[0])
  assert.equal(call('get_candidate_application_status','worker',p)[0].stage,'submitted')
  for (const [user,changes] of [['other-worker',{}],['owner',{}],['worker',{application_id:'application-b'}],['worker',{token:'b'.repeat(64)}]]) assert.deepEqual(call('get_candidate_application_status',user,{...p,...changes}),[])
  assert.deepEqual(call('withdraw_candidate_application','worker',{...A,...p,expected_version:1,operation_id:'wrong-purpose'}),[0,0,0,0])
  assert.deepEqual(call('issue_candidate_access_token','worker',{...p,token:'b'.repeat(64),purpose:'withdraw'}),[1])
  assert.deepEqual(call('get_candidate_application_status','worker',{...p,token:'b'.repeat(64)}),[])
  for(let i=0;i<18;i++) assert.deepEqual(call('issue_candidate_access_token','worker',{...p,token:(i+16).toString(16).padStart(64,'0')}),[1])
  assert.deepEqual(call('issue_candidate_access_token','worker',{...p,token:'c'.repeat(64)}),[0])
  advance(900000)
  assert.deepEqual(call('get_candidate_application_status','worker',p),[])
  assert.deepEqual(call('withdraw_candidate_application','worker',{...A,...p,token:'b'.repeat(64),expected_version:1,operation_id:'expired'}),[0,0,0,0])
  assert.deepEqual(call('issue_candidate_access_token','worker',{...p,token:'c'.repeat(64)}),[1])
  db.close()
})

test('withdrawal token is consumed atomically with audit and cannot reopen or cross applications', () => {
  const {db,call,submit,advance}=fixture();submit();advance()
  call('submit_job_application','worker',application(B,'b'))
  const token='d'.repeat(64), p={...A,application_id:'application-a',token,expected_version:1,operation_id:'token-withdraw'}
  assert.deepEqual(call('issue_candidate_access_token','worker',{...p,purpose:'withdraw'}),[1])
  for(const [user,changes] of [['other-worker',{}],['staff-a',{}],['worker',{application_id:'application-b'}],['worker',{brand_id:'b'}],['worker',{expected_version:2}]]) assert.deepEqual(call('withdraw_candidate_application',user,{...p,...changes}),[0,0,0,0])
  db.exec("CREATE TRIGGER token_audit_failure BEFORE INSERT ON hiring_audit_events WHEN NEW.action='application.withdrawn' BEGIN SELECT RAISE(ABORT,'audit unavailable'); END")
  assert.throws(()=>call('withdraw_candidate_application','worker',p),/audit unavailable/)
  assert.equal(db.prepare('SELECT consumed_at FROM hiring_candidate_access_tokens WHERE token=?').get(token).consumed_at,null)
  assert.equal(call('get_my_application','worker',p)[0].stage,'submitted')
  db.exec('DROP TRIGGER token_audit_failure')
  assert.deepEqual(call('withdraw_candidate_application','worker',p),[1,1,1,1])
  assert.ok(db.prepare('SELECT consumed_at FROM hiring_candidate_access_tokens WHERE token=?').get(token).consumed_at)
  assert.deepEqual(call('withdraw_candidate_application','worker',p),[0,0,0,0])
  assert.equal(call('get_my_application','worker',{application_id:'application-b'})[0].stage,'submitted')
  assert.deepEqual(call('change_application_stage','staff-a',{...A,application_id:p.application_id,expected_version:2,from_stage:'withdrawn',to_stage:'in_review',reason:'Cannot reopen',operation_id:'token-reopen'}),[0,0,0,0])
  const event=db.prepare("SELECT actor_user_id FROM hiring_audit_events WHERE id='token-withdraw'").get()
  assert.equal(event.actor_user_id,'worker')
  db.close()
})
