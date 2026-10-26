import { useEffect, useState } from 'react'
import { id, read, write, type Application, type Scope } from './api'
import { Form, TextField, field, panel, val } from './ui'

type Policy = { onboarding_url: string; template_id: string; template_version: number }
type Progress = { status: string; reason_code: string; evidence: string; discord_status: string; discord_username: string; version: number }
const reasons: Record<string, string> = { sourced: 'source_verified', invited: 'direct_invitation_sent', onboarding_pending: 'interns_application_recorded', active: 'interns_onboarding_verified', exception: 'manual_exception' }

export function InternshipPolicy({ scope, requisitionId }: { scope: Scope; requisitionId: string }) {
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  async function save(name: string, values: Record<string, unknown>) {
    setBusy(true); setMessage('')
    try { await write(name, { ...scope, requisition_id: requisitionId, ...values }); setMessage('Configuration saved.') }
    catch (e) { setMessage(e instanceof Error ? e.message : 'Configuration failed.') }
    finally { setBusy(false) }
  }
  return <section className={panel}><h3 className="font-semibold">Restricted internship intake</h3><p>Internships are unlisted and recruiter controlled. No new interviews. An owner must configure an approved template containing the exact direct Interns onboarding URL before sourcing candidates. The onboarding URL and template identity stay fixed; the owner can move to a newer approved template version.</p><Form busy={busy} onSubmit={f => save('configure_internship_requisition', { onboarding_url: val(f, 'onboarding_url'), template_id: val(f, 'template_id'), template_version: Number(val(f, 'template_version')) })}><TextField name="onboarding_url" label="Direct Interns onboarding URL" type="url" /><TextField name="template_id" label="Approved invitation template ID" /><TextField name="template_version" label="Approved template version" type="number" /></Form><Form busy={busy} onSubmit={f => save('relink_internship_requisition_template', { operation_id: id(), template_id: val(f, 'template_id'), expected_version: Number(val(f, 'expected_version')), new_version: Number(val(f, 'new_version')) })}><TextField name="template_id" label="Current invitation template ID" /><TextField name="expected_version" label="Current version" type="number" /><TextField name="new_version" label="New approved version" type="number" /></Form><Form busy={busy} onSubmit={f => save('configure_internship_campaign', { campaign_id: val(f, 'campaign_id'), source_url: val(f, 'source_url'), evidence: val(f, 'evidence'), enabled: Number(val(f, 'enabled')) })}><TextField name="campaign_id" label="LinkedIn ad campaign ID" /><TextField name="source_url" label="LinkedIn Campaign Manager URL" type="url" /><TextField name="evidence" label="Campaign approval and lawful basis evidence" /><label>Campaign intake<select className={field} name="enabled"><option value="1">Enabled</option><option value="0">Disabled</option></select></label></Form><p role="status">{message}</p></section>
}

export function InternshipProgress({ scope, application }: { scope: Scope; application: Application }) {
  const [rows, setRows] = useState<Progress[]>([])
  const [policy, setPolicy] = useState<Policy | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const params = { ...scope, requisition_id: application.requisition_id, application_id: application.id }
  async function load() {
    const [history, policies] = await Promise.all([read<Progress>('list_internship_progress', params), read<Policy>('get_internship_policy', params)])
    setRows(history); setPolicy(policies[0] ?? null); setLoaded(true)
  }
  useEffect(() => { void load().catch(() => setMessage('Could not load onboarding evidence. Refresh to retry.')) }, [application.id, scope.organization_id, scope.brand_id])
  async function record(f: FormData) {
    setBusy(true); setMessage('')
    try { const status = val(f, 'status'); await write('record_internship_progress', { ...params, status, reason_code: reasons[status], evidence: val(f, 'evidence'), discord_status: val(f, 'discord_status'), discord_username: val(f, 'discord_username'), expected_version: rows[0]?.version ?? 0, operation_id: id() }); await load(); setMessage('Onboarding evidence saved.') }
    catch (e) { setMessage(e instanceof Error ? e.message : 'Progress could not be saved.') }
    finally { setBusy(false) }
  }
  return <section className={panel}><h3 className="font-semibold">Direct Interns onboarding</h3><p>No interviews are required. Historical interview records remain available. Use the approved invitation in Communications; sending requires the approved mail connector. Record invitation sent only after provider confirmation.</p>{policy ? <p><a className="underline" href={policy.onboarding_url} target="_blank" rel="noreferrer">Open direct Interns onboarding</a> · Approved template {policy.template_id} v{policy.template_version}</p> : <p>Owner configuration is required before new internship intake.</p>}<Form busy={busy || !loaded || !policy} onSubmit={record}><label>Status<select className={field} name="status">{Object.keys(reasons).map(s => <option key={s}>{s}</option>)}</select></label><TextField name="evidence" label="Evidence reference (Interns application/onboarding or exception)" /><label>Discord<select className={field} name="discord_status"><option value="invite_pending">Invite pending</option><option value="username_pending">Username pending</option><option value="joined">Joined</option></select></label><TextField name="discord_username" label="Discord username (required when joined)" required={false} /></Form><p role="status">{message}</p><ul>{rows.map(r => <li key={r.version}>{r.status} · {r.reason_code} · {r.evidence} · Discord: {r.discord_status} {r.discord_username}</li>)}</ul></section>
}
