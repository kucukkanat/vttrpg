# License

This pack implements mechanics and content from the System Reference Document 5.1 and the System
Reference Document 5.2.1 for use in VTTRPG. It contains no content from the Player's Handbook,
the Monster Manual or any other book beyond the SRDs.

## Attribution

This work includes material taken from the System Reference Document 5.1 ("SRD 5.1") by Wizards
of the Coast LLC and available at https://dnd.wizards.com/resources/systems-reference-document.
The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License
available at https://creativecommons.org/licenses/by/4.0/legalcode.

This work includes material from the System Reference Document 5.2.1 ("SRD 5.2.1") by Wizards of
the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2.1 is licensed under the
Creative Commons Attribution 4.0 International License, available at
https://creativecommons.org/licenses/by/4.0/legalcode.

## What comes from where

| Files | Source |
|---|---|
| `attributes.json`, `resources.json`, `conditions.json`, `sheet.json`, `chargen.json`, `skills/` | SRD 5.1 |
| `creatures/srd-2014.json` | SRD 5.1 creature stat blocks |
| `creatures/srd-2024.json` | SRD 5.2.1 creature stat blocks |
| `encounter.json` | SRD 5.2.1, "XP Budget per Character" table (Combat Encounters) |

The creature files were converted from the Open5e API (https://open5e.com, v2 `creatures`
endpoint) by `scripts/build-creatures/`, which pulls only the `srd-2014` and `srd-2024` documents
and only while Open5e labels them CC-BY-4.0. Each file names its source document and repeats its
attribution in its `document` header, and every creature records its `source`. The stat blocks
were reformatted for this pack (actions split into to-hit, damage, save and range fields; markup
removed); the descriptive text is the SRD's.

The JSON files in this folder (rules data, creature data, descriptions and the sheet layouts) are
offered under the same CC-BY-4.0 license.
