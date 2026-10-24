import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { chromium, expect } from '@playwright/test'
const require = createRequire(new URL('../web/package.json', import.meta.url))
const { createServer } = await import(require.resolve('vite'))
const { default: react } = await import(require.resolve('@vitejs/plugin-react'))
const { default: tailwind } = await import(require.resolve('@tailwindcss/vite'))
const web = new URL('../web/', import.meta.url).pathname
const fixture = `import React from 'react'; import {createRoot} from 'react-dom/client';
import {Communications} from '/src/Communications.tsx'; import '/src/index.css';
window.calls=[];window.pending=[];
window.historyRead=(name,params)=>{window.calls.push({name,params});return new Promise((resolve,reject)=>window.pending.push({resolve,reject}));};
const root=createRoot(document.getElementById('root'));
window.props={scope:{organization_id:'org',brand_id:'brand'},applicationId:'app',drafts:[{id:'d',logical_email_id:'logical',subject:'Synthetic subject',body:'Body',recipient_email:'candidate@example.test',current_status:'draft',created_at:1000}],communications:[]};
window.show=(patch={})=>{Object.assign(window.props,patch);root.render(React.createElement(Communications,{...window.props,onRetry:()=>window.show({loading:true,error:''})}))};window.show();`
const event = (i=0) => ({id:`e${i}`,status:'queued',timestamp:2000+i,actor:'synthetic-actor',attempt_number:2,provider_reference:'receipt-test'})
test('Communications browser interactions, scope isolation and mobile accessibility', async t => {
 const live=await createServer({root:web,configFile:false,optimizeDeps:{entries:[]},plugins:[react(),tailwind(),{
 name:'email-fixture',enforce:'pre',
 resolveId(id){if(id==='/fixture.jsx')return '\0email-fixture.jsx'},
 load(id){if(id===web+'src/passkey.ts')return 'export const verifyPublicationPasskey=async()=>{window.verified=true}';if(id==='\0email-fixture.jsx')return fixture;if(id===web+'src/api.ts')return 'export const read=(...args)=>args[0]==="get_communication_reconciliation"?Promise.resolve(window.writes?[{replacement_draft_id:"replacement"}]:[]):window.historyRead(...args);export const id=()=>crypto.randomUUID();export const write=async(...args)=>{window.writes=args}'},
 configureServer(s){s.middlewares.use(async (req,res,next)=>{if(req.url==='/email-test'){res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml('/email-test','<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/fixture.jsx"></script></body></html>'))}else next()})}
 }],server:{host:'127.0.0.1',port:0}})
 await live.listen()
 let browser
 try {
 browser=await chromium.launch();const page=await browser.newPage({viewport:{width:375,height:812}})
 page.on('pageerror',e=>console.error(e));page.on('console',m=>{if(m.type()==='error')console.error(m.text())});
 await page.goto(live.resolvedUrls.local[0]+'email-test')
 const toggle=page.getByRole('button',{name:'Status history',exact:true})
 await expect(toggle).toBeVisible()
 await t.test('Enter expands, pending status, real event evidence, Space collapses',async()=>{
 await toggle.focus();await page.keyboard.press('Enter');await expect(toggle).toHaveAttribute('aria-expanded','true');await expect(page.getByRole('status')).toHaveText('Loading history…')
 await page.evaluate(e=>window.pending.shift().resolve([e]),event())
 await expect(page.locator('time')).toHaveAttribute('datetime',new Date(2000).toISOString());await expect(page.locator('ol')).toContainText('synthetic-actor');await expect(page.locator('ol')).toContainText('Attempt 2')
 await expect(page.locator('ol')).toContainText('receipt-test');await toggle.focus();await page.keyboard.press('Space');await expect(toggle).toHaveAttribute('aria-expanded','false');await expect(page.locator('time')).toHaveCount(0)
 })
 await t.test('stable identity retains expansion through all lifecycle updates and linking',async()=>{
 await toggle.click()
 for(const status of ['queued','sending','accepted']){
 await page.evaluate(status=>window.show({drafts:[{...window.props.drafts[0],current_status:status,latest_activity_at:3000}]}),status)
 await expect(toggle).toHaveAttribute('aria-expanded','true');await expect(page.locator('time')).toHaveCount(1)
 }
 await page.evaluate(()=>window.show({communications:[{id:'archive',logical_email_id:'logical',channel:'email-worker',provider:'cloudflare',direction:'outbound',from_email:'sender@example.test',to_email:'candidate@example.test',provider_message_id:'message',provider_receipt_id:'receipt',provider_event_id:'event',occurred_at:4000}]}))
 await expect(toggle).toHaveCount(1);await expect(toggle).toHaveAttribute('aria-expanded','true');await expect(page.getByText(/Receipt: receipt/)).toBeVisible()
 assert.equal(await page.evaluate(()=>window.calls.length),1)
 await toggle.click();await expect(toggle).toHaveAttribute('aria-expanded','false');await toggle.click();await expect(toggle).toHaveAttribute('aria-expanded','true')
 })
 await t.test('switching application isolates pending history; errors retry and pagination advances scope cursor',async()=>{
 await page.evaluate(()=>window.show({applicationId:'app2'}));await toggle.click()
 await page.evaluate(()=>window.show({applicationId:'app3'}));await page.evaluate(e=>window.pending.shift().resolve([e]),{...event(),actor:'STALE'})
 await expect(toggle).toHaveAttribute('aria-expanded','false');await toggle.click();await page.evaluate(()=>window.pending.shift().reject(new Error('fixture')))
 await expect(page.getByRole('alert')).toContainText('Could not load status history')
 const retry=page.getByRole('button',{name:'Retry',exact:true});const retryBox=await retry.boundingBox();assert.ok(retryBox.height>=44&&retryBox.width>=44);await retry.click();await expect(page.getByRole('status')).toBeVisible()
 await page.evaluate(events=>window.pending.shift().resolve(events),Array.from({length:50},(_,i)=>event(i)))
 const more=page.getByRole('button',{name:'Load more history'});await expect(more).toBeVisible();const moreBox=await more.boundingBox();assert.ok(moreBox.height>=44&&moreBox.width>=44);await more.click()
 const call=await page.evaluate(()=>window.calls.at(-1));assert.deepEqual(call.params,{organization_id:'org',brand_id:'brand',application_id:'app3',logical_email_id:'logical',cursor_at:2049,cursor_id:'e49'})
 await page.evaluate(e=>window.pending.shift().resolve([e]),event(50));await expect(page.locator('time')).toHaveCount(51);await expect(more).toHaveCount(0);await expect(page.getByText('STALE')).toHaveCount(0)
 })
 await t.test('375px layout and touch target',async()=>{
 const box=await toggle.boundingBox();assert.ok(box.height>=44&&box.width>=44)
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
 })
 await t.test('unknown recovery requires explicit evidence and passkey and creates only an unsent replacement',async()=>{
 await page.evaluate(()=>window.show({drafts:[{...window.props.drafts[0],delivery_state:'unknown',current_status:'unknown'}],communications:[]}))
 await page.getByText('Reconcile: Synthetic subject',{exact:true}).click()
 const recovery=page.getByRole('button',{name:'Confirm provider did not accept'})
 await expect(recovery).toBeDisabled()
 await page.getByRole('textbox',{name:'Provider evidence (no secrets)'}).fill('Provider investigation confirms no acceptance')
 await recovery.click()
 await expect(page.getByRole('status')).toContainText('One unsent replacement draft created')
 assert.equal(await page.evaluate(()=>window.verified),true)
 const [action,params]=await page.evaluate(()=>window.writes)
 assert.equal(action,'reconcile_communication');assert.equal(params.outcome,'not_accepted');assert.equal(params.draft_id,'d');assert.equal(params.application_id,'app3')
 await expect(recovery).toBeDisabled()
 })
 await t.test('detail loading and failure suppress empty state; retry returns to loading',async()=>{
 await page.evaluate(()=>window.show({drafts:[],communications:[],loading:true}));await expect(page.getByRole('status')).toHaveText('Loading communications…');await expect(page.getByText('No communications recorded yet.')).toHaveCount(0)
 await page.evaluate(()=>window.show({loading:false,error:'failed'}));await expect(page.getByRole('alert')).toContainText('Could not load communications');await expect(page.getByText('No communications recorded yet.')).toHaveCount(0)
 await page.getByRole('button',{name:'Retry communications'}).click();await expect(page.getByRole('status')).toHaveText('Loading communications…')
 await page.evaluate(()=>window.show({loading:false,error:''}));await expect(page.getByText('No communications recorded yet.')).toBeVisible()
 })
 } finally {await browser?.close();await live.close()}
})
