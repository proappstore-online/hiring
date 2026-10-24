export const FILTER_STAGES = ['submitted', 'in_review', 'shortlisted', 'interviewing', 'decision_pending', 'offered', 'accepted', 'hired', 'rejected', 'withdrawn'] as const
export const ONBOARDING_STATUSES = ['sourced', 'invited', 'onboarding_pending', 'active', 'exception'] as const
export const FILTER_KEYS = ['requisition', 'stage', 'source', 'assignee', 'date_from', 'date_to', 'onboarding', 'invited_from', 'invited_to'] as const
export type FilterKey = typeof FILTER_KEYS[number]
export type Filters = Record<FilterKey, string>
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
export function parseFilters(query: URLSearchParams): Filters {
  const value = Object.fromEntries(FILTER_KEYS.map(key => [key, query.get(key) ?? ''])) as Filters
  if (!(FILTER_STAGES as readonly string[]).includes(value.stage)) value.stage = ''
  if (!(ONBOARDING_STATUSES as readonly string[]).includes(value.onboarding)) value.onboarding = ''
  for (const key of ['date_from', 'date_to', 'invited_from', 'invited_to'] as const) if (!validDate(value[key])) value[key] = ''
  for (const key of ['requisition', 'source', 'assignee'] as const) if (value[key].length > 100 || /[\x00-\x1f]/.test(value[key])) value[key] = ''
  return value
}
export function serializeFilters(query: URLSearchParams, filters: Filters) {
  const next = new URLSearchParams(query)
  for (const key of FILTER_KEYS) { if (filters[key]) next.set(key, filters[key]); else next.delete(key) }
  // Never preserve legacy text-search parameters supplied in an incoming URL.
  for (const key of ['q', 'search', 'text']) next.delete(key)
  return next
}
/** Dates are UTC calendar days; the upper bound is exclusive, including all of date_to. */
export function filterQuery(filters: Filters) {
  return { stage: filters.stage || null, requisition_id: filters.requisition || null, source: filters.source || null, assignee: filters.assignee || null,
    onboarding: filters.onboarding || null,
    invited_from: filters.invited_from ? Date.parse(filters.invited_from) : null,
    invited_to: filters.invited_to ? Date.parse(filters.invited_to) + 86400000 : null,
    date_from: filters.date_from ? Date.parse(filters.date_from) : null,
    date_to: filters.date_to ? Date.parse(filters.date_to) + 86400000 : null }
}
export function matchesSearch(application: { candidate_name: string; source_detail?: string }, search: string) {
  const needle = search.trim().toLocaleLowerCase()
  return application.candidate_name.toLocaleLowerCase().includes(needle) || (application.source_detail ?? '').toLocaleLowerCase().includes(needle)
}
