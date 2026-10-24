import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { chromium, expect } from '@playwright/test'
const require = createRequire(new URL('../web/package.json', import.meta.url))
const { createServer } = await import(require.resolve('vite'))
const { default: react } = await import(require.resolve('@vitejs/plugin-react'))
const { default: tailwind } = await import(require.resolve('@tailwindcss/vite'))
const web = new URL('../web/', import.meta.url).pathname
const fixture = `import React from 'react';import{createRoot}from'react-dom/client';import{CorrectionControls}from'/src/CorrectionControls.tsx';import'/src/index.css';
window.calls=[];window.steps=[];window.uncertain=true;
window.action=async(name,params)=>{window.calls.push({name,params});
if(name==='audited_gateway_get_application')return{rows:[{version:7}]};
if(name==='list_candidate_rectifications')return{rows:window.steps};
if(name==='apply_candidate_correction'){window.steps=['MAIL','search'].map(processor_id=>({correction_id:params.operation_id,processor_id,state:'pending',version:0}));if(window.uncertain)throw Error('lost response');return{meta:{changes:1}};}
if(name==='record_candidate_rectification'){const row=window.steps.find(x=>x.processor_id===params.processor_id);row.state=params.state;row.version++;return{meta:{changes:1}};}
return{rows:[]};};
const root=createRoot(document.getElementById('root'));window.show=(brand='a')=>root.render(React.createElement(CorrectionControls,{key:brand,scope:{organization_id:'org',brand_id:brand},applicationId:'app-a',requestId:'rights-a',rightsVersion:3}));window.show();`
test('correction UI reconciles lost approval response, shows partial processors and resets on scope change', async () => {
  const cacheDir = mkdtempSync(join(tmpdir(), 'hiring-correction-vite-'))
  const server = await createServer({ root:web,cacheDir,configFile:false,optimizeDeps:{entries:[],include:['react','react-dom/client','react-router-dom','@proappstore/sdk']},plugins:[react(),tailwind(),{
    name:'erasure-fixture',enforce:'pre',resolveId(id){if(id==='/fixture.jsx')return'\0erasure-fixture.jsx'},
    load(id){if(id===web+'src/passkey.ts')return 'export async function verifyPublicationPasskey(){};export async function registerPublicationPasskey(){}';if(id==='\0erasure-fixture.jsx')return fixture;if(id===web+'src/api.ts')return readFileSync(id,'utf8').replace("import { initPro } from '@proappstore/sdk'",'').replace("export const app = initPro({ appId: 'hiring' })",'export const app = { actions: { call: (...args) => window.action(...args) }, auth: {user: {id: "owner"}} }')},
    configureServer(s){s.middlewares.use(async(req,res,next)=>{if(req.url==='/erasure-test'){res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml('/erasure-test','<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/fixture.jsx"></script></body></html>'))}else next()})}
  }],server:{host:'127.0.0.1',port:0}})
  let browser
  try {
    await server.listen();browser=await chromium.launch();const page=await browser.newPage({viewport:{width:375,height:812}})
    const errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000)
    await page.goto(server.resolvedUrls.local[0]+'erasure-test')
    const approve=page.getByRole('button',{name:'Approve and apply correction with passkey'})
    await expect(approve).toBeDisabled()
    await page.getByRole('button',{name:'Load correction context and processor status'}).click()
    await page.getByLabel('Corrected value',{exact:true}).fill('corrected@example.test')
    await page.getByLabel('Correction reason reference',{exact:true}).fill('opaque-private-case')
    await approve.click()
    await expect(page.getByText(/Correction applied. Processor/)).toBeVisible()
    await expect(page.getByText('MAIL: pending · attempt 0')).toBeVisible()
    await expect(approve).toBeDisabled()
    await page.getByLabel('Private processor evidence reference').fill('receipt-45')
    await page.getByRole('button',{name:'Record MAIL complete',exact:true}).click()
    await expect(page.getByText('MAIL: complete · attempt 1')).toBeVisible()
    await page.getByRole('button',{name:'Record search failed',exact:true}).click()
    await expect(page.getByText('search: failed · attempt 1')).toBeVisible()
    const writes=await page.evaluate(()=>window.calls.filter(c=>['apply_candidate_correction','record_candidate_rectification'].includes(c.name)))
    assert.equal(writes.length,3)
    assert.equal(writes[0].params.expected_application_version,7)
    assert.equal(writes[0].params.expected_version,3)
    assert.ok(writes.every(c=>c.params.organization_id==='org'&&c.params.brand_id==='a'&&c.params.application_id==='app-a'&&c.params.request_id==='rights-a'))
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
    await page.evaluate(()=>window.show('b'))
    await expect(page.getByLabel('Corrected value',{exact:true})).toHaveValue('')
    await expect(page.getByText('search: failed · attempt 1')).toHaveCount(0)
    assert.deepEqual(errors,[])
  } finally {await browser?.close();await server.close();rmSync(cacheDir,{recursive:true,force:true})}
})
