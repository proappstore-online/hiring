import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { chromium, expect } from '@playwright/test'
const require=createRequire(new URL('../web/package.json',import.meta.url))
const {createServer}=await import(require.resolve('vite'))
const {default:react}=await import(require.resolve('@vitejs/plugin-react'))
const ts=require('typescript')
const transpile=s=>ts.transpile(s,{jsx:ts.JsxEmit.React,module:ts.ModuleKind.ESNext})
const web=new URL('../web/',import.meta.url).pathname
const fixture=`import React from 'react';import {createRoot} from 'react-dom/client';import {CandidateDuplicates} from '/src/CandidateDuplicates.tsx';
window.calls=[];window.mergeHistory=[];window.owner=true;window.reject=false;
window.read=async(name,p)=>{window.calls.push({name,p});return name==='list_candidate_merges'?window.mergeHistory:window.mergeHistory.length?[]:[{id:'b',name:'Duplicate',email:'same@example.com',phone:'123',linkedin_url:''}]};
window.write=async(name,p)=>{window.calls.push({name,p});if(!window.reject)window.mergeHistory=[{...p,field_sources_json:JSON.stringify({name:p.name_source,email:p.email_source,phone:p.phone_source,linkedin_url:p.linkedin_url_source}),name:'Current',email:'same@example.com'}];throw Error('Lost response')};
const root=createRoot(document.getElementById('root'));window.render=()=>root.render(<CandidateDuplicates key={String(window.owner)} scope={{organization_id:'org',brand_id:'brand'}} application={{id:'app',candidate_id:'a',candidate_name:'Current',email:'same@example.com'}} owner={window.owner}/>);window.render();`
test('duplicate review requires explicit confirmation; uncertain response reads provenance',async()=>{
 const cacheDir=mkdtempSync(join(tmpdir(),'hiring-duplicate-vite-'))
 const server=await createServer({root:web,configFile:false,cacheDir,optimizeDeps:{entries:[],include:['react','react-dom/client']},plugins:[react(),{
  name:'duplicate-fixture',enforce:'pre',resolveId(id){if(id==='/fixture.jsx')return '\0duplicate-fixture.jsx';if(id==='@proappstore/sdk')return '\0duplicate-sdk'},
  load(id){if(id==='\0duplicate-fixture.jsx')return transpile(fixture);if(id==='\0duplicate-sdk')return 'export const initPro=()=>({auth:{user:{id:"owner"}}})';if(id===web+'src/api.ts')return readFileSync(id,'utf8').replace(/export const read = async[^\n]+/,'export const read = (...args) => window.read(...args)').replace(/export const write = async[\s\S]*?\n}/,'export const write = (...args) => window.write(...args)')},
  configureServer(s){s.middlewares.use(async(req,res,next)=>{if(req.headers.accept?.includes('text/html')){res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(req.url,'<div id="root"></div><script type="module" src="/fixture.jsx"></script>'))}else next()})}
 }],server:{host:'127.0.0.1',port:0}})
 let browser
 try {
  await server.listen();browser=await chromium.launch();const page=await browser.newPage();await page.goto(server.resolvedUrls.local[0])
  await page.getByRole('button',{name:'Check duplicates and merge history'}).click()
  await page.getByRole('button',{name:'Review merge',exact:true}).click()
  await expect(page.getByRole('button',{name:'Confirm merge choices'})).toBeDisabled()
  await page.getByLabel('Merge reason').fill('Reviewed profiles')
  await page.getByRole('combobox',{name:'name',exact:true}).selectOption('b')
  await page.getByRole('button',{name:'Confirm merge choices'}).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  assert.equal(await page.evaluate(()=>window.calls.some(c=>c.name==='merge_candidates')),false)
  await page.getByRole('button',{name:'Cancel',exact:true}).click()
  await page.evaluate(()=>{window.reject=true})
  await page.getByRole('button',{name:'Confirm merge choices'}).click();await page.getByRole('button',{name:'Merge candidates',exact:true}).click()
  await expect(page.getByRole('status')).toContainText('Merge was not confirmed')
  await expect(page.getByText(/Canonical profile/)).toHaveCount(0)
  await page.evaluate(()=>window.reject=false)
  await page.getByRole('button',{name:'Confirm merge choices'}).click();await page.getByRole('button',{name:'Merge candidates',exact:true}).click()
  await expect(page.getByRole('status')).toContainText('Candidates merged')
  const calls=await page.evaluate(()=>window.calls);const change=calls.find(c=>c.name==='merge_candidates');assert.equal(change.p.name_source,'b');assert.equal(change.p.email_source,'a');assert.equal(change.p.source_id,'b');assert.equal(change.p.target_id,'a');assert.equal(change.p.brand_id,'brand');assert.equal(calls.some(c=>c.name==='passkey'),false)
  await page.evaluate(()=>{window.owner=false;window.render()})
  await page.getByRole('button',{name:'Check duplicates and merge history'}).click()
  await expect(page.getByRole('button',{name:'Review merge',exact:true})).toHaveCount(0)
  await expect(page.getByText(/Canonical profile/)).toHaveCount(0)
 } finally {await browser?.close();await server.close();rmSync(cacheDir,{recursive:true,force:true})}
})
