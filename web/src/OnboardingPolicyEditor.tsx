import { useEffect, useState } from 'react'
import { id, read, write, type Scope } from './api'
import { button, field } from './ui'

export type OnboardingStep = { key: string; label: string; kind: 'text' | 'url' | 'identity' | 'membership' | 'document' | 'confirmation'; required: boolean }
type Policy = { version: number; steps_json: string; invitation_mode: 'none' | 'freeappstore_interns'; created_at: number }
const kinds: OnboardingStep['kind'][] = ['text','url','identity','membership','document','confirmation']
const defaultSteps: OnboardingStep[] = [
  { key:'registration', label:'Registration verified', kind:'document', required:true },
  { key:'requirements', label:'Requirements acknowledged', kind:'confirmation', required:true },
  { key:'team_handoff', label:'Team handoff verified', kind:'identity', required:true },
]

export function OnboardingPolicyEditor({ scope }: { scope: Scope }) {
  const [policy,setPolicy] = useState<Policy | null>(null)
  const [steps,setSteps] = useState<OnboardingStep[]>(defaultSteps)
  const [mode,setMode] = useState<Policy['invitation_mode']>('none')
  const [busy,setBusy] = useState(false)
  const [message,setMessage] = useState('')
  async function load() {
    const [current] = await read<Policy>('get_onboarding_policy',scope)
    setPolicy(current ?? null)
    if (current) { setSteps(JSON.parse(current.steps_json) as OnboardingStep[]); setMode(current.invitation_mode) }
  }
  useEffect(() => { void load().catch(() => setMessage('Could not load onboarding criteria.')) }, [scope.organization_id,scope.brand_id])
  function change(index: number, patch: Partial<OnboardingStep>) { setSteps(old => old.map((step,i) => i===index ? {...step,...patch} : step)) }
  async function publish() {
    setBusy(true);setMessage('')
    try {
      const normalized=steps.map(s=>({...s,key:s.key.trim(),label:s.label.trim()}))
      if (!normalized.length || normalized.some(s=>!s.key || !s.label) || new Set(normalized.map(s=>s.key)).size!==normalized.length) throw Error('Add at least one step with a unique key and label.')
      await write('publish_onboarding_policy',{...scope,expected_version:policy?.version ?? 0,steps_json:JSON.stringify(normalized),invitation_mode:mode,operation_id:id()})
      await load();setMessage('Onboarding criteria published. Existing candidate checklists keep their original version.')
    } catch(e) { setMessage(e instanceof Error ? e.message : 'Could not publish onboarding criteria.') }
    finally {setBusy(false)}
  }
  return <details className="mt-4"><summary className="min-h-11 cursor-pointer font-medium">Organisation onboarding criteria</summary>
    <p className="mt-2 text-sm">Configure candidate checklist steps and information fields. Recruiters verify each required step before marking a candidate onboarded. This does not send invitations, sign agreements or change memberships.</p>
    <p className="mt-2 text-sm">Current version: {policy?.version ?? 'none'}</p>
    <div className="mt-3 space-y-3">{steps.map((step,index)=><div className="rounded-lg border border-[var(--line)] p-3" key={index}>
      <label className="block text-sm">Key<input className={field} value={step.key} onChange={e=>change(index,{key:e.target.value})} maxLength={64} /></label>
      <label className="block text-sm">Label<input className={field} value={step.label} onChange={e=>change(index,{label:e.target.value})} maxLength={160} /></label>
      <label className="block text-sm">Information type<select className={field} value={step.kind} onChange={e=>change(index,{kind:e.target.value as OnboardingStep['kind']})}>{kinds.map(kind=><option key={kind} value={kind}>{kind}</option>)}</select></label>
      <label className="mt-2 flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={step.required} onChange={e=>change(index,{required:e.target.checked})} />Required for completion</label>
      <button type="button" className="underline" disabled={busy} onClick={()=>setSteps(old=>old.filter((_,i)=>i!==index))}>Remove step</button>
    </div>)}</div>
    <button type="button" className="mt-3 underline" disabled={busy || steps.length>=30} onClick={()=>setSteps(old=>[...old,{key:'',label:'',kind:'text',required:true}])}>Add step or field</button>
    <label className="mt-3 block text-sm">Invitation integration<select className={field} value={mode} onChange={e=>setMode(e.target.value as Policy['invitation_mode'])}><option value="none">None</option><option value="freeappstore_interns">FreeAppStore Interns reminder</option></select></label>
    <button type="button" className={button+' mt-3'} disabled={busy} onClick={()=>void publish()}>{busy?'Publishing…':'Publish criteria version'}</button>
    {message && <p role="status" className="mt-2 text-sm">{message}</p>}
  </details>
}
