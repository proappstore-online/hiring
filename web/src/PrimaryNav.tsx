import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import type { Role, Scope } from './api'
import { settingsUrl } from './routes'

const sections = [
  { path: '/recruiter/overview', label: 'Overview', roles: ['owner', 'recruiter', 'reviewer', 'auditor'] },
  { path: '/recruiter/vacancies', label: 'Vacancies', roles: ['owner', 'recruiter'] },
  { path: '/recruiter/applications', label: 'Applications', roles: ['owner', 'recruiter', 'reviewer'] },
  { path: '/recruiter/communications', label: 'Communications', roles: ['owner', 'recruiter'] },
  { path: '/recruiter/playbook', label: 'Playbook', roles: ['owner', 'recruiter'] },
  { path: '/recruiter/compliance', label: 'Compliance', roles: ['owner', 'recruiter', 'auditor'] },
  { path: '/recruiter/settings', label: 'Settings', roles: ['owner', 'recruiter'] },
] as const

export const primarySections = (role: Role) => sections.filter(section => (section.roles as readonly Role[]).includes(role))
const corePaths = new Set(['/recruiter/overview', '/recruiter/applications', '/recruiter/vacancies', '/recruiter/communications'])

export function PrimaryNav({ role, scope, currentPath }: { role: Role; scope: Scope; currentPath?: string }) {
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const path = currentPath ?? location.pathname
  useEffect(() => setOpen(false), [location.pathname, location.search])
  const items = primarySections(role)
  const active = (section: typeof sections[number]) => path === section.path ||
    (section.path === '/recruiter/settings' && (path.startsWith('/recruiter/organizations/') || path.startsWith('/recruiter/settings/'))) ||
    (section.path === '/recruiter/applications' && (path.startsWith('/recruiter/applications/') || path === '/recruiter/search' || path === '/recruiter/talent-pool')) ||
    (section.path === '/recruiter/vacancies' && path.startsWith('/recruiter/vacancies/'))
  const link = (section: typeof sections[number]) => <Link key={section.path} to={section.path === '/recruiter/settings' ? settingsUrl(scope) : section.path + '?' + new URLSearchParams(scope)} aria-current={active(section) ? 'page' : undefined} onClick={() => setOpen(false)} className={'inline-flex min-h-11 items-center rounded px-3 text-sm hover:bg-[var(--line)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ' + (active(section) ? 'bg-[var(--line)] font-bold underline' : '')}>{section.label}</Link>
  const core = items.filter(section => corePaths.has(section.path))
  const more = items.filter(section => !corePaths.has(section.path))
  const mobileLinks = <>{items.map(link)}<Link to="/vacancies" onClick={() => setOpen(false)} className="inline-flex min-h-11 items-center rounded border border-[var(--line)] px-3 text-sm hover:bg-[var(--line)]">Public vacancies</Link></>
  return <nav aria-label="Primary navigation" className="relative min-w-0" onKeyDown={event => { if (event.key === 'Escape') setOpen(false) }}>
    <button type="button" aria-label="Toggle primary navigation" aria-controls="primary-navigation-menu" aria-expanded={open} onClick={() => setOpen(value => !value)} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded border border-[var(--line)] text-xl md:hidden">☰</button>
    <div id="primary-navigation-menu" className={(open ? 'flex ' : 'hidden ') + 'absolute right-0 top-full z-50 mt-2 min-w-56 flex-col gap-1 rounded border border-[var(--line)] bg-[var(--panel)] p-2 shadow-lg md:hidden'}>{mobileLinks}</div>
    <div className="hidden flex-wrap items-center gap-1 md:flex">{core.map(link)}{more.length > 0 && <details className="relative"><summary className={'inline-flex min-h-11 cursor-pointer list-none items-center rounded px-3 text-sm hover:bg-[var(--line)] ' + (more.some(active) ? 'bg-[var(--line)] font-bold underline' : '')}>More</summary><div className="absolute right-0 z-50 mt-2 flex min-w-48 flex-col gap-1 rounded border border-[var(--line)] bg-[var(--panel)] p-2 shadow-lg">{more.map(link)}</div></details>}<Link to="/vacancies" className="inline-flex min-h-11 items-center rounded border border-[var(--line)] px-3 text-sm hover:bg-[var(--line)]">Public vacancies</Link></div>
  </nav>
}
