import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
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
const fixture = `import React from 'react';import {createRoot} from 'react-dom/client';import App from '/src/App.tsx';import {RouteBoundary} from '/src/route-ui.tsx';import '/src/index.css';
window.role='recruiter';window.auth={user:null,loading:false};window.calls=[];window.fail=false;window.gate='closed';window.pending=[];
const job={requisition_id:'job',organization_id:'org',brand_id:'brand',terms_json:JSON.stringify({engagement_basis:'employment',programme_kind:'other',compensation_type:'salary',weekly_hours_min:20,weekly_hours_max:40}),title:'Engineer',brand_name:'Brand',organization_name:'Org',location:'Remote',notice_text:'Notice',notice_version:'v1',description:'Job description'};
window.write=async(name,p)=>{window.savedParams=p;if(window.saveFails)throw Error('synthetic');window.saved={...p,id:p.application_id,requisition_title:'Engineer',stage:'submitted'};};
window.read=async(name,p)=>{window.calls.push({name,p});if(name==='get_activity_timeline')return p.org_id==='org'&&p.brand_id==='brand'?[{id:'org-only',ts:1793246400000,source:'journal',kind:'journal',actor:'staff',summary:'Org-only logbook entry',recorded_at:1794000000000,entry_type:'decision',claimed_performer:'assistant',operation_id:'org-only'}]:[];if(name==='list_workspace_members')return [{user_id:'staff',role:'recruiter'}];if(name==='get_application'&&window.saved&&p.application_id===window.saved.id)return [window.saved];if(window.fail)throw Error('synthetic');if(window.hold)return new Promise(resolve=>window.pending.push({name,p,resolve}));if(name==='list_public_jobs'||name==='list_vacancies')return [job];if(name==='get_public_job'||name==='get_vacancy_detail')return p.requisition_id==='job'&&(!p.organization_id||p.organization_id==='org')&&(!p.brand_id||p.brand_id==='brand')?[job]:[];if(name==='get_hiring_runtime_gate')return [{intake_status:window.gate}];if(name==='get_my_workspace')return p.organization_id==='org'&&(!p.brand_id||p.brand_id==='brand')&&(!p.owner_only||window.role==='owner')?[{organization_id:'org',brand_id:'brand',organization_name:'Org',brand_name:'Brand',role:window.role,can_create_requisition:window.role==='owner'?1:0,can_create_brand:window.role==='owner'?1:0}]:p.organization_id==='other'&&(!p.brand_id||p.brand_id==='other')&&!p.owner_only?[{organization_id:'other',brand_id:'other',organization_name:'Other',brand_name:'Other',role:'recruiter'}]:[];if(name==='list_my_workspaces'&&window.noSpaces)return [];if(name==='list_my_workspaces')return [{organization_id:'org',brand_id:'brand',organization_name:'Org',brand_name:'Brand',role:window.role,can_create_requisition:window.role==='owner'?1:0,can_create_brand:window.role==='owner'?1:0},{organization_id:'other',brand_id:'other',organization_name:'Other',brand_name:'Other',role:'recruiter'}];if(name==='list_applications'&&location.search.includes('visual=1'))return [{id:'full',candidate_name:'Alex Morgan',requisition_title:'Senior Software Engineer',stage:'in_review',source:'referral',assignee_user_id:'staff',created_at:1700000000000}];if(name==='list_vacancy_management')return location.search.includes('visual=1')?[{id:'req',title:'Senior Software Engineer',state:'draft',updated_at:1700000000000}]:[];if(name==='get_vacancy_management')return p.brand_id==='brand'&&p.requisition_id==='req'&&!window.denyVacancy?[{id:'req',title:'Engineer',status:'open',state:'published',updated_at:1,can_publish:1,review_state:'pending_review',publication_version:2,published_description:'Published FGS Developer role',published_location:'Melbourne',published_arrangement:'Hybrid',published_compensation:'Salary',published_contact:'hiring@example.test',published_notice_version:'v2',published_notice_text:'Privacy notice'}]:[];if(name==='get_requisition_review')return [{version:1,payload:JSON.stringify({description:'Approved FGS Developer role',arrangement:'Hybrid',compensation:'Salary'})}];if(name==='list_requisitions')return p.brand_id==='brand'?[{id:'req',title:'Engineer',status:'draft'}]:[];if(name==='get_admin_settings')return [{organization_name:'Org',verified_contact:null,brand_name:'Brand',slug:null,notice_version:null,reply_identity:null,can_manage_organization:1}];if(name==='get_application')return p.application_id==='full'&&p.organization_id==='org'&&p.brand_id==='brand'?[{id:'full',candidate_id:'candidate-full',candidate_name:'Older full candidate',requisition_title:'Engineer',stage:window.candidateStage||'in_review',version:1,email:'older@example.com',phone:'',source:'referral',source_detail:'Referral',basis_reference:'Policy',contact_context:'Direct',assignee_user_id:'staff',updated_at:1}]:[];if(name==='gateway_get_application')return p.application_id==='old'&&p.organization_id==='org'&&p.brand_id==='brand'?[{id:'old',candidate_name:'Restricted candidate',requisition_title:'Engineer',stage:'submitted'}]:[];return []};
const root=createRoot(document.getElementById('root'));window.render=()=>root.render(<App/>);function Crash(){throw Error('synthetic render error')}window.crash=()=>root.render(<RouteBoundary><Crash/></RouteBoundary>);window.render();`

