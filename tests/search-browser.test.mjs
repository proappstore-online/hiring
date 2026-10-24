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
const fixture=`import React from 'react';import{createRoot}from'react-dom/client';import{BrowserRouter}from'react-router-dom';import{WorkspaceSearch}from'/src/WorkspaceSearch.tsx';
window.calls=[];window.denied=false;window.hold=false;window.pending=[];
window.action=async(name,params)=>{window.calls.push({name,params});if(window.hold)await new Promise(resolve=>window.pending.push(resolve));const rows=name.startsWith('get_')?(window.denied?[]:[{id:params.id,full_name:'Private Person',created_at:1}]):[{id:params.cursor?'second':'first',full_name:params.cursor?'Second Person':'Private Person',created_at:1,next_cursor:params.cursor?null:'opaque-token'}];return{results:[{rows:[{status:window.limited?429:200,rows_json:JSON.stringify(window.limited?[]:rows)}]}]}};
createRoot(document.getElementById('root')).render(<BrowserRouter><WorkspaceSearch scope={{organization_id:'org',brand_id:'brand'}}/></BrowserRouter>);`
test('workspace search submits privately, paginates, rechecks exact access, rejects stale responses and displays rate denial',async()=>{
 const cacheDir=mkdtempSync(join(tmpdir(),'hiring-search-'))
 const server=await createServer({root:web,cacheDir,configFile:false,plugins:[react(),{
  name:'search-fixture',enforce:'pre',resolveId(id){if(id==='/fixture.jsx')return'\0search-fixture.jsx'},
  load(id){if(id==='\0search-fixture.jsx')return ts.transpile(fixture,{jsx:ts.JsxEmit.React,module:ts.ModuleKind.ESNext});if(id===web+'src/Interviews.tsx')return 'export const Interviews=()=>null;';if(id===web+'src/api.ts')return'export const app={actions:{call:(...args)=>window.action(...args)}};'},
  configureServer(s){s.middlewares.use(async(req,res,next)=>{if(req.headers.accept?.includes('text/html')){res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(req.url,'<html><body><div id="root"></div><script type="module" src="/fixture.jsx"></script></body></html>'))}else next()})}
 }],server:{host:'127.0.0.1',port:0}})
 let browser
 try{
  await server.listen();browser=await chromium.launch();const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message))
  await page.goto(server.resolvedUrls.local[0]+'recruiter/applications?organization_id=org&brand_id=brand')
  await page.getByLabel('Record type').selectOption('candidates')
  await page.getByRole('searchbox').fill('Private Person');assert.equal((await page.evaluate(()=>window.calls)).length,0)
  await page.getByRole('button',{name:'Search records',exact:true}).click()
  await expect(page.getByRole('button',{name:'Private Person',exact:true})).toBeVisible()
  assert.ok(!page.url().includes('Private'));assert.equal(await page.evaluate(()=>localStorage.length),0)
  await page.getByRole('button',{name:'Next search page'}).click()
  await expect(page.getByRole('button',{name:'Second Person',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Next search page'})).toHaveCount(0)
  assert.equal((await page.evaluate(()=>window.calls)).at(-1).params.cursor,'opaque-token')
  await page.getByRole('button',{name:'Second Person',exact:true}).click();await expect(page.getByText(/Record access checked/)).toBeVisible()
  await page.evaluate(()=>window.denied=true);await page.getByRole('button',{name:'Second Person',exact:true}).click();await expect(page.getByRole('alert')).toHaveText('Record unavailable.')
  await page.evaluate(()=>window.hold=true);await page.getByRole('button',{name:'Search records',exact:true}).click();await expect(page.getByText('Searching…',{exact:true})).toBeVisible()
  await page.getByRole('searchbox').fill('Changed');await page.evaluate(()=>{window.hold=false;window.pending.splice(0).forEach(resolve=>resolve())});await expect(page.getByRole('button',{name:'Private Person',exact:true})).toHaveCount(0)
  await page.evaluate(()=>window.limited=true);await page.getByRole('button',{name:'Search records',exact:true}).click();await expect(page.getByRole('alert')).toHaveText('Search limit reached. Try again shortly.')
  assert.deepEqual(errors,[])
 }finally{await browser?.close();await server.close();rmSync(cacheDir,{recursive:true,force:true})}
})
