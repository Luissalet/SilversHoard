// Pennant Capture rules (SPEC 20), with no screen: a 512 x 512 field at 30 steps a second, four teams that each steer one Pokémon at a
// time, drag-flicks, pennants, the goal slot, knock-downs from behind and the CPU that looks at a grid around itself every 6 frames.
import { stat } from "../_kit/index.js";
import { LAYOUTS } from "./layouts.js";

export const TOTAL_FRAMES = 1800; // 60 s at 30 fps
export const X0 = 144;
export const X1 = 368;
export const Y0 = 104;
export const Y1 = 392;
export const SLOT_X0 = 208;
export const SLOT_X1 = 304;
export const SLOT_Y = 416;
export const DEPOSIT_Y = 408;
export const RADIUS = 8;
export const PICK_RADIUS = 8;
export const TOUCH_RADIUS = 80;
export const MAX_CARRY = 9;
export const HOLD_MAX = 30;
export const HOLD_TOO_LONG = 255;
export const FRICTION = 0.6;
export const SWAP_FRAMES = 32;
export const TARGET_SCORE = 35;

// by the stat in the comment (raw 0-4), SPEC 20 "Stat to behaviour"
export const KNOCKBACK = [0.6, 0.8, 1.0, 1.4, 2.0]; // Power
export const FLICK_POWER = [1.1, 1.2, 1.3, 1.3, 1.4]; // Skill
export const FLICK_SCALE = [1.0, 1.1, 1.2, 1.2, 1.3]; // Speed
export const DOWN_TIME = [15, 15, 15, 10, 5]; // Stamina
export const MAX_SPEED = [9, 9, 10, 10, 11]; // Speed

export const startOf = (team) => ({ x: SLOT_X0 + 32 * team, y: SLOT_Y });
/** The facing of a velocity in four sectors: 0 right, 1 down, 2 left, 3 up (+-45 degrees around each axis). */
export const sectorOf = (vx, vy) => (Math.abs(vx) >= Math.abs(vy) ? (vx >= 0 ? 0 : 2) : (vy >= 0 ? 1 : 3));

export function moveParams(mon) {
  const speed = stat(mon, "speed");
  const skill = stat(mon, "skill");
  return {
    gain: (FLICK_POWER[skill] * FLICK_SCALE[speed]) / 8,
    maxSpeed: MAX_SPEED[speed],
    knockback: KNOCKBACK[stat(mon, "power")],
    downTime: DOWN_TIME[stat(mon, "stamina")],
  };
}

const rectsOf = (layout) => layout.obstacles.map(([ox, oy]) => ({ cx: ox * 8, cy: oy * 8, l: ox * 8 - 16 - RADIUS, r: ox * 8 + 16 + RADIUS, t: oy * 8 - 16 - RADIUS, b: oy * 8 + 16 + RADIUS }));

export class Match {
  /** teams: the four ctx teams; humanTeam: the team steered by the person (-1 = none); layout: forced index, else drawn from rng. */
  constructor({ teams, rng, humanTeam = -1, layout = null }) {
    this.teams = teams;
    this.rng = rng;
    this.humanTeam = humanTeam;
    this.layoutIndex = layout === null ? Math.floor(rng() * LAYOUTS.length) % LAYOUTS.length : layout;
    this.layout = LAYOUTS[this.layoutIndex];
    this.rects = rectsOf(this.layout);
    this.items = this.layout.items.map(([x, y]) => ({ x: x * 8, y: y * 8 }));
    this.spots = this.layout.spots.map(([x, y]) => ({ x: x * 8, y: y * 8 }));
    this.frame = 0;
    this.over = false;
    this.events = [];
    this.pennants = [];
    this.nextSpot = 0;
    for (let i = 0; i < 5; i++) this.spawnPennant();
    this.params = teams.map((t) => t.mons.map((m) => moveParams(m)));
    this.counters = teams.map((t) => t.mons.map(() => ({ failed: 0, hit: 0, points: 0, switched: 0 })));
    this.players = teams.map((t, i) => {
      const s = startOf(i);
      return {
        team: i, member: 0, x: s.x, y: s.y, vx: 0, vy: 0, facing: 3,
        pennants: 0, pointsToAdd: 0, score: 0,
        mode: "play", modeT: 0, depositSteps: 0, depositDelay: 0, offset: 0,
        knocked: false, knockT: 0, frozen: 0,
        drag: null, // { x, y, hold } while the person holds the stylus
        tooLong: false, human: i === humanTeam,
        lastFlick: 0, slide: 0,
      };
    });
    this.contact = new Set();
    this.cpuTeams = [];
    for (let i = 0; i < teams.length; i++) if (i !== humanTeam) this.cpuTeams.push(i);
  }

