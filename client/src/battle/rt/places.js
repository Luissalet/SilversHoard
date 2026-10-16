// Places from the games for real-time arenas: a foggy graveyard mountain, a snowy summit, a meteor cave, a champion's room and a
// castle hall. Each is a floor of the arena designer with its own ground, the decor around the court (drawn once with the court)
// and an ambience over it every frame (drifting fog, falling snow, light from above, the glow of an emblem). The rules of the battle
// are the same on every floor. Each place also has its own audience: Pokémon that live there, watching from the edges.

const TAU = Math.PI * 2;
const A = { w: 28, h: 17 };

// floor -> ground colours, speckle and the decor/ambience to draw
export const PLACE_FLOORS = {
  pyre: { out: "#1f2a29", a: "#b8d0cb", b: "#b0c8c3", speck: "rgba(50,70,70,0.10)", detail: "pyre", ambient: "fog" },
  summit: { out: "#27313c", a: "#e8f0f5", b: "#dfe8ee", speck: "rgba(110,140,165,0.20)", detail: "summit", ambient: "snow" },
  meteor: { out: "#1b1726", a: "#6d6283", b: "#665b7c", speck: "rgba(255,255,255,0.05)", detail: "meteor", ambient: "shafts" },
  champion: { out: "#162433", a: "#3f7f86", b: "#3a777e", speck: "rgba(255,255,255,0.04)", detail: "champion", ambient: "emblem" },
  castle: { out: "#123333", a: "#ddd6c1", b: "#d5ceb8", speck: "rgba(90,70,30,0.06)", detail: "castle", ambient: "" },
};

// who watches from the edges, by floor (national Pokédex numbers)
export const CROWDS = {
  grass: [16, 19, 43, 399, 25, 161, 263],
  sand: [27, 328, 331, 449, 551, 104],
  ice: [361, 220, 215, 225, 613, 87],
  cave: [41, 74, 527, 95, 524, 302],
  indoor: [25, 133, 52, 39, 175, 509, 300],
  water: [54, 183, 278, 418, 60, 7],
  pyre: [355, 353, 92, 200, 607, 302, 562],
  summit: [361, 220, 215, 225, 613, 459],
  meteor: [337, 338, 371, 41, 374, 74],
  champion: [25, 133, 175, 39, 35, 440, 113],
  castle: [570, 509, 554, 561, 551, 529],
};

/** Places the audience stands: two columns beside each trainer and a row along the bottom edge (meters, facing the court). */
export function crowdSpots() {
  const spots = [];
  for (const [x, fx] of [[-1.35, 1], [A.w + 1.35, -1]]) for (const y of [1.9, 4.2, 12.8, 15.1]) spots.push({ x, y, fx, fy: 0 });
  for (const x of [3.5, 8.5, 19.5, 24.5]) spots.push({ x, y: A.h + 0.62, fx: 0, fy: -1 });
  return spots;
}

function rng(seed) {
  let s = seed || 1;
  return () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
}

