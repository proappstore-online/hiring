import { mutationError } from './mutation-state'
import { useEffect, useRef, useState } from 'react'
import { id, read, write, type Requisition, type Scope } from './api'
import { PublishJob } from './Jobs'
import { parsePD, PD_FIELDS, PositionDescription, type PDRecord } from './position-description'
import { EmptyState, ErrorState, LoadingState } from './route-ui'
import { button, date, field, panel } from './ui'

type ManagedVacancy = { id: string; title: string; state: string; updated_at: number }
export function VacancyManagement({ scope, requisitions, selectedRequisitionId = '' }: { scope: Scope; role: 'owner' | 'recruiter'; requisitions: Requisition[]; selectedRequisitionId?: string }) {
  const [rows, setRows] = useState<ManagedVacancy[]>([])
  const [selected, setSelected] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const seq = useRef(0)
  async function load() {
    const request = ++seq.current
    setLoading(true); setError(false)
    try { const result = await read<ManagedVacancy>('list_vacancy_management', scope); if (request === seq.current) { setRows(result); setSelected(current => result.some(row => row.id === selectedRequisitionId) ? selectedRequisitionId : current) } }
    catch { if (request === seq.current) setError(true) }
    finally { if (request === seq.current) setLoading(false) }
  }
  useEffect(() => { void load(); return () => { ++seq.current } }, [scope.organization_id, scope.brand_id, selectedRequisitionId])
  const vacancy = rows.find(r => r.id === selected)
  return <section className={panel}><h2 className="text-xl font-semibold">Vacancy Management</h2><p className="my-3 text-sm">Draft → in review → published → paused → closed. Showing the most recent 100 requisitions.</p>
    {loading ? <LoadingState>Loading vacancy management…</LoadingState> : error ? <ErrorState retry={() => void load()}>Vacancy states could not be loaded.</ErrorState> : !rows.length ? <EmptyState>No requisitions yet.</EmptyState> : <ul className="space-y-2">{rows.map(r => <li key={r.id}><button aria-pressed={selected === r.id} className={button + ' w-full text-left'} onClick={() => setSelected(r.id)}>{r.title} <span className="rounded border px-2">{r.state}</span><span className="block text-sm">Updated {date(r.updated_at)}</span></button></li>)}</ul>}
    {selectedRequisitionId && !loading && !vacancy && <ErrorState retry={() => void load()}>This vacancy is unavailable in the selected workspace.</ErrorState>}
    {vacancy && <div className="mt-5 space-y-5"><h3 className="font-semibold">Manage {vacancy.title}</h3><ApprovedJobDescription scope={scope} requisitionId={vacancy.id} /> <PDEditor key={vacancy.id} scope={scope} requisitionId={vacancy.id} locked={['published','paused','closed'].includes(vacancy.state)} onSaved={load} />
      <PublishJob key={'publication:' + vacancy.id} scope={scope} requisitions={requisitions.filter(r => r.id === vacancy.id)} onChanged={load} />
    </div>}
  </section>
}
function ApprovedJobDescription({ scope, requisitionId }: { scope: Scope; requisitionId: string }) {
  const [content, setContent] = useState<Record<string, string> | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    let active = true
    void read<{ payload: string }>('get_requisition_review', { ...scope, requisition_id: requisitionId }).then(rows => {
      if (!active) return
      try { setContent(rows[0] ? JSON.parse(rows[0].payload) as Record<string, string> : null) } catch { setError(true) }
    }).catch(() => { if (active) setError(true) })
    return () => { active = false }
  }, [scope.organization_id, scope.brand_id, requisitionId])
  async function copy() {
    if (!content) return
    const text = [content.description, `Working arrangement\n${content.arrangement ?? ''}`, `Compensation\n${content.compensation ?? ''}`, `Contact\n${content.contact ?? ''}`].filter(Boolean).join('\n\n')
    await navigator.clipboard.writeText(text)
  }
  if (error) return <ErrorState retry={() => setError(false)}>Approved job description could not be loaded.</ErrorState>
  if (!content) return <LoadingState>Loading approved job description…</LoadingState>
  return <section className={panel}><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-lg font-semibold">Approved job description</h3><button className={button} onClick={() => void copy()}>Copy job description</button></div><p className="mt-3 whitespace-pre-wrap">{content.description}</p><h4 className="mt-4 font-semibold">Working arrangement</h4><p className="whitespace-pre-wrap">{content.arrangement}</p><h4 className="mt-4 font-semibold">Compensation</h4><p className="whitespace-pre-wrap">{content.compensation}</p></section>
}
function PDEditor({ scope, requisitionId, locked, onSaved }: { scope: Scope; requisitionId: string; locked: boolean; onSaved: () => Promise<void> }) {
  const [record, setRecord] = useState<PDRecord | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [preview, setPreview] = useState<PDRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [failed, setFailed] = useState(false)
  useEffect(() => { if (message && !failed) { const timer = setTimeout(() => setMessage(''), 4000); return () => clearTimeout(timer) } }, [message, failed])
  const seq = useRef(0)
  const params = { ...scope, requisition_id: requisitionId }
  async function load() {
    const request = ++seq.current
    setLoading(true); setLoadError(false)
    try {
      const result = await read<PDRecord>('get_pd_draft', params)
      if (request !== seq.current) return
      setRecord(result[0] ?? null)
      const pd = parsePD(result[0]?.payload)
      setValues(Object.fromEntries(Object.keys(PD_FIELDS).map(key => { const v = pd[key as keyof typeof pd]; return [key, Array.isArray(v) ? v.join('\n') : v ?? ''] })))
    } catch { if (request === seq.current) setLoadError(true) }
    finally { if (request === seq.current) setLoading(false) }
  }
  useEffect(() => { void load(); return () => { ++seq.current } }, [scope.organization_id, scope.brand_id, requisitionId])
  function payload() { return Object.fromEntries(Object.keys(PD_FIELDS).map(key => [key, ['responsibilities','requirements'].includes(key) ? JSON.stringify((values[key] ?? '').split('\n').map(v => v.trim()).filter(Boolean)) : values[key] ?? ''])) }
  async function save(showPreview: boolean) {
    setBusy(true); setMessage(''); setFailed(false); setPreview(null)
    try {
      let current = record
      if (!locked) {
        await write('save_pd_draft', { ...params, ...payload(), expected_version: record?.version ?? 0, operation_id: id() })
        const saved = await read<PDRecord>('get_pd_draft', params)
        current = saved[0] ?? null; setRecord(current)
        await onSaved()
      }
      if (showPreview) { const rows = await read<PDRecord>('preview_pd', params); setPreview(rows[0] ?? null); setMessage(rows.length ? 'Preview loaded.' : 'No structured PD is saved.') }
      else setMessage(`PD draft saved, version ${current?.version}. Publication content must be reviewed again before publishing.`)
    } catch (e) { setFailed(true); setMessage(mutationError(e)); }
    finally { setBusy(false) }
  }
  if (loading) return <LoadingState>Loading PD draft…</LoadingState>
  if (loadError) return <ErrorState retry={() => void load()}>PD draft could not be loaded.</ErrorState>
  return <section className="space-y-4"><h3 className="text-lg font-semibold">Structured Position Description</h3><p>{locked ? 'Published content is immutable. Create a new requisition for revisions.' : 'All fields are optional. Preview saves a version first; publication requires owner review. Use one item per line for responsibilities and requirements.'}</p>
    <form onSubmit={e => { e.preventDefault(); void save(false) }} className="space-y-3"><fieldset disabled={busy || locked} className="space-y-3">{Object.entries(PD_FIELDS).map(([key,label]) => <label className="block" key={key}>{label}<textarea className={field} rows={3} maxLength={20000} value={values[key] ?? ''} onChange={e => { setValues(old => ({ ...old, [key]: e.target.value })); setPreview(null) }} /></label>)}</fieldset>
      {!locked && <button className={button} disabled={busy} type="submit">Save PD Draft</button>} <button type="button" className={button} disabled={busy} onClick={() => void save(true)}>{locked ? 'Preview saved PD' : 'Save and preview PD'}</button>
    </form><p role={failed ? 'alert' : 'status'}>{message}</p>{preview && <section aria-label="Position Description preview" className={panel}><h3 className="font-semibold">Preview — version {preview.version}</h3><PositionDescription pd={parsePD(preview.payload)} /><button className={button} onClick={() => setPreview(null)}>Close preview</button></section>}
  </section>
}
