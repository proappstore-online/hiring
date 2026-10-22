import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { read, stageLabel, type CandidateApplication } from './api'
import { Attachments } from './attachments'
import { EmptyState, ErrorState, LoadingState, NotFound } from './route-ui'
import { date, panel } from './ui'
import { candidateApplicationUrl, safeBack } from './routes'
import { useSearchParams } from 'react-router-dom'

export const applicationLink = candidateApplicationUrl

export function CandidateApplicationCard({ application: a, userId, detail = false }: { application: CandidateApplication; userId: string; detail?: boolean }) {
  return <article className={panel + ' space-y-3 break-words'}>
    <h2 className="text-lg font-semibold">{detail ? a.title : <Link className="inline-flex min-h-[44px] items-center underline" to={applicationLink(a.application_id)}>{a.title}</Link>}</h2>
    <p>{a.organization_name ? a.organization_name + ' / ' : ''}{a.brand_name}</p>
    <p>Status: {stageLabel(a.stage)}</p>
    <p>Submitted: {date(a.created_at)}</p>
    {detail && <><p className="text-sm">Organization: {a.organization_id} · Brand: {a.brand_id}</p><p>Withdrawal is not currently available.</p><Attachments key={a.application_id} scope={a} applicationId={a.application_id} userId={userId} /></>}
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
  return <div className="space-y-4">{!applicationId && <p>Showing your most recent 100 applications across your brands.</p>}{rows.map(a => <CandidateApplicationCard key={a.application_id} application={a} userId={userId} detail={Boolean(applicationId)} />)}</div>
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
