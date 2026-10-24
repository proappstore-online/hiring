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
const fixture = `import React from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter}from'react-router-dom';import{RecruiterContext,ComplianceScreen}from'/src/RecruiterScreens.tsx';import'/src/index.css';
window.calls=[];window.result=null;window.fail=false;window.rights=[];
window.action=async(name,params)=>{window.calls.push({name,params});if(window.fail)throw Error('synthetic');
if(name==='record_candidate_rights_event'){window.rights.push({...params,id:params.operation_id,version:params.expected_version+1});return{meta:{changes:1}};}
if(name==='list_candidate_rights_events')return{rows:window.rights};
if(name==='get_candidate_export')return{rows:[{candidate_id:'candidate',name:'Test',coverage:'scoped_core_export'}]};
if(name==='request_candidate_erasure'){window.result={request_id:'request-1',operation_id:params.operation_id,application_id:params.application_id,created_at:1000,status:'partial',stores_json:JSON.stringify([{store:'candidate_core',remaining_records:0},{store:'hiring_outbox',remaining_records:1}]),verification_code:'files_indexes_exports_backups_require_verification',processor:'MAIL',processor_status:'blocked',processor_reason:'no_verified_deletion_route'};return{meta:{changes:1}};}
return{rows:name==='get_candidate_erasure_status'&&window.result?[window.result]:[]};};
const root=createRoot(document.getElementById('root'));let revision=0;
window.show=(role='owner',brand='brand')=>root.render(React.createElement(MemoryRouter,null,React.createElement(RecruiterContext.Provider,{value:{space:{organization_id:'org',brand_id:brand,role},userId:'owner',reloadSpaces:async()=>{}}},React.createElement(ComplianceScreen,{key:++revision}))));window.show();`
test('owner compliance screen wires real erasure API with confirmations, scoped status, retry and mobile layout', async () => {
  const cacheDir = mkdtempSync(join(tmpdir(), 'hiring-erasure-vite-'))
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
    await expect(page.getByLabel('Application ID',{exact:true})).toBeVisible({timeout:30000})
    await expect(page.getByRole('button',{name:'Request deletion',exact:true})).toHaveCount(0)
    await page.getByLabel('Subject application ID',{exact:true}).fill('app')
    await page.getByLabel('Response deadline',{exact:true}).fill('2026-11-01T12:00')
    await page.getByRole('button',{name:'Record request with passkey',exact:true}).click()
    await expect(page.getByText(/State: received/)).toBeVisible()
    await page.getByRole('button',{name:'Begin identity review',exact:true}).click()
    await expect(page.getByText(/State: identity_verification/)).toBeVisible()
    await page.getByLabel('Identity verification case reference',{exact:true}).fill('opaque-case')
    await page.getByRole('button',{name:'Confirm verified identity with passkey',exact:true}).click()
    await expect(page.getByText(/State: processing/)).toBeVisible()
    const download=page.waitForEvent('download')
    await page.getByRole('button',{name:'Download private core export',exact:true}).click()
    assert.equal((await download).suggestedFilename(),'candidate-core-export.json')
    await expect(page.getByText(/Core export downloaded/)).toBeVisible()

    await page.getByLabel('Application ID',{exact:true}).fill('app')
    await page.getByLabel("I have verified the candidate's identity and request scope.").check()
    await page.getByLabel('I have reviewed legal holds and confirmed that core redaction is permitted.').check()
    const confirm = async () => {
      await page.getByRole('button',{name:'Request deletion',exact:true}).click()
      await page.getByRole('button',{name:'Continue review',exact:true}).click()
      await page.getByRole('button',{name:'Confirm deletion request',exact:true}).click()
    }
    await page.evaluate(()=>window.fail=true);await confirm()
    await expect(page.getByRole('alert')).toBeVisible()
    assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.name==='request_candidate_erasure').length),0)
    await page.evaluate(()=>window.fail=false);await confirm()
    await expect(page.getByRole('heading',{name:'Partial erasure — completion not verified'})).toBeVisible()
    await expect(page.getByText('hiring_outbox: 1 records require review')).toBeVisible()
    await expect(page.getByText(/MAIL propagation: blocked/)).toBeVisible()
    const mutation=await page.evaluate(()=>window.calls.find(c=>c.name==='request_candidate_erasure'))
    assert.equal(mutation.params.organization_id,'org');assert.equal(mutation.params.brand_id,'brand');assert.equal(mutation.params.application_id,'app')
    assert.equal(mutation.params.identity_verified,1);assert.equal(mutation.params.holds_reviewed,1)
    assert.equal('role' in mutation.params,false)
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
    await page.evaluate(()=>window.show('owner','sibling'))
    await expect(page.getByLabel('Application ID',{exact:true})).toHaveValue('')
    await expect(page.getByRole('region',{name:'Erasure progress'})).toHaveCount(0)
    for(const role of ['recruiter','auditor','reviewer']){
      await page.evaluate(role=>window.show(role),role)
      await expect(page.getByLabel('Application ID',{exact:true})).toHaveCount(0)
      await expect(page.getByRole('button',{name:'Request deletion',exact:true})).toHaveCount(0)
    }
    assert.deepEqual(errors,[])
  } finally {await browser?.close();await server.close();rmSync(cacheDir,{recursive:true,force:true})}
})
