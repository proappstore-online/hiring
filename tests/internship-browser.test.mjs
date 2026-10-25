import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { chromium, expect } from '@playwright/test'
const require=createRequire(new URL('../web/package.json',import.meta.url))
const ts=require('typescript')
const {createServer}=await import(require.resolve('vite'))
const {default:react}=await import(require.resolve('@vitejs/plugin-react'))
const web=new URL('../web/',import.meta.url).pathname
const fixture=`import React from 'react';import{createRoot}from'react-dom/client';import{InternshipProgress}from'/src/InternshipIntake.tsx';import{PublishJob}from'/src/Jobs.tsx';
window.calls=[];window.historyRows=[];window.fail=false;
window.read=async(name,p)=>{window.calls.push({name,p});if(name==='get_vacancy_management')return [{terms_version:1,terms_json:JSON.stringify({engagement_basis:'volunteer',programme_kind:'internship',compensation_type:'unpaid',compensation_amount:null,compensation_currency:null,weekly_hours_min:8,weekly_hours_max:8,programme_weeks:10,weeks_basis:'approved'})}];if(name==='get_requisition_review')return [{version:1,payload:JSON.stringify({compensation_type:'internship'})}];return name==='get_internship_policy'?[{onboarding_url:'https://interns.freeappstore.online/onboarding',template_id:'approved-interns',template_version:1}]:window.historyRows};
window.write=async(name,p)=>{window.calls.push({name,p});if(window.fail)throw Error('Sent direct invitation required');window.historyRows=[{...p,version:p.expected_version+1}]};
const root=createRoot(document.getElementById('root'));root.render(<><PublishJob scope={{organization_id:'org',brand_id:'a'}} requisitions={[{id:'req-73'}]}/><InternshipProgress scope={{organization_id:'org',brand_id:'a'}} application={{id:'candidate-73',requisition_id:'req-73'}}/></>);`
test('internship onboarding form uses scoped versioned evidence and reports rejected invitations',async()=>{
 const cacheDir=mkdtempSync(join(tmpdir(),'hiring-pool-'))
 const server=await createServer({root:web,cacheDir,configFile:false,plugins:[react(),{
  name:'pool-fixture',enforce:'pre',resolveId(id){if(id==='/fixture.jsx')return'\0pool-fixture.jsx'},
  load(id){if(id==='\0pool-fixture.jsx')return ts.transpile(fixture,{jsx:ts.JsxEmit.React,module:ts.ModuleKind.ESNext});if(id===web+'src/api.ts')return'export const TERMINAL_STAGES=[];export const app={};export const readPublic=()=>Promise.resolve([]);export const stageLabel=s=>s;export const read=(...args)=>window.read(...args);export const write=(...args)=>window.write(...args);export const id=()=>crypto.randomUUID();'},
  configureServer(s){s.middlewares.use(async(req,res,next)=>{if(req.headers.accept?.includes('text/html')){res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(req.url,'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/fixture.jsx"></script></body></html>'))}else next()})}
 }],server:{host:'127.0.0.1',port:0}})
 let browser
 try{
  await server.listen();browser=await chromium.launch();const page=await browser.newPage();page.on('pageerror',error=>console.error(error.message))
  await page.setViewportSize({width:375,height:812})
  await page.goto(server.resolvedUrls.local[0])
  await expect(page.getByRole('heading',{name:'Direct Interns onboarding'})).toBeVisible()
  await page.getByRole('button',{name:'Publish & open applications'}).click()
  await expect(page.getByText('Published as an unlisted internship. Use controlled sourcing and direct Interns onboarding.')).toBeVisible()
  assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.name==='set_hiring_runtime_gate').length),0)
  await expect(page.getByRole('link',{name:'Open direct Interns onboarding'})).toHaveAttribute('href','https://interns.freeappstore.online/onboarding')
  await page.getByRole('textbox',{name:'Evidence reference (Interns application/onboarding or exception)'}).fill('Source verified by recruiter')
  await page.getByRole('button',{name:'Save form'}).click()
  await expect(page.locator('section').filter({has:page.getByRole('heading',{name:'Direct Interns onboarding'})}).getByRole('status')).toHaveText('Onboarding evidence saved.')
  const saved=await page.evaluate(()=>window.calls.find(c=>c.name==='record_internship_progress').p)
  assert.equal(saved.reason_code,'source_verified');assert.equal(saved.expected_version,0);assert.equal(saved.application_id,'candidate-73');assert.equal(saved.brand_id,'a')
  await page.getByRole('combobox',{name:'Status',exact:true}).selectOption('invited')
  await page.evaluate(()=>window.fail=true)
  await page.getByRole('button',{name:'Save form'}).click()
  await expect(page.locator('section').filter({has:page.getByRole('heading',{name:'Direct Interns onboarding'})}).getByRole('status')).toHaveText('Sent direct invitation required')
  await expect(page.getByRole('button',{name:/interview/i})).toHaveCount(0)

 }finally{await browser?.close();await server.close();rmSync(cacheDir,{recursive:true,force:true})}
})
