/**
 * Search synonyms for catalogue tags. Any title word or tag listed here pulls in its group, so a
 * GM typing "cask", "keg" or "barrel" finds the same models. Groups are symmetric: every word of a
 * group maps to all the others.
 */
const GROUPS = [
  'barrel cask keg',
  'crate box case',
  'chest trunk coffer strongbox',
  'sack bag',
  'jar pot urn vase',
  'bucket pail',
  'coffin casket',
  'sarcophagus tomb',
  'grave burial tomb',
  'gravestone headstone tombstone',
  'table desk counter',
  'chair seat',
  'stool seat',
  'bench seat pew',
  'bed cot bunk',
  'bookcase bookshelf shelves',
  'shelf shelves rack',
  'cabinet cupboard wardrobe',
  'rug carpet mat',
  'candle taper wax',
  'torch brand sconce',
  'lantern lamp',
  'campfire fire bonfire',
  'brazier fire',
  'tree trees forest woods',
  'pine fir conifer evergreen',
  'bush shrub hedge',
  'rock stone boulder',
  'stones rocks pebbles',
  'log trunk timber',
  'stump tree',
  'mushroom toadstool fungus',
  'flowers flower blossom',
  'grass weeds',
  'wall walls',
  'door doorway gate entrance',
  'gate portcullis',
  'window shutters',
  'stairs steps staircase',
  'pillar column post',
  'roof roofing',
  'floor tile ground',
  'fence railing barrier',
  'banner flag tapestry pennant',
  'coins coin gold money treasure',
  'gold treasure loot',
  'key keys',
  'bottle flask potion',
  'plate dish',
  'bowl dish',
  'pot cauldron',
  'sword blade weapon',
  'spear weapon',
  'shield buckler',
  'axe hatchet tool',
  'pickaxe pick tool',
  'shovel spade tool',
  'anvil smithy forge blacksmith',
  'cart wagon',
  'stall booth market',
  'tent canopy pavilion',
  'skull skeleton bones',
  'bones skeleton remains',
  'ribcage skeleton bones',
  'rubble debris ruin',
  'ruin ruined ruins',
  'statue idol',
  'obelisk monument',
  'altar shrine',
  'fountain well water',
  'trap hazard',
  'siege war',
  'catapult siege',
  'ballista siege',
  'trebuchet siege',
  'cheese food',
  'ham meat food',
  'stew soup food',
  'pumpkin gourd',
  'painting portrait picture',
  'books tomes library',
  'book tome',
]

export const SYNONYMS = new Map()
for (const g of GROUPS) {
  const words = g.split(' ')
  for (const w of words) {
    const set = SYNONYMS.get(w) ?? new Set()
    for (const o of words) if (o !== w) set.add(o)
    SYNONYMS.set(w, set)
  }
}

/** Lowercase words of a title, without punctuation and short filler words. */
export function titleWords(title) {
  return title.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, '')
    .split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !['of', 'on', 'with', 'and', 'the', 'in', 'a'].includes(w))
}

/** Title words, the pick's own tags and every synonym of either, deduplicated, in that order. */
export function expandTags(title, tags = [], extra = []) {
  const base = [...titleWords(title), ...tags.map((t) => t.toLowerCase()), ...extra]
  const out = new Set(base)
  for (const w of base) {
    for (const s of SYNONYMS.get(w) ?? []) out.add(s)
    // Plural to singular so "barrels" style words still hit a group.
    if (w.endsWith('s')) for (const s of SYNONYMS.get(w.slice(0, -1)) ?? []) out.add(s)
  }
  return [...out]
}