/** The decor of a place, drawn once on the court's own canvas (x is its 2D context, r the renderer for px/py/scale). */
export function drawPlace(x, r, floor, textured = false) {
  const p = PLACE_FLOORS[floor];
  if (!p) return;
  const s = r.scale;
  const rnd = rng(31 + floor.length * 7);
  const margins = () => {
    // points around the court, outside the lines and away from the trainers' boxes
    const out = [];
    for (let i = 0; i < 60; i++) {
      const side = Math.floor(rnd() * 4);
      let px, py;
      if (side === 0) { px = rnd() * A.w; py = -0.45 - rnd() * 0.3; } else if (side === 1) { px = rnd() * A.w; py = A.h + 0.3 + rnd() * 0.4; } else {
        px = side === 2 ? -0.5 - rnd() * 1.8 : A.w + 0.5 + rnd() * 1.8; py = rnd() * A.h;
        if (py > A.h / 2 - 2.6 && py < A.h / 2 + 2.6) continue;
      }
      out.push({ x: px, y: py });
    }
    return out;
  };
  x.save();
  if (p.detail === "pyre") {
    // gravestones and crosses around the court, mist pooled on the ground
    for (const m of margins().slice(0, 34)) {
      const gx = r.px(m.x), gy = r.py(m.y), w = (0.38 + rnd() * 0.2) * s, h = (0.5 + rnd() * 0.3) * s;
      x.fillStyle = "rgba(0,0,0,0.25)";
      x.beginPath(); x.ellipse(gx, gy, w * 0.7, w * 0.25, 0, 0, TAU); x.fill();
      if (rnd() < 0.75) {
        x.fillStyle = "#8d9795"; x.strokeStyle = "#4e5654"; x.lineWidth = Math.max(1, s * 0.04);
        x.beginPath(); x.moveTo(gx - w / 2, gy); x.lineTo(gx - w / 2, gy - h + w / 2); x.arc(gx, gy - h + w / 2, w / 2, Math.PI, 0); x.lineTo(gx + w / 2, gy); x.closePath(); x.fill(); x.stroke();
        x.fillStyle = "rgba(80,140,90,0.55)"; x.fillRect(gx - w / 2, gy - h * 0.18, w, h * 0.18);
      } else {
        x.strokeStyle = "#6d7573"; x.lineWidth = Math.max(2, s * 0.09);
        x.beginPath(); x.moveTo(gx, gy); x.lineTo(gx, gy - h * 1.1); x.moveTo(gx - w * 0.45, gy - h * 0.75); x.lineTo(gx + w * 0.45, gy - h * 0.75); x.stroke();
      }
    }
    for (let i = 0; i < 14; i++) {
      const cx = r.px(rnd() * A.w), cy = r.py(rnd() * A.h), rr = (1.5 + rnd() * 2.5) * s;
      const g = x.createRadialGradient(cx, cy, 0, cx, cy, rr);
      g.addColorStop(0, "rgba(255,255,255,0.18)"); g.addColorStop(1, "rgba(255,255,255,0)");
      x.fillStyle = g; x.beginPath(); x.ellipse(cx, cy, rr, rr * 0.5, 0, 0, TAU); x.fill();
    }
  } else if (p.detail === "summit") {
    // snow banks and dark rocks around a snowfield; footprints of wind on the court
    for (const m of margins().slice(0, 40)) {
      const cx = r.px(m.x), cy = r.py(m.y), rr = (0.35 + rnd() * 0.45) * s;
      if (rnd() < 0.35) {
        x.fillStyle = "#5c6672"; x.beginPath(); x.ellipse(cx, cy - rr * 0.3, rr, rr * 0.7, 0, 0, TAU); x.fill();
        x.fillStyle = "#f4f8fb"; x.beginPath(); x.ellipse(cx, cy - rr * 0.75, rr * 0.8, rr * 0.3, 0, 0, TAU); x.fill();
      } else {
        x.fillStyle = "rgba(255,255,255,0.85)"; x.beginPath(); x.ellipse(cx, cy, rr * 1.4, rr * 0.55, 0, 0, TAU); x.fill();
        x.fillStyle = "rgba(160,190,215,0.35)"; x.beginPath(); x.ellipse(cx, cy + rr * 0.2, rr * 1.3, rr * 0.25, 0, 0, Math.PI); x.fill();
      }
    }
    if (!textured) {
      x.strokeStyle = "rgba(150,180,205,0.35)"; x.lineWidth = Math.max(1, s * 0.04);
      for (let i = 0; i < 40; i++) { const cx = r.px(rnd() * A.w), cy = r.py(rnd() * A.h), w = (0.6 + rnd() * 1.6) * s; x.beginPath(); x.ellipse(cx, cy, w, w * 0.12, 0, 0.2, Math.PI - 0.2); x.stroke(); }
    }
  } else if (p.detail === "meteor") {
    // puddles on the cave floor, stalagmites and glowing crystals around it
    for (let i = 0; i < 9; i++) {
      const cx = r.px(1.5 + rnd() * (A.w - 3)), cy = r.py(1 + rnd() * (A.h - 2)), w = (0.8 + rnd() * 1.6) * s;
      x.fillStyle = "rgba(90,140,220,0.35)"; x.beginPath(); x.ellipse(cx, cy, w, w * 0.4, 0, 0, TAU); x.fill();
      x.strokeStyle = "rgba(190,215,255,0.45)"; x.lineWidth = Math.max(1, s * 0.03); x.beginPath(); x.ellipse(cx - w * 0.15, cy - w * 0.08, w * 0.6, w * 0.18, 0, Math.PI * 1.1, Math.PI * 1.8); x.stroke();
    }
    for (const m of margins().slice(0, 36)) {
      const cx = r.px(m.x), cy = r.py(m.y), w = (0.25 + rnd() * 0.3) * s, h = (0.6 + rnd() * 0.9) * s;
      if (rnd() < 0.3) {
        x.fillStyle = "rgba(150,120,255,0.85)"; x.beginPath(); x.moveTo(cx, cy - h); x.lineTo(cx + w * 0.6, cy); x.lineTo(cx - w * 0.6, cy); x.closePath(); x.fill();
        x.fillStyle = "rgba(220,200,255,0.8)"; x.fillRect(cx - w * 0.1, cy - h * 0.8, w * 0.15, h * 0.5);
      } else {
        x.fillStyle = "#463d57"; x.strokeStyle = "#2c2638"; x.lineWidth = Math.max(1, s * 0.03);
        x.beginPath(); x.moveTo(cx, cy - h); x.lineTo(cx + w, cy); x.lineTo(cx - w, cy); x.closePath(); x.fill(); x.stroke();
      }
    }
  } else if (p.detail === "champion") {
    // tiled floor, a golden emblem in the middle, red carpets at the ends and pillars at the corners
    if (!textured) {
      x.strokeStyle = "rgba(255,255,255,0.10)"; x.lineWidth = Math.max(1, s * 0.03);
      for (let i = 1; i < A.w; i++) { x.beginPath(); x.moveTo(r.px(i), r.py(0)); x.lineTo(r.px(i), r.py(A.h)); x.stroke(); }
      for (let j = 1; j < A.h; j++) { x.beginPath(); x.moveTo(r.px(0), r.py(j)); x.lineTo(r.px(A.w), r.py(j)); x.stroke(); }
    }
    const cx = r.px(A.w / 2), cy = r.py(A.h / 2);
    x.fillStyle = "rgba(230,190,70,0.85)";
    x.beginPath();
    for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU - Math.PI / 2, rr = (i % 2 ? 1.25 : 2.3) * s; x.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.62); }
    x.closePath(); x.fill();
    x.fillStyle = "#c33a3a"; x.beginPath(); x.ellipse(cx, cy, 1.0 * s, 0.62 * s, 0, Math.PI, TAU); x.fill();
    x.fillStyle = "#f2efe6"; x.beginPath(); x.ellipse(cx, cy, 1.0 * s, 0.62 * s, 0, 0, Math.PI); x.fill();
    x.fillStyle = "#222"; x.fillRect(cx - 1.0 * s, cy - 0.05 * s, 2.0 * s, 0.1 * s);
    x.fillStyle = "#f2efe6"; x.beginPath(); x.ellipse(cx, cy, 0.3 * s, 0.19 * s, 0, 0, TAU); x.fill();
    x.fillStyle = "#8f2630";
    x.fillRect(r.px(4), r.py(-0.85), (A.w - 8) * s, 0.6 * s);
    x.fillRect(r.px(4), r.py(A.h + 0.25), (A.w - 8) * s, 0.6 * s);
    x.fillStyle = "#d9b44a";
    x.fillRect(r.px(4), r.py(-0.85), (A.w - 8) * s, 0.06 * s); x.fillRect(r.px(4), r.py(A.h + 0.79), (A.w - 8) * s, 0.06 * s);
    for (const [px, py] of [[-1.3, 0.6], [-1.3, A.h - 0.6], [A.w + 1.3, 0.6], [A.w + 1.3, A.h - 0.6]]) {
      const qx = r.px(px), qy = r.py(py);
      x.fillStyle = "#cfd6dc"; x.fillRect(qx - 0.35 * s, qy - 1.5 * s, 0.7 * s, 1.5 * s);
      x.fillStyle = "#9aa4ad"; x.fillRect(qx + 0.15 * s, qy - 1.5 * s, 0.2 * s, 1.5 * s);
      x.fillStyle = "#ffe9a0"; x.beginPath(); x.arc(qx, qy - 1.65 * s, 0.28 * s, 0, TAU); x.fill();
    }
  } else if (p.detail === "castle") {
    // pale tiles with a golden border, teal brick walls and columns along them
    x.strokeStyle = "rgba(120,100,60,0.18)"; x.lineWidth = Math.max(1, s * 0.03);
    for (let i = 2; i < A.w; i += 2) { x.beginPath(); x.moveTo(r.px(i), r.py(0)); x.lineTo(r.px(i), r.py(A.h)); x.stroke(); }
    for (let j = 2; j < A.h; j += 2) { x.beginPath(); x.moveTo(r.px(0), r.py(j)); x.lineTo(r.px(A.w), r.py(j)); x.stroke(); }
    x.strokeStyle = "#c9a640"; x.lineWidth = Math.max(2, s * 0.14);
    x.strokeRect(r.px(0.5), r.py(0.5), (A.w - 1) * s, (A.h - 1) * s);
    x.fillStyle = "rgba(255,255,255,0.08)";
    for (let i = 0; i < 260; i++) {
      const bx = r.px(-2.6 + (i % 26) * 1.28 + (Math.floor(i / 26) % 2) * 0.64), by = r.py(-0.9 + Math.floor(i / 26) * 0.45);
      if (by < r.py(0) - 0.05 * s) x.fillRect(bx, by, 1.15 * s, 0.38 * s);
    }
    for (const px of [2, 7, 12, 16, 21, 26]) for (const py of [-0.1, A.h + 0.85]) {
      const qx = r.px(px), qy = r.py(py);
      x.fillStyle = "#e8e1cc"; x.fillRect(qx - 0.28 * s, qy - 0.9 * s, 0.56 * s, 0.9 * s);
      x.fillStyle = "#b9ad8a"; x.fillRect(qx + 0.1 * s, qy - 0.9 * s, 0.18 * s, 0.9 * s);
    }
  }
  x.restore();
}

