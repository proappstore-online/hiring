import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { read, stageLabel, type Scope, type Role } from './api'
import stages from './application-stages.json'
import { ErrorState, LoadingState } from './route-ui'
import { button, panel } from './ui'

type Count = { stage: string; count: number }
export function CurrentPipeline({ scope, role }: { scope: Scope; role: Role }) {
  const key = JSON.stringify([scope, role])
  const [result, setResult] = useState<{ key: string; rows: Count[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let live = true
    setResult(null); setError(null)
    if (role === 'auditor') return
    read<Count>('get_current_pipeline', scope).then(rows => {
      if (live) setResult({ key, rows })
    }).catch(() => { if (live) setError(key) })
    return () => { live = false }
  }, [key, revision])
  if (role === 'auditor') return null
  const rows = result?.key === key ? result.rows : null
  return <section className={panel} aria-label="Current pipeline">
    <h2 className="text-xl font-semibold">Current pipeline</h2>
    <p>Applications currently in each stage within your authorized scope. Reviewer counts include assigned applications only. Refresh to retrieve the latest counts.</p>
    {error === key ? <ErrorState retry={() => setRevision(n => n + 1)}>Could not load the current pipeline.</ErrorState> : !rows ? <LoadingState>Loading current pipeline…</LoadingState> : <>
      {!rows.some(row => row.count > 0) && <p role="status">No applications in your authorized scope.</p>}
      <ul className="grid gap-3 sm:grid-cols-2">{Object.keys(stages).map(stage => <li key={stage}><Link className="inline-flex min-h-11 items-center underline" to={'/recruiter/applications?' + new URLSearchParams({ ...scope, stage })}>{stageLabel(stage)}: {rows.find(row => row.stage === stage)?.count ?? 0}</Link></li>)}</ul>
    </>}
    <button className={button} disabled={!rows && error !== key} onClick={() => { setResult(null); setRevision(n => n + 1) }}>Refresh pipeline</button>
  </section>
}
