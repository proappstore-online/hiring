import { defineAppWorker } from '@proappstore/sdk/worker'
import { checkMeetingAttendance } from './meeting-attendance.mjs'
import { handleCalendarReport } from './calendar-report.mjs'
import { handleGoogleCalendar } from './google-calendar.mjs'

export default defineAppWorker({
  async fetch(request, pas) { return await handleCalendarReport(request, pas) ?? handleGoogleCalendar(request, pas) },
  async scheduled(event, pas) {
    if (event.name !== 'meeting_attendance') throw new Error('Unknown schedule')
    await checkMeetingAttendance(event, pas)
  },
})
