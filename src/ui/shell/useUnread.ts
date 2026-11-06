/** Messages appended since the chat was last visible. Resets while `open`. */
import { useEffect, useState } from 'react'

export function unreadCount(total: number, seen: number, open: boolean): number {
  return open ? 0 : Math.max(0, total - seen)
}

export function useUnread(total: number, open: boolean): number {
  const [seen, setSeen] = useState(total)
  useEffect(() => { if (open) setSeen(total) }, [open, total])
  return unreadCount(total, seen, open)
}
