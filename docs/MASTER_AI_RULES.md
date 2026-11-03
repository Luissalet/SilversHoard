# Master AI: the rules its search plays by

The master AI level searches thousands of futures a turn with poke-engine 0.0.48 (pmariglia, MIT). Its search is only as good as the
rules it plays, and the differential test in `engine/parity/poke-engine` (poke-engine against `@pkmn/sim`, same states, same decisions)
found places where upstream poke-engine plays a different game than the simulator. Silver builds the same version with corrections:

```
python scripts/build_poke_engine.py           # pinned PyPI source (sha256 checked) + engine/poke-engine/patches, installed as 0.0.48+silver.1
python scripts/build_poke_engine.py --check   # which build is installed
python scripts/build_poke_engine.py --plain   # the upstream build, to compare
```

Needs a Rust toolchain (rustup.rs) and git. The app still runs with the upstream build; `ai_levels` / health report
`master.engine_version` and `master.simulator_rules` (`corrected` or `upstream`, with a hint to build Silver's).

## What the patch corrects (engine/poke-engine/patches/0001-match-the-simulator-rules.patch)

| Rule | Upstream poke-engine | Simulator (and Silver's build) |
|---|---|---|
| End-of-turn order | status damage, then Leftovers; Leech Seed after both | Leftovers / Black Sludge (order 5), Leech Seed (8), poison (9), burn (10), Curse (12): a full burned Pokémon with Leftovers ends at -1/16 |
| Toxic damage | floor(maxhp × stage / 16) | floor(maxhp / 16) × stage (Blissey at stage 3: 132, not 133) |
| Black Sludge on a non-Poison holder | min(maxhp/16, missing HP): no damage at full HP | 1/8 of maximum HP (none with Magic Guard) |
| Heal Block (Psychic Noise) | Leftovers / Black Sludge still heal | no item healing |
| Defog | clears hazards, screens and terrain only | also lowers the target's evasion by one stage (not through a substitute) |
| Rest | works at full HP and with Insomnia / Vital Spirit / Comatose; keeps the toxic counter | fails in those cases; sleep replaces bad poison and its counter goes |
| Curse | always +1 Atk / +1 Def / -1 Spe and a harmless `curse` volatile on the user | a Ghost loses half its HP and curses the target (1/4 a turn); others only get the stat changes |
| Item removal on a knock-out | Weakness Policy (and other on-hit items) used up by the hit that knocks the holder out | the fainted holder keeps it |
| Shed Skin | cures every turn | 1/3 chance; the end of turn does not branch, so it plays the likeliest outcome (no cure) |

The parity kit itself was corrected too (`probe.py`): multi-hit moves are compared by the sum of their hits (poke-engine writes one Damage
instruction per hit), a form change during the turn keeps the Pokémon's key, and a fainted Pokémon's toxic counter is not compared.

## Measured

`python scripts/parity_poke_engine.py --force` on 2026-11-04: 1313 of 1427 turns match (92.0%). On the 1404 turns of the previous corpus
1290 match (91.9%), against 1209 (86.1%) with upstream poke-engine and the old probe. The 23 new `rule-*` turns of `edges.mjs` all match;
`tests/test_master_rules.py` plays them in both engines and fails on any divergence, and tests every corrected rule on a concrete state.

## Known limits that remain

- Heal Block, Throat Chop and a few other volatiles have no duration in poke-engine (they last the whole search, the simulator ends them
  after two turns); the master state is rebuilt from the real battle every turn, so this only affects the look-ahead.
- Two-to-five-hit moves play 3 hits (4 with Loaded Dice, 5 with Skill Link); Population Bomb and Triple Axel do not check accuracy per hit.
- Rough Skin / Iron Barbs do not react to fixed-damage moves (Seismic Toss) in poke-engine.
- The remaining `hp` rows are mostly turns whose chance branches differ (consecutive Protect, Sucker Punch, secondary effects) or
  switch-ins; see `engine/parity/poke-engine/REPORT.md` for the current table.
- The patched Rust unit tests of upstream that assert the old order were not updated (they are not run by the build).
