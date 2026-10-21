import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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
const baseFixture = `import React from 'react';import {createRoot} from 'react-dom/client';import App from '/src/App.tsx';import {RouteBoundary} from '/src/route-ui.tsx';import '/src/index.css';
window.auth={user:null,loading:false};window.calls=[];window.fail=false;window.gate='closed';window.pending=[];
const job={requisition_id:'job',organization_id:'org',brand_id:'brand',title:'Engineer',brand_name:'Brand',organization_name:'Org',location:'Remote',notice_text:'Notice',notice_version:'v1',description:'Job description'};
window.read=async(name,p)=>{window.calls.push({name,p});if(window.fail)throw Error('synthetic');if(window.hold)return new Promise(resolve=>window.pending.push({name,p,resolve}));if(name==='list_public_jobs')return [job];if(name==='get_public_job')return p.organization_id==='org'&&p.brand_id==='brand'&&p.requisition_id==='job'?[job]:[];if(name==='get_hiring_runtime_gate')return [{intake_status:window.gate}];if(name==='list_my_workspaces')return [{organization_id:'org',brand_id:'brand',organization_name:'Org',brand_name:'Brand',role:'recruiter'},{organization_id:'other',brand_id:'other',organization_name:'Other',brand_name:'Other',role:'recruiter'}];if(name==='gateway_get_application')return p.application_id==='old'?[{id:'old',candidate_name:'Restricted candidate',requisition_title:'Engineer',stage:'submitted'}]:[];return []};
const root=createRoot(document.getElementById('root'));window.render=()=>root.render(<App/>);function Crash(){throw Error('synthetic render error')}window.crash=()=>root.render(<RouteBoundary><Crash/></RouteBoundary>);window.render();`


