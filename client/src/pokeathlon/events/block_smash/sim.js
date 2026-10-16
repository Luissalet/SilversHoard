// Block Smash rules (SPEC 40), with no screen: every team has its own stack of ten blocks and smashes it for 900 frames (30 s at 30 fps).
// The person's team follows the tap / stamina / gauge / swap rules; the others are the CPU of the game (the same tables, no extra help).
// Coordinates are the DS ones (256 x 192); the block stack stands at x = 120, block i at y = 168 - 4 i.
import { stat } from "../_kit/index.js";

export const TOTAL_FRAMES = 900;
export const TARGET_SCORE = 80;
export const POWER = [20, 40, 60, 80, 100]; // by Power
export const MAX_STAMINA = [40, 60, 80, 100, 120]; // by Stamina
export const SPOT_KIND = [0, 1, 1, 2, 2]; // by Skill
export const COST = [0, 4, 4, 4, 3, 3, 3, 2, 2, 2];
export const STACK = 10;
export const BLOCK_X = 120;
export const BASE_Y = 168;
export const SPOT_SLOT_X = [-12, 2, -16, -2];
export const SPOT_SLOT_Y = [-12, -13, -4, -4];
// [left, top, right, bottom] offsets from the spot, half open; two rectangles per kind (their union is a plus sign)
export const SPOT_BOXES = [
  [[-1, -2, 1, 2], [-2, -1, 2, 1]],
  [[-2, -2, 2, 2], [-3, -1, 3, 1]],
  [[-3, -2, 3, 2], [-2, -3, 2, 3]],
];
export const TOUCH_OFFSETS = [[-30, 12], [-16, -18], [30, -18], [16, 12]];
export const READY = 0;
export const HIT = 1;
export const EXHAUSTED = 2;
export const SWITCHING = 3;
export const NEW_STACK = 4; // CPU only
const SWITCH_FRAMES = 26;
const HIT_FRAMES = 10;
const FULL_FRAMES = 90;
const SPOT_BONUS = 160;
const FULL_BONUS = 150;

const SW_ST_T = [5, 10, 15, 20, 30]; const SW_ST_C = [85, 75, 10, 10, 0];
const SW_G_T = [90, 80, 70]; const SW_G_C = [-50, -20, -10];
const SPOT_CHANCE = [4, 8, 16];
const HA_G_T = [100, 90, 80, 70]; const HA_G_C = [100, 60, 20, 10];
const HA_S_T = [100, 40, 20, 8, 0]; const HA_S_C = [100, 100, 100, 80, 60];

/** Is DS point (x, y) on the block standing at (bx, by)? Inside the slanted block shape. */
export function onBlock(x, y, bx, by) {
  if (y < by - 18 || y > by + 12) return false;
  const pts = TOUCH_OFFSETS.map(([ox, oy]) => [bx + ox, by + oy]);
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  // the original also takes the whole column -16..+16
  return inside || (x >= bx - 16 && x <= bx + 16);
}

export function onSpot(x, y, sx, sy, kind, tol = 0) {
  return SPOT_BOXES[kind].some(([l, t, r, b]) => x >= sx + l - tol && x < sx + r + tol && y >= sy + t - tol && y < sy + b + tol);
}

/** One team's stack: ten blocks of 100 health that drop one every 3 frames after the stack is cleared. */
export class Board {
  constructor(rng, spots) {
    this.rng = rng;
    this.spots = spots; // the weak spots matter only for the person's board
    this.health = new Array(STACK).fill(100);
    this.count = STACK;
    this.state = "ready"; // ready | dropping
    this.t = 0;
    this.y = Array.from({ length: STACK }, (_, i) => BASE_Y - 4 * i);
    this.vy = new Array(STACK).fill(0);
    this.landed = new Array(STACK).fill(true);
    this.slot = new Array(STACK).fill(0);
    this.spot = Array.from({ length: STACK }, () => null);
    this.broken = 0;
    this.generation = 0;
    if (spots) for (let i = 0; i < STACK; i++) this.moveSpot(i);
  }

  get hittable() { return this.state === "ready" && this.count > 0; }
  get top() { return this.count - 1; }
  topPos() { return { x: BLOCK_X, y: BASE_Y - 4 * this.top }; }

  moveSpot(i) {
    const r = Math.floor(this.rng() * 3);
    const s = r >= this.slot[i] ? r + 1 : r;
    this.slot[i] = s;
    this.spot[i] = { x: SPOT_SLOT_X[s] + Math.floor(this.rng() * 16), y: SPOT_SLOT_Y[s] + Math.floor(this.rng() * 12) };
  }

