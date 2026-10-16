// Disc Catch (Atrapadiscos), the rules: pokeathlon_disc_catch*.c of the HeartGold decompilation as written up in SPEC section 4,
// event 4. Pure simulation (no drawing, no DOM): 30 steps per second, positions in DS touch-screen pixels (256 x 192, y down),
// randomness only from the rand helper (LCRandom() % n). Stats are raw 0-4 = stars - 1.
import { clamp, dist, idiv, norm, sq } from "../_kit5/util.js";

export const FRAMES = 1800;
export const FIELD_W = 256;
export const FIELD_H = 192;
export const TOUCH_RADIUS = 80;
export const MON_RADIUS = 8;
export const CATCH_REACH = MON_RADIUS + 14;      // a jumping Pokémon this close to the disc's ground point catches it
export const FALL_FRAMES = 90;
export const TAP_FRAMES = 5;                      // a touch of at most this many steps that ends on the same Pokémon is a jump

// table a/1/7/0 member 7 (PokeathlonDiscCatch_InitStats), by raw stat 0..4
export const JUMP_FRAMES = [5, 6, 7, 9, 15];      // half the air time, by Jump (raw 0 cannot jump)
export const JUMP_HEIGHT = [4, 4, 3, 3, 1];       // only moves the sprite up
export const POWER = [4.0, 4.5, 5.0, 5.5, 6.0];   // knock-back, px/step, by Power
export const SPEED = [2.4, 3.6, 4.8, 5.4, 7.2];   // walking, px/step, by Speed

export const START_X = [40, 96, 160, 216];
export const START_Y = [40, 88, 152];
const HOME_ROWS = [[3, 5], [7, 6], [15, 6]];      // CPU: first tile row and number of rows of each member's band
const CPU_JUMP_CHANCE = [3, 6, 36];                // percent per step while chasing a disc in reach
const PHASE_SECONDS = [55, 40, 20, 0];

export const ST = { NONE: 0, JUMPING: 1, ON_FIELD: 2, FALLEN: 3, RESPAWNED: 4 };
export const DISC = { NONE: 0, FLYING: 1, LANDED: 2, CAUGHT: 3 };

/** x of a disc at a given progress (0..480 rows of both screens; the touch screen starts at 288) along one of the 15 paths. */
export function discX(progress, path) {
  const s = Math.round(Math.sin(((progress * 2) % 360) * Math.PI / 180) * 4096);
  return idiv(38 * (progress * (path - 7)), 1000) + 128 + Math.floor((s * 64) / 65536);
}

/** points of a catch by the catcher's ground point: bands of tile rows with their corners worth the next band */
export function catchPoints(gx, gy) {
  const tx = Math.floor(gx / 8), ty = Math.floor(gy / 8);
  const corner = (end) =>
    (ty === end - 1 && (tx < 8 || tx > 23)) || (ty === end - 2 && (tx < 5 || tx > 26)) || (ty === end - 3 && (tx < 2 || tx > 29));
  if (ty < 9) return corner(9) ? 2 : 1;
  if (ty < 15) return corner(15) ? 3 : 2;
  if (ty < 20) return corner(20) ? 5 : 3;
  return 5;
}

export function offField(x, y) {
  return x <= 0 || y <= 0 || x >= 255 || y >= 255 || x < 8 || x >= 248 || y < 8 || y >= 180;
}

