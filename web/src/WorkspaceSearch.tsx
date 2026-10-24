import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { app, type Scope } from './api'
import { searchRecords, SearchError } from '../../scripts/search.mjs'
import { recruiterApplicationUrl } from './routes'
import { button, field, panel } from './ui'
import { Interviews } from './Interviews'

type Result = { id: string; full_name?: string; candidate_id?: string; stage?: string; created_at: number }
/** Sensitive search stays in component memory. Submit explicitly to avoid a
 * request for every keystroke; scope/account changes unmount and erase state. */
export function WorkspaceSearch({ scope, reviewer = false }: { scope: Scope; reviewer?: boolean }) {
  const [kind,setKind]=useState('applications')
  const [q,setQ]=useState('')
  const [rows,setRows]=useState<Result[]>([])
  const [cursor,setCursor]=useState<string|null>(null)
  const [submitted,setSubmitted]=useState<{kind:string;q:string}|null>(null)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [selection,setSelection]=useState<Result|null>(null)
  const sequence=useRef(0)
  useEffect(()=>()=>{sequence.current++},[])
  const reset=()=>{sequence.current++;setRows([]);setCursor(null);setSubmitted(null);setSelection(null);setError('');setBusy(false)}
  async function load(next:string|null=null) {
    const current=++sequence.current
    const request=next&&submitted?submitted:{kind,q}
    setBusy(true);setError('');setRows([]);setSelection(null);setCursor(null)
    try {
      const result=await searchRecords((name,params)=>app.actions.call(name,params),'search_'+request.kind,{...scope,q:request.q,limit:20,cursor:next})
      if(current===sequence.current){setRows(result.rows as Result[]);setCursor(result.next_cursor);setSubmitted(request)}
    }catch(e){if(current===sequence.current)setError(e instanceof SearchError?e.message:'Search unavailable. Refresh and try again.')}
    finally{if(current===sequence.current)setBusy(false)}
  }
  async function open(row:Result) {
    const current=++sequence.current;setBusy(true);setError('');setSelection(null)
    try {
      const result=await searchRecords((name,params)=>app.actions.call(name,params),'get_search_'+(kind==='candidates'?'candidate':'application'),{...scope,id:row.id})
      if(current===sequence.current){setSelection(result.rows[0] as Result??null);if(!result.rows.length){setRows([]);setCursor(null);setError('Record unavailable.')}}
    }catch(e){if(current===sequence.current){setRows([]);setCursor(null);setError(e instanceof SearchError?e.message:'Search unavailable. Refresh and try again.')}}
    finally{if(current===sequence.current)setBusy(false)}
  }
  return <section className={panel} aria-labelledby="workspace-search-title">
    <h2 id="workspace-search-title" className="text-lg font-semibold">Search workspace records</h2>
    <form className="grid gap-3 mt-3" onSubmit={event=>{event.preventDefault();void load()}}>
      <label>Record type<select className={field} value={kind} onChange={event=>{reset();setKind(event.target.value)}}><option value="applications">Applications</option><option value="candidates">Candidates</option></select></label>
      <label>Candidate name<input className={field} type="search" maxLength={200} value={q} onChange={event=>{reset();setQ(event.target.value)}} /></label>
      <p className="text-sm">Search your current grants and interview assignments. Names stay out of links. Up to 20 records per page.</p>
      <button className={button} disabled={busy} type="submit">Search records</button>
    </form>
    {busy&&<p role="status">Searching…</p>}{error&&<p role="alert">{error}</p>}
    {!busy&&submitted&&!error&&<p role="status">{rows.length} records on this page.</p>}
    <ul className="mt-3 space-y-2">{rows.map(row=><li key={row.id}><button className="underline min-h-[44px]" disabled={busy} onClick={()=>void open(row)}>{row.full_name??`Application ${row.id}`}</button>{row.stage&&<span> · {row.stage}</span>}</li>)}</ul>
    {cursor&&!busy&&<button className={button} onClick={()=>void load(cursor)}>Next search page</button>}
    {selection&&<div role="status" className="mt-3">{selection.full_name??`Application ${selection.id}`} · Record access checked.{kind==='applications'&&!reviewer&&<Link className="ml-2 underline" to={recruiterApplicationUrl(selection.id,scope)}>Open application</Link>}{kind==='applications'&&reviewer&&<Interviews scope={scope} applicationId={selection.id} />}</div>}
  </section>
}
