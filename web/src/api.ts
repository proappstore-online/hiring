import { initPro } from '@proappstore/sdk'

export const app = initPro({ appId: 'hiring' })

import stageTransitions from './application-stages.json'
export const STAGES = Object.keys(stageTransitions) as Stage[]
export type Stage = keyof typeof stageTransitions
export const allowedNextStages = (stage: Stage): readonly Stage[] => stageTransitions[stage] as Stage[]
export const TERMINAL_STAGES: readonly Stage[] = STAGES.filter(stage => !allowedNextStages(stage).length)
export const stageLabel = (stage: string) => stage.replaceAll('_', ' ')
export type Role = 'owner' | 'recruiter' | 'reviewer' | 'auditor'

export type Scope = { organization_id: string; brand_id: string }
export type Workspace = Scope & { organization_name: string; brand_name: string; role: Role; can_create_brand: number; can_manage_templates?: number; can_create_requisition?: number }
export type Requisition = { id: string; title: string; status: string }
export type Member = { user_id: string; role: Role }
export type Application = { is_internship?: number; candidate_id?: string; acceptance_evidence?: string | null; requisition_id?: string; created_at?: string; id: string; stage: Stage; version: number; candidate_name: string; email: string | null; phone: string | null; linkedin_url: string | null; profile_url: string | null; source: string; requisition_title: string; source_detail: string; basis_reference: string; contact_context: string; assignee_user_id: string; updated_at: number }
export type Note = { id: string; body: string; actor_user_id: string; created_at: number }
export type EmailStatusEvent = { id: string; logical_email_id: string; status: string; timestamp: number; actor: string; attempt_number: number | null; provider_reference: string | null }
export type Draft = { delivery_reason?: string | null; logical_email_id?: string | null; current_status?: string | null; latest_activity_at?: number | null; linked_archive_id?: string | null; id: string; recipient_email: string; subject: string; body: string; status: 'draft'; delivery_state: 'draft' | 'pending' | 'sending' | 'sent' | 'failed' | 'unknown' | 'cancelled'; attempt_count: number; actor_user_id: string; created_at: number }
export type Communication = { logical_email_id?: string | null; id: string; direction: 'inbound' | 'outbound'; channel: 'gmail' | 'email-worker'; provider: 'gmail' | 'cloudflare'; mailbox_address: string | null; provider_connection_id: string | null; from_email: string; to_email: string; subject: string; body: string; provider_message_id: string; provider_thread_id: string | null; provider_receipt_id: string | null; provider_event_id: string | null; occurred_at: number; actor_user_id: string; agent_instance_id: string; created_at: number }
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
import { auditedGatewayRead } from '../../scripts/privacy.mjs'
const readAction = async <T,>(name: string, params: Params) => {
  const result = name.startsWith('gateway_')
    ? await auditedGatewayRead((action, values) => app.actions.call(action, values), name, params) as Rows<T>
    : await app.actions.call<Rows<T>>(name, params)
  return result
}
export const read = async <T,>(name: string, params: Params = {}) => (await readAction<T>(name, params)).rows
const mutationReadbacks: Record<string, string> = {"correct_accepted_offer": "get_offer_correction_result","record_lifecycle_transition": "get_lifecycle_result","reconcile_communication": "get_communication_reconciliation","record_acceptance": "get_acceptance_result","record_decision": "get_decision_result", "save_offer_draft": "get_offer_draft_result", "submit_offer_for_approval": "get_offer_submission_result", "approve_offer": "get_offer_approval_result", "revoke_offer": "get_offer_revocation_result", "authorize_offer_dispatch": "get_offer_dispatch_result"}
export const write = async (name: string, params: Params) => {
  const result = await app.actions.call<Write>(name, params)
  const changes = result.results?.at(-1)?.meta?.changes ?? result.meta?.changes ?? 0
  if (mutationReadbacks[name]) {
    const rows = await read<{ operation_id: string }>(mutationReadbacks[name], params)
    if (rows[0]?.operation_id === params.operation_id) return rows[0]
    throw new Error('Action could not be confirmed. Refresh and check the current state.')
  }
  if (changes < 1) throw new Error('No record changed. Refresh the workspace and check your access or form details.')
}

