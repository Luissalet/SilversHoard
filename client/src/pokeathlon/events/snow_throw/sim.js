// Snow Throw (Nieve cruzada), the rules: pokeathlon_snow_throw*.c as written up in SPEC section 4, event 8.
// Pure simulation (no drawing, no DOM): 30 steps per second, positions in field units (64 x 64, x to the right, z down the screen).
// Four teams of three Pokémon stand on the four sides and never move; every Pokémon has one snowball. Stats are raw 0-4 = stars - 1.
import { clamp, norm } from "../_kit5/util.js";

export const FRAMES = 1800;
export const FIELD = 64;
export const CENTER = 33;
export const GRAB_RADIUS = 4.0;                       // grab / tap radius around a Pokémon's home
export const HIT_RADIUS = 3.0;
export const BALL_RADIUS = 4.0;                       // two balls closer than this splash each other
export const MAX_ENERGY = 120;
export const HOLD_MAX = 30;

export const POS = [[25, 61], [33, 61], [41, 61], [61, 41], [61, 33], [61, 25], [41, 5], [33, 5], [25, 5], [5, 25], [5, 33], [5, 41]];
export const WEIGHT = [1.6, 1.4, 1.2, 1.1, 1.0];      // by Skill: the smaller the better
export const POWER = [1.0, 1.1, 1.2, 1.4, 1.6];       // by Power
export const SPREAD = [6, 4, 3, 2, 0];                // by Skill: degrees a throw may stray (raw 4: none, the intended design)
export const HIT_DAMAGE = [3, 2, 2, 2, 1];            // by Stamina
export const SIZE_FACTOR = [1, 20, 50, 100];
export const SIZE_BY_TAPS = [0, 0, 1, 2, 3];

export const BALL = { NONE: 0, FLYING: 1, HELD: 2, SPLASHED: 3 };
const { NONE, FLYING, HELD, SPLASHED } = BALL;

