import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
const fixture = `import React from 'react';import {createRoot} from 'react-dom/client';import App from '/src/App.tsx';import {RouteBoundary} from '/src/route-ui.tsx';import '/src/index.css';
window.role='recruiter';window.auth={user:null,loading:false};window.calls=[];window.fail=false;window.gate='closed';window.pending=[];
const job={requisition_id:'job',organization_id:'org',brand_id:'brand',title:'Engineer',brand_name:'Brand',organization_name:'Org',location:'Remote',notice_text:'Notice',notice_version:'v1',description:'Job description'};
window.read=async(name,p)=>{window.calls.push({name,p});if(window.fail)throw Error('synthetic');if(window.hold)return new Promise(resolve=>window.pending.push({name,p,resolve}));if(name==='list_public_jobs')return [job];if(name==='get_public_job')return p.organization_id==='org'&&p.brand_id==='brand'&&p.requisition_id==='job'?[job]:[];if(name==='get_hiring_runtime_gate')return [{intake_status:window.gate}];if(name==='list_my_workspaces')return [{organization_id:'org',brand_id:'brand',organization_name:'Org',brand_name:'Brand',role:window.role},{organization_id:'other',brand_id:'other',organization_name:'Other',brand_name:'Other',role:'recruiter'}];if(name==='gateway_get_application')return p.application_id==='old'?[{id:'old',candidate_name:'Restricted candidate',requisition_title:'Engineer',stage:'submitted'}]:[];return []};
const root=createRoot(document.getElementById('root'));window.render=()=>root.render(<App/>);function Crash(){throw Error('synthetic render error')}window.crash=()=>root.render(<RouteBoundary><Crash/></RouteBoundary>);window.render();`

