// Goal Roll (Metegoles), the rules: pokeathlon_goal_roll*.c as written up in SPEC section 4, event 9.
// Pure simulation (no drawing, no DOM): 30 steps per second, positions in DS touch-screen pixels (256 x 192) in the game's "centre space"
// (a Pokémon's collision circle is 5 px below its position). Four teams of three Pokémon share one field with a goal in each corner and
// push one ball around (a second one for the last 30 s). Stats are raw 0-4 = stars - 1.
import { clamp, norm } from "../_kit5/util.js";

export const FRAMES = 2700;
export const TOUCH_RADIUS = 80;
export const MON_RADIUS = 8;
export const DASH_HOLD = 8;                  // a touch this short (or shorter) that ends away from the Pokémon is a dash
export const SECOND_BALL_AT = 900;           // the clock reads this or less: the second ball appears

const MAX_POWER = [45, 60, 80, 100, 120];    // by Stamina
const WALK = [2.8, 3.0, 3.2, 3.4, 3.6];      // by Speed (px per step)
const DASH = [3.2, 3.4, 3.6, 3.8, 4.0];      // by Speed
const KICK_POWER = [20, 25, 30, 40, 50];     // by Power: power taken from a Pokémon a kicked ball hits
const KICK_LEVEL = [7, 7, 6, 5, 4];          // by Power: a kicked ball this fast or faster hurts
const pad = (a, n) => a.concat(new Array(n - a.length).fill(0));
// ball speed curves (px per step after contact), one row per Skill raw
export const KICK = [
  pad([7, 7, 6, 5, 5, 5, 5, 4, 4, 4, 4, 4, 4, 4, 4, 3, 3, 3, 2, 2, 1], 30),
  pad([7, 7, 6, 6, 5, 5, 5, 5, 5, 5, 5, 4, 4, 4, 4, 4, 3, 3, 3, 2, 2, 1], 30),
  pad([7, 7, 6, 6, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 4, 4, 4, 4, 3, 3, 2, 2, 1], 30),
  pad([7, 7, 7, 7, 6, 6, 6, 6, 6, 6, 5, 5, 5, 5, 5, 4, 4, 4, 4, 4, 3, 3, 3, 2, 2, 1], 30),
  [7, 7, 7, 7, 7, 7, 7, 6, 6, 6, 6, 6, 6, 6, 5, 5, 5, 5, 5, 4, 4, 4, 4, 4, 3, 3, 3, 2, 2, 1],
];
export const NUDGE = [
  pad([5, 5, 5, 4, 4, 4, 4, 3, 3, 3, 3, 2, 2, 1, 1], 30), pad([5, 5, 5, 4, 4, 4, 4, 3, 3, 3, 3, 2, 2, 1, 1], 30), pad([5, 5, 5, 4, 4, 4, 4, 3, 3, 3, 3, 2, 2, 1, 1], 30),
  pad([4, 4, 4, 3, 3, 3, 2, 2, 1, 1], 30), pad([4, 4, 4, 3, 3, 3, 2, 2, 1, 1], 30),
];
export const START = [[[88, 80], [48, 80], [72, 56]], [[168, 80], [208, 80], [184, 56]], [[88, 128], [48, 128], [72, 152]], [[168, 128], [208, 128], [184, 152]]];
export const SPAWN = [];
for (const y of [88, 104, 120]) for (const x of [80, 104, 128, 152, 176]) SPAWN.push([x, y]);
export const POSTS = [[64, 24], [8, 80], [192, 24], [248, 80], [64, 184], [8, 128], [192, 184], [248, 128]];
// where a CPU team's guard stands (three points per corner): the original's table lacks the top-left corner, mirrored here
const GUARD = [[[48, 64], [72, 48], [32, 88]], [[208, 64], [184, 48], [224, 88]], [[48, 144], [72, 160], [32, 120]], [[208, 144], [184, 160], [224, 120]]];