/** rotate a unit vector by up to `deg` degrees either way (the game's AddAimSpread: -(deg-1) .. +deg) */
export function addSpread(v, deg, rand) {
  if (deg <= 0) return v;
  const k = deg - rand.int(deg * 2);
  const a = (k * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  return [v[0] * c + v[1] * s, -v[0] * s + v[1] * c];
}

export function energyFactor(e) {
  return e <= 60 ? 0.5 : e <= 70 ? 0.6 : e <= 80 ? 0.7 : e <= 90 ? 0.8 : 1.0;
}

class Mon {
  constructor(i, st) {
    this.i = i; this.team = Math.floor(i / 3); this.slot = i % 3;
    this.home = POS[i];
    this.weight = WEIGHT[st.skill]; this.power = POWER[st.power]; this.spread = SPREAD[st.skill]; this.hitDamage = HIT_DAMAGE[st.stamina];
    this.hits = 0; this.stun = 0; this.stunMax = 0; this.energy = MAX_ENERGY; this.stunned = false; this.tired = false;
    this.c = { failed: 0, jumped: 0, points: 0, hit: 0, fell: 0, dashed: 0, switched: 0, selfImpeded: 0 };
    this.ball = { state: NONE, pos: [0, 0], vel: [0, 0], taps: 0, size: 0, splash: 0, owner: i };
  }
}

export class SnowThrowSim {
  /**
   * @param o.stats  4 teams x 3 members of { power, skill, stamina } raw 0-4
   * @param o.rand   makeRand(ctx.rng)
   * @param o.human  team a person plays, or -1
   */
  constructor(o) {
    this.rand = o.rand;
    this.human = o.human ?? -1;
    this.mons = [];
    o.stats.forEach((team, t) => team.forEach((s, k) => this.mons.push(new Mon(t * 3 + k, s))));
    this.timer = FRAMES;
    this.steps = 0;
    this.events = [];
    this.cpuTeams = [0, 1, 2, 3].filter((t) => t !== this.human);
    this.cpu = { timer: 40, thinking: false, cursor: 0, member: 0 };
    // the person's touch, as the host keeps it
    this.t = { down: false, held: -1, start: [0, 0], last: [0, 0], holdFrames: 0 };
  }

  get over() { return this.timer <= 0; }
  teamScore(t) { return Math.min(999, this.mons[t * 3].hits + this.mons[t * 3 + 1].hits + this.mons[t * 3 + 2].hits); }
  get scores() { return [0, 1, 2, 3].map((t) => this.teamScore(t)); }

  // ------------------------------------------------------------------------------------------------------------- the step
  /**
   * cmd.touch: { down, x, z } the person's finger in field units; cmd.keys: [{ type: "tap", mon } | { type: "throw", mon, dir: [x, z], hold }]
   */
  step(cmd = {}) {
    this.events.length = 0;
    if (this.timer <= 0) return;
    this.steps++;
    this.timer--;
    if (this.human >= 0) {
      if (cmd.touch) this.touchInput(cmd.touch);
      if (cmd.keys) for (const k of cmd.keys) this.keyInput(k);
    }
    this.cpuUpdate(this.steps);
    this.updateMons();
    this.moveBalls();
    this.collideBalls();
    this.hitMons();
  }

  // ------------------------------------------------------------------------------------------------------------- the person
  findOwnMonAt(x, z) {
    for (let k = 0; k < 3; k++) {
      const m = this.mons[this.human * 3 + k];
      if (Math.hypot(m.home[0] - x, m.home[1] - z) <= GRAB_RADIUS) {
        if (m.stun !== 0) continue;
        return m;
      }
    }
    return null;
  }

  touchInput(tc) {
    const t = this.t;
    if (tc.down) {
      if (!t.down) {
        // press
        t.down = true;
        t.start = [tc.x, tc.z]; t.last = [tc.x, tc.z]; t.holdFrames = 0; t.held = -1;
        const m = this.findOwnMonAt(tc.x, tc.z);
        if (m && (m.ball.state === NONE || m.ball.state === HELD)) {
          t.held = m.i;
          if (m.ball.state === NONE) { m.ball.pos = m.home.slice(); m.ball.state = HELD; m.ball.taps = 0; m.ball.size = 0; }
        }
      } else {
        t.last = [tc.x, tc.z];
        if (t.held >= 0) t.holdFrames = Math.min(HOLD_MAX, t.holdFrames + 1);
      }
    } else if (t.down) {
      // release
      t.down = false;
      const j = t.held;
      t.held = -1;
      if (j < 0) return;
      const m = this.mons[j];
      if (m.stun !== 0 || m.ball.state !== HELD) return;
      const [rx, rz] = t.last;
      if (Math.hypot(m.home[0] - rx, m.home[1] - rz) <= GRAB_RADIUS) this.tap(m);
      else {
        const drag = [rx - t.start[0], rz - t.start[1]];
        if (drag[0] !== 0 || drag[1] !== 0) this.throwBall(m, drag, t.holdFrames);
        else this.tap(m);
      }
    }
  }

  keyInput(k) {
    const m = this.mons[this.human * 3 + k.mon];
    if (!m || m.stun !== 0) return;
    if (k.type === "tap") {
      if (m.ball.state === NONE) { m.ball.pos = m.home.slice(); m.ball.state = HELD; m.ball.taps = 0; m.ball.size = 0; }
      if (m.ball.state === HELD) this.tap(m);
    } else if (k.type === "throw") {
      if (m.ball.state === NONE) { m.ball.pos = m.home.slice(); m.ball.state = HELD; m.ball.taps = 0; m.ball.size = 0; }
      if (m.ball.state !== HELD) return;
      const d = norm(k.dir[0], k.dir[1]);
      if (d[0] === 0 && d[1] === 0) return;
      this.throwBall(m, [d[0] * 6, d[1] * 6], k.hold || 0);
    }
  }

  tap(m) {
    const b = m.ball;
    b.taps = Math.min(4, b.taps + 1);
    b.size = SIZE_BY_TAPS[b.taps];
    this.events.push({ type: "tap", mon: m.i, taps: b.taps });
  }

  throwBall(m, drag, holdFrames) {
    const len = Math.hypot(drag[0], drag[1]);
    const speed = clamp(len, 1, 2);
    const hold = 1 + holdFrames / HOLD_MAX;
    const strength = clamp((energyFactor(m.energy) * speed * (2 - m.weight)) / hold, 1, 3);
    let d = norm(drag[0], drag[1]);
    d = addSpread(d, m.spread, this.rand);
    const b = m.ball;
    b.vel = [d[0] * strength, d[1] * strength];
    b.pos = m.home.slice();
    b.state = FLYING;
    this.events.push({ type: "throw", mon: m.i, team: m.team, size: b.size, strength });
  }

  // ------------------------------------------------------------------------------------------------------------- the CPU
  cpuUpdate(elapsed) {
    const c = this.cpu;
    if (!this.cpuTeams.length) return;
    c.timer++;
    if (c.timer >= 40) { c.thinking = true; c.timer = 0; }
    if (c.thinking) {
      const team = this.cpuTeams[c.cursor];
      const m = this.mons[team * 3 + c.member];
      if ((m.ball.state === NONE || m.ball.state === HELD) && !m.stunned) this.think(m, elapsed);
      c.cursor++;
      if (c.cursor >= this.cpuTeams.length) { c.cursor = 0; c.member = (c.member + 1) % 3; c.thinking = false; }
    }
  }

  think(m, elapsed) {
    const r = this.rand, b = m.ball;
    if (m.energy + r.int(51) <= MAX_ENERGY && b.taps < 4) {
      if (b.state === NONE) { b.taps = 1; b.state = HELD; b.pos = m.home.slice(); this.events.push({ type: "tap", mon: m.i, taps: 1 }); return; }
      b.taps++;
      b.size = b.taps <= 1 ? 0 : b.taps <= 2 ? 1 : b.taps <= 3 ? 2 : 3;
      this.events.push({ type: "tap", mon: m.i, taps: b.taps });
      return;
    }
    const score = this.mons.map((o) => Math.trunc(o.hits / 20) + r.int(21) + (o.stunned ? 1 : 0) + Math.trunc((MAX_ENERGY - o.energy) / 20));
    let best = -1, tied = [];
    for (const o of this.mons) {
      if (o.team === m.team) continue;
      if (score[o.i] > best) { best = score[o.i]; tied = [o.i]; } else if (score[o.i] === best) tied.push(o.i);
    }
    const tgt = this.mons[tied[r.int(tied.length)]];
    let d = norm(tgt.home[0] - m.home[0], tgt.home[1] - m.home[1]);
    d = addSpread(d, 3, r);
    d = addSpread(d, m.spread, r);
    const speed = clamp(elapsed / 40 + (m.energy / 50 + r.int(51)), 1, 2);
    b.vel = [d[0] * speed, d[1] * speed];
    b.state = FLYING; b.pos = m.home.slice();
    this.events.push({ type: "throw", mon: m.i, team: m.team, size: b.size, strength: speed });
  }

  // ------------------------------------------------------------------------------------------------------------- balls and hits
  updateMons() {
    for (const m of this.mons) {
      if (m.stun) m.stun--;
      if (m.energy < MAX_ENERGY) m.energy++;
      m.stunned = m.stun > 0;
      m.tired = m.energy <= 100;
    }
  }

  moveBalls() {
    for (const m of this.mons) {
      const b = m.ball;
      if (b.state === FLYING) { b.pos = [b.pos[0] + b.vel[0], b.pos[1] + b.vel[1]]; }
      else if (b.state === SPLASHED) {
        b.splash++;
        if (b.splash >= 8) { b.splash = 0; b.state = NONE; }
      }
      if (b.pos[0] < 1 || b.pos[0] > FIELD || b.pos[1] < 1 || b.pos[1] > FIELD) {
        if (b.state === FLYING) this.events.push({ type: "gone", mon: m.i, x: clamp(b.pos[0], 1, FIELD), z: clamp(b.pos[1], 1, FIELD) });
        b.state = NONE; b.vel = [0, 0];
      }
    }
  }

  collideBalls() {
    const sp = new Array(12).fill(false);
    for (let i = 0; i < 12; i++) {
      const a = this.mons[i].ball;
      if (a.state !== FLYING && a.state !== HELD) continue;
      for (let j = 0; j < 12; j++) {
        if (i === j) continue;
        const b = this.mons[j].ball;
        if (b.state !== FLYING && b.state !== HELD) continue;
        if (Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1]) < BALL_RADIUS) sp[i] = sp[j] = true;
      }
    }
    for (let i = 0; i < 12; i++) {
      if (!sp[i]) continue;
      const b = this.mons[i].ball;
      this.events.push({ type: "splash", mon: i, x: b.pos[0], z: b.pos[1], clash: true });
      b.state = SPLASHED; b.size = 0; b.taps = 0; b.splash = 0;
    }
  }

  hitMons() {
    for (let j = 0; j < 12; j++) {
      const t = this.mons[j];
      for (let i = 0; i < 12; i++) {
        const s = this.mons[i], b = s.ball;
        if (b.state !== FLYING || s.team === t.team) continue;
        if (Math.hypot(t.home[0] - b.pos[0], t.home[1] - b.pos[1]) >= HIT_RADIUS) continue;
        b.state = SPLASHED; b.splash = 0;
        s.hits = Math.min(999, s.hits + 1);
        s.c.points++;
        const sf = SIZE_FACTOR[b.size];
        const size = b.size;
        b.size = 0; b.taps = 0;
        const speed = Math.floor(Math.hypot(b.vel[0], b.vel[1]) + 0.001);
        const damage = Math.trunc(speed * sf * s.power * t.hitDamage);
        t.energy = Math.max(0, t.energy - (damage + 30));
        const lost = MAX_ENERGY - t.energy;
        let stunned = false;
        if (t.stun === 0) { if (lost > 40) { t.stun = lost; stunned = true; } }
        else { t.stun = (t.stun + lost) & 0xff; stunned = true; }
        if (stunned) { t.stunMax = t.stun; t.stunned = true; t.c.failed++; }
        this.events.push({ type: "hit", from: i, to: j, size, stunned, damage, x: t.home[0], z: t.home[1], bx: b.pos[0], bz: b.pos[1] });
      }
    }
  }

  result() {
    return [0, 1, 2, 3].map((t) => ({ points: this.teamScore(t), mons: [0, 1, 2].map((k) => ({ ...this.mons[t * 3 + k].c })) }));
  }
}
