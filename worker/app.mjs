import { defineAppWorker } from '@proappstore/sdk/worker'
import { checkMeetingAttendance } from './meeting-attendance.mjs'
import { handleGoogleCalendar } from './google-calendar.mjs'

export default defineAppWorker({
  fetch: handleGoogleCalendar,
  async scheduled(event, pas) {
    if (event.name !== 'meeting_attendance') throw new Error('Unknown schedule')
    await checkMeetingAttendance(event, pas)
  },
})
