# Mega form sprites

The real-time arena first honors an exact explicitly imported walking variant, then the installed PMD library entry for the Mega. An imported normal fallback cannot conceal an available exact shiny PMD variant. If neither supplies the form, the existing battle-art fallback remains. Teams starting in a Mega use the same rule. The installed collection now covers the engine's Mega forms in both palettes; source metadata states their actual headings, poses and available actions. See [the installed PMD library](PMD_LIBRARY.md).

Battle sprites still use the selected source, with Showdown's gen 5 sprites as the first fallback. If a Mega has no picture
there, the shared sprite service tries the corresponding pixel PNG and then the Legends: Z-A model from PokeAPI before falling back to the base
species. Front/back and shiny requests retain their variants, and cached files remain usable with downloads disabled. This
also serves the app's arena. Exported pages carry the 49 public PokeAPI Mega form IDs (including gender and cosmetic variants) so their direct image fallback can use
the pixel PNGs (Z-A's model for Zygarde) without an app or a name lookup. UI, REST and MCP use the same battle handlers;
the separate [overworld import tools](OVERWORLD_SPRITES.md) add directional art when it is available.

The image mapping covers every generation 9 form whose engine name contains Mega, including Meowstic M/F, the three Tatsugiri
forms and Magearna Original. Meowstic's gender abbreviations are mapped to PokeAPI's male/female names. Zygarde uses a model
fallback. This is source availability, not a claim of 49 complete PMD animation sets.
These separate battle-art fallback images download on demand into the user's cache. The reviewed PMD collection ships in the repository and exported HTML independently of that cache.

Sources and attribution:

- [Showdown sprites](https://play.pokemonshowdown.com/sprites/gen5/), including `delphox-mega.png` and its back sprite.
- [PokeAPI sprites](https://github.com/PokeAPI/sprites): `sprites/pokemon/versions/generation-ix/legends-za/`; the repository credits
  [Kyle Dovey](https://github.com/kyledovey) for Z-A Mega sprites. Repository licensing does not grant ownership of Pokémon art.
- [PMDCollab SpriteCollab](https://github.com/PMDCollab/SpriteCollab), CC BY-NC 4.0; existing per-species credits remain displayed.

This change concerns presentation and sprite retrieval. The battle engine already transforms Delphox holding Delphoxite when
the Mega Power gauge is ready; timing, damage, abilities, saved input logs and replay rules are unchanged.
