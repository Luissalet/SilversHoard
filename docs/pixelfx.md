# pixelfx animation style

Fourth option of Settings > "Estilo de las animaciones" (`silver-fx-style = pixelfx`, client-side localStorage).

- Source: patch-gg/pixelfx (MIT). 79 of 244 effects vendored in `client/src/battle/pixelfx/` (LICENSE + NOTICE.md; the Patch Pixel font is NOT included).
- Hook: `Vfx` (`rt/vfx.js`) owns a lazy `PixelfxLayer`, so real-time, turn-based (`FxStage`) and mass battles share it. The layer only reads events; it never writes simulation state.
- Mapping (`mapping.js`, pure): move shape/category selects a role (impact, projectile, beam, area, drop, self); the type picks effect family and palette; statuses map brn/par/psn/tox/frz/slp to effects; boost/heal/faint have their own.
- Determinism: seeds come from FNV-1a over battle seed, effect id, a serial counter and event tick/side/move.
- Agents: tool `pixelfx_map` (REST `POST /api/ui/call`) returns the generated table `silvers_hoard/presets/pixelfx_map.json` (regenerate with `node scripts/gen_pixelfx_map.mjs`; `--check` runs in pytest).
- Tests: `engine/test/pixelfx-style.test.mjs` (mapping coverage, determinism, results unchanged), `tests/test_pixelfx_map.py`.
- Limits: setting is per browser; actor/acting effects of upstream are not used; 165 upstream effects not vendored.
