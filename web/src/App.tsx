import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ProShell, PageHeader, SignInButton, useAuth, type NavItem } from '@proappstore/sdk'
import { app, id, read, write, stageLabel, NEXT_STAGES, TERMINAL_STAGES, type Application, type Audit, type AssignmentEvent, type Draft, type Member, type Note, type Requisition, type Run, type Scope, type StageEvent, type Workspace } from './api'

const NAV: NavItem[] = [{ label: 'Workspace', href: '/', title: 'Hiring' }]
type Work = { brand_id: string; requisitions: Requisition[]; members: Member[]; applications: Application[] }
type Detail = { application_id: string; notes: Note[]; drafts: Draft[]; events: StageEvent[]; assignments: AssignmentEvent[]; audit: Audit[] }
const emptyWork: Omit<Work, 'brand_id'> = { requisitions: [], members: [], applications: [] }
const emptyDetail: Omit<Detail, 'application_id'> = { notes: [], drafts: [], events: [], assignments: [], audit: [] }
const date = (ms: number) => new Date(ms).toLocaleString()
const field = 'w-full rounded-lg border border-[var(--line-strong)] bg-[var(--paper)] px-3 py-2 text-sm'
const panel = 'rounded-xl border border-[var(--line-strong)] bg-[var(--panel)] p-5'
const button = 'rounded-lg bg-[var(--ink)] px-4 py-2 text-sm font-medium text-[var(--paper)] disabled:opacity-50'

export default function App() {
  const { user, loading } = useAuth(app)
  if (loading) return <main className="flex min-h-dvh items-center justify-center"><p role="status">Loading…</p></main>
  if (!user) return <main className="flex min-h-dvh items-center justify-center px-6"><section className={panel + ' w-full max-w-sm text-center'}><h1 className="text-2xl font-semibold">Hiring</h1><p className="my-4 text-sm text-[var(--muted)]">Sign in to your private recruiting workspace.</p><div className="flex flex-col items-center gap-3"><SignInButton app={app} provider="google" label="Continue with Google" /><SignInButton app={app} provider="github" label="Continue with GitHub" /></div></section></main>
  return <ProShell app={app} appName="hiring" nav={NAV} branding="app"><WorkspaceView userId={user.id} /></ProShell>
}