  push(type, extra) { this.events.push({ type, frame: this.frame, ...extra }); }
  drain() { const e = this.events; this.events = []; return e; }

  spawnPennant() {
    for (let k = 0; k < this.spots.length; k++) {
      const idx = (this.nextSpot + k) % this.spots.length;
      if (this.pennants.some((p) => p.spot === idx)) continue;
      this.nextSpot = (idx + 1) % this.spots.length;
      const s = this.spots[idx];
      this.pennants.push({ x: s.x, y: s.y, spot: idx, born: this.frame });
      return;
    }
  }

  mon(p) { return this.teams[p.team].mons[p.member]; }
  par(p) { return this.params[p.team][p.member]; }
  cnt(p) { return this.counters[p.team][p.member]; }
  canAct(p) { return p.mode === "play" && !p.knocked && p.frozen === 0; }

  // ---- the person's drag -------------------------------------------------------------------------------------------------------
  /** The stylus lands at field point (x, y). Only starts a drag on the team's own Pokémon (within 80 px) while it can be flicked. */
  beginDrag(team, x, y) {
    const p = this.players[team];
    if (!p || p.drag || !this.canAct(p)) return false;
    if (Math.hypot(x - p.x, y - p.y) > TOUCH_RADIUS) return false;
    p.drag = { x, y, hold: 0 };
    return true;
  }

  /** The stylus is lifted at (x, y): a drag held for at most 30 frames becomes a flick. Returns true when it did. */
  endDrag(team, x, y) {
    const p = this.players[team];
    if (!p || !p.drag) return false;
    const d = p.drag;
    p.drag = null;
    p.tooLong = false;
    if (d.hold > HOLD_MAX || !this.canAct(p)) return false;
    return this.flick(team, x - d.x, y - d.y);
  }

  cancelDrag(team) { const p = this.players[team]; if (p) { p.drag = null; p.tooLong = false; } }

  /** A flick with a drag vector (field px): the velocity grows by drag x (flickPower x flickScale / 8), capped at the speed limit. */
  flick(team, dx, dy) {
    const p = this.players[team];
    if (!p || !this.canAct(p)) return false;
    const par = this.par(p);
    p.vx += dx * par.gain;
    p.vy += dy * par.gain;
    const sp = Math.hypot(p.vx, p.vy);
    if (sp > par.maxSpeed) { p.vx *= par.maxSpeed / sp; p.vy *= par.maxSpeed / sp; }
    if (sp > 0.01) p.facing = sectorOf(p.vx, p.vy);
    p.lastFlick = this.frame;
    this.push("flick", { team, member: p.member });
    return true;
  }

  // ---- the CPU -----------------------------------------------------------------------------------------------------------------
  cpuThink(p) {
    if (!this.canAct(p)) return;
    const rng = this.rng;
    const cx = p.x;
    const cy = p.y;
    let best = -Infinity;
    let ties = [];
    for (let i = 0; i < 48; i++) {
      const tx = cx - 96 + (i % 6) * 32 + Math.floor(rng() * 32);
      const ty = cy - 128 + Math.floor(i / 6) * 32 + Math.floor(rng() * 32);
      const near = (ox, oy) => Math.abs(ox - tx) < 16 && Math.abs(oy - ty) < 16;
      let s = 0;
      for (const f of this.pennants) if (near(f.x, f.y)) s += 7;
      for (const it of this.items) if (near(it.x, it.y)) s += 2;
      for (const o of this.players) if (o !== p && o.mode === "play" && near(o.x, o.y)) s -= 3;
      for (const r of this.rects) if (near(r.cx, r.cy)) s -= 2;
      const inField = tx >= X0 && tx <= X1 && ty >= Y0 && ty <= Y1;
      const inSlot = tx >= SLOT_X0 && tx <= SLOT_X1 && ty > Y1 && ty <= SLOT_Y;
      if (!inField && !inSlot) s -= 100;
      if (i >= 19 && i <= 22) s += 4;
      if (cy > 256) { if (i >= 30 && i <= 35) s += 3; } else if (i <= 5) s += 3;
      if (p.pennants > 0) {
        if (i >= 30 && i <= 35) s += p.pennants;
        if (cx > 256) { if (i >= 30 && i <= 32) s += 2; } else if (i >= 33 && i <= 35) s += 2;
      }
      if (s > best) { best = s; ties = [{ tx, ty }]; } else if (s === best) ties.push({ tx, ty });
    }
    const pick = ties[Math.min(ties.length - 1, Math.floor(rng() * ties.length))];
    this.flick(p.team, pick.tx - cx, pick.ty - cy);
  }

