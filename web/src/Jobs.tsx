import { ConfirmDialog } from './ConfirmDialog'
import { mutationError } from './mutation-state'
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { LoadingState, EmptyState, ErrorState, NotFound } from './route-ui'
import { useEffect, useRef, useState } from 'react'
import { SignInButton } from '@proappstore/sdk'
import { app, id, read, readPublic, write, type IntakeReceipt, type PublicJob, type Requisition, type Scope } from './api'
import { CandidateApplications, applicationLink } from './CandidateAccount'
import { Form, MultilineField, TextField, button, field, panel, val } from './ui'
import { DiscoveryFilters } from './DiscoveryFilters'
import { registerPublicationPasskey, verifyPublicationPasskey } from './passkey'

export function PublishJob({ scope, requisitions, onChanged }: { scope: Scope; requisitions: Requisition[]; onChanged?: () => Promise<void> }) {
  const [pending, setPending] = useState<null | { title: string; task: () => Promise<void> }>(null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [reviewVersion, setReviewVersion] = useState(0)
  const [reviewAction, setReviewAction] = useState('draft')
  const [message, setMessage] = useState('')
  useEffect(() => { if (message && !failed) { const timer = setTimeout(() => setMessage(''), 4000); return () => clearTimeout(timer) } }, [message, failed])
  const [publications, setPublications] = useState<{ requisition_id: string; title: string; version: number; status: string }[]>([])
  async function reload() { setPublications(await read('list_job_publications', scope)) }
  useEffect(() => { reload().catch(() => setMessage('Publication states could not be loaded.')) }, [scope.organization_id, scope.brand_id])
  async function act(task: () => Promise<void>) { setBusy(true); setMessage(''); setFailed(false); try { await task(); await onChanged?.() } catch (e) { setFailed(true); setMessage(mutationError(e)) } finally { setBusy(false) } }
  function confirm(title: string, task: () => Promise<void>) { setPending({ title, task }) }
  return <section className={panel}>{pending && <ConfirmDialog title={pending.title} body="This changes public job availability. Review the selected requisition and privacy notice before confirming. Intake gates remain enforced." confirmLabel="Confirm availability change" onCancel={() => setPending(null)} onConfirm={() => { const task = pending.task; setPending(null); void act(task) }} />}<h2 className="font-semibold">Publish a job</h2><p className="mt-2 text-sm">Only a brand owner can publish. Review the job, arrangement and privacy notice, then verify with your passkey.</p><div className="mt-3 flex gap-3"><button className={button} disabled={busy} onClick={() => act(async () => { await registerPublicationPasskey(); setMessage('Passkey registered.') })}>Register passkey</button><button className={button} disabled={busy} onClick={() => act(async () => { await verifyPublicationPasskey(); setMessage('Identity verified. Review and publish within five minutes.') })}>Verify with passkey</button></div>
    <Form busy={busy} onSubmit={f => (reviewAction === 'publish' ? (task: () => Promise<void>) => confirm('Publish job', task) : act)(async () => { await write(reviewAction === 'publish' ? 'publish_job_requisition' : 'save_requisition_review', { ...(reviewAction === 'publish' ? {} : { state: reviewAction, expected_version: reviewVersion }), compensation_type: val(f, 'compensation_type'), ...scope, requisition_id: val(f, 'requisition_id'), description: val(f, 'description'), location: val(f, 'location'), arrangement: val(f, 'arrangement'), compensation: val(f, 'compensation'), notice_version: val(f, 'notice_version'), notice_text: val(f, 'notice_text'), contact: val(f, 'contact'), operation_id: id() }); await reload(); if (reviewAction !== 'publish') { const rows = await read<{ version: number }>('get_requisition_review', { ...scope, requisition_id: val(f, 'requisition_id') }); setReviewVersion(rows[0]?.version ?? 0) }; setMessage(reviewAction === 'publish' ? 'Job published. Applications will be accepted once intake opens.' : 'Review saved.') })}>
      <button type="button" className={button} disabled={busy} onClick={e => { const form = e.currentTarget.form!; const requisition_id = new FormData(form).get('requisition_id'); void act(async () => { const rows = await read<{ version: number; payload: string }>('get_requisition_review', { ...scope, requisition_id }); const row = rows[0]; setReviewVersion(row?.version ?? 0); if (row) { const values = JSON.parse(row.payload) as Record<string, string>; for (const [name, value] of Object.entries(values)) { const input = form.elements.namedItem(name); if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement || input instanceof HTMLSelectElement) input.value = value }; setMessage('Saved content loaded for review.') } }) }}>Load saved review</button>
      <label className="block text-sm">Requisition<select name="requisition_id" className={field} required onChange={() => setReviewVersion(0)}>{requisitions.map(r => <option key={r.id} value={r.id}>{r.title}</option>)}</select></label><MultilineField name="description" label="Job description" /><TextField name="location" label="Location" /><MultilineField name="arrangement" label="Arrangement, duties, duration and supervision" /><label>Compensation classification<select name="compensation_type" className={field}><option value="paid">Paid</option><option value="unpaid">Unpaid</option><option value="internship">Internship</option><option value="volunteer">Volunteer</option></select></label><TextField name="compensation" label="Compensation and expenses" /><TextField name="contact" label="Organization contact" /><TextField name="notice_version" label="Privacy notice version" /><MultilineField name="notice_text" label="Candidate privacy notice (include retention and optional consent purposes)" /><label>Action<select aria-label="Action" className={field} value={reviewAction} onChange={e => setReviewAction(e.target.value)}><option value="draft">Save draft</option><option value="pending_review">Submit for review</option><option value="publish">Approve and publish</option></select></label><label className="block text-sm"><input type="checkbox" required /> I have reviewed this public job and notice and authorize publication.</label>
    </Form><p role={failed ? 'alert' : 'status'} className="mt-3 text-sm">{message}</p>{failed && <button className={button} onClick={() => void act(reload)}>Reload publication state</button>}<ul>{publications.map(p => <li className="mt-3" key={p.requisition_id}>{p.title} · {p.status}{p.status !== 'closed' && <><button className={button + ' ml-3'} disabled={busy} onClick={() => confirm(p.status === 'paused' ? 'Resume job' : 'Pause job', async () => { await write(p.status === 'paused' ? 'resume_job_requisition' : 'pause_job_requisition', { ...scope, requisition_id: p.requisition_id, expected_version: p.version, operation_id: id() }); await reload(); setMessage('Job availability updated.') })}>{p.status === 'paused' ? 'Resume' : 'Pause'}</button></>}{p.status !== 'closed' && <button className={button + ' ml-3'} disabled={busy} onClick={() => confirm('Close job', async () => { await write('close_job_requisition', { ...scope, requisition_id: p.requisition_id, expected_version: p.version, operation_id: id() }); await reload(); setMessage('Job closed.') })}>Close job</button>}</li>)}</ul></section>
}

