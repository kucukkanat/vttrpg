import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSession } from '../session'
import { navigate } from '../router'
import { useGame } from '@/state/store'
import type { AssetRef } from '@/core/assets'
import { TableCanvas } from '@/table'
import { DiceTrayOverlay } from '@/dice'
import { ChatPanel } from '../panels/ChatPanel'
import { TokensPanel } from '../panels/TokensPanel'
import { PlayersPanel } from '../panels/PlayersPanel'
import { ScenesPanel } from '../panels/ScenesPanel'
import { CharacterPanel } from '../panels/CharacterPanel'
import { SkillsPanel, useSkillTargeting } from '../panels/SkillsPanel'
import { TopBar } from '../panels/TopBar'

export function GameScreen() {
  const { controller } = useSession()
  const meta = useGame((s) => s.meta)
  const chat = useGame((s) => s.chat)
  const [shownRoll, setShownRoll] = useState<string | null>(null)
  const targeting = useSkillTargeting(controller)
  useEffect(() => { if (!controller) navigate('/') }, [controller])

  // Animate the most recent roll once; clear the tray a few seconds after it settles.
  const lastRoll = useMemo(() => [...chat].reverse().find((m) => m.kind === 'roll' && m.roll?.dice.length), [chat])
  useEffect(() => { if (lastRoll?.roll && lastRoll.at > Date.now() - 15_000) setShownRoll(lastRoll.roll.seed) }, [lastRoll])

  const resolveAsset = useCallback((ref: AssetRef) => controller!.assets.resolve(ref), [controller])
  if (!controller) return null
  const viewer = { pubkey: controller.pubkey, isGm: controller.connection.isGm }

  return (
    <div className="game">
      <TopBar controller={controller} />
      <aside className="left">
        <ScenesPanel controller={controller} />
        <TokensPanel controller={controller} />
        <PlayersPanel controller={controller} />
      </aside>
      {/* min-height 0 lets the grid row shrink below the canvas's pixel height at phone widths */}
      <section className="table" style={{ minHeight: 0 }}>
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
        <DiceTrayOverlay
          rollId={shownRoll}
          dice={lastRoll?.roll?.dice ?? []}
          onSettled={() => setTimeout(() => setShownRoll(null), 4000)}
        />
      </section>
      {/* min-height keeps the column on screen at phone widths, where the grid row would otherwise collapse */}
      <aside className="right" style={{ minHeight: '35vh' }}>
        <CharacterPanel controller={controller} />
        <SkillsPanel controller={controller} />
        <ChatPanel controller={controller} />
      </aside>
    </div>
  )
}