export const MODE = { WALK: 0, DASH: 1, STUNNED: 2, TIRED: 3 };
export const STATE = { ROLLING: 0, SCORED: 1, KICKED: 2, WAITING: 3 };
const { WALK: M_WALK, DASH: M_DASH, STUNNED, TIRED } = MODE;
const { ROLLING, SCORED, KICKED, WAITING } = STATE;
const NOMON = 12;

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
/** 0 top-left, 1 top-right, 2 bottom-left, 3 bottom-right of the point p against (cx, cy) */
const quad = (p, cx, cy) => (p[0] < cx ? 0 : 1) + (p[1] < cy ? 0 : 2);
/** the quadrant of p seen from the origin o */
const rel = (o, p) => (p[0] < o[0] ? 0 : 1) + (p[1] < o[1] ? 0 : 2);

/**
 * Keep a circle of radius r inside the field. Straight walls stop it where its path crosses them; the four corner triangles are
 * walls for Pokémon only. Returns { code: 0 none, 1 left, 2 right, 3 top, 4 bottom, 5-8 corners, x, y }.
 */
export function wallPush(x, y, px, py, r, corners) {
  const left = r + 8, right = 247 - r, top = r + 16, bottom = 183 - r;
  let code = 0;
  if (corners) {
    const k = r * Math.SQRT2;
    const q = (x >= 128 ? 1 : 0) + (y >= 112 ? 2 : 0);
    // inside the near side of the diagonal: f(p) >= 0
    const f = [(a, b) => a + b - (80 + k), (a, b) => 176 - k - (a - b), (a, b) => 128 - k - (b - a), (a, b) => 384 - k - (a + b)][q];
    const fn = f(x, y);
    if (fn < 0) {
      const fp = f(px, py);
      if (fp >= 0) { const t = fp / (fp - fn); x = px + (x - px) * t; y = py + (y - py) * t; } else { x = px; y = py; }
      code = 5 + q;
    }
  }
  const edges = [[x < left, 0, left, 1], [x > right, 0, right, 2], [y < top, 1, top, 3], [y > bottom, 1, bottom, 4]];
  for (const [cond, axis, val, cd] of edges) {
    if (!cond) continue;
    const den = axis === 0 ? px - x : py - y;
    const tt = den !== 0 ? clamp(((axis === 0 ? px : py) - val) / den, 0, 1) : 0;
    x = px + (x - px) * tt; y = py + (y - py) * tt;
    if (axis === 0) x = val; else y = val;
    code = cd;
  }
  return { code, x, y };
}

class Mon {
  constructor(i, st) {
    this.i = i; this.team = Math.floor(i / 3); this.slot = i % 3;
    this.walk = WALK[st.speed]; this.dash = DASH[st.speed];
    this.maxPower = MAX_POWER[st.stamina]; this.power = this.maxPower;
    this.kickPower = KICK_POWER[st.power]; this.row = st.skill; this.level = st.power;
    const [gx, gy] = START[this.team][this.slot];
    this.pos = [gx, gy - 10]; this.ppos = this.pos.slice(); this.target = this.pos.slice();
    this.mode = M_WALK; this.motion = 0; this.mf = 0; this.mw = 0; this.step = [0, 0]; this.stun = 0; this.rec = 0; this.dir = [0, 0];
    this.facing = this.team % 2 ? [-1, 0] : [1, 0];
    this.c = { failed: 0, jumped: 0, points: 0, hit: 0, fell: 0, dashed: 0, switched: 0, selfImpeded: 0 };
  }
  get cc() { return [this.pos[0], this.pos[1] + 5]; }
}

