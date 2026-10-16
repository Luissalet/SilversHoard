// Lamp Jump (Botaluces), the rules: pokeathlon_lamp_jump*.c of the HeartGold decompilation as written up in SPEC section 4, event 5.
// Pure simulation (no drawing, no DOM): 30 steps per second, the two DS screens stacked (global y 0..383, the trampoline's rest line at
// y = 288), heights in 1/64 px and velocities in 1/64 px per step, all of them integers exactly as the game keeps them.
// Only the person's team is played; the other three scores are a formula (SPEC) shown as a rising scoreboard.
import { clamp, dist } from "../_kit5/util.js";

export const FRAMES = 1800;
export const REST_Y = 288;
export const COLUMNS = 128;                       // the cloth: 128 columns of 2 px
export const TOUCH_RADIUS = 80;
export const MON_RADIUS = 8;
export const LAMP_RADIUS = 8;
export const BODY_LIFT = 8;                       // the collision circle sits this far above the feet
export const MAX_DENT = -6144;                    // 96 px
export const HOLD_FRAMES = 7;                     // the launch happens on the next held step, so 8 steps after the press
export const FLICK_MAX = 112;
export const MAX_VX = 10;                         // px/step before the Skill scale

// table a/1/7/0 member 6 by raw stat 0..4
export const BOUNCE = [0, 9, 10, 11, 13];         // /12, by Jump (0 cannot jump at all)
export const STUN = [50, 30, 20, 15, 10];         // steps stunned after a collision, by Stamina
export const FLICK_SCALE = [4, 6, 8, 9, 12];      // /12 on the sideways speed, by Skill

// 29 lamps, in units of 8 px: [x, y]
const LAMP_ROWS = [[8, [16]], [11, [4, 12, 20, 28]], [14, [8, 16, 24]], [17, [4, 12, 20, 28]], [20, [8, 16, 24]], [23, [4, 12, 20, 28]],
  [25, [8, 16, 24]], [28, [4, 12, 20, 28]], [31, [8, 16, 24]]];
export const LAMPS = LAMP_ROWS.flatMap(([y, xs]) => xs.map((x) => [x * 8, y * 8]));

const PARTS = [6, 5, 3];                          // which two (dent, line) pairs a Pokémon's own jump sees: all but its own

const tdiv = (a, b) => Math.trunc(a / b);

class Mon {
  constructor(i, stats) {
    this.i = i;
    this.stats = stats;                           // raw 0-4: { jump, stamina, skill }
    this.bounce = BOUNCE[stats.jump];
    this.stunFrames = STUN[stats.stamina];
    this.flickScale = FLICK_SCALE[stats.skill];
    this.x = 64 + 64 * i; this.drawX = this.x; this.col = Math.floor(this.x / 2);
    this.vxFx = 0;                                // sideways speed in 1/4096 px per step
    this.height = 0; this.velocity = 0; this.launchV = 0;
    this.airborne = false; this.jumping = false; this.first = true;
    this.combo = 0; this.score = 0;
    this.stunTimer = 0; this.stunned = false;
    this.colliding = [false, false, false];
    this.c = { failed: 0, jumped: 0, points: 0, hit: 0, fell: 0, dashed: 0, switched: 0, selfImpeded: 0 };
    this.px = this.x; this.pheight = 0;
  }
  get vx() { return this.vxFx / 4096; }
  /** where the feet are, in global px */
  get gy() { return REST_Y - this.height / 64; }
  get cy() { return this.gy - BODY_LIFT; }
  snap() { this.px = this.drawX; this.pheight = this.height; }
}

export class LampJumpSim {
  /**
   * @param o.stats   3 stat objects ({ jump, stamina, skill } raw 0-4) of the team that is played
   * @param o.rand    makeRand(ctx.rng)
   * @param o.score   false for a demo (nobody's score depends on it)
   */
  constructor(o) {
    this.rand = o.rand;
    this.mons = o.stats.map((s, i) => new Mon(i, s));
    this.timer = FRAMES;
    this.seconds = 60;
    this.lit = new Array(29).fill(false);
    this.relight = 0;
    this.dents = [0, 1, 2].map(() => new Int32Array(COLUMNS));
    this.lines = [0, 1, 2].map(() => new Int32Array(COLUMNS));
    this.surface = new Int32Array(COLUMNS);
    this.selected = 3; this.holdFrames = 0; this.touchStart = [0, 0];
    this.hitLamp = false;
    this.events = [];                             // what happened in the last step, for the view
    this.steps = 0;
  }

