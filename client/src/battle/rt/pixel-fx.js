/*! @license MIT
 * Copyright (c) 2026 Hugo Duprez
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
 * the Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions: The above copyright notice and this
 * permission notice shall be included in all copies or substantial portions of
 * the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
 * EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 * MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO
 * EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES
 * OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */
// Adapted from impact/slash/power-up by Hugo Duprez (2026), MIT.
// Full notice and exact source hashes: ./pixel-fx.LICENSE.txt.
// Presentation only. No simulation state, event, clock, timer or network is written.
const TAU = Math.PI * 2;
export const PIXEL_FX_LIMITS = Object.freeze({ contacts: 12, auras: 4, grid: 128, captureHz: 30 });
const clamp = n => Math.max(0, Math.min(1, n));
const expo = n => 1 - 2 ** (-10 * clamp(n));
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const rgba = (r, g, b, a = 255) => ((a & 255) << 24 | (b & 255) << 16 | (g & 255) << 8 | r & 255) >>> 0;
const hex = h => { const n = parseInt(h.slice(1), 16); return rgba(n >> 16 & 255, n >> 8 & 255, n & 255); };
const WHITE = hex('#fff5d9');
const colorOf = (c, a) => (c & 0xffffff | Math.round(255 * clamp(a)) << 24) >>> 0;
const unit = (b, s, u = 0) => b?.doubles ? b.sides[s]?.units?.[u] : b?.sides?.[s];
const tag = (s, u = 0) => `${s}:${u}`;
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { let t = s = (s + 0x6d2b79f5) >>> 0; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function dot(f, x, y, c, alpha = 1, light = false) {
  x = Math.floor(x); y = Math.floor(y);
  if (x < 0 || y < 0 || x >= f.w || y >= f.h || alpha <= 0) return;
  if (alpha < 1 && alpha <= (BAYER[(y & 3) * 4 + (x & 3)] + .5) / 16) return;
  (light ? f.light : f.color)[y * f.w + x] = light ? colorOf(c, .2 * alpha) : c;
}
function line(f, x, y, xx, yy, c, alpha = 1) {
  x = Math.round(x); y = Math.round(y); xx = Math.round(xx); yy = Math.round(yy);
  const dx = Math.abs(xx - x), dy = -Math.abs(yy - y), sx = x < xx ? 1 : -1, sy = y < yy ? 1 : -1;
  let err = dx + dy;
  for (let i = 0; i < 512; i++) {
    dot(f, x, y, c, alpha); if (x === xx && y === yy) break;
    const e = 2 * err; if (e >= dy) { err += dy; x += sx; } if (e <= dx) { err += dx; y += sy; }
  }
}
export function pixelFrame(w = 128, h = 128) {
  return { w, h, color: new Uint32Array(w * h), light: new Uint32Array(w * h) };
}
/** Chamfer distance from the real alpha matte, including holes; no geometric stand-in. */
export function silhouetteDistance(alpha, w, h) {
  const d = new Uint16Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = alpha[i] ? 0 : 1024;
  const relax = (i, j, cost) => { d[i] = Math.min(d[i], d[j] + cost); };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (x) relax(i, i - 1, 3);
    if (y) { relax(i, i - w, 3); if (x) relax(i, i - w - 1, 4); if (x + 1 < w) relax(i, i - w + 1, 4); }
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x;
    if (x + 1 < w) relax(i, i + 1, 3);
    if (y + 1 < h) { relax(i, i + w, 3); if (x + 1 < w) relax(i, i + w + 1, 4); if (x) relax(i, i + w - 1, 4); }
  }
  return d;
}
/** Camera-relative affine matrix; actor body acting/upright portrait transforms remain. */
export function relativeMatrix(base, m) {
  const det = base.a * base.d - base.b * base.c;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-9) return null;
  const a = base.d / det, b = -base.b / det, c = -base.c / det, d = base.a / det;
  return [a * m.a + c * m.b, b * m.a + d * m.b, a * m.c + c * m.d, b * m.c + d * m.d,
    a * (m.e - base.e) + c * (m.f - base.f), b * (m.e - base.e) + d * (m.f - base.f)];
}
const point = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** Pure raster step: drawing never advances age/RNG, including pause and repeated layers. */
export function paintContact(f, e, layer, { reduced = false, density = 1 } = {}) {
  if (layer !== 'front') return;
  const c = e.color, t = reduced ? .045 : e.age, fade = reduced ? clamp((e.life - e.age) / .1) : clamp(1 - e.age / e.life), cx = f.w / 2, cy = f.h / 2;
  const r = rng(e.seed), angle = e.angle, strong = e.strong ? 1.2 : 1;
  if (e.kind === 'cut' && !reduced) {
    // Tapered elliptical arc, exponential head and later receding tail, from slash.ts.
    const head = expo(t / .075), tail = clamp((t - .11) / .2), start = -2.55, span = 3.5;
    for (let j = 0; j < 2; j++) {
      const radius = (j ? 16 : 21) * strong;
      for (let u = tail; u <= head; u += .012) {
        const a = start + span * u, x = Math.cos(a) * radius, y = Math.sin(a) * radius * .6;
        const co = Math.cos(angle - .38), sn = Math.sin(angle - .38), width = (j ? 1.7 : 3.2) * Math.sin(Math.PI * clamp((u - tail) / Math.max(.01, head - tail)));
        for (let o = 0; o < width; o += .5) dot(f, cx + x * co - y * sn - Math.cos(a) * o, cy + x * sn + y * co - Math.sin(a) * o, o < .75 ? WHITE : c, fade);
      }
    }
  } else if (t < .075 || reduced) {
    for (let j = 0; j < 8; j++) {
      const a = angle + j * TAU / 8 + (r() - .5) * .2;
      const length = (5 + r() * 4) * strong * (e.directional ? 1 + 1.4 * Math.max(0, Math.cos(a - angle)) ** 3 : 1);
      for (let d = 0; d < length; d += .5) {
        const width = Math.max(.4, (1 - d / length) * (t < .034 ? 2.2 : 1.25));
        for (let o = -width; o <= width; o += .5) dot(f, cx + Math.cos(a) * d - Math.sin(a) * o, cy + Math.sin(a) * d + Math.cos(a) * o, d < 2 ? WHITE : c, reduced ? .7 * fade : fade);
      }
    }
  }
  if (reduced) return;
  const fragments = rng(e.seed ^ 0x517cc1b7);
  const count = Math.round(12 * density);
  for (let j = 0; j < count; j++) {
    const a = angle + (fragments() - .5) * (e.directional ? 1.5 : TAU), speed = 35 + 65 * fragments(), life = .18 + fragments() * .22;
    if (t > life) continue;
    const drag = (1 - Math.exp(-2.2 * t)) / 2.2, x = cx + Math.cos(a) * speed * drag, y = cy + Math.sin(a) * speed * drag + 35 * t * t;
    line(f, x - Math.cos(a) * 3, y - Math.sin(a) * 3, x, y, j % 3 ? c : WHITE, 1 - t / life);
    dot(f, x, y, c, (1 - t / life) * .8, true);
  }
}
export function paintAura(f, e, matte, layer, reduced = false) {
  if (!matte) return;
  const p = clamp(e.age / e.life), fade = Math.min(1, (1 - p) * 4), dist = matte.dist;
  for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
    const i = y * f.w + x, d = dist[i] / 3;
    if (!d || d > (layer === 'back' ? 5 : 1.4)) continue;
    if (layer === 'front' && (x + y) % 4 !== 0) continue;
    const reach = reduced ? 1.6 : 2.4 + 1.8 * Math.sin(x * .19 + y * .1 - e.age * 8);
    if (d > reach) continue;
    dot(f, x, y, d < 1.1 ? WHITE : e.color, (layer === 'front' ? .35 : .7) * fade * (1 - d / 6));
  }
}

