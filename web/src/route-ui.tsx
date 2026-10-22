import { Component, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

export function LoadingState({ children = 'Loading…' }: { children?: ReactNode }) { return <p role="status" className="p-4">{children}</p> }
export function EmptyState({ children }: { children: ReactNode }) { return <p className="p-4">{children}</p> }
export function ErrorState({ children = 'This page could not be loaded.', retry }: { children?: ReactNode; retry?: () => void }) { return <div role="alert" className="p-4"><p>{children}</p>{retry && <button className="min-h-[44px] min-w-[44px] underline" onClick={retry}>Retry</button>}</div> }
export function NotFound({ children = 'The page is missing or unavailable to your account.' }: { children?: ReactNode }) { return <section className="p-6"><h1 className="text-2xl font-semibold">404 — Not found</h1><p>{children}</p><Link className="inline-flex min-h-[44px] items-center underline" to="/vacancies">Browse vacancies</Link></section> }
export class RouteBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? <ErrorState retry={() => window.location.reload()}>Something went wrong while displaying this page.</ErrorState> : this.props.children }
}

export function AccessDenied() { return <section role="alert" className="p-6"><h1 className="text-2xl font-semibold">Access denied</h1><p>Your current workspace role does not permit this section. Ask the organization creator or brand owner to review your grants.</p></section> }
