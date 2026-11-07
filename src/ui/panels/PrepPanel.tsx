/**
 * GM prep: generate NPCs near the camera (hidden until revealed), browse the pack's creature
 * compendium and the game's own stat blocks, build and place encounters (saved in the game),
 * roll on the pack's random tables into chat, and add props to the scene.
 */
import { useState, type ReactNode } from 'react'
import type { GameController } from '../controller'
import { useGame } from '@/state/store'
import { newEncounter, newRow } from '../prep/encounters'
import { NpcGenerator } from '../prep/NpcGenerator'
import { RandomTables } from '../prep/RandomTables'
import { pushToast } from '../toasts'
import { AddProp } from './ObjectPanel'
import { CreatureBrowser, StatBlockEditor, useCompendium } from './CreaturesPrep'
import { Encounters } from './EncountersPrep'

export function PrepPanel({ controller }: { controller: GameController }) {
  const meta = useGame((s) => s.meta)
  const noScene = !meta?.activeScene
  const scene = useGame((s) => (s.meta?.activeScene ? s.scenes[s.meta.activeScene] : undefined))
  const compendium = useCompendium(controller.rules)
  const hasCreatures = compendium.status !== 'none'
  const [openEncounter, setOpenEncounter] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)

  /** "Add" in the browser: into the open encounter, else a new one. */
  const addToEncounter = (ref: string, name: string) => {
    const s = useGame.getState()
    let e = openEncounter ? s.encounters[openEncounter] : undefined
    if (!e) {
      e = newEncounter(Object.keys(s.encounters).length)
      setOpenEncounter(e.id)
    }
    const next = { ...e, rows: [...e.rows, newRow(e.rows.length, { creatureRef: ref })] }
    void controller.dispatch({ type: 'encounter.upsert', encounter: next })
    pushToast({ text: `Added ${name} to ${next.name}`, ttl: 2500 })
  }

  return (
    <div className="panel">
      <h3>Prep</h3>
      {noScene && <p className="muted small">Activate a scene to place NPCs and encounters.</p>}
      {editing && <StatBlockEditor controller={controller} templateId={editing} compendium={compendium} onClose={() => setEditing(null)} />}
      <Section title="NPC generator" open><NpcGenerator controller={controller} disabled={noScene} compendium={compendium} /></Section>
      {hasCreatures && <Section title="Creatures"><CreatureBrowser controller={controller} compendium={compendium} onEdit={setEditing} onAdd={addToEncounter} /></Section>}
      <Section title="Encounters" open={!!openEncounter}>
        <Encounters controller={controller} disabled={noScene} compendium={compendium} open={openEncounter} setOpen={setOpenEncounter} onEditTemplate={setEditing} />
      </Section>
      <Section title="Random tables"><RandomTables controller={controller} /></Section>
      {meta?.activeScene && <Section title="Props"><AddProp controller={controller} sceneId={meta.activeScene} scene={scene} /></Section>}
    </div>
  )
}

function Section({ title, open, children }: { title: string; open?: boolean; children: ReactNode }) {
  return (
    <details open={open} style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--sp-1)', marginTop: 'var(--sp-2)' }}>
      <summary className="disclosure" style={{ fontWeight: 600 }}>{title}</summary>
      {children}
    </details>
  )
}

// ------------------------------------------------------------------------------- NPC generator
