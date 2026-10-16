# Original arena textures and water animation

Created on 17 October 2026 with the built-in image generator for Luis's request. No reference images, creature artwork, logos, ROM data or third-party textures were supplied. Source PNGs and converted WebPs live beside this document. Forest and sand use ImageMagick WebP quality 85; the water sheet uses lossless WebP, preserving transparent alpha. `python scripts/build_rt_visual_textures.py` embeds these WebPs in `textures.gen.js` for the app and standalone HTML, and measures a separate bright-core anchor for each water cell. Four frames loop at 12 fps on the renderer clock, with a still frame under reduced motion. Plain particles retain the existing procedural projectiles.

Forest and sand are flat cosmetic floors. Their stable reflections depend on saved arena/team names and never alter collision, damage or the arena schema. The original procedural floors remain the decode/loading fallback. Existing illustrated floors are retained.

## Generation specifications

Forest: wide 28:17 orthographic, edge-to-edge moss/sage short grass, small soft ochre patches, tiny low white flowers at the outer border. Refined hand-painted pixel clusters and a restrained JRPG palette. Central 80% quiet, medium-value and low-contrast for small sprites and danger circles. Entire image flat and walkable; no perspective, standing objects, holes, water, strong shadows, characters, UI, court lines, logos or text. Source: `forest-source.png`.

Sand: wide 28:17 top-down flat pale warm ochre floor, fine wind ripples and sparse granular flecks. Restrained tan/gold pixel palette, diffuse light, quiet central 80%, richer ripples at the outer edge. No elevated dunes, rocks, plants, props, holes, water, characters, markings, UI or text. Source: `sand-source.png`.

Water: four equal cells in a 2x2 atlas on true transparent alpha. Compact blue/cyan water orb travelling right, tapered spray tail left, pearl highlights, teal shading and a luminous cyan-white core. Four subtly different loop frames, isolated cells with clear outer padding, no scene, shadow, grid, painted transparency, UI or text. Generated cells have different padding; measured anchors compensate without editing their pixels. Source: `water-source.png`.

## Code provenance and scope

Original renderer code, informed by the investigation of [Emerald Arena at e1502f9](https://github.com/GBurgardt/pokemon-emerald-arena/tree/e1502f9f7ed46d969880d73adbf5ab23ef7b2a56/game/overlay). No code or assets from that repository were copied. Its GBA conversion, global single-battle cinematics, destructible objects and reactive terrain are not incorporated. The existing SpriteCollab credits and licenses remain unchanged. No new Pokémon sheets are bundled. The shared battle engine still determines positions, action durations, hit timing and damage.
