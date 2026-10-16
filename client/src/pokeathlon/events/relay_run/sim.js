// Relay Run rules (SPEC 70), with no screen: four teams of three Pokémon run laps of a 1024 px loop for 2700 frames (90 s at 30 fps).
// Only one Pokémon of a team runs at a time; a flick makes it run, the energy runs out, and the team swaps to the next member.
// Position x is the distance along the lap (wraps at 1024), y is the lane (32..168). The CPU follows the game's grid-and-lanes logic.
import { stat } from "../_kit/index.js";

export const LAP = 1024;
export const DURATION = 2700;
export const RADIUS = 8;
export const TARGET_SCORE = 12288;
export const Y_MIN = 32;
export const Y_MAX = 168;
export const SIZE = { 1: 48, 2: 32, 3: 64 };
export const TOUCH_RADIUS = 80;
export const HOLD_MAX = 30;
export const HOLD_TOO_LONG = 255;
export const SWAP_BACK = -16;

// by Power / Stamina / Skill / Speed (raw 0-4), SPEC 70 "Stat to behaviour"
export const PUSH = [0.6, 0.8, 1.0, 1.4, 2.0]; // Power
export const MAX_ENERGY = [150, 160, 180, 210, 250]; // Stamina
export const ACCEL = [0.8, 0.9, 1.0, 1.1, 1.2]; // Skill
export const WEIGHT = [0.7, 0.9, 1.0, 1.3, 1.5]; // Speed
export const RECOVERY = [60, 50, 40, 30, 20]; // Stamina
export const LIMIT = [7, 8, 9, 10, 11]; // Speed
export const TIRED_SPEED = [5, 5, 5, 4, 4]; // Speed
export const PATCH_SPEED = [3, 3, 3, 3, 3];

// (kind, x, y): 1 = big wall 48 x 48, 2 = wall 32 x 32, 3 = slow patch 64 x 64; the centre is (x, y + 32)
export const LAYOUTS = [
  [[2, 200, 0], [3, 592, 24], [3, 984, 24], [1, 712, 40], [3, 472, 96], [3, 384, 112], [2, 912, 128]],
  [[2, 568, 0], [2, 800, 0], [3, 288, 16], [1, 968, 16], [3, 672, 88], [3, 152, 112], [2, 384, 128]],
  [[2, 200, 0], [3, 384, 16], [3, 912, 88], [3, 624, 112], [1, 824, 112], [2, 520, 120]],
  [[2, 552, 0], [3, 296, 16], [3, 800, 16], [3, 160, 88], [3, 456, 88], [3, 616, 112], [2, 984, 120]],
  [[2, 536, 0], [2, 976, 8], [3, 200, 64], [3, 776, 64], [2, 944, 120], [2, 592, 128]],
  [[2, 912, 0], [3, 384, 24], [1, 712, 96], [3, 984, 104], [3, 592, 112], [2, 200, 128]],
  [[2, 384, 0], [3, 152, 24], [3, 672, 40], [3, 288, 112], [1, 968, 112], [2, 568, 128], [2, 800, 128]],
  [[2, 520, 8], [3, 624, 16], [1, 824, 16], [3, 912, 40], [3, 384, 112], [2, 200, 128]],
  [[2, 984, 8], [3, 616, 16], [3, 160, 32], [3, 456, 40], [3, 296, 112], [3, 800, 112], [2, 552, 128]],
  [[2, 592, 0], [2, 944, 8], [3, 200, 64], [3, 776, 64], [2, 976, 120], [2, 536, 128]],
];

export const COND_FINE = 0;
export const COND_TIRED = 1;
export const COND_EXHAUSTED = 2;
const CELL_SCORES = [2, 4, 6, 6];
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

function segInter(p1, p2, p3, p4) {
  const [x1, y1] = p1; const [x2, y2] = p2; const [x3, y3] = p3; const [x4, y4] = p4;
  const d = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3);
  if (d === 0) return null;
  const t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / d;
  const u = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / d;
  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return [Math.round(x1 + t * (x2 - x1)), Math.round(y1 + t * (y2 - y1))];
  return null;
}