test('routing renders real public/protected pages and preserves URL scope', async t => {
 const cacheDir=mkdtempSync(join(tmpdir(),'hiring-routing-vite-'))
 const server = await createServer({root:web,cacheDir,configFile:false,plugins:[react(),tailwind(),{
  name:'route-fixture.jsx',enforce:'pre',
  resolveId(id){if(id==='@proappstore/sdk')return '\0route-sdk.jsx';if(id==='/fixture.jsx')return '\0route-fixture.jsx'},
  load(id){if(id==='\0route-sdk.jsx')return transpile(sdk);if(id==='\0route-fixture.jsx')return transpile(fixture);if(id===web+'src/api.ts'){return readFileSync(id,'utf8').replace(/export const read = async[^\n]+/, 'export const read = (...args) => window.read(...args)').replace('export const write = async', 'export const write = (...args) => window.write(...args); const originalWrite = async').replace(/export const readPublic = async[^\n]+/,'export const readPublic = (...args) => window.read(...args)')}},
  configureServer(s){s.middlewares.use(async(req,res,next)=>{if(req.headers.accept?.includes('text/html')){res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(req.url,'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/fixture.jsx"></script></body></html>'))}else next()})}
 }],server:{host:'127.0.0.1',port:0}})
 await server.listen();let browser
 try {
  browser=await chromium.launch();const page=await browser.newPage({viewport:{width:375,height:812},locale:'en-US',timezoneId:'UTC'});page.setDefaultTimeout(10000);const base=server.resolvedUrls.local[0].replace(/\/$/,'')
  const go=path=>page.goto(base+path)
  await t.test('direct lifecycle routes expose valid controls, completion evidence and persistent stage filters',async()=>{
   for(const stage of ['accepted','onboarding','onboarded','active']){
    await go('/recruiter/applications/full?organization_id=org&brand_id=brand&view=lifecycle')
    await page.evaluate(stage=>{window.candidateStage=stage;window.auth={user:{id:'staff'},loading:false};window.render()},stage)
    await expect(page.getByRole('heading',{name:'Candidate lifecycle',exact:true})).toBeVisible()
    if(stage==='active')await expect(page.getByLabel('Next lifecycle stage')).toHaveCount(0)
    else {
     await expect(page.getByLabel('Next lifecycle stage')).toHaveValue({accepted:'onboarding',onboarding:'onboarded',onboarded:'active'}[stage])
     if(stage==='onboarding')for(const label of ['Completed registration evidence','Requirements acknowledgement evidence','Completed team / Discord handoff evidence'])await expect(page.getByLabel(label,{exact:true})).toBeVisible()
    }
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
   }
   await go('/recruiter/applications?organization_id=org&brand_id=brand&stage=onboarded')
   await page.evaluate(()=>{window.auth={user:{id:'staff'},loading:false};window.render()})
   await page.getByRole('button',{name:'Filters',exact:true}).click()
   await expect(page.getByLabel('Stage',{exact:true})).toHaveValue('onboarded')
   await go('/recruiter/applications/full?organization_id=org&brand_id=other&view=lifecycle')
   await page.evaluate(()=>{window.auth={user:{id:'staff'},loading:false};window.render()})
   await expect(page.getByRole('heading',{name:'Candidate lifecycle',exact:true})).toHaveCount(0)
   await page.evaluate(()=>{window.candidateStage=undefined;window.auth={user:null,loading:false};window.render()})
  })
  await t.test('canonical public list/detail, copied URL, refresh, back and keyboard',async()=>{
   await go('/');await expect(page).toHaveURL(/\/vacancies$/);await expect(page.getByRole('heading',{name:'Vacancies',exact:true})).toBeVisible();await expect(page.getByRole('navigation',{name:'Public navigation'})).toBeVisible();await expect(page.getByTestId('staff-shell')).toHaveCount(0)
   const link=page.getByRole('link',{name:'Engineer',exact:true});await link.focus();await page.keyboard.press('Enter');await expect(page).toHaveURL(/\/vacancies\/job\?back=/);await expect(page.getByRole('heading',{name:'Engineer',exact:true})).toBeVisible();await expect(page.locator('#route-content')).toBeFocused();await page.reload();await expect(page.getByText('Job description',{exact:true})).toBeVisible();await page.getByRole('link',{name:'All vacancies'}).click();await expect(page.getByRole('heading',{name:'Vacancies',exact:true})).toBeVisible()
   await go('/vacancies/job');await expect(page.getByRole('heading',{name:'Engineer',exact:true})).toBeVisible();assert.ok(await page.evaluate(()=>window.calls.some(c=>c.name==='get_vacancy_detail'&&c.p.requisition_id==='job'&&!c.p.organization_id)))
  })
  await t.test('structured discovery filters survive detail, apply, sign-in and browser history',async()=>{
   await go('/vacancies?filter_brand=brand&engagement_basis=employment&compensation_type=salary')
   await expect(page.getByLabel('engagement basis',{exact:true})).toHaveValue('employment')
   const list=page.url()
   await page.getByRole('link',{name:'Engineer',exact:true}).click()
   await page.evaluate(()=>window.gate='open')
   await page.getByRole('link',{name:'All vacancies',exact:true}).click()
   await page.getByRole('link',{name:'Engineer',exact:true}).click()
   await page.getByRole('link',{name:'Apply for this vacancy',exact:true}).click()
   await expect(page.getByText('Apply for Engineer · Brand',{exact:true})).toBeVisible()
   await page.getByRole('link',{name:'Sign in to continue',exact:true}).click()
   await page.evaluate(()=>{window.auth={user:{id:'candidate'},loading:false};window.render()})
   await expect(page.getByLabel('Your name')).toBeVisible()
   await page.goBack();await expect(page.getByRole('heading',{name:'Engineer',exact:true})).toBeVisible()
   await page.goForward();await expect(page.getByLabel('Your name')).toBeVisible()
   await page.getByRole('link',{name:'Vacancy details',exact:true}).click()
   await page.getByRole('link',{name:'All vacancies',exact:true}).click()
   assert.equal(page.url(),list)
   await expect(page.getByLabel('compensation type',{exact:true})).toHaveValue('salary')
   await page.reload();await expect(page.getByLabel('engagement basis',{exact:true})).toHaveValue('employment')
  })
  await t.test('recruiter return links retain onboarding and vacancy terms filters without private query data',async()=>{
   const list='/recruiter/applications?organization_id=org&brand_id=brand&onboarding=invited&invited_from=2026-01-01&invited_to=2026-10-01'
   await go('/recruiter/applications/full?organization_id=org&brand_id=brand&back='+encodeURIComponent(list+'&q=PrivateCandidate&email=private@example.test'))
   await page.evaluate(()=>{window.auth={user:{id:'staff'},loading:false};window.render()})
   await expect(page.getByRole('link',{name:'All applications',exact:true})).toHaveAttribute('href',list)
   await page.getByRole('link',{name:'All applications',exact:true}).click()
   await page.getByRole('button',{name:'Filters',exact:true}).click()
   await expect(page.getByLabel('Onboarding status',{exact:true})).toHaveValue('invited')
   await expect(page.getByLabel('Invited from (UTC)',{exact:true})).toHaveValue('2026-01-01')
   assert.ok(!page.url().includes('PrivateCandidate'))
   const vacancies='/recruiter/vacancies?organization_id=org&brand_id=brand&engagement_basis=employment&needs_review=1'
   await go('/recruiter/vacancies/req?organization_id=org&brand_id=brand&back='+encodeURIComponent(vacancies))
   await page.evaluate(()=>{window.auth={user:{id:'staff'},loading:false};window.render()})
   await expect(page.getByRole('link',{name:'All managed vacancies',exact:true})).toHaveAttribute('href',vacancies)
   await page.getByRole('link',{name:'All managed vacancies',exact:true}).click()
   await page.getByText('Terms filters, report and backfill review',{exact:true}).click()
   await expect(page.getByLabel('engagement basis',{exact:true}).first()).toHaveValue('employment')
   await expect(page.getByRole('checkbox',{name:/Needs explicit terms review/})).toBeChecked()
  })
  await t.test('legacy public routes validate scope then redirect; invalid scopes do not open records',async()=>{
   await go('/apply/job?organization_id=org&brand_id=brand');await expect(page).toHaveURL(/\/vacancies\/job\/apply/);await expect(page.getByText('Applications are not open yet. Please check back later.')).toBeVisible();await expect(page.getByLabel('Your name')).toHaveCount(0)
   await go('/jobs/job?organization_id=other&brand_id=brand');await expect(page.getByRole('heading',{name:'404 — Not found'})).toBeVisible();await expect(page.getByText('Job description',{exact:true})).toHaveCount(0)
   await go('/jobs/job?organization_id=org');await expect(page.getByRole('heading',{name:'404 — Not found'})).toBeVisible()
   await go('/jobs/job?organization_id=&brand_id=');await expect(page.getByRole('heading',{name:'404 — Not found'})).toBeVisible()
   await go('/jobs/job');await expect(page).toHaveURL(/\/vacancies\/job/);await expect(page.getByRole('heading',{name:'Engineer',exact:true})).toBeVisible()
   await go('/jobs?q=Engineer&candidate_email=secret%40example.test');await expect(page).toHaveURL(base+'/vacancies?q=Engineer')
  })
  await t.test('public discovery survives auth hydration; protected pages wait',async()=>{
   await go('/missing');await page.evaluate(()=>{window.auth={user:null,loading:true}});await page.getByRole('link',{name:'Browse vacancies'}).click();await expect(page.getByRole('heading',{name:'Vacancies',exact:true})).toBeVisible();await page.getByRole('link',{name:'Switch to Recruiter Workspace'}).click();await expect(page.getByRole('status')).toHaveText('Loading…');await expect(page.getByTestId('staff-shell')).toHaveCount(0)
  })
  await t.test('protected routes redirect with destination and no private reads',async()=>{
   for(const route of ['/recruiter/overview','/recruiter/vacancies','/recruiter/vacancies/req','/recruiter/applications','/recruiter/applications/old','/recruiter/communications','/recruiter/playbook','/recruiter/operations','/recruiter/compliance','/recruiter/organizations/org/brands/brand/settings']){await go(route+'?organization_id=org&brand_id=brand');await expect(page).toHaveURL(/\/sign-in\?returnTo=/);await expect(page.getByRole('heading',{name:'Sign in to Hiring'})).toBeVisible();assert.equal(await page.evaluate(()=>window.calls.length),0);await expect(page.getByTestId('staff-shell')).toHaveCount(0)}
  })
  await t.test('each recruiter screen has a direct canonical URL and mobile layout',async()=>{
   const routes=[['overview','Overview'],['vacancies','Vacancies'],['vacancies/req','Vacancies'],['applications','Applications'],['applications/full','Application details'],['communications','Communications — Brand'],['playbook','Playbook'],['operations','Operations'],['compliance','Compliance'],['organizations/org/brands/brand/settings','Settings']]
   await page.setViewportSize({width:1280,height:800})
   for(const [route,heading] of routes){await go('/recruiter/'+route+'?organization_id=org&brand_id=brand');await page.evaluate(()=>{window.role='owner';window.auth={user:{id:'owner'},loading:false};window.render()});await expect(page.getByRole('heading',{name:heading,exact:true}).first()).toBeVisible();await expect(page.getByRole('combobox',{name:'Workspace',exact:true})).toBeVisible()}
   await go('/recruiter/vacancies/req?organization_id=org&brand_id=brand');await page.evaluate(()=>{window.role='owner';window.auth={user:{id:'owner'},loading:false};window.render()});await expect(page.getByRole('heading',{name:'Manage Engineer'})).toBeVisible()
   await page.setViewportSize({width:375,height:812});await expect(page.getByRole('heading',{name:'Manage Engineer'})).toBeVisible();await expect(page.getByRole('combobox',{name:'Workspace',exact:true})).toBeVisible();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'/tmp/hiring-recruiter-mobile.png',fullPage:true})
  })
  await t.test('screen budgets and visual regression for core recruiter routes', async()=>{
   const baselines = new URL('./visual/hiring/', import.meta.url)
   mkdirSync(baselines,{recursive:true})
   for(const width of [375,1280]) for(const [name,route,ready] of [
    ['applications','applications','Alex Morgan'],
    ['candidate','applications/full','Next action'],
    ['vacancies','vacancies','Senior Software Engineer'],
    ['settings','organizations/org/brands/brand/settings','Brand settings'],
   ]) {
    await page.setViewportSize({width,height:812})
    await go('/recruiter/'+route+'?organization_id=org&brand_id=brand&visual=1')
    await page.evaluate(()=>{window.role='owner';window.auth={user:{id:'owner'},loading:false};window.render()})
    await expect(page.getByText(ready,{exact:true})).toBeVisible()
    await expect(page.locator('#route-content h1')).toHaveCount(1)
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
    const content=page.locator('#route-content')
    assert.ok(await content.locator('details[open]').count()===0,'Help starts collapsed')
    if(name==='applications') {
     const add=page.getByRole('link',{name:'Add candidate',exact:true})
     assert.ok((await add.boundingBox()).height>=44,'Primary action target is at least 44px')
     if(width===1280)await expect(page.getByRole('button',{name:'Filters',exact:true})).toBeHidden()
     await add.focus();await expect(add).toBeFocused()
     assert.notEqual(await add.evaluate(el=>getComputedStyle(el).outlineStyle),'none')
     if(width===375){await page.getByRole('button',{name:'Filters',exact:true}).click();await expect(page.getByLabel('Stage',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Filters',exact:true}).click()}
    }
    await page.locator('#route-content').focus()
    await page.evaluate(()=>document.fonts.ready)
    const screenshot=await content.screenshot({animations:'disabled'})
    const path=new URL(name+'-'+width+'.png',baselines)
    if(process.env.UPDATE_HIRING_VISUALS==='1')writeFileSync(path,screenshot)
    const baseline=readFileSync(path)
    const difference=await page.evaluate(async ({actual,expected})=>{
     const bitmap=async encoded=>createImageBitmap(new Blob([Uint8Array.from(atob(encoded),c=>c.charCodeAt(0))],{type:'image/png'}))
     const [a,b]=await Promise.all([bitmap(actual),bitmap(expected)])
     if(a.width!==b.width||a.height!==b.height)return {sizeChanged:true,actual:[a.width,a.height],expected:[b.width,b.height]}
     const pixels=image=>{const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const context=canvas.getContext('2d');context.drawImage(image,0,0);return context.getImageData(0,0,image.width,image.height).data}
     const left=pixels(a),right=pixels(b);let changed=0,totalError=0
     for(let i=0;i<left.length;i+=4){const error=Math.max(Math.abs(left[i]-right[i]),Math.abs(left[i+1]-right[i+1]),Math.abs(left[i+2]-right[i+2]));if(error>10)changed++;totalError+=error}
     return {changedFraction:changed/(left.length/4),meanError:totalError/(left.length/4)}
    },{actual:screenshot.toString('base64'),expected:baseline.toString('base64')})
    assert.ok(!difference.sizeChanged&&difference.changedFraction<0.12&&difference.meanError<10,`Visual changed: ${path.pathname} (${JSON.stringify(difference)}); review and regenerate with UPDATE_HIRING_VISUALS=1`)
   }
  })
  await t.test('first workspace setup is confined to Settings',async()=>{
   await go('/recruiter/applications');await page.evaluate(()=>{window.noSpaces=true;window.auth={user:{id:'new-owner'},loading:false};window.render()})
   await expect(page).toHaveURL(/\/recruiter\/settings$/)
   await expect(page.getByRole('heading',{name:'Create an internal workspace',exact:true})).toBeVisible()
  })
  await t.test('diagnostics belong to Settings with role-aware links and safe legacy redirects',async()=>{
   for(const role of ['owner','recruiter']){
    await go('/recruiter/operations?organization_id=org&brand_id=brand');await page.evaluate(role=>{window.role=role;window.auth={user:{id:role},loading:false};window.render()},role)
    await expect(page).toHaveURL(/\/recruiter\/settings\/operations\?organization_id=org&brand_id=brand/)
    await expect(page.getByRole('heading',{name:'Settings',exact:true})).toBeVisible()
    const management=page.getByRole('navigation',{name:'Management scope'})
    await expect(management.getByRole('link',{name:'Operations',exact:true})).toHaveAttribute('aria-current','page')
    await expect(management.getByRole('link',{name:'Brand management',exact:true})).toHaveCount(role==='owner'?1:0)
    const nav=page.getByRole('navigation',{name:'Primary navigation'})
    await expect(nav.getByRole('link',{name:'Operations',exact:true,includeHidden:true})).toHaveCount(0)
    await expect(nav.getByRole('link',{name:'Settings',exact:true,includeHidden:true}).first()).toHaveAttribute('aria-current','page')
   }
   for(const role of ['reviewer','auditor']){
    await go('/recruiter/settings/operations?organization_id=org&brand_id=brand');await page.evaluate(role=>{window.role=role;window.auth={user:{id:role},loading:false};window.render()},role)
    await expect(page.getByRole('heading',{name:'404 — Not found',exact:true})).toBeVisible()
    assert.equal(await page.evaluate(()=>window.calls.some(c=>c.name==='list_operational_diagnostics')),false)
   }
  })
  await t.test('task routes separate pipeline, candidate entry, search, vacancies, settings and policy',async()=>{
   const open=async(route,role='owner')=>{await go('/recruiter/'+route+'?organization_id=org&brand_id=brand');await page.evaluate(role=>{window.role=role;window.auth={user:{id:'staff'},loading:false};window.render()},role)}
   for(const width of [1280,375]){
    await page.setViewportSize({width,height:812})
    await open('applications');await expect(page.getByRole('heading',{level:1})).toHaveText(['Applications'])
    await expect(page.getByRole('link',{name:'Add candidate',exact:true})).toBeVisible()
    await expect(page.getByRole('heading',{name:'Applications',exact:true})).toHaveCount(1)
    await expect(page.getByRole('link',{name:'Search records',exact:true})).toHaveCount(0)
    await expect(page.getByRole('link',{name:'Talent pool',exact:true})).toHaveCount(0)
    await expect(page.getByLabel('Candidate name',{exact:true})).toHaveCount(0)
    for(const title of ['Workspace setup','Vacancy Management','Talent pool','Search records'])await expect(page.getByRole('heading',{name:title,exact:true})).toHaveCount(0)
    assert.equal(await page.evaluate(()=>window.calls.some(c=>['list_talent_pool','list_vacancy_management','get_admin_settings'].includes(c.name))),false)
    await page.getByRole('link',{name:'Add candidate',exact:true}).click();await expect(page).toHaveURL(/applications\/new/)
    await expect(page.getByRole('heading',{level:1})).toHaveText(['Add candidate']);await expect(page.getByLabel('Candidate name',{exact:true})).toBeVisible()
    await expect(page.getByRole('searchbox')).toHaveCount(0)
    await page.getByRole('link',{name:'All applications',exact:true}).click();await expect(page.getByLabel('Candidate name',{exact:true})).toHaveCount(0)
    await open('vacancies');await expect(page.getByRole('heading',{level:1})).toHaveText(['Vacancies']);await page.getByRole('link',{name:'Add requisition',exact:true}).click();await expect(page.getByRole('heading',{level:1})).toHaveText(['Add requisition']);await expect(page.getByLabel('Role title',{exact:true})).toBeVisible();await expect(page.getByLabel('Candidate name',{exact:true})).toHaveCount(0)
    await open('playbook');await expect(page.getByRole('heading',{level:1})).toHaveText(['Playbook'])
    await open('organizations/org/brands/brand/settings');await expect(page.getByRole('heading',{level:1})).toHaveText(['Settings']);await expect(page.getByText('Add draft requisition',{exact:true})).toHaveCount(0)
    await open('applications','reviewer');await expect(page.getByRole('heading',{level:1})).toHaveText(['Applications']);await expect(page.getByRole('link',{name:'Add candidate',exact:true})).toHaveCount(0);await expect(page.getByRole('link',{name:'Talent pool',exact:true})).toHaveCount(0)
    await open('applications/new','reviewer');await expect(page.getByRole('heading',{name:'404 — Not found'})).toBeVisible();await expect(page.getByLabel('Candidate name',{exact:true})).toHaveCount(0)
   }
  })
  await t.test('manual entry validates, retains failures, cancels and returns a confirmed record to the list',async()=>{
   await go('/recruiter/applications?organization_id=org&brand_id=brand&stage=offered');await page.evaluate(()=>{window.role='recruiter';window.auth={user:{id:'staff'},loading:false};window.render()})
   await page.getByRole('link',{name:'Add candidate',exact:true}).click()
   await expect(page.locator('#route-content')).toBeFocused()
   await expect(page.getByText(/Connected and imported applicants appear automatically/)).toBeVisible()
   await page.getByRole('button',{name:'Save form'}).click();assert.equal(await page.evaluate(()=>window.savedParams),undefined)
   for(const [label,value] of [['Candidate name','New candidate'],['Source detail (where and when found)','Referral today'],['Lawful basis / policy reference','Policy v1'],['Contact context (how contact details were obtained)','Provided directly']])await page.getByLabel(label,{exact:true}).fill(value)
   await page.evaluate(()=>window.saveFails=true);await page.getByRole('button',{name:'Save form'}).click();await expect(page.getByRole('alert')).toBeVisible();await expect(page.getByLabel('Candidate name',{exact:true})).toHaveValue('New candidate');await expect(page).toHaveURL(/applications\/new/)
   await page.evaluate(()=>window.saveFails=false);await page.getByRole('button',{name:'Save form'}).click()
   await expect(page).toHaveURL(base+'/recruiter/applications?organization_id=org&brand_id=brand');await expect(page.getByText('Candidate saved successfully. No outreach was sent.')).toBeVisible();await expect(page.getByRole('list',{name:'Applicants'})).toContainText('New candidate')
   const saved=await page.evaluate(()=>window.savedParams);assert.equal(saved.source,'manual');assert.equal(saved.requisition_id,'req');assert.equal(saved.assignee_user_id,'staff');assert.equal(saved.basis_reference,'Policy v1')
   await page.getByRole('link',{name:'Add candidate',exact:true}).click();await expect(page.getByLabel('Candidate name',{exact:true})).toBeVisible();await page.keyboard.press('Escape');await expect(page).toHaveURL(base+'/recruiter/applications?organization_id=org&brand_id=brand');await expect(page.getByRole('heading',{level:1})).toHaveText('Applications')
   await page.getByRole('link',{name:'Add candidate',exact:true}).click();await expect(page.getByLabel('Candidate name',{exact:true})).toBeVisible();await page.goBack();await expect(page.getByRole('heading',{level:1})).toHaveText('Applications')
  })
  await t.test('operations shows organization-only journal entries in the selected scope',async()=>{
   await go('/recruiter/settings/operations?organization_id=org&brand_id=brand')
   await page.evaluate(()=>{window.role='recruiter';window.auth={user:{id:'staff'},loading:false};window.render()})
   await expect(page.getByRole('heading',{name:'Organization activity timeline'})).toBeVisible()
   await expect(page.getByText('Org-only logbook entry')).toBeVisible()
   assert.ok(await page.evaluate(()=>window.calls.some(c=>c.name==='get_activity_timeline'&&c.p.organization_id==='org'&&c.p.brand_id==='brand'&&c.p.org_id==='org'&&!c.p.candidate_id)))
   await go('/recruiter/settings/operations?organization_id=other&brand_id=other')
   await page.evaluate(()=>{window.auth={user:{id:'staff'},loading:false};window.render()})
   await expect(page.getByRole('heading',{name:'Organization activity timeline'})).toBeVisible()
   await expect(page.getByText('Org-only logbook entry')).toHaveCount(0)
   assert.ok(await page.evaluate(()=>window.calls.some(c=>c.name==='get_activity_timeline'&&c.p.organization_id==='other'&&c.p.brand_id==='other'&&c.p.org_id==='other')))
  })
  await t.test('candidate workspace keeps overview focused and subsections scoped on mobile and desktop',async()=>{
   for(const width of [1280,375]){
    await page.setViewportSize({width,height:812})
    await go('/recruiter/applications/full?organization_id=org&brand_id=brand')
    await page.evaluate(()=>{window.role='recruiter';window.auth={user:{id:'staff'},loading:false};window.render()})
    await expect(page.getByRole('heading',{name:'Older full candidate'})).toBeVisible()
    await expect(page.getByText('Owner: staff · Source: referral')).toBeVisible()
    await expect(page.getByRole('heading',{name:'Private notes'})).toHaveCount(0)
    await expect(page.getByRole('heading',{name:'Human decisions and offers'})).toHaveCount(0)
    await expect(page.getByRole('heading',{name:'Interviews',exact:true})).toHaveCount(0)
    await page.getByRole('link',{name:'Activity and notes',exact:true}).click()
    await expect(page.getByRole('heading',{name:'Private notes'})).toBeVisible()
    await expect(page.getByRole('heading',{name:'Activity timeline'})).toBeVisible()
    assert.ok(await page.evaluate(()=>window.calls.some(c=>c.name==='get_activity_timeline'&&c.p.organization_id==='org'&&c.p.brand_id==='brand'&&c.p.candidate_id==='candidate-full')))
    await expect(page).toHaveURL(/organization_id=org&brand_id=brand&view=activity/)
    await page.reload();await page.evaluate(()=>{window.auth={user:{id:'staff'},loading:false};window.render()})
    await expect(page.getByRole('heading',{name:'Private notes'})).toBeVisible()
    await page.getByRole('link',{name:'Decision',exact:true}).click()
    await expect(page.getByRole('heading',{name:'Change stage'})).toBeVisible()
    await expect(page.getByLabel('Reason / human decision')).toBeVisible()
    await expect(page.getByRole('heading',{name:'Private notes'})).toHaveCount(0)
    await page.goBack();await expect(page.getByRole('heading',{name:'Private notes'})).toBeVisible()
    await page.getByRole('link',{name:'Communications',exact:true}).last().click()
    await expect(page.getByRole('heading',{name:'Send approved message'})).toBeVisible()
    await expect(page.getByRole('heading',{name:'Change stage'})).toHaveCount(0)
    await page.getByRole('link',{name:'Interview',exact:true}).click()
    await expect(page.getByRole('heading',{name:'Interviews',exact:true})).toBeVisible()

    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
   }
  })
  await t.test('vacancy bookmark, publication snapshot, safe back and workspace return',async()=>{
   const list='/recruiter/vacancies?organization_id=org&brand_id=brand'
   const detail='/recruiter/vacancies/req?organization_id=org&brand_id=brand'
   await go(detail+'&back='+encodeURIComponent(list));await page.evaluate(()=>{window.role='recruiter';window.auth={user:{id:'vacancy-staff'},loading:false};window.render()})
   await expect(page.getByRole('heading',{name:'Manage Engineer'})).toBeVisible()
   await expect(page.getByText('Lifecycle: published')).toBeVisible()
   await expect(page.getByRole('heading',{name:'Approved job description'})).toBeVisible()
   await expect(page.getByText('Approved FGS Developer role')).toBeVisible()
   await expect(page.getByRole('heading',{name:'Public vacancy snapshot'})).toBeVisible()
   await expect(page.getByText('Published FGS Developer role')).toBeVisible()
   await expect(page.getByRole('heading',{name:'Structured Position Description'})).toBeVisible()
   await expect(page.getByRole('link',{name:'All managed vacancies'})).toHaveAttribute('href',list)
   await page.getByRole('combobox',{name:'Workspace',exact:true}).selectOption('other')
   await expect(page).toHaveURL(base+'/recruiter/vacancies?organization_id=other&brand_id=other')
   await page.getByRole('combobox',{name:'Workspace',exact:true}).selectOption('brand')
   await expect(page.getByRole('heading',{name:'Manage Engineer'})).toBeVisible()
   await expect(page.getByRole('link',{name:'All managed vacancies'})).toHaveAttribute('href',list)
   await expect(page).toHaveURL(new RegExp('back='))
   await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.copied=value}}}))
   await page.getByRole('button',{name:'Copy internal link'}).click()
   const copied=await page.evaluate(()=>window.copied)
   assert.equal(copied,base+detail)
   await go(new URL(copied).pathname+new URL(copied).search);await page.evaluate(()=>{window.role='recruiter';window.auth={user:{id:'vacancy-staff'},loading:false};window.render()})
   await expect(page.getByRole('heading',{name:'Manage Engineer'})).toBeVisible()
   await page.reload();await page.evaluate(()=>{window.role='recruiter';window.auth={user:{id:'vacancy-staff'},loading:false};window.render()})
   await expect(page.getByRole('heading',{name:'Manage Engineer'})).toBeVisible()
   await page.getByRole('combobox',{name:'Workspace',exact:true}).selectOption('other')
   await expect(page).toHaveURL(base+'/recruiter/vacancies?organization_id=other&brand_id=other')
   await expect(page.getByRole('heading',{name:'Manage Engineer'})).toHaveCount(0)
   await page.getByRole('combobox',{name:'Workspace',exact:true}).selectOption('brand')
   await expect(page).toHaveURL(base+detail)
   await expect(page.getByRole('heading',{name:'Manage Engineer'})).toBeVisible()
   assert.ok(await page.evaluate(()=>window.calls.some(c=>c.name==='get_vacancy_management'&&c.p.requisition_id==='req'&&c.p.brand_id==='brand')))
   await page.evaluate(()=>{window.denyVacancy=true})
   await page.getByRole('combobox',{name:'Workspace',exact:true}).selectOption('other')
   await page.getByRole('combobox',{name:'Workspace',exact:true}).selectOption('brand')
   await expect(page).toHaveURL(base+list)
   await expect(page.getByRole('heading',{name:'Manage Engineer'})).toHaveCount(0)
   await go('/recruiter/vacancies/missing?organization_id=org&brand_id=brand');await page.evaluate(()=>{window.role='recruiter';window.auth={user:{id:'vacancy-staff'},loading:false};window.render()})
   await expect(page.getByRole('heading',{name:'404 — Not found'})).toBeVisible()
   await go('/recruiter/vacancies/req?organization_id=other&brand_id=other');await page.evaluate(()=>{window.role='recruiter';window.auth={user:{id:'vacancy-staff'},loading:false};window.render()})
   await expect(page.getByRole('heading',{name:'404 — Not found'})).toBeVisible()
  })
  await t.test('forbidden recruiter screens share the missing-page response',async()=>{
   for(const [role,routes] of [['reviewer',['vacancies','vacancies/req','communications','playbook','operations','compliance','organizations/org/brands/brand/settings']],['auditor',['vacancies','vacancies/req','applications','applications/full','communications','playbook','operations','organizations/org/brands/brand/settings']]]){
    for(const route of routes){await go('/recruiter/'+route+'?organization_id=org&brand_id=brand');await page.evaluate(role=>{window.role=role;window.auth={user:{id:'staff'},loading:false};window.render()},role);await expect(page.getByRole('heading',{name:'404 — Not found'})).toBeVisible();assert.equal(await page.evaluate(()=>window.calls.some(c=>c.name==='get_application'||c.name==='list_vacancy_management')),false)}
   }
   await go('/recruiter/settings?organization_id=org&brand_id=brand');await page.evaluate(()=>{window.role='recruiter';window.auth={user:{id:'staff'},loading:false};window.render()});await expect(page).toHaveURL(/\/recruiter\/settings\/operations\?/);await expect(page.getByRole('heading',{name:'Settings',exact:true})).toBeVisible()
  })
  await t.test('reviewers and auditors reach only their permitted routed screens',async()=>{
   for(const [role,route,heading] of [['reviewer','applications','Applications'],['reviewer','applications/old','Restricted candidate'],['auditor','overview','Overview'],['auditor','compliance','Compliance']]){
    await go('/recruiter/'+route+'?organization_id=org&brand_id=brand');await page.evaluate(role=>{window.role=role;window.auth={user:{id:'staff'},loading:false};window.render()},role);await expect(page.getByRole('heading',{name:heading,exact:true}).last()).toBeVisible()
   }
  })
  await t.test('legacy staff URLs redirect with scope and exact application ID',async()=>{
   const routes=[['/dashboard','/recruiter/overview'],['/admin','/recruiter/overview'],['/applications','/recruiter/applications'],['/applications/full','/recruiter/applications/full'],['/playbook','/recruiter/playbook'],['/admin/communications','/recruiter/communications'],['/admin/operations','/recruiter/settings/operations'],['/admin/compliance','/recruiter/compliance'],['/admin/settings','/recruiter/organizations/org/brands/brand/settings']]
   for(const [oldPath,newPath] of routes){await go(oldPath+'?organization_id=org&brand_id=brand');await page.evaluate(()=>{window.role='owner';window.auth={user:{id:'owner'},loading:false};window.render()});await expect(page).toHaveURL(base+newPath+(newPath.includes('/organizations/')?'':'?organization_id=org&brand_id=brand'))}
  })
  await t.test('primary navigation follows role, scope, active route and mobile menu',async()=>{
   await page.setViewportSize({width:1280,height:800})
   for(const [role,names] of Object.entries({owner:['Overview','Vacancies','Applications','Communications','Playbook','Compliance','Settings'],recruiter:['Overview','Vacancies','Applications','Communications','Playbook','Compliance','Settings'],reviewer:['Overview','Applications'],auditor:['Overview','Compliance']})){
    await go('/recruiter/overview?organization_id=org&brand_id=brand');await page.evaluate(role=>{window.role=role;window.auth={user:{id:'staff'},loading:false};window.render()},role)
    const nav=page.getByRole('navigation',{name:'Primary navigation'});await expect(nav).toBeVisible()
    await expect(nav.locator('.md\\:flex a')).toHaveText([...names,'Public vacancies'])
    await expect(nav.locator('.md\\:flex a[aria-current="page"]')).toHaveText('Overview')
    for(const link of await nav.locator('.md\\:flex a').all()){const href=await link.getAttribute('href');if(href?.startsWith('/vacancies'))continue;if(href?.includes('/organizations/'))assert.match(href,/organizations\/org\/brands\/brand\/settings/);else assert.match(href,/organization_id=org&brand_id=brand/)}
   }
   await page.getByRole('navigation',{name:'Primary navigation'}).locator('.md\\:flex').getByRole('link',{name:'Public vacancies'}).click();await expect(page).toHaveURL(/\/vacancies$/)
   await page.setViewportSize({width:375,height:812});await go('/recruiter/overview?organization_id=org&brand_id=brand');await page.evaluate(()=>{window.role='owner';window.auth={user:{id:'staff'},loading:false};window.render()})
   const nav=page.getByRole('navigation',{name:'Primary navigation'});const toggle=nav.getByRole('button',{name:'Toggle primary navigation'});await expect(toggle).toHaveAttribute('aria-expanded','false');await toggle.click();await expect(toggle).toHaveAttribute('aria-expanded','true')
   await nav.locator('#primary-navigation-menu').getByRole('link',{name:'Vacancies',exact:true}).click();await expect(page).toHaveURL(/\/recruiter\/vacancies\?organization_id=org&brand_id=brand/);await expect(nav.getByRole('link',{name:'Vacancies',exact:true,includeHidden:true}).first()).toHaveAttribute('aria-current','page');await expect(toggle).toHaveAttribute('aria-expanded','false')
  })
  await t.test('unknown route, asynchronous loading and retry',async()=>{
   await go('/missing');await expect(page.getByRole('heading',{name:'404 — Not found'})).toBeVisible();await page.evaluate(()=>{window.hold=true});await page.getByRole('link',{name:'Browse vacancies'}).click();await expect(page.getByRole('status')).toHaveText('Loading vacancies…');await page.evaluate(()=>window.pending.shift().resolve([]));await expect(page.getByText('No vacancies currently open')).toBeVisible()
   await page.evaluate(()=>{window.hold=false;window.fail=true;history.pushState(null,'','/missing');dispatchEvent(new PopStateEvent('popstate'))});await page.getByRole('link',{name:'Browse vacancies'}).click();await expect(page.getByRole('alert')).toContainText('Vacancies could not be loaded');await page.evaluate(()=>window.fail=false);await page.getByRole('button',{name:'Retry',exact:true}).click();await expect(page.getByRole('link',{name:'Engineer',exact:true})).toBeVisible()
  })
  await t.test('signed-in exact lookup, refresh, missing scope and brand switch',async()=>{
   await go('/sign-in?returnTo=%2Fapplications%2Fold%3Forganization_id%3Dorg%26brand_id%3Dbrand');await page.evaluate(()=>{window.role='reviewer';window.auth={user:{id:'staff'},loading:false};window.render()});await expect(page.getByTestId('staff-shell')).toBeVisible();await expect(page.getByRole('heading',{name:'Restricted candidate'})).toBeVisible();const calls=await page.evaluate(()=>window.calls);assert.ok(calls.some(c=>c.name==='gateway_get_application'&&c.p.organization_id==='org'&&c.p.brand_id==='brand'&&c.p.application_id==='old'))
   await page.getByRole('combobox',{name:'Workspace',exact:true}).selectOption('other');await expect(page).toHaveURL(/\/recruiter\/applications\?organization_id=other&brand_id=other/);await expect(page.getByText('Restricted candidate')).toHaveCount(0);await expect(page.getByText('No applications yet.')).toBeVisible()
   await page.getByRole('button',{name:'Filters',exact:true}).click();await page.getByRole('searchbox',{name:/Search candidate name/}).fill('Private candidate search');await page.getByLabel('Stage',{exact:true}).selectOption('offered');await expect(page.getByRole('searchbox',{name:/Search candidate name/})).toHaveValue('Private candidate search');await expect(page).toHaveURL(/stage=offered/);assert.ok(!page.url().includes('Private'));await expect.poll(()=>page.evaluate(()=>window.calls.filter(c=>c.name==='list_applications').at(-1)?.p.stage)).toBe('offered')

  })
  await t.test('full direct detail uses exact lookup, renders legal next stages and denies mixed scope',async()=>{
   await go('/sign-in?returnTo='+encodeURIComponent('/recruiter/applications/full?organization_id=org&brand_id=brand'));await page.evaluate(()=>{window.auth={user:{id:'staff'},loading:false};window.render()});await expect(page.getByRole('heading',{name:'Older full candidate',exact:true})).toBeVisible();await page.getByText('Contact and sourcing details',{exact:true}).click();await expect(page.getByText('older@example.com',{exact:false}).first()).toBeVisible()
   await page.getByRole('link',{name:'Decision',exact:true}).click();await expect(page.getByRole('heading',{name:'Change stage'})).toBeVisible()
   assert.deepEqual(await page.getByRole('combobox',{name:'Next stage',exact:true}).locator('option').evaluateAll(options=>options.map(o=>o.value)),['shortlisted','rejected','interviewing'])
   assert.ok(await page.evaluate(()=>window.calls.some(c=>c.name==='get_application'&&c.p.application_id==='full'&&c.p.brand_id==='brand')))
   await go('/sign-in?returnTo='+encodeURIComponent('/recruiter/applications/full?organization_id=other&brand_id=other'));await page.evaluate(()=>{window.auth={user:{id:'staff'},loading:false};window.render()});await expect(page.getByRole('heading',{name:'404 — Not found'})).toBeVisible();await expect(page.getByText('older@example.com',{exact:false})).toHaveCount(0)
  })
  await t.test('embedded history and the communications route resolve an application outside the recent list',async()=>{
   await go('/recruiter/applications/full?organization_id=org&brand_id=brand');await page.evaluate(()=>{window.role='owner';window.auth={user:{id:'owner'},loading:false};window.render()});await page.getByRole('navigation',{name:'Candidate workspace'}).getByRole('link',{name:'Communications',exact:true}).click();await expect(page.getByRole('heading',{name:'Communications',exact:true})).toBeVisible();await expect(page.getByText('No communications recorded yet.',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Save unsent draft'})).toHaveCount(0)
   await go('/recruiter/communications/full?organization_id=org&brand_id=brand');await page.evaluate(()=>{window.role='owner';window.auth={user:{id:'owner'},loading:false};window.render()});await expect(page).toHaveURL(/\/recruiter\/communications\/full\?organization_id=org&brand_id=brand/);await expect(page.getByRole('heading',{name:'Communications — Brand'})).toBeVisible();await expect(page.getByRole('combobox',{name:'Application'})).toHaveValue('full');assert.ok(await page.evaluate(()=>window.calls.some(c=>c.name==='get_application'&&c.p.application_id==='full')))
   await go('/recruiter/communications?organization_id=org&brand_id=brand&application_id=full');await page.evaluate(()=>{window.role='owner';window.auth={user:{id:'owner'},loading:false};window.render()});await expect(page).toHaveURL(base+'/recruiter/communications/full?organization_id=org&brand_id=brand')
  })
  await t.test('safe list return, copied internal URLs, and explicit scoped settings',async()=>{
   const list='/recruiter/applications?organization_id=org&brand_id=brand&stage=offered'
   await go('/recruiter/applications/full?organization_id=org&brand_id=brand&back='+encodeURIComponent(list));await page.evaluate(()=>{window.role='owner';window.auth={user:{id:'owner'},loading:false};window.render()})
   await expect(page.getByRole('link',{name:'All applications'})).toHaveAttribute('href',list)
   await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.copied=value}}}))
   await page.getByRole('button',{name:'Copy internal link'}).click();assert.equal(await page.evaluate(()=>window.copied),base+'/recruiter/applications/full?organization_id=org&brand_id=brand')
   await go('/recruiter/applications/full?organization_id=org&brand_id=brand');await page.evaluate(()=>{window.role='owner';window.auth={user:{id:'owner'},loading:false};window.render()});await expect(page.getByRole('heading',{name:'Older full candidate',exact:true})).toBeVisible();await page.reload();await page.evaluate(()=>{window.role='owner';window.auth={user:{id:'owner'},loading:false};window.render()});await expect(page.getByRole('heading',{name:'Older full candidate',exact:true})).toBeVisible()
   await go('/recruiter/vacancies/req?organization_id=org&brand_id=brand');await page.evaluate(()=>{window.role='owner';window.auth={user:{id:'owner'},loading:false};window.render()});await expect(page.getByRole('heading',{name:'Manage Engineer'})).toBeVisible();await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.copied=value}}}));await page.getByRole('button',{name:'Copy internal link'}).click();assert.equal(await page.evaluate(()=>window.copied),base+'/recruiter/vacancies/req?organization_id=org&brand_id=brand')
   await go('/recruiter/applications/full?organization_id=org&brand_id=brand&back='+encodeURIComponent('/recruiter/applications?organization_id=other&brand_id=other&stage=offered'));await page.evaluate(()=>{window.role='owner';window.auth={user:{id:'owner'},loading:false};window.render()});await expect(page.getByRole('link',{name:'All applications'})).toHaveAttribute('href','/recruiter/applications?organization_id=org&brand_id=brand')
   await go('/recruiter/organizations/org/brands/brand/settings');await page.evaluate(()=>{window.role='owner';window.auth={user:{id:'owner'},loading:false};window.render()});await expect(page.getByRole('heading',{name:'Settings',exact:true})).toBeVisible();await expect(page.getByText('Brand settings',{exact:true})).toBeVisible();await expect(page.getByText('Organization identity',{exact:true})).toHaveCount(0)
   await go('/recruiter/organizations/other/brands/brand/settings');await page.evaluate(()=>{window.role='owner';window.auth={user:{id:'owner'},loading:false};window.render()});await expect(page.getByRole('heading',{name:'404 — Not found'})).toBeVisible()
   await go('/recruiter/organizations/org/settings');await page.evaluate(()=>{window.role='owner';window.auth={user:{id:'owner'},loading:false};window.render()});await expect(page.getByRole('heading',{name:'Settings',exact:true})).toBeVisible();await expect(page.getByText('Organization identity',{exact:true})).toBeVisible();await expect(page.getByText('Brand settings',{exact:true})).toHaveCount(0)
  })
  await t.test('admin direct routes survive sign-in and deny unauthorized roles',async()=>{
   for(const [route,heading]of [['/recruiter/operations','Operations'],['/recruiter/compliance','Compliance'],['/recruiter/communications','Communications — Brand'],['/recruiter/organizations/org/brands/brand/settings','Workspace setup'],['/recruiter/overview','Overview']]){
    await go('/sign-in?returnTo='+encodeURIComponent(route+'?organization_id=org&brand_id=brand'));await page.evaluate(()=>{window.role='owner';window.auth={user:{id:'owner'},loading:false};window.render()});await expect(page.getByRole('heading',{name:heading,exact:true}).last()).toBeVisible();await expect(page).toHaveURL(new RegExp((route==='/recruiter/operations'?'/recruiter/settings/operations':route)+'\\?'))
   }
   for(const route of ['/recruiter/organizations/org/brands/brand/settings','/recruiter/compliance','/recruiter/operations','/recruiter/communications']){
    await go('/sign-in?returnTo='+encodeURIComponent(route+'?organization_id=org&brand_id=brand'));await page.evaluate(()=>{window.role='reviewer';window.auth={user:{id:'reviewer'},loading:false};window.render()});await expect(page.getByRole('heading',{name:'404 — Not found',exact:true})).toBeVisible();assert.equal(await page.evaluate(()=>window.calls.filter(c=>['get_admin_settings','list_operational_diagnostics','list_communication_templates'].includes(c.name)).length),0)
   }
  })
  await t.test('render error is contained with recovery',async()=>{await page.evaluate(()=>window.crash());await expect(page.getByRole('alert')).toContainText('Something went wrong');await expect(page.getByRole('button',{name:'Retry'})).toBeVisible()})
 } finally {await browser?.close();await server.close();rmSync(cacheDir,{recursive:true,force:true})}
})
test('routing has no legacy view branch and SPA fallback excludes platform paths',()=>{
 for(const name of ['App.tsx','Jobs.tsx'])assert.doesNotMatch(readFileSync(web+'src/'+name,'utf8'), /view=|get\(['"]view['"]\)/)
 const vite=readFileSync(web+'vite.config.ts','utf8');assert.match(vite,/appType: 'spa'/);assert.match(vite,/navigateFallback: '\/index.html'/);assert.match(vite,/navigateFallbackDenylist/)
})
