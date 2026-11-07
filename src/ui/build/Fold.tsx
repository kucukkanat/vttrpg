/** One Inspector section: a disclosure that starts folded and remembers its state per device (folds.ts). */
import type { ReactNode } from 'react'
import { useFolds } from './folds'

export function Fold({ id, title, summary, children }: { id: string; title: string; summary?: ReactNode; children: ReactNode }) {
  const open = useFolds((s) => !!s.open[id])
  const setOpen = useFolds((s) => s.setOpen)
  return (
    <details className="bw-fold" open={open} onToggle={(e) => setOpen(id, (e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="disclosure bw-fold-head">
        <span className="bw-fold-title">{title}</span>
        {summary != null && summary !== '' && <span className="muted small bw-fold-sum">{summary}</span>}
      </summary>
      {open && <div className="bw-fold-body">{children}</div>}
    </details>
  )
}
