// Drawing helpers for the HUD of the five events: text with outline, panels, the clock, team cards, floating numbers and bursts.
// Plain canvas 2D, no state beyond what the caller keeps; every function tolerates missing images.
import { clamp, inkOn, parseColor, rgba, shade, safe } from "./util.js";

export const FONT = '"Trebuchet MS","Segoe UI",system-ui,-apple-system,sans-serif';

/** text(g, "hola", x, y, {size, weight, color, align, base, stroke, strokeW, alpha, maxW}) */
export function text(g, s, x, y, o = {}) {
  const size = o.size || 16;
  g.font = `${o.weight || 700} ${size}px ${FONT}`;
  g.textAlign = o.align || "left";
  g.textBaseline = o.base || "alphabetic";
  let str = String(s);
  if (o.maxW) {
    while (str.length > 1 && g.measureText(str).width > o.maxW) str = str.slice(0, -2) + "…";
  }
  if (o.alpha != null) g.globalAlpha *= o.alpha;
  if (o.stroke) {
    g.lineJoin = "round";
    g.lineWidth = o.strokeW || Math.max(2, size / 6);
    g.strokeStyle = o.stroke;
    g.strokeText(str, x, y);
  }
  g.fillStyle = o.color || "#ffffff";
  g.fillText(str, x, y);
  if (o.alpha != null) g.globalAlpha /= o.alpha || 1;
}

