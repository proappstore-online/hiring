import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
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
const sdk = `import React from 'react'; export const initPro=()=>({auth:{user:null}}); export const useAuth=()=>window.auth; export const ProShell=({children,nav,renderNav})=><div data-testid="staff-shell"><header>{nav?.length ? renderNav?.({items:nav,currentPath:location.pathname,onNavigate:()=>{}}) : null}</header>{children}</div>; export const PageHeader=({title})=><h1>{title}</h1>; export const SignInButton=({label})=><button>{label}</button>;`
const fixture = `import React from 'react';import {createRoot} from 'react-dom/client';import App from '/src/App.tsx';import '/src/index.css';
window.auth={user:null,loading:false};window.calls=[];window.gate='open';window.fail=false;window.empty=false;window.pdVersion=0;
const pd={overview:'Build reliable products',rolePurpose:'<script>window.pwned=true</script>',responsibilities:['Ship safely','Review changes'],requirements:['Engineering experience'],workingArrangement:'Remote',compensation:'AUD 100,000',benefits:'Annual leave',applicationProcess:'Apply online',privacyContact:'hiring@example.com'};
const job={requisition_id:'job',organization_id:'org',brand_id:'brand',title:'Engineer',brand_name:'Brand',organization_name:'Org',location:'Melbourne',notice_text:'Approved privacy notice',notice_version:'v1',description:'Legacy description',arrangement:'Remote',compensation:'Paid',contact:'Hiring team',version:1,pd_json:JSON.stringify(pd),status:'published',candidate_name:'PRIVATE_CANDIDATE',internal_notes:'PRIVATE_NOTES'};
window.read=async(name,p)=>{window.calls.push({name,p});if(window.fail)throw Error('synthetic');if(window.hold)return new Promise(resolve=>window.pending=resolve);if(name==='list_vacancies'||name==='list_public_jobs')return window.empty?[]:[job];if(name==='get_vacancy_detail'||name==='get_public_job')return p.requisition_id==='job'&&p.organization_id==='org'&&p.brand_id==='brand'?[{...job,pd_json:window.partial?'{}':job.pd_json}]:[];if(name==='get_hiring_runtime_gate')return [{intake_status:window.gate}];if(name==='list_my_workspaces')return [{organization_id:'org',brand_id:'brand',organization_name:'Org',brand_name:'Brand',role:'owner'}];if(name==='list_requisitions')return [{id:'job',title:'Engineer',status:'draft'}];if(name==='list_vacancy_management')return [{id:'job',title:'Engineer',state:'draft',updated_at:1000}];if(name==='get_pd_draft'||name==='preview_pd')return window.pdVersion?[{payload:JSON.stringify(pd),version:window.pdVersion,updated_at:1000}]:[];return []};
window.write=async(name,p)=>{window.calls.push({name,p});if(name==='save_pd_draft')window.pdVersion++;};
createRoot(document.getElementById('root')).render(<App/>);`

