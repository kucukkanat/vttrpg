/**
 * The eyedropper: pick a prop's model up again, with its turn, tilt and scale, so the next click
 * stamps another one just like it. Used by the Build tray's eyedropper tool (PlaceLayer) and by
 * Alt-click on a prop while the GM's Edit toggle is on (propPointer.ts).
 */
import type { Prop } from '@/core/doc'
import { propScale } from '@/core/props'
import { partsOf } from '@/core/catalogueParts'
import { knownLegacyFit } from '../propMigration'
import { useTableUi } from '../tableState'
import { pickUpModel, useBuildUi } from './buildState'
import type { HeldModel } from './placement'

/** The held model as a stamp of this prop: its model, catalogue id, tilt and scale. */
export function heldFromProp(p: Prop): HeldModel {
  return {
    ...(p.catalogue ? { catalogue: p.catalogue } : {}),
    title: p.name,
    model: p.model,
    tilt: { x: p.rotation.x, z: p.rotation.z },
    scale: { ...propScale(p, knownLegacyFit(p.id) ?? 1) },
    ...(partsOf(p) ? { fixtures: partsOf(p)! } : {}),
  }
}

/** Pick a prop's model up again, keeping its turn and scale. */
export function eyedrop(p: Prop): void {
  pickUpModel(heldFromProp(p), p.rotation.y)
}

/** Alt-click on a prop while building (and not holding a model, where Alt means free placement). */
export function wantsEyedrop(e: { altKey: boolean; button: number }): boolean {
  return e.altKey && e.button === 0 && useTableUi.getState().buildMode && useBuildUi.getState().tool !== 'place'
}