class Mon {
  constructor(idx, team, slot, stats, large) {
    this.idx = idx; this.team = team; this.slot = slot;
    this.jump = stats.jump;                       // raw 0-4
    this.jumpFrames = JUMP_FRAMES[stats.jump];
    this.jumpHeight = JUMP_HEIGHT[stats.jump];
    this.power = POWER[stats.power];
    this.speed = SPEED[stats.speed];
    this.large = !!large;
    this.homeX = START_X[team]; this.homeY = START_Y[slot];
    this.state = ST.ON_FIELD;
    this.x = this.homeX; this.y = this.homeY; this.px = this.x; this.py = this.y;
    this.tx = this.x; this.ty = this.y;
    this.vx = 0; this.vy = 0; this.dx = 0; this.dy = 1;  // last walking direction (unit)
    this.fx = 0; this.fy = 1;                              // facing for the sprite
    this.knocked = false; this.dragged = false; this.draggedOff = false;
    this.jumpT = 0; this.jumpDur = 0; this.fallT = 0; this.signal = 0;
    this.fallX = 0; this.fallY = 0;
    // counters (SPEC 3.5)
    this.c = { failed: 0, jumped: 0, points: 0, hit: 0, fell: 0, dashed: 0, switched: 0, selfImpeded: 0 };
  }
  get inPlay() { return this.state === ST.ON_FIELD || this.state === ST.JUMPING; }
  snap() { this.px = this.x; this.py = this.y; }
  setTarget(x, y) { this.tx = x; this.ty = y; this.dragged = true; }
  /** the sprite's lift in px while it jumps (cosmetic, from GetJumpOffset) */
  lift() {
    if (this.state !== ST.JUMPING || !this.jump) return 0;
    const half = this.jumpFrames, f = this.jumpDur - this.jumpT;
    return Math.min(24, (this.jumpHeight / 10) * (half * half - sq(f - half)));
  }
}

class Disc {
  constructor(i) { this.i = i; this.active = false; this.state = DISC.NONE; this.progress = 0; this.x = 0; this.path = 7; this.speed = 4; this.timer = 0; this.owner = -1; this.points = 0; this.cx = 0; this.cy = 0; }
  y() { return this.state === DISC.FLYING ? this.progress - 288 : this.cy; }
}

export class DiscCatchSim {
  /**
   * @param o.stats     12 stat objects ({power, speed, jump} raw 0-4), team-major
   * @param o.large     12 booleans: the species flag that only changes the knock-back (Steelix, Lugia...)
   * @param o.rand      makeRand(ctx.rng)
   * @param o.human     index of the team a person steers, or -1
   * @param o.humans    several people (a room with friends): the teams they steer; wins over o.human
   */
  constructor(o) {
    this.rand = o.rand;
    const people = o.humans ?? (o.human >= 0 ? [o.human] : []);
    this.humans = new Set(people);
    this.human = people.length ? people[0] : -1;      // the first person (the only one in a single-player event)
    this.timer = FRAMES;
    this.seconds = 60;
    this.step_no = 0;
    this.mons = [];
    for (let i = 0; i < 12; i++) this.mons.push(new Mon(i, Math.floor(i / 3), i % 3, o.stats[i], o.large?.[i]));
    this.discs = [new Disc(0), new Disc(1)];
    this.delay = 0;
    this.scores = [0, 0, 0, 0];
    this.touching = Array.from({ length: 12 }, () => new Uint8Array(12));
    this.holds = new Map(people.map((t) => [t, { holding: false, mon: 0 }]));   // each person's finger
    this.cpu = this.mons.filter((m) => !this.humans.has(m.team)).map((m) => this.newCpu(m));
    this.events = [];                                  // what happened during the last step, for the view (sounds, sparks)
  }

  get over() { return this.timer <= 0; }
  /** the first person's finger (what a single-player view reads) */
  get hold() { return this.holds.get(this.human) || { holding: false, mon: 0 }; }
  holdOf(team) { return this.holds.get(team) || { holding: false, mon: 0 }; }

  /** The CPU takes a person's team over (they left the room). */
  takeOver(team) {
    if (!this.humans.has(team)) return;
    this.humans.delete(team);
    this.holds.delete(team);
    for (const m of this.teamMons(team)) { m.dragged = false; this.cpu.push(this.newCpu(m)); }
    this.human = this.humans.size ? [...this.humans][0] : -1;
  }
  teamMons(t) { return this.mons.slice(t * 3, t * 3 + 3); }

