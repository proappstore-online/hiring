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
const ts = require('typescript')
const transpile = source => ts.transpile(source, {jsx:ts.JsxEmit.React, module:ts.ModuleKind.ESNext})
const web = new URL('../web/', import.meta.url).pathname
const sdk = `import React from 'react'; export const initPro=()=>({auth:{user:null}}); export const useAuth=()=>window.auth; export const ProShell=({children})=><div data-testid="staff-shell">{children}</div>; export const PageHeader=({title})=><h1>{title}</h1>; export const SignInButton=({label})=><button>{label}</button>;`
const fixture = `import React from 'react';import {createRoot} from 'react-dom/client';import App from '/src/App.tsx';import '/src/index.css';
window.auth={user:{id:'candidate'},loading:false};window.calls=[];window.gate='open';window.receipt=null;window.uncertain=false;window.holdSubmit=false;window.fail=false;
const jobs=['a','b'].map(brand=>({requisition_id:'job-'+brand,organization_id:'org',brand_id:brand,title:brand==='a'?'Engineer':'Designer',brand_name:'Brand '+brand,organization_name:'Org',location:'Remote',description:'Approved role',arrangement:'Remote',notice_text:'Approved privacy notice',notice_version:'v1',version:1}));
const applications=jobs.map((j,i)=>({...j,application_id:'app-'+j.brand_id,created_at:1000+i,stage:i?'in_review':'submitted'}));
window.read=async(name,p={})=>{window.calls.push({name,p});if(window.fail)throw Error('Unavailable');if(name==='list_public_jobs'||name==='list_vacancies')return jobs;if(name==='get_public_job'||name==='get_vacancy_detail'){if(window.loadHold)await new Promise(resolve=>window.finishLoad=resolve);if(window.unpublished)return [];return jobs.filter(j=>j.requisition_id===p.requisition_id&&j.brand_id===p.brand_id&&j.organization_id===p.organization_id)};if(name==='get_hiring_runtime_gate')return [{intake_status:window.gate}];if(name==='list_my_job_applications')return window.empty?[]:applications;if(name==='get_my_application') {if(window.detailFail)throw Error('not registered');return applications.filter(a=>a.application_id===p.application_id)};if(name==='get_my_application_receipt'||name==='get_my_requisition_receipt'){if(window.receiptFail){window.receiptFail=false;throw Error('Receipt connection lost')}return window.receipt?[window.receipt]:[]};if(name==='list_application_attachments')return [{id:'file',filename:'resume.pdf',size_bytes:100,mime_type:'application/pdf',scan_state:'pending',uploader_user_id:'candidate'}];return []};
window.write=async(name,p)=>{window.calls.push({name,p});if(name==='submit_job_application'){if(window.rejectSubmission)throw Error(window.rejectSubmission);if(window.holdSubmit)await new Promise(resolve=>window.finishSubmit=resolve);const payload={name:p.candidate_name,email:p.email,phone:p.phone,statement:p.statement,notice_version:p.notice_version,publication_version:p.expected_version,notice_acknowledged:p.notice_acknowledged,talent_pool_consent:p.talent_pool_consent,communications_consent:p.communications_consent,requisition_id:p.requisition_id,brand_id:p.brand_id,organization_id:p.organization_id};window.receipt={...p,application_id:'app-'+p.brand_id,payload_json:JSON.stringify(payload),stage:'submitted'};if(window.uncertain)throw Error('Submission connection lost')}};
const root=createRoot(document.getElementById('root'));window.render=()=>root.render(<App/>);window.render();`