export function rrect(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

export function panel(g, x, y, w, h, o = {}) {
  rrect(g, x, y, w, h, o.r ?? 12);
  g.fillStyle = o.fill || "rgba(14,16,38,0.82)";
  g.fill();
  if (o.stroke) { g.lineWidth = o.lineW || 2; g.strokeStyle = o.stroke; g.stroke(); }
}

export function ellipse(g, x, y, rx, ry, fill, alpha = 1) {
  g.save();
  g.globalAlpha *= alpha;
  g.beginPath();
  g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  g.fillStyle = fill;
  g.fill();
  g.restore();
}

export function formatClock(seconds) {
  const s = Math.max(0, Math.ceil(seconds - 1e-9));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The clock pill: m:ss, red and pulsing in the last ten seconds, with a thin bar of the time that is left. */
export function clock(g, cx, y, secondsLeft, totalSeconds, time = 0) {
  const urgent = secondsLeft <= 10;
  const w = 150, h = 46;
  panel(g, cx - w / 2, y, w, h, { r: 23, fill: urgent ? "rgba(120,16,40,0.92)" : "rgba(14,16,38,0.88)", stroke: urgent ? "#ff6b86" : "#8f9be8", lineW: 2.5 });
  const pulse = urgent ? 1 + 0.06 * Math.sin(time * 12) : 1;
  g.save();
  g.translate(cx, y + h / 2 + 1);
  g.scale(pulse, pulse);
  text(g, formatClock(secondsLeft), 0, 0, { size: 32, weight: 900, color: "#ffffff", align: "center", base: "middle", stroke: "rgba(0,0,0,0.5)", strokeW: 4 });
  g.restore();
  const k = clamp(secondsLeft / Math.max(1, totalSeconds), 0, 1);
  rrect(g, cx - w / 2 + 16, y + h - 7, w - 32, 4, 2);
  g.fillStyle = "rgba(255,255,255,0.18)";
  g.fill();
  rrect(g, cx - w / 2 + 16, y + h - 7, (w - 32) * k, 4, 2);
  g.fillStyle = urgent ? "#ff9ab0" : "#9fd2ff";
  g.fill();
}

function icon(g, img, x, y, s) {
  try {
    if (img && (img.complete === undefined || img.complete) && (img.naturalWidth || img.width)) {
      g.drawImage(img, x, y, s, s);
      return true;
    }
  } catch { /* a broken image just means the fallback */ }
  return false;
}

/**
 * A team card for the side columns.
 * d = { score, scoreLabel, you, flash (0..1), mons: [{ label, bar (0..1|null), barColor, tag, dim, active, big }] }
 */
export function teamCard(g, ctx, i, x, y, w, h, d = {}) {
  const team = ctx.teams[i] || {};
  const color = team.color || "#888";
  const you = !!d.you;
  panel(g, x, y, w, h, { r: 14, fill: "rgba(13,15,36,0.84)", stroke: color, lineW: you ? 4 : 2 });
  // header
  g.save();
  rrect(g, x, y, w, 26, 14);
  g.clip();
  g.fillStyle = color;
  g.fillRect(x, y, w, 26);
  g.fillStyle = "rgba(255,255,255,0.18)";
  g.fillRect(x, y, w, 10);
  g.restore();
  const ink = inkOn(color);
  text(g, team.name || `Equipo ${i + 1}`, x + 9, y + 18, { size: 14, weight: 800, color: ink, maxW: w - (you ? 52 : 18) });
  if (you) {
    const tag = ctx.t ? ctx.t("TÚ", "YOU") : "TÚ";
    panel(g, x + w - 40, y + 5, 33, 16, { r: 8, fill: "rgba(0,0,0,0.38)" });
    text(g, tag, x + w - 23.5, y + 17, { size: 11, weight: 900, color: "#fff", align: "center" });
  }
  // score
  const pop = d.flash ? 1 + 0.22 * d.flash : 1;
  g.save();
  g.translate(x + w / 2, y + 58);
  g.scale(pop, pop);
  text(g, d.score ?? 0, 0, 0, { size: 38, weight: 900, color: d.flash ? "#ffe45c" : "#ffffff", align: "center", base: "middle", stroke: "rgba(0,0,0,0.55)", strokeW: 6 });
  g.restore();
  if (d.scoreLabel) text(g, d.scoreLabel, x + w / 2, y + 80, { size: 11, weight: 700, color: "#aab3ee", align: "center" });
  // members
  const rows = d.mons || [];
  const top = y + 88;
  const rh = Math.min(34, (h - 94) / Math.max(1, rows.length));
  rows.forEach((m, k) => {
    const ry = top + k * rh;
    const mon = team.mons?.[k] || {};
    g.save();
    if (m.dim) g.globalAlpha = 0.45;
    if (m.active) {
      rrect(g, x + 4, ry - 1, w - 8, rh - 2, 8);
      g.fillStyle = rgba(color, 0.32);
      g.fill();
      g.lineWidth = 1.5; g.strokeStyle = shade(color, 0.35); g.stroke();
    }
    const s = Math.min(26, rh - 4);
    const img = safe(ctx.icon, i, k);
    if (!icon(g, img, x + 8, ry + 1, s)) {
      g.beginPath(); g.arc(x + 8 + s / 2, ry + 1 + s / 2, s / 2, 0, Math.PI * 2);
      g.fillStyle = shade(color, -0.25); g.fill();
      text(g, String((mon.name || "?")[0] || "?").toUpperCase(), x + 8 + s / 2, ry + 1 + s / 2 + 1, { size: 13, color: "#fff", align: "center", base: "middle" });
    }
    text(g, m.label ?? mon.name ?? "", x + 12 + s, ry + 12, { size: 12, weight: 700, color: "#e6e9ff", maxW: w - s - 22 - (m.tag ? 26 : 0) });
    if (m.tag) text(g, m.tag, x + w - 8, ry + 12, { size: 11, weight: 800, color: m.tagColor || "#ffd166", align: "right" });
    if (m.bar != null) {
      const bx = x + 12 + s, bw = w - s - 22, by = ry + 17;
      rrect(g, bx, by, bw, 5, 2.5); g.fillStyle = "rgba(255,255,255,0.16)"; g.fill();
      rrect(g, bx, by, Math.max(0, bw * clamp(m.bar, 0, 1)), 5, 2.5); g.fillStyle = m.barColor || "#7be08b"; g.fill();
    }
    g.restore();
  });
}

/** Floating numbers and short labels ("+3", "¡Gol!"): they rise and fade. Deterministic (no randomness). */
export class Pops {
  constructor() { this.list = []; }
  add(x, y, str, color = "#fff", o = {}) {
    this.list.push({ x, y, str, color, size: o.size || 22, life: 0, max: o.max || 0.9, vy: o.vy ?? -46, stroke: o.stroke || "rgba(0,0,0,0.65)" });
    if (this.list.length > 40) this.list.shift();
  }
  update(dt) {
    for (const p of this.list) { p.life += dt; p.y += p.vy * dt; p.vy *= 0.96; }
    this.list = this.list.filter((p) => p.life < p.max);
  }
  draw(g) {
    for (const p of this.list) {
      const k = p.life / p.max;
      const a = k < 0.15 ? k / 0.15 : k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
      const s = k < 0.15 ? 0.6 + 0.4 * (k / 0.15) : 1;
      g.save();
      g.globalAlpha = clamp(a, 0, 1);
      g.translate(p.x, p.y);
      g.scale(s, s);
      text(g, p.str, 0, 0, { size: p.size, weight: 900, color: p.color, align: "center", base: "middle", stroke: p.stroke, strokeW: 5 });
      g.restore();
    }
  }
}

/** A burst of dots (hits, catches, goals). The directions come from a counter, not from randomness. */
export class Sparks {
  constructor() { this.list = []; this.n = 0; }
  burst(x, y, color, count = 10, speed = 140, life = 0.5) {
    for (let i = 0; i < count; i++) {
      const a = ((i + (this.n++ % 7) * 0.37) / count) * Math.PI * 2;
      const v = speed * (0.55 + 0.45 * (((i * 7 + this.n) % 5) / 4));
      this.list.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: life * (0.7 + 0.3 * (i % 3) / 2), color, r: 2.5 + (i % 3) });
    }
    if (this.list.length > 160) this.list.splice(0, this.list.length - 160);
  }
  update(dt) {
    for (const p of this.list) { p.life += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.93; p.vy *= 0.93; }
    this.list = this.list.filter((p) => p.life < p.max);
  }
  draw(g) {
    for (const p of this.list) {
      g.globalAlpha = clamp(1 - p.life / p.max, 0, 1);
      g.fillStyle = p.color;
      g.beginPath(); g.arc(p.x, p.y, p.r, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
  }
}

/** The page background behind the field: deep gradient plus a faint grid, so the side panels do not float on black. */
export function backdrop(g, top = "#1b2250", bottom = "#0d1030") {
  const gr = g.createLinearGradient(0, 0, 0, 540);
  gr.addColorStop(0, top);
  gr.addColorStop(1, bottom);
  g.fillStyle = gr;
  g.fillRect(0, 0, 960, 540);
  g.strokeStyle = "rgba(255,255,255,0.035)";
  g.lineWidth = 1;
  for (let x = 0; x <= 960; x += 40) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 540); g.stroke(); }
  for (let y = 0; y <= 540; y += 40) { g.beginPath(); g.moveTo(0, y); g.lineTo(960, y); g.stroke(); }
}

