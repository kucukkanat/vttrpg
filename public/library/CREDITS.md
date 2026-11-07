# Library credits

Every model in this library is released under **CC0 1.0** (Creative Commons Zero, public domain
dedication: <https://creativecommons.org/publicdomain/zero/1.0/>). Credit is not required by any
of these licences; it is given here because the work deserves it. Each entry in `catalogue.json`
records its author, source pack and source URL.

The models were optimised for the table by `scripts/make-library` (`npm run library`): converted
to GLB, scaled to real-world metres, colours baked into vertex colours and re-tinted toward the
candle-lit palette, compressed with meshopt. The thumbnails are rendered from those files.

## Source packs

| Pack | Author | Licence | Source | Used for |
|---|---|---|---|---|
| KayKit Dungeon Remastered 1.0 | Kay Lousberg | CC0 1.0 | <https://github.com/KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0> | 48 props, 40 dungeon kit pieces (`kits/kaykit-dungeon`) |
| KayKit Furniture Bits 1.0 | Kay Lousberg | CC0 1.0 | <https://github.com/KayKit-Game-Assets/KayKit-Furniture-Bits-1.0> | 12 props |
| KayKit Halloween Bits 1.0 | Kay Lousberg | CC0 1.0 | <https://github.com/KayKit-Game-Assets/KayKit-Halloween-Bits-1.0> | 21 props |
| KayKit Medieval Hexagon Pack 1.0 | Kay Lousberg | CC0 1.0 | <https://github.com/KayKit-Game-Assets/KayKit-Medieval-Hexagon-Pack-1.0> | 17 props |
| KayKit Restaurant Bits 1.0 | Kay Lousberg | CC0 1.0 | <https://github.com/KayKit-Game-Assets/KayKit-Restaurant-Bits-1.0> | 13 props |
| Castle Kit 2.0 | Kenney | CC0 1.0 | <https://kenney.nl/assets/castle-kit> | 10 props |
| Fantasy Town Kit 2.0 | Kenney | CC0 1.0 | <https://kenney.nl/assets/fantasy-town-kit> | 12 props, 38 town kit pieces (`kits/kenney-town`) |
| Graveyard Kit 5.0 | Kenney | CC0 1.0 | <https://kenney.nl/assets/graveyard-kit> | 21 props |
| Mini Dungeon 2.0 | Kenney | CC0 1.0 | <https://kenney.nl/assets/mini-dungeon> | 8 props |
| Survival Kit 2.0 | Kenney | CC0 1.0 | <https://kenney.nl/assets/survival-kit> | 14 props |
| Furniture Kit 2.0 | Kenney | CC0 1.0 | <https://kenney.nl/assets/furniture-kit> | 6 props |
| Nature Kit 2.1 | Kenney | CC0 1.0 | <https://kenney.nl/assets/nature-kit> | 33 props |
| Starter props (`props/`) | vttrpg contributors | CC0 1.0 | `scripts/make-props` | 13 props |

KayKit: support the author at <https://www.kaylousberg.com> or <https://kaylousberg.itch.io>.
Kenney: support the author at <https://kenney.nl/donate>. The Kenney name and logo are not used.

## Not included

- **Quaternius** models are left out until its 2026 asset licence (which forbids standalone
  redistribution) has been checked; see `research_notes/Level design/model sources.md`.
- **Poly Haven** models are not bundled: they are realistic PBR scans with 1k+ textures, which
  neither fit the low-poly look nor the size budget. They come in through the live import instead.
