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
const fixture=`import React from 'react';import{createRoot}from'react-dom/client';import{FunnelAnalytics}from'/src/FunnelAnalytics.tsx';
window.calls=[];window.rows=[{milestone:'received',count:null,suppressed:1}];window.fail=false;
window.read=async(name,p)=>{window.calls.push({name,p});if(window.fail)throw Error('Unavailable');return window.rows};
createRoot(document.getElementById('root')).render(<FunnelAnalytics scope={{organization_id:'org',brand_id:'a'}}/>);`
test('analytics display suppression, exact counts, denial, and retry without stale numbers',async()=>{
 const cacheDir=mkdtempSync(join(tmpdir(),'hiring-pool-'))
 const server=await createServer({root:web,cacheDir,configFile:false,plugins:[react(),{
  name:'pool-fixture',enforce:'pre',resolveId(id){if(id==='/fixture.jsx')return'\0pool-fixture.jsx'},
  load(id){if(id==='\0pool-fixture.jsx')return ts.transpile(fixture,{jsx:ts.JsxEmit.React,module:ts.ModuleKind.ESNext});if(id===web+'src/api.ts')return'export const read=(...args)=>window.read(...args);export const write=(...args)=>window.write(...args);export const id=()=>crypto.randomUUID();'},
  configureServer(s){s.middlewares.use(async(req,res,next)=>{if(req.headers.accept?.includes('text/html')){res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(req.url,'<html><body><div id="root"></div><script type="module" src="/fixture.jsx"></script></body></html>'))}else next()})}
 }],server:{host:'127.0.0.1',port:0}})
 let browser
 try{
  await server.listen();browser=await chromium.launch();const page=await browser.newPage()
  await page.goto(server.resolvedUrls.local[0]);await expect(page.getByText('Counts suppressed to protect groups of fewer than five candidates.')).toBeVisible()
  await expect(page.locator('dd')).toHaveCount(0)
  await page.evaluate(()=>window.rows=[{milestone:'received',count:10,suppressed:0}]);await page.getByRole('button',{name:'Refresh analytics'}).click()
  await expect(page.locator('dd')).toHaveText('10')
  await page.evaluate(()=>window.fail=true);await page.getByRole('button',{name:'Refresh analytics'}).click()
  await expect(page.getByRole('alert')).toBeVisible();await expect(page.locator('dd')).toHaveCount(0)
  await page.evaluate(()=>{window.fail=false;window.rows=[]});await page.getByRole('button',{name:'Refresh analytics'}).click()
  await expect(page.getByText('Full brand access is required.')).toBeVisible()
  const calls=await page.evaluate(()=>window.calls)
  assert.ok(calls.every(c=>c.name==='get_funnel_analytics'&&c.p.organization_id==='org'&&c.p.brand_id==='a'))
 }finally{await browser?.close();await server.close();rmSync(cacheDir,{recursive:true,force:true})}
})
