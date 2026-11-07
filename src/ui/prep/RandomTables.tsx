/**
 * Random tables: roll on the rules pack's tables, into chat or just for the GM. Used from Play
 * (the GM drawer) and the palette.
 */
import { useMemo, useState } from 'react'
import type { GameController } from '../controller'
import { newSeed } from '@/dice'
import { formatTableRoll, rollTable, tableTitle } from './tables'

export function RandomTables({ controller }: { controller: GameController }) {
  const rules = controller.rules
  const tables = useMemo(() => Object.keys(rules?.pack.chargen?.tables ?? {}), [rules])
  const [table, setTable] = useState(tables[0] ?? '')
  const [toChat, setToChat] = useState(true)
  const [last, setLast] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (!rules || tables.length === 0) return <p className="muted small">This pack has no random tables.</p>

  const roll = async () => {
    const id = table || tables[0]!
    setBusy(true)
    try {
      const text = formatTableRoll(await rollTable(rules, id, newSeed()))
      setLast(text)
      if (toChat) await controller.dispatch({ type: 'chat.say', text })
    } catch (e) { setLast(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  return (
    <div className="props" style={{ borderTop: 'none', paddingTop: 0 }}>
      <label>Table
        <select value={table || tables[0]} onChange={(e) => setTable(e.target.value)}>
          {tables.map((t) => <option key={t} value={t}>{tableTitle(t)} ({rules.pack.chargen!.tables[t]!.die})</option>)}
        </select>
      </label>
      <label className="check"><input type="checkbox" checked={toChat} onChange={(e) => setToChat(e.target.checked)} /> Post the result to chat</label>
      <button className="primary wide" disabled={busy} onClick={() => void roll()}>{busy ? 'Rolling…' : 'Roll'}</button>
      {last && <p className="small" style={{ margin: 0, padding: 'var(--sp-2)', background: 'var(--panel-2)', borderRadius: 'var(--r-sm)', overflowWrap: 'anywhere' }}>{last}</p>}
    </div>
  )
}

/** The Tables card (GM drawer): the same roller in a panel body. */
export function RandomTablesPanel({ controller }: { controller: GameController }) {
  return <div className="panel"><RandomTables controller={controller} /></div>
}
