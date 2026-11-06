import { useEffect, useRef, useState } from 'react'
import type { GameController } from '../controller'
import { useGame } from '@/state/store'
import { newSeed } from '@/dice'
import type { PlayerPubkey } from '@/core/ids'
import { findWhisperTarget, type Person } from './chatNames'

const HELP = [
  '/r <formula> — roll dice, e.g. /r 2d6+1',
  '/w <name> <message> — whisper to someone; /w gm reaches the GM',
  '/help — this list',
]

export function ChatPanel({ controller }: { controller: GameController }) {
  const chat = useGame((s) => s.chat)
  const presence = useGame((s) => s.presence)
  const names = useGame((s) => s.meta?.names)
  const [text, setText] = useState('')
  const [to, setTo] = useState<string>('')
  const [notice, setNotice] = useState<string[] | null>(null)
  const log = useRef<HTMLDivElement>(null)
  const me = controller.pubkey
  const gm = controller.connection.gm

  // Self is never in presence; the GM may be known only by role; everyone else by presence, then last-seen name.
  const name = (pk: string) => {
    if (pk === me) return controller.displayName ?? 'You'
    const known = presence[pk]?.name ?? names?.[pk]
    if (known) return known
    return pk === gm ? 'GM' : pk.slice(0, 6)
  }

  /** Everyone a whisper could reach: people present, people seen before, and always the GM. */
  const people = (): Person[] => {
    const seen = new Map<string, Person>()
    for (const [pk, n] of Object.entries(names ?? {})) seen.set(pk, { pubkey: pk, name: n })
    for (const p of Object.values(presence)) seen.set(p.pubkey, { pubkey: p.pubkey, name: p.name })
    if (!seen.has(gm)) seen.set(gm, { pubkey: gm, name: 'GM' })
    seen.delete(me)
    return [...seen.values()]
  }

  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }) }, [chat.length, notice])

  const send = async () => {
    const t = text.trim()
    if (!t) return
    setText('')
    setNotice(null)
    const whisper = to ? [to as PlayerPubkey] : undefined
    if (t === '/help' || t.startsWith('/help ')) {
      setNotice(HELP)
    } else if (t.startsWith('/r ') || t.startsWith('/roll ')) {
      await controller.dispatch({ type: 'roll', formula: t.replace(/^\/(r|roll)\s+/, ''), seed: newSeed() })
    } else if (t.startsWith('/w ') || t.startsWith('/whisper ')) {
      const m = /^\/(?:w|whisper)\s+(\S+)\s*(.*)$/s.exec(t)
      const who = m?.[1] ?? ''
      const body = m?.[2]?.trim() ?? ''
      const found = findWhisperTarget(who, people(), gm)
      if (found.kind === 'none') {
        setNotice([`No one called ${who} is here.`])
        setText(t)
      } else if (found.kind === 'ambiguous') {
        setNotice([`Which ${who}? ${found.matches.map((p) => p.name).join(', ')}`])
        setText(t)
      } else if (!body) {
        setNotice([`Whisper what to ${found.person.name}? /w ${who} <message>`])
        setText(t)
      } else {
        await controller.dispatch({ type: 'chat.say', text: body, to: [found.person.pubkey as PlayerPubkey] })
      }
    } else if (t.startsWith('/')) {
      setNotice([`Unknown command ${t.split(' ')[0]}. Type /help for the list.`])
      setText(t)
    } else await controller.dispatch({ type: 'chat.say', text: t, to: whisper })
  }

  const mineOrPublic = chat.filter((m) => !m.to || m.author === me || m.to.includes(me as PlayerPubkey) || controller.connection.isGm)
  return (
    <div className="panel chat">
      <h3>Chat</h3>
      <div className="log" ref={log}>
        {mineOrPublic.map((m) => (
          <div key={m.id} className={`msg ${m.kind}`}>
            <span className="who">{name(m.author)}{m.to && <> → {m.to.map(name).join(', ')}</>}</span>{' '}
            {m.kind === 'roll' && m.roll ? (
              <span><em>{m.text}</em> → <strong>{m.roll.total}</strong> <span className="muted small">[{m.roll.dice.map((d) => d.value).join(', ')}]</span>
                {m.roll.outcome && 'success' in m.roll.outcome && <span className={m.roll.outcome.success ? 'ok' : 'bad'}> {m.roll.outcome.success ? 'success' : 'fail'}{m.roll.outcome.critical ? '!' : ''}</span>}
              </span>
            ) : m.text}
          </div>
        ))}
        {notice && (
          <div className="msg system chat-notice" role="status">
            {notice.map((line) => <div key={line}>{line}</div>)}
          </div>
        )}
      </div>
      <form className="chatform" onSubmit={(e) => { e.preventDefault(); void send() }}>
        <select value={to} onChange={(e) => setTo(e.target.value)} aria-label="Whisper to">
          <option value="">All</option>
          {people().map((p) => <option key={p.pubkey} value={p.pubkey}>{p.name}</option>)}
        </select>
        <input placeholder={to ? 'Whisper…' : 'Say something, /r 2d6+1, or /help'} value={text} onChange={(e) => setText(e.target.value)} enterKeyHint="send" />
      </form>
    </div>
  )
}