class Ball {
  constructor(i) {
    this.i = i;
    this.kind = 0; this.state = WAITING; this.pos = [128, 104]; this.ppos = [128, 104]; this.vel = [0, 0]; this.dir = [0, 0];
    this.touch = new Array(12).fill(false); this.timer = 0; this.last = NOMON; this.step = 0; this.steps = 0; this.table = 0; this.speed = 0;
    this.row = 0; this.spawn = 7; this.wait = 0; this.strength = 0; this.level = 0; this.bounced = false; this.roll = 0;
  }
  reset() {
    this.vel = [0, 0]; this.dir = [0, 0]; this.kind = 0; this.state = WAITING; this.timer = 0; this.last = NOMON; this.step = 0; this.steps = 0;
    this.table = 0; this.speed = 0; this.row = 0; this.wait = 0; this.strength = 0; this.level = 0; this.touch.fill(false);
  }
  get radius() { return this.kind === 2 ? 12 : 8; }
  get inPlay() { return this.kind !== 0 && (this.state === ROLLING || this.state === KICKED); }
  setDir(d) { this.dir = norm(d[0], d[1]); this.vel = [this.dir[0] * this.speed, this.dir[1] * this.speed]; }
}

export class GoalRollSim {
  /**
   * @param o.stats  4 teams x 3 members of { power, speed, stamina, skill } raw 0-4
   * @param o.rand   makeRand(ctx.rng)
   * @param o.human  team a person plays, or -1
   * @param o.humans several people (a room with friends): the teams they play; wins over o.human
   */
  constructor(o) {
    this.rand = o.rand;
    const people = o.humans ?? (o.human >= 0 ? [o.human] : []);
    this.humans = new Set(people);
    this.human = people.length ? people[0] : -1;      // the first person (the only one in a single-player event)
    this.mons = [];
    o.stats.forEach((team, t) => team.forEach((s, k) => this.mons.push(new Mon(t * 3 + k, s))));
    this.balls = [new Ball(0), new Ball(1)];
    for (const b of this.balls) { b.reset(); b.state = ROLLING; b.pos = [128, 104]; b.ppos = [128, 104]; b.spawn = 7; }
    this.balls[0].kind = 1;
    this.scores = [0, 0, 0, 0];
    this.timer = FRAMES;
    this.steps = 0;
    this.misses = 0;
    this.events = [];
    this.cpuTeams = [0, 1, 2, 3].filter((t) => !this.humans.has(t));
    this.cpu = { timer: 3, run: false, cur: 0, slot: 0 };
    this.order = [0, 1, 2, 3].map((t) => this.roles(t));
    this.wait = [0, 1, 2, 3].map(() => [0, 0, 0]);
    this.fingers = new Map(people.map((t) => [t, { held: -1, holdFrames: 0, touchDown: false, touchLast: [0, 0] }]));   // each person's finger
  }

  get over() { return this.timer <= 0; }
  /** a person's finger: the Pokémon held and for how many steps (what the view draws) */
  fingerOf(team) { return this.fingers.get(team) || { held: -1, holdFrames: 0, touchDown: false, touchLast: [0, 0] }; }
  get held() { return this.fingerOf(this.human).held; }
  get holdFrames() { return this.fingerOf(this.human).holdFrames; }

  /** The CPU takes a person's team over (they left the room). */
  takeOver(team) {
    if (!this.humans.has(team)) return;
    this.humans.delete(team);
    this.fingers.delete(team);
    this.human = this.humans.size ? [...this.humans][0] : -1;
    this.cpuTeams = [0, 1, 2, 3].filter((t) => !this.humans.has(t));
    if (this.cpu.cur >= this.cpuTeams.length) this.cpu.cur = 0;
  }
  get seconds() { return Math.ceil(this.timer / 30); }

  // ------------------------------------------------------------------------------------------------------------- the step
  /** cmd.touch: { down, x, y } the person's finger in px; cmd.keys: [{ type: "walk" | "dash", slot, target: [x, y] }] */
  step(cmd = {}, cmds = null) {
    const by = cmds || (this.human >= 0 ? { [this.human]: cmd } : {});
    this.events.length = 0;
    if (this.timer <= 0) return;
    this.steps++;
    this.timer--;
    for (const m of this.mons) m.ppos = m.pos.slice();
    for (const b of this.balls) b.ppos = b.pos.slice();
    for (const team of this.humans) {
      const c = by[team];
      if (!c) continue;
      if (c.touch) this.touchInput(c.touch, team);
      if (c.keys) for (const k of c.keys) this.keyInput(k, team);
    }
    this.cpuUpdate();
    this.moveMons();
    this.moveBalls();
    this.collide();
    this.goals();
    this.tiredMons();
  }