  // ---------------------------------------------------------------------------------------------------------------- step
  /** cmd: { touch: DsTouch-like for the human team, kbd: { slot, target: [x, y] | null, jump } }; cmds: the same per team, in a room. */
  step(cmd = {}, cmds = null) {
    const by = cmds || (this.human >= 0 ? { [this.human]: cmd } : {});
    this.events.length = 0;
    for (const m of this.mons) m.snap();
    if (this.timer > 0) {
      this.timer--;
      this.seconds = idiv(this.timer + 30, 30);
    }
    this.step_no++;
    this.cpuUpdate();
    this.discsUpdate();
    for (let t = 0; t < 4; t++) {
      if (this.humans.has(t)) for (const m of this.teamMons(t)) m.dragged = false;
      else this.mons[t * 3].dragged = false;
      if (this.humans.has(t)) this.humanInput(t, by[t] || {});
      for (const m of this.teamMons(t)) this.monUpdate(m);
    }
    this.collisions();
  }

  // ---------------------------------------------------------------------------------------------------------------- the person
  nearestTouched(team, x, y) {
    let best = -1, bd = Infinity;
    for (let s = 0; s < 3; s++) {
      const m = this.mons[team * 3 + s];
      const d = dist(x, y, m.x, m.y);
      if (d < TOUCH_RADIUS && d < bd) { bd = d; best = s; }
    }
    return best;
  }

  humanInput(team, cmd) {
    const h = this.holds.get(team);
    const t = cmd.touch;
    if (t) {
      if (t.touchNew) {
        const s = this.nearestTouched(team, t.touchX, t.touchY);
        if (s >= 0) { h.holding = true; h.mon = s; }
      } else if (t.touching) {
        if (h.holding) {
          const m = this.mons[team * 3 + h.mon];
          if (m.state === ST.FALLEN) h.holding = false;
          else if (Math.abs(t.touchX - m.x) > 8 || Math.abs(t.touchY - m.y) > 8) {
            m.setTarget(t.touchX, t.touchY);
            m.draggedOff = offField(m.tx, m.ty);
          }
        }
      } else {
        if (h.holding) {
          const m = this.mons[team * 3 + h.mon];
          const s = this.nearestTouched(team, t.touchX, t.touchY);
          if (m.state === ST.ON_FIELD && s === h.mon && t.lastTouchFrames <= TAP_FRAMES) this.jump(m);
        }
        h.holding = false;
      }
    }
    const k = cmd.kbd;
    if (k && k.slot >= 0) {
      const m = this.mons[team * 3 + k.slot];
      if (k.target && m.state !== ST.FALLEN) {
        m.setTarget(k.target[0], k.target[1]);
        m.draggedOff = offField(m.tx, m.ty);
      }
      if (k.jump && m.state === ST.ON_FIELD) this.jump(m);
    }
  }

  jump(m) {
    if (m.jump) {
      m.c.jumped++;
      m.jumpDur = m.jumpFrames * 2;
      m.jumpT = m.jumpDur;
      m.state = ST.JUMPING;
      this.events.push({ type: "jump", mon: m.idx });
    }
    m.signal = 10;
  }

  // ---------------------------------------------------------------------------------------------------------------- movement
  monUpdate(m) {
    switch (m.state) {
      case ST.RESPAWNED: m.state = ST.ON_FIELD; break;
      case ST.FALLEN:
        m.fallT--;
        if (m.fallT === 0) { this.respawn(m); m.state = ST.RESPAWNED; }
        break;
      case ST.ON_FIELD:
        this.move(m);
        if (offField(m.x, m.y)) {
          m.c.failed++; m.c.fell++;
          if (m.draggedOff) m.c.selfImpeded++;
          m.draggedOff = false;
          m.fallT = FALL_FRAMES;
          m.fallX = m.x; m.fallY = m.y;
          m.state = ST.FALLEN;
          this.events.push({ type: "fall", mon: m.idx, x: m.x, y: m.y });
        }
        break;
      case ST.JUMPING:
        m.jumpT--;
        if (m.jumpT === 0) m.state = ST.ON_FIELD;
        this.move(m);
        break;
      default: break;
    }
  }

  respawn(m) {
    m.x = m.homeX; m.y = m.homeY; m.tx = m.x; m.ty = m.y; m.px = m.x; m.py = m.y;
    m.vx = 0; m.vy = 0; m.fx = 0; m.fy = 1; m.knocked = false;
    this.events.push({ type: "respawn", mon: m.idx });
  }