  /** The weak spot of the top block in DS coordinates. */
  spotPos() {
    if (!this.spots || this.count === 0) return null;
    const s = this.spot[this.top];
    const p = this.topPos();
    return { x: p.x + s.x, y: p.y + s.y };
  }

  /** Take `power` off the blocks from the top; returns how many broke. */
  damage(power) {
    let broken = 0;
    let p = power;
    while (this.count > 0 && p > 0) {
      const i = this.top;
      this.health[i] -= p;
      if (this.health[i] > 0) break;
      p = -this.health[i];
      this.health[i] = 0;
      this.count--;
      broken++;
      this.broken++;
    }
    if (this.count === 0 && broken > 0) { this.state = "dropping"; this.t = -4; this.generation++; }
    return broken;
  }

  /** The CPU keeps its own score and block health (as the game does); this only makes the stack on screen agree with it. */
  syncCpu(score, blockHealth, cleared) {
    if (cleared) { this.count = 0; this.state = "dropping"; this.t = -4; this.generation++; return; }
    if (this.state !== "ready") return;
    const rem = STACK - (score % STACK);
    this.count = rem;
    for (let i = 0; i < STACK; i++) this.health[i] = i < rem - 1 ? 100 : i === rem - 1 ? blockHealth : 0;
  }

  step() {
    if (this.state !== "dropping") return;
    this.t++;
    if (this.t < 0) return;
    for (let i = 0; i < STACK; i++) {
      if (this.t < 3 * i) { this.y[i] = -40; this.landed[i] = false; continue; }
      if (this.landed[i]) continue;
      this.vy[i] += 20;
      this.y[i] += this.vy[i];
      const target = BASE_Y - 4 * i;
      if (this.y[i] >= target) {
        this.y[i] = target; this.vy[i] = 0; this.landed[i] = true;
      }
    }
    if (this.landed.every(Boolean) && this.t >= 3 * (STACK - 1) + 4) {
      this.health.fill(100);
      this.count = STACK;
      this.state = "ready";
      if (this.spots) for (let i = 0; i < STACK; i++) this.moveSpot(i);
    } else if (this.t === 0) {
      this.landed.fill(false);
      this.y.fill(-40);
      this.vy.fill(0);
    }
  }
}

function makeMembers(team) {
  return team.mons.map((m) => ({
    power: POWER[stat(m, "power")], max: MAX_STAMINA[stat(m, "stamina")], st: MAX_STAMINA[stat(m, "stamina")], kind: SPOT_KIND[stat(m, "skill")],
  }));
}

class Side {
  constructor(team, rng, human) {
    this.team = team;
    this.rng = rng;
    this.human = human;
    this.members = makeMembers(team);
    this.counters = team.mons.map(() => ({ failed: 0, points: 0, hit: 0, switched: 0 }));
    this.member = 0;
    this.mode = READY;
    this.modeFrames = 0;
    this.gauge = 0;
    this.gaugeFull = false;
    this.gaugeT = 0;
    this.frames = 0; // the stamina recovery clock
    this.score = 0;
    this.board = new Board(rng, human);
    this.events = [];
  }

  get cur() { return this.members[this.member]; }
  get cnt() { return this.counters[this.member]; }
  emit(type, extra) { this.events.push({ type, team: this.team.index, ...extra }); }

  endFull() {
    this.gaugeFull = false;
    this.gaugeT = 0;
    this.gauge = 0;
    this.cur.st = 10;
    this.emit("fullEnd");
  }

  recover() {
    const fr = this.frames;
    this.members.forEach((m, i) => {
      if (fr !== 0 && m.st < m.max) {
        if (i === this.member) { if (fr % 60 === 0) m.st += 8; } else if (fr % 30 === 0) m.st += 5;
        if (m.st > m.max) m.st = m.max;
      }
    });
    this.frames++;
  }

  updateGauge() {
    if (this.mode === SWITCHING || this.mode === NEW_STACK) return;
    if (this.gaugeFull) {
      this.gaugeT++;
      if (this.gaugeT >= FULL_FRAMES) this.endFull();
    } else if (this.gauge > 0) {
      this.gaugeT++;
      if (this.gaugeT >= 2) { this.gaugeT = 0; this.gauge--; }
    }
  }

  addGauge(amount) {
    this.gauge = Math.min(100, this.gauge + amount);
    if (this.gauge >= 100) { this.gaugeFull = true; this.gaugeT = 0; this.emit("full"); }
  }