test('candidate account and application journey', async t => {
 const cacheDir = mkdtempSync(join(tmpdir(), 'hiring-candidate-vite-'))
 const server = await createServer({root:web,configFile:false,cacheDir,optimizeDeps:{entries:[],include:['react','react-dom/client','react-router-dom','@proappstore/sdk']},plugins:[react(),tailwind(),{
  name:'vacancy-fixture.jsx',enforce:'pre',
  resolveId(id){if(id==='@proappstore/sdk')return '\0vacancy-sdk.jsx';if(id==='/fixture.jsx')return '\0vacancy-fixture.jsx'},
  load(id){if(id==='\0vacancy-sdk.jsx')return transpile(sdk);if(id==='\0vacancy-fixture.jsx')return transpile(fixture);if(id===web+'src/api.ts'){return readFileSync(id,'utf8').replace(/export const read = async[^\n]+/, 'export const read = (...args) => window.read(...args)').replace(/export const readPublic = async[^\n]+/,'export const readPublic = (...args) => window.read(...args)').replace(/export const write = async[\s\S]*?\n}/,'export const write = (...args) => window.write(...args)')}},
  configureServer(s){s.middlewares.use(async(req,res,next)=>{if(req.headers.accept?.includes('text/html')){res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(req.url,'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/fixture.jsx"></script></body></html>'))}else next()})}
 }],server:{host:'127.0.0.1',port:0}})
 await server.listen(); let browser
 try {
  browser=await chromium.launch();const context=await browser.newContext({viewport:{width:375,height:812}});const page=await context.newPage();const base=server.resolvedUrls.local[0].replace(/\/$/,'');const go=path=>page.goto(base+path)

  await t.test('owned list, direct details, unavailable IDs, fallback and private metadata',async()=>{
   await go('/my-applications');await expect(page.getByRole('heading',{name:'My Applications',exact:true})).toBeVisible()
   await expect(page.getByRole('link',{name:'Engineer',exact:true})).toBeVisible();await expect(page.getByRole('link',{name:'Designer',exact:true})).toBeVisible()
   await page.getByRole('link',{name:'Engineer',exact:true}).focus();await page.keyboard.press('Enter')
   await expect(page).toHaveURL(/my-applications\/app-a$/);await expect(page.getByText('Status: submitted')).toBeVisible()
   await expect(page.getByText('Withdrawal is not currently available.')).toBeVisible();await expect(page.getByText(/resume.pdf/)).toBeVisible();await expect(page.getByRole('link',{name:/download/i})).toHaveCount(0)
   assert.doesNotMatch(await page.locator('main').innerText(),/Designer|recruiter note/)
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
   await go('/my-applications/app-b');await expect(page.getByRole('heading',{name:'Designer',exact:true})).toBeVisible();await expect(page.getByText('Status: in review')).toBeVisible();await expect(page.getByRole('heading',{name:'Engineer',exact:true})).toHaveCount(0)
   await go('/my-applications/another-owner');await expect(page.getByRole('heading',{name:'404 — Not found'})).toBeVisible()
   assert.equal(await page.evaluate(()=>window.calls.some(c=>/gateway|notes|workspaces/.test(c.name))),false)
   await page.evaluate(()=>window.detailFail=true);await page.getByRole('link',{name:'My Applications',exact:true}).first().click();await page.getByRole('link',{name:'Engineer',exact:true}).click();await expect(page.getByText('Status: submitted')).toBeVisible()
  })
  await t.test('both discovery pages filter brands and retain exact scope',async()=>{
   for(const route of ['/jobs','/vacancies']){
    await go(route);await page.getByRole('combobox',{name:'Brand',exact:true}).selectOption('b')
    await expect(page.getByRole('link',{name:route==='/jobs'?'Designer · Brand b · Remote':'Designer',exact:true})).toBeVisible()
    await expect(page.getByRole('link',{name:route==='/jobs'?'Engineer · Brand a · Remote':'Engineer',exact:true})).toHaveCount(0)
    await page.getByRole('searchbox').fill('missing');await expect(page.getByText(/No (jobs|vacancies) match these filters/)).toBeVisible()
    await page.getByRole('searchbox').fill('Designer');await page.getByRole('link',{name:route==='/jobs'?'Designer · Brand b · Remote':'Designer',exact:true}).click()
    await expect(page).toHaveURL(/organization_id=org&brand_id=b/);await expect(page.getByRole('heading',{name:'Designer',level:1,exact:true})).toBeVisible()
   }
   await go('/jobs/job-a?organization_id=org&brand_id=b');await expect(page.getByRole('heading',{name:'404 — Not found'})).toBeVisible()
  })
  async function fillForm(){
   await page.getByLabel('Your name',{exact:true}).fill('Candidate')
   await page.getByLabel('Email',{exact:true}).fill('candidate@example.com')
   const optional=page.locator('input[name=talent_pool_consent]');await expect(optional).not.toBeChecked();await expect(page.locator('input[name=communications_consent]')).not.toBeChecked()
   await page.locator('input[name=notice_acknowledged]').check()
  }
  await t.test('submission progress, receipt and status link',async()=>{
   await go('/apply/job-a?organization_id=org&brand_id=a');await fillForm();await page.evaluate(()=>window.holdSubmit=true)
   await page.getByRole('button',{name:'Submit application',exact:true}).click();await expect(page.getByText('Submitting application and checking your receipt…')).toBeVisible()
   await expect.poll(()=>page.evaluate(()=>typeof window.finishSubmit)).toBe('function');await page.evaluate(()=>window.finishSubmit())
   await expect(page.getByText(/Application saved for Brand a/)).toBeVisible();await page.getByRole('link',{name:'View application status'}).click();await expect(page).toHaveURL(/my-applications\/app-a$/)
  })
  await t.test('uncertain responses reconcile on retry with stable identifiers',async()=>{
   await go('/apply/job-a?organization_id=org&brand_id=a');await fillForm();await page.evaluate(()=>{window.uncertain=true;window.receiptFail=true})
   await page.getByRole('button',{name:'Submit application',exact:true}).click();await expect(page.getByRole('alert')).toContainText('retry with the same form values')
   await page.getByRole('button',{name:'Submit application',exact:true}).click();await expect(page.getByRole('link',{name:'View application status'})).toBeVisible()
   const writes=await page.evaluate(()=>window.calls.filter(c=>c.name==='submit_job_application'));assert.equal(writes.length,2);assert.equal(writes[0].p.idempotency_key,writes[1].p.idempotency_key);assert.equal(writes[0].p.application_id,writes[1].p.application_id)
  })
  await t.test('two brand forms bind identity, scope, versions and isolated confirmation',async()=>{
   for(const brand of ['a','b']){
    await go('/apply/job-'+brand+'?organization_id=org&brand_id='+brand)
    await expect(page.getByRole('heading',{name:'Apply to Brand '+brand,exact:true})).toBeVisible()
    await expect(page.getByRole('heading',{name:'Apply to Brand '+(brand==='a'?'b':'a'),exact:true})).toHaveCount(0)
    await fillForm();await page.getByRole('button',{name:'Submit application',exact:true}).click()
    await expect(page.getByText('Application saved for Brand '+brand+'. Reference: app-'+brand+'.')).toBeFocused()
    const calls=await page.evaluate(()=>window.calls.filter(c=>c.name==='submit_job_application'))
    assert.equal(calls.length,1);assert.equal(calls[0].p.brand_id,brand);assert.equal(calls[0].p.organization_id,'org');assert.equal(calls[0].p.requisition_id,'job-'+brand);assert.equal(calls[0].p.notice_version,'v1');assert.equal(calls[0].p.expected_version,1)
    assert.doesNotMatch(page.url(),/candidate%40|candidate@example|Candidate/)
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
   }
  })
  await t.test('keyboard validation, tab order and submission reach a focused confirmation',async()=>{
   await go('/apply/job-a?organization_id=org&brand_id=a')
   const name=page.getByLabel('Your name',{exact:true}), email=page.getByLabel('Email',{exact:true})
   await page.getByRole('button',{name:'Submit application',exact:true}).click();await expect(name).toBeFocused();await expect(name).toHaveAttribute('aria-invalid','true')
   await page.keyboard.type('   ');await page.keyboard.press('Enter');await expect(name).toBeFocused()
   await name.fill('Candidate');await page.keyboard.press('Tab');await expect(email).toBeFocused()
   await page.keyboard.type('bad');await page.keyboard.press('Enter');await expect(email).toBeFocused()
   await email.fill('candidate@example.com');await page.keyboard.press('Enter');await expect(page.locator('[name=notice_acknowledged]')).toBeFocused()
   assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.name==='submit_job_application').length),0)
   await name.focus();await page.keyboard.press('Tab');await expect(email).toBeFocused()
   await page.keyboard.press('Tab');await expect(page.getByLabel('Phone (optional)',{exact:true})).toBeFocused()
   await page.keyboard.press('Tab');await expect(page.getByLabel('Application statement (optional)',{exact:true})).toBeFocused()
   await page.keyboard.press('Tab');await expect(page.locator('[name=notice_acknowledged]')).toBeFocused();await page.keyboard.press('Space')
   await page.keyboard.press('Tab');await expect(page.locator('[name=talent_pool_consent]')).toBeFocused()
   await page.keyboard.press('Tab');await expect(page.locator('[name=communications_consent]')).toBeFocused()
   await page.keyboard.press('Tab');await expect(page.getByRole('button',{name:'Submit application',exact:true})).toBeFocused();await page.keyboard.press('Enter')
   await expect(page.getByText(/Application saved for Brand a/)).toBeFocused()
   await page.keyboard.press('Tab');await expect(page.getByRole('link',{name:'View application status'})).toBeFocused()
  })
  await t.test('forged scope, unpublished jobs and closed gate expose no application form',async()=>{
   for(const path of ['/apply/job-a?organization_id=org&brand_id=b','/apply/job-a?organization_id=wrong&brand_id=a','/apply/missing?organization_id=org&brand_id=a']){
    await go(path);await expect(page.getByRole('heading',{name:'404 — Not found'})).toBeVisible();await expect(page.getByRole('button',{name:'Submit application',exact:true})).toHaveCount(0)
   }
   for(const flag of ['unpublished','gate']){
    await go('/jobs');await page.evaluate(flag=>{if(flag==='gate')window.gate='closed';else window.unpublished=true},flag)
    await page.getByRole('link',{name:'Engineer · Brand a · Remote'}).click()
    if(flag==='gate')await expect(page.getByText('Applications are not open yet. Please check back later.')).toBeVisible()
    else await expect(page.getByRole('heading',{name:'404 — Not found'})).toBeVisible()
    await expect(page.getByRole('button',{name:'Submit application',exact:true})).toHaveCount(0)
   }
  })
  await t.test('stale notice and publication errors focus feedback and preserve retry identity',async()=>{
   for(const reason of ['Notice version is stale.','Publication version is stale.']){
    await go('/apply/job-a?organization_id=org&brand_id=a');await fillForm();await page.evaluate(reason=>window.rejectSubmission=reason,reason)
    await page.getByRole('button',{name:'Submit application',exact:true}).click();await expect(page.getByRole('alert')).toContainText(reason);await expect(page.getByRole('alert')).toBeFocused()
    const errorId=await page.getByRole('alert').getAttribute('id');assert.ok((await page.getByLabel('Email',{exact:true}).getAttribute('aria-describedby')).includes(errorId))
    await expect(page.getByRole('link',{name:'View application status'})).toHaveCount(0)
    await page.evaluate(()=>window.rejectSubmission=null);await page.getByRole('button',{name:'Submit application',exact:true}).click();await expect(page.getByText(/Application saved for Brand a/)).toBeVisible()
    const calls=await page.evaluate(()=>window.calls.filter(c=>c.name==='submit_job_application'));assert.equal(calls[0].p.idempotency_key,calls[1].p.idempotency_key)
   }
  })
  await t.test('application loading and load-error retry remain keyboard accessible',async()=>{
   await go('/jobs');await page.evaluate(()=>window.loadHold=true)
   await page.getByRole('link',{name:'Engineer · Brand a · Remote'}).click();await expect(page.getByText('Loading jobs…')).toBeVisible()
   await expect.poll(()=>page.evaluate(()=>typeof window.finishLoad)).toBe('function');await page.evaluate(()=>{window.loadHold=false;window.finishLoad()})
   await expect(page.getByRole('heading',{name:'Engineer',level:1,exact:true})).toBeVisible()
   await page.getByRole('link',{name:'Jobs',exact:true}).first().click();await page.evaluate(()=>window.fail=true)
   await page.getByRole('link',{name:'Designer · Brand b · Remote'}).click();await expect(page.getByRole('alert')).toContainText('Jobs could not be loaded')
   await page.evaluate(()=>window.fail=false);await page.getByRole('button',{name:'Retry',exact:true}).focus();await page.keyboard.press('Enter')
   await expect(page.getByRole('heading',{name:'Designer',level:1,exact:true})).toBeVisible()
  })
  await t.test('changed retry payload cannot overwrite an uncertain saved application',async()=>{
   await go('/apply/job-a?organization_id=org&brand_id=a');await fillForm();await page.evaluate(()=>{window.uncertain=true;window.receiptFail=true})
   await page.getByRole('button',{name:'Submit application',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible()
   await page.getByLabel('Your name',{exact:true}).fill('Changed');await page.getByRole('button',{name:'Submit application',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Restore the original form values')
   assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.name==='submit_job_application').length),1)
  })
  await t.test('candidate sign-in returns to original account and scoped apply URL',async()=>{
   for(const destination of ['/my-applications','/my-applications/app-b','/apply/job-a?organization_id=org&brand_id=a']){
    await go('/missing');await page.evaluate(()=>{window.auth={user:null,loading:false};window.render()})
    if(destination.startsWith('/apply')){
     await page.evaluate(path=>{history.pushState(null,'',path);dispatchEvent(new PopStateEvent('popstate'))},destination)
     await page.getByRole('link',{name:'Sign in to continue'}).click()
    }else{
     await page.evaluate(path=>{history.pushState(null,'',path);dispatchEvent(new PopStateEvent('popstate'))},destination)
    }
    await expect(page).toHaveURL(new RegExp('/sign-in\\?returnTo='));assert.equal(new URL(page.url()).searchParams.get('returnTo'),destination)
    await page.evaluate(()=>{window.auth={user:{id:'candidate'},loading:false};window.render()});await expect(page).toHaveURL(base+destination)
   }
  })
  await t.test('empty account, auth loading and unsafe return destination',async()=>{
   await go('/missing');await page.evaluate(()=>{window.empty=true});await page.getByRole('link',{name:'My Applications',exact:true}).first().click();await expect(page.getByText(/No applications recorded yet/)).toBeVisible()
   await page.evaluate(()=>{window.auth={user:null,loading:true};window.render()});await expect(page.getByRole('status')).toHaveText('Loading…')
   await go('/sign-in?returnTo=https%3A%2F%2Fevil.example');await expect(page).toHaveURL(/recruiter\/overview/)
  })
  await t.test('closed gate hides submission; failed account load can retry',async()=>{
   await go('/jobs');await page.evaluate(()=>window.gate='closed');await page.getByRole('link',{name:'Engineer · Brand a · Remote'}).click()
   await expect(page.getByText('Applications are not open yet. Please check back later.')).toBeVisible();await expect(page.getByRole('link',{name:'Apply for this job'})).toHaveCount(0)
   await page.evaluate(()=>window.fail=true);await page.getByRole('link',{name:'My Applications',exact:true}).first().click();await expect(page.getByRole('alert')).toBeVisible();await page.evaluate(()=>window.fail=false);await page.getByRole('button',{name:'Retry',exact:true}).click();await expect(page.getByRole('link',{name:'Designer',exact:true})).toBeVisible()
  })
 } finally { await browser?.close();await server.close();rmSync(cacheDir,{recursive:true,force:true}) }
})
