/**
 * The curated library: which source models ship, what they are called, where they shelve and how
 * big they are in the real world. `npm run library` optimises each pick into public/library and
 * scripts/build-library-index.mjs turns this list into catalogue.json.
 *
 *   pack   key of PACKS (packs.mjs)
 *   file   file name inside the pack's model folder
 *   slug   output file name (no extension), unique within the pack
 *   title  display name
 *   cat    shelf: furniture, container, light, nature, structure, decor, tableware, food,
 *          treasure, equipment, kit
 *   h      real-world height in metres the model is scaled to (props). `w` scales by the larger
 *          horizontal side instead (rugs, flat things). Without either, the pack's `scale` applies.
 *   tags   extra search words; build-library-index adds synonyms of the title words on top
 *   theme  overrides the pack's theme
 *   kit    the grid kit a piece belongs to (Phase 4); kit pieces keep their authored grid origin
 *   glow   flame-coloured faces become an emissive material (candles, torches, braziers)
 */

const list = []

/** Adds the picks of one pack: `[file, title, cat, h, tags?, opts?]`. */
function pack(packId, defaults, rows) {
  for (const [file, title, cat, h, tags = '', opts = {}] of rows) {
    const slug = opts.slug ?? file.split('/').pop().replace(/\.gltf\.glb$|\.glb$|\.gltf$/i, '').replace(/[_\s]+/g, '-').replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()
    list.push({ pack: packId, file, slug, title, cat, ...(h != null ? { h } : {}), tags: tags.split(/\s+/).filter(Boolean), ...defaults, ...opts })
  }
}

/* ------------------------------------------------------------------ KayKit Dungeon Remastered */

pack('kaykit-dungeon', {}, [
  ['barrel_large.gltf.glb', 'Large barrel', 'container', 1.1],
  ['barrel_large_decorated.gltf.glb', 'Barrel with goods', 'container', 1.35],
  ['barrel_small.gltf.glb', 'Small barrel', 'container', 0.6],
  ['barrel_small_stack.gltf.glb', 'Stacked barrels', 'container', 1.05],
  ['keg.gltf.glb', 'Keg on a stand', 'container', 1.15, 'ale beer tap', { theme: 'tavern' }],
  ['keg_decorated.gltf.glb', 'Kegs with mugs', 'container', 1.15, 'ale beer tap', { theme: 'tavern' }],
  ['box_large.gltf.glb', 'Large crate', 'container', 0.9],
  ['box_small.gltf.glb', 'Small crate', 'container', 0.55],
  ['box_stacked.gltf.glb', 'Stacked crates', 'container', 1.9],
  ['crates_stacked.gltf.glb', 'Crate pile', 'container', 1.25],
  ['chest.glb', 'Chest', 'container', 0.75],
  ['trunk_large_A.gltf.glb', 'Large trunk', 'container', 0.6, 'luggage'],
  ['trunk_medium_A.gltf.glb', 'Trunk', 'container', 0.45, 'luggage'],
  ['candle_lit.gltf.glb', 'Lit candle', 'light', 0.3, 'flame', { glow: true }],
  ['candle_thin_lit.gltf.glb', 'Thin lit candle', 'light', 0.3, 'flame taper', { glow: true }],
  ['candle_triple.gltf.glb', 'Three candles', 'light', 0.25, 'candelabra', { glow: true }],
  ['torch_lit.gltf.glb', 'Lit torch', 'light', 0.6, 'flame', { glow: true }],
  ['torch_mounted.gltf.glb', 'Wall torch', 'light', 0.6, 'sconce mounted bracket'],
  ['chair.gltf.glb', 'Wooden chair', 'furniture', 0.95, '', { theme: 'tavern' }],
  ['stool.gltf.glb', 'Stool', 'furniture', 0.45, '', { theme: 'tavern' }],
  ['bed_decorated.gltf.glb', 'Made bed', 'furniture', 1.25, 'blanket pillow'],
  ['bed_floor.gltf.glb', 'Straw bed', 'furniture', 0.4, 'pallet mattress cot'],
  ['table_long.gltf.glb', 'Long table', 'furniture', 0.78, 'dining banquet', { theme: 'tavern' }],
  ['table_long_tablecloth_decorated_A.gltf.glb', 'Feast table', 'furniture', 1.45, 'banquet dining food tablecloth', { theme: 'tavern' }],
  ['table_medium.gltf.glb', 'Table', 'furniture', 0.78, '', { theme: 'tavern' }],
  ['table_medium_tablecloth.gltf.glb', 'Table with cloth', 'furniture', 0.78, 'tablecloth', { theme: 'tavern' }],
  ['table_medium_broken.gltf.glb', 'Broken table', 'furniture', 0.75, 'smashed wreck'],
  ['table_small.gltf.glb', 'Small table', 'furniture', 0.75, 'side'],
  ['table_small_decorated_A.gltf.glb', 'Small table with candle', 'furniture', 1.2, 'side', { glow: true }],
  ['shelves.gltf.glb', 'Wall shelves', 'furniture', 1.5, 'rack'],
  ['shelf_small_candles.gltf.glb', 'Candle shelf', 'decor', 0.75, 'wall', { glow: true }],
  ['bottle_A_brown.gltf.glb', 'Brown bottle', 'tableware', 0.3, 'wine ale'],
  ['bottle_A_labeled_green.gltf.glb', 'Labelled bottle', 'tableware', 0.3, 'wine potion'],
  ['plate_food_A.gltf.glb', 'Plate of food', 'food', 0.26, 'meal dinner'],
  ['plate_stack.gltf.glb', 'Plate stack', 'tableware', 0.18, 'dishes'],
  ['coin_stack_small.gltf.glb', 'Few coins', 'treasure', 0.16, 'gold money'],
  ['coin_stack_medium.gltf.glb', 'Coin pile', 'treasure', 0.22, 'gold money'],
  ['coin_stack_large.gltf.glb', 'Gold hoard', 'treasure', 0.4, 'coins money pile'],
  ['key.gltf.glb', 'Key', 'treasure', 0.1],
  ['keyring_hanging.gltf.glb', 'Hanging keys', 'decor', 0.35, 'keys jailer'],
  ['sword_shield.gltf.glb', 'Sword and shield', 'equipment', 0.75, 'weapon wall trophy', { theme: 'castle' }],
  ['banner_patternA_red.gltf.glb', 'Red banner', 'decor', 2.2, 'tapestry flag heraldry', { theme: 'castle' }],
  ['banner_shield_blue.gltf.glb', 'Blue shield banner', 'decor', 2.2, 'tapestry flag heraldry', { theme: 'castle' }],
  ['barrier.gltf.glb', 'Wooden barrier', 'structure', 0.85, 'fence railing'],
  ['barrier_column.gltf.glb', 'Barrier with post', 'structure', 1.05, 'fence railing'],
  ['column.gltf.glb', 'Short column', 'structure', 1.05, 'pedestal plinth'],
  ['rubble_half.gltf.glb', 'Rubble', 'structure', 1.6, 'collapse debris stones ruin'],
  ['rubble_large.gltf.glb', 'Large rubble', 'structure', 2.2, 'collapse debris stones ruin cave-in'],
])

