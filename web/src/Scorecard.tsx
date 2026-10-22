import { useEffect, useRef, useState } from 'react'
import { id, interviewScope, read, write, type Scope, type ScorecardCriterion, type ScorecardVersion } from './api'
import { button, field } from './ui'

const initial = (): ScorecardCriterion[] => [{ criterion: '', rating: 3, evidence: '' }]
export function Scorecard({ scope, applicationId, interviewId, assignmentId }: { scope: Scope; applicationId: string; interviewId: string; assignmentId: string }) {
  const generation = useRef(0)
  const [history, setHistory] = useState<ScorecardVersion[]>([])
  const [criteria, setCriteria] = useState(initial)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [olderBusy, setOlderBusy] = useState(false)
  const params = { ...interviewScope(scope, applicationId), interview_id: interviewId, assignment_id: assignmentId }
  useEffect(() => {
    let active = true
    generation.current += 1
    setLoading(true); setHistory([]); setCriteria(initial()); setError('')
    void read<ScorecardVersion>('read_own_scorecard', params).then(rows => {
      if (active) { setHistory(rows); setCriteria(rows[0] ? JSON.parse(rows[0].criteria_json) as ScorecardCriterion[] : initial()) }
    }).catch(() => { if (active) setError('Could not load scorecard. Refresh to retry.') }).finally(() => { if (active) setLoading(false) })
    return () => { active = false; generation.current += 1 }
  }, [scope.organization_id, scope.brand_id, applicationId, interviewId, assignmentId, revision])
  useEffect(() => { const refresh = () => setRevision(v => v + 1); window.addEventListener('focus', refresh); return () => window.removeEventListener('focus', refresh) }, [])
  const latest = history[0]
  const locked = loading || busy || !!error || latest?.status === 'submitted'
  const edit = (index: number, patch: Partial<ScorecardCriterion>) => setCriteria(rows => rows.map((row, n) => n === index ? { ...row, ...patch } : row))
  async function save(status: 'draft' | 'submitted') {
    setBusy(true); setError('')
    try {
      await write('save_own_scorecard', { ...params, expected_version: latest?.version ?? 0, criteria_json: JSON.stringify(criteria), status, operation_id: id() })
      setRevision(v => v + 1)
    } catch { setError('Scorecard was not saved. Refresh and check assignment, criteria or version conflicts.') }
    finally { setBusy(false) }
  }
  async function older() {
    const requestGeneration = generation.current
    setOlderBusy(true)
    try { const rows = await read<ScorecardVersion>('read_own_scorecard', { ...params, before_version: history.at(-1)?.version }); if (requestGeneration === generation.current) setHistory(previous => [...previous, ...rows]) }
    catch { if (requestGeneration === generation.current) setError('Could not load earlier scorecard versions. Refresh to retry.') }
    finally { setOlderBusy(false) }
  }
  return <section className="space-y-3" aria-label="Your scorecard"><h3 className="font-semibold">Your scorecard</h3><p>Ratings: 1 (low) to 5 (high). Capture evidence for each criterion. Submission is final for this assignment; hiring decisions remain separate.</p>{loading && <p role="status">Loading scorecard…</p>}{error && <p role="alert">{error}</p>}<button className={button} type="button" disabled={busy} onClick={() => setRevision(v => v + 1)}>Refresh scorecard</button>{!loading && !error && <><form onSubmit={event => { event.preventDefault(); void save('draft') }}><fieldset disabled={locked} className="space-y-3">{criteria.map((row, index) => <div key={index} className="space-y-2"><label className="block">Criterion {index + 1}<input className={field} required maxLength={200} value={row.criterion} onChange={e => edit(index, { criterion: e.target.value })}/></label><label className="block">Rating {index + 1}<select aria-label={`Rating ${index + 1}`} className={field} value={row.rating} onChange={e => edit(index, { rating: Number(e.target.value) })}>{[1,2,3,4,5].map(n => <option key={n}>{n}</option>)}</select></label><label className="block">Evidence {index + 1}<textarea className={field} maxLength={2000} value={row.evidence} onChange={e => edit(index, { evidence: e.target.value })}/></label>{criteria.length > 1 && <button type="button" className={button} onClick={() => setCriteria(rows => rows.filter((_, n) => n !== index))}>Remove criterion {index + 1}</button>}</div>)}<button type="button" className={button} disabled={criteria.length >= 30} onClick={() => setCriteria(rows => [...rows, ...initial()])}>Add criterion</button><button className={button} type="submit">Save draft</button><button className={button} type="button" disabled={criteria.some(row => !row.criterion.trim() || !row.evidence.trim())} onClick={() => void save('submitted')}>Submit scorecard</button></fieldset></form><details><summary>Version history ({history.length})</summary>{history.map(row => <article key={row.version}><p>Version {row.version} · {row.status} · Saved {new Date(row.created_at).toISOString()}{row.submitted_at != null && ` · Submitted ${new Date(row.submitted_at).toISOString()}`}</p>{(JSON.parse(row.criteria_json) as ScorecardCriterion[]).map((c, index) => <p key={index}>{c.criterion}: {c.rating}/5 · {c.evidence}</p>)}</article>)}{history.length > 0 && history.at(-1)!.version > 1 && <button type="button" className={button} disabled={olderBusy} onClick={() => void older()}>Load earlier versions</button>}</details></>}</section>
}