  // ------------------------------------------------------------------------------------------------------------- the person
  canPick(m) { return m.mode !== STUNNED && m.mode !== M_DASH && m.motion === 0; }

  touchInput(tc, team = this.human) {
    const f = this.fingers.get(team);
    if (tc.down) {
      if (!f.touchDown) {
        f.touchDown = true;
        // press: the nearest of my Pokémon within the touch radius that can be moved
        let best = -1, bd = TOUCH_RADIUS + 1;
        for (let k = 0; k < 3; k++) {
          const m = this.mons[team * 3 + k];
          if (!this.canPick(m)) continue;
          const d = Math.hypot(m.pos[0] - tc.x, m.pos[1] - tc.y);
          if (d <= TOUCH_RADIUS && d < bd) { bd = d; best = m.i; }
        }
        f.held = best; f.holdFrames = 0;
      } else if (f.held >= 0) {
        f.holdFrames = Math.min(20, f.holdFrames + 1);
        const m = this.mons[f.held];
        if (this.canPick(m) || m.mode === M_DASH) { /* the target follows the finger */ }
        if (m.mode !== STUNNED && m.motion === 0 && m.mode !== M_DASH) m.target = [tc.x, tc.y];
      }
      f.touchLast = [tc.x, tc.y];
    } else if (f.touchDown) {
      f.touchDown = false;
      if (f.held >= 0) {
        const m = this.mons[f.held];
        if (m.mode !== TIRED && m.mode !== STUNNED && m.motion === 0) {
          if (f.holdFrames <= DASH_HOLD && (m.target[0] !== m.pos[0] || m.target[1] !== m.pos[1])) this.startDash(m);
          else m.mode = M_WALK;
        }
        f.held = -1;
      }
    }
  }

  keyInput(k, team = this.human) {
    const m = this.mons[team * 3 + k.slot];
    if (!m || m.mode === STUNNED || m.motion !== 0) return;
    if (k.type === "walk") {
      if (m.mode === M_DASH) return;
      m.target = [k.target[0], k.target[1]];
    } else if (k.type === "dash") {
      if (m.mode === TIRED) return;
      m.target = [k.target[0], k.target[1]];
      this.startDash(m);
    }
  }

  startDash(m) {
    if (m.mode !== M_DASH) m.c.dashed++;
    m.mode = M_DASH;
    this.events.push({ type: "dash", mon: m.i });
  }

  // ------------------------------------------------------------------------------------------------------------- the CPU
  roles(t) {
    const m = [0, 1, 2].map((k) => this.mons[t * 3 + k]);
    const first = m.map((x) => x.row + x.maxPower), second = m.map((x) => x.row + x.level);
    let sel = 0;
    for (const i of [1, 2]) if (first[i - 1] < first[i]) sel = i;
    let a, b;
    if (sel === 0) [a, b] = second[1] >= second[2] ? [1, 2] : [2, 1];
    else if (sel === 1) [a, b] = second[0] >= second[2] ? [0, 2] : [2, 0];
    else [a, b] = second[0] >= second[1] ? [0, 1] : [1, 0];
    return [m[sel], m[a], m[b]];
  }

  cpuUpdate() {
    const c = this.cpu;
    if (!this.cpuTeams.length) return;
    c.timer++;
    if (c.timer >= 3) { c.run = true; c.timer = 0; }
    if (!c.run) return;
    const t = this.cpuTeams[c.cur], sl = c.slot;
    if (this.wait[t][sl] === 0) this.wait[t][sl] = this.think(t, sl);
    else this.wait[t][sl]--;
    c.cur++;
    if (c.cur >= this.cpuTeams.length) { c.cur = 0; c.slot = (c.slot + 1) % 3; c.run = false; }
  }