/* ------------------------------------------------------------------ KayKit Dungeon: grid kit */

const DUNGEON_KIT = { kit: 'kaykit-dungeon', theme: 'dungeon' }
pack('kaykit-dungeon', DUNGEON_KIT, [
  ['floor_tile_large.gltf.glb', 'Stone floor 2×2', 'kit', null, 'floor tile flagstone'],
  ['floor_tile_small.gltf.glb', 'Stone floor', 'kit', null, 'floor tile flagstone'],
  ['floor_tile_small_broken_A.gltf.glb', 'Broken stone floor', 'kit', null, 'floor tile cracked'],
  ['floor_tile_small_decorated.gltf.glb', 'Stone floor with bones', 'kit', null, 'floor tile'],
  ['floor_tile_small_weeds_A.gltf.glb', 'Weedy stone floor', 'kit', null, 'floor tile grass'],
  ['floor_tile_large_rocks.gltf.glb', 'Rocky stone floor 2×2', 'kit', null, 'floor tile'],
  ['floor_tile_grate.gltf.glb', 'Floor grate', 'kit', null, 'floor drain sewer'],
  ['floor_tile_big_spikes.glb', 'Spike trap floor', 'kit', null, 'floor trap'],
  ['floor_wood_large.gltf.glb', 'Wooden floor 2×2', 'kit', null, 'floor planks boards'],
  ['floor_wood_small.gltf.glb', 'Wooden floor', 'kit', null, 'floor planks boards'],
  ['floor_wood_small_dark.gltf.glb', 'Dark wooden floor', 'kit', null, 'floor planks boards'],
  ['floor_dirt_large.gltf.glb', 'Dirt floor 2×2', 'kit', null, 'floor earth ground cave'],
  ['floor_dirt_small_A.gltf.glb', 'Dirt floor', 'kit', null, 'floor earth ground cave'],
  ['floor_foundation_front.gltf.glb', 'Foundation edge', 'kit', null, 'floor ledge platform'],
  ['floor_foundation_corner.gltf.glb', 'Foundation corner', 'kit', null, 'floor ledge platform'],
  ['wall.gltf.glb', 'Stone wall', 'kit', null, 'wall'],
  ['wall_half.gltf.glb', 'Half stone wall', 'kit', null, 'wall short'],
  ['wall_corner.gltf.glb', 'Wall corner', 'kit', null, 'wall corner'],
  ['wall_corner_small.gltf.glb', 'Small wall corner', 'kit', null, 'wall corner'],
  ['wall_Tsplit.gltf.glb', 'Wall T-junction', 'kit', null, 'wall junction tee'],
  ['wall_crossing.gltf.glb', 'Wall crossing', 'kit', null, 'wall junction cross'],
  ['wall_endcap.gltf.glb', 'Wall end cap', 'kit', null, 'wall end'],
  ['wall_doorway.glb', 'Doorway with door', 'kit', null, 'wall door doorway'],
  ['wall_arched.gltf.glb', 'Arched opening', 'kit', null, 'wall arch doorway'],
  ['wall_gated.gltf.glb', 'Gated wall', 'kit', null, 'wall portcullis gate bars'],
  ['wall_window_open.gltf.glb', 'Wall with window', 'kit', null, 'wall window'],
  ['wall_window_closed.gltf.glb', 'Wall with shutters', 'kit', null, 'wall window shutter'],
  ['wall_archedwindow_gated.gltf.glb', 'Barred arched window', 'kit', null, 'wall window bars prison'],
  ['wall_broken.gltf.glb', 'Broken wall', 'kit', null, 'wall ruin damaged'],
  ['wall_cracked.gltf.glb', 'Cracked wall', 'kit', null, 'wall damaged'],
  ['wall_pillar.gltf.glb', 'Wall with pillar', 'kit', null, 'wall column'],
  ['wall_shelves.gltf.glb', 'Wall with shelves', 'kit', null, 'wall storage'],
  ['wall_sloped.gltf.glb', 'Sloped wall', 'kit', null, 'wall ramp'],
  ['wall_scaffold.gltf.glb', 'Scaffolded wall', 'kit', null, 'wall wood repair'],
  ['stairs.gltf.glb', 'Stone stairs', 'kit', null, 'stairs steps staircase'],
  ['stairs_narrow.gltf.glb', 'Narrow stairs', 'kit', null, 'stairs steps staircase'],
  ['stairs_walled.gltf.glb', 'Walled stairs', 'kit', null, 'stairs steps staircase'],
  ['stairs_wood.gltf.glb', 'Wooden stairs', 'kit', null, 'stairs steps staircase'],
  ['pillar.gltf.glb', 'Pillar', 'kit', null, 'column pillar'],
  ['pillar_decorated.gltf.glb', 'Ruined pillar', 'kit', null, 'column pillar'],
])