function wallShape(o, inset) {
  const [k, ox, oy0] = o;
  const size = k === 1 ? 48 : 32;
  const x = ox - size / 2;
  const y = oy0 + 32 - size / 2;
  const c = [[x, y], [x + size, y], [x + size, y + size], [x, y + size]];
  const e = [[c[0], c[1]], [c[1], c[2]], [c[2], c[3]], [c[3], c[0]]];
  e[0] = e[0].map(([px, py]) => [px, py - inset]);
  e[1] = e[1].map(([px, py]) => [px + inset, py]);
  e[2] = e[2].map(([px, py]) => [px, py + inset]);
  e[3] = e[3].map(([px, py]) => [px - inset, py]);
  return { c, e };
}

function collideWall(a, b, rad, o) {
  const { c, e } = wallShape(o, rad);
  const ai = [Math.trunc(a[0]), Math.trunc(a[1])];
  const bi = [Math.trunc(b[0]), Math.trunc(b[1])];
  for (let i = 0; i < 4; i++) {
    const h = segInter(e[i][0], e[i][1], ai, bi);
    if (h) return [2 + i, h];
    if (ai[0] === e[i][0][0] && Math.min(e[i][0][1], e[i][1][1]) <= ai[1] && ai[1] <= Math.max(e[i][0][1], e[i][1][1])) return [2 + i, a];
  }
  for (let i = 0; i < 4; i++) {
    const [cx, cy] = c[i];
    if (dist(b[0], b[1], cx, cy) <= rad) {
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const fx = a[0] - cx;
      const fy = a[1] - cy;
      const A = dx * dx + dy * dy;
      const B = 2 * (fx * dx + fy * dy);
      const C = fx * fx + fy * fy - rad * rad;
      const disc = B * B - 4 * A * C;
      let t = 0;
      if (A > 0 && disc >= 0) t = Math.max(0, Math.min(1, (-B - Math.sqrt(disc)) / (2 * A)));
      return [6 + i, [a[0] + t * dx, a[1] + t * dy]];
    }
  }
  if (c[0][0] <= b[0] && b[0] <= c[2][0] && c[0][1] <= b[1] && b[1] <= c[2][1]) {
    const dl = Math.abs(c[0][0] - b[0]);
    const dr = Math.abs(c[2][0] - b[0]);
    const [sx, ssd] = dl < dr ? [13, dl] : [11, dr];
    const dt = Math.abs(c[0][1] - b[1]);
    const db = Math.abs(c[2][1] - b[1]);
    const [sy, sdd] = dt < db ? [10, dt] : [12, db];
    const out = [b[0], b[1]];
    let side;
    if (ssd <= sdd) { out[0] = sx === 13 ? c[0][0] - rad : c[2][0] + rad; side = sx; } else { out[1] = sy === 10 ? c[0][1] - rad : c[2][1] + rad; side = sy; }
    return [side, out];
  }
  return [0, null];
}

function clampV(vx, vy, lim) {
  const m = Math.hypot(vx, vy);
  return m > lim && m > 0 ? [(vx / m) * lim, (vy / m) * lim] : [vx, vy];
}

class Member {
  constructor(mon) {
    const power = stat(mon, "power"); const speed = stat(mon, "speed"); const stamina = stat(mon, "stamina"); const skill = stat(mon, "skill");
    this.push = PUSH[power];
    this.maxE = MAX_ENERGY[stamina];
    this.E = this.maxE;
    this.limit = LIMIT[speed];
    this.patch = PATCH_SPEED[speed];
    this.tiredSpd = TIRED_SPEED[speed];
    this.acc = ACCEL[skill];
    this.weight = WEIGHT[speed];
    this.rec = RECOVERY[stamina];
    this.cond = COND_FINE;
    this.dist = 0;
    this.c = { failed: 0, hit: 0, dashed: 0, switched: 0 };
  }

