import type { FormEvent, ReactNode } from 'react'

export const date = (ms: number) => new Date(ms).toLocaleString()
export const field = 'w-full rounded-lg border border-[var(--line-strong)] bg-[var(--paper)] px-3 py-2 text-sm'
export const panel = 'rounded-xl border border-[var(--line-strong)] bg-[var(--panel)] p-5'
export const button = 'rounded-lg bg-[var(--ink)] px-4 py-2 text-sm font-medium text-[var(--paper)] disabled:opacity-50'
export function Form({ children, onSubmit, busy }: { children: ReactNode; onSubmit: (data: FormData) => void; busy: boolean }) {
  return <form className="mt-4 space-y-3" onSubmit={(e: FormEvent<HTMLFormElement>) => { e.preventDefault(); onSubmit(new FormData(e.currentTarget)) }}>{children}<button className={button} disabled={busy} type="submit" aria-label="Save form">{busy ? 'Saving…' : 'Save'}</button></form>
}
export function TextField({ name, label, required = true, type = 'text', defaultValue }: { name: string; label: string; required?: boolean; type?: string; defaultValue?: string }) { return <label className="block text-sm"><span className="mb-1 block font-medium">{label}</span><input className={field} aria-label={label} name={name} type={type} required={required} defaultValue={defaultValue} /></label> }
export function MultilineField({ name, label }: { name: string; label: string }) { return <label className="block text-sm"><span className="mb-1 block font-medium">{label}</span><textarea className={field} aria-label={label} name={name} required rows={3} /></label> }
export const val = (f: FormData, k: string) => String(f.get(k) ?? '').trim()
export function History({ items }: { items: string[] }) { return <ul className="mt-4 space-y-2 text-xs text-[var(--muted)]">{items.map((s,i) => <li key={i} className="whitespace-pre-wrap rounded-lg border border-[var(--line)] p-2">{s}</li>)}</ul> }