/* ------------------------------------------------------------------ KayKit Furniture Bits */

pack('kaykit-furniture', {}, [
  ['bed_double_A.gltf', 'Double bed', 'furniture', 1.0, 'inn'],
  ['bed_single_A.gltf', 'Single bed', 'furniture', 0.9, 'inn cot'],
  ['book_set.gltf', 'Books', 'decor', 0.25, 'tomes library'],
  ['cabinet_medium_decorated.gltf', 'Cabinet with books', 'furniture', 1.3, 'cupboard'],
  ['chair_A_wood.gltf', 'Simple chair', 'furniture', 0.95],
  ['chair_stool_wood.gltf', 'Wooden stool', 'furniture', 0.5],
  ['shelf_B_large_decorated.gltf', 'Bookcase', 'furniture', 2.0, 'bookshelf library'],
  ['shelf_A_big.gltf', 'Open shelf', 'furniture', 1.8, 'rack'],
  ['table_medium.gltf', 'Round table', 'furniture', 0.76],
  ['rug_rectangle_stripes_A.gltf', 'Striped rug', 'decor', null, 'carpet mat', { w: 2.4 }],
  ['rug_oval_A.gltf', 'Oval rug', 'decor', null, 'carpet mat', { w: 2.0 }],
  ['pictureframe_large_A.gltf', 'Painting', 'decor', 1.0, 'portrait picture frame'],
])

/* ------------------------------------------------------------------ KayKit Halloween Bits */