test('routing renders real public/protected pages and preserves URL scope', async t => {
 const cacheDir=mkdtempSync(join(tmpdir(),'hiring-routing-vite-'))
 const server = await createServer({root:web,cacheDir,configFile:false,plugins:[react(),tailwind(),{
  name:'route-fixture.jsx',enforce:'pre',
  resolveId(id){if(id==='@proappstore/sdk')return '\0route-sdk.jsx';if(id==='/fixture.jsx')return '\0route-fixture.jsx'},
  load(id){if(id==='\0route-sdk.jsx')return transpile(sdk);if(id==='\0route-fixture.jsx')return transpile(fixture);if(id===web+'src/api.ts'){return readFileSync(id,'utf8').replace(/export const read = async[^\n]+/, 'export const read = (...args) => window.read(...args)').replace(/export const readPublic = async[^\n]+/,'export const readPublic = (...args) => window.read(...args)')}},
  configureServer(s){s.middlewares.use(async(req,res,next)=>{if(req.headers.accept?.includes('text/html')){res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(req.url,'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/fixture.jsx"></script></body></html>'))}else next()})}
 }],server:{host:'127.0.0.1',port:0}})
 await server.listen();let browser
 try {
  browser=await chromium.launch();const page=await browser.newPage({viewport:{width:375,height:812}});page.setDefaultTimeout(10000);const base=server.resolvedUrls.local[0].replace(/\/$/,'')
  const go=path=>page.goto(base+path)
  await t.test('home/list/detail, links, refresh, back and keyboard',async()=>{
   await go('/');await expect(page.getByRole('heading',{name:'Jobs',exact:true})).toBeVisible();await expect(page.getByRole('navigation',{name:'Public navigation'})).toBeVisible();await expect(page.getByTestId('staff-shell')).toHaveCount(0)
   await go('/jobs');const link=page.getByRole('link',{name:'Engineer · Brand · Remote'});await link.focus();await page.keyboard.press('Enter');await expect(page).toHaveURL(/\/jobs\/job\?organization_id=org&brand_id=brand/);await expect(page.getByRole('heading',{name:'Engineer',exact:true})).toBeVisible();await expect(page.locator('#route-content')).toBeFocused();await page.reload();await expect(page.getByText('Job description')).toBeVisible();await page.goBack();await expect(page.getByRole('heading',{name:'Jobs',exact:true})).toBeVisible()
  })
  await t.test('public detail and apply preserve closed intake and mixed-scope denial',async()=>{
   await go('/apply/job?organization_id=org&brand_id=brand');await expect(page.getByText('Applications are not open yet. Please check back later.')).toBeVisible();await expect(page.getByLabel('Your name')).toHaveCount(0)
   await go('/jobs/job?organization_id=other&brand_id=brand');await expect(page.getByRole('heading',{name:'404 — Not found'})).toBeVisible();await expect(page.getByText('Job description')).toHaveCount(0)
  })
  await t.test('bare job links resolve approved scope without query routing',async()=>{
   await go('/jobs/job');await expect(page.getByRole('heading',{name:'Engineer',exact:true})).toBeVisible();await expect(page).toHaveURL(/\/jobs\/job$/)
   const calls=await page.evaluate(()=>window.calls);assert.ok(calls.some(c=>c.name==='get_public_job'&&c.p.organization_id==='org'&&c.p.brand_id==='brand'))
  })
  await t.test('public discovery survives auth hydration; protected pages wait',async()=>{
   await go('/missing');await page.evaluate(()=>{window.auth={user:null,loading:true}});await page.getByRole('link',{name:'Browse jobs'}).click();await expect(page.getByRole('heading',{name:'Jobs',exact:true})).toBeVisible();await page.getByRole('link',{name:'Recruiter workspace'}).click();await expect(page.getByRole('status')).toHaveText('Loading…');await expect(page.getByTestId('staff-shell')).toHaveCount(0)
  })
  await t.test('protected routes redirect with destination and no private reads',async()=>{
   for(const route of ['/admin','/admin/communications','/admin/operations','/admin/compliance','/admin/settings','/dashboard','/applications','/applications/old?organization_id=org&brand_id=brand']){await go(route);await expect(page).toHaveURL(/\/sign-in\?returnTo=/);await expect(page.getByRole('heading',{name:'Sign in to Hiring'})).toBeVisible();assert.equal(await page.evaluate(()=>window.calls.length),0);await expect(page.getByTestId('staff-shell')).toHaveCount(0)}
  })
  await t.test('unknown route, asynchronous loading, retry and empty states',async()=>{
   await go('/missing');await expect(page.getByRole('heading',{name:'404 — Not found'})).toBeVisible();await page.evaluate(()=>{window.hold=true});await page.getByRole('link',{name:'Browse jobs'}).click();await expect(page.getByRole('status')).toHaveText('Loading jobs…');await expect(page.getByText('No published jobs are available.')).toHaveCount(0);await page.evaluate(()=>window.pending.shift().resolve([]));await expect(page.getByText('No published jobs are available.')).toBeVisible();await page.evaluate(()=>{window.hold=false;window.fail=true});await page.getByRole('button',{name:'Refresh jobs'}).click();await expect(page.getByRole('alert')).toContainText('Jobs could not be loaded');await page.evaluate(()=>window.fail=false);await page.getByRole('button',{name:'Retry',exact:true}).click();await expect(page.getByRole('link',{name:'Engineer · Brand · Remote'})).toBeVisible()
  })
  await t.test('signed-in exact lookup, refresh, missing scope and brand switch',async()=>{
   await go('/sign-in?returnTo=%2Fapplications%2Fold%3Forganization_id%3Dorg%26brand_id%3Dbrand');await page.evaluate(()=>{window.auth={user:{id:'staff'},loading:false};window.render()});await expect(page.getByTestId('staff-shell')).toBeVisible();await expect(page.getByRole('heading',{name:'Restricted candidate'})).toBeVisible();const calls=await page.evaluate(()=>window.calls);assert.ok(calls.some(c=>c.name==='gateway_get_application'&&c.p.organization_id==='org'&&c.p.brand_id==='brand'&&c.p.application_id==='old'))
   await page.getByRole('combobox',{name:'Workspace',exact:true}).selectOption('other');await expect(page).toHaveURL(/\/applications\?brand_id=other&organization_id=other/);await expect(page.getByText('Restricted candidate')).toHaveCount(0);await expect(page.getByText('No applications yet.')).toBeVisible()
  })
  await t.test('admin direct routes survive sign-in and deny unauthorized roles',async()=>{
   for(const [route,heading]of [['/admin/operations','Operations'],['/admin/compliance','Compliance'],['/admin/communications','Communications — Brand'],['/admin/settings','Workspace setup'],['/admin','Recruiter workspace']]){
    await go('/sign-in?returnTo='+encodeURIComponent(route+'?organization_id=org&brand_id=brand'));await page.evaluate(()=>{window.role='owner';window.auth={user:{id:'owner'},loading:false};window.render()});await expect(page.getByRole('heading',{name:heading,exact:true})).toBeVisible();await expect(page).toHaveURL(new RegExp(route+'\\?'))
   }
   for(const route of ['/admin/settings','/admin/compliance','/admin/operations','/admin/communications']){
    await go('/sign-in?returnTo='+encodeURIComponent(route+'?organization_id=org&brand_id=brand'));await page.evaluate(()=>{window.role='reviewer';window.auth={user:{id:'reviewer'},loading:false};window.render()});await expect(page.getByRole('heading',{name:'Access denied',exact:true})).toBeVisible();assert.equal(await page.evaluate(()=>window.calls.filter(c=>['get_admin_settings','list_operational_diagnostics','list_communication_templates'].includes(c.name)).length),0)
   }
  })
  await t.test('render error is contained with recovery',async()=>{await page.evaluate(()=>window.crash());await expect(page.getByRole('alert')).toContainText('Something went wrong');await expect(page.getByRole('button',{name:'Retry'})).toBeVisible()})
 } finally {await browser?.close();await server.close();rmSync(cacheDir,{recursive:true,force:true})}
})
test('routing has no legacy view branch and SPA fallback excludes platform paths',()=>{
 for(const name of ['App.tsx','Jobs.tsx'])assert.doesNotMatch(readFileSync(web+'src/'+name,'utf8'), /view=|get\(['"]view['"]\)/)
 const vite=readFileSync(web+'vite.config.ts','utf8');assert.match(vite,/appType: 'spa'/);assert.match(vite,/navigateFallback: '\/index.html'/);assert.match(vite,/navigateFallbackDenylist/)
})
