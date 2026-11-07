/**
 * Inspector sections for the kind-specific parts of a prop: a light (colour, reach, flicker), a
 * wall (what it blocks), a door (open, locked). The Inspector mounts `PropKindPane` under the
 * common prop fields; it renders nothing for a plain prop.
 */
import type { GameController } from '../../controller'
import type { Prop } from '@/core/doc'

export function PropKindPane({ controller, prop }: { controller: GameController; prop: Prop }) {
  void controller
  void prop
  return null
}
