// Four-direction user sheets share PMD's animation clock, without inventing attack or hurt poses.
import {Animator, image} from './pmd.js';

const DIRECTIONS = [0, 2, 2, 3, 3, 3, 1, 0]; // PMD's eight directions -> down, left, right, up
const prepared = new Map();

function artwork(meta) {
  const src = image(meta.url);
  if (!src.ready) return null;
  const key = `${meta.url}|${meta.background || ''}`;
  if (!prepared.has(key)) {
    let art = src.img;
    if (meta.background) {
      art = document.createElement('canvas');
      art.width = src.img.width; art.height = src.img.height;
      const ctx = art.getContext('2d');
      ctx.drawImage(src.img, 0, 0);
      const pixels = ctx.getImageData(0, 0, art.width, art.height), bg = meta.background;
      for (let i = 0; i < pixels.data.length; i += 4) {
        if (bg.every((v, j) => pixels.data[i + j] === v)) pixels.data[i + 3] = 0;
      }
      ctx.putImageData(pixels, 0, 0);
    }
    const white = document.createElement('canvas');
    white.width = src.img.width; white.height = src.img.height;
    const ctx = white.getContext('2d');
    ctx.drawImage(art, 0, 0); ctx.globalCompositeOperation = 'source-in'; ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, white.width, white.height);
    prepared.set(key, {art, white});
  }
  return prepared.get(key);
}

export class OverworldAnimator extends Animator {
  constructor(meta) {
    const [, , w, h] = meta.frames[0][0];
    const geom = {w, h, r: 4, ax: w / 2, ay: h * .95};
    super({...meta, a: {Idle: {...geom, n: 1, d: [12]}, Walk: {...geom, n: 4, d: [8, 8, 8, 8]}}});
    image(meta.url);
  }

  draw(ctx, x, y, row, k, {alpha = 1, flash = 0} = {}) {
    const art = artwork(this.meta);
    if (!art) return false;
    const direction = this.meta.directions === 8 ? row : DIRECTIONS[row];
    const [sx, sy, w, h] = this.meta.frames[direction ?? 0][this.cur === 'Walk' ? this.frame : 0];
    const scale = k * 48 / w;
    const dest = [Math.round(x - w * .5 * scale), Math.round(y - h * .95 * scale), w * scale, h * scale];
    const before = ctx.globalAlpha;
    ctx.globalAlpha = before * alpha;
    ctx.drawImage(art.art, sx, sy, w, h, ...dest);
    if (flash > 0) {
      ctx.globalAlpha *= flash;
      ctx.drawImage(art.white, sx, sy, w, h, ...dest);
    }
    ctx.globalAlpha = before;
    return true;
  }

  height(k) { const [, , w, h] = this.meta.frames[0][0]; return h * .95 * k * 48 / w; }
}
