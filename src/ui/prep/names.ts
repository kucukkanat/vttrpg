/** Small NPC name lists per pack, with a generic fantasy fallback. */

const MOUSE_FIRST = ['Pip', 'Bramble', 'Thistle', 'Hazel', 'Wren', 'Clover', 'Nettle', 'Barley', 'Fennel', 'Moss', 'Sorrel', 'Tansy', 'Rook', 'Acorn', 'Juniper', 'Dandelion']
const MOUSE_LAST = ['Thornfoot', 'Ashwhisker', 'Burrowell', 'Quickpaw', 'Seedsworth', 'Longtail', 'Nutmeg', 'Greywhisker', 'Hollowbark', 'Dewdrop']

const FANTASY_FIRST = ['Aldric', 'Brenna', 'Cedric', 'Dara', 'Edwin', 'Faye', 'Gareth', 'Hilda', 'Ivo', 'Jorunn', 'Kael', 'Lyra', 'Marek', 'Nessa', 'Orin', 'Petra', 'Rowan', 'Sigrid', 'Tomas', 'Una']
const FANTASY_LAST = ['Blackwood', 'Carver', 'Dunmore', 'Fairweather', 'Greymoor', 'Hawthorne', 'Ironside', 'Marsh', 'Redfern', 'Stonebridge', 'Thatcher', 'Underhill']

const GENERIC_FIRST = ['Ash', 'Bel', 'Cor', 'Dov', 'Ell', 'Fen', 'Gal', 'Hob', 'Ira', 'Jun', 'Kit', 'Lor', 'Mab', 'Nim', 'Oda', 'Pim', 'Rue', 'Sol', 'Tam', 'Vey']
const GENERIC_LAST = ['the Quiet', 'the Red', 'of the Ford', 'One-Eye', 'the Younger', 'Half-Hand', 'the Stranger', 'of the Mill']

const LISTS: Record<string, { first: string[]; last: string[] }> = {
  mausritter: { first: MOUSE_FIRST, last: MOUSE_LAST },
  dnd5e: { first: FANTASY_FIRST, last: FANTASY_LAST },
}

function pick<T>(list: T[], rnd: () => number): T {
  return list[Math.floor(rnd() * list.length) % list.length]!
}

/** A random "First Last" name flavoured for the pack; unknown packs get the generic list. */
export function randomName(packId: string | undefined, rnd: () => number = Math.random): string {
  const lists = (packId && LISTS[packId]) || { first: GENERIC_FIRST, last: GENERIC_LAST }
  return `${pick(lists.first, rnd)} ${pick(lists.last, rnd)}`
}

/** `count` names with no duplicates where the list allows it. */
export function randomNames(packId: string | undefined, count: number, rnd: () => number = Math.random): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  let guard = 0
  while (out.length < count && guard++ < count * 20) {
    const n = randomName(packId, rnd)
    if (seen.has(n)) continue
    seen.add(n)
    out.push(n)
  }
  while (out.length < count) out.push(`${randomName(packId, rnd)} ${out.length + 1}`)
  return out
}
