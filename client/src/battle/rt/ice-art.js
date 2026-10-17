import {ICE_ATLAS} from './art/ice/ice.gen.js';

let sheet = null;

// The bright pixels stay on the projectile's position despite different generated frame padding.
export function drawIceSprite(ctx, x, y, angle, size, time, reduced = false) {
  if (typeof Image === 'undefined') return false;
  if (!sheet) { sheet = new Image(); sheet.src = ICE_ATLAS.url; }
  if (!sheet.complete || !sheet.naturalWidth) return false;
  const frame = reduced ? 0 : Math.floor(Math.max(0, time) * ICE_ATLAS.fps) % 4;
  const {w, h, anchors} = ICE_ATLAS, height = size * h / w;
  const [ax, ay] = anchors[frame];
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sheet, frame % 2 * w, Math.floor(frame / 2) * h, w, h, -ax * size, -ay * height, size, height);
  ctx.restore();
  return true;
}