  startSwitch() {
    this.gauge = Math.max(0, Math.min(100, this.gauge - 10));
    this.member = (this.member + 1) % 3;
    this.mode = SWITCHING;
    this.modeFrames = 0;
    this.cnt.switched++;
    this.emit("switch", { member: this.member });
  }
}

export class HumanSide extends Side {
  constructor(team, rng) { super(team, rng, true); }

  canHit() { return this.board.hittable && (this.mode === READY || (this.mode === HIT && this.modeFrames >= 2)); }
  canSwitch() { return this.mode === READY || this.mode === HIT; }

  /** One frame of timers; call before the frame's inputs. */
  step() {
    this.board.step();
    if (this.mode === HIT) { this.modeFrames++; if (this.modeFrames >= HIT_FRAMES) { this.mode = READY; this.modeFrames = 0; } }
    else if (this.mode === SWITCHING) { this.modeFrames++; if (this.modeFrames >= SWITCH_FRAMES) { this.mode = READY; this.modeFrames = 0; } }
    else if (this.mode === EXHAUSTED && this.cur.st >= 8) { this.mode = READY; this.modeFrames = 0; }
    this.updateGauge();
    this.recover();
  }

  /** A fresh touch at DS point (x, y). Returns the effect or null when it did nothing. */
  tap(x, y, tol = 1) {
    if (!this.canHit()) return null;
    const b = this.board;
    const top = b.topPos();
    if (!onBlock(x, y, top.x, top.y)) return null;
    const sp = b.spotPos();
    const spot = !!sp && onSpot(x, y, sp.x, sp.y, this.cur.kind, tol);
    let power = this.cur.power;
    const strong = this.gaugeFull;
    if (strong) power += FULL_BONUS; else if (spot) power += SPOT_BONUS;
    const brokenAt = b.top;
    const broken = b.damage(power);
    this.score = Math.min(200, this.score + broken);
    this.cnt.points += broken;
    this.cnt.hit++;
    const out = { power, spot, strong, broken, x, y, block: brokenAt };
    // OnHit
    if (this.mode === HIT) {
      this.cur.st -= COST[Math.min(9, this.modeFrames)];
      if (this.cur.st <= 0) {
        this.cur.st = 0;
        this.mode = EXHAUSTED;
        this.frames = 0;
        this.cnt.failed++;
        out.exhausted = true;
        this.emit("exhaust");
        this.emit("hit", out);
        return out;
      }
    }
    if (!this.gaugeFull && !strong) { if (spot) this.addGauge(30); }
    this.mode = HIT;
    this.modeFrames = 0;
    this.emit("hit", out);
    return out;
  }

  /** The swipe / button / wheel. Returns true when the swap started. */
  switchNow() {
    if (!this.canSwitch()) return false;
    if (this.gaugeFull) this.endFull();
    this.startSwitch();
    return true;
  }
}

export class CpuSide extends Side {
  constructor(team, rng) {
    super(team, rng, false);
    this.wait = 0;
    this.since = 0;
    this.recent = false;
    this.mf = 0;
    this.blockHealth = 100;
  }

  setMode(mode) {
    if (mode === SWITCHING) { this.gauge = Math.max(0, Math.min(100, this.gauge - 10)); this.member = (this.member + 1) % 3; this.cnt.switched++; this.emit("switch", { member: this.member }); }
    else if (mode === EXHAUSTED) this.frames = 0;
    this.mode = mode;
    this.mf = 0;
  }

  roll() { return Math.floor(this.rng() * 100); }

  decideSwitch() {
    const roll = this.roll();
    let ch = 0;
    const st = this.cur.st;
    for (let i = 0; i < 5; i++) if (st < SW_ST_T[i]) { ch += SW_ST_C[i]; break; }
    for (let i = 0; i < 3; i++) if (this.gauge >= SW_G_T[i]) { ch += SW_G_C[i]; break; }
    return roll < ch;
  }

  decideAgain() {
    const roll = this.roll();
    let ch = 0;
    const st = this.cur.st;
    for (let i = 0; i < 5; i++) if (st >= HA_S_T[i]) { ch += HA_S_C[i]; break; }
    for (let i = 0; i < 4; i++) if (this.gauge >= HA_G_T[i]) { ch += HA_G_C[i]; break; }
    return roll < ch;
  }