  get gain() { return (this.acc * this.weight) / 8; }
}

class Team {
  constructor(idx, mons) {
    this.idx = idx;
    this.m = mons.map((mon) => new Member(mon));
    this.cur = 0;
    this.x = 0;
    this.y = (idx + 1) * 27 + 40;
    this.vx = 0;
    this.vy = 0;
    this.laps = 0;
    this.behind = false;
    this.tired = false;
    this.rtimer = 0;
    this.stun = 0;
    this.swapping = false;
    this.swapT = 0;
    this.phase = 0;
    this.flick = null;
    this.wall = 0;
    this.onpatch = false;
    this.bumped = [0, 0, 0, 0];
    this.grade = 0;
    this.nswaps = 0;
  }
}

export class Race {
  /** teams: the four ctx teams; humanTeam: the team steered by the person (-1 = none); layout: forced index, else drawn from rng. */
  constructor({ teams, rng, humanTeam = -1, layout = null, fixQuirk = true }) {
    this.ctxTeams = teams;
    this.rng = rng;
    this.humanTeam = humanTeam;
    this.fixQuirk = fixQuirk;
    this.teams = teams.map((t, i) => new Team(i, t.mons));
    this.layoutIndex = layout === null ? Math.floor(rng() * LAYOUTS.length) % LAYOUTS.length : layout;
    this.layout = LAYOUTS[this.layoutIndex];
    this.timer = DURATION;
    this.frame = 0;
    this.over = false;
    this.cpuTimer = 10;
    this.cursor = 0;
    this.thinking = false;
    this.cpuTeams = [];
    for (let i = 0; i < 4; i++) if (i !== humanTeam) this.cpuTeams.push(i);
    this.tooLong = false;
    this.events = [];
    this.bumps = 0;
  }

  push(type, extra) { this.events.push({ type, frame: this.frame, ...extra }); }
  drain() { const e = this.events; this.events = []; return e; }
  member(t) { return this.teams[t].m[this.teams[t].cur]; }
  canAct(t) { const T = this.teams[t]; return !T.swapping && !T.stun && T.m[T.cur].cond !== COND_EXHAUSTED && !this.over; }
  scoreOf(t) { const T = this.teams[t]; return T.laps * LAP + Math.trunc(T.x); }

  // ---- the person's inputs -----------------------------------------------------------------------------------------------------
  /** A released drag (px, along x and y). A backwards drag longer than 16 px swaps instead. Returns "flick", "swap" or null. */
  drag(team, dx, dy) {
    if (!this.canAct(team)) return null;
    if (dx < 0) {
      if (dx < SWAP_BACK) { this.startSwap(this.teams[team]); return "swap"; }
      return null;
    }
    this.teams[team].flick = [dx, dy];
    return "flick";
  }

  swap(team) {
    if (!this.canAct(team)) return false;
    this.startSwap(this.teams[team]);
    return true;
  }

  startSwap(t) {
    t.swapping = true;
    t.phase = 1;
    t.swapT = 0;
    t.nswaps++;
    t.m[t.cur].c.switched++;
    this.push("swap", { team: t.idx });
  }

