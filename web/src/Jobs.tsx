import { mutationError } from './mutation-state'
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { LoadingState, EmptyState, ErrorState, NotFound } from './route-ui'
import { useEffect, useId, useRef, useState } from 'react'
import { SignInButton } from '@proappstore/sdk'
import { app, id, read, readPublic, write, type IntakeReceipt, type PublicJob, type Requisition, type Scope } from './api'
import { CandidateApplications, applicationLink } from './CandidateAccount'
import { button, field, panel, val } from './ui'
import { DiscoveryFilters } from './DiscoveryFilters'
import { applyUrl, safeBack, vacancyUrl, withBack } from './routes'

export function PublishJob({ scope, requisitions, onChanged }: { scope: Scope; requisitions: Requisition[]; onChanged?: () => Promise<void> }) {
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const requisition = requisitions[0]
  async function publishAndOpen() {
    if (!requisition) return
    setBusy(true); setMessage(''); setFailed(false)
    try {
      const review = (await read<{ version: number; payload: string }>('get_requisition_review', { ...scope, requisition_id: requisition.id }))[0]
      if (!review) throw new Error('Add the job details before publishing.')
      const content = JSON.parse(review.payload) as Record<string, string>
      const details = { ...scope, requisition_id: requisition.id, description: content.description, location: content.location, arrangement: content.arrangement, compensation: content.compensation, notice_version: content.notice_version, notice_text: content.notice_text, contact: content.contact, compensation_type: content.compensation_type }
      await write('save_requisition_review', { ...details, state: 'pending_review', expected_version: review.version, operation_id: id() })
      await write('publish_job_requisition', { ...details, operation_id: id() })
      if (content.compensation_type !== 'internship') await write('set_hiring_runtime_gate', { ...scope, intake_status: 'open', operation_id: id() })
      await onChanged?.()
      setMessage(content.compensation_type === 'internship' ? 'Published as an unlisted internship. Use controlled sourcing and direct Interns onboarding.' : 'Published and accepting applications.')
    } catch (e) { setFailed(true); setMessage(mutationError(e)) }
    finally { setBusy(false) }
  }
  return <section className={panel}><h2 className="font-semibold">Publish vacancy</h2><p className="mt-2 text-sm">Owners and recruiters can publish this prepared vacancy and open applications. Internships stay unlisted and use controlled recruiter sourcing; publishing an internship does not open public intake.</p><button className={button + ' mt-3'} disabled={busy || !requisition} onClick={() => void publishAndOpen()}>{busy ? 'Publishing…' : 'Publish & open applications'}</button><p role={failed ? 'alert' : 'status'} className="mt-3 text-sm">{message || (!requisition ? 'Select a vacancy first.' : '')}</p></section>
}

