# Trainer preparation, contests and secret bases

The Battle menu opens the ordinary avatar editor for each selected trainer. Choosing or uploading a picture saves through the existing trainer/avatar handlers and refreshes the selection. Photo identity inputs have enlarged previews and stay selected when switching tabs. Style references are a separate library, available directly in that editor and in Settings: upload files or choose existing personal pictures, Showdown trainer sprites or official artwork. Check at most three active references. `avatar_style_set.selected` stores their exact order; an empty selection means none. The former local pixel conversion remains as **Convert first photo to a 96 px sprite**.

`trainer_get` returns `team_pool` and the saved team's `team_pool_indices`. For a character installed from a facility pool, the original catalogue supplies the complete reserve even when the old installation kept only six. Edited team members absent from that reserve remain available. `battle_start.p1/p2.team_indices` chooses six distinct zero-based slots, in lead order, without editing the trainer. `character_install.team_indices` can save a chosen six while retaining the catalogue pool. Different selections have different installation identities; repeating the same selection reuses its trainer.

## Silver Super Contests

The Contests page and `leisure_catalog`, `contests_list`, `contest_start/get/choose` use the same persistent rules. A trainer enters one Pokémon with its existing moves in one of five categories and four ranks. Each contest snapshots its entrants, seed, move categories, phase, scoring events and revision. It resumes from the saved phase; it never changes a trainer's team or battle record.

1. Presentation: select up to three accessories. Each theme match scores four, each category match three, plus eight base points and the entered condition divided by 32 (integer, at most seven). Condition is a freely entered contest preparation value, not a berry-feeding subsystem.
2. Dance: eight directions at 650 ms intervals after a one-beat countdown. Each correct direction earns up to four points depending on its timing offset. Arrow keys and touch buttons share the recorder. A new rehearsal clears the previous recording before submission; the score and individual hits are saved.
3. Acting: four appeals to three judges. A move gives three base points, two for matching the contest category, and three/one/zero if one/two/more entrants choose that judge. Repeating the previous move loses three. Matching moves raise voltage; five voltage awards five extra points and resets that judge. CPU choices and scores are reproducible from the saved seed. First place, including a tie for first, earns a saved ribbon.

The structure is inspired by Platinum's visual/dance/acting contests, with four entrants and three judges. Scoring, accessories and CPU rules are original to Silver. This is not cartridge parity: it does not implement the full move-effect/combination tables, Poffin feeding, every dance sequence, original dress-up art, rank unlocks or multiplayer contests. The available moves expose their existing game `contest_type` through the ordinary Pokédex API. The LLM and image-generation services are not needed to play.

## Secret bases

The Secret bases page creates tree, cave or shrub rooms on an 8×8 grid. Place up to sixteen furniture tokens, rugs, posters and Pokémon dolls. Solid objects block walking; rugs, cushions and posters do not. The entrance and host cells are reserved, and a flood-fill validates a path between them. Click adjacent tiles or use arrows/WASD to walk. Near the host, choose a visiting trainer and start an ordinary battle against the host's team.

`secret_bases_list`, `secret_base_get/save/export/import/battle` expose the same workflow. Archiving is reversible. A portable JSON export carries the decorations, welcome message, owner name, format and a snapshot of the host team. Import creates a separate local base and strips local IDs; visiting an imported base uses its embedded team. A local base uses its live host trainer. Imported portraits are not embedded. Bases do not recreate Platinum's Underground, capture-the-flag, world-map excavation, traps or network exploration.

Database migration 9 adds `silver_contests` and `secret_bases` only. No trainer, battle or gym schema is replaced.

## Animation presentation

Poké Balls use the unchanged user-supplied 64 px atlas cells for flight and opening, with the original procedural real-time ball as decode fallback. Turn-based and real-time screens and exported playable pages include the atlas. The renderers do not change simulator rules or damage. Reduced motion omits decorative burst playback. Source provenance is in [ASSET_PROVENANCE.md](ASSET_PROVENANCE.md).

PMD metadata schema 2 retains a valid `HitFrame` and requests a real `SpAttack` sheet when available, including `CopyOf` aliases. Cached schema-1 metadata is refreshed on use; if upstream is unavailable, the old cache remains usable. Missing special poses use the existing Shoot/Attack fallback. The renderer times the lead-in frames to reach the hit pose at the existing windup boundary. It does not move that boundary or import new battle rules. Old metadata without a marker keeps full-sequence timing.

The real-time gauge is labelled **Silver special**: it is an invented extra 150-power attack, distinct from the four moves and the cartridge's charging moves. This clarification does not remove it or alter historical replays. Whether to change its default or design remains a separate product decision recorded in Ágora task 691.
