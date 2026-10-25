import { useState } from 'react'
import { id, write, type Scope } from './api'
import { button, field } from './ui'
import { mutationError } from './mutation-state'

export const TERM_OPTIONS = {
  engagement_basis: ['volunteer','employment','contractor','placement','other'],
  programme_kind: ['internship','placement','ongoing contribution','other'],
  compensation_type: ['unpaid','stipend','hourly','salary','other'],
} as const
export type Terms = { engagement_basis: string; programme_kind: string; compensation_type: string; compensation_amount: number | null; compensation_currency: string | null; weekly_hours_min: number; weekly_hours_max: number; programme_weeks: number | null; weeks_basis: string | null }
export function parseTerms(value?: string | null): Terms | null { try { return value ? JSON.parse(value) : null } catch { return null } }
export function termsText(t: Terms) {
  return `${t.engagement_basis} · ${t.programme_kind} · ${t.compensation_type}${t.compensation_amount != null ? ` ${t.compensation_currency} ${t.compensation_amount}` : ''} · ${t.weekly_hours_min}–${t.weekly_hours_max} hours/week${t.programme_weeks != null ? ` · ${t.programme_weeks} ${t.weeks_basis} weeks` : ' · ongoing'}`
}
export function VacancyTerms({ value }: { value?: string | null }) { const t = parseTerms(value); return <p className="whitespace-pre-wrap break-words">{t ? termsText(t) : 'Terms need explicit review. No terms have been inferred from the title.'}</p> }
export function termsFromForm(f: FormData): Terms {
  const number = (key: string) => String(f.get(key) ?? '').trim() ? Number(f.get(key)) : null
  const compensation_type = String(f.get('compensation_type'))
  const paid = ['stipend','hourly','salary'].includes(compensation_type)
  return { engagement_basis: String(f.get('engagement_basis')), programme_kind: String(f.get('programme_kind')), compensation_type, compensation_amount: paid ? number('compensation_amount') : null, compensation_currency: paid ? String(f.get('compensation_currency') ?? '').trim().toUpperCase() : null, weekly_hours_min: number('weekly_hours_min')!, weekly_hours_max: number('weekly_hours_max')!, programme_weeks: number('programme_weeks'), weeks_basis: number('programme_weeks') === null ? null : String(f.get('weeks_basis') ?? '').trim() }
}
export function TermsFields({ initial }: { initial?: Terms | null }) {
  const [compensation, setCompensation] = useState(initial?.compensation_type ?? '')
  return <fieldset className="grid gap-3 sm:grid-cols-2"><legend className="font-semibold">Engagement and programme terms</legend>
    {Object.entries(TERM_OPTIONS).map(([name, options]) => <label className="block" key={name}>{name.replaceAll('_',' ')}<select aria-label={name.replaceAll('_',' ')} name={name} className={field} required defaultValue={initial?.[name as keyof typeof TERM_OPTIONS] ?? ''} onChange={name === 'compensation_type' ? e => setCompensation(e.target.value) : undefined}><option value="">Select explicitly</option>{options.map(v => <option key={v}>{v}</option>)}</select></label>)}
    {['stipend','hourly','salary'].includes(compensation) && <><label>Compensation amount<input className={field} type="number" step="0.01" min="0.01" required name="compensation_amount" defaultValue={initial?.compensation_amount ?? ''} /></label><label>Currency (ISO code)<input className={field} name="compensation_currency" pattern="[A-Za-z]{3}" required maxLength={3} defaultValue={initial?.compensation_currency ?? ''} /></label></>}
    {(['weekly_hours_min','weekly_hours_max','programme_weeks'] as const).map(name => <label key={name}>{name.replaceAll('_',' ')}<input className={field} type="number" name={name} min={name === 'programme_weeks' ? 1 : 0.25} max={name === 'programme_weeks' ? 5200 : 168} step={name === 'programme_weeks' ? 1 : 0.25} required={name !== 'programme_weeks'} defaultValue={initial?.[name] ?? ''} /></label>)}
    <label>Weeks basis (for example approved)<input className={field} name="weeks_basis" maxLength={100} defaultValue={initial?.weeks_basis ?? ''} /></label>
    <p className="sm:col-span-2">Internships and placements require duration and weeks basis. Volunteers may be unpaid or receive a stipend. Leave duration empty for ongoing contributions.</p>
  </fieldset>
}
export type TermTarget = { id: string; terms_version?: number; terms_json?: string | null }
export async function saveTerms(scope: Scope, row: TermTarget, terms: Terms) { await write('save_vacancy_terms', { ...scope, requisition_id: row.id, ...terms, expected_version: row.terms_version ?? 0, operation_id: id() }) }
export function TermsEditor({ scope, targets, onSaved, locked = false }: { scope: Scope; targets: TermTarget[]; onSaved: () => Promise<void>; locked?: boolean }) {
  const [busy,setBusy] = useState(false)
  const [message,setMessage] = useState('')
  const [failed,setFailed] = useState(false)
  return <details className="space-y-3"><summary className="min-h-[44px] cursor-pointer">Review structured terms{targets.length > 1 ? ` for ${targets.length} selected vacancies` : ''}</summary><p>Common terms replace only the structured fields. Role titles and descriptions are preserved. Published terms are immutable after explicit review.</p><form className="space-y-3" onSubmit={async e => { e.preventDefault(); const terms = termsFromForm(new FormData(e.currentTarget)); setBusy(true); setMessage(''); setFailed(false); let saved = 0; try { for (const row of targets) { await saveTerms(scope,row,terms); saved++ } setMessage(`Reviewed terms for ${saved} vacancies.`) } catch (err) { setFailed(true); setMessage(`${saved} saved. ${mutationError(err)}`) } finally { await onSaved(); setBusy(false) } }}><fieldset disabled={busy || locked}><TermsFields initial={targets.length === 1 ? parseTerms(targets[0].terms_json) : null} /></fieldset><button className={button} disabled={busy || locked || !targets.length}>Save reviewed terms</button></form><p role={failed ? 'alert' : 'status'}>{message}</p></details>
}
export function TermsFilters({ values, onChange }: { values: Record<string,string>; onChange: (key: string,value: string) => void }) {
  return <div className="grid gap-3 sm:grid-cols-3">{Object.entries(TERM_OPTIONS).map(([key,options]) => <label key={key}>{key.replaceAll('_',' ')}<select aria-label={key.replaceAll('_',' ')} className={field} value={values[key] ?? ''} onChange={e => onChange(key,e.target.value)}><option value="">All</option>{options.map(v => <option key={v}>{v}</option>)}</select></label>)}</div>
}
export function matchesTerms(value: string | null | undefined, filters: Record<string,string>) { const t = parseTerms(value); return Object.keys(TERM_OPTIONS).every(key => !filters[key] || t?.[key as keyof Terms] === filters[key]) }
