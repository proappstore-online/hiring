import { useEffect, useState } from 'react'
import { initPro, ProShell, PageHeader, type NavItem } from '@proappstore/sdk'

const app = initPro({ appId: 'hiring' })

type RuntimeGate = {
  intake_status: 'closed' | 'open'
  reason_code: string
  updated_at: number
}

const NAV: NavItem[] = [
  { label: 'Home', href: '/', title: 'Hiring' },
  { label: 'About', href: '/about', title: 'About Hiring' },
]

export default function App() {
  return (
    <ProShell app={app} appName="hiring" nav={NAV} branding="app">
      <Screens />
    </ProShell>
  )
}

function Screens() {
  return window.location.pathname === '/about' ? <About /> : <Home />
}

function Home() {
  const [gate, setGate] = useState<RuntimeGate | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    app.actions.callPublic<{ rows: RuntimeGate[] }>('get_hiring_runtime_gate')
      .then(({ rows }) => { if (active) setGate(rows[0] ?? null) })
      .catch(() => { if (active) setGate(null) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  const available = gate?.intake_status === 'open'
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <PageHeader title="Hiring" description="A private workspace for recruiting across distinct brands." />
      <section className="mt-8 rounded-xl border border-[var(--line-strong)] bg-[var(--panel)] p-6" aria-live="polite">
        <h2 className="text-lg font-semibold">Candidate applications</h2>
        <p className="mt-2 text-sm text-[var(--muted)]">
          {loading ? 'Checking availability…' : available
            ? 'Application intake is being prepared. No application form is available yet.'
            : 'Application intake is currently closed. Please check back later.'}
        </p>
      </section>
    </div>
  )
}

function About() {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <PageHeader title="About Hiring" description="A multi-brand applicant tracking system in development." />
      <p className="text-sm text-[var(--muted)]">
        The recruiting workspace and candidate application process are not available yet.
      </p>
    </div>
  )
}
