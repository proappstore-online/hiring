// Existing delivery tests start with owner-approved text. Approval authorization
// and stale versions are exercised separately in communication-controls.test.mjs.
export function seedApprovedTemplates(db) {
  for (const row of db.prepare('SELECT DISTINCT organization_id,brand_id,subject,body FROM hiring_outbox').all()) {
    if (db.prepare('SELECT 1 FROM hiring_communication_templates WHERE organization_id=? AND brand_id=? AND subject=? AND body=?').get(row.organization_id,row.brand_id,row.subject,row.body)) continue
    const id=crypto.randomUUID()
    db.prepare('INSERT INTO hiring_communication_templates(id,organization_id,brand_id,name,subject,body,version,updated_at,operation_id) VALUES(?,?,?,?,?,?,1,1,?)').run(id,row.organization_id,row.brand_id,'Approved fixture',row.subject,row.body,id)
    db.prepare('INSERT INTO hiring_template_approvals VALUES(?,1,?,?,?,?,?,1,?)').run(id,row.organization_id,row.brand_id,row.subject,row.body,'owner',id)
  }
}