/** The ambience of a place, every frame (time in seconds), over the court and under the Pokémon. */
export function drawAmbient(ctx, r, floor, time) {
  const p = PLACE_FLOORS[floor];
  if (!p || !p.ambient) return;
  const s = r.scale;
  const W = r.canvas.width, H = r.canvas.height;
  ctx.save();
  if (p.ambient === "fog") {
    for (let i = 0; i < 6; i++) {
      const cx = ((i * 0.37 + time * 0.012 * (1 + i * 0.3)) % 1.4 - 0.2) * W, cy = (0.15 + (i * 0.29 % 0.8)) * H, rr = (4 + i % 3 * 2) * s;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr);
      g.addColorStop(0, "rgba(235,245,245,0.22)"); g.addColorStop(1, "rgba(235,245,245,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(cx, cy, rr, rr * 0.45, 0, 0, TAU); ctx.fill();
    }
  } else if (p.ambient === "snow") {
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    for (let i = 0; i < 70; i++) {
      const sp = 0.6 + (i % 5) * 0.15;
      const x = ((i * 97.13 % 100) / 100 * W + Math.sin(time * 0.8 + i) * 0.4 * s + time * 0.3 * s) % W;
      const y = ((i * 53.71 % 100) / 100 * H + time * sp * s) % H;
      ctx.beginPath(); ctx.arc(x, y, Math.max(1, s * (0.04 + (i % 3) * 0.02)), 0, TAU); ctx.fill();
    }
  } else if (p.ambient === "shafts") {
    for (let i = 0; i < 4; i++) {
      const x0 = (0.12 + i * 0.24) * W, a = 0.07 + 0.04 * Math.sin(time * 0.6 + i * 1.7);
      const g = ctx.createLinearGradient(x0, 0, x0 + 0.08 * W, H);
      g.addColorStop(0, `rgba(210,220,255,${a})`); g.addColorStop(1, "rgba(210,220,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(x0, 0); ctx.lineTo(x0 + 0.05 * W, 0); ctx.lineTo(x0 + 0.16 * W, H); ctx.lineTo(x0 + 0.07 * W, H); ctx.closePath(); ctx.fill();
    }
  } else if (p.ambient === "emblem") {
    const cx = r.px(A.w / 2), cy = r.py(A.h / 2), rr = (2.6 + Math.sin(time * 2) * 0.15) * s;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr);
    g.addColorStop(0, "rgba(255,230,140,0.28)"); g.addColorStop(1, "rgba(255,230,140,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(cx, cy, rr, rr * 0.62, 0, 0, TAU); ctx.fill();
  }
  ctx.restore();
}
