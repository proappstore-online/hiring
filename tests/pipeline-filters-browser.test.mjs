import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { chromium, expect } from '@playwright/test'
const require = createRequire(new URL('../web/package.json', import.meta.url))
const ts = require('typescript')
const { createServer } = await import(require.resolve('vite'))
const { default: react } = await import(require.resolve('@vitejs/plugin-react'))
const { default: tailwind } = await import(require.resolve('@tailwindcss/vite'))
const web = new URL('../web/', import.meta.url).pathname
const fixture = `import React from 'react';import{createRoot}from'react-dom/client';import{BrowserRouter}from'react-router-dom';import{ApplicationFilters}from'/src/ApplicationFilters.tsx';import'/src/index.css';
window.calls=[];window.fail=false;window.hold=false;window.pending=[];
const row={id:'app',candidate_name:'Alice',stage:'submitted',requisition_id:'req',requisition_title:'Engineer',source:'linkedin',source_detail:'Recruiter referral',assignee_user_id:'staff',created_at:1792454400000};
window.read=async(name,params)=>{window.calls.push({name,params});if(window.hold)await new Promise(resolve=>window.pending.push(resolve));if(window.fail)throw Error('fixture');return window.empty||params.stage==='hired'||params.requisition_id==='missing'?[]:[{...row,stage:params.stage||row.stage}]};
createRoot(document.getElementById('root')).render(<BrowserRouter><ApplicationFilters space={{organization_id:'org',brand_id:'brand',role:'recruiter'}} requisitions={[{id:'req',title:'Engineer'}]} members={[{user_id:'staff',role:'recruiter'}]}/></BrowserRouter>);`
test('pipeline filters restore URLs, keep search local, expose unavailable states and support mobile retry',async()=>{
 const cacheDir=mkdtempSync(join(tmpdir(),'hiring-filters-'))
 const server=await createServer({root:web,cacheDir,configFile:false,plugins:[react(),tailwind(),{
 name:'filter-fixture',enforce:'pre',resolveId(id){if(id==='/fixture.jsx')return'\0filter-fixture.jsx'},
 load(id){if(id==='\0filter-fixture.jsx')return ts.transpile(fixture,{jsx:ts.JsxEmit.React,module:ts.ModuleKind.ESNext});if(id===web+'src/api.ts')return 'export const read=(...args)=>window.read(...args);export const stageLabel=s=>s.replaceAll("_"," ");'},
 configureServer(s){s.middlewares.use(async(req,res,next)=>{if(req.headers.accept?.includes('text/html')){res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(req.url,'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/fixture.jsx"></script></body></html>'))}else next()})}
 }],server:{host:'127.0.0.1',port:0}})
 let browser
 try{
 await server.listen();browser=await chromium.launch();const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));const base=server.resolvedUrls.local[0]
 await page.goto(base+'applications?organization_id=org&brand_id=brand&stage=submitted&requisition=req&source=linkedin&date_from=2026-10-01')
 await expect(page.getByText('1 visible / 1 loaded',{exact:true})).toBeVisible()
 await expect(page.getByRole('heading',{name:'Applications',exact:true})).toHaveCount(1)
 await expect(page.locator('header a')).toHaveText('Add candidate')
 const applicant=page.getByRole('link',{name:"Open Alice's profile"})
 await expect(applicant).toContainText('staff');await expect(applicant.locator('time')).toHaveText('2026-10-20')
 await expect(applicant).toHaveAttribute('href',/recruiter\/applications\/app\?.*back=/)
 await expect(page.getByLabel('Stage',{exact:true})).toBeHidden()
 const calls=await page.evaluate(()=>window.calls);assert.ok(calls.some(c=>c.params.requisition_id==='req'&&c.params.stage==='submitted'&&c.params.date_from===Date.parse('2026-10-01')))
 await page.getByRole('button',{name:'Filters',exact:true}).click()
 await expect(page.getByLabel('Position / requisition')).toHaveValue('req');await expect(page.getByLabel('Stage',{exact:true})).toHaveValue('submitted')
 for(const label of ['LinkedIn campaign'])await expect(page.getByLabel(label,{exact:true})).toBeDisabled()
 await expect(page.getByLabel('Onboarding status',{exact:true})).toBeEnabled();await expect(page.getByLabel('Invited from (UTC)',{exact:true})).toBeEnabled()
 const search=page.getByRole('searchbox');await search.fill('referral');await expect(page.getByText('1 visible / 1 loaded',{exact:true})).toBeVisible();assert.ok(!page.url().includes('referral'))
 await search.fill('Nobody');await expect(page.getByText('No applications match these filters.')).toBeVisible()
 await page.getByRole('button',{name:'Clear search',exact:true}).click()
 await page.getByLabel('Stage',{exact:true}).selectOption('accepted');await expect(page.getByRole('link',{name: "Open Alice's profile"})).toContainText('accepted');await expect(page).toHaveURL(/stage=accepted/);await page.getByLabel('Stage',{exact:true}).selectOption('hired');await expect(page.getByText('No applications match these filters.')).toBeVisible();await expect(page).toHaveURL(/stage=hired/)
 await page.reload();await page.getByRole('button',{name:'Filters',exact:true}).click();await expect(page.getByLabel('Stage',{exact:true})).toHaveValue('hired')
 await page.getByRole('button',{name:'Clear filters',exact:true}).last().click();await expect(page.getByText('1 visible / 1 loaded',{exact:true})).toBeVisible();assert.ok(page.url().includes('brand_id=brand'));assert.ok(!page.url().includes('stage='))
 await page.getByLabel('Stage',{exact:true}).selectOption('offered');await page.goBack();await expect(page.getByLabel('Stage',{exact:true})).toHaveValue('');await page.goForward();await expect(page.getByLabel('Stage',{exact:true})).toHaveValue('offered')
 await page.evaluate(()=>window.fail=true);await page.getByLabel('Stage',{exact:true}).selectOption('hired');await expect(page.getByRole('alert')).toContainText('Could not load applications.')
 await page.evaluate(()=>{window.fail=false;window.hold=true});await page.getByRole('button',{name:'Retry',exact:true}).click();await expect(page.getByText('Loading applications… You can adjust filters while you wait.',{exact:true})).toBeVisible()
 await page.evaluate(()=>{window.hold=false;window.pending.splice(0).forEach(resolve=>resolve())});await expect(page.getByText('No applications match these filters.')).toBeVisible()
 await page.getByRole('button',{name:'Clear Stage',exact:true}).focus();await page.keyboard.press('Enter');await expect(page.getByText('1 visible / 1 loaded',{exact:true})).toBeVisible()
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.setViewportSize({width:1280,height:900});await page.reload()
 await expect(page.getByLabel('Stage',{exact:true})).toBeVisible()
 assert.ok((await page.getByRole('link',{name:"Open Alice's profile"}).boundingBox()).height<=64)
 await page.getByLabel('Position / requisition').selectOption('req');await page.getByLabel('Stage',{exact:true}).selectOption('hired')
 await expect(page.getByText('No applications match these filters.')).toBeVisible()
 await expect(page.getByText('Clear filters or broaden your search to find applicants.')).toBeVisible()
 await page.evaluate(()=>window.empty=true);await page.getByRole('button',{name:'Clear filters',exact:true}).last().click()
 await expect(page.getByText('No applications yet.',{exact:true})).toBeVisible()
 await expect(page.getByText('Use Add candidate to start your pipeline.',{exact:true})).toBeVisible()
 await expect(page.locator('header a')).toHaveAttribute('href','/recruiter/applications/new?organization_id=org&brand_id=brand')
 assert.deepEqual(errors,[])

 }finally{await browser?.close();await server.close();rmSync(cacheDir,{recursive:true,force:true})}
})
