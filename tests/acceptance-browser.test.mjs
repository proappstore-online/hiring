import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { chromium, expect } from '@playwright/test'
const require = createRequire(new URL('../web/package.json', import.meta.url))
const { createServer } = await import(require.resolve('vite'))
const { default: react } = await import(require.resolve('@vitejs/plugin-react'))
const web = new URL('../web/', import.meta.url).pathname

test('acceptance UI requires explicit evidence and confirmation, preserves operation on uncertain retry',async()=>{
 const cacheDir=mkdtempSync(join(tmpdir(),'hiring-acceptance-'))
 const live=await createServer({root:web,cacheDir,configFile:false,optimizeDeps:{entries:[]},plugins:[react(),{
 name:'acceptance-fixture',enforce:'pre',resolveId(id){if(id==='/fixture.jsx')return '\0acceptance-fixture.jsx'},
 load(id){
 if(id==='\0acceptance-fixture.jsx')return `import React from 'react';import{createRoot}from'react-dom/client';import{DecisionsOffers}from'/src/DecisionsOffers.tsx';window.calls=[];window.passkeys=0;window.uncertain=true;window.offerStatus='approved';window.compensation='paid';createRoot(document.getElementById('root')).render(React.createElement(DecisionsOffers,{scope:{organization_id:'org',brand_id:'brand'},application:{id:'app',stage:'offered',version:7,requisition_id:'req'},onChanged:()=>{}}));`;
 if(id===web+'src/api.ts')return `export const id=()=>crypto.randomUUID();export const interviewScope=(s,a)=>({tenant_id:s.organization_id,brand_id:s.brand_id,application_id:a});export const read=async n=>n==='get_offer'?[{id:'offer',status:window.offerStatus,current_version:1,lock_version:3,terms_json:JSON.stringify({compensation_type:window.compensation,subject:'Terms',body:'Paid terms'}),events_json:'[]'}]:[];export const write=async(name,params)=>{window.calls.push({name,params});if(window.uncertain)throw Error('uncertain')};`;
 if(id===web+'src/passkey.ts')return `export const verifyPublicationPasskey=async()=>{window.passkeys++};export const registerPublicationPasskey=async()=>{};`;
 },configureServer(s){s.middlewares.use(async(req,res,next)=>{if(req.url==='/acceptance-test'){res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(req.url,'<html><body><div id="root"></div><script type="module" src="/fixture.jsx"></script></body></html>'))}else next()})}
 }],server:{host:'127.0.0.1',port:0}})
 await live.listen();let browser
 try{
 browser=await chromium.launch();const page=await browser.newPage();await page.goto(live.resolvedUrls.local[0]+'acceptance-test')
 await page.getByText('Offer management', { exact: false }).click()
 const button=page.getByRole('button',{name:'Record acceptance',exact:true})
 await expect(button).toBeDisabled()
 await page.getByLabel('Candidate acceptance evidence').fill('Candidate signed the exact offer')
 await button.click();await page.getByRole('dialog').getByRole('button',{name:'Record acceptance',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible()
 await page.evaluate(()=>window.uncertain=false);await button.click();await page.getByRole('dialog').getByRole('button',{name:'Record acceptance',exact:true}).click()
 await expect.poll(()=>page.evaluate(()=>window.calls.length)).toBe(2)
 const result=await page.evaluate(()=>({calls:window.calls}));assert.equal(result.calls[0].name,'record_acceptance');assert.equal(result.calls[0].params.expected_version,7);assert.equal(result.calls[0].params.acceptance_evidence,'Candidate signed the exact offer');assert.equal(result.calls[0].params.operation_id,result.calls[1].params.operation_id)
 await page.evaluate(()=>window.offerStatus='draft');await page.getByRole('button',{name:'Refresh',exact:true}).click();await expect(button).toHaveCount(0)
 await page.evaluate(()=>{window.offerStatus='approved';window.compensation='unpaid'});await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByText('Offer management · approved',{exact:true}).click();await expect(button).toBeVisible()
 }finally{await browser?.close();await live.close();rmSync(cacheDir,{recursive:true,force:true})}
})
