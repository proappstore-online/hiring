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
const fixture=`import React from 'react';import{createRoot}from'react-dom/client';import{TalentPool}from'/src/TalentPool.tsx';
window.calls=[];window.active=true;window.fail=false;
window.read=async(name,p)=>{window.calls.push({name,p});if(window.fail)throw Error('Unavailable');return window.active?[{id:'person',name:'Person',email:'person@example.test',expires_at:1800000000000}]:[]};
window.write=async(name,p)=>{window.calls.push({name,p});window.active=false;throw Error('Lost acknowledgement')};
createRoot(document.getElementById('root')).render(<TalentPool scope={{organization_id:'org',brand_id:'a'}} applicationId='app-a'/>);`
test('candidate sees pool expiry, reconciles lost withdrawal response, and handles read failure without claiming absence',async()=>{
 const cacheDir=mkdtempSync(join(tmpdir(),'hiring-pool-'))
 const server=await createServer({root:web,cacheDir,configFile:false,plugins:[react(),{
  name:'pool-fixture',enforce:'pre',resolveId(id){if(id==='/fixture.jsx')return'\0pool-fixture.jsx'},
  load(id){if(id==='\0pool-fixture.jsx')return ts.transpile(fixture,{jsx:ts.JsxEmit.React,module:ts.ModuleKind.ESNext});if(id===web+'src/api.ts')return'export const read=(...args)=>window.read(...args);export const write=(...args)=>window.write(...args);export const id=()=>crypto.randomUUID();'},
  configureServer(s){s.middlewares.use(async(req,res,next)=>{if(req.headers.accept?.includes('text/html')){res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(req.url,'<html><body><div id="root"></div><script type="module" src="/fixture.jsx"></script></body></html>'))}else next()})}
 }],server:{host:'127.0.0.1',port:0}})
 let browser
 try{
  await server.listen();browser=await chromium.launch();const page=await browser.newPage()
  await page.goto(server.resolvedUrls.local[0]);await expect(page.getByText(/^Expires /)).toBeVisible()
  await page.getByRole('button',{name:'Withdraw talent-pool consent for this brand',exact:true}).click()
  await expect(page.getByText('No active participation.')).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  const calls=await page.evaluate(()=>window.calls);const mutation=calls.find(c=>c.name==='withdraw_my_talent_pool')
  assert.equal(mutation.p.brand_id,'a');assert.equal(mutation.p.application_id,'app-a');assert.ok(mutation.p.operation_id)
  assert.equal(calls.at(-1).name,'get_my_talent_pool')
  await page.evaluate(()=>window.fail=true);await page.getByRole('button',{name:'Refresh talent pool'}).click()
  await expect(page.getByRole('alert')).toBeVisible();await expect(page.getByText('No active participation.')).toHaveCount(0)
 }finally{await browser?.close();await server.close();rmSync(cacheDir,{recursive:true,force:true})}
})
