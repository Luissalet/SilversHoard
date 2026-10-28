# poke-engine against the simulator

The master AI (`engine/src/master.mjs` -> `silvers_hoard/master_ai.py`) searches thousands of futures a turn with poke-engine 0.0.48. Its
search is only as good as the rules it searches over, so this kit asks one question: from the same state and with the same decisions, does
poke-engine believe what `@pkmn/sim` then does? A divergence is a place where the AI plans on something that does not happen.

It is a differential test built on the kit of Hoard Link (`hoard_link.parity`: corpus, traces, block comparison with the first differing
line, version lock, oracle cache). The kit is run from the Hoard Link repository next to this one (`HOARD_LINK_REPO` or `--hoard-link`);
nothing of it is copied here.

## Run it

```
python scripts/parity_poke_engine.py                  # 220 random battles + the edge battles; writes REPORT.md and REPORT.json
python scripts/parity_poke_engine.py --battles 30     # a quick pass (about a minute)
python scripts/parity_poke_engine.py --json           # the numbers on stdout
python scripts/parity_poke_engine.py --force --fresh  # run even if nothing changed, ignore the cached oracle
python scripts/parity_poke_engine.py --lock           # pin node, poke-engine and @pkmn/sim in lock.json
```

The exit code is 0 when the run completed (divergences are the result, not a failure of the run); `--strict` makes divergences exit 1;
2 means the run could not be made (a process failed, the pinned versions do not hold, empty traces). The agents' MCP tool
`engine_parity_status` reads the last REPORT.json without running anything.

Also: `node engine/parity/poke-engine/show.mjs <inputs.jsonl> <case id> [roll]` plays one case in the simulator and prints its protocol
log; `python engine/parity/poke-engine/explain.py <inputs.jsonl> <case id>` prints poke-engine's likeliest branches for it. The work files
(inputs, oracle and probe traces) are in `.work/poke-engine-vs-sim/` (not versioned).

## How a case is played

- **Corpus** (`corpus.mjs`, `edges.mjs`): 84 turns from about 40 scripted edge battles (weather, statuses, priority, multi-hit, fixed
  critical hits, hazards, screens, terrain, items, abilities) plus up to 6 turns of each of N seeded random battles of gen 9 singles
  (switches and Terastallization included). Each case holds the seed, the teams, the history to replay and the decision of each side.
- **Oracle** (`oracle.mjs`, `lib.mjs`): the simulator replays the history, then plays the turn with a scripted random source: every chance
  takes its likeliest result, a duration its longest, a critical hit lands only when the case forces it; the damage roll is the highest and the
  lowest. The state before the turn is read with `masterState` (the same function the AI uses), the state after with the same summary.
- **Probe** (`probe.py`): `silvers_hoard.master_ai.build_state` builds poke-engine's state from that same data and
  `generate_instructions` gives every outcome of the turn; the probe takes the likeliest branch (or, in a case that fixes critical hits, the
  branch where they land) and reads the same summary from poke-engine's state after it.
- **Events** (the traces of both sides): `["state","order", "p1"|"p2"|null]` (who hit first), `["state","damage.first", n]` (the damage of that
  hit; the simulator gives a mean or an interval of its rolls, poke-engine plays the average roll) and `["state","after", {...}]` (hit points,
  statuses, items, Terastallization, boosts, side conditions, volatile statuses, substitute, weather, terrain, Trick Room). Values that
  depend on the damage roll are `$approx` or `$range`, results that can come out in two ways `$oneof`.
- A turn that ends the battle is compared on hit points only (the simulator stops before the end-of-turn effects).

"Empty output proves nothing": an empty trace, a missing case or a crashed process is an error of the run, never a pass.

## Not covered

Doubles and other generations; pivot moves (U-turn and the like stop the turn half way in the simulator) and anything that needs a choice
in the middle of a turn; Mega Evolution; PP; the turn after a forced switch; the unlikely branches of a chance (except fixed critical hits);
the search itself (which move the AI picks), only the rules it searches over; items poke-engine has no name for (it plays them as
`unknownitem`, the oracle keeps the real one). Abilities are not compared by name, only through what they do.

## What it found (run of 2026-10-28: 1180 of 1404 turns match, 84.0%; 224 diverge)

