import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { readPublic, type PublicJob } from './api'
import { EmptyState, ErrorState, LoadingState, NotFound } from './route-ui'
import { parsePD, PositionDescription } from './position-description'
import { button, field, panel } from './ui'

type Vacancy = PublicJob & { pd_json: string | null; pd_version: number | null; status: 'published' }
export const vacancyLink = (v: Pick<Vacancy, 'requisition_id' | 'organization_id' | 'brand_id'>) => '/vacancies/' + encodeURIComponent(v.requisition_id) + '?' + new URLSearchParams({ organization_id: v.organization_id, brand_id: v.brand_id })
export function VacanciesIndexPage() {
  const [query, setQuery] = useSearchParams()
  const [rows, setRows] = useState<Vacancy[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [more, setMore] = useState(false)
  const seq = useRef(0)
  const organization_id = query.get('organization_id') ?? ''
  const brand_id = query.get('brand_id') ?? ''
  const search = query.get('q') ?? ''
  const arrangement = query.get('arrangement') ?? ''
  async function load(after_id = '') {
    const request = ++seq.current
    setLoading(true); setError(false)
    try {
      const page = await readPublic<Vacancy>('listVacancies', { after_id, organization_id, brand_id })
      if (request === seq.current) { setRows(old => after_id ? [...old, ...page] : page); setMore(page.length === 25) }
    } catch { if (request === seq.current) setError(true) }
    finally { if (request === seq.current) setLoading(false) }
  }
  useEffect(() => { setRows([]); void load(); return () => { ++seq.current } }, [organization_id, brand_id])
  const arrangements = [...new Set(rows.map(r => String(parsePD(r.pd_json).workingArrangement || r.arrangement || '')).filter(Boolean))]
  const filtered = rows.filter(r => {
    const pd = parsePD(r.pd_json)
    return (!arrangement || (pd.workingArrangement || r.arrangement) === arrangement) && `${r.title} ${pd.overview || r.description || ''}`.toLowerCase().includes(search.toLowerCase())
  })
  function filter(key: string, value: string) { setQuery(old => { const next = new URLSearchParams(old); if (value) next.set(key, value); else next.delete(key); return next }, { replace: true }) }
  return <div className="mx-auto max-w-5xl space-y-5 py-6"><h1 className="text-2xl font-semibold">Vacancies</h1><p>Explore open roles and their position descriptions.</p>
    <div className="grid gap-4 sm:grid-cols-2"><label>Search vacancies<input className={field} type="search" value={search} onChange={e => filter('q', e.target.value)} /></label><label>Working arrangement<select className={field} value={arrangement} onChange={e => filter('arrangement', e.target.value)}><option value="">All arrangements</option>{arrangements.map(a => <option key={a}>{a}</option>)}</select></label></div>
    <p className="text-sm">Showing published, open vacancies only. Search and filters apply to loaded results.</p>
    {loading && <LoadingState>Loading vacancies…</LoadingState>}{error && <ErrorState retry={() => void load()}>Vacancies could not be loaded.</ErrorState>}
    {!loading && !error && !filtered.length && <EmptyState>{rows.length ? 'No vacancies match these filters.' : 'No vacancies currently open'}</EmptyState>}
    <ul className="grid gap-4 sm:grid-cols-2">{filtered.map(v => { const pd = parsePD(v.pd_json); return <li className={panel} key={v.requisition_id}><h2 className="text-lg font-semibold"><Link className="inline-flex min-h-[44px] items-center underline" to={vacancyLink(v)}>{v.title}</Link></h2><p>{v.brand_name} · {v.location}</p><p className="whitespace-pre-wrap">{pd.workingArrangement || v.arrangement}</p><p>{String(pd.overview || v.description || '').slice(0, 240)}</p><Link className="inline-flex min-h-[44px] items-center underline" to={vacancyLink(v)}>View role and apply<span className="sr-only"> — {v.title}</span></Link></li> })}</ul>
    {more && <button className={button} disabled={loading} onClick={() => void load(rows.at(-1)!.requisition_id)}>Load more vacancies</button>}
  </div>
}
export function VacancyDetailPage() {
  const { vacancyId } = useParams()
  const [query] = useSearchParams()
  const location = useLocation()
  const [row, setRow] = useState<Vacancy | null>(null)
  const [available, setAvailable] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [feedback, setFeedback] = useState('')
  const seq = useRef(0)
  async function load() {
    const request = ++seq.current
    setLoading(true); setError(false); setRow(null)
    try {
      let organization_id = query.get('organization_id') ?? '', brand_id = query.get('brand_id') ?? ''
      if (!organization_id && !brand_id) {
        let after_id = ''
        while (request === seq.current) {
          const page = await readPublic<Vacancy>('listVacancies', { after_id })
          const match = page.find(v => v.requisition_id === vacancyId)
          if (match) { organization_id = match.organization_id; brand_id = match.brand_id; break }
          const next = page.at(-1)?.requisition_id ?? ''
          if (page.length < 25 || next <= after_id) break
          after_id = next
        }
      }
      if (request !== seq.current) return
      const details = organization_id && brand_id ? await readPublic<Vacancy>('getVacancyDetail', { organization_id, brand_id, requisition_id: vacancyId }) : []
      const gates = await readPublic<{ intake_status: string }>('get_hiring_runtime_gate')
      if (request === seq.current) { setRow(details[0] ?? null); setAvailable(gates[0]?.intake_status === 'open') }
    } catch { if (request === seq.current) setError(true) }
    finally { if (request === seq.current) setLoading(false) }
  }
  useEffect(() => { setFeedback(''); void load(); return () => { ++seq.current } }, [vacancyId, location.search])
  if (loading) return <LoadingState>Loading vacancy…</LoadingState>
  if (error) return <ErrorState retry={() => void load()}>Vacancy could not be loaded.</ErrorState>
  if (!row) return <NotFound>This vacancy is unavailable or no longer open.</NotFound>
  const pd = parsePD(row.pd_json)
  async function copy() {
    try { await navigator.clipboard.writeText(new URL(vacancyLink(row!), window.location.origin).href); setFeedback('Link copied.') }
    catch { setFeedback('Could not copy the link. Copy the address from your browser.') }
  }
  return <article className="mx-auto max-w-3xl space-y-6 py-6"><Link className="underline" to="/vacancies">All vacancies</Link><h1 className="text-3xl font-semibold">{row.title}</h1><p>{row.organization_name} / {row.brand_name} · {row.location}</p>
    <button className={button} onClick={() => void copy()}>Copy vacancy link</button><p role="status">{feedback}</p>
    <PositionDescription pd={Object.keys(pd).length ? pd : { overview: row.description, workingArrangement: row.arrangement, compensation: row.compensation, privacyContact: row.contact }} />
    <p>Contact: {row.contact}</p><section><h2 className="text-lg font-semibold">Candidate privacy notice — {row.notice_version}</h2><p className="whitespace-pre-wrap">{row.notice_text}</p></section>
    {available ? <Link className={button + ' inline-flex min-h-[44px] items-center'} to={'/apply/' + encodeURIComponent(row.requisition_id) + '?' + new URLSearchParams({ organization_id: row.organization_id, brand_id: row.brand_id })}>Apply for this vacancy</Link> : <p role="status">Applications are not open yet. Please check back later.</p>}
  </article>
}
