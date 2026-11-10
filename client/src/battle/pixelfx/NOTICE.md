# pixelfx (vendored)

`core/` and `fx/` are **pixelfx** by Patch (https://github.com/patch-gg/pixelfx), version 0.3.1, MIT License (see `LICENSE`,
Copyright (c) 2026 Patch and Hugo Duprez): the whole runtime and all 244 effects, files unchanged.

- `core/sim.js` and the effects that say so at the top of their file adapt Sprite Fusion's open-source pixel art VFX
  (https://www.spritefusion.com/pixel-art-vfx), Copyright (c) 2026 Hugo Duprez, MIT License.
- `core/act.js` adapts how Hollow Crown plays its skills (poses on 12 fps steps, hit-stops, the springy straw target), from
  https://github.com/rehan-remade/hollow-crown, Copyright (c) 2026 rehan-remade, MIT License.
- The font "Patch Pixel" of the upstream gallery is NOT included: it is Patch's own and not covered by the MIT license. Nothing here
  uses it (`core/font.js` is the library's own code-drawn pixel font).
- The upstream gallery app and authoring tools (`gallery/`, `tools/`, `skills/`) are not vendored.

`mapping.js`, `registry.js`, `layer.js`, `gate.js` and `preview.js` are Silver's own code: they map each move, status, weather and terrain to
these effects, play them on the real-time and turn-based battle canvases and in the effects explorer.
