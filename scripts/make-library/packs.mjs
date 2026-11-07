/**
 * The CC0 source packs the curated library is built from. Every pack's own licence file was read
 * and says CC0 1.0 (Creative Commons Zero). Quaternius is deliberately absent: its 2026 asset
 * licence forbids standalone redistribution (research_notes/Level design/model sources.md).
 *
 * `dir` is the folder holding the pack's models inside the downloaded archive, relative to the
 * source cache (paths.mjs SRC_ROOT). `scale` converts the pack's units to metres for kit pieces;
 * props are sized by their own real-world height (`h` in picks.mjs). `srgbFactors` marks packs
 * whose material colours are stored as sRGB, and `palette` is a per-pack hue, saturation and value
 * adjustment toward the candle-lit look (index.mjs `repalette`).
 */

const KAY = { author: 'Kay Lousberg', authorUrl: 'https://www.kaylousberg.com' }
const KENNEY = { author: 'Kenney', authorUrl: 'https://kenney.nl' }

const kaykit = (repo, dir, name) => ({
  ...KAY,
  source: `KayKit ${name}`,
  url: `https://github.com/KayKit-Game-Assets/${repo}`,
  fileUrl: (file) => `https://github.com/KayKit-Game-Assets/${repo}/blob/main/${dir.split('/').slice(2).join('/')}/${file}`,
  download: `https://codeload.github.com/KayKit-Game-Assets/${repo}/zip/refs/heads/main`,
  dir,
})

const kenney = (slug, name) => ({
  ...KENNEY,
  source: `Kenney ${name}`,
  url: `https://kenney.nl/assets/${slug}`,
  fileUrl: () => `https://kenney.nl/assets/${slug}`,
  download: `https://kenney.nl/assets/${slug}`,
  dir: `kenney-${slug}/Models/GLB format`,
})

export const PACKS = {
  'kaykit-dungeon': {
    ...kaykit('KayKit-Dungeon-Remastered-1.0', 'kaykit-Dungeon-Remastered/KayKit-Dungeon-Remastered-1.0-main/addons/kaykit_dungeon_remastered/Assets/gltf', 'Dungeon Remastered'),
    theme: 'dungeon',
    // Walls are 4 units wide and tall: 0.75 makes them 3 m, two 1.5 m cells and one storey.
    scale: 0.75,
  },
  'kaykit-furniture': {
    ...kaykit('KayKit-Furniture-Bits-1.0', 'kaykit-Furniture-Bits/KayKit-Furniture-Bits-1.0-main/addons/kaykit_furniture_bits/Assets/gltf', 'Furniture Bits'),
    theme: 'home',
    // Modern teal upholstery to a wine red that sits in a candle-lit room.
    palette: { hue: [[150, 215, 165]], sat: 0.85 },
  },
  'kaykit-halloween': {
    ...kaykit('KayKit-Halloween-Bits-1.0', 'kaykit-Halloween-Bits/KayKit-Halloween-Bits-1.0-main/addons/kaykit_halloween_bits/Assets/gltf', 'Halloween Bits'),
    theme: 'graveyard',
  },
  'kaykit-medieval': {
    ...kaykit('KayKit-Medieval-Hexagon-Pack-1.0', 'kaykit-Medieval-Hexagon-Pack/KayKit-Medieval-Hexagon-Pack-1.0-main/addons/kaykit_medieval_hexagon_pack/Assets/gltf', 'Medieval Hexagon Pack'),
    theme: 'town',
  },
  'kaykit-restaurant': {
    ...kaykit('KayKit-Restaurant-Bits-1.0', 'kaykit-Restaurant-Bits/KayKit-Restaurant-Bits-1.0-main/addons/kaykit_restaurant_bits/Assets/gltf', 'Restaurant Bits'),
    theme: 'kitchen',
  },
  'kenney-castle': { ...kenney('castle-kit', 'Castle Kit'), theme: 'castle' },
  'kenney-town': {
    ...kenney('fantasy-town-kit', 'Fantasy Town Kit'),
    theme: 'town',
    // Wall panels are 1 unit square: 3 makes them 3 m, matching the KayKit dungeon module.
    scale: 3,
  },
  'kenney-graveyard': { ...kenney('graveyard-kit', 'Graveyard Kit'), theme: 'graveyard' },
  'kenney-dungeon': { ...kenney('mini-dungeon', 'Mini Dungeon'), theme: 'dungeon' },
  'kenney-survival': { ...kenney('survival-kit', 'Survival Kit'), theme: 'camp' },
  'kenney-furniture': {
    ...kenney('furniture-kit', 'Furniture Kit'),
    dir: 'kenney-furniture-kit/Models/GLTF format',
    theme: 'home',
    srgbFactors: true,
    palette: { sat: 0.85, val: 0.85 },
  },
  'kenney-nature': {
    ...kenney('nature-kit', 'Nature Kit'),
    dir: 'kenney-nature-kit/Models/GLTF format',
    theme: 'wilderness',
    srgbFactors: true,
    // Teal foliage to leaf green, orange earth and bark toward brown.
    palette: { hue: [[140, 200, -62]], sat: 0.72, val: 0.82 },
  },
}

/** The procedural props in public/library/props, built by scripts/make-props. */
export const OWN_WORK = {
  author: 'vttrpg contributors',
  source: 'vttrpg starter props',
  url: 'https://github.com/kucukkanat/vttrpg',
}
