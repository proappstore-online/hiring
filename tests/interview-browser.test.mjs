import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { chromium, expect } from '@playwright/test'
const require = createRequire(new URL('../web/package.json', import.meta.url))
const { createServer } = await import(require.resolve('vite'))
const { default: react } = await import(require.resolve('@vitejs/plugin-react'))
const web = new URL('../web/', import.meta.url).pathname
const fixture = `import React from 'react';import{createRoot}from'react-dom/client';import{Interviews}from'/src/Interviews.tsx';
window.calls=[];window.available=true;window.fail=false;window.props={scope:{organization_id:'org',brand_id:'brand'},applicationId:'app',manage:false};
window.row={id:'i',version:1,scheduled_at:1800000000000,duration_minutes:30,format:'video',location:'Room',status:'scheduled',reviewer_id:'reviewer'};
window.packet={candidate_name:'Synthetic candidate',requisition_title:'Engineer',stage:'shortlisted',...window.row};
const root=createRoot(document.getElementById('root'));window.show=(patch={})=>{Object.assign(window.props,patch);root.render(React.createElement(Interviews,window.props))};window.show();`
test('interview UI schedules persisted actions and refresh removes revoked reviewer packets',async()=>{
 const cacheDir=mkdtempSync(join(tmpdir(),'hiring-interview-vite-'))
 const live=await createServer({root:web,cacheDir,configFile:false,optimizeDeps:{entries:[]},plugins:[react(),{
 name:'interview-fixture',enforce:'pre',
 resolveId(id){if(id==='/interview-fixture.jsx')return '\0interview-fixture.jsx'},
 load(id){
  if(id==='\0interview-fixture.jsx')return fixture
  if(id===web+'src/api.ts')return `export const app={auth:{user:{id:'reviewer'}}};export const read=async()=>[];export const id=()=>crypto.randomUUID();export const interviewScope=(s,a)=>({tenant_id:s.organization_id,brand_id:s.brand_id,application_id:a});export const listApplicationInterviews=async()=>{if(window.fail)throw Error('fixture');return window.available?[window.row]:[]};export const readInterviewPacket=async()=>window.available?window.packet:null;export const write=async(name,params)=>{window.calls.push({name,params})};export const interviewActions={create:'create_interview',schedule:'update_interview_schedule',assign:'assign_interviewer',revoke:'revoke_interviewer'};`
 },
 configureServer(s){s.middlewares.use(async(req,res,next)=>{if(req.url==='/interview-test'){res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml('/interview-test','<html><body><div id="root"></div><script type="module" src="/interview-fixture.jsx"></script></body></html>'))}else next()})}
 }],server:{host:'127.0.0.1',port:0}})
 await live.listen();let browser
 try{
  browser=await chromium.launch();const page=await browser.newPage()
  await page.goto(live.resolvedUrls.local[0]+'interview-test')
  await expect(page.getByText('Synthetic candidate · Engineer')).toBeVisible()
  await expect(page.getByText('shortlisted · scheduled')).toBeVisible()
  await expect(page.getByRole('textbox')).toHaveCount(0)
  await page.evaluate(()=>{window.available=false;window.dispatchEvent(new Event('focus'))})
  await expect(page.getByText('Synthetic candidate · Engineer')).toHaveCount(0)
  await expect(page.getByText('No interviews available.')).toBeVisible()
  await page.evaluate(()=>{window.available=true;window.show({manage:true})})
  await page.getByRole('button',{name:'Refresh interviews'}).click()
  await expect(page.getByText('Interviewer: reviewer · version 1')).toBeVisible()
  const schedule=page.locator('article form').first()
  await schedule.locator('[name="location"]').fill('Updated room')
  await schedule.getByRole('button').click()
  const mutation=await page.evaluate(()=>window.calls[0])
  assert.equal(mutation.name,'update_interview_schedule')
  assert.equal(mutation.params.tenant_id,'org');assert.equal(mutation.params.expected_version,1)
  assert.equal(mutation.params.location,'Updated room');assert.ok(mutation.params.operation_id)
  await page.evaluate(()=>{window.fail=true})
  await page.getByRole('button',{name:'Refresh interviews'}).click()
  await expect(page.getByRole('alert')).toContainText('Could not load interviews')
  await expect(page.getByText('Synthetic candidate · Engineer')).toHaveCount(0)
 }finally{await browser?.close();await live.close();rmSync(cacheDir,{recursive:true,force:true})}
})