function WorkspaceView({ userId }: { userId: string }) {
  const [spaces, setSpaces] = useState<Workspace[] | null>(null)
  const [selected, setSelected] = useState<string>('')
  const [work, setWork] = useState<Work | null>(null)
  const [activeId, setActiveId] = useState('')
  const [detail, setDetail] = useState<Detail | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const workSeq = useRef(0)
  const detailSeq = useRef(0)
  const space = spaces?.find(s => s.brand_id === selected)
  const scope = space ? { organization_id: space.organization_id, brand_id: space.brand_id } : null
  // Data loaded for a previous workspace or application is never shown for the current one.
  const { requisitions, members, applications } = work?.brand_id === selected ? work : emptyWork
  const { notes, drafts, events, assignments, audit } = detail?.application_id === activeId ? detail : emptyDetail
  const active = applications.find(a => a.id === activeId)
  const reloadSpaces = useCallback(async () => { const rows = await read<Workspace>('list_my_workspaces'); setSpaces(rows); setSelected(old => rows.some(s => s.brand_id === old) ? old : rows[0]?.brand_id ?? '') }, [])
  const reloadWork = useCallback(async () => {
    const seq = ++workSeq.current
    if (!scope) return
    const [r, m, a] = await Promise.all([read<Requisition>('list_requisitions', scope), read<Member>('list_workspace_members', scope), read<Application>('list_applications', scope)])
    if (seq === workSeq.current) setWork({ brand_id: scope.brand_id, requisitions: r, members: m, applications: a })
  }, [space?.organization_id, space?.brand_id])
  const reloadDetail = useCallback(async () => {
    const seq = ++detailSeq.current
    if (!scope || !activeId) return
    const p = { ...scope, application_id: activeId }
    const [n, d, e, h, a] = await Promise.all([read<Note>('list_application_notes', p), read<Draft>('list_communication_drafts', p), read<StageEvent>('list_stage_events', p), read<AssignmentEvent>('list_assignment_events', p), read<Audit>('list_application_audit', p)])
    if (seq === detailSeq.current) setDetail({ application_id: activeId, notes: n, drafts: d, events: e, assignments: h, audit: a })
  }, [space?.organization_id, space?.brand_id, activeId])
  const loadSpaces = useCallback(() => { setLoading(true); setError(''); reloadSpaces().catch(e => setError(String(e))).finally(() => setLoading(false)) }, [reloadSpaces])
  useEffect(loadSpaces, [loadSpaces])
  useEffect(() => { reloadWork().catch(e => setError(String(e))) }, [reloadWork])
  useEffect(() => { reloadDetail().catch(e => setError(String(e))) }, [reloadDetail])
  const run: Run = async (name, params) => {
    setBusy(true); setError('')
    try { await write(name, params); await reloadSpaces(); await reloadWork(); await reloadDetail() }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  return <div className="mx-auto max-w-7xl px-4 py-8 md:px-8">
    <PageHeader title="Recruiter workspace" description="Private sourcing, pipeline notes and unsent communications." />
    <p className="mt-2 text-xs text-[var(--muted)]">Your PAS staff ID: <code>{userId}</code></p>
    {error && <p role="alert" className="mt-5 rounded-lg border border-[var(--danger)] p-3 text-sm text-[var(--danger)]">{error}</p>}
    {loading ? <p role="status" className="mt-6">Loading workspace…</p> : !spaces ? <button type="button" className={button + ' mt-6'} onClick={loadSpaces}>Retry loading workspaces</button> : !space ? <Setup busy={busy} run={run} /> : <>
      <div className="my-6 flex flex-wrap items-center gap-3"><label htmlFor="workspace" className="text-sm font-medium">Workspace</label><select id="workspace" aria-label="Workspace" className={field + ' max-w-xs'} value={selected} onChange={e => { setSelected(e.target.value); setActiveId('') }}>{spaces.map(s => <option value={s.brand_id} key={s.brand_id}>{s.organization_name} / {s.brand_name}</option>)}</select><span className="text-xs text-[var(--muted)]">{space.role}</span></div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(340px,1.1fr)]">
        <div className="space-y-6"><CreateApplication key={members.map(m => m.user_id).join()} scope={scope!} requisitions={requisitions} members={members} userId={userId} busy={busy} run={run} />
          <section className={panel}><h2 className="text-lg font-semibold">Applications</h2><p className="mt-1 text-xs text-[var(--muted)]">{applications.length} recent records</p><div className="mt-4 space-y-2">{applications.length ? applications.map(a => <button key={a.id} type="button" onClick={() => setActiveId(a.id)} aria-label={`Open ${a.candidate_name} application`} className={'w-full rounded-lg border p-3 text-left text-sm hover:border-[var(--accent)] ' + (a.id === activeId ? 'border-[var(--accent)]' : 'border-[var(--line)]')}><span className="font-semibold">{a.candidate_name}</span><span className="float-right text-xs">{stageLabel(a.stage)}</span><span className="block text-xs text-[var(--muted)]">{a.requisition_title} · {date(a.updated_at)}</span></button>) : <p className="text-sm text-[var(--muted)]">No applications yet.</p>}</div></section>
          <Admin scope={scope!} role={space.role} busy={busy} run={run} />
        </div>
        <div>{active ? <ApplicationDetail key={active.id} a={active} scope={scope!} members={members} notes={notes} drafts={drafts} events={events} assignments={assignments} audit={audit} busy={busy} run={run} /> : <section className={panel}><h2 className="font-semibold">Application details</h2><p className="mt-2 text-sm text-[var(--muted)]">Select an application to see its history, notes and drafts.</p></section>}</div>
      </div>
    </>}
  </div>
}
function Form({ children, onSubmit, busy }: { children: ReactNode; onSubmit: (data: FormData) => void; busy: boolean }) {
  return <form className="mt-4 space-y-3" onSubmit={(e: FormEvent<HTMLFormElement>) => { e.preventDefault(); onSubmit(new FormData(e.currentTarget)) }}>{children}<button className={button} disabled={busy} type="submit" aria-label="Save form">{busy ? 'Saving…' : 'Save'}</button></form>
}
function TextField({ name, label, required = true, type = 'text', defaultValue }: { name: string; label: string; required?: boolean; type?: string; defaultValue?: string }) { return <label className="block text-sm"><span className="mb-1 block font-medium">{label}</span><input className={field} aria-label={label} name={name} type={type} required={required} defaultValue={defaultValue} /></label> }
function MultilineField({ name, label }: { name: string; label: string }) { return <label className="block text-sm"><span className="mb-1 block font-medium">{label}</span><textarea className={field} aria-label={label} name={name} required rows={3} /></label> }
const val = (f: FormData, k: string) => String(f.get(k) ?? '').trim()
function Setup({ busy, run }: { busy: boolean; run: Run }) { return <section className={panel + ' mt-6 max-w-xl'}><h2 className="text-lg font-semibold">Create an internal workspace</h2><p className="mt-2 text-sm text-[var(--muted)]">This creates a private brand and draft requisition. Public candidate intake remains closed.</p><Form busy={busy} onSubmit={f => run('create_workspace', { organization_id: id(), brand_id: id(), requisition_id: id(), operation_id: id(), organization_name: val(f,'organization_name'), brand_name: val(f,'brand_name'), requisition_title: val(f,'requisition_title') })}><TextField name="organization_name" label="Organization" /><TextField name="brand_name" label="Brand" /><TextField name="requisition_title" label="First role / requisition" /></Form></section> }
function CreateApplication({ scope, requisitions, members, userId, busy, run }: { scope: Scope; requisitions: Requisition[]; members: Member[]; userId: string; busy: boolean; run: Run }) { return <section className={panel}><h2 className="text-lg font-semibold">Add LinkedIn candidate</h2><p className="mt-1 text-xs text-[var(--muted)]">Record the source and lawful basis before adding a person. No outreach is sent.</p><Form busy={busy} onSubmit={f => run('create_linkedin_application', { ...scope, requisition_id: val(f,'requisition_id'), candidate_id: id(), application_id: id(), operation_id: id(), candidate_name: val(f,'candidate_name'), email: val(f,'email'), phone: val(f,'phone'), linkedin_url: val(f,'linkedin_url'), source_detail: val(f,'source_detail'), basis_reference: val(f,'basis_reference'), contact_context: val(f,'contact_context'), assignee_user_id: val(f,'assignee_user_id') })}><TextField name="candidate_name" label="Candidate name" /><TextField name="linkedin_url" label="LinkedIn profile URL" type="url" /><TextField name="email" label="Email (if known)" type="email" required={false} /><TextField name="phone" label="Phone (if known)" required={false} /><label className="block text-sm"><span className="mb-1 block font-medium">Requisition</span><select className={field} aria-label="Requisition" name="requisition_id" required>{requisitions.map(r => <option key={r.id} value={r.id}>{r.title}</option>)}</select></label><TextField name="source_detail" label="Source detail (where and when found)" /><TextField name="basis_reference" label="Lawful basis / policy reference" /><TextField name="contact_context" label="Contact context (how contact details were obtained)" /><label className="block text-sm"><span className="mb-1 block font-medium">Assigned staff</span><select className={field} aria-label="Assigned staff" name="assignee_user_id" defaultValue={userId}>{members.map(m => <option value={m.user_id} key={m.user_id}>{m.user_id} ({m.role})</option>)}</select></label></Form></section> }
function Admin({ scope, role, busy, run }: { scope: Scope; role: string; busy: boolean; run: Run }) { return <section className={panel}><h2 className="font-semibold">Workspace setup</h2><details className="mt-3"><summary className="cursor-pointer text-sm">Add draft requisition</summary><Form busy={busy} onSubmit={f => run('create_requisition', { ...scope, requisition_id: id(), title: val(f,'title'), operation_id: id() })}><TextField name="title" label="Role title" /></Form></details>{role === 'owner' && <details className="mt-3"><summary className="cursor-pointer text-sm">Grant recruiter access</summary><p className="mt-2 text-xs text-[var(--muted)]">Ask the colleague to sign in, then enter their exact PAS staff ID. Access is scoped to this brand.</p><Form busy={busy} onSubmit={f => run('add_workspace_member', { ...scope, member_user_id: val(f,'member_user_id'), role: 'recruiter', operation_id: id() })}><TextField name="member_user_id" label="PAS staff ID" /></Form></details>}</section> }
function ApplicationDetail({ a, scope, members, notes, drafts, events, assignments, audit, busy, run }: { a: Application; scope: Scope; members: Member[]; notes: Note[]; drafts: Draft[]; events: StageEvent[]; assignments: AssignmentEvent[]; audit: Audit[]; busy: boolean; run: Run }) {
  const p = { ...scope, application_id: a.id }
  return <div className="space-y-5"><section className={panel}><h2 className="text-xl font-semibold">{a.candidate_name}</h2><p className="mt-1 text-sm">{a.requisition_title} · <strong>{stageLabel(a.stage)}</strong> · version {a.version}</p><dl className="mt-4 grid gap-2 text-sm"><div><dt className="font-medium">LinkedIn</dt><dd><a className="underline" href={a.linkedin_url} target="_blank" rel="noreferrer">Open profile</a></dd></div><div><dt className="font-medium">Contact</dt><dd>{a.email || 'No email'} · {a.phone || 'No phone'}</dd></div><div><dt className="font-medium">Source</dt><dd>{a.source_detail}</dd></div><div><dt className="font-medium">Basis reference</dt><dd>{a.basis_reference}</dd></div><div><dt className="font-medium">Contact context</dt><dd>{a.contact_context}</dd></div><div><dt className="font-medium">Assigned to</dt><dd>{a.assignee_user_id}</dd></div></dl></section>
    <section className={panel}><h3 className="font-semibold">Change stage</h3>{TERMINAL_STAGES.includes(a.stage) ? <p className="mt-2 text-sm text-[var(--muted)]">This application is in a terminal stage.</p> : <Form busy={busy} onSubmit={f => run('change_application_stage', { ...p, expected_version: a.version, from_stage: a.stage, to_stage: val(f,'to_stage'), reason: val(f,'reason'), operation_id: id() })}><label className="block text-sm"><span className="mb-1 block font-medium">Next stage</span><select className={field} aria-label="Next stage" name="to_stage">{NEXT_STAGES.filter(s => s !== a.stage).map(s => <option key={s} value={s}>{stageLabel(s)}</option>)}</select></label><TextField name="reason" label="Reason / human decision" /></Form>}<History items={events.map(e => `${date(e.created_at)} · ${e.from_stage ?? 'new'} → ${e.to_stage} · ${e.reason} · ${e.actor_user_id}`)} /></section>
    <section className={panel}><h3 className="font-semibold">Assigned recruiter</h3><p className="mt-2 text-sm">Current: {a.assignee_user_id}</p>{members.some(m => m.user_id !== a.assignee_user_id) && <Form busy={busy} onSubmit={f => run('reassign_application', { ...p, expected_version: a.version, from_user_id: a.assignee_user_id, to_user_id: val(f,'to_user_id'), reason: val(f,'reason'), operation_id: id() })}><label className="block text-sm"><span className="mb-1 block font-medium">Reassign to</span><select className={field} aria-label="Reassign to" name="to_user_id">{members.filter(m => m.user_id !== a.assignee_user_id).map(m => <option key={m.user_id} value={m.user_id}>{m.user_id} ({m.role})</option>)}</select></label><TextField name="reason" label="Reassignment reason" /></Form>}<History items={assignments.map(e => `${date(e.created_at)} · ${e.from_user_id} → ${e.to_user_id} · ${e.reason} · ${e.actor_user_id}`)} /></section>
    <section className={panel}><h3 className="font-semibold">Private notes</h3><Form busy={busy} onSubmit={f => run('add_application_note', { ...p, note_id: id(), body: val(f,'body'), operation_id: id() })}><MultilineField name="body" label="Note" /></Form><History items={notes.map(n => `${date(n.created_at)} · ${n.actor_user_id} — ${n.body}`)} /></section>
    <section className={panel}><h3 className="font-semibold">Unsent communication drafts</h3><p className="mt-1 text-xs text-[var(--muted)]">Saved internally. No email is sent and there is no send action.</p>{a.email ? <Form busy={busy} onSubmit={f => run('create_communication_draft', { ...p, draft_id: id(), recipient_email: a.email, subject: val(f,'subject'), body: val(f,'body'), operation_id: id() })}><p className="text-sm">To: {a.email}</p><TextField name="subject" label="Subject" /><MultilineField name="body" label="Draft body" /></Form> : <p className="mt-2 text-sm text-[var(--muted)]">Add an email when creating an application to save an email draft.</p>}<History items={drafts.map(d => `${date(d.created_at)} · ${d.status.toUpperCase()} · ${d.subject} — ${d.body}`)} /></section>
    <section className={panel}><h3 className="font-semibold">Audit trail</h3><History items={audit.map(e => `${date(e.created_at)} · ${e.action} · ${e.actor_user_id}`)} /></section>
  </div>
}
function History({ items }: { items: string[] }) { return <ul className="mt-4 space-y-2 text-xs text-[var(--muted)]">{items.map((s,i) => <li key={i} className="whitespace-pre-wrap rounded-lg border border-[var(--line)] p-2">{s}</li>)}</ul> }