  // ---- the CPU -----------------------------------------------------------------------------------------------------------------
  think(idx) {
    const t = this.teams[idx];
    if (t.swapping || t.m[t.cur].cond === COND_EXHAUSTED || t.stun) return;
    const rng = this.rng;
    const T = this.teams;
    const cy = T.map((q) => Math.trunc(q.y) - 5);
    const lanes = cy.map((y) => Math.trunc((y - 32) / 40));
    let tx = T.map((q) => Math.trunc(q.x));
    let selfx = tx[idx];
    const obs = this.layout.map(([k, x, y]) => ({ x: x - SIZE[k] / 2, y: y + 32 - SIZE[k] / 2, k, size: SIZE[k] }));
    if (selfx >= LAP - 160) {
      tx = tx.map((v) => (((v - 160) % LAP) + LAP) % LAP);
      // the original shifts the obstacles by +80 here (a quirk); both are shifted like the teams
      for (const o of obs) o.x = (((o.x - 160) % LAP) + LAP) % LAP;
      selfx = tx[idx];
    }
    const cells = [];
    for (let i = 0; i < 16; i++) {
      const cellX = (i % 4) * 40;
      const cellY = Math.floor(i / 4) * 40;
      cells.push({ i, sc: CELL_SCORES[i % 4], tx: selfx + cellX + Math.floor(rng() * 40), ty: cellY + 32 + Math.floor(rng() * 40) });
    }
    const lscore = [0, 0, 0, 0];
    for (let lane = 0; lane < 4; lane++) {
      for (let j = 0; j < 4; j++) {
        if (j === idx) continue;
        if (selfx + 160 < tx[j]) continue;
        const d = tx[j] - selfx;
        if (d >= 0 && d < 160) {
          if (lane === lanes[j]) lscore[lane] -= lane === lanes[idx] ? 4 : 2;
          cells[lane * 4 + Math.floor(d / 40)].sc -= 3;
        } else if (d >= -80 && lane === lanes[j] && lane === lanes[idx]) lscore[lane] += 2;
      }
      const laneTop = 32 + lane * 40;
      for (const o of obs) {
        if (selfx + 160 >= o.x) {
          const d = o.x - selfx;
          if (d > 0 && d <= 160 && laneTop < o.y + o.size && o.y < laneTop + 40) lscore[lane] -= o.k === 3 ? 1 : 6;
        }
      }
    }
    for (const c of cells) c.sc += lscore[Math.floor(c.i / 4)];
    for (let r = 0; r < 4; r++) { cells[r * 4 + 2].sc += 3; cells[r * 4 + 3].sc += 3; }
    let thr = 0;
    if (t.m[t.cur].E <= 20) {
      for (let r = 0; r < 4; r++) { cells[r * 4 + 2].sc -= 2; cells[r * 4 + 3].sc -= 2; }
      thr += 8;
    }
    if (t.m[(t.cur + 1) % 3].cond === COND_TIRED) thr -= 5;
    const best = Math.max(...cells.map((c) => c.sc));
    const ties = cells.filter((c) => c.sc === best);
    const pick = ties[Math.min(ties.length - 1, Math.floor(rng() * ties.length))];
    if (pick.sc >= thr) {
      const fy = Math.trunc(t.y) - 15;
      t.flick = [pick.tx - selfx, pick.ty - fy];
    } else this.startSwap(t);
  }

  // ---- one frame ---------------------------------------------------------------------------------------------------------------
  applyFlicks() {
    for (const t of this.teams) {
      if (t.swapping) {
        t.swapT++;
        if (t.phase === 1 && t.swapT >= 31) { t.cur = (t.cur + 1) % 3; t.phase = 2; this.push("swapMid", { team: t.idx }); }
        else if (t.phase === 2 && t.swapT >= 54) { t.phase = 0; t.swapping = false; t.tired = false; this.push("swapEnd", { team: t.idx }); }
        t.flick = null;
        continue;
      }
      if (t.m[t.cur].cond === COND_EXHAUSTED || t.stun) { t.flick = null; continue; }
      if (t.flick) {
        const m = t.m[t.cur];
        const k = m.gain;
        const mx = t.onpatch ? m.patch : m.E <= 40 ? m.tiredSpd : m.limit;
        const fx = t.flick[0] * k;
        const fy = t.flick[1] * k;
        const cx = t.vx + fx;
        const cy = t.vy * fy >= 0 ? t.vy + fy : fy;
        if (Math.hypot(cx, cy) > mx) [t.vx, t.vy] = clampV(cx, cy, mx); else { t.vx = cx; t.vy = cy; }
        if (Math.hypot(t.vx, t.vy) >= m.limit - 3) m.c.dashed++;
        t.flick = null;
        this.push("flick", { team: t.idx, speed: Math.hypot(t.vx, t.vy) });
      }
    }
  }