pack('kaykit-halloween', {}, [
  ['arch_gate.gltf', 'Cemetery gate', 'structure', 3.2, 'arch entrance graveyard'],
  ['bench_decorated.gltf', 'Stone bench', 'furniture', 0.6],
  ['ribcage.gltf', 'Ribcage', 'decor', 0.35, 'bones remains skeleton'],
  ['skull.gltf', 'Skull', 'decor', 0.2, 'bones remains head'],
  ['skull_candle.gltf', 'Skull candle', 'light', 0.3, 'bones', { glow: true }],
  ['coffin.gltf', 'Coffin', 'container', null, 'casket burial vampire', { w: 2.0 }],
  ['coffin_decorated.gltf', 'Coffin with skeleton', 'container', null, 'casket burial vampire bones open', { w: 2.1 }],
  ['crypt.gltf', 'Crypt', 'structure', 3.4, 'tomb mausoleum'],
  ['fence.gltf', 'Iron fence', 'structure', 1.3, 'railing'],
  ['fence_gate.gltf', 'Iron fence gate', 'structure', 1.3, 'railing'],
  ['grave_A.gltf', 'Grave', 'structure', 0.95, 'tomb burial plot'],
  ['grave_A_destroyed.gltf', 'Opened grave', 'structure', 0.95, 'tomb burial plot dug undead'],
  ['gravestone.gltf', 'Gravestone', 'structure', 0.85, 'headstone tombstone'],
  ['lantern_standing.gltf', 'Standing lantern', 'light', 0.45, '', { glow: true }],
  ['lantern_hanging.gltf', 'Hanging lantern', 'light', 0.6, '', { glow: true }],
  ['post_lantern.gltf', 'Lantern post', 'light', 2.4, 'lamppost streetlight', { glow: true }],
  ['post_skull.gltf', 'Skull post', 'decor', 2.0, 'warning pike'],
  ['pumpkin_orange_jackolantern.gltf', 'Jack-o’-lantern', 'light', 0.38, 'pumpkin carved', { glow: true }],
  ['shrine_candles.gltf', 'Candle shrine', 'structure', 1.6, 'altar', { glow: true }],
  ['tree_dead_large.gltf', 'Large dead tree', 'nature', 6.5, 'spooky leafless'],
  ['tree_pine_orange_large.gltf', 'Autumn pine', 'nature', 7, 'fir conifer fall'],
])

/* ------------------------------------------------------------------ KayKit Medieval Hexagon */

pack('kaykit-medieval', {}, [
  ['decoration/props/barrel.gltf', 'Water barrel', 'container', 1.0, 'rain'],
  ['decoration/props/bucket_water.gltf', 'Bucket of water', 'container', 0.35, 'pail well'],
  ['decoration/props/bucket_arrows.gltf', 'Arrow bucket', 'equipment', 0.7, 'quiver archery ammunition', { theme: 'castle' }],
  ['decoration/props/crate_A_big.gltf', 'Supply crate', 'container', 0.9, 'box'],
  ['decoration/props/sack.gltf', 'Sack', 'container', null, 'bag grain flour', { w: 1.0 }],
  ['decoration/props/ladder.gltf', 'Ladder', 'structure', 3.0],
  ['decoration/props/resource_lumber.gltf', 'Lumber pile', 'decor', 0.8, 'wood planks timber'],
  ['decoration/props/target.gltf', 'Archery target', 'equipment', 1.6, 'butt bullseye practice', { theme: 'castle' }],
  ['decoration/props/tent.gltf', 'Canopy', 'structure', 2.4, 'tent pavilion gazebo awning', { theme: 'camp' }],
  ['decoration/props/wheelbarrow.gltf', 'Wheelbarrow', 'equipment', 0.75, 'cart barrow'],
  ['decoration/nature/rock_single_A.gltf', 'Flat boulder', 'nature', null, 'rock stone slab', { w: 2.4 }],
  ['decoration/nature/rock_single_C.gltf', 'Mossy rock', 'nature', 0.8, 'stone'],
  ['decoration/nature/tree_single_A.gltf', 'Slim pine', 'nature', 6, 'fir conifer evergreen'],
  ['decoration/nature/tree_single_B.gltf', 'Bushy pine', 'nature', 7, 'fir conifer evergreen'],
  ['decoration/nature/trees_A_small.gltf', 'Tree clump', 'nature', 4.5, 'grove copse forest'],
  ['decoration/nature/waterplant_A.gltf', 'Reeds', 'nature', 0.8, 'cattail water plant marsh'],
  ['buildings/neutral/building_stage_A.gltf', 'Wooden stage', 'structure', 1.6, 'platform scaffold'],
])

/* ------------------------------------------------------------------ KayKit Restaurant Bits */

