import { NavLink } from 'react-router-dom'
import type { Role, Scope } from './api'
import { settingsUrl } from './routes'

export const adminSections = [
  { path: '/recruiter/playbook', label: 'Playbook', roles: ['owner', 'recruiter'] },
  { path: '/recruiter/overview', label: 'Overview', roles: ['owner', 'recruiter', 'reviewer', 'auditor'] },
  { path: '/recruiter/vacancies', label: 'Vacancies', roles: ['owner', 'recruiter'] },
  { path: '/recruiter/applications', label: 'Applications', roles: ['owner', 'recruiter', 'reviewer'] },
  { path: '/recruiter/communications', label: 'Communications', roles: ['owner', 'recruiter'] },
  { path: '/recruiter/compliance', label: 'Compliance', roles: ['owner', 'recruiter', 'auditor'] },
  { path: '/recruiter/settings', label: 'Settings', roles: ['owner', 'recruiter'] },
]
export const canAccessAdmin = (path: string, role: Role) => adminSections.find(s => s.path === path)?.roles.includes(role) ?? false
export function AdminNav({ role, scope }: { role: Role; scope: Scope }) {
  return <nav aria-label="Administration" className="my-4 flex flex-wrap gap-3">{adminSections.filter(s => s.roles.includes(role)).map(s => <NavLink end key={s.path} to={s.path === '/recruiter/settings' ? settingsUrl(scope) : s.path + '?' + new URLSearchParams(scope)} className={({ isActive }) => 'inline-flex min-h-[44px] items-center rounded border px-3 ' + (isActive ? 'font-bold underline' : '')}>{s.label}</NavLink>)}</nav>
}
