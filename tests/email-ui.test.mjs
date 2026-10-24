import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
const require = createRequire(new URL('../web/package.json',import.meta.url))
const ts = require('typescript')
const react = require('react')
const {renderToStaticMarkup} = require('react-dom/server')
const source = name => readFileSync(new URL(`../web/src/${name}`,import.meta.url),'utf8')
const moduleUrl = text => 'data:text/javascript;base64,'+Buffer.from(text).toString('base64')
const modelUrl = moduleUrl(ts.transpile(source('email-model.ts'),{module:ts.ModuleKind.ESNext}))
const {emailCards,statusLabel} = await import(modelUrl)
let ui = ts.transpile(source('Communications.tsx'),{module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX})
ui=ui.replaceAll('"react/jsx-runtime"',JSON.stringify(pathToFileURL(require.resolve('react/jsx-runtime')).href)).replaceAll("'react'",JSON.stringify(pathToFileURL(require.resolve('react')).href)).replace(/import \{ id, write, read \} from '.\/api';/, 'const read = async () => []; const id = () => `op`; const write = async () => {};').replace(/import \{ verifyPublicationPasskey \} from '.\/passkey';/, 'const verifyPublicationPasskey = async () => {};').replace("'./email-model'",JSON.stringify(modelUrl)).replace(/import \{ date \} from '.\/ui';/, 'const date = t => new Date(t).toISOString();')
const {Communications}=await import(moduleUrl(ui))
const draft=(extra={})=>({id:'d',logical_email_id:'logical',subject:'Same',body:'Same body',recipient_email:'candidate@example.test',delivery_state:'draft',created_at:1000,...extra})
const archive=(extra={})=>({id:'a',logical_email_id:'logical',subject:'Same',body:'Same body',channel:'gmail',provider:'gmail',direction:'outbound',from_email:'sender@example.test',to_email:'candidate@example.test',provider_message_id:'opaque',occurred_at:4000,...extra})
const render=(drafts,communications)=>renderToStaticMarkup(react.createElement(Communications,{scope:{organization_id:'org',brand_id:'brand'},applicationId:'app',drafts,communications}))
test('rendered draft through acceptance remains one card with immutable payload and real activity time',()=>{
 for(const status of ['draft','queued','sending','accepted']) {
 const d=draft({current_status:status,latest_activity_at:3000})
 const html=render([d],status==='accepted'?[archive()]:[])
 assert.equal((html.match(/<li /g)||[]).length,1)
 assert.equal((html.match(/Same body/g)||[]).length,1)
 assert.ok(html.includes(statusLabel(status)))
 assert.ok(html.includes(new Date(status==='accepted'?4000:3000).toISOString()))
 assert.ok(!html.includes(new Date(1000).toISOString()))
 assert.match(html,/aria-expanded="false"/)
 }
})
test('identical separate sends remain two cards; inbound and legacy are visible',()=>{
 assert.equal(emailCards([draft(),draft({id:'d2',logical_email_id:'logical2'})],[archive(),archive({id:'a2',logical_email_id:'logical2'})]).length,2)
 const html=render([],[archive({logical_email_id:null,direction:'inbound'})])
 assert.equal((html.match(/<li /g)||[]).length,1);assert.match(html,/Received/);assert.match(html,/Legacy \/ Unverified link/)
})
test('failed, unknown and draft-only cards keep truthful states and unavailable history is explicit',()=>{
 for(const status of ['failed','unknown']) assert.ok(render([draft({current_status:status})],[]).includes(statusLabel(status)))
 assert.match(render([draft({logical_email_id:null})],[]),/Created:/)
 assert.match(source('Communications.tsx'),/Status history unavailable for this record\./)
 assert.match(source('Communications.tsx'),/e\.timestamp/)
 assert.match(source('Communications.tsx'),/cursor_at: last\?\.timestamp/)
 assert.match(render([],[]),/No communications recorded yet/)
})

test('failed mail exposes actionable quota and access guidance without raw provider errors',()=>{
 const quota=render([draft({delivery_state:'failed',delivery_reason:'quota'})],[])
 assert.match(quota,/Mail quota reached/);assert.match(quota,/reconcile before preparing a replacement/)
 const access=render([draft({delivery_state:'failed',delivery_reason:'forbidden'})],[])
 assert.match(access,/Review connector permissions/)
 const unknown=render([draft({delivery_state:'unknown',delivery_reason:'private provider error'})],[])
 assert.ok(!unknown.includes('private provider error'))
 assert.match(unknown,/Check provider acceptance evidence/)
})
