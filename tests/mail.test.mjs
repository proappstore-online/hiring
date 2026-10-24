import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMailAdapter } from '../scripts/mail.mjs'
const scope = { organization_id:'org', brand_id:'brand', application_id:'app' }
const row = { id:'draft', recipient_email:'candidate@example.test', subject:'Brand interview', body:'Hello <candidate> & welcome\nNext step', secret:'never forward' }
const options = { scope, idempotencyKey:'stable-op' }
const approval = { ...scope, ...row, draft_id:row.id, operation_id:'stable-op', approved:true, suppressed:false, template_id:'interview', template_version:1, reply_to:'brand@example.test' }
test('MAIL forwards only bounded approved rendering fields with stable operation identity', async () => {
 let sent
 const send=createMailAdapter({authorize:async()=>approval,transport:async payload=>{sent=payload;return {outcome:'accepted'}}})
 assert.deepEqual(await send(row,options),{outcome:'accepted',reason:'accepted'})
 assert.equal(sent.operation_id,'stable-op');assert.equal(sent.brand_id,'brand')
 assert.match(sent.html,/&lt;candidate&gt; &amp; welcome<br>/)
 assert.equal(sent.secret,undefined);assert.equal(sent.body,undefined)
})
test('MAIL fails closed for missing approval, suppression, forged scope, payload or template revision', async()=>{
 for(const patch of [{approved:false},{suppressed:true},{brand_id:'other'},{operation_id:'other'},{draft_id:'other'},{body:'unapproved'},{template_version:0},{reply_to:'bad\r\nBcc: other@example.test'}]) {
  let sends=0
  const send=createMailAdapter({authorize:async()=>({...approval,...patch}),transport:async()=>{sends++}})
  assert.equal((await send(row,options)).outcome,'not_accepted');assert.equal(sends,0)
 }
})
test('MAIL checks subject, recipient and escaped UTF-8 body limits before transport',async()=>{
 for(const patch of [{subject:'x'.repeat(201)},{subject:'injected\nheader'},{recipient_email:'a@example.test,b@example.test'},{body:'&'.repeat(11000)},{body:'😀'.repeat(13000)}]) {
  const payload={...row,...patch};let sends=0
  const send=createMailAdapter({authorize:async()=>({...approval,...patch}),transport:async()=>{sends++}})
  assert.equal((await send(payload,options)).reason,'invalid_payload');assert.equal(sends,0)
 }
})
test('MAIL quota is definite failure; exceptions and malformed responses require reconciliation',async()=>{
 for(const reason of ['quota','unavailable','forbidden']) {
  const send=createMailAdapter({authorize:async()=>approval,transport:async()=>({outcome:'not_accepted',reason})})
  assert.deepEqual(await send(row,options),{outcome:'not_accepted',reason})
 }
 for(const transport of [async()=>{throw Error('secret recipient')},async()=>({ok:true}),async()=>null]) {
  const send=createMailAdapter({authorize:async()=>approval,transport})
  assert.deepEqual(await send(row,options),{outcome:'unknown',reason:'reconcile_required'})
 }
})
