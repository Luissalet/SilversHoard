# Imported overworld sheets

`overworld_import` imports the Z-A Mega ZIP and the 265×258 Delphox-line sheet supplied by the user. Its arguments are the local
file path, original resource URL and artist credits. `overworld_list` returns the stored forms, variants, frame rectangles,
source and credits. The same handlers serve REST, MCP and the normal UI call route. Art remains in persistent `data/overworld`,
outside the source repository, with content-hash filenames. Reimporting the same form replaces its index entry without
duplicating the original PNG. Unrelated forms remain intact.

The supplied ZIP contains nine forms with normal and shiny variants: Clefable, Victreebel, Dragonite, Hawlucha, Malamar,
Starmie, Raichu X/Y and Lucario Z. Its 4×4 sheets use down/left/right/up rows. The Delphox sheet contains Fennekin, Braixen,
Delphox and Mega Delphox, normal and shiny, with two frames per direction. The importer records their exact rectangles and
background color; the renderer removes that color in memory. Original PNG bytes and foreground colors are preserved.

Real-time singles/doubles use these sheets when the requested form has no matching PMD animation; genuine PMD sheets keep
precedence. Four directions are mapped to arena headings and walking follows the existing animation clock. These sheets do
not contain directional attack/hurt/faint animations, so none are claimed or synthesized. Failed images retain the static
Mega fallback. This does not add art to the separate mass renderer, nor change movement, damage, hit timing or replay rules.

Trainer/gym playable exports embed the imported PNGs and frame metadata. They draw the same walking sprites without a running
Silvers app, and show clickable artist credits separately from PMDCollab credits. This does not make battle music and other
existing remote assets available offline. The direct static Mega fallback also includes Absol Z, Garchomp Z and Lucario Z,
whose catalog entries do not carry the engine's `isMega` flag.

Static coverage checks found 84 of 86 front/back pixel PNGs for all 43 new Mega forms in PokeAPI. Only Zygarde needs the Z-A
model fallback. Pixel PNGs are preferred to the larger models when the selected/Showdown image is missing, including Garchomp
Z whose front model is larger than the existing image-cache limit. Selected 3D sets still try their own models first.

Sources supplied or verified on 17 October 2026:

- [CamiLovesO's Delphox-line sheet](https://www.deviantart.com/camiloveso/art/1276413751), provided by the user.
  The [author's publication](https://www.reddit.com/r/PokemonROMhacks/comments/1pq0dho/new_full_set_of_overworlds_sprites_for_the_entire/)
  permits use with credit. Credit: CamiLovesO.
- [Willøw's Mega overworld pack](https://eeveeexpo.com/resources/1475/) and its
  [Z-A update](https://eeveeexpo.com/resources/1475/updates). Credit: DarkusShadow, BluebirdDxD; Willøw for compilation/porting.
  Its Z-A update lists the nine included forms; it is not a complete animated catalog of all new Megas.

No art from these packs ships in the repository and no external simulator, plugin or executable is required.
