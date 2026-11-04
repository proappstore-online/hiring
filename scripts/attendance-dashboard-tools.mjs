// Read-only projections over existing attendance evidence. Authorization stays
// per application, including requisition grants and candidate erasure.
export function buildAttendanceDashboardTools() {
  const params = {
    organization_id: { type: 'string' }, brand_id: { type: 'string' },
    calendar_id: { type: 'string' }, series_id: { type: 'string' }, second_series_id: { type: 'string' },
    starts_at: { type: 'integer' }, ends_at: { type: 'integer' },
  }
  const scoped = `SELECT t.*,c.name AS candidate_name FROM hiring_attendance_connected t
JOIN hiring_applications a ON a.id=t.application_id AND a.organization_id=t.organization_id AND a.brand_id=t.brand_id
JOIN hiring_candidates c ON c.id=a.candidate_id AND c.organization_id=a.organization_id AND c.brand_id=a.brand_id
WHERE t.organization_id=:organization_id AND t.brand_id=:brand_id AND t.calendar_id=:calendar_id
AND :starts_at>=0 AND :ends_at>:starts_at AND :ends_at-:starts_at<=1209600000
AND t.starts_at>=:starts_at AND t.starts_at<:ends_at
AND (t.calendar_event_id=:series_id OR substr(t.calendar_event_id,1,length(:series_id)+1)=:series_id||'_'
 OR t.calendar_event_id=:second_series_id OR substr(t.calendar_event_id,1,length(:second_series_id)+1)=:second_series_id||'_')
AND length(:series_id)>0 AND length(:second_series_id)>0
AND EXISTS(SELECT 1 FROM hiring_effective_access p WHERE p.organization_id=a.organization_id AND p.brand_id=a.brand_id AND p.user_id=:__user_id AND p.role IN ('owner','recruiter') AND (p.requisition_id IS NULL OR p.requisition_id=a.requisition_id))
AND NOT EXISTS(SELECT 1 FROM hiring_deletion_tombstones d WHERE d.organization_id=a.organization_id AND d.brand_id=a.brand_id AND d.candidate_id=a.candidate_id)`
  return [
    {
      name: 'list_attendance_overview', operation: 'query', requires_auth: true,
      description: 'Read tracked participants for two explicitly selected meeting series in one calendar and a bounded date window. Paged, newest meetings first. Only current-configuration evidence is shown; missing records never establish absence. Requisition grants and erasure are enforced per participant.',
      params: { ...params, offset: { type: 'integer', optional: true } },
      sql: `WITH scoped AS (${scoped}) SELECT t.id,t.application_id,t.candidate_name,t.calendar_event_id,t.meeting_code,t.starts_at,t.ends_at,t.enabled,t.source_ready,t.google_user_id IS NOT NULL AS identity_linked,
c.status,c.duration_seconds,c.first_join_at,c.last_leave_at,c.error_code,c.checked_at,COUNT(*) OVER() AS total_count
FROM scoped t LEFT JOIN hiring_attendance_checks c ON c.rowid=(SELECT x.rowid FROM hiring_attendance_checks x WHERE x.target_id=t.id AND x.target_version=t.version AND x.source_version=t.source_version ORDER BY x.checked_at DESC,x.event_id DESC LIMIT 1)
ORDER BY t.starts_at DESC,t.calendar_event_id,t.id LIMIT 100 OFFSET MAX(0,COALESCE(:offset,0))`,
    },
    {
      name: 'list_attendance_check_history', operation: 'query', requires_auth: true,
      description: 'Latest 20 recorded check batches for the selected meeting occurrences and authorized participants, including errors and stale-configuration check counts. These observations are not scheduler invocation receipts and do not establish overall job health or completion.',
      params,
      sql: `WITH scoped AS (${scoped}) SELECT c.event_id,MIN(c.checked_at) AS started_at,MAX(c.checked_at) AS checked_at,COUNT(*) AS observations,
SUM(c.status='attended') AS attended,SUM(c.status='error') AS errors,SUM(c.status='scheduled') AS scheduled,
SUM(c.target_version<>t.version OR c.source_version<>t.source_version) AS superseded
FROM scoped t JOIN hiring_attendance_checks c ON c.target_id=t.id
GROUP BY c.event_id ORDER BY checked_at DESC,c.event_id DESC LIMIT 20`,
    },
  ]
}