  hit(spot) {
    const m = this.cur;
    let power = m.power + (spot ? SPOT_BONUS : 0);
    let broken = 0;
    for (;;) {
      this.blockHealth -= power;
      if (this.blockHealth > 0) break;
      power = -this.blockHealth;
      this.blockHealth = 100;
      broken++;
    }
    this.score = Math.min(200, this.score + broken);
    this.cnt.points += broken;
    this.cnt.hit++;
    const cleared = broken > 0 && this.score % STACK === 0;
    this.board.syncCpu(this.score, this.blockHealth, cleared);
    this.emit("hit", { power: m.power + (spot ? SPOT_BONUS : 0), spot, strong: false, broken });
    if (!this.gaugeFull) {
      if (this.recent) {
        m.st = Math.max(0, m.st - COST[Math.min(this.since, 9)]);
        if (m.st === 0) { this.cnt.failed++; this.setMode(EXHAUSTED); return; }
      }
      if (spot) this.addGauge(30);
    }
    if (cleared) this.setMode(NEW_STACK);
    this.recent = true;
    this.since = 0;
  }

  step() {
    this.board.step();
    if (this.mode === READY) {
      this.mf++;
      if (this.mf >= this.wait) {
        if (this.decideSwitch()) { if (this.gaugeFull) this.endFull(); this.setMode(SWITCHING); }
        else {
          const spot = this.roll() < SPOT_CHANCE[this.cur.kind];
          if (this.recent) { if (this.since >= 2 && this.decideAgain()) this.hit(spot); } else this.hit(spot);
        }
        this.mf = 0;
        this.wait = Math.floor(this.rng() * 3) + 4;
      }
      if (this.recent) { this.since++; if (this.since >= HIT_FRAMES) { this.since = 0; this.recent = false; } }
    } else if (this.mode === SWITCHING) {
      this.mf++;
      if (this.mf >= SWITCH_FRAMES) this.setMode(READY);
    } else if (this.mode === EXHAUSTED) {
      if (this.cur.st >= 8) this.setMode(READY);
    } else if (this.mode === NEW_STACK) {
      this.mf++;
      if (this.mf >= 42) this.setMode(READY);
    }
    this.updateGauge();
    this.recover();
  }
}

export class Match {
  /** humanTeam: the team a person plays (-1 = none), or humanTeams for several people (a room with friends). */
  constructor({ teams, rng, humanTeam = -1, humanTeams = null }) {
    this.teams = teams;
    this.rng = rng;
    const humans = humanTeams || (humanTeam >= 0 ? [humanTeam] : []);
    this.humanTeam = humans.length ? humans[0] : -1;
    this.frame = 0;
    this.over = false;
    this.sides = teams.map((t, i) => (humans.includes(i) ? new HumanSide(t, rng) : new CpuSide(t, rng)));
    this.events = [];
  }

  /** The CPU takes over a team a person left: it goes on from the same score, stack, energy and gauge. */
  takeOver(team) {
    const old = this.sides[team];
    if (!old || !old.human) return;
    const cpu = new CpuSide(this.teams[team], this.rng);
    cpu.members = old.members;
    cpu.counters = old.counters;
    cpu.member = old.member;
    cpu.score = old.score;
    cpu.gauge = old.gauge;
    cpu.gaugeFull = old.gaugeFull;
    cpu.gaugeT = old.gaugeT;
    cpu.frames = old.frames;
    cpu.board = old.board;
    const b = old.board;
    cpu.blockHealth = b.count > 0 ? b.health[b.top] : 100;
    cpu.mode = old.mode === SWITCHING ? SWITCHING : old.mode === EXHAUSTED ? EXHAUSTED : b.state !== "ready" ? NEW_STACK : READY;
    cpu.mf = 0;
    cpu.wait = 4;
    cpu.events = old.events;
    this.sides[team] = cpu;
    if (this.humanTeam === team) this.humanTeam = this.sides.findIndex((s) => s.human);
  }

  drain() {
    const out = [];
    for (const s of this.sides) { out.push(...s.events); s.events = []; }
    return out;
  }

  /** Advance one frame. The person's side runs its timers first, then `onInput` may call human.tap / human.switchNow, then the CPU sides. */
  step(onInput = null) {
    if (this.over) return;
    this.frame++;
    for (const s of this.sides) if (s.human) s.step();
    if (onInput) onInput();
    for (const s of this.sides) if (!s.human) s.step();
    if (this.frame >= TOTAL_FRAMES) this.over = true;
  }

  scoreOf(t) { return this.sides[t].score; }

  result() {
    const raw = this.sides.map((s) => Math.min(200, s.score));
    const detail = this.sides.map((s) => ({ mons: s.counters.map((c) => ({ ...c })) }));
    return { raw, detail };
  }
}
