import type { Scope } from './api'

// Hiring URL contract v1. IDs are globally stable; workspace scope is required
// for staff authorization and is validated against the signed-in user's grants.
export const vacancyUrl = (id: string) => `/vacancies/${encodeURIComponent(id)}`
export const applyUrl = (id: string) => `${vacancyUrl(id)}/apply`
export const candidateApplicationUrl = (id: string) => `/my-applications/${encodeURIComponent(id)}`
export const recruiterVacancyUrl = (id: string, scope: Scope) => `/recruiter/vacancies/${encodeURIComponent(id)}?${new URLSearchParams(scope)}`
export const recruiterApplicationUrl = (id: string, scope: Scope) => `/recruiter/applications/${encodeURIComponent(id)}?${new URLSearchParams(scope)}`
export const brandSettingsUrl = (scope: Scope) => `/recruiter/organizations/${encodeURIComponent(scope.organization_id)}/brands/${encodeURIComponent(scope.brand_id)}/settings`
export const organizationSettingsUrl = (organizationId: string) => `/recruiter/organizations/${encodeURIComponent(organizationId)}/settings`

const publicKeys = ['q', 'filter_brand', 'arrangement']
const staffKeys = ['requisition', 'stage', 'source', 'assignee', 'date_from', 'date_to']
export function safeBack(raw: string | null, destination: 'vacancies' | 'applications' | 'my-applications'): string {
  const fallback = destination === 'vacancies' ? '/vacancies' : destination === 'applications' ? '/recruiter/applications' : '/my-applications'
  if (!raw || raw.length > 1500 || !raw.startsWith('/') || raw.startsWith('//')) return fallback
  try {
    const url = new URL(raw, 'https://hiring.invalid')
    if (url.origin !== 'https://hiring.invalid' || url.pathname !== fallback) return fallback
    const allowed = destination === 'vacancies' ? publicKeys : destination === 'applications' ? [...staffKeys, 'organization_id', 'brand_id'] : []
    const next = new URLSearchParams()
    for (const key of allowed) {
      const value = url.searchParams.get(key)
      if (value && value.length <= 100 && !/[\x00-\x1f]/.test(value)) next.set(key, value)
    }
    return fallback + (next.size ? `?${next}` : '')
  } catch { return fallback }
}
export function withBack(url: string, back: string): string {
  const target = new URL(url, 'https://hiring.invalid')
  target.searchParams.set('back', back)
  return target.pathname + target.search
}
export function staffBack(raw: string | null, scope: Scope, list: 'applications' | 'vacancies'): string {
  const fallback = `/recruiter/${list}?${new URLSearchParams(scope)}`
  if (!raw || raw.length > 1500 || !raw.startsWith('/') || raw.startsWith('//')) return fallback
  try {
    const parsed = new URL(raw, 'https://hiring.invalid')
    if (parsed.origin !== 'https://hiring.invalid' || parsed.pathname !== `/recruiter/${list}` || parsed.searchParams.get('organization_id') !== scope.organization_id || parsed.searchParams.get('brand_id') !== scope.brand_id) return fallback
    const next = new URLSearchParams(scope)
    for (const key of list === 'applications' ? staffKeys : []) {
      const value = parsed.searchParams.get(key)
      if (value && value.length <= 100 && !/[\x00-\x1f]/.test(value)) next.set(key, value)
    }
    return `/recruiter/${list}?${next}`
  } catch { return fallback }
}

export const diagnosticsSettingsUrl = (scope: Scope) => '/recruiter/settings/operations?' + new URLSearchParams(scope)
export const settingsUrl = (scope: Scope) => '/recruiter/settings?' + new URLSearchParams(scope)
