# Local Dragon and Poison motifs

Eleven additional animated materials use **117 selected frames** from the two supplied Pokémon Mystery Dungeon: Explorers of Time/Darkness Dragon and Poison sheets, ripped by **redblueyellow**. Both originals and all 179 inventoried source hashes remain unchanged. The preceding 763 sprite entries and 158 source records remain exactly intact; the resulting catalogue has 774 entries, 160 sources, 218 atlases and 2,777 atlas frames.

| Move | Material | Selected frames | Existing RT phase |
| --- | --- | ---: | --- |
| Dragon Dance | Converging rings | 12 | Preparation / self aura |
| Dragon Pulse | Purple pulse orbs | 10 | Beam / impact |
| Outrage | Rising flames | 10 | Dash contact / impact |
| Spacial Rend | Expanding rifts | 10 | Drop / impact |
| Acid | Bubbles | 4 | Cone / impact |
| Acid Armor | Green rings | 6 | Preparation / self aura |
| Gunk Shot | Growing orb and fragments | 24 | Projectile / impact |
| Poison Gas | Expanding cloud | 13 | Wave / impact |
| Poison Fang | Teeth | 3 | Contact / impact |
| Toxic | Rings and bubbles | 18 | Wave / impact |
| Toxic Spikes | Deployment particles | 7 | Field area |

These are inspected source motifs composed with Silver's existing public RT geometry and clock. They are not a reconstruction of the cartridge's emitter programs, timing or every animation on either sheet. In particular, only the first Dragon Pulse orb row is selected. The grey-backed Toxic Spikes map tile is not an animation frame and is excluded. No simulation rule, move availability, RNG, replay version, damage or saved record changes.

`scripts/build_dragon_poison_sprites.py <local folder>` verifies each input against the existing inventory and extends the current manifest without downloading anything. It records source rectangles, atlas offsets, the removed teal colour key and source bands. It rejects empty/clipped frames. Transparent square cells retain aspect ratio in the shared renderer; Outrage retains a common ground anchor, and Gunk Shot's second source row returns to the same cell anchor. All original non-background pixels, including enclosed white highlights, survive exactly.

Reduced motion uses each new material's most visible stationary source frame rather than its tiny first particle; older materials keep frame zero. Normal animation, pause, speed changes and seek use the existing renderer clock and queues. The same material layer serves ordinary RT, mass battles, recordings and standalone HTML. The bundled PNGs need neither the original sheets nor Internet at runtime.

`leisure_catalog(section="effects")` exposes unchanged move IDs and phases with the new sprite IDs. `section="sprites", query="fx-pmd-td-", limit=0` returns all eleven descriptors, including source URLs, credit references, rectangles, offsets, colour key, source band and stationary frame. UI, REST and MCP use this same read-only catalogue.
