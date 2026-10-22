// Browser scenarios exercised by tests/admin-browser.test.mjs using the repository's Node/Playwright runner.
import { useState } from 'react'
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom'
import { AdminNav, canAccessAdmin } from './AdminNav'
import { ConfirmDialog } from './ConfirmDialog'
import { ComplianceControls } from './ComplianceControls'
import { OperationalDiagnostics } from './OperationalDiagnostics'
import { Communications } from './Communications'
import { CommunicationTemplates } from './CommunicationTemplates'
import { VacancyManagement } from './VacancyManagement'
import { Admin } from './forms'
import { AccessDenied } from './route-ui'
import type { Role } from './api'

const scope = { organization_id: 'org', brand_id: 'brand' }
function VacancyFixture() { const { requisitionId } = useParams(); return <VacancyManagement scope={scope} role="owner" requisitions={[{ id:'req', title:'Engineer', status:'draft' }]} selectedRequisitionId={requisitionId} /> }
export function AdminTest({ scenario, role = 'owner' }: { scenario: string; role?: Role }) {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  return <MemoryRouter>{scenario === 'nav' ? <><AdminNav role={role} scope={scope} />{!canAccessAdmin('/recruiter/settings', role) && <AccessDenied />}</> : scenario === 'dialog' ? <><button onClick={() => setOpen(true)}>Open confirmation</button><p role="status">{message}</p>{open && <ConfirmDialog title="Confirm action" body="Review this change" onCancel={() => { setMessage('Cancelled'); setOpen(false) }} onConfirm={() => { setMessage('Confirmed'); setOpen(false) }} />}</> : scenario === 'operations' ? <OperationalDiagnostics scope={scope} /> : scenario === 'compliance' ? <ComplianceControls role={role} /> : scenario === 'compliance-enabled' ? <ComplianceControls role={role} onExport={async () => { setMessage('Export requested') }} onDelete={async () => { setMessage('Deletion requested') }} /> : scenario === 'communications' ? <Communications scope={scope} brandName="Test Brand" applicationId="app" drafts={[{ id: 'draft', logical_email_id: 'logical', subject: 'Unresolved', body: 'Draft', recipient_email: 'fixture@example.test', status: 'draft', delivery_state: 'unknown', attempt_count: 1, actor_user_id: 'owner', created_at: 1000 }]} communications={[]} /> : scenario === 'templates' ? <CommunicationTemplates scope={scope} canManage={role === 'owner' || role === 'recruiter'} /> : scenario === 'vacancies' ? <Routes><Route path="*" element={<VacancyFixture />} /><Route path="/recruiter/vacancies/:requisitionId" element={<VacancyFixture />} /></Routes> : <Admin scope={scope} role={role} organizationName="Organization" canCreateBrand={false} canCreateRequisition={false} busy={false} run={() => {}} onChanged={async () => {}} />}</MemoryRouter>
}
