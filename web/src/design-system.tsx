import type { ReactNode } from 'react'

/** One route heading and one visually dominant action. Use secondaryButton elsewhere. */
export function Page({ title, children, action, titleId }: { title: string; children: ReactNode; action?: ReactNode; titleId?: string }) {
  return <section className="hiring-page"><header className="hiring-page-header"><h1 id={titleId}>{title}</h1>{action}</header>{children}</section>
}
export function Toolbar({ label, children }: { label: string; children: ReactNode }) {
  return <div role="group" aria-label={label} className="hiring-toolbar">{children}</div>
}
export function FilterPanel({ id, expanded, children }: { id: string; expanded: boolean; children: ReactNode }) {
  return <div id={id} className={'hiring-filters ' + (expanded ? 'grid' : 'hidden') + ' md:grid'}>{children}</div>
}
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="hiring-section"><h2>{title}</h2>{children}</section>
}
export function Help({ title = 'More information', children }: { title?: string; children: ReactNode }) {
  return <details className="hiring-help"><summary>{title}</summary>{children}</details>
}
export const recordRow = 'hiring-record-row'
export const secondaryButton = 'hiring-secondary disabled:opacity-50'
