import { NavLink } from 'react-router-dom'
import type { Role, Scope } from './api'

export const adminSections = [
  { path: '/admin', label: 'Dashboard', roles: ['owner', 'recruiter', 'reviewer', 'auditor'] },
  { path: '/applications', label: 'Applications', roles: ['owner', 'recruiter', 'reviewer', 'auditor'] },
  { path: '/admin/communications', label: 'Communications', roles: ['owner', 'recruiter'] },
  { path: '/admin/operations', label: 'Operations', roles: ['owner', 'recruiter', 'auditor'] },
  { path: '/admin/compliance', label: 'Compliance', roles: ['owner', 'auditor'] },
  { path: '/admin/settings', label: 'Settings', roles: ['owner'] },
]
export const canAccessAdmin = (path: string, role: Role) => adminSections.find(s => s.path === path)?.roles.includes(role) ?? false
export function AdminNav({ role, scope }: { role: Role; scope: Scope }) {
  return <nav aria-label="Administration" className="my-4 flex flex-wrap gap-3">{adminSections.filter(s => s.roles.includes(role)).map(s => <NavLink end key={s.path} to={s.path + '?' + new URLSearchParams(scope)} className={({ isActive }) => 'inline-flex min-h-[44px] items-center rounded border px-3 ' + (isActive ? 'font-bold underline' : '')}>{s.label}</NavLink>)}</nav>
}
