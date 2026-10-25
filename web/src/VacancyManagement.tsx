import { TermsEditor, TermsFilters, VacancyTerms, matchesTerms, parseTerms, termsText, type TermTarget } from './vacancy-terms'
import { Help, recordRow, secondaryButton } from './design-system'
import { InternshipPolicy } from './InternshipIntake'
import { mutationError } from './mutation-state'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { id, read, write, type Requisition, type Scope } from './api'
import { PublishJob } from './Jobs'
import { parsePD, PD_FIELDS, PositionDescription, type PDRecord } from './position-description'
import { EmptyState, ErrorState, LoadingState, NotFound } from './route-ui'
import { button, date, field, panel } from './ui'
import { recruiterVacancyUrl, staffBack, withBack } from './routes'
import { useSearchParams } from 'react-router-dom'

export type ManagedVacancy = TermTarget & { id: string; title: string; status: string; state: string; updated_at: number; can_publish?: number; review_state?: string | null; publication_version?: number | null; published_description?: string | null; published_location?: string | null; published_arrangement?: string | null; published_compensation?: string | null; published_contact?: string | null; published_notice_version?: string | null; published_notice_text?: string | null }
export function VacancyManagement({ scope, requisitions, selectedRequisitionId = '', selectedVacancy }: { scope: Scope; role: 'owner' | 'recruiter'; requisitions: Requisition[]; selectedRequisitionId?: string; selectedVacancy?: ManagedVacancy }) {
  const [query] = useSearchParams()
  const [filters,setFilters] = useState<Record<string,string>>({})
  const [reviewOnly,setReviewOnly] = useState(false)
  const [selected,setSelected] = useState<string[]>([])
  const [copyMessage, setCopyMessage] = useState('')
  const [rows, setRows] = useState<ManagedVacancy[]>([])
  const [current, setCurrent] = useState<ManagedVacancy | null>(selectedVacancy ?? null)
  useEffect(() => { setCurrent(selectedVacancy ?? null) }, [scope.organization_id, scope.brand_id, selectedRequisitionId])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const visible = rows.filter(r => (!reviewOnly || !r.terms_version) && matchesTerms(r.terms_json,filters))
  const seq = useRef(0)
  async function load() {
    const request = ++seq.current
    setLoading(true); setError(false)
    try { const result = await read<ManagedVacancy>('list_vacancy_management', scope); if (request === seq.current) setRows(result) }
    catch { if (request === seq.current) setError(true) }
    finally { if (request === seq.current) setLoading(false) }
  }
  useEffect(() => { void load(); return () => { ++seq.current } }, [scope.organization_id, scope.brand_id, selectedRequisitionId])
  async function refreshSelected() {
    if (!selectedRequisitionId) return
    const result = await read<ManagedVacancy>('get_vacancy_management', { ...scope, requisition_id: selectedRequisitionId })
    setCurrent(result[0]?.id === selectedRequisitionId ? result[0] : null)
  }
  const vacancy = selectedRequisitionId ? current : undefined
  return <section className={panel}><Help title="About vacancy states"><p>Draft → in review → published → paused → closed. Showing the most recent 100 requisitions.</p></Help>
    {!selectedRequisitionId && <details><summary className="min-h-[44px] cursor-pointer">Terms filters, report and backfill review</summary><TermsFilters values={filters} onChange={(k,v) => setFilters(old => ({...old,[k]:v}))} /><label className="flex min-h-[44px] items-center gap-2"><input type="checkbox" checked={reviewOnly} onChange={e => setReviewOnly(e.target.checked)} />Needs explicit terms review ({rows.filter(r => !r.terms_version).length})</label><p>{visible.length} of {rows.length} loaded vacancies match. Counts include only the latest 100 authorized records.</p><p>{Object.entries(visible.reduce<Record<string,number>>((counts,r) => { const key = r.terms_json ? Object.values(JSON.parse(r.terms_json)).slice(0,3).join(' / ') : 'Needs review'; counts[key]=(counts[key] ?? 0)+1; return counts },{})).map(([label,count]) => `${label}: ${count}`).join('; ')}</p><button className={secondaryButton} onClick={() => setSelected(visible.filter(r => !r.terms_version || r.state === 'draft' || r.state === 'in review').map(r => r.id))}>Select editable results</button>{visible.map(r => <label className="flex min-h-[44px] items-center gap-2" key={r.id}><input type="checkbox" checked={selected.includes(r.id)} onChange={e => setSelected(old => e.target.checked ? [...old,r.id] : old.filter(id => id!==r.id))} />{r.title} — {r.terms_version ? 'Reviewed' : 'Needs terms review'}</label>)}<TermsEditor scope={scope} targets={rows.filter(r => selected.includes(r.id))} onSaved={load} /></details>}
    {!selectedRequisitionId && (loading ? <LoadingState>Loading vacancy management…</LoadingState> : error ? <ErrorState retry={() => void load()}>Vacancy states could not be loaded.</ErrorState> : !rows.length && !selectedRequisitionId ? <EmptyState>No requisitions yet.</EmptyState> : <ul className="space-y-2">{visible.map(r => <li key={r.id}><Link aria-current={selectedRequisitionId === r.id ? 'page' : undefined} className={recordRow + ' grid-cols-[minmax(0,1fr)_auto] border-b border-[var(--line)] md:grid-cols-[minmax(0,2fr)_auto_minmax(0,1fr)]'} to={withBack(recruiterVacancyUrl(r.id, scope), staffBack('/recruiter/vacancies?' + query, scope, 'vacancies'))}><span className="font-semibold underline">{r.title}</span><span className="justify-self-start rounded border px-2">{r.state}</span><span className="col-span-2 text-xs md:col-span-1">Updated {date(r.updated_at)}</span></Link>{r.terms_json && <VacancyTerms value={r.terms_json} />}</li>)}</ul>)}
    {selectedRequisitionId && !loading && !vacancy && <NotFound />}
    {vacancy && <div className="mt-5 space-y-5"><h3 className="font-semibold">Manage {vacancy.title}</h3><p>Lifecycle: <strong>{vacancy.state}</strong>{vacancy.review_state ? ` · Review: ${vacancy.review_state}` : ''}</p><Link className="underline" to={staffBack(query.get('back'), scope, 'vacancies')}>All managed vacancies</Link><button className={secondaryButton} onClick={() => void navigator.clipboard.writeText(new URL(recruiterVacancyUrl(vacancy.id, scope), window.location.origin).href).then(() => setCopyMessage('Internal link copied.')).catch(() => setCopyMessage('Could not copy the link.'))}>Copy internal link</button><p role="status">{copyMessage}</p>{vacancy.can_publish === 1 && <ApprovedJobDescription scope={scope} requisitionId={vacancy.id} terms={vacancy.terms_json} />}{vacancy.publication_version != null && <section className={panel}><h3 className="text-lg font-semibold">Public vacancy snapshot</h3><p className="mt-2">Publication version {vacancy.publication_version} · {vacancy.state}</p><p className="mt-3 whitespace-pre-wrap">{vacancy.published_description}</p><p>{vacancy.published_location} · {vacancy.published_arrangement} · {vacancy.terms_json ? termsText(parseTerms(vacancy.terms_json)!) : vacancy.published_compensation}</p><p>Contact: {vacancy.published_contact}</p><h4 className="mt-3 font-semibold">Privacy notice — {vacancy.published_notice_version}</h4><p className="whitespace-pre-wrap">{vacancy.published_notice_text}</p></section>}<section><h3 className="font-semibold">Reviewed vacancy terms</h3><VacancyTerms value={vacancy.terms_json} /><TermsEditor key={vacancy.id + String(vacancy.terms_version)} scope={scope} targets={[vacancy]} locked={Boolean(vacancy.terms_version) && ['published','paused','closed'].includes(vacancy.state)} onSaved={async () => { await load(); await refreshSelected() }} /></section><InternshipPolicy key={'internship:'+vacancy.id} scope={scope} requisitionId={vacancy.id} /><PDEditor key={vacancy.id} scope={scope} requisitionId={vacancy.id} locked={['published','paused','closed'].includes(vacancy.state)} onSaved={async () => { await load(); await refreshSelected() }} />
      {vacancy.can_publish === 1 && !['published','paused','closed'].includes(vacancy.state) && <PublishJob key={'publication:' + vacancy.id} scope={scope} requisitions={requisitions.filter(r => r.id === vacancy.id)} onChanged={async () => { await load(); await refreshSelected() }} />}
    </div>}
  </section>
}
function ApprovedJobDescription({ scope, requisitionId, terms }: { scope: Scope; requisitionId: string; terms?: string | null }) {
  const [content, setContent] = useState<Record<string, string> | null>(null)
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let active = true
    setLoading(true); setError(false)
    void read<{ payload: string }>('get_requisition_review', { ...scope, requisition_id: requisitionId }).then(rows => {
      if (!active) return
      try { setContent(rows[0] ? JSON.parse(rows[0].payload) as Record<string, string> : null) } catch { setError(true) }
    }).catch(() => { if (active) setError(true) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [scope.organization_id, scope.brand_id, requisitionId, revision])
  async function copy() {
    if (!content) return
    const text = [content.description, `Working arrangement\n${content.arrangement ?? ''}`, `Compensation\n${(terms ? termsText(parseTerms(terms)!) : content.compensation) ?? ''}`, `Contact\n${content.contact ?? ''}`].filter(Boolean).join('\n\n')
    await navigator.clipboard.writeText(text)
  }
  if (error) return <ErrorState retry={() => setRevision(value => value + 1)}>Approved job description could not be loaded.</ErrorState>
  if (loading) return <LoadingState>Loading approved job description…</LoadingState>
  if (!content) return <section className={panel}><h3 className="text-lg font-semibold">Approved job description</h3><p className="mt-2">No reviewed content is saved for this vacancy.</p></section>
  return <section className={panel}><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-lg font-semibold">Approved job description</h3><button className={secondaryButton} onClick={() => void copy()}>Copy job description</button></div><p className="mt-3 whitespace-pre-wrap">{content.description}</p><h4 className="mt-4 font-semibold">Working arrangement</h4><p className="whitespace-pre-wrap">{content.arrangement}</p><h4 className="mt-4 font-semibold">Compensation</h4><p className="whitespace-pre-wrap">{terms ? termsText(parseTerms(terms)!) : content.compensation}</p></section>
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
      {!locked && <button className={secondaryButton} disabled={busy} type="submit">Save PD Draft</button>} <button type="button" className={button} disabled={busy} onClick={() => void save(true)}>{locked ? 'Preview saved PD' : 'Save and preview PD'}</button>
    </form><p role={failed ? 'alert' : 'status'}>{message}</p>{preview && <section aria-label="Position Description preview" className={panel}><h3 className="font-semibold">Preview — version {preview.version}</h3><PositionDescription pd={parsePD(preview.payload)} /><button className={secondaryButton} onClick={() => setPreview(null)}>Close preview</button></section>}
  </section>
}
