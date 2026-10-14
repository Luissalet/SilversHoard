# Silver's Hoard — architecture

## Pieces

```
browser (React UI, client/)  ──/api/ui/call──►  FastAPI app (silvers_hoard/)  ──JSON lines──►  Node engine (engine/src/server.mjs)
MCP client ──stdio── mcp_server.py ──/api/agent/call──►        │                                   @pkmn/sim + ai.mjs
                                                                ├── SQLite data/silver.db            (live battles in memory)
                                                                ├── jobs: node engine/src/cli.mjs  (series, tournaments, watched battles)
                                                                ├── sprites: Showdown sprite server → data/cache/sprites
                                                                └── family: Hoard Hub (copilot, events, LLM, Prospero)
playable page (static/play/play.html) = React battle screen + engine/src (core, ai, match) inlined, data slot filled on export
```

## Engine (`engine/src`, ES modules, also bundled into the playable page)

- `core.mjs` — formats (`buildFormatId` adds Showdown custom rules after `@@@`), team import/export (`@pkmn/sets`), `completeSets` (fills ability and Tera type), `applyLevelRules` (fixed level, cap, minimum: applied to the sets because Showdown only applies "Adjust Level" in its validator), validation (`TeamValidator`), random teams (`@pkmn/randoms`, seeded), Pokédex search and learnsets, team summaries.
- `ai.mjs` — `chooseFor(battle, side, {level, style, rng})`. Reads a deep copy of the battle (`freeze` = `JSON.stringify(battle.toJSON())`, `Battle.fromJSON` of a fresh parse; `fromJSON` keeps references into its input, so a copy is never reused). Damage is `battle.actions.getDamage` on the copy (every generation's formula, abilities, items, weather), times accuracy and expected hits, with absorbing abilities handled. Status, setup, hazards, hazard removal, recovery, protection, screens, weather and terrain have their own scores, weighted by style. Switching weighs the best damage given against the best taken. Team preview orders by type matchup. Doubles: per slot with targets, spread moves, ally damage. Expert (singles): up to nine own options × the opponent's three best moves and two best switches, each played out on copies with two seeds, scored by an evaluation (HP, status, boosts, hazards, screens, KO), choosing 0.65 × weighted mean + 0.35 × worst case.
- `match.mjs` — `Match`: a battle with two seats; AI seats choose in `advance()`, a person's seat waits for `choose()`. `state(view, since)` returns the new lines for a seat (`viewLines` resolves `|split|` blocks), the pending requests annotated for screens (move type, power, category, description; team sprite ids, types, item and ability names) and the result. Turn limit → tie. `snapshot()` for resuming.
- `stats.mjs` — `summarize` (KOs, damage, faints per Pokémon from the log), `playOut`, `series`, `tournament` (bracket with byes, or round robin with points).
- `server.mjs` — the line protocol (one JSON request per line, one answer per line, errors as data). `cli.mjs` — one-shot runs with progress on stderr.
- `scripts/build_canon.mjs` — parses pret's trainer data (Emerald and FireRed C sources, Crystal asm) into `silvers_hoard/presets/canon.json`: 79 trainers and 4 leagues; empty move slots get the last four level-up moves from Showdown's learnsets, like the games. `scripts/build_names_es.py` — Spanish names from PokeAPI's CSVs into `client/src/battle/names-es.js`.

## App (`silvers_hoard`)

- `engine.py` — starts and talks to the Node process (ids, timeouts, restart after a crash), and runs `cli.mjs` jobs with progress and cancel.
- `store.py` — SQLite: `trainers`, `gyms`, `leagues` (with trash), `battles` (seats with their teams, status live/running/ended/failed, omniscient log, summary, snapshot), `runs` (gym and league challenges and their stages), `badges`, `hall`, `jobs`.
- `services.py` — everything: trainers (create, update, random, duplicate, lines with the family's model), canon install (trainers, gyms with badges and level caps, leagues), battles (play, hot-seat, watched; `since` counts lines of the live log; finishing stores the omniscient log, records wins and advances the challenge), challenges (stages, auto mode, badges, hall of fame, optional modern rules), series and tournaments (jobs; sample battles stored), sharing (files, codes, playable pages, result codes), avatars (pixel art, upload, Prospero job through Hoard Hub), settings.
- `sharing.py` — wrappers `silvers-hoard/<kind>`, codes `SILVER1-` / `SILVERWIN1-` (zlib + base64url), `parse_any` (codes, JSON files, playable pages, Showdown text), the playable page writer (fills the `silver-data` script tag).
- `sprites.py` — the sprite cache (download once, remember 404s for a week, fallback to gen 5 pixel art), avatars and the photo → sprite filter (corner flood-fill background removal, crop, box downscale, 24-colour palette, outline).
- `agent_tools.py` — the 48 tools; `api/` — routes; `main.py` — the app factory (guard, PWA, SPA, copilot from Hoard Link).

## Client (`client/src`)

- `battle/` — shared by the app and the playable page: `protocol.js` (protocol reducer + sentences in Spanish/English), `player.js` (timed playback, seek, skip), `Arena.jsx` (field, sprites with Web Animations, HP cards, field effects, trainer bubbles, log), `Controls.jsx` (team preview, moves, targets, gimmicks, switches, forced switches, replay bar), `dex.js` (types, sprite ids, Spanish names, sprite URLs).
- `pages/` — Inicio, Combatir (battle / series / tournament), Combate, Trabajo (series stats, bracket, table), Entrenadores, Entrenador (team cards, team builder, text, AI, lines, battles), Gimnasios / Gimnasio (editor, challenge, badge holders), Ligas / Liga, Personajes, Historial, Medallas, Compartir, Ajustes.
- `play/` — the playable page: target card, the friend's team (paste, random, trainer file), validation with the gym's rules, the stages one after another, result code and result file.

## Data formats

- `.hoardtrainer` `{kind: "silvers-hoard/trainer", schema: 1, app, owner, exported_at, trainer: {name, title, owner, format, team, ai, dialogue, notes, avatar: {kind: showdown|image}, source_id}}`; `.hoardgym` has `gym: {…, leader, trainers}`; `.hoardleague` `league: {…, gyms, elite_four, champion}`.
- Result codes: `{kind, gym_id | trainer_id, gym_name | trainer_name, challenger, won, turns, date, team, team_paste, stages, log?}`.
