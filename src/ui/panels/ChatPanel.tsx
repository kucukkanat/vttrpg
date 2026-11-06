import { useEffect, useRef, useState } from 'react'
import type { GameController } from '../controller'
import { useGame } from '@/state/store'
import { newSeed } from '@/dice'
import type { PlayerPubkey } from '@/core/ids'

export function ChatPanel({ controller }: { controller: GameController }) {
  const chat = useGame((s) => s.chat)
  const presence = useGame((s) => s.presence)
  const [text, setText] = useState('')
  const [to, setTo] = useState<string>('')
  const log = useRef<HTMLDivElement>(null)
  const me = controller.pubkey
  const name = (pk: string) => presence[pk]?.name ?? (pk === controller.connection.gm ? 'GM' : pk.slice(0, 6))

  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }) }, [chat.length])

  const send = async () => {
    const t = text.trim()
    if (!t) return
    setText('')
    const whisper = to ? [to as PlayerPubkey] : undefined
    if (t.startsWith('/r ') || t.startsWith('/roll ')) {
      await controller.dispatch({ type: 'roll', formula: t.replace(/^\/(r|roll)\s+/, ''), seed: newSeed() })
    } else if (t.startsWith('/w ')) {
      const [, who, ...rest] = t.split(' ')
      const target = Object.values(presence).find((p) => p.name.toLowerCase() === who?.toLowerCase())
      if (target) await controller.dispatch({ type: 'chat.say', text: rest.join(' '), to: [target.pubkey] })
      else setText(t)
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
      </div>
      <form className="chatform" onSubmit={(e) => { e.preventDefault(); void send() }}>
        <select value={to} onChange={(e) => setTo(e.target.value)} aria-label="Whisper to">
          <option value="">All</option>
          {Object.values(presence).filter((p) => p.pubkey !== me).map((p) => <option key={p.pubkey} value={p.pubkey}>{p.name}</option>)}
        </select>
        <input placeholder={to ? 'Whisper…' : 'Say something, or /r 2d6+1'} value={text} onChange={(e) => setText(e.target.value)} enterKeyHint="send" />
      </form>
    </div>
  )
}
