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

test('activity timeline appends older pages and handles retry, repeated clicks and scope changes', async () => {
  const cacheDir = mkdtempSync(join(tmpdir(), 'hiring-timeline-vite-'))
  const server = await createServer({ root: web, cacheDir, configFile: false, plugins: [react(), {
    name: 'timeline-fixture', enforce: 'pre',
    resolveId(id) { if (id === '/fixture.jsx') return '\0timeline-fixture.jsx' },
    load(id) {
      if (id === web + 'src/api.ts') return 'export const read = (...args) => window.read(...args)'
      if (id === '\0timeline-fixture.jsx') return ts.transpile(`import React from 'react'; import { createRoot } from 'react-dom/client'; import { ActivityTimeline } from '/src/ActivityTimeline.tsx';
        window.calls=[]; window.pending=[];
        window.read=(name,params)=>{window.calls.push({name,params});return new Promise((resolve,reject)=>window.pending.push({resolve,reject}))};
        const root=createRoot(document.getElementById('root'));
        window.mount=(organization_id,brand_id,candidateId)=>root.render(<ActivityTimeline key={organization_id+':'+brand_id+':'+candidateId} scope={{organization_id,brand_id}} candidateId={candidateId}/>);
        window.mount('org','brand','candidate');`, { jsx: ts.JsxEmit.React, module: ts.ModuleKind.ESNext })
    },
    configureServer(s) { s.middlewares.use(async (req, res, next) => {
      if (!req.headers.accept?.includes('text/html')) return next()
      res.setHeader('Content-Type', 'text/html')
      res.end(await s.transformIndexHtml(req.url, '<html><body><div id="root"></div><script type="module" src="/fixture.jsx"></script></body></html>'))
    }) },
  }], server: { host: '127.0.0.1', port: 0 } })
  await server.listen()
  let browser
  try {
    browser = await chromium.launch()
    const page = await browser.newPage()
    await page.goto(server.resolvedUrls.local[0])
    await expect(page.getByText('Loading timeline…')).toBeVisible()
    const firstPage = Array.from({ length: 50 }, (_, i) => ({ id: `row-${String(100 - i).padStart(3, '0')}`, ts: 1_793_246_400_000, source: 'external', kind: 'linkedin', actor: 'assistant', summary: `Entry ${i}`, operation_id: null }))
    await page.evaluate(rows => window.pending.shift().resolve(rows), firstPage)
    await expect(page.getByRole('button', { name: 'Load older activity' })).toBeVisible()
    await page.evaluate(() => { const button = [...document.querySelectorAll('button')].find(node => node.textContent === 'Load older activity'); button.click(); button.click() })
    assert.equal(await page.evaluate(() => window.calls.length), 2)
    assert.deepEqual(await page.evaluate(() => window.calls[1].params), {
      organization_id: 'org', brand_id: 'brand', candidate_id: 'candidate', limit: 50,
      before_ts: 1_793_246_400_000, before_id: 'row-051', before_source: 'external',
    })
    await page.evaluate(() => window.pending.shift().reject(Error('interrupted')))
    await expect(page.getByRole('button', { name: 'Retry timeline' })).toBeVisible()
    await expect(page.getByText('Entry 0')).toBeVisible()
    await page.getByRole('button', { name: 'Retry timeline' }).click()
    assert.equal(await page.evaluate(() => window.calls.length), 3)
    await page.evaluate(() => window.pending.shift().resolve([{ id: 'row-050', ts: 1_793_246_400_000, source: 'external', kind: 'discord', actor: null, summary: 'Older entry', operation_id: null }]))
    await expect(page.getByText('Older entry')).toBeVisible()
    await expect(page.getByText('Entry 0')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Load older activity' })).toHaveCount(0)

    await page.evaluate(() => window.mount('other', 'brand-2', 'candidate-2'))
    await expect(page.getByText('Entry 0')).toHaveCount(0)
    assert.deepEqual(await page.evaluate(() => window.calls.at(-1).params), { organization_id: 'other', brand_id: 'brand-2', candidate_id: 'candidate-2', limit: 50 })
    await page.evaluate(() => window.pending.shift().resolve([]))
    await expect(page.getByText('No candidate-linked timeline records yet.')).toBeVisible()

    await page.evaluate(() => window.mount('org', 'brand'))
    await expect(page.getByRole('heading', { name: 'Organization activity timeline' })).toBeVisible()
    assert.deepEqual(await page.evaluate(() => window.calls.at(-1).params), { organization_id: 'org', brand_id: 'brand', org_id: 'org', limit: 50 })
    await page.evaluate(() => window.pending.shift().resolve([{ id: 'org-entry', ts: 1_793_246_400_000, source: 'journal', kind: 'journal', actor: 'owner', summary: 'Organization decision', recorded_at: 1_794_000_000_000, entry_type: 'decision', claimed_performer: 'assistant', operation_id: 'org-entry' }]))
    await expect(page.getByText('Organization decision')).toBeVisible()
    await expect(page.getByText('Claimed performer:')).toBeVisible()
    await page.evaluate(() => window.mount('late', 'brand'))
    await expect(page.getByText('Organization decision')).toHaveCount(0)
    await page.evaluate(() => window.mount('other', 'other'))
    await expect(page.getByRole('heading', { name: 'Organization activity timeline' })).toBeVisible()
    await page.evaluate(() => window.pending.shift().resolve([{ id: 'old-org', ts: 1_793_246_400_000, source: 'journal', kind: 'journal', actor: 'owner', summary: 'Old org decision', recorded_at: 1_794_000_000_000, entry_type: 'decision', claimed_performer: 'assistant', operation_id: 'old-org' }]))
    await expect(page.getByText('Old org decision')).toHaveCount(0)
    await page.evaluate(() => window.pending.shift().resolve([]))
    await expect(page.getByText('No timeline records for this organization and brand yet.')).toBeVisible()
  } finally {
    await browser?.close()
    await server.close()
    rmSync(cacheDir, { recursive: true, force: true })
  }
})
