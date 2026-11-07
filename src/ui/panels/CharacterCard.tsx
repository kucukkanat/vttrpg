/**
 * The character sheet at a glance: portrait, name, resource bars, attribute tiles that roll their
 * save or check, active conditions and a line of gear and notes. The full form is `SheetView`.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { AssetResolver } from '@/assets'
import type { Character, Token } from '@/core/doc'
import { sheetFor, type RulesEngine } from '@/rules'
import { getPath } from '@/rules/expr'
import { conditionChips, hpBand, HP_BAND_COLORS, readResource } from '@/table/tokenHud'
import { attributeTiles, cardLevel, cardSubtitle, formatMod, initials, inventorySummary, notesSummary } from './sheetCard'
import './CharacterCard.css'

export interface CharacterCardProps {
  rules: RulesEngine
  character: Character
  token: Pick<Token, 'color' | 'conditions'>
  assets: AssetResolver
  onRoll(formula: string, label: string): void
}

function usePortrait(assets: AssetResolver, portrait: Character['portrait']): string | null {
  const [url, setUrl] = useState<string | null>(null)
  // Keyed by hash: every doc update hands over a fresh ref object for the same image.
  const sha = portrait?.sha256
  const latest = useRef(portrait)
  latest.current = portrait
  useEffect(() => {
    const ref = latest.current
    let live = true
    setUrl(null)
    if (!ref) return
    assets.resolve(ref).then((u) => { if (live) setUrl(u) }, () => { if (live) setUrl(null) })
    return () => { live = false; assets.release(ref) }
  }, [assets, sha])
  return url
}

export function CharacterCard({ rules, character, token, assets, onRoll }: CharacterCardProps) {
  const { pack } = rules
  const portrait = usePortrait(assets, character.portrait)
  const compute = useMemo(() => (expr: string) => rules.evaluateNow(expr, character), [rules, character])
  const sheet = sheetFor(pack, character)
  const subtitle = cardSubtitle(sheet, character)
  // Creatures show their challenge rating where characters show a level.
  const crPath = character.sheet && character.sheet === pack.manifest.creatures?.sheet ? pack.manifest.creatures.crText : undefined
  const cr = crPath ? getPath(character.data, crPath.split('.')) : undefined
  const level = crPath ? null : cardLevel(character)
  const resources = pack.resources
    .map((def, i) => ({ def, primary: i === 0, reading: readResource(character.data, def, compute) }))
    .filter((r) => r.reading !== null)
  const tiles = attributeTiles(sheet, pack.attributes, character, compute)
  const chips = conditionChips(token, character, pack.conditions)
  const gear = inventorySummary(sheet, character)
  const notes = notesSummary(sheet, character)

  return (
    <div className="char-card">
      <header className="cc-head">
        {portrait ? (
          <img className="cc-portrait" src={portrait} alt="" />
        ) : (
          <div className="cc-portrait cc-initials" style={{ background: token.color }} aria-hidden>{initials(character.name)}</div>
        )}
        <div className="cc-ident">
          <div className="cc-name">{character.name}</div>
          {(subtitle || level !== null || cr !== undefined) && (
            <div className="cc-sub">
              {level !== null && <span className="cc-level">Lv {level}</span>}
              {(typeof cr === 'string' || typeof cr === 'number') && <span className="cc-level">CR {cr}</span>}
              {subtitle}
            </div>
          )}
        </div>
      </header>

      {resources.length > 0 && (
        <div className="cc-resources">
          {resources.map(({ def, primary, reading }) => {
            const { current, max } = reading!
            const pct = Math.min(100, Math.max(0, (current / max) * 100))
            const color = primary ? HP_BAND_COLORS[hpBand(current, max)] : 'var(--accent)'
            return (
              <div key={def.id} className={`cc-res${primary ? ' primary' : ''}`}>
                <div className="cc-res-row">
                  <span className="cc-res-name">{def.name}</span>
                  <span className="cc-res-val">{current}<span className="muted"> / {max}</span></span>
                </div>
                <div className="cc-bar" role="meter" aria-label={def.name} aria-valuemin={0} aria-valuemax={max} aria-valuenow={current}>
                  <div className="cc-fill" style={{ width: `${pct}%`, background: color }} />
                </div>
              </div>
            )
          })}
        </div>
      )}

      {tiles.length > 0 && (
        <div className="cc-tiles">
          {tiles.map((t) => {
            const body = (
              <>
                <span className="cc-abbr">{t.abbr}</span>
                <span className="cc-value">{t.value ?? '—'}{t.max !== null && <span className="cc-max">/{t.max}</span>}</span>
                {t.mod !== null && <span className="cc-mod">{formatMod(t.mod)}</span>}
              </>
            )
            return t.roll ? (
              <button key={t.id} type="button" className="cc-tile" title={`Roll ${t.roll.label}`} aria-label={`${t.name} ${t.value ?? ''}, roll ${t.roll.label}`} onClick={() => onRoll(t.roll!.formula, t.roll!.label)}>
                {body}
              </button>
            ) : (
              <div key={t.id} className="cc-tile" title={t.name}>{body}</div>
            )
          })}
        </div>
      )}

      {chips.length > 0 && (
        <div className="cc-chips">
          {chips.map((c) => (
            <span key={c.id} className="cc-chip" style={{ ['--chip' as string]: c.color }}>{c.name}</span>
          ))}
        </div>
      )}

      {(gear.length > 0 || notes) && (
        <div className="cc-summary">
          {gear.map((g) => (
            <p key={g.label} className="cc-line"><span className="muted">{g.label}:</span> {g.text}</p>
          ))}
          {notes && <p className="cc-line"><span className="muted">Notes:</span> {notes}</p>}
        </div>
      )}
    </div>
  )
}
