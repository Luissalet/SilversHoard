# Original ice projectile atlas

Generated on 17 October 2026 with the built-in `image_gen` tool, without reference
images or third-party art. `ice-source.png` is the unchanged selected output:
1254 × 1254 RGBA pixels, four 627 × 627 cells. `ice.webp` is a lossless encoding
with `exact=True`; rebuilding checks every decoded RGBA byte, including hidden
RGB beneath fully transparent pixels. Source and runtime hashes, visible alpha
bounds and measured bright-pixel anchors are in `manifest.json`.

Rebuild: `python scripts/build_rt_ice_art.py`. The app loads the WebP as a binary
Vite asset on first use. The standalone build embeds it as a data URL. The
generated JavaScript contains only four anchors, dimensions, frame rate and a
Vite-resolved URL, rather than another copy of the image bytes.

The existing renderer uses it for ice-shaped projectiles (including Ice Shard,
Icicle Spear and Frost Breath) and the head of Ice Beam. Other beam shapes,
Powder Snow, gems, fire, water and their procedural layers retain their existing
presentation. Plain particles and unavailable images keep the procedural ice
shape. Four frames follow the renderer clock at 12 fps; reduced motion holds
frame zero. Positions, collision radii, windups, damage and replay inputs are
unchanged. No destruction, reactive terrain, creature sprites or new rules.

The prompt requested 15% padding. The generated source has smaller side margins;
all four measured visible bounds remain strictly inside their cells, and no
pixels were cropped, rearranged or recoloured to adjust it. Separate anchors
compensate for the different generated vertical padding.

## Exact generation prompt

Use case: stylized-concept. Production game VFX sprite sheet, not a mockup. Create one original atlas on ACTUAL TRANSPARENT ALPHA, exactly 2 columns by 2 rows of four equal animation cells. Four successive looping frames of a compact faceted ICE LANCE flying to the RIGHT, for a top-down 2D pixel-art creature battle. The lance has a short horizontal diamond-shaped core with a sharp right-facing tip, translucent pale cyan and glacier-blue facets, small cream-white glints and a very short frost wake trailing LEFT. Clear polished pixel clusters, restrained JRPG pixel-art palette, readable at 32 to 48 pixels. The four frames show a subtle axial rotation / changing facet highlights, keeping the SAME apparent scale, same bright-core center and rightward direction in all four cells. This is a continuous flicker loop, not an expanding explosion. Each effect including frost motes is entirely inside its cell with at least 15% clear padding all sides. Keep all four effects visually separate, no grid lines. No creatures, no characters, no scene, no surface, no ground shadow, no rocks or terrain, no UI, no words, no labels, no numerals, no watermark, no checkerboard painted into pixels. Background and all unused space truly transparent. Square overall atlas layout; four equal square cells. Do not add any reference branding or existing character art.