export function Jobs({ userId, mode = 'list' }: { userId?: string; mode?: 'list' | 'detail' | 'apply' }) {
  const { jobId } = useParams()
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
  const link = (row: Pick<PublicJob, 'organization_id' | 'brand_id' | 'requisition_id'>, prefix = '/jobs/') => prefix + encodeURIComponent(row.requisition_id) + '?' + new URLSearchParams({ organization_id: row.organization_id, brand_id: row.brand_id })
  async function load(after = '') {
    const seq = ++selection.current
    setLoading(true); setError('')
    try {
      if (mode === 'list') {
        const rows = await readPublic<PublicJob>('list_public_jobs', { after_id: after })
        if (seq === selection.current) { setJobs(old => after ? [...old, ...rows] : rows); setMore(rows.length === 25) }
      } else {
        let jobScope = { organization_id, brand_id }
        // Bare job URLs resolve scope from approved public summaries only.
        if (!organization_id && !brand_id) {
          let after_id = ''
          while (seq === selection.current) {
            const page = await readPublic<PublicJob>('list_public_jobs', { after_id })
            const found = page.find(row => row.requisition_id === jobId)
            if (found) { jobScope = found; break }
            const next = page.at(-1)?.requisition_id ?? ''
            if (page.length < 25 || next <= after_id) break
            after_id = next
          }
        }
        if (seq !== selection.current) return
        const rows = jobScope.organization_id && jobScope.brand_id ? await readPublic<PublicJob>('get_public_job', { organization_id: jobScope.organization_id, brand_id: jobScope.brand_id, requisition_id: jobId }) : []
        const gates = await readPublic<{ intake_status: string }>('get_hiring_runtime_gate')
        if (seq === selection.current) { setJob(rows[0] ?? null); setAvailable(gates[0]?.intake_status === 'open') }
      }
    } catch { if (seq === selection.current) setError('Jobs could not be loaded. Please retry.') }
    finally { if (seq === selection.current) setLoading(false) }
  }
  const [refreshMine, setRefreshMine] = useState(0)
  useEffect(() => { void load(); return () => { ++selection.current } }, [])
  if (loading && !jobs.length) return <LoadingState>Loading jobs…</LoadingState>
  if (error) return <ErrorState retry={() => void load()}>{error}</ErrorState>
  if (mode !== 'list' && !job) return <NotFound>This job is no longer available. Open a vacancy link from the jobs list to include its organization and brand.</NotFound>
  return <div className="mx-auto max-w-4xl space-y-5 px-4 py-8">
    {mode === 'list' && <><h1 className="text-2xl font-semibold">Jobs</h1><button className={button} disabled={loading} onClick={() => void load()}>Refresh jobs</button><DiscoveryFilters search={search} brand={brand} brands={brands} onSearch={setSearch} onBrand={setBrand} /><p>Search and filters apply to loaded results.</p><ul className="space-y-2">{filtered.map(j => <li key={j.requisition_id}><Link className={panel + ' block min-h-[44px] text-left'} to={link(j)}>{j.title} · {j.brand_name} · {j.location}</Link></li>)}</ul>{!filtered.length && <EmptyState>{jobs.length ? 'No jobs match these filters.' : 'No published jobs are available.'}</EmptyState>}{loading && <LoadingState />}{more && <button className={button} disabled={loading} onClick={() => void load(jobs.at(-1)!.requisition_id)}>More jobs</button>}</>}
    {job && <section className={panel}><h1 className="text-xl font-semibold">{job.title}</h1><p>{job.organization_name} / {job.brand_name} · {job.location}</p><p className="mt-4 whitespace-pre-wrap">{job.description}</p><h2 className="mt-4 font-semibold">Arrangement</h2><p className="whitespace-pre-wrap">{job.arrangement}</p><p>{job.compensation}</p><p>Contact: {job.contact}</p><h2 className="mt-4 font-semibold">Privacy notice — {job.notice_version}</h2><p className="whitespace-pre-wrap">{job.notice_text}</p>{!available ? <p role="status" className="mt-4">Applications are not open yet. Please check back later.</p> : mode !== 'apply' ? <Link className="inline-flex min-h-[44px] items-center underline" to={link(job, '/apply/')}>Apply for this job</Link> : !userId ? <div className="mt-4"><p>Sign in to apply with your own candidate account.</p><Link className="inline-flex min-h-[44px] items-center underline" to={'/sign-in?returnTo=' + encodeURIComponent(location.pathname + location.search)}>Sign in to continue</Link><SignInButton app={app} provider="google" label="Continue with Google" /><SignInButton app={app} provider="github" label="Continue with GitHub" /></div> : <CandidateForm key={job.requisition_id} job={job} onSaved={async () => setRefreshMine(n => n + 1)} />}</section>}
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
  async function submit(f: FormData) {
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
    } catch (e) { setError((e instanceof Error ? e.message : 'Application could not be confirmed.') + ' If the result is uncertain, retry with the same form values; your receipt will be checked before success is shown.') } finally { setBusy(false) }
  }
  if (receipt) return <div className="mt-4"><p role="status">Application saved for {job.brand_name}. Reference: {receipt.application_id}.</p><Link className="inline-flex min-h-[44px] items-center underline" to={applicationLink(receipt.application_id)}>View application status</Link></div>
  return <div className="mt-5"><h3 className="font-semibold">Apply to {job.brand_name}</h3>{error && <p role="alert">{error}</p>}<p role="status">{busy ? 'Submitting application and checking your receipt…' : 'Complete your details and acknowledge the notice to submit. If confirmation is interrupted, retry with the same values to check your receipt.'}</p><Form busy={busy} submitLabel="Submit application" busyLabel="Submitting…" onSubmit={submit}><fieldset disabled={busy} className="space-y-3"><label className="hidden" aria-hidden="true">Leave empty<input name="website" autoComplete="off" tabIndex={-1} /></label><TextField name="candidate_name" label="Your name" /><TextField name="email" label="Email" type="email" /><TextField name="phone" label="Phone (optional)" required={false} /><label className="block text-sm">Application statement (optional)<textarea name="statement" className={field} maxLength={10000} /></label><label className="block text-sm"><input name="notice_acknowledged" type="checkbox" required /> I acknowledge the {job.brand_name} privacy notice, version {job.notice_version}, for processing this application.</label><label className="block text-sm"><input name="talent_pool_consent" type="checkbox" /> I separately agree to future talent-pool participation described in the notice.</label><label className="block text-sm"><input name="communications_consent" type="checkbox" /> I separately agree to optional communications described in the notice.</label></fieldset></Form></div>
}