  think(t, role) {
    const mon = this.order[t][role];
    if (mon.mode || mon.motion) return 0;
    const q = quad(mon.pos, 128, 96);
    const balls = this.balls;
    const bq = (b) => (b.state === ROLLING && b.kind ? quad(b.pos, 128, 96) : 4);
    const touch = (b) => dist(mon.pos, b.pos) < 8 + b.radius;
    const intarget = (b) => rel(b.pos, mon.pos) === (t !== q ? 3 - q : t);
    const notOpp = (b) => (t === q ? 3 - t !== rel(b.pos, mon.pos) : false);
    if (role === 1) {
      const d = [0, 0];
      balls.forEach((b, i) => {
        const bb = bq(b);
        if (bb !== 4) d[i] = touch(b) ? 1 : q === bb ? (intarget(b) ? 4 : 3) : 2;
      });
      const i = d[0] >= d[1] ? 0 : 1;
      return this.chaser(mon, balls[i], d[i], q);
    }
    if (role === 0) {
      const d = [0, 0];
      balls.forEach((b, i) => {
        const bb = bq(b);
        d[i] = bb !== 4 ? (t === bb ? (notOpp(b) ? 7 : 6) : 6) : 5;
      });
      let i;
      if ((d[0] === 7) === (d[1] === 7)) i = dist(mon.pos, balls[0].pos) >= dist(mon.pos, balls[1].pos) ? 0 : 1;
      else i = d[0] >= d[1] ? 0 : 1;
      return this.guard(mon, balls[i], d[i], t);
    }
    const qs = balls.map(bq);
    const d = [8, 8];
    balls.forEach((b, i) => {
      if (qs[i] === 4) return;
      if (touch(b)) d[i] = 8;
      else if (q === qs[i] && intarget(b)) d[i] = 13;
    });
    if (d[0] === 13) return this.chaser(mon, balls[0], 13, q);
    if (d[1] === 13) return this.chaser(mon, balls[1], 13, q);
    if (this.order[t][0].power >= 50) return this.emptyQuadrant(mon, t);
    balls.forEach((b, i) => {
      d[i] = qs[i] !== 4 ? (t === qs[i] ? (intarget(b) ? 12 : 11) : 11) : 10;
    });
    const i = dist(mon.pos, balls[0].pos) >= dist(mon.pos, balls[1].pos) ? 0 : 1;
    if (d[i] === 10) return this.emptyQuadrant(mon, t);
    return this.guard(mon, balls[i], d[i], t);
  }

  chaser(mon, ball, dec, q) {
    const r = this.rand.int(100);
    if (dec === 2) {
      if (r < 60) return 0;
      mon.target = ball.pos.slice();
      if (r < 80) return 10;
      this.startDash(mon); return 10;
    }
    if (dec === 3) {
      if (r < 20) return 0;
      mon.target = ball.pos.slice();
      if (r < 90) return 3;
      this.startDash(mon); return 3;
    }
    if (dec === 4 || dec === 13) { mon.target = ball.pos.slice(); this.startDash(mon); return 0; }
    if (dec === 1 || dec === 9) mon.target = GUARD[3 - q][0].slice();
    return 0;
  }

  guard(mon, ball, dec, team) {
    const r = this.rand;
    if (dec === 6 || dec === 11) {
      const pts = GUARD[team];
      if (pts.some(([px, py]) => Math.abs(mon.pos[0] - px) <= 8 && Math.abs(mon.pos[1] - py) <= 8)) return 0;
      const p = r.int(2) === 0 ? pts[0] : r.int(2) === 0 ? pts[1] : pts[2];
      mon.target = [p[0] + 8 - r.int(17), p[1] + 8 - r.int(17)];
      return 6;
    }
    if (dec === 7 || dec === 12) {
      mon.target = ball.pos.slice();
      if (r.int(100) < 80) this.startDash(mon);
      return 10;
    }
    return 0;
  }

