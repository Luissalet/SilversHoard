# Working on Silver's Hoard

Pokémon battle simulator of the Hoard family (package `silvers_hoard`, service `silvers-hoard`, app id `silver`, port 5230). Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) first.

## Commands

```bash
npm ci                                   # the engine's packages (@pkmn/sim...) and the client's
npm run build                            # the app UI into silvers_hoard/static and the playable page into static/play/play.html
python -m silvers_hoard                  # http://127.0.0.1:5230 (SILVER_DATA_DIR=<folder> for a scratch copy)
python -m pytest                         # app tests (they start the real engine: Node.js and npm ci needed)
npm run test:engine                      # engine tests: AI legal in gens 1-9, singles and doubles; snapshots; series; tournaments
node engine/scripts/build_canon.mjs <pret files> silvers_hoard/presets/canon.json   # rebuild the in-game teams
python engine/scripts/build_names_es.py <PokeAPI csv> client/src/battle/names-es.js # rebuild the Spanish names
python scripts/make_icon.py --family "../Icons"                                     # the icon from the family dragon
```

## Rules of the code

- The UI, the REST agent route and MCP call the same handlers in `agent_tools.py`. A new tool needs a pydantic argument model, a first description line of at most 110 characters (English, then Spanish keywords) and a test.
- Everything about a battle happens in the engine (`engine/src`): `core.mjs` (formats, teams, Pokédex), `ai.mjs` (the trainers), `match.mjs` (one battle and its views), `stats.mjs` (summaries, series, tournaments). The same files run in the playable page, so they must stay browser-safe (no Node modules outside `server.mjs` and `cli.mjs`).
- The AI reads the battle through a deep copy (`freeze` + `Battle.fromJSON`); it must never change the live battle (`engine/test` checks it).
- Live battles keep a snapshot in the database after every choice; a restarted engine resumes them. `since` counts lines of the live log; finished battles store the omniscient log.
- No Pokémon art ships with the app: sprites come from the Showdown sprite server on first use and stay in `data/cache/sprites`.
- `hoard_link/` is vendored and byte-identical to upstream HoardLink: never edit it here.
- User-facing text in `client/src/i18n.js`, `client/src/battle/strings.js` and `client/src/play/strings.js` (castellano de España first, English second). No taglines.
- Deletes of trainers, gyms and leagues go to the trash (`trash` tool with restore and purge).

## Before finishing a change

1. `python -m pytest` and `npm run test:engine` are green.
2. If the UI changed: `npm run build`, open the running app and play a battle; for the playable page, export a gym and play it from the file.
3. README.md, README.es.md and docs/ARCHITECTURE.md say what the app can and cannot do now.