  step() {
    if (this.over) return;
    this.frame++;
    if (this.timer) this.timer--;
    this.applyFlicks();
    this.cpuTimer++;
    if (this.cpuTimer >= 10) { this.thinking = true; this.cpuTimer = 0; }
    if (this.thinking) {
      this.think(this.cpuTeams[this.cursor]);
      this.cursor++;
      if (this.cursor >= this.cpuTeams.length) { this.cursor = 0; this.thinking = false; }
    }
    this.move();
    if (this.timer <= 0) { this.over = true; this.push("end"); }
  }

  exhaust(t, mm) {
    mm.E = 0;
    mm.cond = COND_EXHAUSTED;
    t.rtimer = mm.rec;
    mm.c.failed++;
    this.push("exhaust", { team: t.idx });
  }

  move() {
    const T = this.teams;
    const skip = [false, false, false, false];
    T.forEach((t, i) => { if (t.stun) { t.stun--; skip[i] = true; } });
    T.forEach((t, i) => {
      if (skip[i]) return;
      const fr = [t.x, t.y];
      t.x += t.vx;
      t.y += t.vy;
      t.m[t.cur].dist += t.vx;
      t.y = Math.min(Y_MAX, Math.max(Y_MIN, t.y));
      let res = 0;
      let patch = false;
      for (const [k, ox, oy] of this.layout) {
        const d = Math.trunc(fr[0]) - ox;
        const sx = d >= 768 ? 80 + (1024 - d) : d <= -768 ? 80 - (1024 + d) : 80 - d;
        if (sx < -32 || sx > 288) continue;
        if (k === 3 && ox - 32 < fr[0] && fr[0] < ox + 32 && oy < fr[1] && fr[1] < oy + 64) patch = true;
      }
      for (const o of this.layout) {
        const [k, ox] = o;
        if (k === 3) continue;
        const d = Math.trunc(fr[0]) - ox;
        const sx = d >= 768 ? 80 + (1024 - d) : d <= -768 ? 80 - (1024 + d) : 80 - d;
        if (sx < -32 || sx > 288) continue;
        const [h, p] = collideWall(fr, [t.x, t.y], RADIUS, o);
        if (h) {
          if (h >= 10 || h !== t.wall) { t.x = p[0]; t.y = p[1]; }
          res = h;
          break;
        }
      }
      t.onpatch = patch;
      t.wall = res;
      if (res === 2 && t.vy > 0) t.vy = -t.vy;
      else if (res === 3 && t.vx < 0) t.vx = -t.vx;
      else if (res === 4 && t.vy < 0) t.vy = -t.vy;
      else if (res === 5 && t.vx > 0) t.vx = -t.vx;
      else if (res === 6) { if (t.vx > 0) t.vx = -t.vx; if (t.vy > 0) t.vy = -t.vy; }
      else if (res === 7) { if (t.vx < 0) t.vx = -t.vx; if (t.vy > 0) t.vy = -t.vy; }
      else if (res === 8) { if (t.vx < 0) t.vx = -t.vx; if (t.vy < 0) t.vy = -t.vy; }
      else if (res === 9) { if (t.vx > 0) t.vx = -t.vx; if (t.vy < 0) t.vy = -t.vy; }
      if (res >= 2 && res <= 9 && Math.hypot(t.vx, t.vy) > 2) this.push("bump", { team: t.idx });
      this.collideRunners();
      if (t.x >= LAP) {
        t.x -= LAP;
        if (!t.behind && t.laps < 60) { t.laps++; this.push("lap", { team: t.idx, laps: t.laps }); }
        t.behind = false;
      } else if (t.x < 0) {
        t.x += LAP;
        if (t.laps) t.laps--; else t.behind = true;
      }
      let sp = Math.hypot(t.vx, t.vy);
      const m = t.m[t.cur];
      if (!t.swapping && t.onpatch && sp > m.patch) { [t.vx, t.vy] = clampV(t.vx, t.vy, m.patch); sp = Math.hypot(t.vx, t.vy); }
      if (sp > 0) {
        const f = this.tooLong ? 3.4 : 0.4;
        if (sp >= f) { t.vx -= (t.vx / sp) * f; t.vy -= (t.vy / sp) * f; } else { t.vx = 0; t.vy = 0; }
      }
      sp = Math.hypot(t.vx, t.vy);
      if (sp >= m.limit - 1) t.grade = 3;
      else if (sp >= m.limit - 3) t.grade = 2;
      else if (sp === 0) t.grade = 0;
      else t.grade = 1;
      if (t.swapping) return;
      t.m.forEach((mm, j) => {
        let e = mm.E;
        if (j === t.cur) {
          if (mm.cond !== COND_EXHAUSTED) {
            e += t.grade === 0 ? 0.5 : -0.5;
            if (t.tired) { if (e > 40) e = 40; } else if (e > mm.maxE) e = mm.maxE;
          } else {
            t.rtimer--;
            if (t.rtimer === 0) { mm.cond = COND_TIRED; e = 40; }
          }
        } else {
          e += 0.5;
          if (e > mm.maxE) e = mm.maxE;
        }
        if (e <= 0) {
          mm.E = 0;
          if (mm.cond !== COND_EXHAUSTED) { mm.cond = COND_EXHAUSTED; t.tired = true; t.rtimer = mm.rec; mm.c.failed++; this.push("exhaust", { team: t.idx }); }
        } else if (e <= 40) { mm.E = e; mm.cond = COND_TIRED; } else { mm.E = e; mm.cond = COND_FINE; }
      });
    });
  }