export function Jobs({ userId, mode = 'list' }: { userId?: string; mode?: 'list' | 'detail' | 'apply' }) {
  const { jobId, vacancyId } = useParams()
  const recordId = vacancyId ?? jobId
  const location = useLocation()
  const [query] = useSearchParams()
  const organization_id = query.get('organization_id') ?? ''
  const brand_id = query.get('brand_id') ?? ''
  const [jobs, setJobs] = useState<PublicJob[]>([])
  const [job, setJob] = useState<PublicJob | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [more, setMore] = useState(false)
  const [available, setAvailable] = useState(false)
  const [search, setSearch] = useState('')
  const [brand, setBrand] = useState('')
  const brands = [...new Map(jobs.map(j => [j.brand_id, { id: j.brand_id, name: j.brand_name }])).values()]
  const filtered = jobs.filter(j => (!brand || j.brand_id === brand) && (j.title + ' ' + j.brand_name + ' ' + j.location).toLowerCase().includes(search.toLowerCase()))
  const selection = useRef(0)
  const link = (row: Pick<PublicJob, 'requisition_id'>, apply = false) => apply ? applyUrl(row.requisition_id) : vacancyUrl(row.requisition_id)
  async function load(after = '') {
    const seq = ++selection.current
    setLoading(true); setError('')
    try {
      if (mode === 'list') {
        const rows = await readPublic<PublicJob>('list_public_jobs', { after_id: after })
        if (seq === selection.current) { setJobs(old => after ? [...old, ...rows] : rows); setMore(rows.length === 25) }
      } else {
        const rows = recordId ? await readPublic<PublicJob>('get_public_job', { requisition_id: recordId }) : []
        const scoped = !query.has('organization_id') && !query.has('brand_id') || Boolean(organization_id && brand_id && rows[0]?.organization_id === organization_id && rows[0]?.brand_id === brand_id)
        const gates = await readPublic<{ intake_status: string }>('get_hiring_runtime_gate')
        if (seq === selection.current) { setJob(scoped ? rows[0] ?? null : null); setAvailable(gates[0]?.intake_status === 'open') }
      }
    } catch { if (seq === selection.current) setError('Jobs could not be loaded. Please retry.') }
    finally { if (seq === selection.current) setLoading(false) }
  }
  const [refreshMine, setRefreshMine] = useState(0)
  useEffect(() => { void load(); return () => { ++selection.current } }, [])
  if (loading && !jobs.length) return <LoadingState>Loading jobs…</LoadingState>
  if (error) return <ErrorState retry={() => void load()}>{error}</ErrorState>
  if (mode !== 'list' && !job) return <NotFound>This vacancy is unavailable or no longer open.</NotFound>
  return <div className="mx-auto max-w-4xl space-y-5 px-4 py-8">
    {mode === 'list' && <><h1 className="text-2xl font-semibold">Jobs</h1><button className={button} disabled={loading} onClick={() => void load()}>Refresh jobs</button><DiscoveryFilters search={search} brand={brand} brands={brands} onSearch={setSearch} onBrand={setBrand} /><p>Search and filters apply to loaded results.</p><ul className="space-y-2">{filtered.map(j => <li key={j.requisition_id}><Link className={panel + ' block min-h-[44px] text-left'} to={link(j)}>{j.title} · {j.brand_name} · {j.location}</Link></li>)}</ul>{!filtered.length && <EmptyState>{jobs.length ? 'No jobs match these filters.' : 'No published jobs are available.'}</EmptyState>}{loading && <LoadingState />}{more && <button className={button} disabled={loading} onClick={() => void load(jobs.at(-1)!.requisition_id)}>More jobs</button>}</>}
    {job && mode !== 'list' && <Link className="underline" to={withBack(vacancyUrl(job.requisition_id), safeBack(query.get('back'), 'vacancies'))}>Vacancy details</Link>}
    {job && <section className={panel}><h1 className="text-xl font-semibold">{job.title}</h1><p>{job.organization_name} / {job.brand_name} · {job.location}</p><p className="mt-4 whitespace-pre-wrap">{job.description}</p><h2 className="mt-4 font-semibold">Arrangement</h2><p className="whitespace-pre-wrap">{job.arrangement}</p><p>{job.compensation}</p><p>Contact: {job.contact}</p><h2 className="mt-4 font-semibold">Privacy notice — {job.notice_version}</h2><p className="whitespace-pre-wrap">{job.notice_text}</p>{!available ? <p role="status" className="mt-4">Applications are not open yet. Please check back later.</p> : mode !== 'apply' ? <Link className="inline-flex min-h-[44px] items-center underline" to={withBack(link(job, true), safeBack(query.get('back'), 'vacancies'))}>Apply for this job</Link> : !userId ? <div className="mt-4 space-y-3"><p>Sign in to apply with your own candidate account.</p><Link className="inline-flex min-h-[44px] items-center underline" to={'/sign-in?returnTo=' + encodeURIComponent(location.pathname + location.search)}>Sign in to continue</Link><div className="flex flex-col items-start gap-3"><SignInButton app={app} provider="google" label="Continue with Google" /><SignInButton app={app} provider="github" label="Continue with GitHub" /></div></div> : <CandidateForm key={job.requisition_id} job={job} onSaved={async () => setRefreshMine(n => n + 1)} />}</section>}
    {userId && <section className={panel}><h2 className="font-semibold"><Link to="/my-applications" className="underline">My applications</Link></h2><CandidateApplications key={refreshMine} userId={userId} /></section>}
  </div>
}

