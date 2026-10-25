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
const sdk = `import React from 'react'; export const initPro=()=>({auth:{get user(){return window.auth?.user}},actions:{call:async(name,p)=>{window.saved=p;if(name==='create_working_interview_invitation'){const rows=[{id:p.record_id,version:1,invitation:p.invitation,owner_user_id:p.owner_user_id,playbook_version:p.playbook_version,invited_at:Date.now(),outcome:null,exceptions:null,completed_at:null}];sessionStorage.setItem('interviews',JSON.stringify(rows));return {results:[{meta:{changes:1}}]}}if(name==='record_working_interview_outcome'){const rows=JSON.parse(sessionStorage.getItem('interviews')||'[]').map(r=>r.id===p.record_id?{...r,version:r.version+1,outcome:p.outcome,exceptions:p.exceptions,completed_at:Date.now()}:r);sessionStorage.setItem('interviews',JSON.stringify(rows));return {results:[{meta:{changes:1}}]}}if(window.saveFail)throw Error('version conflict');window.policy=JSON.parse(p.payload);window.policyVersion=p.expected_version+1;return {results:[{meta:{changes:1}]}}}}); export const useAuth=()=>window.auth; export const ProShell=({children})=><div data-testid="staff-shell">{children}</div>; export const PageHeader=({title})=><h1>{title}</h1>; export const SignInButton=({label})=><button>{label}</button>;`
const fixture = `import React from 'react';import {createRoot} from 'react-dom/client';import App from '/src/App.tsx';import {RouteBoundary} from '/src/route-ui.tsx';import '/src/index.css';
window.role='recruiter';window.policy={meeting:{time:'09:30',timezone:'Australia/Melbourne',secret_meeting_reference:'https://secret.example/private'}};window.policyVersion=3;window.auth={user:null,loading:false};window.calls=[];window.fail=false;window.gate='closed';window.pending=[];
const job={requisition_id:'job',organization_id:'org',brand_id:'brand',title:'Engineer',brand_name:'Brand',organization_name:'Org',location:'Remote',notice_text:'Notice',notice_version:'v1',description:'Job description'};
window.read=async(name,p)=>{window.calls.push({name,p});if(window.fail)throw Error('synthetic');if(window.hold)return new Promise(resolve=>window.pending.push({name,p,resolve}));if(name==='get_working_interview_records')return JSON.parse(sessionStorage.getItem('interviews')||'[]');if(name==='get_org_recruiting_playbook')return [{version:window.policyVersion,payload:JSON.stringify(window.policy,(key,value)=>key.startsWith('secret_')?undefined:value)}];if(name==='list_applications'||name==='get_application')return [{id:'candidate',candidate_name:'Alex',stage:'interviewing',version:1,assignee_user_id:'recruiter'}];if(name==='list_public_jobs')return [job];if(name==='get_public_job')return p.organization_id==='org'&&p.brand_id==='brand'&&p.requisition_id==='job'?[job]:[];if(name==='get_hiring_runtime_gate')return [{intake_status:window.gate}];if(name==='get_my_workspace')return p.organization_id==='org'&&(!p.brand_id||p.brand_id==='brand')&&(!p.owner_only||window.role==='owner')?[{organization_id:'org',brand_id:'brand',organization_name:'Org',brand_name:'Brand',role:window.role,can_create_brand:window.role==='owner'?1:0}]:[];if(name==='list_my_workspaces')return [{organization_id:'org',brand_id:'brand',organization_name:'Org',brand_name:'Brand',role:window.role,can_create_brand:window.role==='owner'?1:0},{organization_id:'other',brand_id:'other',organization_name:'Other',brand_name:'Other',role:'recruiter'}];if(name==='gateway_get_application')return p.application_id==='old'?[{id:'old',candidate_name:'Restricted candidate',requisition_title:'Engineer',stage:'submitted'}]:[];return []};
const root=createRoot(document.getElementById('root'));window.render=()=>root.render(<App/>);function Crash(){throw Error('synthetic render error')}window.crash=()=>root.render(<RouteBoundary><Crash/></RouteBoundary>);window.render();`

