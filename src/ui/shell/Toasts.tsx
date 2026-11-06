/**
 * Renders the toast stack from `ui/toasts.ts` at the bottom of the table. Mounted inside the HUD
 * (see Hud.tsx) so it stays above the tab bar on phones and inside the safe area everywhere.
 */
import { useToasts, type Toast } from '../toasts'
import '../toasts.css'

export function Toasts() {
  const toasts = useToasts((s) => s.toasts)
  const dismiss = useToasts((s) => s.dismiss)
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />)}
    </div>
  )
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss(): void }) {
  const act = () => {
    onDismiss()
    toast.action?.run()
  }
  return (
    <div className="toast-item">
      <span className="toast-text">{toast.text}</span>
      {toast.action && <button type="button" className="toast-action" onClick={act}>{toast.action.label}</button>}
      <button type="button" className="icon toast-close" aria-label="Dismiss" onClick={onDismiss}>×</button>
    </div>
  )
}