pack('kaykit-restaurant', { theme: 'tavern' }, [
  ['food_stew.gltf', 'Bowl of stew', 'food', 0.1, 'soup meal'],
  ['pot_A.gltf', 'Cooking pot', 'tableware', 0.25, 'pan'],
  ['jar_A_large.gltf', 'Large jar', 'container', 0.4, 'urn pot storage'],
  ['jar_B_medium.gltf', 'Jar', 'container', 0.25, 'pot storage'],
  ['crate_carrots.gltf', 'Crate of carrots', 'food', 0.45, 'vegetables produce market', { theme: 'market' }],
  ['crate_potatoes.gltf', 'Crate of potatoes', 'food', 0.45, 'vegetables produce market', { theme: 'market' }],
  ['crate_cheese.gltf', 'Crate of cheese', 'food', 0.45, 'produce market', { theme: 'market' }],
  ['crate_ham.gltf', 'Crate of ham', 'food', 0.45, 'meat butcher market', { theme: 'market' }],
  ['food_ingredient_cheese.gltf', 'Cheese wheel', 'food', 0.12],
  ['food_ingredient_ham.gltf', 'Ham', 'food', 0.15, 'meat leg'],
  ['table_round_A.gltf', 'Round tavern table', 'furniture', null, 'inn', { w: 1.3 }],
  ['kitchentable_A_large_decorated.gltf', 'Kitchen work table', 'furniture', 1.1, 'kitchen counter'],
  ['chair_A.gltf', 'Tavern chair', 'furniture', 0.95, 'inn'],
])

/* ------------------------------------------------------------------ Kenney Castle Kit */

pack('kenney-castle', {}, [
  ['siege-ballista.glb', 'Ballista', 'equipment', 1.6, 'siege engine crossbow war'],
  ['siege-catapult.glb', 'Catapult', 'equipment', 2.6, 'siege engine war'],
  ['siege-ram.glb', 'Battering ram', 'equipment', 2.2, 'siege engine war'],
  ['siege-trebuchet.glb', 'Trebuchet', 'equipment', 5, 'siege engine war'],
  ['siege-tower.glb', 'Siege tower', 'structure', 8, 'siege engine war'],
  ['flag-banner-long.glb', 'Long castle banner', 'decor', 4.5, 'flag'],
  ['metal-gate.glb', 'Portcullis', 'structure', 2.8, 'gate bars'],
  ['door.glb', 'Castle door', 'structure', 2.4, 'gate'],
  ['tower-square-mid-windows.glb', 'Watchtower section', 'structure', 3.0, 'tower keep'],
  ['tower-square-roof.glb', 'Tower roof', 'structure', 3.6, 'spire'],
])

/* ------------------------------------------------------------------ Kenney Fantasy Town Kit */

pack('kenney-town', {}, [
  ['cart.glb', 'Cart', 'equipment', 1.1, 'wagon handcart', { theme: 'market' }],
  ['cart-high.glb', 'Loaded cart', 'equipment', 1.7, 'wagon handcart hay', { theme: 'market' }],
  ['stall-red.glb', 'Red market stall', 'structure', 2.6, 'booth shop vendor awning', { theme: 'market' }],
  ['stall-bench.glb', 'Market counter', 'furniture', 0.8, 'bench table trestle', { theme: 'market' }],
  ['lantern.glb', 'Street lantern', 'light', 2.8, 'lamppost streetlight'],
  ['fountain-round.glb', 'Round fountain', 'structure', null, 'well water plaza', { w: 4.5 }],
  ['fountain-square-detail.glb', 'Square fountain', 'structure', null, 'water plaza', { w: 4.5 }],
  ['banner-red.glb', 'Wall banner', 'decor', 1.5, 'flag tapestry'],
  ['hedge-large.glb', 'Hedge', 'nature', 1.5, 'bush garden'],
  ['fence.glb', 'Picket fence', 'structure', 1.0, 'railing garden'],
  ['tree.glb', 'Cypress', 'nature', 5, 'conifer town tree'],
  ['rock-large.glb', 'Large boulder', 'nature', 1.6, 'rock stone'],
])

/* ------------------------------------------------------------------ Kenney Fantasy Town: grid kit */

