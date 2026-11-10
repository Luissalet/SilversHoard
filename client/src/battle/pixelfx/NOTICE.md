# pixelfx (vendored)

`core/` and `fx/` are a subset of **pixelfx** by Patch (https://github.com/patch-gg/pixelfx), version 0.3.1, MIT License
(see `LICENSE`, Copyright (c) 2026 Patch and Hugo Duprez). Files are unchanged except `core/index.js`, which is Silver's own
reduced entry point (the acting rig, poses, chains and scenes are not vendored).

- `core/sim.js` and the effects that say so at the top of their file adapt Sprite Fusion's open-source pixel art VFX
  (https://www.spritefusion.com/pixel-art-vfx), Copyright (c) 2026 Hugo Duprez, MIT License.
- The font "Patch Pixel" of the upstream gallery is NOT included: it is not covered by the MIT license.
- Only the effects listed in `registry.js` are vendored; the upstream catalog has 244.

`mapping.js`, `registry.js`, `layer.js` and `index.js` are Silver's own code: they map each move to one of these effects and
play it on the real-time and turn-based battle canvases.
