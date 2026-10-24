import { useEffect, useRef, useState } from 'react'
import { app, id, read, type Scope } from './api'
import { retrieveCandidateExport } from '../../scripts/privacy.mjs'
import { registerPublicationPasskey, verifyPublicationPasskey } from './passkey'
import { button, field, panel } from './ui'

type RightsEvent = { id: string; request_id: string; request_type: string; status: string; version: number; owner_user_id: string; deadline_at: number; proof_reference: string | null; decision_reference: string | null }
export function PrivacyOperations({ scope }: { scope: Scope }) {
  const active = useRef(true)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  const [application, setApplication] = useState('')
  const [request, setRequest] = useState<string>(id)
  const [kind, setKind] = useState('export')
  const [deadline, setDeadline] = useState('')
  const [proof, setProof] = useState('')
  const [decision, setDecision] = useState('')
  const [latest, setLatest] = useState<RightsEvent>()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const pending = useRef<{ key: string; operation: string } | null>(null)
  const handle = useRef<string | null>(null)
  const params = { ...scope, application_id: application.trim() }
  async function history() {
    const rows = await read<RightsEvent>('list_candidate_rights_events', { ...params, rights_request_id: request.trim() })
    return rows.filter(row => row.request_id === request.trim()).sort((a,b) => b.version-a.version)[0]
  }
  async function run(action: () => Promise<void>) {
    setBusy(true); setMessage('')
    try { await action() } catch (e) { setMessage(e instanceof Error ? e.message : 'Could not confirm the operation. Reload before retrying.') }
    finally { setBusy(false) }
  }
  function reset() { setLatest(undefined); setMessage(''); handle.current=null; pending.current=null }
  async function record(status: string) {
    await verifyPublicationPasskey()
    const values = { ...params, request_id: request.trim(), request_type: latest?.request_type ?? kind, expected_version: latest?.version ?? 0, status, owner_user_id: latest?.owner_user_id ?? app.auth.user?.id, deadline_at: latest?.deadline_at ?? Date.parse(deadline), proof_reference: proof.trim() || latest?.proof_reference || null, decision_reference: decision.trim() || null }
    const key=JSON.stringify(values)
    if (pending.current?.key!==key) pending.current={key,operation:id()}
    const operation=pending.current.operation
    try { await app.actions.call('record_candidate_rights_event', { ...values, operation_id:operation }) } catch { /* Read durable history after an uncertain response. */ }
    const current=await history();setLatest(current)
    if (current?.id!==operation) throw new Error('Change could not be confirmed. Check current history and retry with the same request.')
    pending.current=null;setMessage('Rights request recorded.')
  }
  async function download() {
    await verifyPublicationPasskey()
    handle.current ??= id()
    const row=await retrieveCandidateExport((name,values)=>app.actions.call(name,values),{...params,rights_request_id:request.trim(),request_id:handle.current})
    if (!active.current) return
    const blob=new Blob([JSON.stringify(row,null,2)],{type:'application/json'})
    const url=URL.createObjectURL(blob)
    const link=document.createElement('a');link.href=url;link.download='candidate-core-export.json';link.click()
    setTimeout(()=>URL.revokeObjectURL(url),1000)
    setMessage('Core export downloaded. File bytes and confidential review material are excluded. Full rights fulfillment still requires review.')
  }
  return <section className={panel} aria-label="Subject rights requests"><h2 className="text-xl font-semibold">Subject rights requests and export</h2>
    <p>Record receipt, assigned owner, deadline and identity-review evidence. Use opaque case references; never enter identity documents. Deletion, correction and withdrawal require separate execution and cannot be marked complete here.</p>
    <fieldset disabled={busy} className="space-y-3 mt-3">
      <label className="block">Subject application ID<input className={field} value={application} onChange={e=>{setApplication(e.target.value);reset()}} /></label>
      <label className="block">Rights request ID<input className={field} value={request} onChange={e=>{setRequest(e.target.value);reset()}} /></label>
      <label className="block">Request type<select className={field} value={latest?.request_type ?? kind} disabled={!!latest} onChange={e=>setKind(e.target.value)}>{['access','export','correction','withdrawal','deletion','objection'].map(k=><option key={k}>{k}</option>)}</select></label>
      <label className="block">Response deadline<input className={field} type="datetime-local" value={deadline} disabled={!!latest} onChange={e=>setDeadline(e.target.value)} /></label>
      <label className="block">Identity verification case reference<input className={field} maxLength={128} value={proof} onChange={e=>setProof(e.target.value)} /></label>
      <label className="block">Decision or delivery evidence reference<input className={field} maxLength={128} value={decision} onChange={e=>setDecision(e.target.value)} /></label>
      <button className={button} onClick={()=>void run(async()=>{setLatest(await history());setMessage('History refreshed. No visible record may mean no request or insufficient access.')})}>Load rights history</button>
      <button className={button} onClick={()=>void run(registerPublicationPasskey)}>Register privacy passkey</button>
      {!latest && <button className={button} disabled={!application.trim() || !request.trim() || !Number.isFinite(Date.parse(deadline))} onClick={()=>void run(()=>record('received'))}>Record request with passkey</button>}
      {latest && <p>State: {latest.status} · version {latest.version} · owner {latest.owner_user_id} · deadline {new Date(latest.deadline_at).toLocaleString()}</p>}
      {latest?.status==='received' && <button className={button} onClick={()=>void run(()=>record('identity_verification'))}>Begin identity review</button>}
      {latest?.status==='identity_verification' && <button className={button} disabled={!proof.trim()} onClick={()=>void run(()=>record('processing'))}>Confirm verified identity with passkey</button>}
      {latest?.status==='processing' && ['access','export'].includes(latest.request_type) && <><button className={button} onClick={()=>void run(download)}>Download private core export</button><button className={button} onClick={()=>{handle.current=null;setMessage('Next download will request a new 15-minute authorization.')}}>Request fresh export authorization</button><button className={button} disabled={!decision.trim()} onClick={()=>void run(()=>record('fulfilled'))}>Record reviewed fulfillment</button></>}
      {latest && !['fulfilled','denied_with_reason'].includes(latest.status) && <button className={button} disabled={!decision.trim()} onClick={()=>void run(()=>record('denied_with_reason'))}>Record denial with passkey</button>}
    </fieldset><p role="status" className="break-words">{message}</p>
  </section>
}
