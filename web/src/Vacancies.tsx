import { TermsFilters, VacancyTerms, matchesTerms, parseTerms, termsText } from './vacancy-terms'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigationType, useParams, useSearchParams } from 'react-router-dom'
import { readPublic, type PublicJob } from './api'
import { EmptyState, ErrorState, LoadingState, NotFound } from './route-ui'
import { parsePD, PD_FIELDS, PositionDescription } from './position-description'
import { DiscoveryFilters } from './DiscoveryFilters'
import { button, field, panel } from './ui'
import { applyUrl, safeBack, vacancyUrl, withBack } from './routes'

type Vacancy = PublicJob & { pd_json: string | null; pd_version: number | null; status: 'published' }
export const vacancyLink = (v: Pick<Vacancy, 'requisition_id'>) => vacancyUrl(v.requisition_id)
export function VacanciesIndexPage() {
  const [query, setQuery] = useSearchParams()
  const navigationType = useNavigationType()
  const querySearch = () => new URL(safeBack('/vacancies?' + query, 'vacancies'), 'https://hiring.invalid').searchParams.get('q') ?? ''
  const [search, setSearch] = useState(querySearch)
  const [termFilters,setTermFilters] = useState<Record<string,string>>({})
  const [rows, setRows] = useState<Vacancy[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [more, setMore] = useState(false)
  const seq = useRef(0)
  useEffect(() => {
    const clean = new URL(safeBack('/vacancies?' + query, 'vacancies'), 'https://hiring.invalid').searchParams
    if (clean.toString() !== query.toString()) setQuery(clean, { replace: true })
  }, [query, setQuery])
  // Text input must update urgently. Router transitions can otherwise restore
  // an older URL value between keystrokes and lose characters. Our filter
  // writes use REPLACE; incoming links and browser history restore their query.
  useEffect(() => { if (navigationType !== 'REPLACE') setSearch(querySearch()) }, [query, navigationType])
  const arrangement = query.get('arrangement') ?? ''
  const brand = query.get('filter_brand') ?? ''
  const brands = [...new Map(rows.map(r => [r.brand_id, { id: r.brand_id, name: r.brand_name }])).values()]
  async function load(after_id = '') {
    const request = ++seq.current
    setLoading(true); setError(false)
    try {
      const page = await readPublic<Vacancy>('list_vacancies', { after_id })
      if (request === seq.current) { setRows(old => after_id ? [...old, ...page] : page); setMore(page.length === 25) }
    } catch { if (request === seq.current) setError(true) }
    finally { if (request === seq.current) setLoading(false) }
  }
  useEffect(() => { setRows([]); void load(); return () => { ++seq.current } }, [])
  const arrangements = [...new Set(rows.map(r => String(parsePD(r.pd_json).workingArrangement || r.arrangement || '')).filter(Boolean))]
  const filtered = rows.filter(r => {
    const pd = parsePD(r.pd_json)
    return matchesTerms(r.terms_json,termFilters) && (!brand || r.brand_id === brand) && (!arrangement || (pd.workingArrangement || r.arrangement) === arrangement) && `${r.title} ${pd.overview || r.description || ''}`.toLowerCase().includes(search.toLowerCase())
  })
  function filter(key: string, value: string) { setQuery(old => { const next = new URLSearchParams(old); if (value) next.set(key, value); else next.delete(key); return next }, { replace: true }) }
  return <div className="mx-auto max-w-5xl space-y-5 py-6"><h1 className="text-2xl font-semibold">Vacancies</h1><p>Explore open roles and their position descriptions.</p>
    <DiscoveryFilters search={search} brand={brand} brands={brands} onSearch={value => { const next = value.slice(0, 100); setSearch(next); filter('q', next) }} onBrand={value => filter('filter_brand', value)} />
    <label className="block">Working arrangement<select className={field} value={arrangement} onChange={e => filter('arrangement', e.target.value)}><option value="">All arrangements</option>{arrangements.map(a => <option key={a}>{a}</option>)}</select></label>
    <TermsFilters values={termFilters} onChange={(key,value) => setTermFilters(old => ({...old,[key]:value}))} />
    <p className="text-sm">Showing published, open vacancies only. Search and filters apply to loaded results.</p>
    {loading && <LoadingState>Loading vacancies…</LoadingState>}{error && <ErrorState retry={() => void load()}>Vacancies could not be loaded.</ErrorState>}
    {!loading && !error && !filtered.length && <EmptyState>{rows.length ? 'No vacancies match these filters.' : 'No vacancies currently open'}</EmptyState>}
    <ul className="grid gap-4 sm:grid-cols-2">{filtered.map(v => { const pd = parsePD(v.pd_json); return <li className={panel} key={v.requisition_id}><h2 className="text-lg font-semibold"><Link className="inline-flex min-h-[44px] items-center underline" to={withBack(vacancyLink(v), safeBack('/vacancies' + (query.size ? '?' + query : ''), 'vacancies'))}>{v.title}</Link></h2><p>{v.brand_name} · {v.location}</p><VacancyTerms value={v.terms_json} /><p className="whitespace-pre-wrap">{pd.workingArrangement || v.arrangement}</p><p>{String(pd.overview || v.description || '').slice(0, 240)}</p><Link className="inline-flex min-h-[44px] items-center underline" to={withBack(vacancyLink(v), safeBack('/vacancies' + (query.size ? '?' + query : ''), 'vacancies'))}>View role and apply<span className="sr-only"> — {v.title}</span></Link></li> })}</ul>
    {more && <button className={button} disabled={loading} onClick={() => void load(rows.at(-1)!.requisition_id)}>Load more vacancies</button>}
  </div>
}
export function VacancyDetailPage() {
  const { vacancyId } = useParams()
  const [query] = useSearchParams()
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
      const details = vacancyId ? await readPublic<Vacancy>('get_vacancy_detail', { requisition_id: vacancyId }) : []
      const gates = await readPublic<{ intake_status: string }>('get_hiring_runtime_gate')
      const scoped = !query.has('organization_id') && !query.has('brand_id') || Boolean(query.get('organization_id') && query.get('brand_id') && details[0]?.organization_id === query.get('organization_id') && details[0]?.brand_id === query.get('brand_id'))
      if (request === seq.current) { setRow(scoped ? details[0] ?? null : null); setAvailable(gates[0]?.intake_status === 'open') }
    } catch { if (request === seq.current) setError(true) }
    finally { if (request === seq.current) setLoading(false) }
  }
  useEffect(() => { setFeedback(''); void load(); return () => { ++seq.current } }, [vacancyId])
  if (loading) return <LoadingState>Loading vacancy…</LoadingState>
  if (error) return <ErrorState retry={() => void load()}>Vacancy could not be loaded.</ErrorState>
  if (!row) return <NotFound>This vacancy is unavailable or no longer open.</NotFound>
  const job = row
  const pd = parsePD(row.pd_json)
  const structured = parseTerms(row.terms_json)
  if (structured) pd.compensation = termsText(structured)
  async function copyLink() {
    try { await navigator.clipboard.writeText(new URL(vacancyLink(row!), window.location.origin).href); setFeedback('Link copied.') }
    catch { setFeedback('Could not copy the link. Copy the address from your browser.') }
  }
  async function copyJD() {
    const sections = Object.entries(PD_FIELDS).flatMap(([key, label]) => {
      const value = pd[key as keyof typeof pd]
      if (!value || (Array.isArray(value) ? !value.some(item => item.trim()) : !value.trim())) return []
      return [`${label}\n${Array.isArray(value) ? value.filter(item => item.trim()).map(item => `- ${item}`).join('\n') : value}`]
    })
    const text = [
      job.title,
      job.terms_json ? termsText(parseTerms(job.terms_json)!) : 'Terms need explicit review',
      `${job.organization_name} / ${job.brand_name}`,
      `Location: ${job.location}`,
      sections.length ? sections.join('\n\n') : job.description,
      `Working arrangement\n${job.arrangement}`,
      `Compensation\n${structured ? termsText(structured) : job.compensation}`,
      `Contact\n${job.contact}`,
    ].filter(Boolean).join('\n\n')
    try { await navigator.clipboard.writeText(text); setFeedback('Full job description copied.') }
    catch { setFeedback('Could not copy the job description. Select and copy the text on this page.') }
  }
  return <article className="mx-auto max-w-3xl space-y-6 py-6"><Link className="underline" to={safeBack(query.get('back'), 'vacancies')}>All vacancies</Link><h1 className="text-3xl font-semibold">{row.title}</h1><p>{row.organization_name} / {row.brand_name} · {row.location}</p>
    <div className="flex flex-wrap gap-2"><button className={button} onClick={() => void copyJD()}>Copy job description</button><button className={button} onClick={() => void copyLink()}>Copy vacancy link</button></div><p role="status">{feedback}</p>
    <VacancyTerms value={row.terms_json} /><PositionDescription pd={Object.keys(pd).length ? pd : { overview: row.description, workingArrangement: row.arrangement, compensation: row.compensation, privacyContact: row.contact }} />
    <p>Contact: {row.contact}</p><section><h2 className="text-lg font-semibold">Candidate privacy notice — {row.notice_version}</h2><p className="whitespace-pre-wrap">{row.notice_text}</p></section>
    {available ? <Link className={button + ' inline-flex min-h-[44px] items-center'} to={withBack(applyUrl(row.requisition_id), safeBack(query.get('back'), 'vacancies'))}>Apply for this vacancy</Link> : <p role="status">Applications are not open yet. Please check back later.</p>}
  </article>
}
