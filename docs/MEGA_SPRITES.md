# Mega form sprites

The real-time arena uses a Mega's PMD animation when that form has sheets. If SpriteCollab returns the normal species instead,
the arena draws the Mega's battle sprite. Normal and shiny base sheets no longer conceal the form change. Teams that start in
a Mega form use the same rule. Normal Pokémon retain their walking animations.

Battle sprites still use the selected source, with Showdown's gen 5 sprites as the first fallback. If a Mega has no picture
there, the shared sprite service tries the corresponding Legends: Z-A model from PokeAPI before falling back to the base
species. Front/back and shiny requests retain their variants, and cached files remain usable with downloads disabled. This
also serves exports through the existing sprite pipeline. No new tool is needed: UI, REST and MCP use the same battle handlers.

On 17 October 2026, HTTP checks of the engine's 40 generation 9 Mega forms found 46 of 80 front/back PNGs on Showdown and all
80 front/back WebPs in PokeAPI's Z-A collection. This is source availability, not a claim of 40 complete PMD animation sets.
Art is downloaded on demand into the user's cache and is not shipped in the repository.

Sources and attribution:

- [Showdown sprites](https://play.pokemonshowdown.com/sprites/gen5/), including `delphox-mega.png` and its back sprite.
- [PokeAPI sprites](https://github.com/PokeAPI/sprites): `sprites/pokemon/versions/generation-ix/legends-za/`; the repository credits
  [Kyle Dovey](https://github.com/kyledovey) for Z-A Mega sprites. Repository licensing does not grant ownership of Pokémon art.
- [PMDCollab SpriteCollab](https://github.com/PMDCollab/SpriteCollab), CC BY-NC 4.0; existing per-species credits remain displayed.

This change concerns presentation and sprite retrieval. The battle engine already transforms Delphox holding Delphoxite when
the Mega Power gauge is ready; timing, damage, abilities, saved input logs and replay rules are unchanged.
