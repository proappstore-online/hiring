import { useEffect, useState, type ReactNode } from 'react'
import { id, interviewActions, interviewScope, listApplicationInterviews, readInterviewPacket, write, type Interview, type InterviewPacket, type Scope } from './api'
import { Form, TextField, button, field, panel, val } from './ui'

function ScheduleFields({ interview }: { interview?: Interview }) {
  return <><label className="block">Interview time (UTC)<input className={field} aria-label="Interview time (UTC)" type="datetime-local" name="scheduled_at" defaultValue={interview?.scheduled_at == null ? '' : new Date(interview.scheduled_at).toISOString().slice(0,16)} /></label><label className="block">Duration (minutes)<input className={field} name="duration_minutes" type="number" min="1" max="1440" defaultValue={interview?.duration_minutes ?? ''} /></label><label className="block">Format<select className={field} name="format" defaultValue={interview?.format ?? 'video'}>{['phone','video','onsite','panel'].map(format => <option key={format}>{format}</option>)}</select></label><label className="block">Location<input className={field} name="location" maxLength={2000} defaultValue={interview?.location ?? ''} /></label></>
}
function schedule(f: FormData) {
  return { scheduled_at: val(f,'scheduled_at') ? Date.parse(val(f,'scheduled_at')+'Z') : null, duration_minutes: val(f,'duration_minutes') ? Number(val(f,'duration_minutes')) : null, location: val(f,'location') || null, format: val(f,'format') }
}
export function Interviews({ scope, applicationId, manage = false, emptyState }: { scope: Scope; applicationId: string; manage?: boolean; emptyState?: ReactNode }) {
  const [rows,setRows] = useState<{ interview: Interview; packet: InterviewPacket }[]>([])
  const [loading,setLoading] = useState(true)
  const [busy,setBusy] = useState(false)
  const [error,setError] = useState('')
  const [revision,setRevision] = useState(0)
  useEffect(() => {
    let active = true
    setLoading(true);setRows([]);setError('')
    async function load() {
      const interviews = await listApplicationInterviews(scope,applicationId)
      const packets = await Promise.all(interviews.map(async interview => ({interview,packet:await readInterviewPacket(scope,applicationId,interview.id)})))
      if(active)setRows(packets.filter((row): row is {interview:Interview;packet:InterviewPacket} => row.packet !== null))
    }
    void load().catch(()=>{if(active)setError('Could not load interviews. Check your access and retry.')}).finally(()=>{if(active)setLoading(false)})
    return ()=>{active=false}
  },[scope.organization_id,scope.brand_id,applicationId,revision])
  // Refresh authorization on focus so a previously open packet is cleared after reassignment.
  useEffect(()=>{const refresh=()=>setRevision(v=>v+1);window.addEventListener('focus',refresh);return()=>window.removeEventListener('focus',refresh)},[])
  async function mutate(name:string, params:Record<string,unknown>) {
    setBusy(true);setError('')
    try {await write(name,{...interviewScope(scope,applicationId),...params,operation_id:id()});setRevision(v=>v+1)}
    catch {setError('Interview was not saved. Refresh and check access, reviewer grant, or version conflicts.')}
    finally {setBusy(false)}
  }
  return <section className={panel}><h2 className="text-lg font-semibold">Interviews</h2>{loading && <p role="status">Loading interviews…</p>}{error && <p role="alert">{error}</p>}<button type="button" className={button} disabled={loading||busy} onClick={()=>setRevision(v=>v+1)}>Refresh interviews</button>{!loading&&!rows.length&&<>{emptyState ?? <p>No interviews available.</p>}</>}{rows.map(({interview:i,packet:p})=><article key={i.id+':'+i.version} className="mt-4 space-y-3 border-t border-[var(--line)] pt-4"><h3>{p.candidate_name} · {p.requisition_title}</h3><p>{p.stage} · {p.status}</p><p>{p.scheduled_at == null ? 'Time not set' : new Date(p.scheduled_at).toISOString()} · {p.duration_minutes ?? '—'} minutes · {p.format} · {p.location || 'Location not set'}</p>{manage&&<><p>Interviewer: {i.reviewer_id || 'Unassigned'} · version {i.version}</p><Form busy={busy} onSubmit={f=>void mutate(interviewActions.schedule,{interview_id:i.id,expected_version:i.version,...schedule(f)})}><ScheduleFields interview={i}/></Form><Form busy={busy} onSubmit={f=>void mutate(interviewActions.assign,{interview_id:i.id,expected_version:i.version,assignment_id:id(),reviewer_id:val(f,'reviewer_id'),reason:val(f,'reason')})}><TextField name="reviewer_id" label="New interviewer PAS user ID (requires active scoped grant)"/><TextField name="reason" label="Assignment reason"/></Form>{i.reviewer_id&&<Form busy={busy} onSubmit={f=>void mutate(interviewActions.revoke,{interview_id:i.id,expected_version:i.version,reason:val(f,'reason')})}><p>Revoke current interviewer</p><TextField name="reason" label="Revocation reason"/></Form>}</>}</article>)}{manage&&<details className="mt-4"><summary>Create interview</summary><Form busy={busy} onSubmit={f=>void mutate(interviewActions.create,{interview_id:id(),assignment_id:id(),reviewer_id:val(f,'reviewer_id'),...schedule(f)})}><ScheduleFields/><TextField name="reviewer_id" label="Interviewer PAS user ID (requires active scoped grant)"/></Form></details>}</section>
}