const TOWN_KIT = { kit: 'kenney-town', theme: 'town' }
pack('kenney-town', TOWN_KIT, [
  ['wall.glb', 'Plaster wall', 'kit', null, 'wall'],
  ['wall-half.glb', 'Half plaster wall', 'kit', null, 'wall short'],
  ['wall-corner.glb', 'Plaster wall corner', 'kit', null, 'wall corner'],
  ['wall-door.glb', 'Wall with door', 'kit', null, 'wall door doorway'],
  ['wall-doorway-square.glb', 'Square doorway', 'kit', null, 'wall doorway opening'],
  ['wall-doorway-round.glb', 'Round doorway', 'kit', null, 'wall doorway arch'],
  ['wall-window-shutters.glb', 'Window with shutters', 'kit', null, 'wall window'],
  ['wall-window-glass.glb', 'Glass window', 'kit', null, 'wall window'],
  ['wall-window-small.glb', 'Small window', 'kit', null, 'wall window'],
  ['wall-detail-cross.glb', 'Timber-framed wall', 'kit', null, 'wall tudor half-timbered'],
  ['wall-broken.glb', 'Broken plaster wall', 'kit', null, 'wall ruin damaged'],
  ['wall-wood.glb', 'Wooden wall', 'kit', null, 'wall planks'],
  ['wall-wood-corner.glb', 'Wooden wall corner', 'kit', null, 'wall corner planks'],
  ['wall-wood-door.glb', 'Wooden wall with door', 'kit', null, 'wall door doorway planks'],
  ['wall-wood-window-shutters.glb', 'Wooden wall with window', 'kit', null, 'wall window planks'],
  ['wall-wood-doorway-round.glb', 'Wooden round doorway', 'kit', null, 'wall doorway arch planks'],
  ['wall-arch.glb', 'Wall arch', 'kit', null, 'wall arch opening'],
  ['planks.glb', 'Plank floor', 'kit', null, 'floor boards'],
  ['planks-half.glb', 'Half plank floor', 'kit', null, 'floor boards'],
  ['planks-opening.glb', 'Plank floor with hatch', 'kit', null, 'floor boards trapdoor stairwell'],
  ['stairs-wood.glb', 'Wooden steps', 'kit', null, 'stairs steps'],
  ['stairs-wood-handrail.glb', 'Wooden steps with rail', 'kit', null, 'stairs steps banister'],
  ['stairs-stone.glb', 'Stone steps', 'kit', null, 'stairs steps'],
  ['stairs-wide-stone.glb', 'Wide stone steps', 'kit', null, 'stairs steps'],
  ['pillar-wood.glb', 'Wooden post', 'kit', null, 'pillar column beam'],
  ['pillar-stone.glb', 'Stone post', 'kit', null, 'pillar column'],
  ['roof.glb', 'Roof', 'kit', null, 'roof tiles'],
  ['roof-corner.glb', 'Roof corner', 'kit', null, 'roof'],
  ['roof-corner-inner.glb', 'Roof inner corner', 'kit', null, 'roof'],
  ['roof-gable.glb', 'Gable roof', 'kit', null, 'roof'],
  ['roof-gable-end.glb', 'Gable roof end', 'kit', null, 'roof'],
  ['roof-point.glb', 'Pointed roof', 'kit', null, 'roof spire'],
  ['roof-window.glb', 'Roof with dormer', 'kit', null, 'roof window'],
  ['roof-high.glb', 'Steep roof', 'kit', null, 'roof'],
  ['roof-high-gable.glb', 'Steep gable roof', 'kit', null, 'roof'],
  ['chimney.glb', 'Chimney', 'kit', null, 'roof smoke'],
  ['balcony-wall-fence.glb', 'Balcony railing', 'kit', null, 'railing balustrade'],
  ['overhang.glb', 'Awning beam', 'kit', null, 'overhang eave'],
])

/* ------------------------------------------------------------------ Kenney Graveyard Kit */

pack('kenney-graveyard', {}, [
  ['altar-stone.glb', 'Stone altar', 'structure', 1.0, 'sacrifice ritual shrine', { theme: 'temple' }],
  ['bench.glb', 'Wooden bench', 'furniture', 0.85, 'pew seat'],
  ['candle-multiple.glb', 'Candle cluster', 'light', 0.3, '', { glow: true }],
  ['coffin-old.glb', 'Old coffin', 'container', 0.4, 'casket burial'],
  ['cross.glb', 'Stone cross', 'structure', 1.8, 'grave marker religious'],
  ['crypt-a.glb', 'Stone sarcophagus', 'container', 0.9, 'tomb crypt'],
  ['gravestone-cross.glb', 'Cross headstone', 'structure', 1.1, 'gravestone tombstone'],
  ['gravestone-round.glb', 'Round headstone', 'structure', 0.75, 'gravestone tombstone'],
  ['gravestone-broken.glb', 'Broken headstone', 'structure', 0.45, 'gravestone tombstone'],
  ['grave-border.glb', 'Grave plot', 'structure', 0.15, 'burial'],
  ['lantern-candle.glb', 'Candle lantern', 'light', 0.4, '', { glow: true }],
  ['lightpost-double.glb', 'Double lamp post', 'light', 2.6, 'streetlight lantern', { glow: true }],
  ['pillar-obelisk.glb', 'Obelisk', 'structure', 2.2, 'monument'],
  ['urn-round.glb', 'Funeral urn', 'container', 0.5, 'vase ashes'],
  ['shovel-dirt.glb', 'Shovel in dirt', 'equipment', 1.2, 'spade gravedigger mound'],
  ['iron-fence.glb', 'Wrought iron fence', 'structure', 1.6, 'railing'],
  ['stone-wall.glb', 'Low stone wall', 'structure', 1.0, 'dry-stone boundary'],
  ['hay-bale.glb', 'Hay bale', 'decor', 0.55, 'straw farm', { theme: 'farm' }],
  ['pine-crooked.glb', 'Crooked pine', 'nature', 5, 'fir conifer spooky'],
  ['rocks-tall.glb', 'Standing stones', 'nature', 1.0, 'rocks menhir'],
  ['trunk.glb', 'Cut log', 'nature', 0.6, 'stump wood'],
])

