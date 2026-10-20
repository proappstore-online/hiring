import { initPro } from '@proappstore/sdk'

export const app = initPro({ appId: 'hiring' })

// Mirrors the CHECK constraints in migrations.json and the stage guards in mcp.json.
export const STAGES = ['submitted', 'in_review', 'interviewing', 'decision_pending', 'offered', 'hired', 'rejected', 'withdrawn'] as const
export type Stage = typeof STAGES[number]
export const TERMINAL_STAGES: readonly Stage[] = ['hired', 'rejected', 'withdrawn']
export const NEXT_STAGES: readonly Stage[] = STAGES.filter(s => s !== 'submitted')
export const stageLabel = (stage: string) => stage.replaceAll('_', ' ')
export type Role = 'owner' | 'recruiter'

export type Scope = { organization_id: string; brand_id: string }
export type Workspace = Scope & { organization_name: string; brand_name: string; role: Role }
export type Requisition = { id: string; title: string; status: string }
export type Member = { user_id: string; role: Role }
export type Application = { id: string; stage: Stage; version: number; candidate_name: string; email: string | null; phone: string | null; linkedin_url: string; requisition_title: string; source_detail: string; basis_reference: string; contact_context: string; assignee_user_id: string; updated_at: number }
export type Note = { id: string; body: string; actor_user_id: string; created_at: number }
export type Draft = { id: string; recipient_email: string; subject: string; body: string; status: 'draft'; actor_user_id: string; created_at: number }
export type StageEvent = { from_stage: Stage | null; to_stage: Stage; reason: string; actor_user_id: string; created_at: number }
export type AssignmentEvent = { from_user_id: string; to_user_id: string; reason: string; actor_user_id: string; created_at: number }
export type Audit = { action: string; actor_user_id: string; created_at: number }

type Params = Record<string, unknown>
/** Runs a write action, refreshes the workspace and reports failures in the UI. */
export type Run = (name: string, params: Params) => void
type Rows<T> = { rows: T[] }
type Write = { meta?: { changes?: number }; results?: { meta?: { changes?: number } }[] }

export const id = () => crypto.randomUUID()
export const read = async <T,>(name: string, params: Params = {}) => (await app.actions.call<Rows<T>>(name, params)).rows
export const write = async (name: string, params: Params) => {
  const result = await app.actions.call<Write>(name, params)
  const changes = result.results?.at(-1)?.meta?.changes ?? result.meta?.changes ?? 0
  if (changes < 1) throw new Error('No record changed. Refresh the workspace and check your access or form details.')
}
