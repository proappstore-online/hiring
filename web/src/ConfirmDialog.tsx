import { secondaryButton } from './design-system'
import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'
import { button, panel } from './ui'

export function ConfirmDialog({ title, body, confirmLabel = 'Confirm', cancelLabel = 'Cancel', onConfirm, onCancel, variant = 'warning' }: { title: string; body: ReactNode; confirmLabel?: string; cancelLabel?: string; onConfirm: () => void; onCancel: () => void; variant?: 'danger' | 'warning' | 'info' }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const node = dialog.current!
    node.showModal()
    node.querySelector<HTMLButtonElement>('button')?.focus()
    return () => { node.close(); if (previous?.isConnected) previous.focus() }
  }, [])
  return <dialog ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} className={panel + ' w-[min(90vw,32rem)] text-[var(--ink)] backdrop:bg-black/50'} data-variant={variant} onCancel={e => { e.preventDefault(); onCancel() }} onKeyDown={e => {
    if (e.key === 'Enter') { e.preventDefault(); if ((e.target as HTMLElement).dataset.cancel) onCancel(); else onConfirm() }
    if (e.key === 'Tab') {
      const controls = Array.from(dialog.current!.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),a[href],select,textarea'))
      const first = controls[0], last = controls.at(-1)
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus() }
    }
  }}><h2 id={titleId} className="text-xl font-semibold">{title}</h2><div className="my-4">{body}</div><div className="flex flex-wrap gap-3"><button type="button" data-cancel="true" aria-label={cancelLabel} className={secondaryButton} onClick={onCancel}>{cancelLabel}</button><button type="button" aria-label={confirmLabel} className={variant === 'danger' ? secondaryButton : button} onClick={onConfirm}>{confirmLabel}</button></div></dialog>
}
