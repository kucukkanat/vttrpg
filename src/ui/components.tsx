import type { ReactNode } from 'react'

export function Shell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="shell">
      <h1>{title}</h1>
      {children}
    </main>
  )
}
