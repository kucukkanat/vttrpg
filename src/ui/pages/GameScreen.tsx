import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSession } from '../session'
import { navigate } from '../router'
import { useGame } from '@/state/store'
import type { AssetRef } from '@/core/assets'
import { TableCanvas } from '@/table'
import { DiceTrayOverlay } from '@/dice'
import { TopBar } from '../panels/TopBar'
import { PANELS } from '../panels/registry'
import { useSkillTargeting } from '../panels/SkillsPanel'
import { useMediaQuery } from '../useMediaQuery'
import { sharedAudioEngine } from '@/audio'

export function GameScreen() {
  const { controller } = useSession()
  const meta = useGame((s) => s.meta)
  const chat = useGame((s) => s.chat)
  const [shownRoll, setShownRoll] = useState<string | null>(null)
  const narrow = useMediaQuery('(max-width: 900px)')
  const [tab, setTab] = useState<string>('table')
  const [seenChat, setSeenChat] = useState(0)
  useEffect(() => { if (!controller) navigate('/') }, [controller])

  // Animate the most recent roll once; clear the tray a few seconds after it settles.
  const lastRoll = useMemo(() => [...chat].reverse().find((m) => m.kind === 'roll' && m.roll?.dice.length), [chat])
  useEffect(() => { if (lastRoll?.roll && lastRoll.at > Date.now() - 15_000) setShownRoll(lastRoll.roll.seed) }, [lastRoll])
  useEffect(() => { if (tab === 'chat') setSeenChat(chat.length) }, [tab, chat.length])

  const targeting = useSkillTargeting(controller)
  const resolveAsset = useCallback((ref: AssetRef) => controller!.assets.resolve(ref), [controller])
  if (!controller) return null
  const viewer = { pubkey: controller.pubkey, isGm: controller.connection.isGm }
  const panels = PANELS.filter((p) => p.scope === 'all' || controller.connection.isGm)
  const unread = Math.max(0, chat.length - seenChat)

  const table = (
    <section className="table">
      {meta?.activeScene ? (
        <TableCanvas
          onIntent={(i) => void controller.dispatch(i)}
          onPresence={(p) => controller.presence(p)}
          resolveAsset={resolveAsset}
          viewer={viewer}
          targeting={targeting}
        />
      ) : (
        <div className="empty">No active scene. {controller.connection.isGm ? 'Add one from the Scenes panel.' : 'Waiting for the GM.'}</div>
      )}
      {shownRoll && (
        <DiceTrayOverlay
          rollId={shownRoll}
          dice={lastRoll?.roll?.dice ?? []}
          showRim={false}
          floor="shadow"
          onSettled={() => setTimeout(() => setShownRoll(null), 4000)}
          onImpact={(strength) => sharedAudioEngine({ resolve: resolveAsset }).diceImpact(strength)}
        />
      )}
    </section>
  )

  if (narrow) {
    const active = panels.find((p) => p.id === tab)
    return (
      <div className={`game narrow ${active ? 'with-panel' : ''}`}>
        <TopBar controller={controller} compact />
        {table}
        {active && (
          <section className="sheet-area" key={active.id}>
            <active.component controller={controller} />
          </section>
        )}
        <nav className="tabbar" aria-label="Panels">
          <button className={tab === 'table' ? 'on' : ''} onClick={() => setTab('table')}><span className="glyph">⬡</span><span>Table</span></button>
          {panels.map((p) => (
            <button key={p.id} className={tab === p.id ? 'on' : ''} onClick={() => setTab(tab === p.id ? 'table' : p.id)}>
              <span className="glyph">{p.glyph}</span><span>{p.short}</span>
              {p.id === 'chat' && unread > 0 && tab !== 'chat' && <span className="badge">{unread}</span>}
            </button>
          ))}
        </nav>
      </div>
    )
  }

  return (
    <div className="game">
      <TopBar controller={controller} />
      <aside className="left">
        {panels.filter((p) => p.side === 'left').map((p) => <p.component key={p.id} controller={controller} />)}
      </aside>
      {table}
      <aside className="right">
        {panels.filter((p) => p.side === 'right').map((p) => <p.component key={p.id} controller={controller} />)}
      </aside>
    </div>
  )
}