  // ---- movement ----------------------------------------------------------------------------------------------------------------
  moveAxis(p, axis) {
    const horizontal = axis === 0;
    const v = horizontal ? p.vx : p.vy;
    if (v === 0) return;
    let x = p.x;
    let y = p.y;
    if (horizontal) x += v; else y += v;
    let hit = false;
    if (horizontal) {
      const lo = p.y > Y1 ? SLOT_X0 : X0;
      const hi = p.y > Y1 ? SLOT_X1 : X1;
      if (x < lo) { x = lo; hit = true; } else if (x > hi) { x = hi; hit = true; }
    } else {
      const inSlot = p.x >= SLOT_X0 && p.x <= SLOT_X1;
      const hi = inSlot ? SLOT_Y : Y1;
      if (y < Y0) { y = Y0; hit = true; } else if (y > hi) { y = hi; hit = true; }
    }
    for (const r of this.rects) {
      if (x > r.l && x < r.r && y > r.t && y < r.b) {
        if (horizontal) x = v > 0 ? r.l : r.r; else y = v > 0 ? r.t : r.b;
        hit = true;
      }
    }
    p.x = x;
    p.y = y;
    if (hit) {
      if (horizontal) p.vx *= -0.3; else p.vy *= -0.3;
      if (Math.abs(v) > 3) this.push("bump", { team: p.team, x: p.x, y: p.y });
    }
  }

  stepPlayer(p) {
    if (p.drag) {
      p.drag.hold++;
      if (p.drag.hold >= HOLD_TOO_LONG) p.tooLong = true;
    }
    if (p.mode === "deposit") {
      if (p.depositSteps > 0) {
        if (p.depositDelay > 0) p.depositDelay--;
        else {
          if (p.pointsToAdd > 0) {
            p.pointsToAdd--;
            p.score++;
            this.cnt(p).points++;
            this.push("score", { team: p.team, x: p.x, y: p.y, n: p.score });
          }
          p.depositSteps--;
          p.depositDelay = 4;
        }
      } else { p.mode = "out"; p.modeT = 0; }
      return;
    }
    if (p.mode === "out") {
      p.modeT++;
      p.offset += 8;
      if (p.modeT >= SWAP_FRAMES) {
        this.cnt(p).switched++;
        p.member = (p.member + 1) % 3;
        const s = startOf(p.team);
        p.x = s.x; p.y = s.y; p.vx = 0; p.vy = 0; p.facing = 3;
        p.mode = "in"; p.modeT = 0; p.offset = 8 * SWAP_FRAMES;
        this.push("swap", { team: p.team, member: p.member });
      }
      return;
    }
    if (p.mode === "in") {
      p.modeT++;
      p.offset = Math.max(0, p.offset - 8);
      if (p.modeT >= SWAP_FRAMES) { p.mode = "play"; p.modeT = 0; p.offset = 0; }
      return;
    }
    if (p.frozen > 0) { p.frozen--; return; }
    if (p.knocked && --p.knockT <= 0) p.knocked = false;
    this.moveAxis(p, 0);
    this.moveAxis(p, 1);
    const sp = Math.hypot(p.vx, p.vy);
    const f = FRICTION + (p.tooLong ? 3 : 0);
    if (sp <= f) { p.vx = 0; p.vy = 0; } else { p.vx *= (sp - f) / sp; p.vy *= (sp - f) / sp; }
    if (sp > 0.05) p.facing = sectorOf(p.vx, p.vy);
    // pick up the pennants under it
    if (!p.knocked) {
      for (let i = this.pennants.length - 1; i >= 0 && p.pennants < MAX_CARRY; i--) {
        const f2 = this.pennants[i];
        if (Math.hypot(f2.x - p.x, f2.y - p.y) < RADIUS + PICK_RADIUS) {
          this.pennants.splice(i, 1);
          p.pennants++;
          this.spawnPennant();
          this.push("pickup", { team: p.team, x: f2.x, y: f2.y, n: p.pennants });
        }
      }
    }
    // into the goal slot with pennants: deposit them
    if (p.pennants > 0 && !p.knocked && p.y > DEPOSIT_Y && p.x >= SLOT_X0 && p.x <= SLOT_X1) {
      p.vx = 0; p.vy = 0;
      p.pointsToAdd = p.pennants;
      p.pennants = 0;
      p.mode = "deposit";
      p.depositSteps = 10;
      p.depositDelay = 0;
      p.drag = null;
      p.tooLong = false;
      this.push("deposit", { team: p.team, x: p.x, y: p.y });
    }
  }