  emptyQuadrant(mon, t) {
    const counts = [0, 0, 0, 0];
    for (const m of this.mons) counts[quad(m.pos, 128, 96)]++;
    let ch = 0;
    for (let i = 1; i < 4; i++) if (counts[i - 1] > counts[i] && i !== t) ch = i;
    const x = this.rand.int(64), y = this.rand.int(32);
    mon.target = [ch === 0 || ch === 2 ? 128 - x : 128 + x, ch === 0 || ch === 1 ? 96 - y : 96 + y];
    return 10;
  }

  // ------------------------------------------------------------------------------------------------------------- Pokémon
  moveMons() {
    for (const m of this.mons) {
      m.dir = [0, 0];
      let [x, y] = m.pos;
      if (m.motion) {
        if ((m.motion === 2 || m.motion === 3) && m.mw > 0) m.mw--;
        if (m.mf === 0 && m.mw <= 0) { m.motion = 0; m.mw = 0; }
        else {
          x += m.mf * m.step[0]; y += m.mf * m.step[1];
          m.pos = [x, y]; m.target = [x, y];
          if (m.mf > 0) m.mf--;
        }
      }
      if (m.mode === STUNNED || m.stun) {
        m.stun = Math.max(0, m.stun - 1);
        if (m.stun === 0) { m.mode = M_WALK; m.power = m.maxPower; }
        continue;
      }
      if (m.motion) continue;
      const dx = m.target[0] - x, dy = m.target[1] - y;
      const d = Math.hypot(dx, dy);
      if (d <= 0) {
        m.rec++;
        if (m.rec >= 10) { m.rec = 0; m.power = Math.min(m.maxPower, m.power + 2); }
        continue;
      }
      m.dir = [dx / d, dy / d];
      m.facing = m.dir.slice();
      const lim = m.mode === M_DASH ? m.dash : m.mode === TIRED ? 2.0 : m.walk;
      if (d <= lim) { x = m.target[0]; y = m.target[1]; } else { x += m.dir[0] * lim; y += m.dir[1] * lim; }
      m.pos = [x, y];
    }
    for (const m of this.mons) {
      if (m.pos[0] !== m.ppos[0] || m.pos[1] !== m.ppos[1]) {
        const w = wallPush(m.pos[0], m.pos[1], m.ppos[0], m.ppos[1], MON_RADIUS, true);
        if (w.code) { m.pos = [w.x, w.y]; m.target = [w.x, w.y]; }
      }
      if (m.pos[0] === m.target[0] && m.pos[1] === m.target[1] && m.mode !== STUNNED && m.mode !== TIRED) m.mode = M_WALK;
    }
  }

  tiredMons() {
    for (const m of this.mons) {
      if (m.mode === STUNNED) continue;
      if (m.power < 30) m.mode = TIRED;
      else if (m.mode !== M_DASH) m.mode = M_WALK;
    }
  }

