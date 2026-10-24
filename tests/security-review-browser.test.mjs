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
const web = new URL('../web/', import.meta.url).pathname

test('attachment scope changes discard filenames and late mutation results; keyboard deletion has a unique accessible name', async () => {
  const cacheDir = mkdtempSync(join(tmpdir(), 'hiring-security-'))
  const server = await createServer({ root: web, cacheDir, configFile: false, optimizeDeps: { entries: [] }, plugins: [react(), {
    name: 'security-review-fixture', enforce: 'pre',
    resolveId(id) { if (id === '/fixture.jsx') return '\0security-fixture.jsx' },
    load(id) {
      if (id === '\0security-fixture.jsx') return `import React from 'react';import{createRoot}from'react-dom/client';import{Attachments}from'/src/attachments.tsx';
      const root=createRoot(document.getElementById('root'));window.calls=[];window.deletes=[];window.pending=[];window.hold=false;
      window.row=(name)=>({id:name,filename:name+'.pdf',size_bytes:10,scan_state:'pending',uploader_user_id:'candidate'});
      window.render=(brand='a',user='candidate')=>root.render(React.createElement(Attachments,{scope:{organization_id:'org',brand_id:brand},applicationId:'app-'+brand,userId:user}));window.render();`
      if (id === web + 'src/api.ts') return `export const id=()=>crypto.randomUUID();export const read=async(name,p)=>{window.calls.push(p);if(window.hold)return new Promise(resolve=>window.pending.push({p,resolve}));return [window.row(p.brand_id)]};export const write=async(name,p)=>{window.deletes.push(p);};export const app={storage:{delete:async()=>new Promise(resolve=>window.finishDelete=resolve)}};`
    },
    configureServer(s) { s.middlewares.use(async (req,res,next) => { if(req.url === '/review') { res.setHeader('Content-Type','text/html'); res.end(await s.transformIndexHtml(req.url,'<html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/fixture.jsx"></script></body></html>')) } else next() }) }
  }], server: { host:'127.0.0.1',port:0 } })
  await server.listen(); let browser
  try {
    browser=await chromium.launch();const page=await browser.newPage({viewport:{width:375,height:812}})
    await page.goto(server.resolvedUrls.local[0]+'review')
    const region=page.getByRole('region',{name:'Private attachments'})
    const remove=page.getByRole('button',{name:'Delete attachment a.pdf',exact:true})
    await expect(remove).toBeVisible()
    // Accessibility-tree evidence, not a claim that a human used a screen reader.
    assert.match(await region.ariaSnapshot(), /button "Delete attachment a.pdf"/)
    await remove.focus();await page.keyboard.press('Enter')
    await expect.poll(()=>page.evaluate(()=>window.deletes.length)).toBe(1)
    await page.evaluate(()=>{window.hold=true;window.render('b')})
    await expect(page.getByText(/a.pdf/)).toHaveCount(0)
    await expect.poll(()=>page.evaluate(()=>window.pending.length)).toBe(1)
    // Complete A's deletion after moving to B, then return its stale refresh last.
    await page.evaluate(()=>window.finishDelete())
    await expect.poll(()=>page.evaluate(()=>window.pending.length)).toBe(2)
    await page.evaluate(()=>window.pending.find(x=>x.p.brand_id==='b').resolve([window.row('b')]))
    await expect(page.getByRole('button',{name:'Delete attachment b.pdf',exact:true})).toBeEnabled()
    await page.evaluate(()=>window.pending.find(x=>x.p.brand_id==='a').resolve([window.row('secret-a')]))
    await expect(page.getByText(/secret-a.pdf/)).toHaveCount(0)
    await expect(page.getByRole('button',{name:'Delete attachment b.pdf',exact:true})).toBeEnabled()
    assert.equal(await page.evaluate(()=>window.deletes[0].brand_id),'a')
    // A change of signed-in principal must clear the same scoped list too.
    await page.evaluate(()=>window.render('b','other-candidate'))
    await expect(page.getByText(/b.pdf/)).toHaveCount(0)
    await expect.poll(()=>page.evaluate(()=>window.pending.length)).toBe(3)
    await page.evaluate(()=>window.pending[2].resolve([]))
    await expect(page.getByRole('button',{name:/Delete attachment/})).toHaveCount(0)
  } finally { await browser?.close();await server.close();rmSync(cacheDir,{recursive:true,force:true}) }
})
