import { useState } from 'react'
import type { GameController } from '../controller'
import { useGame } from '@/state/store'
import { newSeed } from '@/dice'

export function ChatPanel({ controller }: { controller: GameController }) {
  const chat = useGame((s) => s.chat)
  const [text, setText] = useState('')
  const send = async () => {
    const t = text.trim()
    if (!t) return
    setText('')
    if (t.startsWith('/r ') || t.startsWith('/roll ')) {
      const formula = t.replace(/^\/(r|roll)\s+/, '')
      await controller.dispatch({ type: 'roll', formula, seed: newSeed() })
    } else await controller.dispatch({ type: 'chat.say', text: t })
  }
  return (
    <div className="panel chat">
      <h3>Chat</h3>
      <div className="log">
        {chat.map((m) => (
          <div key={m.id} className={`msg ${m.kind}`}>
            <span className="who">{m.author.slice(0, 6)}</span>{' '}
            {m.kind === 'roll' && m.roll ? (
              <span><em>{m.text}</em> → <strong>{m.roll.total}</strong> <span className="muted small">[{m.roll.dice.map((d) => d.value).join(', ')}]</span></span>
            ) : m.text}
          </div>
        ))}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); void send() }}>
        <input placeholder="Say something, or /r 2d6+1" value={text} onChange={(e) => setText(e.target.value)} />
      </form>
    </div>
  )
}
