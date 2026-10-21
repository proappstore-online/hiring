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
export type Workspace = Scope & { organization_name: string; brand_name: string; role: Role; can_create_brand: number }
export type Requisition = { id: string; title: string; status: string }
export type Member = { user_id: string; role: Role }
export type Application = { id: string; stage: Stage; version: number; candidate_name: string; email: string | null; phone: string | null; linkedin_url: string | null; requisition_title: string; source_detail: string; basis_reference: string; contact_context: string; assignee_user_id: string; updated_at: number }
export type Note = { id: string; body: string; actor_user_id: string; created_at: number }
export type Draft = { id: string; recipient_email: string; subject: string; body: string; status: 'draft'; actor_user_id: string; created_at: number }
export type Communication = { id: string; direction: 'inbound' | 'outbound'; channel: 'gmail' | 'email-worker'; provider: 'gmail' | 'cloudflare'; mailbox_address: string | null; provider_connection_id: string | null; from_email: string; to_email: string; subject: string; body: string; provider_message_id: string; provider_thread_id: string | null; provider_receipt_id: string | null; provider_event_id: string | null; occurred_at: number; actor_user_id: string; agent_instance_id: string; created_at: number }
export type AgentActivity = { id: string; activity_type: 'candidate_profile_crawled' | 'candidate_search_crawled' | 'email_thread_scanned'; source_url: string; summary: string; occurred_at: number; actor_user_id: string; agent_instance_id: string; created_at: number }
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

export type PublicJob = Scope & { requisition_id: string; title: string; brand_name: string; organization_name: string; location: string; description: string; arrangement: string; compensation: string; contact: string; notice_version: string; notice_text: string; version: number }
export type CandidateApplication = Scope & { application_id: string; requisition_id: string; title: string; brand_name: string; stage: Stage }
export type IntakeReceipt = Scope & { application_id: string; requisition_id: string; payload_json: string; stage: Stage }
export type Attachment = { id: string; filename: string; mime_type: string; size_bytes: number; scan_state: 'pending' | 'clean' | 'infected' | 'failed'; uploader_user_id: string }
export const readPublic = async <T,>(name: string, params: Params = {}) => (await app.actions.callPublic<Rows<T>>(name, params)).rows