/* ------------------------------------------------------------------ Kenney Mini Dungeon */

pack('kenney-dungeon', {}, [
  ['trap.glb', 'Spike trap', 'structure', 0.35, 'hazard floor'],
  ['potion.glb', 'Potion', 'treasure', 0.25, 'flask elixir vial'],
  ['pot.glb', 'Clay pot', 'container', 0.6, 'urn vase'],
  ['banner.glb', 'Dungeon banner', 'decor', 1.6, 'flag tapestry'],
  ['wood-structure.glb', 'Mine supports', 'structure', 3.0, 'timber beam shaft'],
  ['wood-support.glb', 'Mine beam', 'structure', 3.0, 'timber support shaft'],
  ['shield-round.glb', 'Round shield', 'equipment', 0.75, 'buckler'],
  ['weapon-sword.glb', 'Sword', 'equipment', 1.0, 'blade weapon'],
])

/* ------------------------------------------------------------------ Kenney Survival Kit */

pack('kenney-survival', {}, [
  ['bedroll.glb', 'Bedroll', 'furniture', 0.2, 'sleeping mat camp'],
  ['bucket.glb', 'Wooden bucket', 'container', 0.35, 'pail'],
  ['campfire-pit.glb', 'Campfire logs', 'structure', 0.5, 'fire pit bonfire firewood'],
  ['campfire-stand.glb', 'Cooking spit', 'structure', 1.0, 'campfire roast tripod'],
  ['chest.glb', 'Wooden chest', 'container', 0.6],
  ['fence-fortified.glb', 'Palisade', 'structure', 2.0, 'stakes stockade wall'],
  ['resource-wood.glb', 'Firewood pile', 'decor', 0.6, 'logs wood stack'],
  ['signpost.glb', 'Signpost', 'decor', 2.0, 'sign direction crossroads'],
  ['tent.glb', 'Camp tent', 'structure', 2.0, 'canvas'],
  ['tool-axe.glb', 'Axe', 'equipment', 0.8, 'hatchet woodcutter'],
  ['tool-pickaxe.glb', 'Pickaxe', 'equipment', 0.9, 'mining'],
  ['workbench.glb', 'Workbench', 'furniture', 0.9, 'carpenter craft'],
  ['workbench-anvil.glb', 'Anvil', 'equipment', 0.8, 'blacksmith forge smithy', { theme: 'town' }],
  ['workbench-grind.glb', 'Grindstone', 'equipment', 1.0, 'whetstone sharpen smithy', { theme: 'town' }],
])

/* ------------------------------------------------------------------ Kenney Furniture Kit */

pack('kenney-furniture', {}, [
  ['bookcaseOpen.glb', 'Tall bookshelf', 'furniture', 2.0, 'bookcase library'],
  ['bookcaseClosedDoors.glb', 'Wardrobe', 'furniture', 2.0, 'cupboard armoire'],
  ['coatRackStanding.glb', 'Coat rack', 'furniture', 1.8, 'hat stand'],
  ['sideTableDrawers.glb', 'Nightstand', 'furniture', 0.6, 'drawers bedside'],
  ['tableCross.glb', 'Trestle table', 'furniture', 0.76, 'dining'],
  ['pottedPlant.glb', 'Potted plant', 'decor', 1.0, 'houseplant fern'],
])

/* ------------------------------------------------------------------ Kenney Nature Kit */

