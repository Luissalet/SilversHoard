# Silver's Hoard

A local Pokémon battle simulator for the Hoard family. It runs on Pokémon Showdown's battle engine (through `@pkmn/sim`), so every generation from 1 to 9, singles and doubles, plays with the real mechanics. You keep trainers, fight them or watch them fight, build gyms and leagues, and send your trainers and gyms to friends as a page they open in any browser.

[Versión en español](README.es.md)

![Battle](docs/screens/battle.png)

## What it does

- **Trainers.** A name, a title, a team, an AI level and style, an avatar and four battle lines (start, last Pokémon, win, lose). Create them by pasting a Showdown export (or PokéPaste, JSON, a packed team), with the visual team builder (species, item, ability, nature, Tera type, EVs, IVs and moves, with suggestions limited to what the species learns), or roll a random one from Showdown's random-battle sets. Duplicate, favourite, trash and restore.
- **In-game characters.** The real teams of the Gym Leaders, Elite Four, champions, rivals and bosses of Crystal (Johto and Kanto, Red on Mt. Silver included), FireRed/LeafGreen and Emerald, with their levels, moves and items. Add one trainer or a whole league: its eight gyms with their badges and types, the Elite Four and the champion, each gym capped at its leader's level.
- **Battles.** You against the AI, two people on one computer, or two AIs (played in the background, then replayed). The battle screen shows both sides with their sprites, HP, status, boosts, Terastal, weather, terrain and hazards; a log in Spanish or English (Spanish move, ability and item names); controls for moves (with type, power, PP and Terastal / Mega / Z / Dynamax when the generation has them), targets in doubles, switches, team preview and forfeit. Finished battles replay with play, pause, step, jump to a turn and four speeds. Live battles survive a restart.
- **The AI.** Five levels: random, easy, normal, hard (the best calculated option every turn: damage measured with the game's own formula on a copy of the battle, status, boosts, hazards, recovery, switching, Terastal) and expert (in singles it plays each candidate turn out on copies of the battle against the opponent's likely answers and keeps the one with the best outcome). Five styles: balanced, aggressive, defensive, setup, stall.
- **Series and tournaments.** The same two trainers N times (win rate, average turns, KOs, damage and survival of every Pokémon, the MVP of each side, one sample battle of each outcome), or a tournament between up to 64 trainers: single elimination with byes or a round robin with a table, best of 1, 3, 5 or 7. They run as background jobs.
- **Gyms and leagues.** A gym has gym trainers (fought in order) and a leader, a type, a badge with its colour and rules (fixed level, level cap, minimum level, extra Showdown rules). Challenge it yourself or let your trainer's AI do it; between battles your team is healed; winning every battle gives the badge. A league needs its badges, then the Elite Four and the champion; whoever beats it enters the hall of fame. A challenge can use the gym's own generation or current rules.
- **Friends.** Export a trainer, gym or league as a file (`.hoardtrainer`, `.hoardgym`, `.hoardleague`) for another Silver's Hoard, a share code to paste in a chat, the team as Showdown text, or a **playable page**: one HTML file with the battle engine and the AI inside. Your friend opens it in any browser, pastes or rolls a team and fights your gym or trainer; at the end the page gives a result code (and a result file with the replay). Importing it here records their battle and, when they won, their badge.
- **Avatars.** Pick any of the 1,500 Showdown trainer sprites, upload a picture, turn a photo into a 96-px pixel-art sprite here (background removed, few colours, outline), or have Prospero's Hoard draw a trainer sprite from the photo with its image engine (a job; you pick among the results; Prospero must be running).
- **Battle lines with AI.** The family's language model (through Hoard Hub: the Sparks, Faustus or Ollama) writes a trainer's four lines from its team and a personality you describe.
- **Family.** Faustus's copilot on every page, an MCP server with 48 tools (`mcp_server.py`), events on the family bus, and the shared Hoard look.

## What it does not do

- No online battles between two copies of the app: friends play your gyms and trainers against the AI in the playable page and send the result back.
- No Pokémon art in the repository or the app: sprites are downloaded from the Showdown sprite server the first time they are needed and kept in `data/cache/sprites`. Without internet the field shows initials until they are cached.
- The AI knows both teams, as in-game trainers do. The expert level searches in singles only; in doubles it plays as hard.
- The result codes are not signed: they are a record between friends, not proof.
- Planned work is in [OBJETIVOS.md](OBJETIVOS.md) and what is left to check in [PENDIENTES.md](PENDIENTES.md).
- The in-game teams cover generations 2 and 3 (the games with full community disassemblies); other generations' characters can be built by hand.

## Install and run

```bash
npm ci                       # Node.js 20 or newer: the engine and the client
npm run build                # the UI and the playable page template
python -m venv venv && venv/Scripts/pip install -r requirements.txt   # or venv/bin/pip on Linux and macOS
venv/Scripts/python -m silvers_hoard    # http://127.0.0.1:5230
```

Hoard Hub finds it through `faustus-plugin.json`. Data lives in `data/` (or `SILVER_DATA_DIR`): `silver.db`, avatars, exports and the sprite cache.

## For assistants

`python mcp_server.py` is a stdio MCP bridge to the running app (it starts it when needed). The tools cover the whole app: `battle_start` / `battle_choose` to play, `series_start` and `tournament_start`, `challenge_start`, `canon_install`, `export` / `import`, `avatar_from_photo`, `trainer_dialogue_write` and the rest (`GET /api/agent/tools`).

## Credits

Battle engine: Pokémon Showdown by Guangcong Luo and contributors, through the `@pkmn` packages (MIT). In-game teams from the pret disassemblies (pokecrystal, pokefirered, pokeemerald). Spanish names of moves, abilities, items and natures from PokeAPI's data. Sprites are served by the Showdown sprite server.

This is a fan project and is not affiliated with Nintendo, Game Freak, Creatures or The Pokémon Company. Pokémon and all related names are trademarks of their owners.

## Licence

MIT (code). See [LICENSE](LICENSE).
