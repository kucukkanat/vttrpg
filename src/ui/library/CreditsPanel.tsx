/**
 * Scene credits (reports/Level design plan.md, Phase 3 item 4): every model in the live scene
 * that must be credited (CC BY, CC BY-SA) or comes from Poly Haven or Sketchfab, with its author,
 * licence and source. Everyone can open it, as CC BY and Sketchfab's terms require. When nothing
 * needs a credit it says so in one line.
 */
import { useMemo } from 'react'
import type { GameController } from '../controller'
import { LICENCE_LABELS, type LicenceId } from '@/core/catalogue'
import { useGame } from '@/state/store'
import { sceneCredits } from './libraryLogic'
import { useBuiltinCatalogue, useCatalogueIndex } from './useCatalogue'

const LICENCE_URLS: Partial<Record<LicenceId, string>> = {
  cc0: 'https://creativecommons.org/publicdomain/zero/1.0/',
  'cc-by': 'https://creativecommons.org/licenses/by/4.0/',
  'cc-by-sa': 'https://creativecommons.org/licenses/by-sa/4.0/',
}

const safeUrl = (u: string | undefined) => (u && /^https?:\/\//i.test(u) ? u : undefined)

function Link({ href, children }: { href?: string; children: React.ReactNode }) {
  const url = safeUrl(href)
  return url ? <a href={url} target="_blank" rel="noopener noreferrer">{children}</a> : <>{children}</>
}

export function CreditsPanel(_: { controller: GameController }) {
  const builtin = useBuiltinCatalogue()
  const index = useCatalogueIndex()
  const props = useGame((s) => s.props)
  const sceneId = useGame((s) => s.meta?.activeScene ?? null)
  const sceneName = useGame((s) => (sceneId ? s.scenes[sceneId]?.name : undefined))
  const { credits, models } = useMemo(() => sceneCredits(props, sceneId, (id) => index.get(id)), [props, sceneId, index])
  const polyhaven = credits.some((e) => e.origin === 'polyhaven')
  const sketchfab = credits.some((e) => e.origin === 'sketchfab')

  if (!sceneId) return <div className="panel"><p className="muted small">No scene is live.</p></div>
  if (builtin === null) return <div className="panel"><p className="muted small">Loading…</p></div>
  return (
    <div className="panel credits-panel">
      {credits.length === 0 ? (
        <p className="muted small">{models ? `All models in ${sceneName ?? 'this scene'} are CC0: no credit needed.` : 'No library models in this scene.'}</p>
      ) : (
        <>
          <p className="muted small">Models in {sceneName ?? 'this scene'} by:</p>
          <ul className="list credits-list">
            {credits.map((e) => (
              <li key={e.id} className="credits-row" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', textAlign: 'left', gap: 2, padding: '4px 0' }}>
                <strong><Link href={e.licence.sourceUrl}>{e.title}</Link></strong>
                <span className="small">
                  {e.licence.author ? <>by <Link href={e.licence.authorUrl}>{e.licence.author}</Link></> : 'Author unknown'}
                  {' · '}<Link href={LICENCE_URLS[e.licence.id]}>{LICENCE_LABELS[e.licence.id] ?? e.licence.id}</Link>
                  {e.licence.source && <> · <Link href={e.licence.sourceUrl}>{e.licence.source}</Link></>}
                </span>
              </li>
            ))}
          </ul>
          {(polyhaven || sketchfab) && (
            <p className="muted small">
              {polyhaven && <>Powered by <Link href="https://polyhaven.com">Poly Haven</Link>. </>}
              {sketchfab && <>Models from <Link href="https://sketchfab.com">Sketchfab</Link>.</>}
            </p>
          )}
        </>
      )}
    </div>
  )
}

export default CreditsPanel