REPORT.md is the generated table; this is the reading. Confirmed means reproduced in isolation with `explain.py`/`show.mjs` or by changing
the input state.

1. **Duration counters of Taunt and Encore (confirmed).** poke-engine counts the turns that have *passed* (0, 1, 2; the volatile is removed
   when it reaches 2, and any value of 3 or more makes `generate_instructions` panic with "Taunt duration cannot be 3 when taunt volatile is
   active"). `engine/src/master.mjs` passes the simulator's `duration`, the turns that *remain* (3 right after the move, 4 when the target had
   already moved). The AI therefore believes Taunt and Encore end a turn early (or too late), and when the value is 3 or more
   poke-engine panics, so `master_ai.py` has no answer for that turn. The fix is `passed = clamp(3 - remaining, 0, 2)`; confusion, Yawn, Slow Start and the locked
   moves have to be checked the same way. Seen in 46 `volatile` turns and 2 `probe_error` turns.
2. **Order of the end-of-turn effects (confirmed, `hp`, 83 turns).** The simulator heals with Leftovers before the status damage (a full
   Pokemon with Leftovers that is burned ends at -1/16); poke-engine does the damage first and then the heal, so it ends at full health
   (e005t1: 360 against 384). The other `hp` divergences are of the same kind
   (end-of-turn effects, recoil, drain) or follow from the multi-hit and form differences below.
3. **Multi-hit moves (`damage.first`, 27 turns).** poke-engine plays Dual Wingbeat and Bullet Seed as a single average hit (256 / 249 of
   damage) where the simulator plays two hits or the likeliest number of hits (470 to 554 / 404); Tail Slap and Triple Axel show the same.
4. **Defog (`boosts.evasion`, 12 turns).** The simulator lowers the target's evasion by one stage; poke-engine does not.
5. **Toxic counter (`side.toxic_count`, 9 turns).** poke-engine keeps (or raises) a toxic counter after Will-O-Wisp, Rest or a status cure
   where the simulator has none.
6. **Forms (`active`, 7 turns).** Eiscue (Ice Face) and Morpeko (Hunger Switch, Aura Wheel) change form at a different moment.
7. **Items (`item`, 6 turns).** poke-engine consumes Weakness Policy and Chesto Berry in turns where the simulator keeps them.
8. **Smaller groups:** status after Rest/Sleep Powder, stat stages after a few moves (Iron Defense, Fleur Cannon, Dragon Dance), substitute
   health, hazard layers after Spikes/Stealth Rock/Sticky Web in the same turn, the turn counter of Reflect and Aurora Veil, and a handful
   of volatiles (Curse, Throat Chop, Heal Block, Disable, Unburden) that appear or expire one turn apart.

Artefacts of the experiment itself that were found and fixed on the way (so they are not findings): the order and size of a hit when one side
uses Sucker Punch (poke-engine's damage calculator takes "the first side moves first" and answers 0 for a move that needs to go first
otherwise), fainted Pokemon keeping a status or boosts in poke-engine, random drag-in moves, sleep and confusion durations, ties in speed,
items poke-engine calls `unknownitem`, multi-hit accumulation and zero-damage hits.

## Files

| File | What it is |
|---|---|
| `harness.py` | The kit's harness: corpus, oracle and probe commands, scope text, dependencies, version lock |
| `corpus.mjs`, `edges.mjs` | The cases: random battles and scripted edge battles |
| `lib.mjs` | Scripted random source, replay, the summary of a state, helpers |
| `oracle.mjs`, `probe.py` | The simulator's side and poke-engine's side |
| `show.mjs`, `explain.py` | Look at one case on either side |
| `lock.json` | Pinned versions: node, poke-engine, `@pkmn/sim` package.json hash |
| `REPORT.md`, `REPORT.json` | Generated by the last run |
| `../rt-prng.mjs` | Real-time arena: PRNG-call trace of the fixtures (see `engine/test/rt-prng-trace.test.mjs`) |

Tests: `engine/test/poke-engine-parity.test.mjs` (the kit's pieces), `tests/test_parity_poke_engine.py` (probe, script, harness, a small
end-to-end run and the MCP tool).
