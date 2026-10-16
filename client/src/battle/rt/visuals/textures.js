import {image} from '../pmd.js';
import {TEXTURES, WATER_CELLS} from './textures.gen.js';

export const FLOOR_TEXTURES = {grass: TEXTURES.forest, sand: TEXTURES.sand};

// Variation is visual only and stable for the arena/team names stored in a replay.
export function floorVariant(view) {
  const name = `${view.floor || 'grass'}:${view.arena_name || ''}:${(view.sides || []).map(s => s.name).join('|')}`;
  let hash = 2166136261;
  for (const c of name) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  return hash >>> 0 & 3;
}

export function drawWaterTextures(ctx, renderer, view, reduced = false) {
  if (!view.projectiles?.some(p => p.type === 'Water')) return;
  const sheet = image(TEXTURES.water);
  if (!sheet.ready) return;
  const frame = reduced ? 0 : Math.floor(renderer.time * 12) % 4;
  const [ax, ay] = WATER_CELLS.anchors[frame];
  const {w, h} = WATER_CELLS;
  for (const p of view.projectiles) {
    if (p.type !== 'Water') continue;
    const width = Math.max(1, p.r * 3.8) * renderer.scale, k = width / w;
    ctx.save();
    ctx.translate(renderer.px(p.x), renderer.py(p.y - .6));
    ctx.rotate(Math.atan2(p.vy, p.vx));
    ctx.drawImage(sheet.img, (frame % 2) * w, Math.floor(frame / 2) * h, w, h, -ax * k, -ay * k, width, h * k);
    ctx.restore();
  }
}