  move(m) {
    const dx = m.tx - m.x, dy = m.ty - m.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    const moving = d > 0;
    if (m.knocked) {
      // the velocity runs down first: 0.8 px/step^2 along the velocity, a little more while the finger drags against it
      const [ux, uy] = norm(m.vx, m.vy);
      let ax = Math.abs(0.8 * ux), ay = Math.abs(0.8 * uy);
      if (m.dragged) {
        const sc = m.power / 100;
        ax += Math.abs(sc * m.dx); ay += Math.abs(sc * m.dy);
      }
      m.vx = slow(m.vx, ax); m.vy = slow(m.vy, ay);
      m.x += m.vx; m.y += m.vy;
      m.tx = m.x; m.ty = m.y;
      if (m.vx || m.vy) return;
      m.knocked = false;
    }
    if (moving) {
      const [nx, ny] = norm(dx, dy);
      if (!m.knocked) { m.fx = nx; m.fy = ny; }
      if (d <= m.speed) { m.x += dx; m.y += dy; }
      else { m.x += m.speed * nx; m.y += m.speed * ny; }
      m.dx = nx; m.dy = ny;
    }
  }

  collisions() {
    const ms = this.mons;
    for (let i = 0; i < 12; i++) {
      const a = ms[i];
      for (let j = i + 1; j < 12; j++) {
        const b = ms[j];
        // (as written in the game: while two Pokémon stay overlapped the flag flips every other step)
        if (a.inPlay && b.inPlay && dist(a.x, a.y, b.x, b.y) <= 2 * MON_RADIUS && !this.touching[i][j]) {
          this.touching[i][j] = this.touching[j][i] = 1;
          const [px, py] = norm(a.x - b.x, a.y - b.y);
          let p = b.power;
          if (!a.large) p = p * 6 / 5;
          a.vx = p * px + a.dx; a.vy = p * py + a.dy;
          p = a.power;
          if (!b.large) p = p * 6 / 5;
          b.vx = -(p * px + b.dx); b.vy = -(p * py + b.dy);
          a.vx = clamp(a.vx, -8, 8); a.vy = clamp(a.vy, -8, 8);
          b.vx = clamp(b.vx, -8, 8); b.vy = clamp(b.vy, -8, 8);
          b.fx = px; b.fy = py;
          a.knocked = b.knocked = true;
          this.events.push({ type: "bump", a: i, b: j, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
        } else {
          this.touching[i][j] = this.touching[j][i] = 0;
        }
      }
    }
  }

  // ---------------------------------------------------------------------------------------------------------------- discs
  phase() {
    for (let i = 0; i < 4; i++) if (PHASE_SECONDS[i] <= this.seconds) return i;
    return 3;
  }

  discsUpdate() {
    if (this.delay === 0) this.launchNext(this.seconds);
    else this.delay--;
    for (const d of this.discs) this.discUpdate(d);
  }

  launchNext(seconds) {
    let ph = 3;
    for (let i = 0; i < 4; i++) if (PHASE_SECONDS[i] <= seconds) { ph = i; break; }
    this.delay = ph === 0 || ph === 2 ? 30 : 0;
    const speed = ph < 3 ? 4 : (this.rand.int(2) + 1) * 4;
    const count = ph === 0 ? 1 : 2;
    for (let i = 0; i < count; i++) {
      const d = this.discs[i];
      if (!d.active) {
        d.active = true; d.progress = 0; d.x = 0; d.state = DISC.FLYING;
        d.path = this.rand.int(15); d.timer = 0; d.speed = speed; d.owner = -1;
        this.events.push({ type: "launch", disc: i, speed });
        return;
      }
    }
  }

  discUpdate(d) {
    if (!d.active) return;
    switch (d.state) {
      case DISC.FLYING: {
        const c = d.progress >= 288 ? this.findCatcher(d) : null;
        if (c) this.catchDisc(d, c);
        else if (d.progress >= 480) { d.progress = 0; d.state = DISC.LANDED; d.cx = d.x; d.cy = FIELD_H; }
        else { d.progress += d.speed; d.x = discX(d.progress, d.path); }
        break;
      }
      case DISC.LANDED:
        d.progress += d.speed;
        if (d.progress >= 48) { d.active = false; d.state = DISC.NONE; }
        break;
      case DISC.CAUGHT:
        d.timer++;
        if (d.timer >= 20) { d.active = false; d.state = DISC.NONE; }
        break;
      default: break;
    }
  }

  findCatcher(d) {
    const y = d.progress - 288;
    for (const m of this.mons) {
      if (m.state === ST.JUMPING && dist(m.x, m.y, d.x, y) <= CATCH_REACH) return m;
    }
    return null;
  }

  catchDisc(d, m) {
    const pts = catchPoints(m.x, m.y);
    d.state = DISC.CAUGHT; d.timer = 0; d.owner = m.team; d.points = pts; d.cx = m.x; d.cy = m.y;
    this.scores[m.team] = Math.min(200, this.scores[m.team] + pts);
    m.c.points++;
    this.events.push({ type: "catch", team: m.team, mon: m.idx, points: pts, x: m.x, y: m.y });
  }

  // ---------------------------------------------------------------------------------------------------------------- the CPU
  newCpu(m) {
    const start = Math.max(1, m.team * 2 + m.slot * 8);
    const c = { m, think: start, homeT: start, chasing: false, state: 0, disc: -1, homeX: m.homeX, tx: m.homeX, ty: m.homeY };
    this.pickHome(c);
    return c;
  }

  pickHome(c) {
    const [first, count] = HOME_ROWS[c.m.slot];
    c.ty = (first + this.rand.int(count)) * 8;
    c.homeX = START_X[c.m.team] + (this.rand.int(5) - 2) * 8;
    c.chasing = false;
    c.state = 0;
  }

  near(c, d, reach) {
    if (d.progress < 288) return false;
    return sq(MON_RADIUS + reach) >= sq(c.m.x - d.x) + sq(c.m.y - (d.progress - 288));
  }

  cpuUpdate() {
    const total = this.scores[0] + this.scores[1] + this.scores[2] + this.scores[3];
    const average = idiv(total, 4);
    for (const c of this.cpu) {
      const m = c.m;
      if (!m.inPlay) continue;
      if (--c.homeT === 0) { this.pickHome(c); c.homeT = 90; }
      if (--c.think === 0) { this.cpuThink(c); c.think = 20; }
      if (!c.chasing) continue;
      if (!this.near(c, this.discs[c.disc], 16)) continue;
      const roll = this.rand.int(100);
      // (the original compares each CPU team with the score of the team of the same index; here it is the team's own score)
      const chance = average + 20 < this.scores[m.team] ? 0 : CPU_JUMP_CHANCE[m.slot];
      if (roll < chance) this.jump(m);
    }
  }

  cpuThink(c) {
    if (c.state === 0) {
      c.tx = c.homeX;
      for (let i = 0; i < 2; i++) {
        if (this.discs[i].active && this.near(c, this.discs[i], 56)) { c.disc = i; c.chasing = true; c.state = 1; }
      }
    } else if (c.state === 1) {
      const d = this.discs[c.disc];
      if (d.active) c.tx = discX(c.ty + 288, d.path);
      else { c.chasing = false; c.state = 0; }
    }
    c.m.setTarget(c.tx, c.ty);
  }

  /** what the end of the match reports */
  result() {
    const detail = [0, 1, 2, 3].map((t) => ({
      mons: this.teamMons(t).map((m) => ({ ...m.c })),
      points: this.scores[t],
      catches: this.teamMons(t).reduce((s, m) => s + m.c.points, 0),
      falls: this.teamMons(t).reduce((s, m) => s + m.c.fell, 0),
    }));
    return { raw: this.scores.slice(), detail };
  }
}

function slow(v, dec) {
  if (v > 0) return Math.max(0, v - dec);
  if (v < 0) return Math.min(0, v + dec);
  return 0;
}