  // ------------------------------------------------------------------------------------------------------------- balls
  moveBalls() {
    const b1 = this.balls[1];
    if (b1.kind === 0 && this.timer <= SECOND_BALL_AT) {
      b1.state = WAITING; b1.kind = 1; b1.wait = 0; b1.pos = [128, 104]; b1.ppos = [128, 104];
      this.events.push({ type: "second", x: 128, y: 104 });
    }
    for (const b of this.balls) {
      if (!b.kind) continue;
      if (b.state === WAITING) {
        b.wait++;
        if (b.wait >= 8) { b.wait = 0; b.state = ROLLING; }
        continue;
      }
      if (b.state === SCORED) {
        b.timer--;
        if (b.timer !== 0) continue;
        this.respawn(b);
        continue;
      }
      if (b.state !== ROLLING && b.state !== KICKED) continue;
      if (b.speed) {
        const prev = b.pos;
        b.pos = [b.pos[0] + b.vel[0], b.pos[1] + b.vel[1]];
        if (b.speed >= KICK_LEVEL[b.level]) b.state = b.table === 2 ? KICKED : ROLLING;
        else { b.state = ROLLING; b.strength = 0; }
        const nxt = b.table === 2 ? KICK[b.row][b.step] : b.table === 1 ? NUDGE[b.row][b.step] : 0;
        b.speed = nxt;
        b.setDir(b.dir);
        b.step++;
        if (b.step >= b.steps) { b.vel = [0, 0]; b.dir = [0, 0]; b.table = 0; b.speed = 0; }
        else if (b.speed === 0) { b.dir = [0, 0]; b.step = 0; b.steps = 0; b.table = 0; }
        b.bounced = false;
        const w = wallPush(b.pos[0], b.pos[1], prev[0], prev[1], b.radius, false);
        if (w.code) {
          b.pos = [w.x, w.y]; b.bounced = true;
          if (w.code === 3 || w.code === 4) { b.dir = [b.dir[0], -b.dir[1]]; b.vel = [b.vel[0], -b.vel[1]]; }
          else { b.dir = [-b.dir[0], b.dir[1]]; b.vel = [-b.vel[0], b.vel[1]]; }
          this.events.push({ type: "wall", ball: b.i, x: b.pos[0], y: b.pos[1], speed: Math.hypot(b.vel[0], b.vel[1]) });
        }
        b.roll += Math.hypot(b.vel[0], b.vel[1]);
      } else { b.state = ROLLING; b.strength = 0; b.level = 0; b.table = 0; }
    }
    const [a, b] = this.balls;
    if (a.kind && b.kind) {
      if (a.state === SCORED || a.state === WAITING || b.state === SCORED || b.state === WAITING) return;
      if (dist(a.pos, b.pos) <= a.radius + 8) this.clash(a, b);
    }
  }

  respawn(b) {
    b.reset();
    const free = [];
    for (let k = 0; k < 15; k++) if (this.balls[0].spawn !== k && this.balls[1].spawn !== k) free.push(k);
    const sel = free[this.rand.int(free.length)];
    b.pos = SPAWN[sel].slice(); b.ppos = b.pos.slice(); b.spawn = sel;
    if (b.i === 0) {
      const t = this.timer;
      let ch = t >= 1200 ? 0 : t >= 600 ? 5 : t >= 300 ? 10 : 25;
      ch = Math.min(100, ch + this.misses);
      if (this.rand.int(100) < ch) { b.kind = 2; this.misses = 0; }
      else { b.kind = 1; if (this.misses < 100) this.misses++; }
    } else b.kind = 1;
    this.events.push({ type: "spawn", ball: b.i, x: b.pos[0], y: b.pos[1], kind: b.kind });
  }

  clash(a, b) {
    const sa = { state: a.state, last: a.last, step: a.step, steps: a.steps, table: a.table, speed: a.speed, row: a.row, pos: a.pos };
    this.bounceOff(a, b, 0);
    this.bounceOff(b, sa, 1);
    this.events.push({ type: "clash", x: (a.pos[0] + b.pos[0]) / 2, y: (a.pos[1] + b.pos[1]) / 2 });
  }

  bounceOff(ball, other, side) {
    if (ball.speed <= 3 && other.speed > 3) {
      ball.state = other.state; ball.step = other.step; ball.steps = other.steps; ball.table = other.table; ball.speed = other.speed; ball.row = other.row;
    } else { ball.state = ROLLING; ball.step = 0; ball.steps = 30; ball.table = 1; ball.speed = 3; ball.row = 0; }
    let d = [ball.pos[0] - other.pos[0], ball.pos[1] - other.pos[1]];
    if (d[0] === 0 && d[1] === 0) d = side === 0 ? [0, -1] : [0, 1];
    ball.setDir(d);
    if (other.last < NOMON) ball.last = other.last;
  }