  collideRunners() {
    const T = this.teams;
    for (let i = 0; i < 4; i++) {
      const p = T[i];
      if (p.swapping || p.stun) continue;
      for (let j = 0; j < 4; j++) {
        const q = T[j];
        if (i === j || q.swapping) continue;
        let px = p.x;
        let qx = q.x;
        if (p.x > 768 && q.x < 256) qx += 1024; else if (q.x > 768 && p.x < 256) px += 1024;
        const dx = qx - px;
        const dy = q.y - p.y;
        if (Math.hypot(dx, dy) < 2 * RADIUS) {
          if (p.bumped[j]) continue;
          if (dx * p.vx + dy * p.vy <= 0) continue;
          if (Math.hypot(p.vx, p.vy) !== 0) {
            const pm = p.m[p.cur];
            [q.vx, q.vy] = clampV(p.vx * pm.push, p.vy * pm.push, 11);
          }
          const hitIdx = this.fixQuirk ? q.cur : p.cur;
          const qm = q.m[hitIdx];
          if (qm.cond === COND_TIRED) { this.exhaust(q, qm); }
          p.vx = 0; p.vy = 0;
          const pm2 = p.m[p.cur];
          if (pm2.cond === COND_TIRED) this.exhaust(p, pm2);
          q.bumped[i] = 1;
          p.bumped[j] = 1;
          q.stun = 6;
          p.stun = 18;
          p.m[p.cur].c.hit++;
          q.m[q.cur].c.hit++;
          this.bumps++;
          this.push("collide", { team: p.idx, other: q.idx });
          break;
        }
        p.bumped[j] = 0;
        q.bumped[i] = 0;
      }
    }
  }

  result() {
    const raw = this.teams.map((t) => t.laps * LAP + Math.trunc(t.x));
    const detail = this.teams.map((t) => ({
      laps: t.laps,
      mons: t.m.map((mm) => ({ failed: mm.c.failed, hit: mm.c.hit, dashed: mm.c.dashed, switched: mm.c.switched, points: Math.min(255, Math.max(0, Math.floor(mm.dist / LAP))) })),
    }));
    return { raw, detail };
  }
}
