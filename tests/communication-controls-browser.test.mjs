import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { chromium, expect } from '@playwright/test'
const require = createRequire(new URL('../web/package.json', import.meta.url))
const { createServer } = await import(require.resolve('vite'))
const { default: react } = await import(require.resolve('@vitejs/plugin-react'))
const web = new URL('../web/', import.meta.url).pathname
const fixture = `import React from 'react';import {createRoot} from 'react-dom/client';import {ApprovedMessage} from '/src/Communications.tsx';
window.calls=[];window.scope={organization_id:'org',brand_id:'brand'};const root=createRoot(document.getElementById('root'));
window.show=()=>root.render(React.createElement(ApprovedMessage,{key:window.scope.brand_id,scope:window.scope,applicationId:'app',recipient:'candidate@example.test',onChanged:()=>{window.changed=true}}));window.show();`
test('approved message preview requires explicit confirmation before queueing at mobile width', async()=>{
 const live=await createServer({root:web,configFile:false,optimizeDeps:{entries:[]},plugins:[react(),{
 name:'approval-fixture',enforce:'pre',resolveId(id){if(id==='/fixture.jsx')return '\0approval-fixture.jsx'},
 load(id){
  if(id==='\0approval-fixture.jsx')return fixture
  if(id===web+'src/api.ts')return `export const id=()=>crypto.randomUUID();export const write=async(name,params)=>{window.calls.push({name,params})};export const read=async(name,params)=>{window.calls.push({name,params});return params.brand_id==='brand'?[{id:'t',name:'Update',version:1,subject:'Approved subject',body:'Safe <script>literal</script>'}]:[]}`
 },configureServer(s){s.middlewares.use(async(req,res,next)=>{if(req.url==='/controls'){res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml('/controls','<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/fixture.jsx"></script></body></html>'))}else next()})}
 }],server:{host:'127.0.0.1',port:0}})
 await live.listen();let browser
 try {
  browser=await chromium.launch();const page=await browser.newPage({viewport:{width:375,height:812}})
  await page.goto(live.resolvedUrls.local[0]+'controls')
  await page.getByLabel('Approved template').selectOption('t')
  await expect(page.getByLabel('Message preview')).toContainText('candidate@example.test')
  await expect(page.getByLabel('Message preview')).toContainText('Safe <script>literal</script>')
  assert.equal(await page.locator('[aria-label="Message preview"] script').count(),0)
  assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.name==='queue_communication').length),0)
  await page.getByRole('button',{name:'Confirm and send this message'}).focus();await page.keyboard.press('Enter')
  await expect(page.getByRole('status')).toContainText('Queued')
  assert.deepEqual(await page.evaluate(()=>window.calls.filter(c=>c.name!=='list_approved_communication_templates').map(c=>c.name)),['create_communication_draft','queue_communication'])
  assert.equal(await page.evaluate(()=>window.calls.find(c=>c.name==='queue_communication').params.draft_id===window.calls.find(c=>c.name==='create_communication_draft').params.draft_id),true)
  await page.evaluate(()=>{window.scope={organization_id:'org',brand_id:'other'};window.show()})
  await expect(page.getByLabel('Message preview')).toHaveCount(0)
  await expect(page.getByRole('button',{name:'Confirm and send this message'})).toHaveCount(0)
 }finally{await browser?.close();await live.close()}
})
