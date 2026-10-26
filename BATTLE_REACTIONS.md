# Real-time damage and defeat poses

A surviving Pokémon plays **Pain** after one positive hit removes strictly more
than 35% of its maximum HP. Exactly 35% uses ordinary Hurt. Multi-hit damage is
evaluated per hit; a smaller follow-up does not truncate an active Pain sequence.
Pain lasts 0.65 seconds of the renderer's playback clock. Damage, input, action
timing, RNG and replay rules are unchanged.

A knockout starts **HitGround** for 1.2 playback seconds, then holds a downed
pose. Published sequences that include getting up stop at their lowest visible
grounded frame per direction. The body remains at its defeat position, separately
from the incoming party member. A replacement or recall requests its red return
beam, after at least 2.4 playback seconds on the ground. A trainer waiting to
replace a defeated Pokémon keeps it down indefinitely; the final defeated body
also remains down on the result screen. Bodies draw above living artwork so a
larger replacement cannot completely conceal the downed Pokémon.

All 1,469 installed species/form identities in normal and shiny variants have
both animations: **2,938 variants**. The supplemental collection contains 531
authored Pain and 516 authored HitGround variants from the same pinned
SpriteCollab revision as the original library. Reviewed raster exports cover
2,425 normal/shiny variants; the supplement uses 2,407 additional Pain and 2,422
additional HitGround sequences, preserving published reactions where available.
All 2,938 installed variants have actual raster sequences for both actions;
none uses a runtime acting fallback in the installed roster. Imported walking sheets and static battle-art fallbacks also have
pain and a held prone pose; they never borrow another species' art. Artwork
keeps its proportions and palette.

`scripts/build_pmd_reactions.py --stage <art-staging-directory>` rebuilds
`presets/pmd/reactions.json` and its content-addressed supplemental pack. Published
sheet bytes, their original credits and SHA-256 provenance are retained. Original
library packs, roster, metadata, preview art and portraits are unchanged.
`PmdLibrary` merges the supplement for the existing sheet routes, portable bundle
and **pmd_library_status** UI/REST/MCP handler; `coverage.reactions` reports exact
authored/generated/acting counts. New raster sources, prompts, palette transfer,
frame geometry and normal/shiny visual acceptance live in `art/reactions/`.
Four-heading sheets declare their diagonal mapping; eight-heading sheets retain
all directions. The importer supports two or four distinct poses per action.
Shiny-only reviewed art can publish while the normal variant keeps its original
authored reactions. Separate variant records can share an exact species/form
target without replacing the other variant's approved exports.
Explicit palette recolors reuse authored poses without changing any pixel's alpha,
frame geometry, timing or held ground frame. Their source PNGs and palette maps
are pinned in the source record and reviewed for the target variant. Raichu and
Pikachu Libre shiny reuse their published normal reactions; Hoenn and Pop-Star
normal reuse their reviewed shiny poses with the inverse native palette.
`--require-raster` rejects an incomplete collection before writing a new pack.
The six final Pikachu forms use explicitly declared manual pixel composition:
five native caps on reviewed Hoenn reaction bodies, and Rock Star materials on
reviewed Pop-Star reaction bodies. All six shiny forms derive by recolor from
normal, with native accessory colours retained. Reused bodies and native entries
are recorded as derivations, not independently generated poses.

The ordinary real-time app, newly exported standalone pages and recorded MP4s
share this renderer. Existing HTML must be re-exported. Pause freezes poses and
return timing; replay speed scales them together. Reduced motion uses a stationary
downed pose while preserving damage feedback and return. A seek restores a
currently active fainted Pokémon already lying down; historical bodies whose
replacement has already entered are cleared by seek, rather than guessed at an
unknown historical position. Restart clears all defeat owners.

This change covers ordinary real-time singles and doubles. Classic and mass
battle rendering retain their existing behavior.

Verification: strict damage boundary, late image decode, independent body owners,
doubles, imported sheets, normal/shiny coverage, same-tick Mega/Ultra/Dynamax
reversion, pause/seek/reset, ordinary routes/portable pack indices and native MCP.
Session evidence is in `D:/LocalAI/research-inbox/silver-pain1502`.
