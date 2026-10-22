import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import type { Role, Scope } from './api'

const sections = [
  { path: '/recruiter/overview', label: 'Overview', roles: ['owner', 'recruiter', 'reviewer', 'auditor'] },
  { path: '/recruiter/vacancies', label: 'Vacancies', roles: ['owner', 'recruiter'] },
  { path: '/recruiter/applications', label: 'Applications', roles: ['owner', 'recruiter', 'reviewer'] },
  { path: '/recruiter/communications', label: 'Communications', roles: ['owner', 'recruiter'] },
  { path: '/recruiter/playbook', label: 'Playbook', roles: ['owner', 'recruiter'] },
  { path: '/recruiter/operations', label: 'Operations', roles: ['owner', 'recruiter'] },
  { path: '/recruiter/compliance', label: 'Compliance', roles: ['owner', 'recruiter', 'auditor'] },
  { path: '/recruiter/settings', label: 'Settings', roles: ['owner'] },
] as const

export const primarySections = (role: Role) => sections.filter(section => (section.roles as readonly Role[]).includes(role))

export function PrimaryNav({ role, scope, currentPath }: { role: Role; scope: Scope; currentPath?: string }) {
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const path = currentPath ?? location.pathname
  useEffect(() => setOpen(false), [location.pathname, location.search])
  const items = primarySections(role)
  const active = (section: typeof sections[number]) => path === section.path ||
    (section.path === '/recruiter/applications' && path.startsWith('/recruiter/applications/')) ||
    (section.path === '/recruiter/vacancies' && path.startsWith('/recruiter/vacancies/'))
  const links = <>{items.map(section => <Link key={section.path} to={section.path + '?' + new URLSearchParams(scope)} aria-current={active(section) ? 'page' : undefined} onClick={() => setOpen(false)} className={'inline-flex min-h-11 items-center rounded px-3 text-sm hover:bg-[var(--line)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ' + (active(section) ? 'bg-[var(--line)] font-bold underline' : '')}>{section.label}</Link>)}<Link to="/jobs" onClick={() => setOpen(false)} className="inline-flex min-h-11 items-center rounded border border-[var(--line)] px-3 text-sm hover:bg-[var(--line)]">Switch to Public Jobs</Link></>
  return <nav aria-label="Primary navigation" className="relative min-w-0" onKeyDown={event => { if (event.key === 'Escape') setOpen(false) }}>
    <button type="button" aria-label="Toggle primary navigation" aria-controls="primary-navigation-menu" aria-expanded={open} onClick={() => setOpen(value => !value)} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded border border-[var(--line)] text-xl md:hidden">☰</button>
    <div id="primary-navigation-menu" className={(open ? 'flex ' : 'hidden ') + 'absolute right-0 top-full z-50 mt-2 min-w-56 flex-col gap-1 rounded border border-[var(--line)] bg-[var(--panel)] p-2 shadow-lg md:hidden'}>{links}</div>
    <div className="hidden flex-wrap items-center gap-1 md:flex">{links}</div>
  </nav>
}
