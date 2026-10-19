import { initPro, ProShell, PageHeader, useAuth, type NavItem } from '@proappstore/sdk'

const app = initPro({ appId: 'APPNAME' })

/**
 * The app's screens. ProShell renders them as its main navigation — a
 * <nav aria-label="Main"> in the topbar that marks the current screen and
 * collapses to a menu on small screens — and uses each `title` as the tab title.
 * Add a screen here and in <Screens />; never put navigation on a page.
 */
const NAV: NavItem[] = [
  { label: 'Home', href: '/', title: 'APPNAME' },
  { label: 'About', href: '/about', title: 'About — APPNAME' },
]

export default function App() {
  return (
    <ProShell app={app} appName="APPNAME" nav={NAV} branding="app">
      <Screens />
    </ProShell>
  )
}

/** Nav items are plain links: a click loads the path and the platform serves the app for it. */
function Screens() {
  switch (window.location.pathname) {
    case '/about': return <About />
    default: return <Home />
  }
}

function Home() {
  const { user } = useAuth()

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <PageHeader title="APPNAME" description={`Signed in as ${user?.name ?? 'you'}.`} />
      <p className="text-sm text-[var(--muted)]">
        Edit <code className="rounded bg-[var(--line)] px-1.5 py-0.5 text-xs">web/src/App.tsx</code> to start building.
        Each screen starts with a <code className="rounded bg-[var(--line)] px-1.5 py-0.5 text-xs">PageHeader</code> and is listed in <code className="rounded bg-[var(--line)] px-1.5 py-0.5 text-xs">NAV</code>.
      </p>
    </div>
  )
}

function About() {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <PageHeader title="About" description="What APPNAME is for." />
      <p className="text-sm text-[var(--muted)]">
        Replace this screen with your own. The error boundary, loading fallback, toasts
        (<code className="rounded bg-[var(--line)] px-1.5 py-0.5 text-xs">useToast</code>), offline banner and skip link come with ProShell.
      </p>
    </div>
  )
}