export type PublicJob = Scope & { terms_json?: string | null; requisition_id: string; title: string; brand_name: string; organization_name: string; location: string; description: string; arrangement: string; compensation: string; contact: string; notice_version: string; notice_text: string; version: number }
export type CandidateApplication = Scope & { application_id: string; requisition_id: string; title: string; brand_name: string; organization_name?: string; created_at: number; stage: Stage; version: number }
export type IntakeReceipt = Scope & { receipt_delivery_state?: string; application_id: string; requisition_id: string; payload_json: string; stage: Stage }
export type Attachment = { id: string; filename: string; mime_type: string; size_bytes: number; review_status: 'pending_review' | 'approved'; scan_state: 'pending' | 'clean' | 'infected' | 'failed'; uploader_user_id: string; uploaded_at: number | null; reviewed_by: string | null; reviewed_at: number | null }
export const readPublic = async <T,>(name: string, params: Params = {}) => (await app.actions.callPublic<Rows<T>>(name, params)).rows

import type { Playbook, WorkingInterviewRecord } from './playbook'
export const getWorkingInterviewRecords = (scope: Scope, application_id: string) => read<WorkingInterviewRecord>('get_working_interview_records', { ...scope, application_id })
export async function createWorkingInterviewInvitation(scope: Scope, application_id: string, invitation: string, owner_user_id: string, playbook_version: number) {
  const record_id = id()
  await write('create_working_interview_invitation', { ...scope, application_id, record_id, invitation, owner_user_id, playbook_version, secure_join_confirmed: 1, operation_id: id() })
  const rows = await getWorkingInterviewRecords(scope, application_id)
  if (!rows.some(r => r.id === record_id)) throw Error('Invitation was not saved. Reload and check access and current playbook configuration.')
  return rows
}
export async function recordWorkingInterviewOutcome(scope: Scope, application_id: string, record: WorkingInterviewRecord, outcome: string, exceptions: string) {
  await write('record_working_interview_outcome', { ...scope, application_id, record_id: record.id, expected_version: record.version, outcome, exceptions, operation_id: id() })
  const rows = await getWorkingInterviewRecords(scope, application_id)
  if (!rows.some(r => r.id === record.id && r.version === record.version + 1 && r.outcome === outcome && r.exceptions === exceptions)) throw Error('Outcome was not confirmed. Reload and check access or version conflicts.')
  return rows
}
export const getOrgRecruitingPlaybook = (organization_id: string) => read<Playbook>('get_org_recruiting_playbook', { organization_id })
export async function saveOrgRecruitingPlaybook(organization_id: string, payload: string, expected_version: number) {
  await write('save_org_recruiting_playbook', { organization_id, payload, expected_version, operation_id: id() })
  const saved = await getOrgRecruitingPlaybook(organization_id)
  if (saved[0]?.version !== expected_version + 1) throw Error('Save could not be confirmed. Reload and check access or version conflicts.')
}

export type Interview = { assignment_id: string | null; id: string; version: number; scheduled_at: number | null; duration_minutes: number | null; location: string | null; format: string; status: string; reviewer_id: string | null }
export type InterviewPacket = { candidate_name: string; requisition_title: string; stage: string; scheduled_at: number | null; duration_minutes: number | null; location: string | null; format: string; status: string }
export const interviewScope = (scope: Scope, application_id: string) => ({ tenant_id: scope.organization_id, brand_id: scope.brand_id, application_id })
export const listApplicationInterviews = (scope: Scope, applicationId: string) => read<Interview>('list_application_interviews', interviewScope(scope, applicationId))
export async function readInterviewPacket(scope: Scope, applicationId: string, interview_id: string) {
  const rows = await read<{ packet_json: string }>('read_interview_packet', { ...interviewScope(scope, applicationId), interview_id })
  return rows[0] ? JSON.parse(rows[0].packet_json) as InterviewPacket : null
}
export const interviewActions = { create: 'create_interview', schedule: 'update_interview_schedule', assign: 'assign_interviewer', revoke: 'revoke_interviewer' } as const

export type ScorecardCriterion = { criterion: string; rating: number; evidence: string }
export type ScorecardVersion = { assignment_id: string; version: number; status: 'draft' | 'submitted'; criteria_json: string; created_at: number; submitted_at: number | null }

// Uses the existing authenticated registered-action endpoint, not a browser SQL write.
import { requestErasure } from '../../scripts/erasure.mjs'
export type { ErasureResult as ErasureStatus } from '../../scripts/erasure.mjs'
import type { ErasureResult as ErasureStatus } from '../../scripts/erasure.mjs'
export const getCandidateErasureStatus = (scope: Scope, application_id: string) =>
  read<ErasureStatus>('get_candidate_erasure_status', { ...scope, application_id })
export async function requestCandidateErasure(scope: Scope, applicationId: string, operationId: string): Promise<ErasureStatus> {
  return requestErasure({ actions: (name: string, params: Params) => app.actions.call(name, params), scope, applicationId, operationId, identityVerified: true, holdsReviewed: true })
}
