# Assets and research for the October 2026 expansion

`client/src/battle/pokeball-sheet.png` is the exact file supplied by Luis on 17 October 2026: `all_pokeball_sprites_for_throw_animation_by_anarlaurendil_ddhnxzf.png`, attributed in its filename to Anarlaurendil. It is a transparent 1408×2048 PNG, arranged as 22 columns and 32 rows of 64 px cells. No pixels or metadata were changed. The renderer selects cells at runtime; `scripts/build_ball_art.py` only embeds the original bytes as a data URL for portable builds. The first three columns supply Poké Ball views and opening/burst frames. Other ball styles in the supplied sheet are not exposed by this first implementation.

The file's original redistribution licence has not been established here. It is user-provided reference material used in this local requested build; neither Silver's software licence nor the licences of the researched repositories are asserted to cover its artwork. Pokémon imagery retains its original rights. Replace or clear this asset before a distribution that requires independently verified artwork permissions.

Alternatives inspected without importing their code or art:

- [pret/pokeplatinum](https://github.com/pret/pokeplatinum), commit `1dc13dcea40c04ab53f1f607de46023dc409ef20`: contest constants (four participants, three judges and visual/dance/acting modes), and `res/graphics/battle/ball_throws/shared_anim.json` plus its cell geometry. The source distinguishes rotating and opening sequences. Silver's scoring and animation orchestration are its own.
- [pret/pokeemerald](https://github.com/pret/pokeemerald): `src/secret_base.c`, `src/contest.c` and `src/pokeball.c`, consulted for the functions and structure of bases, contests and ball release. No cartridge assets or code from these files are incorporated.
- [PokéRogue assets](https://github.com/pagefaultgames/pokerogue-assets), commit `009cac30c39d3615c7b2c320c3984af368871031`: separate closed/opening/open Poké Ball assets, and its REUSE information. No files were imported.
- Existing Emerald Arena research remains in Ágora 671 and `research-inbox/silver-emerald-arena-20261017`. The follow-up here adds HitFrame/SpAttack handling to Silver's existing PMDCollab cache. Those remotely downloaded sprites keep their existing contributor credits and licence.

The geometric accessory and furniture tokens in `LeisureArt.jsx` are original code-native drawings for editable controls and the room grid. They are not sourced game furniture sprites. Base surface colours intentionally extend the incumbent Hoard interface with earth, stone and foliage tones; the app shell, typography and controls retain the existing system.
