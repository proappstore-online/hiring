import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { id, read, write, stageLabel, TERMINAL_STAGES, type CandidateApplication } from './api'
import { Attachments } from './attachments'
import { EmptyState, ErrorState, LoadingState, NotFound } from './route-ui'
import { button, date, panel } from './ui'
import { ConfirmDialog } from './ConfirmDialog'
import { candidateApplicationUrl, safeBack } from './routes'
import { useSearchParams } from 'react-router-dom'

export const applicationLink = candidateApplicationUrl

export function CandidateApplicationCard({ application: a, userId, detail = false, onChanged }: { application: CandidateApplication; userId: string; detail?: boolean; onChanged?: () => void }) {
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const [operationId] = useState(id)
  async function withdraw() {
    setConfirm(false); setBusy(true); setError(false)
    try {
      try { await write('withdraw_my_application', { organization_id: a.organization_id, brand_id: a.brand_id, application_id: a.application_id, expected_version: a.version, operation_id: operationId }) } catch { /* Read back an uncertain write before suggesting a retry. */ }
      const rows = await read<CandidateApplication>('get_my_application', { application_id: a.application_id })
      if (rows[0]?.stage !== 'withdrawn') throw Error('Withdrawal unconfirmed')
      onChanged?.()
    } catch { setError(true) } finally { setBusy(false) }
  }
  return <article className={panel + ' space-y-3 break-words'}>
    <h2 className="text-lg font-semibold">{detail ? a.title : <Link className="inline-flex min-h-[44px] items-center underline" to={applicationLink(a.application_id)}>{a.title}</Link>}</h2>
    <p>{a.organization_name ? a.organization_name + ' / ' : ''}{a.brand_name}</p>
    <p>Status: {stageLabel(a.stage)}</p>
    <p>Submitted: {date(a.created_at)}</p>
    {detail && <><p className="text-sm">Organization: {a.organization_id} · Brand: {a.brand_id}</p>
      {!TERMINAL_STAGES.includes(a.stage) && Number.isInteger(a.version) && <button type="button" className={button + ' min-h-11'} disabled={busy} onClick={() => setConfirm(true)}>{busy ? 'Checking withdrawal…' : 'Withdraw application'}</button>}
      {a.stage === 'withdrawn' && <p role="status">Application withdrawn. Your records remain subject to the retention and explicit deletion policy.</p>}
      {error && <p role="alert">Withdrawal could not be confirmed. Refresh to check the current status or retry the same request.</p>}
      {confirm && <ConfirmDialog title="Withdraw this application?" body="This stops further active-stage changes for this application. It does not delete your records or recall messages already in progress." confirmLabel="Confirm withdrawal" onCancel={() => setConfirm(false)} onConfirm={() => void withdraw()} />}
      <Attachments key={a.application_id} scope={a} applicationId={a.application_id} userId={userId} /></>}
  </article>
}

export function CandidateApplications({ userId, applicationId }: { userId: string; applicationId?: string }) {
  const [rows, setRows] = useState<CandidateApplication[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let current = true
    setLoading(true); setError(false); setRows([])
    async function load() {
      if (!applicationId) return read<CandidateApplication>('list_my_job_applications')
      return read<CandidateApplication>('get_my_application', { application_id: applicationId })
    }
    load().then(data => { if (current) setRows(data) }).catch(() => { if (current) setError(true) }).finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [userId, applicationId, attempt])
  if (loading) return <LoadingState>Loading your applications…</LoadingState>
  if (error) return <ErrorState retry={() => setAttempt(n => n + 1)}>Your applications could not be loaded.</ErrorState>
  if (!rows.length) return applicationId ? <NotFound>This application is unavailable or does not belong to your account.</NotFound> : <EmptyState>No applications recorded yet. <Link to="/vacancies" className="underline">Explore vacancies</Link></EmptyState>
  return <div className="space-y-4">{!applicationId && <p>Showing your most recent 100 applications across your brands.</p>}{rows.map(a => <CandidateApplicationCard key={a.application_id} application={a} userId={userId} detail={Boolean(applicationId)} onChanged={() => setAttempt(n => n + 1)} />)}</div>
}

export function CandidateAccountPage({ userId }: { userId: string }) {
  const { applicationId } = useParams()
  const [query] = useSearchParams()
  return <div className="mx-auto max-w-3xl space-y-5 py-6">
    {applicationId && <Link className="underline" to={safeBack(query.get('back'), 'my-applications')}>My Applications</Link>}
    <h1 className="text-2xl font-semibold">{applicationId ? 'Application status' : 'My Applications'}</h1>
    <CandidateApplications key={userId + (applicationId ?? '')} userId={userId} applicationId={applicationId} />
  </div>
}