export class PixelEffects {
  constructor(renderer, canvasFactory = () => typeof document === 'undefined' ? null : document.createElement('canvas')) {
    this.r = renderer; this.factory = canvasFactory; this.contacts = []; this.auras = []; this.releases = [];
    this.mattes = new Map(); this.captureAttempts = new Map(); this.time = 0; this.base = null; this.disposed = false;
  }
  onEvent(e, battle, color = '#f3cd69') {
    if (this.disposed) return;
    const u = e.u || 0, who = unit(battle, e.s, u); if (!who) return;
    const id = tag(e.s, u), slot = who.active;
    if (['switch', 'recall', 'faint'].includes(e.k)) {
      this.auras = this.auras.filter(a => a.id !== id); this.mattes.delete(id); this.captureAttempts.delete(id);
      this.releases = this.releases.filter(a => a.id !== id); return;
    }
    if (e.k === 'use') {
      this.releases.push({ id, s: e.s, u, slot, x: who.x, y: who.y, move: e.move, at: this.time });
      this.releases = this.releases.slice(-12);
    } else if (e.k === 'hit' && e.dmg > 0 && (e.hit === 0 || e.hit === undefined)) {
      const matches = this.releases.filter(a => a.s === e.from && a.move === e.move && this.time - a.at < 6);
      const owners = new Map(matches.map(a => [`${a.id}:${a.slot}`, a]));
      const source = owners.size === 1 ? owners.values().next().value : null;
      const angle = source ? Math.atan2(who.y - source.y, who.x - source.x) : 0;
      this.contacts.push({ kind: /slash|claw|cut|blade|scratch|scissor/.test(e.move || '') ? 'cut' : 'hit',
        x: who.x, y: who.y, age: 0, life: .44, angle, directional: !!source,
        color: hex(color), seed: ((e.t || 0) * 41 + e.s * 17 + u * 7 + slot) >>> 0, strong: !!e.crit || e.eff > 1 });
      this.contacts = this.contacts.slice(-PIXEL_FX_LIMITS.contacts); return true;
    } else if ((e.k === 'boost' && !e.same) || ['mega', 'dynamax', 'ultra'].includes(e.k)) {
      this.auras = this.auras.filter(a => a.id !== id);
      this.auras.push({ id, s: e.s, u, slot, age: 0, life: e.k === 'boost' ? .7 : .9,
        color: hex(e.k === 'boost' ? e.stage > 0 ? '#ffb15c' : '#7fb2ff' : e.k === 'ultra' ? '#ffe58c' : '#ff80b3') });
      this.auras = this.auras.slice(-PIXEL_FX_LIMITS.auras);
      this.mattes.delete(id); this.captureAttempts.delete(id);
      for (const key of this.mattes.keys()) if (!this.auras.some(a => a.id === key)) this.mattes.delete(key);
    }
    return false;
  }
  update(dt, view) {
    this.view = view;
    if (!(dt > 0) || !Number.isFinite(dt) || this.disposed) return;
    this.time += dt;
    this.contacts = this.contacts.filter(e => (e.age += dt) < e.life);
    this.auras = this.auras.filter(e => (e.age += dt) < e.life && this.actor(e)?.active === e.slot && !this.actor(e)?.mons?.[e.slot]?.fainted);
    this.releases = this.releases.filter(e => this.time - e.at < 6);
    for (const id of this.mattes.keys()) if (!this.auras.some(e => e.id === id)) this.mattes.delete(id);
    for (const id of this.captureAttempts.keys()) if (!this.auras.some(e => e.id === id)) this.captureAttempts.delete(id);
    if (!this.contacts.length && !this.auras.length) this.releaseBuffers();
  }
  actor(e) {
    const s = this.view?.sides?.[e.s], u = this.view?.doubles ? s?.units?.[e.u] : s;
    return u ? { ...u, mons: s.mons } : null;
  }
  begin(ctx) { this.base = ctx.getTransform?.() || null; }
  ensureBuffers() {
    if (this.frame) return true;
    const canvas = this.factory(); if (!canvas) return false;
    canvas.width = canvas.height = PIXEL_FX_LIMITS.grid;
    this.surface = canvas; this.surfaceCtx = canvas.getContext('2d');
    if (!this.surfaceCtx) { this.releaseBuffers(); return false; }
    this.frame = pixelFrame(); this.image = this.surfaceCtx.createImageData(128, 128); return true;
  }
  /** Called around the exact live draw, after its single animation update. No synthetic fallback. */
  captureActor(s, u, slot, ctx, bounds, draw) {
    const id = tag(s, u), aura = this.auras.find(a => a.id === id && a.slot === slot);
    if (!aura || !this.base || !ctx.getTransform || this.disposed) return;
    const old = this.mattes.get(id), attempted = this.captureAttempts.get(id);
    if (old?.unavailable || attempted !== undefined && this.time - attempted < 1 / PIXEL_FX_LIMITS.captureHz) return;
    this.captureAttempts.set(id, this.time);
    const m = relativeMatrix(this.base, ctx.getTransform()); if (!m) return;
    const corners = [[bounds.x, bounds.y], [bounds.x + bounds.w, bounds.y], [bounds.x, bounds.y + bounds.h], [bounds.x + bounds.w, bounds.y + bounds.h]].map(([x,y]) => point(m,x,y));
    const minX = Math.min(...corners.map(p => p[0])), maxX = Math.max(...corners.map(p => p[0])), minY = Math.min(...corners.map(p => p[1])), maxY = Math.max(...corners.map(p => p[1]));
    const extent = Math.max(maxX - minX, maxY - minY) * 1.4 + this.r.scale * .6, q = extent / 128;
    if (!(q > 0) || !Number.isFinite(q)) return;
    const x = (minX + maxX - extent) / 2, y = (minY + maxY - extent) / 2;
    this.captureCanvas ||= this.factory(); if (!this.captureCanvas) return;
    this.captureCanvas.width = this.captureCanvas.height = 128;
    const c = this.captureCanvas.getContext('2d', { willReadFrequently: true }); if (!c) return;
    c.setTransform(1 / q, 0, 0, 1 / q, -x / q, -y / q); c.transform(...m); c.imageSmoothingEnabled = false;
    try {
      draw(c);
      const data = c.getImageData(0, 0, 128, 128).data, alpha = new Uint8Array(128 * 128);
      for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3];
      if (!alpha.some(a => a)) { this.mattes.delete(id); return; }
      // Bad/unready source bounds must not become a rectangular clipped aura.
      if (alpha.some((a,i) => a && (i < 128 || i >= 127 * 128 || i % 128 === 0 || i % 128 === 127))) { this.mattes.delete(id); return; }
      const actor = this.actor(aura);
      this.mattes.set(id, { alpha, dist: silhouetteDistance(alpha, 128, 128), x, y, q, at: this.time,
        px: this.r.px(actor?.x || 0), py: this.r.py(actor?.y || 0) });
    } catch {
      // Cross-origin/unavailable art degrades to the existing Vfx, never an invented outline.
      this.captureCanvas.width = 0; this.mattes.set(id, { unavailable: true });
    }
  }
  paint(ctx, e, layer, matte, style, reduced) {
    if (!this.ensureBuffers()) return;
    const f = this.frame; f.color.fill(0); f.light.fill(0);
    if (matte) paintAura(f, e, matte, layer, reduced);
    else paintContact(f, e, layer, { reduced, density: style === 'pixel' ? 1 : .5 });
    const q = matte?.q || this.r.scale / 24;
    const actor = matte && this.actor(e), dx = actor ? this.r.px(actor.x) - matte.px : 0, dy = actor ? this.r.py(actor.y) - matte.py : 0;
    const x = matte ? matte.x + dx : this.r.px(e.x) + (this.r.portrait ? .7 * this.r.scale : 0) - 64 * q;
    const y = matte ? matte.y + dy : this.r.py(e.y) - (this.r.portrait ? 0 : .7 * this.r.scale) - 64 * q;
    ctx.save(); ctx.imageSmoothingEnabled = false;
    for (const [buffer, composite] of [[f.color, 'source-over'], [f.light, 'lighter']]) {
      // Explicit channels avoid relying on platform Uint32 endianness for ImageData.
      for (let i = 0; i < buffer.length; i++) { const c = buffer[i]; for (let k = 0; k < 4; k++) this.image.data[i * 4 + k] = c >>> (k * 8) & 255; }
      this.surfaceCtx.putImageData(this.image, 0, 0); ctx.globalCompositeOperation = composite;
      ctx.drawImage(this.surface, x, y, 128 * q, 128 * q);
    }
    ctx.restore();
  }
  draw(ctx, layer, style, reduced = false) {
    if (this.disposed || style === 'plain') return;
    for (const e of this.auras) { const m = this.mattes.get(e.id); if (m && !m.unavailable) this.paint(ctx, e, layer, m, style, reduced); }
    if (layer === 'front') for (const e of this.contacts) this.paint(ctx, e, layer, null, style, reduced);
  }
  releaseBuffers() {
    for (const canvas of [this.surface, this.captureCanvas]) if (canvas) canvas.width = canvas.height = 0;
    this.surface = this.surfaceCtx = this.captureCanvas = this.frame = this.image = null;
  }
  dispose() { this.contacts = []; this.auras = []; this.releases = []; this.mattes.clear(); this.captureAttempts.clear(); this.base = null; this.releaseBuffers(); this.disposed = true; }
}
