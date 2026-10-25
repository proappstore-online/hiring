import { useState } from 'react'
import { id, read, write, type Application, type Scope } from './api'
import { ConfirmDialog } from './ConfirmDialog'
import { button, field, panel } from './ui'

type Candidate = { id: string; name: string; email: string | null; phone: string | null; linkedin_url: string | null }
type Merge = { operation_id: string; source_id: string; target_id: string; reason: string; field_sources_json: string; name: string; email: string | null; phone: string | null; linkedin_url: string | null }
const fields = ['name','email','phone','linkedin_url'] as const
export function CandidateDuplicates({ scope, application, owner }: { scope: Scope; application: Application; owner: boolean }) {
  const [suggestions,setSuggestions] = useState<Candidate[]>([])
  const [history,setHistory] = useState<Merge[]>([])
  const [selected,setSelected] = useState<Candidate>()
  const [sources,setSources] = useState<Record<string,string>>({})
  const [reason,setReason] = useState('')
  const [confirm,setConfirm] = useState(false)
  const [busy,setBusy] = useState(false)
  const [message,setMessage] = useState('')
  const candidateId = application.candidate_id
  const params = { ...scope, candidate_id: candidateId }
  async function refresh() {
    if (!candidateId) throw Error('Refresh the application to load its candidate identity.')
    const rows = await read<Candidate>('suggest_candidate_duplicates',params)
    setSuggestions(rows)
    setMessage(rows.length ? 'Review the suggested profiles before deciding whether to merge.' : 'No possible duplicates are visible in your current scope.')
    if (owner) setHistory(await read<Merge>('list_candidate_merges',params))
  }
  async function run(fn: () => Promise<void>) {
    setBusy(true);setMessage('')
    try { await fn() } catch(e) { setMessage(e instanceof Error ? e.message : 'Could not complete request.') }
    finally { setBusy(false) }
  }
  async function merge() {
    setConfirm(false)
    await run(async()=>{
      if (!selected || !candidateId) return
      const operation=id()
      try { await write('merge_candidates',{...scope,source_id:selected.id,target_id:candidateId,reason,operation_id:operation,...Object.fromEntries(fields.map(f=>[f+'_source',sources[f]]))}) } catch { /* Resolve uncertain responses against durable provenance. */ }
      const rows=await read<Merge>('list_candidate_merges',params)
      if (!rows.some(r=>r.operation_id===operation)) throw Error('Merge was not confirmed. Reload suggestions and history before retrying.')
      setSelected(undefined);await refresh();setMessage('Candidates merged. Original applications and ownership retained.')
    })
  }
  return <section className={panel} aria-label="Candidate duplicates"><h3 className="font-semibold">Possible duplicate candidates</h3>
    <p>Email matches are suggestions for human review. Only authorized records in this brand are considered.</p>
    <button className={button} disabled={busy} onClick={()=>void run(refresh)}>Check duplicates and merge history</button>
    <ul>{suggestions.map(c=><li key={c.id}>{c.name} · {c.email} · {c.id} {owner && <button className={button} disabled={busy} onClick={()=>{setSelected(c);setReason('');setSources(Object.fromEntries(fields.map(f=>[f,candidateId!])));setMessage('')}}>Review merge</button>}</li>)}</ul>
    {selected && <fieldset disabled={busy} className="space-y-3"><legend>Merge {selected.name} into {application.candidate_name}</legend><p>Choose the source for each canonical field. Original profiles, applications, consent, notes and access stay attached to their original records. This merge cannot be repeated or chained.</p>
      {fields.map(f=><label className="block" key={f}>{f.replaceAll('_',' ')}<select className={field} value={sources[f]} onChange={e=>setSources({...sources,[f]:e.target.value})}><option value={candidateId}>Current: {f==='name'?application.candidate_name:application[f] || '(empty)'}</option><option value={selected.id}>Duplicate: {selected[f] || '(empty)'}</option></select></label>)}
      <label className="block">Merge reason<textarea className={field} maxLength={2000} value={reason} onChange={e=>setReason(e.target.value)} /></label>
      <button className={button} disabled={!reason.trim()} onClick={()=>setConfirm(true)}>Confirm merge choices</button><button className={button} onClick={()=>setSelected(undefined)}>Cancel review</button>
    </fieldset>}
    {confirm && <ConfirmDialog title="Merge these candidates?" body="The current candidate becomes canonical using your chosen field sources. Original records remain available and the action is audited." confirmLabel="Merge candidates" onCancel={()=>setConfirm(false)} onConfirm={()=>void merge()} />}
    {history.map(m=><div key={m.operation_id} className="mt-3"><p>Canonical profile: {m.name} · {m.email} · {m.phone} · {m.linkedin_url}</p><p>{m.source_id} → {m.target_id} · {m.reason}</p><p>Field sources: {m.field_sources_json}</p></div>)}
    <p role="status">{message}</p>
  </section>
}
