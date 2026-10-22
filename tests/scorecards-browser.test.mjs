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

test('scorecard browser persists drafts and submission, renders history and clears on access failure',async()=>{
 const cacheDir=mkdtempSync(join(tmpdir(),'hiring-scorecard-vite-'))
 const live=await createServer({root:web,cacheDir,configFile:false,optimizeDeps:{entries:[]},plugins:[react(),{
 name:'scorecard-fixture',enforce:'pre',
 resolveId(id){if(id==='/scorecard-fixture.jsx')return '\0scorecard-fixture.jsx'},
 load(id){
 if(id==='\0scorecard-fixture.jsx')return `import React from 'react';import{createRoot}from'react-dom/client';import{Scorecard}from'/src/Scorecard.tsx';window.calls=[];window.rows=[];window.fail=false;createRoot(document.getElementById('root')).render(React.createElement(Scorecard,{scope:{organization_id:'org',brand_id:'brand'},applicationId:'app',interviewId:'interview',assignmentId:'assignment'}));`
 if(id===web+'src/api.ts')return `export const id=()=>crypto.randomUUID();export const interviewScope=(s,a)=>({tenant_id:s.organization_id,brand_id:s.brand_id,application_id:a});export const read=async()=>{if(window.fail)throw Error('denied');return window.rows};export const write=async(name,p)=>{window.calls.push({name,params:p});window.rows.unshift({assignment_id:p.assignment_id,version:p.expected_version+1,status:p.status,criteria_json:p.criteria_json,created_at:1800000000000,submitted_at:p.status==='submitted'?1800000000000:null})};`
 },
 configureServer(s){s.middlewares.use(async(req,res,next)=>{if(req.url==='/scorecard-test'){res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml('/scorecard-test','<html><body><div id="root"></div><script type="module" src="/scorecard-fixture.jsx"></script></body></html>'))}else next()})}
 }],server:{host:'127.0.0.1',port:0}})
 await live.listen();let browser
 try{
 browser=await chromium.launch();const page=await browser.newPage({viewport:{width:375,height:812}})
 await page.goto(live.resolvedUrls.local[0]+'scorecard-test')
 await page.getByLabel('Criterion 1',{exact:true}).fill('Reasoning')
 await page.getByLabel('Rating 1',{exact:true}).selectOption('4')
 await page.getByLabel('Evidence 1',{exact:true}).fill('Explained a tradeoff')
 await page.getByRole('button',{name:'Save draft',exact:true}).click()
 await expect(page.getByRole('button',{name:'Submit scorecard',exact:true})).toBeEnabled()
 await page.getByText('Version history (1)',{exact:true}).click()
 await expect(page.getByText('Reasoning: 4/5 · Explained a tradeoff',{exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Submit scorecard',exact:true}).click()
 await expect(page.getByRole('button',{name:'Save draft',exact:true})).toBeDisabled()
 await page.getByText('Version history (2)',{exact:true}).click()
 await expect(page.getByText(/Version 2 · submitted · Saved/)).toBeVisible()
 const calls=await page.evaluate(()=>window.calls)
 assert.equal(calls[0].name,'save_own_scorecard');assert.equal(calls[0].params.assignment_id,'assignment');assert.equal(calls[1].params.expected_version,1);assert.equal(calls[1].params.status,'submitted');assert.notEqual(calls[0].params.operation_id,calls[1].params.operation_id)
 await page.evaluate(()=>{window.fail=true;window.dispatchEvent(new Event('focus'))})
 await expect(page.getByRole('alert')).toContainText('Could not load scorecard')
 await expect(page.getByText('Reasoning: 4/5 · Explained a tradeoff',{exact:true})).toHaveCount(0)
 }finally{await browser?.close();await live.close();rmSync(cacheDir,{recursive:true,force:true})}
})