test('recruiter playbook direct routes, privacy, workflow and responsive states', async t => {
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
  const login=async(role,path='/playbook')=>{await go('/sign-in?returnTo='+encodeURIComponent(path+'?organization_id=org&brand_id=brand'));await page.evaluate(role=>{window.role=role;window.auth={user:{id:role},loading:false};window.render()},role)}
  await t.test('unauthenticated route preserves destination',async()=>{await go('/playbook');await expect(page).toHaveURL(/sign-in\?returnTo=/);assert.equal(await page.evaluate(()=>window.calls.length),0)})
  await t.test('recruiter direct route is read-only, labelled and fits mobile',async()=>{
   await login('recruiter');await expect(page.getByRole('heading',{name:'Recruiting playbook',exact:true})).toBeVisible();await expect(page.getByText('Playbook version 3',{exact:true})).toBeVisible();await expect(page.getByText(/Read-only/)).toBeVisible();await expect(page.getByRole('button',{name:'Save new version'})).toHaveCount(0);await expect(page.getByRole('region',{name:'Recruiting playbook'})).toBeVisible();await expect(page.getByText(/Join details are sent privately/)).toBeVisible();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await expect(page.locator('body')).not.toContainText('https://secret.example/private')
  })
  await t.test('owner edit controls, invalid input and redaction warning',async()=>{
   await login('owner');await expect(page.getByLabel('Playbook JSON')).toBeVisible();await expect(page.getByRole('button',{name:'Save new version'})).toBeDisabled();await page.getByLabel(/I have restored/).check();await page.getByLabel('Playbook JSON').fill('[]');await page.getByRole('button',{name:'Save new version'}).click();await expect(page.getByRole('alert')).toContainText('JSON object');await expect(page.getByText(/Saving replaces the complete policy/)).toBeVisible();await page.getByLabel('Playbook JSON').fill('{"meeting":{"time":"10:00","timezone":"Australia/Melbourne"}}');await page.evaluate(()=>window.saveFail=true);await page.getByRole('button',{name:'Save new version'}).click();await expect(page.getByRole('alert')).toContainText('version conflict');await page.evaluate(()=>window.saveFail=false);await page.getByRole('button',{name:'Save new version'}).click();await expect(page.getByRole('status').filter({hasText:'Playbook saved.'})).toBeVisible();assert.equal(await page.evaluate(()=>window.saved.expected_version),3)
  })
  await t.test('missing timing and denied roles',async()=>{
   await login('recruiter');await page.evaluate(()=>window.policy={});await page.getByRole('button',{name:'Reload playbook'}).click();await expect(page.getByText(/Daily meeting time not configured/)).toBeVisible();await login('reviewer');await expect(page.getByRole('heading',{name:'404 — Not found',exact:true})).toBeVisible();assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.name==='get_org_recruiting_playbook').length),0)
  })
  await t.test('historical candidate direct route and invitation/outcome evidence',async()=>{
   await login('recruiter','/applications/candidate');await page.getByRole('link',{name:'Interview',exact:true}).click();await expect(page.getByText('No working interview recorded',{exact:true})).toBeVisible();const preview=page.getByLabel('Invitation preview');await expect(preview).toContainText('stand-up');const text=await preview.inputValue();assert.match(text,/one-to-one/);assert.match(text,/\[Join details will be sent separately\]/);assert.doesNotMatch(text,/secret_|https?:/);await page.getByLabel(/I verified secure/).check();await page.getByRole('button',{name:'Record sent invitation'}).click();await expect(page.getByText('Invitation playbook version 3')).toBeVisible();await page.getByLabel('Interview outcome').fill('Proceed');await page.getByLabel('Exceptions',{exact:true}).fill('None required');await page.getByRole('button',{name:'Record outcome'}).click();await expect(page.getByText(/Outcome: Proceed/)).toBeVisible();await page.reload();await page.evaluate(()=>{window.auth={user:{id:'recruiter'},loading:false};window.render()});await expect(page.getByText(/Outcome: Proceed/)).toBeVisible();await expect(page.getByText('Record version 2',{exact:true})).toBeVisible()
  })
 } finally {await browser?.close();await server.close();rmSync(cacheDir,{recursive:true,force:true})}
})

test('invitation uses only validated timing and never interpolates secret configuration', async () => {
 const source=readFileSync(new URL('../web/src/playbook.ts',import.meta.url),'utf8')
 const code=ts.transpile(source,{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2023})
 const {composeInvitation,meetingTiming,parsePlaybook}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))
 for(const meeting of [{},{time:'25:00',timezone:'UTC'},{time:'09:30',timezone:'invalid'},{time:'09:30'}]){
  assert.equal(meetingTiming({meeting}),null);assert.equal(composeInvitation('Alex',{meeting}),'')
 }
 const text=composeInvitation('Alex',{meeting:{time:'09:30',timezone:'UTC',secret_meeting_reference:'https://private.example/secret',meeting_password:'password'},secret_nested:{url:'sensitive'}})
 assert.match(text,/stand-up/);assert.match(text,/one-to-one/);assert.match(text,/Join details will be sent separately/);assert.doesNotMatch(text,/private.example|password|sensitive|secret_/)
 assert.throws(()=>parsePlaybook('[]'),/JSON object/)
 assert.deepEqual(parsePlaybook(null),{})
})