pack('kenney-nature', {}, [
  ['tree_oak.glb', 'Oak tree', 'nature', 6, 'deciduous forest'],
  ['tree_default.glb', 'Leafy tree', 'nature', 5.5, 'deciduous forest'],
  ['tree_detailed.glb', 'Tall leafy tree', 'nature', 7, 'deciduous forest'],
  ['tree_fat_fall.glb', 'Autumn tree', 'nature', 5, 'deciduous fall orange'],
  ['tree_pineTallA.glb', 'Tall pine', 'nature', 9, 'fir conifer evergreen'],
  ['tree_pineRoundA.glb', 'Round pine', 'nature', 6, 'fir conifer evergreen'],
  ['tree_thin.glb', 'Birch', 'nature', 6, 'thin tree'],
  ['plant_bush.glb', 'Bush', 'nature', 0.9, 'shrub'],
  ['plant_bushLarge.glb', 'Large bush', 'nature', 1.4, 'shrub'],
  ['plant_bushDetailed.glb', 'Leafy bush', 'nature', 1.0, 'shrub'],
  ['plant_flatTall.glb', 'Fern', 'nature', 0.7, 'plant undergrowth'],
  ['rock_largeA.glb', 'Large rock', 'nature', null, 'boulder stone outcrop', { w: 2.8 }],
  ['rock_largeD.glb', 'Flat boulder', 'nature', 0.9, 'rock stone'],
  ['rock_tallA.glb', 'Rock spire', 'nature', 2.2, 'stone pillar'],
  ['stone_tallB.glb', 'Grey standing stone', 'nature', 2.0, 'menhir monolith'],
  ['stump_oldTall.glb', 'Old stump', 'nature', 0.8, 'tree stump'],
  ['stump_round.glb', 'Stump', 'nature', 0.5, 'tree stump'],
  ['log.glb', 'Fallen log', 'nature', 0.45, 'trunk wood'],
  ['log_stack.glb', 'Log pile', 'nature', 0.8, 'firewood timber'],
  ['mushroom_redGroup.glb', 'Red mushrooms', 'nature', 0.25, 'toadstool fungus'],
  ['flower_redA.glb', 'Red flowers', 'nature', 0.35, 'plant garden'],
  ['grass_large.glb', 'Tall grass', 'nature', 0.5, 'weeds tuft'],
  ['crops_wheatStageB.glb', 'Wheat', 'nature', 1.0, 'crop field farm grain', { theme: 'farm' }],
  ['crops_cornStageD.glb', 'Corn', 'nature', 2.0, 'crop field farm maize', { theme: 'farm' }],
  ['campfire_stones.glb', 'Stone fire ring', 'structure', null, 'campfire pit hearth', { w: 1.3, theme: 'camp' }],
  ['tent_detailedOpen.glb', 'Open tent', 'structure', 2.2, 'camp canvas', { theme: 'camp' }],
  ['statue_obelisk.glb', 'Stone obelisk', 'structure', 3.0, 'monument'],
  ['statue_head.glb', 'Stone head', 'structure', 2.0, 'statue idol ruin'],
  ['statue_column.glb', 'Ruined column', 'structure', 2.4, 'pillar ruin'],
  ['bridge_wood.glb', 'Wooden bridge', 'structure', null, 'crossing river', { w: 4.5 }],
  ['fence_simple.glb', 'Rail fence', 'structure', 1.0, 'farm paddock', { theme: 'farm' }],
  ['sign.glb', 'Wooden sign', 'decor', 1.2, 'signpost notice'],
  ['hanging_moss.glb', 'Hanging moss', 'nature', 1.5, 'vines swamp'],
])

export const PICKS = list

/**
 * The procedural starter props in public/library/props (scripts/make-props), own work released
 * as CC0. Already optimised and sized; listed here for the catalogue only.
 */
export const OWN_PROPS = [
  ['barrel', 'Starter barrel', 'container', 'tavern', ''],
  ['bed', 'Starter bed', 'furniture', 'tavern', 'inn'],
  ['bookshelf', 'Starter bookshelf', 'furniture', 'home', 'bookcase library'],
  ['campfire', 'Starter campfire', 'light', 'camp', 'fire flame'],
  ['cauldron', 'Starter cauldron', 'tableware', 'dungeon', 'pot witch potion'],
  ['chair', 'Starter chair', 'furniture', 'tavern', ''],
  ['chest', 'Starter chest', 'container', 'dungeon', 'treasure'],
  ['crate', 'Starter crate', 'container', 'dungeon', ''],
  ['rock', 'Starter rock', 'nature', 'wilderness', 'boulder'],
  ['table', 'Starter table', 'furniture', 'tavern', 'candle'],
  ['torch-stand', 'Torch stand', 'light', 'dungeon', 'brazier flame'],
  ['weapon-rack', 'Weapon rack', 'equipment', 'castle', 'armoury swords spears'],
  ['well', 'Well', 'structure', 'town', 'water bucket'],
].map(([slug, title, cat, theme, tags]) => ({ slug, title, cat, theme, tags: tags.split(/\s+/).filter(Boolean), path: `props/${slug}.glb` }))
