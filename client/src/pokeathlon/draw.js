// Drawing helpers the events share through ctx.ui: text with an outline, panels, bars, the scoreboard, the clock, Pokémon with a
// team-coloured ring (or a coloured disc while the sprite sheet is still loading). Plain canvas, no DOM: nothing here runs headless.

export const FONT = "'Trebuchet MS', 'Segoe UI', system-ui, sans-serif";

export function roundRectPath(g, x, y, w, h, r = 8) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}

export const hexA = (hex, a) => {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

export function shade(hex, f) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  const m = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${m((n >> 16) & 255)}, ${m((n >> 8) & 255)}, ${m(n & 255)})`;
}

export function makeUi(ctx) {
  const ui = {};

  /** Text with an optional dark outline. opts: size, color, align, base, weight, stroke (color), strokeW, alpha. */
  ui.text = (g, str, x, y, opts = {}) => {
    const { size = 20, color = "#fff", align = "left", base = "alphabetic", weight = 700, stroke = "rgba(8,12,22,.75)", strokeW = Math.max(2, size / 6), alpha = 1 } = opts;
    g.save();
    g.globalAlpha *= alpha;
    g.font = `${weight} ${size}px ${FONT}`;
    g.textAlign = align;
    g.textBaseline = base;
    g.lineJoin = "round";
    if (stroke) {
      g.lineWidth = strokeW;
      g.strokeStyle = stroke;
      g.strokeText(String(str), x, y);
    }
    g.fillStyle = color;
    g.fillText(String(str), x, y);
    g.restore();
  };

  ui.panel = (g, x, y, w, h, opts = {}) => {
    const { fill = "rgba(10,16,28,.66)", stroke = "rgba(255,255,255,.14)", r = 12, lw = 1.5 } = opts;
    roundRectPath(g, x, y, w, h, r);
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (stroke) { g.lineWidth = lw; g.strokeStyle = stroke; g.stroke(); }
  };

  ui.bar = (g, x, y, w, h, frac, color = "#5fd16a", bg = "rgba(0,0,0,.45)") => {
    const f = Math.max(0, Math.min(1, Number.isFinite(frac) ? frac : 0));
    roundRectPath(g, x, y, w, h, h / 2);
    g.fillStyle = bg;
    g.fill();
    if (f > 0) {
      const ww = Math.max(h, w * f);
      roundRectPath(g, x, y, ww, h, h / 2);
      g.fillStyle = color;
      g.fill();
    }
  };

  /** m:ss.t for a clock in seconds. */
  ui.fmtClock = (sec, tenths = false) => {
    const s = Math.max(0, sec);
    const m = Math.floor(s / 60);
    const r = s - m * 60;
    const whole = Math.floor(r);
    const t = Math.floor((r - whole) * 10);
    return `${m}:${String(whole).padStart(2, "0")}${tenths ? `.${t}` : ""}`;
  };

  ui.clock = (g, sec, x, y, opts = {}) => {
    const { size = 34, label = null, tenths = false, align = "center", warn = 10 } = opts;
    ui.panel(g, x - (align === "center" ? 70 : 0), y, 140, size + 18, { r: 14 });
    const cx = x + (align === "center" ? 0 : 70);
    ui.text(g, ui.fmtClock(sec, tenths), cx, y + size + 5, { size, align: "center", color: sec <= warn && sec > 0 ? "#ffd166" : "#fff" });
    if (label) ui.text(g, label, cx, y + 14, { size: 11, align: "center", color: "#a9b4c8", stroke: null, weight: 600 });
  };

  ui.icon = (g, team, slot, x, y, size = 40, opts = {}) => {
    const img = ctx.icon(team, slot);
    const t = ctx.teams[team];
    const col = t ? t.color : "#888";
    g.save();
    g.globalAlpha *= opts.alpha ?? 1;
    roundRectPath(g, x, y, size, size, size * 0.22);
    g.fillStyle = "rgba(255,255,255,.1)";
    g.fill();
    if (img && img.complete && img.naturalWidth > 0) {
      g.imageSmoothingEnabled = false;
      const k = Math.min(size / img.naturalWidth, size / img.naturalHeight);
      const w = img.naturalWidth * k;
      const h = img.naturalHeight * k;
      g.drawImage(img, x + (size - w) / 2, y + (size - h) / 2, w, h);
      g.imageSmoothingEnabled = true;
    } else {
      const nm = (t && t.mons[slot] && t.mons[slot].name) || "?";
      g.beginPath();
      g.arc(x + size / 2, y + size / 2, size * 0.36, 0, Math.PI * 2);
      g.fillStyle = col;
      g.fill();
      ui.text(g, nm.slice(0, 2), x + size / 2, y + size / 2 + size * 0.14, { size: size * 0.38, align: "center", stroke: null });
    }
    if (opts.ring) {
      roundRectPath(g, x, y, size, size, size * 0.22);
      g.lineWidth = opts.ringW || 3;
      g.strokeStyle = opts.ring === true ? col : opts.ring;
      g.stroke();
    }
    g.restore();
  };

  /**
   * One chip per team (colour, name, score) in a row. scores: array of 4 (numbers or strings); opts: x, y, w, h, active (team
   * highlighted), you (team index drawn with a marker), sub (array of 4 small texts under the name).
   */
  ui.scoreboard = (g, scores, opts = {}) => {
    const { x = 14, y = 10, w = W_DEFAULT - 28, h = 50, active = -1, sub = null } = opts;
    const gap = 8;
    const cw = (w - gap * 3) / 4;
    for (let i = 0; i < 4; i++) {
      const t = ctx.teams[i];
      if (!t) continue;
      const cx = x + i * (cw + gap);
      const isActive = i === active || t.human;
      ui.panel(g, cx, y, cw, h, { fill: hexA(t.color, isActive ? 0.34 : 0.2), stroke: hexA(t.color, isActive ? 0.95 : 0.5), lw: isActive ? 2.5 : 1.5, r: 12 });
      g.fillStyle = t.color;
      roundRectPath(g, cx + 6, y + 6, 8, h - 12, 4);
      g.fill();
      const nm = t.name.length > 16 ? `${t.name.slice(0, 15)}…` : t.name;
      ui.text(g, nm, cx + 22, y + 20, { size: 14, weight: 700, color: "#eef3ff", stroke: null });
      if (sub && sub[i]) ui.text(g, sub[i], cx + 22, y + h - 9, { size: 11, color: "#aeb9cc", stroke: null, weight: 600 });
      ui.text(g, scores[i] ?? 0, cx + cw - 12, y + h / 2 + 10, { size: 28, align: "right", color: "#fff" });
    }
  };

  /** A big centred banner (¡Fin!, +3…). */
  ui.banner = (g, title, sub = "", y = 220) => {
    g.save();
    g.fillStyle = "rgba(6,10,20,.62)";
    g.fillRect(0, y - 60, W_DEFAULT, sub ? 150 : 110);
    g.restore();
    ui.text(g, title, W_DEFAULT / 2, y + 22, { size: 72, align: "center", color: "#ffd166" });
    if (sub) ui.text(g, sub, W_DEFAULT / 2, y + 74, { size: 26, align: "center", color: "#e9eefc" });
  };

  /**
   * A team Pokémon with its feet at (x, y). opts: row (sheet direction 0-7, default 2 = right), k (pixels per sprite pixel),
   * alpha, flash, ring (draw the team ring under it, default true), shadow, r (fallback disc radius), label.
   */
  ui.mon = (g, team, slot, x, y, opts = {}) => {
    const { row = 2, k = 2, alpha = 1, flash = 0, ring = true, r = 18 * (k / 2), anim = null } = opts;
    const t = ctx.teams[team];
    const col = t ? t.color : "#999";
    if (opts.shadow !== false) {
      g.save();
      g.globalAlpha *= 0.35 * alpha;
      g.fillStyle = "#000";
      g.beginPath();
      g.ellipse(x, y, r * 1.0, r * 0.38, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
    if (ring) {
      g.save();
      g.globalAlpha *= alpha;
      g.lineWidth = 3;
      g.strokeStyle = col;
      g.beginPath();
      g.ellipse(x, y, r * 1.15, r * 0.5, 0, 0, Math.PI * 2);
      g.stroke();
      g.restore();
    }
    const a = anim || ctx.animator(team, slot);
    const ok = a.draw(g, x, y, row, k, { alpha, flash });
    if (!ok) {
      g.save();
      g.globalAlpha *= alpha;
      g.beginPath();
      g.arc(x, y - r * 0.9, r, 0, Math.PI * 2);
      g.fillStyle = col;
      g.fill();
      g.lineWidth = 3;
      g.strokeStyle = "rgba(255,255,255,.75)";
      g.stroke();
      const nm = (t && t.mons[slot] && t.mons[slot].name) || "?";
      ui.text(g, nm.slice(0, 2), x, y - r * 0.9 + r * 0.32, { size: r * 0.9, align: "center", stroke: null });
      g.restore();
    }
    return ok;
  };

  /** Small texts that float up and fade: list of {x, y, text, age, life?, size?, color?}; the event ages them in update(). */
  ui.pops = (g, list, opts = {}) => {
    const { life = 0.9, rise = 46, size = 24, color = "#fff" } = opts;
    for (const p of list) {
      const l = p.life || life;
      const f = Math.min(1, p.age / l);
      ui.text(g, p.text, p.x, p.y - rise * f, { size: p.size || size, align: "center", color: p.color || color, alpha: 1 - f * f });
    }
  };

  return ui;
}

const W_DEFAULT = 960;
