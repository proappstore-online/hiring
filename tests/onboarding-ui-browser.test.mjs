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
const ts = require('typescript')
const web = new URL('../web/', import.meta.url).pathname
const fixture = `import React from 'react';import{createRoot}from'react-dom/client';import{OnboardingPolicySettings,CandidateOnboardingChecklist}from'/src/OnboardingChecklist.tsx';
window.calls=[];window.policies=[];window.snapshot=null;window.stepRows=[];
window.read=async(name,p)=>{window.calls.push({name,p});if(name==='list_onboarding_policies'||name==='get_current_onboarding_policy')return window.policies.slice(0,1);if(name==='get_onboarding_snapshot')return window.snapshot?[window.snapshot]:[];if(name==='list_onboarding_steps')return window.stepRows;return []};
window.write=async(name,p)=>{window.calls.push({name,p});if(name==='publish_onboarding_policy'){window.policies=[{version:p.expected_version+1,steps_json:p.steps_json,invitation_mode:p.invitation_mode,candidate_note_mode:p.candidate_note_mode,published_at:Date.now()},...window.policies]}if(name==='create_onboarding_snapshot'){window.snapshot={policy_version:p.policy_version,invitation_mode:window.policies[0].invitation_mode,candidate_note_mode:window.policies[0].candidate_note_mode};window.stepRows=JSON.parse(window.policies[0].steps_json).map((s,i)=>({step_key:s.key,label:s.label,field_type:s.type,required:s.required?1:0,instructions:s.instructions,position:i,policy_version:p.policy_version,revision:null,status:null,value_text:null,comment:null,evidence:null,verifier_user_id:null,verified_at:null}))}if(name==='record_onboarding_step'){window.stepRows=window.stepRows.map(s=>s.step_key===p.step_key?{...s,revision:p.revision,status:p.status,value_text:p.value_text,comment:p.comment,evidence:p.evidence,verifier_user_id:p.status==='verified'?'recruiter':null,verified_at:p.status==='verified'?Date.now():null}:s)}};
const scope={organization_id:'org',brand_id:'brand'};const app={id:'app',requisition_id:'req',stage:'onboarding',version:4};const root=createRoot(document.getElementById('root'));window.render=(key)=>root.render(<><OnboardingPolicySettings scope={scope}/><CandidateOnboardingChecklist key={key} a={app} scope={scope} manage={true} onChanged={()=>{}}/></>);window.render('initial');`

test('owner publishes typed criteria and recruiter verifies a pinned candidate checklist', async () => {
  const cacheDir = mkdtempSync(join(tmpdir(), 'hiring-onboarding-ui-'))
  const server = await createServer({ root: web, cacheDir, configFile: false, plugins: [react(), {
    name: 'onboarding-fixture', enforce: 'pre',
    resolveId(id) { if (id === '/fixture.jsx') return '\0onboarding-fixture.jsx' },
    load(id) { if (id === '\0onboarding-fixture.jsx') return ts.transpile(fixture, { jsx: ts.JsxEmit.React, module: ts.ModuleKind.ESNext }); if (id === web + 'src/api.ts') return 'export const read=(...args)=>window.read(...args);export const write=(...args)=>window.write(...args);export const id=()=>crypto.randomUUID();' },
    configureServer(s) { s.middlewares.use(async (req, res, next) => { if (req.headers.accept?.includes('text/html')) { res.setHeader('Content-Type', 'text/html'); res.end(await s.transformIndexHtml(req.url, '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/fixture.jsx"></script></body></html>')) } else next() }) },
  }], server: { host: '127.0.0.1', port: 0 } })
  let browser
  try {
    await server.listen(); browser = await chromium.launch()
    const page = await browser.newPage({ viewport: { width: 375, height: 812 } })
    await page.goto(server.resolvedUrls.local[0])
    await page.getByText('Onboarding criteria', { exact: true }).click()
    await page.getByLabel('Step 1 key').fill('identity')
    await page.getByLabel('Step 1 label').fill('Identity confirmed')
    await page.getByLabel('Step 1 field type').selectOption('boolean')
    await page.getByLabel('Step 1 instructions').fill('Check the identity record')
    await page.getByRole('button', { name: 'Publish version 1' }).click()
    await expect(page.getByText('Onboarding policy published. Existing candidate snapshots retain their version.')).toBeVisible()
    let published = await page.evaluate(() => window.calls.find(c => c.name === 'publish_onboarding_policy').p)
    assert.equal(published.invitation_mode, 'off'); assert.equal(published.candidate_note_mode, 'off')
    assert.deepEqual(JSON.parse(published.steps_json), [{ key: 'identity', label: 'Identity confirmed', type: 'boolean', required: true, instructions: 'Check the identity record' }])
    await page.getByRole('button', { name: 'Edit from current version' }).click()
    await page.getByLabel('Interns invitation handling').selectOption('manual')
    await page.getByLabel('Candidate note handling').selectOption('manual')
    await page.getByRole('button', { name: 'Publish version 2' }).click()
    await expect(page.getByText('Current version 2', { exact: false })).toBeVisible()
    await page.evaluate(() => window.render('candidate-after-policy'))
    await page.getByRole('button', { name: 'Pin checklist to this candidate' }).click()
    await expect(page.getByText('Required steps verified: 0 of 1.', { exact: false })).toBeVisible()
    await expect(page.getByText('Manual Interns invitation is enabled for this candidate.')).toBeVisible()
    await page.getByText('Record Identity confirmed').click()
    await page.getByRole('combobox', { name: 'Status' }).selectOption('verified')
    await page.getByRole('combobox', { name: 'Value (boolean)' }).selectOption('true')
    await page.getByRole('button', { name: 'Save Identity confirmed' }).click()
    await expect(page.getByText('A verified step needs a value and verification evidence.')).toBeVisible()
    assert.equal(await page.evaluate(() => window.calls.filter(c => c.name === 'record_onboarding_step').length), 0)
    await page.getByLabel('Verification evidence (required when verified)').fill('Identity record #3')
    await page.getByRole('button', { name: 'Save Identity confirmed' }).click()
    await expect(page.getByText('Required steps verified: 1 of 1.', { exact: false })).toBeVisible()
    await expect(page.getByText(/verified by recruiter/)).toBeVisible()
    const saved = await page.evaluate(() => window.calls.find(c => c.name === 'record_onboarding_step').p)
    assert.equal(saved.policy_version, 2); assert.equal(saved.revision, 1); assert.equal(saved.expected_application_version, 4); assert.equal(saved.value_text, 'true')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  } finally { await browser?.close(); await server.close(); rmSync(cacheDir, { recursive: true, force: true }) }
})
