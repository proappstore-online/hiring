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
const fixture=`import React from 'react';import{createRoot}from'react-dom/client';import{CurrentPipeline}from'/src/CurrentPipeline.tsx';import{MemoryRouter}from'react-router-dom';
window.calls=[];window.rows=[{stage:'submitted',count:101}];window.fail=false;window.brand='a';window.role='recruiter';
window.read=async(name,p)=>{window.calls.push({name,p});if(window.defer)return new Promise(resolve=>window.finish=resolve);if(window.fail)throw Error('Unavailable');return window.rows};
const root=createRoot(document.getElementById('root'));window.render=()=>root.render(<MemoryRouter><CurrentPipeline role={window.role} scope={{organization_id:'org',brand_id:window.brand}}/></MemoryRouter>);window.render();`
test('current pipeline scoped links, keyboard/mobile, counts, empty and retry states',async()=>{
 const cacheDir=mkdtempSync(join(tmpdir(),'hiring-pool-'))
 const server=await createServer({root:web,cacheDir,configFile:false,plugins:[react(),{
  name:'pool-fixture',enforce:'pre',resolveId(id){if(id==='/fixture.jsx')return'\0pool-fixture.jsx'},
  load(id){if(id==='\0pool-fixture.jsx')return ts.transpile(fixture,{jsx:ts.JsxEmit.React,module:ts.ModuleKind.ESNext});if(id===web+'src/api.ts')return'export const stageLabel=s=>s;export const read=(...args)=>window.read(...args);export const write=(...args)=>window.write(...args);export const id=()=>crypto.randomUUID();'},
  configureServer(s){s.middlewares.use(async(req,res,next)=>{if(req.headers.accept?.includes('text/html')){res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(req.url,'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/fixture.jsx"></script></body></html>'))}else next()})}
 }],server:{host:'127.0.0.1',port:0}})
 let browser
 try{
  await server.listen();browser=await chromium.launch();const page=await browser.newPage()
  await page.setViewportSize({width:375,height:812})
  await page.goto(server.resolvedUrls.local[0])
  const link=page.getByRole('link',{name:'submitted: 101',exact:true})
  await expect(link).toHaveAttribute('href','/recruiter/applications?organization_id=org&brand_id=a&stage=submitted')
  await link.focus();await expect(link).toBeFocused()
  await page.evaluate(()=>window.fail=true);await page.getByRole('button',{name:'Refresh pipeline'}).click()
  await expect(page.getByRole('alert')).toContainText('Could not load');await expect(page.getByRole('link')).toHaveCount(0)
  await page.evaluate(()=>{window.fail=false;window.brand='a';window.role='recruiter';window.rows=[]});await page.getByRole('button',{name:'Retry'}).click()
  await expect(page.getByText('No applications in your authorized scope.')).toBeVisible()
  await page.evaluate(()=>window.rows=[{stage:'in_review',count:2}]);await page.getByRole('button',{name:'Refresh pipeline'}).click()
  await expect(page.getByRole('link',{name:'in_review: 2',exact:true})).toBeVisible()
  await page.evaluate(()=>{window.defer=true;window.brand='b';window.render()})
  await expect(page.getByRole('status')).toContainText('Loading current pipeline')
  await page.waitForFunction(()=>typeof window.finish==='function')
  await page.evaluate(()=>{window.oldFinish=window.finish;window.defer=false;window.brand='c';window.rows=[{stage:'offered',count:3}];window.render()})
  await expect(page.getByRole('link',{name:'offered: 3',exact:true})).toHaveAttribute('href','/recruiter/applications?organization_id=org&brand_id=c&stage=offered')
  await page.evaluate(()=>window.oldFinish([{stage:'submitted',count:999}]))
  await expect(page.getByRole('link',{name:'submitted: 0',exact:true})).toBeVisible()
  const before=await page.evaluate(()=>window.calls.length)
  await page.evaluate(()=>{window.role='auditor';window.render()})
  await expect(page.getByRole('region',{name:'Current pipeline'})).toHaveCount(0)
  assert.equal(await page.evaluate(()=>window.calls.length),before)
  const calls=await page.evaluate(()=>window.calls)
  assert.ok(calls.every(c=>c.name==='get_current_pipeline'&&c.p.organization_id==='org'&&['a','b','c'].includes(c.p.brand_id)))
 }finally{await browser?.close();await server.close();rmSync(cacheDir,{recursive:true,force:true})}
})