  collide() {
    for (const b of this.balls) {
      if (!b.inPlay) continue;
      const rad = b.radius;
      for (const m of this.mons) {
        const c = m.cc;
        if (dist(c, b.pos) <= MON_RADIUS + rad) {
          if ((b.touch[m.i] && b.bounced) || m.motion === 2 || m.motion === 3) continue;
          const n = norm(b.pos[0] - c[0], b.pos[1] - c[1]);
          if (b.state === KICKED) {
            if (b.last === m.i) continue;
            const p = m.power - b.strength;
            m.step = [-n[0], -n[1]]; m.motion = 3; m.mw = 30; m.mf = 7;
            if (p <= 0) {
              m.power = 0; m.mode = STUNNED; m.stun = 90; m.c.failed++;
              this.events.push({ type: "stun", mon: m.i, x: m.pos[0], y: m.pos[1] });
            } else m.power = p;
            this.events.push({ type: "knock", mon: m.i, x: m.pos[0], y: m.pos[1] });
          } else {
            if (m.dir[0] !== 0 || m.dir[1] !== 0) {
              let spd;
              if (m.mode === M_DASH) {
                b.state = KICKED; b.table = 2; b.row = m.row; b.strength = m.kickPower; b.level = m.level;
                spd = KICK[b.row][0];
                m.motion = 1; m.step = [-n[0], -n[1]]; m.mf = 3; m.mw = 0; m.mode = M_WALK;
                m.c.hit++;
                this.events.push({ type: "kick", mon: m.i, ball: b.i, x: b.pos[0], y: b.pos[1] });
              } else {
                b.table = 1; b.row = m.row; spd = NUDGE[b.row][0];
                this.events.push({ type: "nudge", mon: m.i, ball: b.i });
              }
              b.step = 1; b.steps = 30; b.speed = spd;
            }
            b.setDir(n);
            b.last = m.i;
          }
          b.touch[m.i] = true;
        } else b.touch[m.i] = false;
      }
      for (const p of POSTS) {
        if (dist(p, b.pos) <= 8 + rad) {
          const n = norm(p[0] - b.pos[0], p[1] - b.pos[1]);
          const dot = b.vel[0] * n[0] + b.vel[1] * n[1];
          if (dot > 0) {
            b.vel = [b.vel[0] - 2 * dot * n[0], b.vel[1] - 2 * dot * n[1]];
            b.dir = norm(b.vel[0], b.vel[1]);
            this.events.push({ type: "post", x: p[0], y: p[1] });
          }
          break;
        }
      }
    }
  }

  goals() {
    for (const b of this.balls) {
      if (!b.inPlay) continue;
      const [x, y] = b.pos;
      const g = (x >= 128 ? 1 : 0) + (y >= 112 ? 2 : 0);
      const inside = [x + y < 80, x - y > 176, y - x > 128, x + y > 384][g];
      if (!inside) continue;
      b.state = SCORED; b.timer = 10; b.speed = 0; b.vel = [0, 0];
      if (b.last === NOMON) continue;
      const t = Math.floor(b.last / 3), m = this.mons[b.last];
      let own = false, pts = 0;
      if (g === t) {
        own = true;
        if (this.scores[t]) this.scores[t]--;
        m.c.failed++; m.c.selfImpeded++;
      } else {
        pts = b.kind === 1 ? 1 : 2;
        if (this.scores[t] + pts <= 99) this.scores[t] += pts;
        m.c.points++;
        if (this.scores[g]) this.scores[g]--;
      }
      this.events.push({ type: "goal", team: t, goal: g, mon: b.last, pts, own, kind: b.kind, ball: b.i, x, y });
    }
  }

  result() {
    return [0, 1, 2, 3].map((t) => ({ points: this.scores[t], score: this.scores[t], mons: [0, 1, 2].map((k) => ({ ...this.mons[t * 3 + k].c })) }));
  }
}
