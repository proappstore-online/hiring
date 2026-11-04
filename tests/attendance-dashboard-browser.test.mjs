import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { chromium, expect } from '@playwright/test'
const require = createRequire(new URL('../web/package.json', import.meta.url))
const { createServer } = await import(require.resolve('vite'))
const { default: react } = await import(require.resolve('@vitejs/plugin-react'))
const { default: tailwind } = await import(require.resolve('@tailwindcss/vite'))
const ts = require('typescript'), web = new URL('../web/', import.meta.url).pathname
const sdk = `export const initPro=()=>({auth:{user:{id:'owner'}},worker:{fetch:(...args)=>window.workerFetch(...args)},actions:{call:(...args)=>window.action(...args)}});`
const fixture = `import React from 'react';import {createRoot} from 'react-dom/client';import {BrowserRouter} from 'react-router-dom';import {AttendanceDashboard} from '/src/AttendanceDashboard.tsx';import {PrimaryNav} from '/src/PrimaryNav.tsx';import {attendanceSelection} from '/src/attendance-report.ts';import '/src/index.css';
window.calls=[];window.fail=false;window.blocked=true;window.empty=false;window.historyFail=false;
window.workerFetch=async()=>{if(window.blocked)return Response.json({error:'worker_disabled'},{status:403});return Response.json({configured:true,status:'connected',owner_active:true,connection_valid:true,account_email:'organizer@example.test',calendar_id:attendanceSelection.calendar_id})};
window.action=async(name,params)=>{window.calls.push({name,params});if(name==='list_attendance_check_history'){if(window.historyFail)throw Error('Unavailable');return {rows:window.empty?[]:[{event_id:'run-1',started_at:1793641500000,checked_at:1793641500000,observations:3,attended:1,errors:1,scheduled:0,superseded:0}]}};if(window.fail)throw Error('Unavailable');if(window.empty)return{rows:[]};const last=params.starts_at<Date.parse('2026-11-02T00:00:00+11:00');
const start=Date.parse(last?'2026-10-26T09:00:00+11:00':'2026-11-02T09:00:00+11:00');
const row={id:'a',application_id:'app-a',candidate_name:last?'Last week participant':'Ada Example',calendar_event_id:'morning',meeting_code:'abc-defg-hij',starts_at:start,ends_at:start+1800000,enabled:1,source_ready:1,identity_linked:1,status:'attended',duration_seconds:1250,first_join_at:start+60000,last_leave_at:start+1310000,error_code:null,checked_at:start+2700000,total_count:4};
return{rows:[row,{...row,id:'b',application_id:'app-b',candidate_name:'Noah Example',status:'not_observed',duration_seconds:0,first_join_at:null,last_leave_at:null},{...row,id:'c',application_id:'app-c',candidate_name:'Sam Example',status:'error',error_code:'google_auth',duration_seconds:0,first_join_at:null,last_leave_at:null},{...row,id:'d',application_id:'app-d',candidate_name:'Future Participant',calendar_event_id:'friday',starts_at:Date.parse('2026-11-06T09:00:00+11:00'),ends_at:Date.parse('2026-11-06T09:30:00+11:00'),status:null,checked_at:null,duration_seconds:null,first_join_at:null,last_leave_at:null}]}};
const scope={organization_id:'org',brand_id:'brand'};createRoot(document.getElementById('root')).render(<React.StrictMode><BrowserRouter><div className="mx-auto max-w-5xl p-4"><PrimaryNav role="owner" scope={scope}/><AttendanceDashboard scope={scope} canManage={true}/></div></BrowserRouter></React.StrictMode>);`

