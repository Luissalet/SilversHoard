// Plays pixelfx effects on small canvases for the effects explorer (pages/EfectosPixel.jsx): one animation loop for every preview on the
// page, the effect's own colours or a type's ramp, the stock character standing in for the Pokemon on effects that play on a body (as
// the upstream gallery does), one-shots replayed after a short pause. Loaded only by the explorer.
import { createFrame, clearFrame, createFx, composite, painterFor, drawActor, stockActor, actorAlphaOf, rgb } from "./core/index.js";
import { EFFECTS, EFFECT_IDS, effectInfo, CATEGORY_LIST, CATEGORY_ES } from "./registry.js";
import { ramp, typeRamp, TYPES, TYPE_COLORS } from "./mapping.js";

export { EFFECT_IDS, effectInfo, CATEGORY_LIST, CATEGORY_ES, TYPES, TYPE_COLORS };

const BG = rgb(22, 18, 30);
const players = new Set();
let raf = 0;
let last = 0;

function tick(now) {
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  for (const p of players) p.step(dt);
  raf = players.size ? requestAnimationFrame(tick) : 0;
}

/** The palette option for a preview: the effect's own colours (""), a type's ramp ("Fire") or a colour's ("#ff8800"). */
export function previewPalette(type, color) {
  if (color && /^#[0-9a-f]{6}$/i.test(color)) return ramp(color);
  if (type) return typeRamp(type);
  return undefined;
}

/** Plays effect `id` on `canvas` until the returned function is called. */
export function play(canvas, id, { type = "", color = "", seed, body = true } = {}) {
  const mod = EFFECTS[id];
  const info = effectInfo(id);
  if (!mod || !canvas) return () => {};
  const [w, h] = info.size, [ox, oy] = info.origin;
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(w, h);
  const frame = createFrame(w, h);
  const opts = { x: ox, y: oy, seed: seed ?? mod.meta?.options?.seed ?? 1 };
  const palette = previewPalette(type, color);
  if (palette) opts.palette = palette;
  let fx = createFx(mod, opts);
  let rest = 0;
  const actor = stockActor(2);
  const p = {
    step(dt) {
      if (rest > 0) {
        rest -= dt;
        if (rest > 0) return;
        fx = createFx(mod, opts);
      }
      fx.update(dt);
      clearFrame(frame);
      fx.draw(frame, "back");
      if (info.on_body && body) {
        const pt = painterFor(frame);
        pt.place(ox, oy, false, 0);
        drawActor(pt, actor, actorAlphaOf(mod, fx.t, fx.options));
      }
      fx.draw(frame, "front");
      composite(frame, img.data, BG);
      ctx.putImageData(img, 0, 0);
      if (fx.done()) rest = 0.6;
    },
  };
  players.add(p);
  if (!raf && typeof requestAnimationFrame !== "undefined") { last = performance.now(); raf = requestAnimationFrame(tick); }
  return () => { players.delete(p); };
}
