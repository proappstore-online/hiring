import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,mkdirSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createRequire} from 'node:module'
import {chromium,expect} from '@playwright/test'
const require=createRequire(new URL('../web/package.json',import.meta.url))
const {createServer}=await import(require.resolve('vite'))
const {default:react}=await import(require.resolve('@vitejs/plugin-react'))
const {default:tailwind}=await import(require.resolve('@tailwindcss/vite'))
const ts=require('typescript'),web=new URL('../web/',import.meta.url).pathname
const transpile=s=>ts.transpile(s,{jsx:ts.JsxEmit.React,module:ts.ModuleKind.ESNext})
const sdk=`export const initPro=()=>({auth:{user:{id:'owner'}},worker:{fetch:(...args)=>window.workerFetch(...args)},actions:{call:(...args)=>window.action(...args)}});`
const fixture=`import React from 'react';import {createRoot} from 'react-dom/client';import {BrowserRouter} from 'react-router-dom';import {GoogleCalendarSettings,MeetingAttendance,GoogleCalendarCallback} from '/src/GoogleCalendar.tsx';import '/src/index.css';
window.calls=[];window.accountConnected=false;window.connected=false;window.selected='';window.version=0;window.records=[];
window.workerFetch=async(path,init={})=>{const body=init.body?JSON.parse(init.body):null;window.calls.push({path,body});let result={};
if(path.startsWith('/google/status'))result={status:window.connected?'connected':'disconnected',account_email:window.connected?'organizer@example.com':null,calendar_id:window.selected,version:window.version,configured:true,owner_active:true,can_manage:true,account_connected:window.accountConnected,available_account_email:window.accountConnected?'organizer@example.com':null,connection_valid:window.connected};
else if(path==='/google/start')result={authorization_url:'https://accounts.google.com/o/oauth2/v2/auth?state=synthetic'};
else if(path.startsWith('/google/calendars'))result={calendars:[{id:'recruiting',name:'Recruiting',primary:false}]};
else if(path==='/google/select'){window.connected=true;window.selected=body.calendar_id;window.version++;result={ok:true}};
if(path==='/google/disconnect'){window.connected=false;window.selected='';window.version++;result={ok:true}};
if(path.startsWith('/google/events'))result={events:[{id:'event-1',title:'Working interview',starts_at:1793750400000,ends_at:1793752200000,meeting_code:'abc-defg-hij'}]};
if(path==='/google/track'){window.records=[{id:'target',version:1,kind:'working_interview',interview_id:null,meeting_code:'abc-defg-hij',starts_at:1793750400000,ends_at:1793752200000,configured_starts_at:1793750400000,configured_ends_at:1793752200000,source_ready:1,google_user_id:body.google_user_id,calendar_id:'recruiting',calendar_event_id:'event-1',enabled:1,latest_check:null}];result={ok:true}};
if(path==='/google/complete'&&location.pathname.includes('unavailable'))return Response.json({error:'google_unavailable'},{status:502});
if(path==='/google/complete')result={return_to:'/recruiter/organizations/org/brands/brand/settings'};
return Response.json(result)};
window.action=async(name,params)=>{window.calls.push({name,params});if(name==='list_meeting_attendance')return{rows:window.records};if(name==='configure_meeting_attendance'){window.records[0].enabled=0;return{results:[{meta:{changes:1}}]}}return{rows:[]}};
createRoot(document.getElementById('root')).render(<React.StrictMode><BrowserRouter>{location.pathname.includes('callback')?<GoogleCalendarCallback/>:<main className="mx-auto max-w-3xl p-4"><h1>Calendar settings</h1><GoogleCalendarSettings scope={{organization_id:'org',brand_id:'brand'}}/><MeetingAttendance scope={{organization_id:'org',brand_id:'brand'}} applicationId="application"/></main>}</BrowserRouter></React.StrictMode>);`