  get over() { return this.timer <= 0; }
  get total() { return Math.min(999, this.mons.reduce((s, m) => s + m.score, 0)); }

  // ------------------------------------------------------------------------------------------------------------- step
  /**
   * cmd.touch: { touchNew, touching, x, y } the pointer in global px (y 0..383) as the DS gives it (integers);
   * cmd.launch: { slot, fx, fy } a launch with a flick vector in px (keyboard / pad), the same maths as a drag.
   */
  step(cmd = {}) {
    this.events.length = 0;
    this.hitLamp = false;
    for (const m of this.mons) m.snap();
    this.handleTouch(cmd.touch);
    if (cmd.launch) this.launchMon(cmd.launch.slot, cmd.launch.fx, cmd.launch.fy);
    if (this.timer > 0) this.timer--;
    this.seconds = Math.ceil(this.timer / 30);
    if (this.timer <= 0) return;
    this.steps++;
    this.updateJumps();
    this.calcSurface();
    this.setRestingHeights();
    this.collideMons();
    this.updateLamps();
    this.updateColumns();
  }

  // ------------------------------------------------------------------------------------------------------------- touch
  findTouched(x, y) {
    let best = 3, bd = TOUCH_RADIUS;
    for (let i = 0; i < 3; i++) {
      const m = this.mons[i];
      if (m.stunned) continue;
      const d = dist(x, y, m.x, m.cy);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  flick(x, y) {
    const fx = x - this.touchStart[0];
    const fy = Math.min(y - this.touchStart[1], FLICK_MAX);
    return [fx, fy];
  }

  handleTouch(t) {
    if (!t) return;
    if (t.touchNew) {
      const s = this.findTouched(t.x, t.y);
      if (s < 3) { this.selected = s; this.touchStart = [t.x, t.y]; this.holdFrames = 0; }
    } else if (t.touching) {
      if (this.selected < 3) {
        if (this.holdFrames < HOLD_FRAMES) this.holdFrames++;
        else {
          const [fx, fy] = this.flick(t.x, t.y);
          this.launchMon(this.selected, fx, fy);
          this.selected = 3; this.holdFrames = 0;
        }
      }
    } else {
      // (the game lets go one step early: releasing after exactly 7 held steps launched nothing; here it launches)
      if (this.selected < 3 && this.holdFrames <= HOLD_FRAMES) {
        const [fx, fy] = this.flick(t.x, t.y);
        this.launchMon(this.selected, fx, fy);
      }
      this.selected = 3; this.holdFrames = 0;
    }
  }

  /** a drag of (fx, fy) px: it must go down (fy > 0); the Pokémon flies away from the drag */
  launchMon(slot, fx, fy) {
    const m = this.mons[slot];
    if (!m || !(fy > 0) || m.jumping) return false;
    fy = Math.min(fy, FLICK_MAX);
    const v = tdiv(fy * 64, 2.5);
    let vx = tdiv(-fx * 4096, 4);
    vx = clamp(vx, -MAX_VX * 4096, MAX_VX * 4096);
    m.vxFx = tdiv(vx * m.flickScale, 12);
    m.velocity = -v; m.launchV = -v;
    m.jumping = true;
    this.events.push({ type: "launch", mon: slot, power: fy / FLICK_MAX });
    return true;
  }

  // ------------------------------------------------------------------------------------------------------------- cloth
  setDent(mon, column, depth) {
    const d = this.dents[mon];
    d.fill(0);
    d[column] = depth;
    // a tent: straight lines from both edges down to the depth (integer division truncates toward zero)
    const negDepth = -depth, right = COLUMNS - 1 - column;
    for (let i = 0; i < column; i++) d[i] = -tdiv(negDepth * (i + 1), column + 1);
    for (let i = 0; i < right; i++) d[column + 1 + i] = -tdiv((right - i) * negDepth, right + 1);
  }

  calcLine(line, a, b) {
    const ca = this.mons[a].col, cb = this.mons[b].col;
    const [l, r] = ca <= cb ? [a, b] : [b, a];
    const lc = this.mons[l].col, rc = this.mons[r].col;
    const out = this.lines[line];
    out.fill(0);
    const start = this.dents[l][lc];
    const delta = this.dents[r][rc] - start;
    const span = rc - lc;
    for (let i = 0; i < span - 1; i++) out[lc + i + 1] = start + tdiv(delta * (i + 1), span);
  }

  calcSurface() {
    this.calcLine(0, 0, 1);
    this.calcLine(1, 1, 2);
    this.calcLine(2, 2, 0);
    for (let i = 0; i < COLUMNS; i++) {
      let s = this.dents[0][i];
      for (let k = 1; k < 3; k++) if (s > this.dents[k][i]) s = this.dents[k][i];
      for (let k = 0; k < 3; k++) if (s > this.lines[k][i]) s = this.lines[k][i];
      this.surface[i] = s;
    }
  }

  /** the cloth at one column without the dent (and the line) of the Pokémon that is not in `parts` */
  partial(parts, col) {
    let h = 0;
    for (let k = 0; k < 3; k++) {
      if (!(parts & (1 << k))) continue;
      if (h > this.dents[k][col]) h = this.dents[k][col];
      if (h > this.lines[k][col]) h = this.lines[k][col];
    }
    return h;
  }

  setRestingHeights() {
    for (const m of this.mons) if (!m.jumping) m.height = this.surface[m.col];
  }

  // ------------------------------------------------------------------------------------------------------------- jumps
  updateJumps() {
    for (let i = 0; i < 3; i++) this.updateJump(i);
    for (let i = 0; i < 3; i++) {
      const m = this.mons[i];
      const cx = m.x, cy = m.cy;
      for (let l = 0; l < 29; l++) {
        if (!this.lit[l]) continue;
        const [lx, ly] = LAMPS[l];
        if (dist(cx, cy, lx, ly) > MON_RADIUS + LAMP_RADIUS) continue;
        this.lit[l] = false;
        if (m.combo < 5) m.combo++;
        m.score = Math.min(999, m.score + m.combo);
        m.c.points++;
        this.hitLamp = true;
        this.events.push({ type: "lamp", mon: i, lamp: l, points: m.combo, x: lx, y: ly });
      }
    }
    for (const m of this.mons) {
      if (m.stunned && --m.stunTimer <= 0) { m.stunTimer = 0; m.stunned = false; }
    }
  }

  updateJump(i) {
    const m = this.mons[i];
    if (!m.jumping) return;
    const col = m.col;
    const H = this.partial(PARTS[i], col);
    const rest = () => { m.airborne = false; m.height = H; m.launchV = 0; m.jumping = false; m.velocity = 0; this.setDent(i, col, 0); };
    if (m.airborne) {
      if (m.launchV <= 0) { rest(); m.first = true; return; }
      m.height += m.velocity;
      if (m.vxFx) this.moveSideways(m);
      if (m.height > H) {
        m.velocity = Math.trunc(m.velocity - 128);
        if (-m.velocity > m.launchV) m.velocity = -m.launchV;
      } else {
        if (m.velocity === 0) rest();
        else if (m.velocity < 0) {
          m.airborne = false;
          this.slowDownSideways(m);
          if (m.velocity > -128) m.velocity = -128;
          m.launchV = m.velocity;
          this.events.push({ type: "land", mon: i, speed: -m.velocity });
        } else rest();
      }
    } else {
      m.height += m.velocity;
      if (m.height < MAX_DENT) { m.height = MAX_DENT; m.velocity = 0; }
      if (m.height >= H) {
        // back at the cloth: it throws the Pokémon up
        this.setDent(i, col, 0);
        if (m.first) m.velocity = tdiv(m.bounce * m.velocity, 12);
        if (m.velocity > 2200) m.velocity = 2200;
        m.velocity = tdiv(m.velocity * 9, 10);
        if (m.velocity === 0) rest();
        else if (m.velocity > 0) {
          if (m.velocity <= 1408 && !m.first) rest();
          else {
            m.airborne = true; m.launchV = m.velocity; m.first = false;
            m.c.jumped++;
            this.events.push({ type: "takeoff", mon: i, speed: m.velocity });
          }
        }
      } else if (m.height < H) {
        if (m.velocity < 0) {
          m.velocity = Math.trunc(m.velocity + 819.2);
          if (m.velocity >= 0) m.velocity = 0;
        } else {
          m.velocity = Math.trunc(m.velocity + 341.3333333333333);
          if (m.launchV >= 0) { rest(); return; }
          if (m.velocity > -m.launchV) m.velocity = -m.launchV;
        }
      }
    }
    if (!m.airborne || !m.jumping || !m.velocity) m.combo = 0;
    if (!m.airborne && m.jumping) this.setDent(i, col, m.height);
    if (!m.jumping) m.first = true;
  }

  moveSideways(m) {
    if (m.height > 0) m.x = clamp(m.drawX + m.vx, 32, 223);
  }

  slowDownSideways(m) {
    if (m.vxFx > 0) m.vxFx = Math.max(0, m.vxFx - 2 * 4096);
    else if (m.vxFx < 0) m.vxFx = Math.min(0, m.vxFx + 2 * 4096);
  }

  /** the display update of the game: the columns the cloth maths use next step come from where the Pokémon are drawn */
  updateColumns() {
    for (const m of this.mons) {
      m.drawX = clamp(m.x, 32, 223);
      m.col = Math.floor(m.drawX / 2);
    }
  }

  // ------------------------------------------------------------------------------------------------------------- collisions
  collideMons() {
    const ms = this.mons;
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        if (i === j) continue;
        const a = ms[i], b = ms[j];
        if (dist(a.x, a.cy, b.x, b.cy) > 2 * MON_RADIUS) { a.colliding[j] = false; b.colliding[i] = false; continue; }
        if (b.colliding[i]) continue;
        a.stunned = b.stunned = true;
        a.stunTimer = a.stunFrames; b.stunTimer = b.stunFrames;
        a.c.hit++; b.c.hit++; a.c.failed++; b.c.failed++;
        this.events.push({ type: "clash", a: i, b: j, x: (a.x + b.x) / 2, y: (a.cy + b.cy) / 2, air: a.airborne && b.airborne });
        if (a.airborne && b.airborne && a.height > 0 && b.height > 0) {
          if (a.colliding[j] || b.colliding[i]) continue;
          a.colliding[j] = true; b.colliding[i] = true;
          [a.velocity, b.velocity] = [b.velocity, a.velocity];
          [a.vxFx, b.vxFx] = [b.vxFx, a.vxFx];
          if (a.velocity < 0) a.velocity = 0;
          if (b.velocity < 0) b.velocity = 0;
        } else {
          if (a.x <= b.x) { a.x -= 16; b.x += 16; } else { a.x += 16; b.x -= 16; }
          a.x = clamp(a.x, 32, 223); b.x = clamp(b.x, 32, 223);
        }
      }
    }
  }

  // ------------------------------------------------------------------------------------------------------------- lamps
  updateLamps() {
    if (this.relight === 0) { this.lightLamps(); this.relight = 240; } else this.relight--;
  }

  lightLamps() {
    const out = [];
    for (let i = 0; i < 29; i++) if (!this.lit[i]) out.push(i);
    for (let n = 0; n < 25 && out.length > 0; n++) {
      const k = this.rand.int(out.length);
      this.lit[out[k]] = true;
      out[k] = out[out.length - 1];
      out.pop();
    }
    this.events.push({ type: "relight" });
  }

  result() {
    return this.mons.map((m) => ({ ...m.c, score: m.score }));
  }
}

/** The three scores of a team the game does not play: 2 Stamina + 6 Jump + 2 Skill + 80 + a random 0-20 for each member that can jump. */
export function cpuTeamScore(stats, rand) {
  const mons = stats.map((s) => {
    const score = s.jump > 0 ? 2 * s.stamina + 6 * s.jump + 2 * s.skill + 80 + rand.int(21) : 0;
    const noise = rand.int(21);
    return { score, noise };
  });
  return { total: Math.min(999, mons.reduce((t, m) => t + m.score, 0)), mons };
}