/** A small key-cap, for the control hints. */
export function keycap(g, label, x, y, o = {}) {
  g.font = `800 12px ${FONT}`;
  const w = Math.max(20, g.measureText(label).width + 12);
  rrect(g, x, y, w, 20, 5);
  g.fillStyle = "rgba(255,255,255,0.14)"; g.fill();
  g.lineWidth = 1.2; g.strokeStyle = "rgba(255,255,255,0.4)"; g.stroke();
  text(g, label, x + w / 2, y + 10.5, { size: 12, weight: 800, color: o.color || "#fff", align: "center", base: "middle" });
  return w;
}

/** One line of hint text at the bottom of the screen. */
export function hint(g, str, cx = 480, y = 532) {
  text(g, str, cx, y, { size: 13, weight: 700, color: "rgba(214,220,255,0.82)", align: "center", stroke: "rgba(8,10,30,0.8)", strokeW: 4 });
}

/** Break a string into lines no wider than maxW (needs the font set first). */
export function wrap(g, str, maxW) {
  const words = String(str).split(/\s+/);
  const lines = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (cur && g.measureText(t).width > maxW) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

export const SIDE_W = 150;
export const CARD_H = 184;
/** x, y of the card of team i in the two side columns (teams 0, 1 left; 2, 3 right) */
export function cardPos(i) {
  return { x: i < 2 ? 6 : 960 - 6 - SIDE_W, y: 60 + (i % 2) * (CARD_H + 6) };
}

/**
 * The two side columns every event of this folder shares: the clock and the four team cards on the left and right of the field,
 * the event name and the controls on the right. st = { secondsLeft, total, time, title, cards: [d0..d3], you, hints: [str] }
 */
export function sidePanels(g, ctx, st) {
  clock(g, 6 + SIDE_W / 2, 6, st.secondsLeft, st.total, st.time || 0);
  panel(g, 960 - 6 - SIDE_W, 6, SIDE_W, 46, { r: 14, fill: "rgba(14,16,38,0.88)", stroke: "#8f9be8", lineW: 2 });
  text(g, st.title, 960 - 6 - SIDE_W / 2, 30, { size: 17, weight: 900, color: "#ffffff", align: "center", base: "middle", maxW: SIDE_W - 14 });
  for (let i = 0; i < 4; i++) {
    const p = cardPos(i);
    teamCard(g, ctx, i, p.x, p.y, SIDE_W, CARD_H, { ...(st.cards?.[i] || {}), you: st.you === i });
  }
  if (st.hints?.length) {
    g.font = `700 12px ${FONT}`;
    let y = 60 + 2 * (CARD_H + 6) + 4;
    for (const h of st.hints) {
      for (const line of wrap(g, h, SIDE_W - 4)) {
        text(g, line, 960 - 6 - SIDE_W / 2, y + 10, { size: 12, weight: 700, color: "rgba(214,220,255,0.86)", align: "center" });
        y += 14;
      }
    }
  }
}

export { parseColor };
