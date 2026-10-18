# Local Red Rescue Team Dark motifs

Five selected motifs use Luis's local `Game Boy Advance - Pokemon Mystery Dungeon_ Red Rescue Team - Attacks - Dark-Type Moves.png` sheet, credited to redblueyellow. The builder checks its original inventory SHA256 before writing anything. It removes the teal colour key, preserves exact source pixels and pads each crop into square transparent cells without rescaling.

| Move | Manifest ID | Frames | Drawing scale |
| --- | --- | ---: | ---: |
| Bite | `fx-pmd-dark-bite` | 10 | 2.4 |
| Crunch | `fx-pmd-dark-crunch` | 5 | 2.4 |
| Knock Off | `fx-pmd-dark-knockoff` | 3 | 2.4 |
| Pursuit | `fx-pmd-dark-pursuit` | 5 | 1.8 |
| Torment | `fx-pmd-dark-torment` | 7 | 2.4 |

The 30 frames exclude labels, separators, neighbouring effects and incomplete material. Explicit original crop rectangles, source band, colour key, source credit, offsets and a visible stationary frame are retained in the manifest. Reduced motion uses that stationary frame. These are composed motifs in the existing renderer, rather than reproductions of cartridge emitter programs.

The first four replace their existing contact/impact texture; Torment uses the existing wave phases. The renderer shares the same atlas with real-time battles, mass battles, classic Silver effects, portable HTML and recorded video. No move rules, availability, damage, RNG, physics or replay inputs change. Prior 778 sprite objects, 161 source records and all 179 input filename/SHA256 pairs remain exact. The catalog now contains 783 sprites, 162 sources, 227 atlases and 2,836 attack/status frames.

Reproduce after the existing base/particle/status/Dragon-Poison/Rock builders:

```powershell
python scripts/build_dark_sprites.py "C:\path\to\Sprites for Silvers"
node scripts/build_rt_effect_profiles.mjs
```

The source directory stays untouched and is unnecessary at runtime. The exact embedded PNGs and source records are available through ordinary `leisure_catalog` and `/api/sprites/supplied/{id}`. There are no downloads or new dependencies. Artwork remains copyright Nintendo, Creatures and GAME FREAK; the source art is not MIT-licensed. Validation checks native source pixels, transparent edges, idempotent output, source-hash rejection, preserved prior entries, native catalog bytes and the five move profiles.
