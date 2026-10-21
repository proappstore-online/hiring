import { useCallback, useEffect, useRef, useState } from 'react'
import { read, type Application, type Member, type Requisition, type Workspace } from './api'

export type PipelineApplication = Pick<Application, 'id' | 'stage' | 'candidate_name' | 'requisition_title' | 'assignee_user_id' | 'updated_at'> & { requisition_id: string }
type Data = { key: string; applications: PipelineApplication[]; requisitions: Requisition[]; members: Member[] }
export function useRecruiterData(space: Workspace) {
  const key = JSON.stringify([space.organization_id, space.brand_id, space.role])
  const sequence = useRef(0)
  const [data, setData] = useState<Data | null>(null)
  const [state, setState] = useState({ key: '', loading: true, error: '' })
  const reload = useCallback(async () => {
    const seq = ++sequence.current
    setState({ key, loading: true, error: '' })
    const scope = { organization_id: space.organization_id, brand_id: space.brand_id }
    try {
      const staff = space.role === 'owner' || space.role === 'recruiter'
      const [applications, requisitions, members] = await Promise.all([
        space.role === 'auditor' ? Promise.resolve([]) : read<PipelineApplication>(staff ? 'list_applications' : 'gateway_list_applications', scope),
        staff ? read<Requisition>('list_requisitions', scope) : Promise.resolve([]),
        staff ? read<Member>('list_workspace_members', scope) : Promise.resolve([]),
      ])
      if (seq === sequence.current) { setData({ key, applications, requisitions, members }); setState({ key, loading: false, error: '' }) }
    } catch { if (seq === sequence.current) setState({ key, loading: false, error: 'Could not load recruiting data.' }) }
  }, [key])
  useEffect(() => { void reload(); return () => { sequence.current++ } }, [reload])
  return { applications: data?.key === key ? data.applications : [], requisitions: data?.key === key ? data.requisitions : [], members: data?.key === key ? data.members : [], loading: state.key !== key || state.loading, error: state.key === key ? state.error : '', reload }
}
export const workspaceQuery = (space: Workspace, extra: Record<string, string> = {}) => new URLSearchParams({ organization_id: space.organization_id, brand_id: space.brand_id, ...extra }).toString()