const fixture = baseFixture.replace("window.read=async(name,p)=>", `window.rows=[{id:'one',requisition_id:'req',candidate_name:'Private Alice',stage:'submitted',assignee_user_id:'staff',updated_at:200,requisition_title:'Engineer'},{id:'two',requisition_id:'req',candidate_name:'Private Bob',stage:'offered',assignee_user_id:'',updated_at:100,requisition_title:'Engineer'}];window.read=async(name,p)=>{if(window.hold)return new Promise(resolve=>window.pending.push({name,p,resolve}));if(window.fail)throw Error('synthetic');if(name==='list_applications'||name==='gateway_list_applications'){window.calls.push({name,p});return window.rows}if(name==='list_requisitions')return [{id:'req',title:'Engineer',status:'open'}];return window.originalRead(name,p)};window.originalRead=async(name,p)=>`)
test('recruiter dashboard and pipeline browser behavior', async t => {
 const server = await createServer({root:web,cacheDir:web+'node_modules/.vite-recruiter-tests',configFile:false,plugins:[react(),tailwind(),{
  name:'route-fixture.jsx',enforce:'pre',
  resolveId(id){if(id==='@proappstore/sdk')return '\0route-sdk.jsx';if(id==='/fixture.jsx')return '\0route-fixture.jsx'},
  load(id){if(id==='\0route-sdk.jsx')return transpile(sdk);if(id==='\0route-fixture.jsx')return transpile(fixture);if(id===web+'src/api.ts'){return readFileSync(id,'utf8').replace(/export const read = async[^\n]+/, 'export const read = (...args) => window.read(...args)').replace(/export const readPublic = async[^\n]+/,'export const readPublic = (...args) => window.read(...args)')}},
  configureServer(s){s.middlewares.use(async(req,res,next)=>{if(req.headers.accept?.includes('text/html')){res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(req.url,'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/fixture.jsx"></script></body></html>'))}else next()})}
 }],server:{host:'127.0.0.1',port:0}})

 await server.listen(); let browser
 try {
  browser=await chromium.launch(); const page=await browser.newPage({viewport:{width:375,height:812}});const base=server.resolvedUrls.local[0].replace(/\/$/,'')
  await t.test('loading, counts and privacy',async()=>{
   await page.goto(base+'/sign-in');await page.evaluate(()=>{window.hold=true;window.auth={user:{id:'staff'},loading:false};window.render()});await expect(page.getByRole('status')).toContainText('Loading workspace');await page.evaluate(()=>{window.hold=false;window.pending.splice(0).forEach(p=>p.resolve([{organization_id:'org',brand_id:'brand',organization_name:'Org',brand_name:'Brand',role:'owner'}]))});await expect(page.getByRole('heading',{name:'Recruiter dashboard'})).toBeVisible();const stats=page.getByRole('region',{name:'Application statistics'});await expect(stats.getByRole('link',{name:'Total applications 2'})).toBeVisible();await expect(stats.getByRole('link',{name:'submitted 1'})).toBeVisible();await expect(stats).not.toContainText('Private Alice');await expect(page.getByRole('link',{name:'Manage publication controls'})).toBeVisible()
  })
  await t.test('search, URL filters, grouping, direct links and clear',async()=>{
   await page.getByRole('link',{name:'Total applications 2'}).click();await expect(page.getByRole('heading',{name:'Application pipeline'})).toBeVisible();await page.getByRole('searchbox',{name:'Search candidates'}).fill('Alice');await expect(page.getByRole('link',{name:'Open Private Alice application'})).toBeVisible();await expect(page.getByRole('link',{name:'Open Private Bob application'})).toHaveCount(0);assert.ok(!page.url().includes('Alice'));await page.getByRole('combobox',{name:'Stage',exact:true}).selectOption('offered');await expect(page.getByText('No applications match these filters.')).toBeVisible();await page.getByRole('button',{name:'Clear filters'}).click();await page.getByRole('radio',{name:'assignee',exact:true}).check();await expect(page.getByRole('heading',{name:'Unassigned',exact:true})).toBeVisible();await page.getByRole('combobox',{name:'Requisition',exact:true}).selectOption('req');await expect(page.getByRole('status')).toContainText('2 matching');await page.getByRole('link',{name:'Open Private Alice application'}).click();await expect(page).toHaveURL(/applications\/one\?organization_id=org&brand_id=brand/)
  })
  await t.test('error retry and empty',async()=>{
   await page.evaluate(()=>{window.fail=true});await page.getByRole('navigation',{name:'Recruiter navigation'}).getByRole('link',{name:'Dashboard'}).click();await expect(page.getByRole('alert')).toBeVisible();await page.evaluate(()=>{window.fail=false;window.rows=[]});await page.getByRole('button',{name:'Retry loading workspaces'}).click();await expect(page.getByText('No applications yet.')).toBeVisible()
  })
  await t.test('reviewer uses gateway only',async()=>{
   await page.goto(base+'/sign-in');await page.evaluate(()=>{const original=window.originalRead;window.originalRead=async(name,p)=>name==='list_my_workspaces'?[{organization_id:'org',brand_id:'brand',organization_name:'Org',brand_name:'Brand',role:'reviewer'}]:original(name,p);window.auth={user:{id:'staff'},loading:false};window.render()});await expect(page.getByText('Assigned applications only.',{exact:false})).toBeVisible();await expect(page.getByRole('link',{name:'Manage publication controls'})).toHaveCount(0);const calls=await page.evaluate(()=>window.calls);assert.ok(calls.some(c=>c.name==='gateway_list_applications'));assert.ok(!calls.some(c=>c.name==='list_applications'))
  })
  await t.test('auditor has audit lookup without candidate pipeline',async()=>{
   await page.goto(base+'/sign-in');await page.evaluate(()=>{const original=window.originalRead;window.originalRead=async(name,p)=>name==='list_my_workspaces'?[{organization_id:'org',brand_id:'brand',organization_name:'Org',brand_name:'Brand',role:'auditor'}]:original(name,p);window.auth={user:{id:'staff'},loading:false};window.render()});await expect(page.getByRole('heading',{name:'Audit workspace',exact:true})).toBeVisible();await expect(page.getByRole('region',{name:'Application statistics'})).toHaveCount(0);await page.getByRole('textbox',{name:'Application reference'}).fill('one');await page.getByRole('button',{name:'Load authorized audit history'}).click();await expect(page.getByText('No audit history available to your account for this reference.')).toBeVisible();const calls=await page.evaluate(()=>window.calls);assert.ok(!calls.some(c=>['list_applications','gateway_list_applications'].includes(c.name)))
  })

 } finally {await browser?.close();await server.close()}
})
test('recruiter data guards stale scope and request results',()=>{
 const source=readFileSync(web+'src/recruiter-data.ts','utf8');assert.match(source,/seq === sequence.current/);assert.match(source,/data\?\.key === key/);assert.match(source,/sequence.current\+\+/);assert.match(source,/space.organization_id, space.brand_id, space.role/)
})
