import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { chromium, expect } from '@playwright/test'
const require = createRequire(new URL('../web/package.json', import.meta.url))
const { createServer } = await import(require.resolve('vite'))
const { default: react } = await import(require.resolve('@vitejs/plugin-react'))
const { default: tailwind } = await import(require.resolve('@tailwindcss/vite'))
const web = new URL('../web/', import.meta.url).pathname
const fixture = `import React from 'react';import{createRoot}from'react-dom/client';import{AdminTest}from'/src/admin.test.tsx';import'/src/index.css';
window.calls=[];window.fail=false;window.rows=[];window.conflict=false;window.templates=[];
window.read=async(name,params)=>{window.calls.push({name,params});if(window.fail)throw Error('fixture');switch(name){
case'list_communication_templates':return window.templates;
case'list_vacancy_management':return[{id:'req',title:'Engineer',state:'draft',updated_at:1000}];
case'get_vacancy_management':return params.requisition_id==='req'?[{id:'req',title:'Engineer',status:'draft',state:'draft',updated_at:1000,can_publish:1}]:[];
case'get_pd_draft':return[];
case'get_requisition_review':return[{version:1,payload:JSON.stringify({description:'Reviewed content',location:'Remote',arrangement:'Remote volunteer role',compensation:'Unpaid',notice_version:'v1',notice_text:'Applicant privacy notice',contact:'admin@example.test',compensation_type:'volunteer'})}];
case'list_job_publications':return[{requisition_id:'req',title:'Engineer',version:1,status:'published'}];
case'get_admin_settings':return[{organization_name:'Organization',brand_name:'Brand',can_manage_organization:0}];
case'list_brand_admin_members':return[{id:'grant',user_id:'staff',role:'recruiter',scope_type:'brand',scope_id:'brand',granted_at:1000,source:'grant'}];
case'list_requisitions':return[];
default:return window.rows;}};
window.write=async(name,params)=>{window.calls.push({name,params});if(window.conflict)throw Error('No record changed');if(name==='save_communication_template')window.templates=[{...params,id:params.template_id,version:params.expected_version+1}];};
let root=createRoot(document.getElementById('root'));let counter=0;window.show=(scenario,role='owner')=>root.render(React.createElement(AdminTest,{key:++counter,scenario,role}));window.show('nav');`
test('Administration UI permissions, confirmations, operational states and mobile access', async t => {
 const cacheDir=mkdtempSync(join(tmpdir(),'hiring-admin-vite-'))
 const live=await createServer({root:web,cacheDir,configFile:false,optimizeDeps:{entries:[],include:['react','react-dom/client','react-router-dom','@proappstore/sdk']},plugins:[react(),tailwind(),{
 name:'admin-fixture',enforce:'pre',resolveId(id){if(id==='/fixture.jsx')return'\0admin-fixture.jsx'},
 load(id){if(id==='\0admin-fixture.jsx')return fixture;if(id===web+'src/api.ts')return `export const app={auth:{user:{id:'owner'}}};export const id=()=>crypto.randomUUID();export const read=(...a)=>window.read(...a);export const write=(...a)=>window.write(...a);export const readPublic=read;export const STAGES=[];export const NEXT_STAGES=[];export const TERMINAL_STAGES=[];export const stageLabel=x=>x;`},
 configureServer(s){s.middlewares.use(async(req,res,next)=>{if(req.url==='/admin-test'){res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml('/admin-test','<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/fixture.jsx"></script></body></html>'))}else next()})}
 }],server:{host:'127.0.0.1',port:0}})
 await live.listen();let browser
 try {
 browser=await chromium.launch();const page=await browser.newPage({viewport:{width:375,height:812}})
 page.setDefaultTimeout(10000);page.setDefaultNavigationTimeout(30000);const errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.goto(live.resolvedUrls.local[0]+'admin-test');await expect(page.getByRole('navigation',{name:'Administration'})).toBeVisible({timeout:30000})
 await t.test('role navigation and explicit denial',async()=>{
 for(const [role,names]of Object.entries({owner:['Playbook','Overview','Applications','Communications','Operations','Compliance','Settings'],recruiter:['Playbook','Overview','Applications','Communications','Operations','Compliance'],reviewer:['Overview','Applications'],auditor:['Overview','Compliance']})){
 await page.evaluate(role=>window.show('nav',role),role)
 await expect(page.getByRole('navigation',{name:'Administration'}).getByRole('link')).toHaveText(names)
 await expect(page.getByText('Access denied',{exact:true})).toHaveCount(role==='owner'?0:1)
 }
 })
 await t.test('modal focus, keyboard cancellation, trap, button and Enter confirmation',async()=>{
 await page.evaluate(()=>window.show('dialog'));const opener=page.getByRole('button',{name:'Open confirmation'});await opener.click()
 await expect(page.getByRole('dialog')).toBeVisible();await expect(page.getByRole('button',{name:'Cancel',exact:true})).toBeFocused()
 await page.keyboard.press('Shift+Tab');await expect(page.getByRole('button',{name:'Confirm',exact:true})).toBeFocused();await page.keyboard.press('Tab');await expect(page.getByRole('button',{name:'Cancel',exact:true})).toBeFocused()
 await page.keyboard.press('Escape');await expect(page.getByRole('status')).toHaveText('Cancelled');await expect(opener).toBeFocused()
 await opener.click();await page.getByRole('button',{name:'Confirm',exact:true}).click();await expect(page.getByRole('status')).toHaveText('Confirmed')
 await opener.click();await page.getByRole('button',{name:'Confirm',exact:true}).focus();await page.keyboard.press('Enter');await expect(page.getByRole('dialog')).toHaveCount(0)
 })
 await t.test('diagnostics empty, retry and content allowlist',async()=>{
 await page.evaluate(()=>window.show('operations'));await expect(page.getByText('No activity recorded in your scope.')).toBeVisible()
 await page.evaluate(()=>{window.fail=true;window.show('operations')});await expect(page.getByRole('alert')).toContainText('Diagnostics could not be loaded')
 await page.evaluate(()=>{window.fail=false;window.rows=[{id:'event',agent_instance_id:'agent-1',action:'email_thread_scanned',occurred_at:1000,outcome:'unknown',source_url:'https://example.test/candidate/PRIVATE?email=SECRET',summary:'CANDIDATE CONTENT'}]})
 await page.getByRole('button',{name:'Retry',exact:true}).click();await expect(page.getByText('Agent: agent-1')).toBeVisible();await expect(page.getByText('Source: Redacted')).toBeVisible()
 assert.doesNotMatch(await page.locator('body').innerText(),/PRIVATE|SECRET|CANDIDATE CONTENT/)
 })
 await t.test('compliance truthful capabilities and owner-only two-step deletion',async()=>{
 await page.evaluate(()=>window.show('compliance'));await expect(page.getByText('Indefinite retention — no automatic purge',{exact:true})).toBeVisible();await expect(page.getByRole('button')).toHaveCount(0)
 await page.evaluate(()=>window.show('compliance-enabled','auditor'));await expect(page.getByRole('button')).toHaveCount(0)
 await page.evaluate(()=>window.show('compliance-enabled'));await expect(page.getByRole('button',{name:'Request data export'})).toBeVisible();await page.getByRole('button',{name:'Request deletion',exact:true}).click();await page.getByRole('button',{name:'Continue review'}).click();await expect(page.getByRole('dialog')).toContainText('irreversible');await page.getByRole('button',{name:'Confirm deletion request'}).click();await expect(page.getByRole('status')).toContainText('Request recorded')
 })
 await t.test('unknown messages identify brand and absent provider, guide reconciliation without resend',async()=>{
 await page.evaluate(()=>window.show('communications'));await expect(page.getByText('1 unresolved unknown outcomes in loaded records')).toBeVisible();await expect(page.getByText(/Manual reconciliation required/)).toBeVisible();await expect(page.getByText(/Brand: Test Brand/)).toContainText('Provider: Not recorded');await expect(page.getByRole('button',{name:/resend/i})).toHaveCount(0)
 })
 await t.test('templates create/edit, conflict and scoped role restriction',async()=>{
 await page.evaluate(()=>window.show('templates'));await page.getByLabel('Template name',{exact:true}).fill('Greeting');await page.getByLabel('Template subject',{exact:true}).fill('Hello');await page.getByLabel('Template body',{exact:true}).fill('Thank you');await page.getByRole('button',{name:'Create template'}).click();await expect(page.getByRole('status')).toContainText('Template saved')
 await page.getByRole('button',{name:'Edit Greeting'}).click();await expect(page.getByLabel('Template body',{exact:true})).toHaveValue('Thank you');await page.evaluate(()=>window.conflict=true);await page.getByRole('button',{name:'Save template changes'}).click();await expect(page.getByRole('alert')).toContainText('Conflict or access changed')
 await page.evaluate(()=>{window.conflict=false;window.show('templates','reviewer')});await expect(page.getByRole('button',{name:'Create template'})).toHaveCount(0)
 })
 await t.test('vacancy publication is one staff-controlled action',async()=>{
 await page.evaluate(()=>{window.calls=[];window.show('vacancies')});await page.getByRole('link',{name:/Engineer draft/}).click();await page.getByRole('button',{name:'Publish & open applications'}).click();await expect(page.getByText('Published and accepting applications.')).toBeVisible()
 assert.deepEqual(await page.evaluate(()=>window.calls.filter(c=>['save_requisition_review','publish_job_requisition','set_hiring_runtime_gate'].includes(c.name)).map(c=>c.name)),['save_requisition_review','publish_job_requisition','set_hiring_runtime_gate'])
 })
 await t.test('revocation confirmation, success, narrow capability and mobile layout',async()=>{
 await page.evaluate(()=>{window.calls=[];window.show('settings')});await page.getByText('Manage staff grants',{exact:true}).click();await page.getByRole('button',{name:'Revoke',exact:true}).click();assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.name==='revoke_workspace_grant').length),0);await page.getByRole('button',{name:'Revoke grant',exact:true}).click();await expect(page.getByRole('status')).toContainText('Administration saved successfully')
 await expect(page.getByText('Add draft requisition',{exact:true})).toHaveCount(0)
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
 })
 assert.deepEqual(errors,[])
 }finally{await browser?.close();await live.close();rmSync(cacheDir,{recursive:true,force:true})}
})