  // ---- collisions between Pokémon ---------------------------------------------------------------------------------------------
  collide() {
    const ps = this.players;
    for (let a = 0; a < ps.length; a++) {
      for (let b = a + 1; b < ps.length; b++) {
        const A = ps[a];
        const B = ps[b];
        const key = a * 8 + b;
        const live = A.mode === "play" && B.mode === "play";
        const near = live && Math.hypot(A.x - B.x, A.y - B.y) < RADIUS * 2;
        if (!near) { this.contact.delete(key); continue; }
        if (this.contact.has(key)) continue;
        this.contact.add(key);
        this.cnt(A).hit++;
        this.cnt(B).hit++;
        const sa = Math.hypot(A.vx, A.vy);
        const sb = Math.hypot(B.vx, B.vy);
        const win = sa > sb ? A : sb > sa ? B : null;
        const lose = win === A ? B : A;
        if (win && !win.knocked && win.facing === lose.facing && sectorOf(win.vx, win.vy) === win.facing && Math.max(sa, sb) > 0.05) {
          this.knockDown(win, lose);
        } else {
          A.frozen = Math.max(A.frozen, 6);
          B.frozen = Math.max(B.frozen, 6);
          this.push("hit", { team: A.team, x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 });
        }
      }
    }
  }

  knockDown(win, lose) {
    const wsp = Math.hypot(win.vx, win.vy);
    const take = Math.min(2, lose.pennants, MAX_CARRY - win.pennants);
    lose.pennants -= take;
    win.pennants += take;
    lose.knocked = true;
    lose.knockT = Math.min(255, this.par(lose).downTime + Math.floor(wsp));
    lose.drag = null;
    lose.tooLong = false;
    const k = this.par(win).knockback;
    lose.vx = win.vx * k;
    lose.vy = win.vy * k;
    const ls = Math.hypot(lose.vx, lose.vy);
    if (ls > 11) { lose.vx *= 11 / ls; lose.vy *= 11 / ls; }
    win.vx = 0; win.vy = 0;
    win.frozen = 18;
    lose.frozen = 6;
    this.cnt(lose).failed++;
    this.push("knock", { team: win.team, victim: lose.team, x: lose.x, y: lose.y, took: take });
  }

  // ---- one frame ---------------------------------------------------------------------------------------------------------------
  step() {
    if (this.over) return;
    this.frame++;
    this.cpuTeams.forEach((t, k) => {
      if (this.frame % 6 === k) this.cpuThink(this.players[t]);
    });
    for (const p of this.players) {
      this.stepPlayer(p);
      if (p.drag && (p.knocked || p.mode !== "play")) { p.drag = null; p.tooLong = false; }
    }
    this.collide();
    for (const p of this.players) {
      const sp = Math.hypot(p.vx, p.vy);
      if (sp > 11) { p.vx *= 11 / sp; p.vy *= 11 / sp; }
    }
    if (this.frame >= TOTAL_FRAMES) { this.over = true; this.push("end"); }
  }

  /** deposited + still waiting to be credited + carried (capped at 999). */
  scoreOf(team) {
    const p = this.players[team];
    return Math.min(999, p.score + p.pointsToAdd + p.pennants);
  }

  result() {
    const raw = this.players.map((p) => this.scoreOf(p.team));
    const detail = this.players.map((p) => ({
      score: p.score,
      carried: p.pennants + p.pointsToAdd,
      mons: this.counters[p.team].map((c) => ({ ...c })),
    }));
    return { raw, detail };
  }
}
