# pixelfx animation style

Fourth option of Settings > "Estilo de las animaciones" (`silver-fx-style = pixelfx`, client-side localStorage). It plays the effects of
patch-gg/pixelfx 0.3.1 (MIT, Patch and Hugo Duprez) on the real-time arena, the turn-based screen and mass battles. It only reads events
and views: a battle's result never changes.

## What is vendored

`client/src/battle/pixelfx/` holds the whole upstream library: `core/` (runtime, painter, particle simulation, compositor, the acting rig,
poses, chains and scenes) and `fx/` (all 244 effects in 21 categories, `fx/index.js` and `fx/categories.js`), unchanged, with `LICENSE` and
`NOTICE.md`. Not included: the "Patch Pixel" font of the upstream gallery (not MIT), the gallery app and the authoring tools
(`tools/render.mjs`, `check.mjs`, `act.mjs`, sprite-sheet export), which need a terminal and are not used at runtime.
Silver's own files: `registry.js` (catalog + `effectInfo`), `mapping.js` (what plays what), `layer.js` (the painter), `gate.js` (lazy load and
pins), `preview.js` (the explorer's player).

| category | effects | vendored | mapped to battle | explorer only |
|---|---|---|---|---|
| arcane | 12 | 12 | 12 | 0 |
| critters | 12 | 12 | 2 | 10 |
| explosions | 12 | 12 | 8 | 4 |
| fire | 12 | 12 | 9 | 3 |
| holy | 10 | 10 | 9 | 1 |
| ice | 10 | 10 | 9 | 1 |
| impacts | 11 | 11 | 7 | 4 |
| lightning | 11 | 11 | 8 | 3 |
| melee | 12 | 12 | 11 | 1 |
| moves (whole attacks with a body) | 12 | 12 | 0 | 12 |
| nature | 13 | 13 | 13 | 0 |
| pickups | 11 | 11 | 7 | 4 |
| projectiles | 13 | 13 | 6 | 7 |
| scifi | 12 | 12 | 4 | 8 |
| shadow | 12 | 12 | 11 | 1 |
| spawn | 10 | 10 | 3 | 7 |
| status | 13 | 13 | 10 | 3 |
| transitions | 10 | 10 | 0 | 10 |
| ui | 12 | 12 | 2 | 10 |
| water | 12 | 12 | 10 | 2 |
| weather | 12 | 12 | 10 | 2 |
| **total** | **244** | **244** | **151** | **93** |

The counts come from `coverage` in `silvers_hoard/presets/pixelfx_map.json` (regenerate with `node scripts/gen_pixelfx_map.mjs`).
Every effect can still be pinned to a move by hand, the explorer-only ones included.

## What plays what (`mapping.js`)

Order for a move: an effect pinned by hand, then the move's own row in `MOVE_TABLE` (516 of the 935 real-time moves: Flamethrower a
flamethrower, Thunderbolt chain lightning, Thunder a lightning strike, Earthquake a quake, Hydro Pump a water jet, Surf a wave, the claws and
bites claw-swipe, the drains soul-drain from target to user, Protect a divine shield, Rest sleep, Trick Room time-stop, Make It Rain a coin
drop...), then its type's row in `TYPE_TABLE` by role. A cell is `[role:]category/name[~[#rrggbb]][ | hit cell]`: the role says where it
plays (impact on the target, projectile along the shot, beam/cone from the user towards the target, area, drop from the sky, self on the
user), `~` recolours it with the type's ramp (or the given colour's), `| ...` adds the effect on the target when the move hits.

- Melee effects (and others that face right) are placed so their own target point (`act.target`) lands on the Pokemon hit.
- Statuses: `STATUS_BODY` plays on the Pokemon itself in real time (status/burning, lightning/electrified, status/poisoned, status/frozen,
  status/sleep); `STATUS_TABLE` is the flat fallback for screens whose Pokemon cannot be read (turn-based).
- Conditions (`EVENT_TABLE`): confusion, flinch, taunt, torment, yawn, curse, heal block, leech seed, ingrain, aqua ring, magnet rise,
  focus energy, substitute, attract, Trick Room, gravity.
- Weather and terrains (`WEATHER_TABLE`, `TERRAIN_TABLE`) loop over the whole field while they last and replace the painter's own weather
  particles: rain, storm (heavy rain), snow, blizzard (hail), a sand-coloured gale (sandstorm), god rays (sun), clouds (strong winds),
  sparks (electric terrain), leaves (grassy), pink fog (misty), a pink aurora (psychic). They repaint at 12 fps.
- On-body effects (37: statuses, halo, freeze, glitch...) get the Pokemon's own pixels: the arena calls `captureActor` after drawing each
  Pokemon and the layer builds the effect's actor (mask + colours) at the effect's scale; where nothing can be read it plays the fallback.
- Determinism: seeds come from FNV-1a over battle seed, effect id, a serial counter and event tick/side/move; pins are data, so the same
  battle and pins play the same pixels.

## Effects explorer (`#/efectos`, Settings > "Explorar los efectos pixel art")

All 244 effects animated (on-body ones on the upstream stand-in, as the upstream gallery shows them), filter by category or words, only
those a move plays, try any type's palette, see the effect's own palette, options, length and the moves that play it, and pin it to a move
(role, type colours or a colour of your own). Pins are stored in `data/pixelfx_pins.json`, win over the automatic mapping in every battle
screen and reach open battle screens at once (window event `silver-pixelfx-pins`).

## Agents and REST

| tool | REST | what |
|---|---|---|
| `pixelfx_map` | `GET /api/pixelfx/map` | effect of a move (pin first), type (+ category/shape), status, weather, terrain; empty: coverage and pins |
| `pixelfx_effects` | `GET /api/pixelfx/effects` | the catalog: id, category, description, loop, seconds, size, on-body, options, moves using it |
| `pixelfx_moves` | `GET /api/pixelfx/moves` | every move with the effect it plays now, by type, source (pin/move/type), effect or name |
| `pixelfx_pins` | `GET /api/pixelfx/pins` | the pins with the automatic effect each replaces |
| `pixelfx_pin` | `PUT /api/pixelfx/pins/{move}` | pin an effect (tint, color, role) |
| `pixelfx_unpin` | `DELETE /api/pixelfx/pins/{move}` | drop a pin |

## Tests

`engine/test/pixelfx-style.test.mjs` (mapping coverage, determinism, results unchanged), `engine/test/pixelfx-catalog.test.mjs` (244
effects play, per-move effects, pins, statuses on the body and their fallback, weather/terrain, melee placement, pins never change a
battle; it prints how many moves have their own effect), `tests/test_pixelfx_map.py`, `tests/test_pixelfx_pins.py` (catalog, coverage,
moves, pins via tools and REST).

## Limits

- The style setting is per browser; pins are per server (every viewer).
- The 12 `moves/*` effects and the acting rig (`createAct`, wind-up poses of the stock character) are not played in battles: Silver draws
  the Pokemon itself and the distance between them changes, so those stay in the explorer (they can still be pinned).
- On-body effects in the turn-based screen and mass battles play their flat fallback (no Pokemon pixels there).
- Upstream descriptions are shown in English as written by the library.