test('vacancies routes, PD rendering, discovery, share, gates and recruiter editing', async t => {
 const cacheDir = mkdtempSync(join(tmpdir(), 'hiring-vacancies-vite-'))
 const server = await createServer({root:web,configFile:false,cacheDir,optimizeDeps:{entries:[]},plugins:[react(),tailwind(),{
  name:'vacancy-fixture.jsx',enforce:'pre',
  resolveId(id){if(id==='@proappstore/sdk')return '\0vacancy-sdk.jsx';if(id==='/fixture.jsx')return '\0vacancy-fixture.jsx'},
  load(id){if(id==='\0vacancy-sdk.jsx')return transpile(sdk);if(id==='\0vacancy-fixture.jsx')return transpile(fixture);if(id===web+'src/api.ts'){return readFileSync(id,'utf8').replace(/export const read = async[^\n]+/, 'export const read = (...args) => window.read(...args)').replace(/export const readPublic = async[^\n]+/,'export const readPublic = (...args) => window.read(...args)').replace(/export const write = async[\s\S]*?\n}/,'export const write = (...args) => window.write(...args)')}},
  configureServer(s){s.middlewares.use(async(req,res,next)=>{if(req.headers.accept?.includes('text/html')){res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(req.url,'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/fixture.jsx"></script></body></html>'))}else next()})}
 }],server:{host:'127.0.0.1',port:0}})
 await server.listen(); let browser
 try {
  browser=await chromium.launch();const context=await browser.newContext({viewport:{width:375,height:812}});const page=await context.newPage();const base=server.resolvedUrls.local[0].replace(/\/$/,'');const go=path=>page.goto(base+path)
  await t.test('public index, search, arrangement filtering and mobile keyboard links',async()=>{
   await go('/vacancies');await expect(page.getByRole('heading',{name:'Vacancies',exact:true})).toBeVisible();await expect(page.getByRole('link',{name:'Engineer',exact:true})).toBeVisible()
   await page.getByRole('searchbox').fill('no match');await expect(page.getByText('No vacancies match these filters.')).toBeVisible();await page.getByRole('searchbox').fill('');await page.getByRole('searchbox').pressSequentially('reliable');await expect(page.getByRole('searchbox')).toBeFocused();await expect(page.getByRole('link',{name:'Engineer',exact:true})).toBeVisible()
   await page.getByRole('combobox',{name:'Working arrangement'}).selectOption('Remote');await page.getByRole('link',{name:'Engineer',exact:true}).focus();await page.keyboard.press('Enter');await expect(page).toHaveURL(/\/vacancies\/job\?organization_id=org&brand_id=brand/)
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  })
  await t.test('direct detail renders every PD section as text and copies canonical scope',async()=>{
   await go('/vacancies/job');await expect(page.getByRole('heading',{name:'Engineer',exact:true})).toBeVisible()
   for(const name of ['Overview','Role Purpose','Responsibilities','Requirements','Working Arrangement','Compensation','Benefits','Application Process','Privacy & Contact'])await expect(page.getByRole('heading',{name,exact:true})).toBeVisible()
   await expect(page.getByRole('listitem').filter({hasText:'Ship safely'})).toBeVisible()
   await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.copied=value}}}))
   await page.getByRole('button',{name:'Copy vacancy link'}).click();await expect(page.getByText('Link copied.')).toBeVisible();assert.equal(await page.evaluate(()=>window.copied),base+'/vacancies/job?organization_id=org&brand_id=brand')
   assert.doesNotMatch(await page.locator('main').innerText(),/PRIVATE_CANDIDATE|PRIVATE_NOTES/);assert.equal(await page.evaluate(()=>window.pwned),undefined);await expect(page.locator('main script')).toHaveCount(0)
  })
  await t.test('application link reuses exact scoped entry and rechecks publication and runtime gate',async()=>{
   await page.getByRole('link',{name:'Apply for this vacancy'}).click();await expect(page).toHaveURL(/\/apply\/job\?organization_id=org&brand_id=brand/);await expect(page.getByText('Sign in to apply with your own candidate account.')).toBeVisible()
   const calls=await page.evaluate(()=>window.calls);assert.ok(calls.some(c=>c.name==='get_public_job'&&c.p.organization_id==='org'&&c.p.brand_id==='brand'));assert.ok(calls.filter(c=>c.name==='get_hiring_runtime_gate').length>=2)
   await go('/vacancies');await page.evaluate(()=>window.gate='closed');await page.getByRole('link',{name:'Engineer',exact:true}).click();await expect(page.getByText('Applications are not open yet. Please check back later.')).toBeVisible();await expect(page.getByRole('link',{name:'Apply for this vacancy'})).toHaveCount(0)
  })
  await t.test('unknown and wrong-scope IDs are unavailable; legacy jobs still resolve',async()=>{
   await go('/vacancies/nonexistent');await expect(page.getByRole('heading',{name:'404 — Not found'})).toBeVisible()
   await go('/vacancies/job?organization_id=wrong&brand_id=brand');await expect(page.getByRole('heading',{name:'404 — Not found'})).toBeVisible()
   await go('/jobs/job?organization_id=org&brand_id=brand');await expect(page.getByRole('heading',{name:'Engineer',exact:true})).toBeVisible();await expect(page.getByText('Legacy description')).toBeVisible()
  })
  await t.test('missing sections are omitted, empty index and copy failure are recoverable',async()=>{
   await go('/vacancies');await page.evaluate(()=>window.partial=true);await page.getByRole('link',{name:'Engineer',exact:true}).click();await expect(page.getByRole('heading',{name:'Overview',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Requirements',exact:true})).toHaveCount(0)
   await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('denied')}}}));await page.getByRole('button',{name:'Copy vacancy link'}).click();await expect(page.getByText('Could not copy the link. Copy the address from your browser.')).toBeVisible()
   await page.evaluate(()=>window.empty=true);await page.getByRole('link',{name:'All vacancies'}).click();await expect(page.getByText('No vacancies currently open')).toBeVisible()
  })
  await t.test('loading and error/retry states',async()=>{
   await go('/vacancies/job');await expect(page.getByRole('heading',{name:'Engineer',exact:true})).toBeVisible();await page.evaluate(()=>window.hold=true);await page.getByRole('link',{name:'All vacancies'}).click();await expect(page.getByRole('status')).toHaveText('Loading vacancies…');await page.evaluate(()=>{window.hold=false;window.pending([])});await expect(page.getByText('No vacancies currently open')).toBeVisible()
   await page.evaluate(()=>window.fail=true);await page.getByRole('link',{name:'Jobs',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();await page.getByRole('link',{name:'Vacancies',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Vacancies could not be loaded.');await page.evaluate(()=>window.fail=false);await page.getByRole('button',{name:'Retry',exact:true}).click();await expect(page.getByRole('link',{name:'Engineer',exact:true})).toBeVisible()
  })
  await t.test('owner vacancy management loads draft, saves and previews server PD',async()=>{
   await page.evaluate(()=>window.auth={user:{id:'owner'},loading:false});await page.getByRole('link',{name:'Switch to Recruiter Workspace'}).click();await page.getByRole('button',{name:'Toggle primary navigation'}).click();await page.getByRole('navigation',{name:'Primary navigation'}).getByRole('link',{name:'Vacancies',exact:true}).first().click();await expect(page.getByRole('heading',{name:'Vacancy Management'})).toBeVisible();await page.getByRole('button',{name:/Engineer draft/}).click();await expect(page.getByRole('heading',{name:'Structured Position Description'})).toBeVisible();await page.getByLabel('Overview',{exact:true}).fill('Draft overview');await page.getByRole('button',{name:'Save PD Draft'}).click();await expect(page.getByText(/PD draft saved, version 1/)).toBeVisible();await page.getByRole('button',{name:'Save and preview PD'}).click();await expect(page.getByRole('region',{name:'Position Description preview'})).toBeVisible();await expect(page.getByRole('heading',{name:'Preview — version 2'})).toBeVisible()
   const calls=await page.evaluate(()=>window.calls);assert.ok(calls.some(c=>c.name==='save_pd_draft'&&c.p.expected_version===0&&c.p.overview==='Draft overview'));assert.ok(calls.some(c=>c.name==='get_pd_draft'));assert.ok(calls.some(c=>c.name==='preview_pd'))
  })
 } finally { await browser?.close();await server.close();rmSync(cacheDir,{recursive:true,force:true}) }
})