test('attendance dashboard shows evidence, failures, empty states and week selection on mobile and desktop', { timeout: 120000 }, async () => {
  const cache = mkdtempSync(join(tmpdir(), 'hiring-attendance-ui-'))
  const server = await createServer({ root: web, cacheDir: cache, configFile: false, plugins: [react(), tailwind(), {
    name: 'attendance-fixture', enforce: 'pre',
    resolveId(id) { if (id === '@proappstore/sdk') return '\0attendance-sdk'; if (id === '/fixture.jsx') return '\0attendance-fixture' },
    load(id) { if (id === '\0attendance-sdk') return sdk; if (id === '\0attendance-fixture') return ts.transpile(fixture, { jsx: ts.JsxEmit.React, module: ts.ModuleKind.ESNext }) },
    configureServer(s) { s.middlewares.use(async (req, res, next) => { if (req.headers.accept?.includes('text/html')) { res.setHeader('Content-Type', 'text/html'); res.end(await s.transformIndexHtml(req.url, '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/fixture.jsx"></script></body></html>')) } else next() }) },
  }], server: { host: '127.0.0.1', port: 0 } })
  await server.listen(); let browser
  try {
    browser = await chromium.launch()
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, timezoneId: 'America/Los_Angeles' })
    page.setDefaultTimeout(15000)
    await page.clock.setFixedTime(new Date('2026-11-05T03:00:00+11:00'))
    await page.goto(server.resolvedUrls.local[0] + 'recruiter/attendance', { timeout: 45000 })
    await expect(page.getByRole('heading', { level: 1, name: 'Attendance' })).toBeVisible()
    await expect(page.getByText('Attended · 20m 50s', { exact: true })).toBeVisible()
    await expect(page.getByText('Not observed · review needed', { exact: true })).toBeVisible()
    await expect(page.getByText('Check failed', { exact: true })).toBeVisible()
    await expect(page.getByText('Scheduled', { exact: true })).toBeVisible()
    await expect(page.getByText('Calendar service unavailable.', { exact: false })).toBeVisible()
    await expect(page.getByText('3 observations · 1 attended · 1 errors · 0 scheduled')).toBeVisible()
    assert.match(await page.getByRole('link', { name: 'Ada Example' }).getAttribute('href'), /organization_id=org&brand_id=brand&view=interview$/)
    const calls = await page.evaluate(() => window.calls)
    assert.ok(calls.every(c => c.params.organization_id === 'org' && c.params.brand_id === 'brand'))
    assert.ok(calls.every(c => c.params.series_id === '7ggsell6kej1abqp9v030et2ja' && c.params.second_series_id === '3c69fv935ibfl22p9dpqufapum'))
    mkdirSync('/tmp/hiring-attendance-visuals', { recursive: true })
    for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: 1000 })
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      assert.equal(await page.getByRole('heading', { level: 1 }).count(), 1)
      await page.screenshot({ path: '/tmp/hiring-attendance-visuals/attendance-' + width + '.png', fullPage: true })
    }
    await page.getByRole('button', { name: 'Toggle primary navigation' }).click()
    await expect(page.getByRole('link', { name: 'Attendance', exact: true }).filter({ visible: true })).toHaveAttribute('aria-current', 'page')
    await page.keyboard.press('Escape')
    await page.getByLabel('Report period').selectOption('last')
    await expect(page.getByRole('link', { name: 'Last week participant' })).toBeVisible()
    await expect(page.getByText('Outside the automatic seven-day check window.', { exact: false }).first()).toBeVisible()
    await page.getByLabel('Report period').selectOption('this')
    await expect(page.getByRole('link', { name: 'Ada Example' })).toBeVisible()
    await page.evaluate(() => { window.empty = true; window.blocked = false })
    await page.getByRole('button', { name: 'Refresh attendance' }).click()
    await expect(page.getByText('No tracked participants found', { exact: false })).toBeVisible()
    await expect(page.getByText('FreeAppStore calendar connection verified.')).toBeVisible()
    await expect(page.getByText('No attendance checks recorded for this period.')).toBeVisible()
    await page.evaluate(() => { window.fail = true; window.historyFail = true })
    await page.getByRole('button', { name: 'Refresh attendance' }).click()
    await expect(page.getByText('Attendance records could not be loaded.', { exact: false })).toBeVisible()
    await expect(page.getByText('Check history could not be loaded.')).toBeVisible()
    await expect(page.getByText('No tracked participants found', { exact: false })).toHaveCount(0)
    await expect(page.getByText('No attendance checks recorded for this period.')).toHaveCount(0)
    assert.equal(await page.evaluate(() => window.calls.some(c => !c.name.startsWith('list_'))), false)
  } finally { await browser?.close(); await server.close(); rmSync(cache, { recursive: true, force: true }) }
})
