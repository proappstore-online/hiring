import { defineAppWorker } from '@proappstore/sdk/worker'
// Retired after moving meeting attendance to Interns. Do not call Google or write attendance.
export default defineAppWorker({
  fetch() { return Response.json({error:'attendance_moved_to_interns'}, {status:410}) },
  async scheduled() { /* A queued pre-move delivery is intentionally a no-op. */ },
})
