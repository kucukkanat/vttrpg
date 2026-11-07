# Starter library licensing

Everything under this folder must be CC0 or equivalent public domain. The scenes, props and minis
are original models built from primitives by the scripts in `scripts/make-scenes` and
`scripts/make-props`, released as CC0. The curated models under `models/` and the kit pieces under
`kits/` come from CC0 packs by KayKit and Kenney; see `CREDITS.md` and `catalogue.json`. To record a different
license for a folder, add a `license.txt` whose first line is the SPDX id; `npm run library:index`
copies it into `index.json`. Keep the library small (GitHub Pages limit).