test('Google Calendar controls connect, select, track, pause and disconnect with responsive layout',{timeout:120000},async()=>{
  const cache=mkdtempSync(join(tmpdir(),'hiring-calendar-ui-'))
  const server=await createServer({root:web,cacheDir:cache,configFile:false,plugins:[react(),tailwind(),{name:'calendar-fixture',enforce:'pre',resolveId(id){if(id==='@proappstore/sdk')return '\0calendar-sdk';if(id==='/fixture.jsx')return '\0calendar-fixture'},load(id){if(id==='\0calendar-sdk')return sdk;if(id==='\0calendar-fixture')return transpile(fixture)},configureServer(s){s.middlewares.use(async(req,res,next)=>{if(req.headers.accept?.includes('text/html')){res.setHeader('Content-Type','text/html');res.end(await s.transformIndexHtml(req.url,'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/fixture.jsx"></script></body></html>'))}else next()})}}],server:{host:'127.0.0.1',port:0}})
  await server.listen();let browser
  try{
    browser=await chromium.launch();const page=await browser.newPage({viewport:{width:375,height:812},locale:'en-AU',timezoneId:'Australia/Sydney'}),base=server.resolvedUrls.local[0]
    page.setDefaultTimeout(10000)
    page.setDefaultNavigationTimeout(45000)
    await page.route('https://accounts.google.com/**',route=>route.fulfill({body:'Mock Google consent'}))
    await page.goto(base)
    await page.getByText('Google Calendar',{exact:true}).click()
    await page.getByRole('button',{name:'Connect Google Calendar',exact:true}).click()
    await expect(page).toHaveURL(/https:\/\/accounts.google.com\/o\/oauth2\/v2\/auth/)
    await page.goto(base)
    await page.evaluate(()=>{window.accountConnected=true})
    await page.getByText('Google Calendar',{exact:true}).click()
    await expect(page.getByText('Available Google account: organizer@example.com.',{exact:false})).toBeVisible()
    await expect(page.getByText('Google account connected. Choose a calendar below to finish setup.')).toBeVisible()
    await page.getByLabel('Calendar',{exact:true}).selectOption('recruiting')
    await page.getByRole('button',{name:'Save calendar',exact:true}).click()
    await expect(page.getByRole('button',{name:'Save calendar',exact:true})).toBeDisabled()
    await page.getByText('Meeting attendance',{exact:true}).click()
    await page.getByRole('button',{name:'Choose meeting from Google Calendar'}).click()
    await page.getByLabel('Meeting',{exact:true}).selectOption('event-1')
    await page.getByRole('button',{name:'Track meeting attendance'}).click()
    await expect(page.getByText('Awaiting attendance check')).toBeVisible()
    await page.getByRole('button',{name:'Pause tracking'}).click()
    await expect(page.getByText('Tracking paused')).toBeVisible()
    const track=await page.evaluate(()=>window.calls.find(c=>c.path==='/google/track').body)
    assert.equal(track.organization_id,'org');assert.equal(track.brand_id,'brand');assert.equal(track.application_id,'application')
    mkdirSync('/tmp/hiring-calendar-visuals',{recursive:true})
    for(const width of [375,1280]){
      await page.setViewportSize({width,height:900})
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
      await page.screenshot({path:'/tmp/hiring-calendar-visuals/calendar-'+width+'.png',fullPage:true})
    }
    await page.getByRole('button',{name:'Disconnect Google Calendar',exact:true}).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByRole('button',{name:'Cancel',exact:true}).click()
    await expect(page.getByText('Connected as organizer@example.com')).toBeVisible()
    await page.getByRole('button',{name:'Disconnect Google Calendar',exact:true}).click()
    await page.getByRole('button',{name:'Disconnect',exact:true}).click()
    await expect(page.getByRole('button',{name:'Connect Google Calendar',exact:true})).toBeVisible()
    await expect(page.getByLabel('Calendar',{exact:true})).toBeVisible()
    assert.equal(await page.evaluate(()=>window.accountConnected),true)
    await page.goto(base+'callback?code=one-use&state=synthetic-state')
    await expect(page).toHaveURL(/\/recruiter\/organizations\/org\/brands\/brand\/settings$/)
    assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.path==='/google/complete').length),1)
    assert.doesNotMatch(page.url(),/code=|state=/)
    await page.goto(base+'callback-unavailable?code=one-use&state=synthetic-state')
    await expect(page.getByRole('alert')).toContainText('start Connect Google Calendar again')
    assert.doesNotMatch(page.url(),/code=|state=/)
    assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.path==='/google/complete').length),1)
  }finally{await browser?.close();await server.close();rmSync(cache,{recursive:true,force:true})}
})