function CandidateForm({ job, onSaved }: { job: PublicJob; onSaved: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [receipt, setReceipt] = useState<IntakeReceipt | null>(null)
  // Kept for retries of this form, never regenerated after an uncertain response.
  const ids = useRef({ application_id: id(), candidate_id: id(), operation_id: id(), idempotency_key: id() })
  const submittedPayload = useRef<string | null>(null)
  const feedback = useRef<HTMLParagraphElement>(null)
  const confirmation = useRef<HTMLParagraphElement>(null)
  const submitting = useRef(false)
  const formId = useId()
  useEffect(() => { if (error) feedback.current?.focus() }, [error])
  useEffect(() => { if (receipt) confirmation.current?.focus() }, [receipt?.application_id])
  async function submit(f: FormData) {
    if (submitting.current) return
    submitting.current = true
    setBusy(true); setError('')
    const p = { ...ids.current, organization_id: job.organization_id, brand_id: job.brand_id, requisition_id: job.requisition_id, candidate_name: val(f, 'candidate_name'), email: val(f, 'email').toLowerCase(), phone: val(f, 'phone'), statement: val(f, 'statement'), notice_version: job.notice_version, expected_version: job.version, notice_acknowledged: f.has('notice_acknowledged') ? 1 : 0, talent_pool_consent: f.has('talent_pool_consent') ? 1 : 0, communications_consent: f.has('communications_consent') ? 1 : 0, website: val(f, 'website') }
    const payload = { name: p.candidate_name, email: p.email, phone: p.phone, statement: p.statement, notice_version: p.notice_version, publication_version: p.expected_version, notice_acknowledged: p.notice_acknowledged, talent_pool_consent: p.talent_pool_consent, communications_consent: p.communications_consent, requisition_id: p.requisition_id, brand_id: p.brand_id, organization_id: p.organization_id }
    try {
      if (submittedPayload.current && submittedPayload.current !== JSON.stringify(payload)) throw new Error('A previous submission may have been saved. Restore the original form values and retry to check its receipt before starting another application.')
      await write('save_my_worker_profile', { display_name: p.candidate_name })
      submittedPayload.current = JSON.stringify(payload)
      let failure: unknown
      try { await write('submit_job_application', p) } catch (e) { failure = e }
      const rows = await read<IntakeReceipt>('get_my_application_receipt', { idempotency_key: p.idempotency_key })
      const saved = rows[0] ?? (await read<IntakeReceipt>('get_my_requisition_receipt', { organization_id: p.organization_id, brand_id: p.brand_id, requisition_id: p.requisition_id }))[0]
      if (!saved) throw failure ?? new Error('Application was not saved. Check that applications are open, then retry. Submissions are limited to ten per day and one per ten seconds.')
      if (JSON.stringify(JSON.parse(saved.payload_json)) !== JSON.stringify(payload)) throw new Error('Submission conflict. The saved application differs from this form.')
      setReceipt(saved); await onSaved()
    } catch (e) { setError((e instanceof Error ? e.message : 'Application could not be confirmed.') + ' If the result is uncertain, retry with the same form values; your receipt will be checked before success is shown.') } finally { submitting.current = false; setBusy(false) }
  }
  if (receipt) return <div className="mt-4"><p ref={confirmation} tabIndex={-1} role="status" aria-live="polite">Application saved for {job.brand_name}. Reference: {receipt.application_id}.</p><p role="status">Receipt email: {receipt.receipt_delivery_state === 'accepted' ? 'accepted by the email provider; delivery is not confirmed' : receipt.receipt_delivery_state === 'failed' ? 'failed. Your application is saved; contact the hiring team if you need help' : receipt.receipt_delivery_state === 'unknown' || receipt.receipt_delivery_state === 'sending' ? 'awaiting confirmation. Your application is saved; do not resubmit' : 'pending. Your application is saved; you do not need to submit again'}.</p><Link className="inline-flex min-h-[44px] items-center underline" to={applicationLink(receipt.application_id)}>View application status</Link><button className={button} onClick={async () => { setError(''); try { const rows = await read<IntakeReceipt>('get_my_requisition_receipt', { organization_id: job.organization_id, brand_id: job.brand_id, requisition_id: job.requisition_id }); if (rows[0]) setReceipt({ ...rows[0] }) } catch { setError('Email status is unavailable. Your application remains saved. Try checking again later.') } }}>Refresh receipt email status</button>{error && <p role="alert">{error}</p>}</div>
  const description = `${formId}-help${error ? ` ${formId}-error` : ''}`
  return <div className="mt-5">
    <h3 id={`${formId}-title`} className="font-semibold">Apply to {job.brand_name}</h3>
    {error && <p id={`${formId}-error`} ref={feedback} tabIndex={-1} role="alert">{error}</p>}
    <p id={`${formId}-help`} role="status" aria-live="polite">{busy ? 'Submitting application and checking your receipt…' : 'Complete your details and acknowledge the notice to submit. If confirmation is interrupted, retry with the same values to check your receipt.'}</p>
    <form className="mt-4 space-y-3" aria-labelledby={`${formId}-title`} aria-describedby={description} aria-busy={busy}
      onSubmit={e => { e.preventDefault(); void submit(new FormData(e.currentTarget)) }}
      onInvalid={e => { (e.target as HTMLInputElement).setAttribute('aria-invalid', 'true') }}
      onInput={e => { (e.target as HTMLInputElement).removeAttribute('aria-invalid') }}>
      <fieldset disabled={busy} className="space-y-3" aria-describedby={description}>
        <legend className="sr-only">Application details for {job.brand_name}</legend>
        <label className="hidden" aria-hidden="true">Leave empty<input name="website" autoComplete="off" tabIndex={-1} /></label>
        <label className="block text-sm">Your name<input className={field} aria-label="Your name" name="candidate_name" autoComplete="name" required maxLength={200} pattern=".*\S.*" aria-describedby={description} /></label>
        <label className="block text-sm">Email<input className={field} aria-label="Email" name="email" type="email" autoComplete="email" required maxLength={320} aria-describedby={description} /></label>
        <label className="block text-sm">Phone (optional)<input className={field} aria-label="Phone (optional)" name="phone" type="tel" autoComplete="tel" maxLength={100} aria-describedby={description} /></label>
        <label className="block text-sm">Application statement (optional)<textarea name="statement" className={field} maxLength={10000} aria-describedby={description} /></label>
        <label className="block min-h-[44px] text-sm"><input name="notice_acknowledged" type="checkbox" required aria-describedby={description} /> I acknowledge the {job.brand_name} privacy notice, version {job.notice_version}, for processing this application.</label>
        <label className="block min-h-[44px] text-sm"><input name="talent_pool_consent" type="checkbox" /> I separately agree to future contact by this brand for 180 days, as described in the notice. I can withdraw talent-pool consent in My Applications.</label>
        <label className="block min-h-[44px] text-sm"><input name="communications_consent" type="checkbox" /> I separately agree to optional communications described in the notice.</label>
      </fieldset>
      <button className={button} aria-label={busy ? 'Submitting…' : 'Submit application'} disabled={busy} type="submit">{busy ? 'Submitting…' : 'Submit application'}</button>
    </form>
  </div>
}
