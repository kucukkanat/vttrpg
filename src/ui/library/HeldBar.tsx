/**
 * While a model is in hand (or the eyedropper is on): a small bar over the board with what is
 * held, its turn, and buttons to turn it and put it down. Phones have no R key or wheel, so this
 * is how they turn the ghost before tapping the board.
 */
import { putDownModel, useBuildUi } from '@/table/build/buildState'
import { turnHeld, yawDegrees } from '@/table/build/placement'
import { Icon } from '../icons'
import { LibIcon } from './libraryIcons'
import './HeldBar.css'

export function HeldBar({ phone }: { phone: boolean }) {
  const tool = useBuildUi((s) => s.tool)
  const held = useBuildUi((s) => s.held)
  const yaw = useBuildUi((s) => s.yaw)
  const scatter = useBuildUi((s) => s.scatter)
  if (tool === 'eyedropper') {
    return (
      <div className="held-bar" role="status">
        <LibIcon name="dropper" size={16} />
        <span className="held-bar-name">Click a prop to pick its model up</span>
        <button type="button" className="tiny" onClick={putDownModel}>Cancel</button>
      </div>
    )
  }
  if (tool !== 'place' || !held) return null
  const turn = (big: boolean) => { const s = useBuildUi.getState(); s.set({ yaw: turnHeld(s.yaw, 1, big) }) }
  return (
    <div className="held-bar" role="status" aria-label={`Holding ${held.title}`}>
      <span className="held-bar-name">Holding {held.title}</span>
      <span className="held-bar-deg">{yawDegrees(yaw)}°{scatter ? ' · scatter' : ''}</span>
      <span className="held-bar-keys">{phone ? 'Tap the board to place' : 'Click places · R or wheel turns · Alt free · Esc'}</span>
      <button type="button" className="tiny" onClick={() => turn(false)} title="Turn 15° (R)" aria-label="Turn 15 degrees"><Icon name="rotate" size={14} /> 15°</button>
      <button type="button" className="tiny" onClick={() => turn(true)} title="Turn 90° (Shift+R)" aria-label="Turn 90 degrees">90°</button>
      <button type="button" className="tiny" onClick={putDownModel} title="Put it down (Esc or right-click)">Done</button>
    </div>
  )
}
