// Ring Drop (Fuera del ring), the rules: pokeathlon_ring_drop*.c of the HeartGold decompilation as written up in SPEC section 4, event 7.
// Pure simulation (no drawing, no DOM): 30 steps per second, positions in DS touch-screen pixels (256 x 192) in the game's "centre space"
// (the ground point of a Pokémon is its position + 10 px down). Four participants, one Pokémon in the ring each, three members that
// rotate. Stats are raw 0-4 = stars - 1.
import { clamp, norm } from "../_kit5/util.js";

export const FRAMES = 1800;
export const TOUCH_RADIUS = 80;
export const TAP_FRAMES = 7;                       // a touch this short (or shorter) is a tap or a flick
export const TAP_PX = 4;                           // a tap moves less than this, a flick more than FLICK_PX, in between nothing
export const FLICK_PX = 12;
export const GROUND = 10;                          // ground point = centre + this
export const MON_RADIUS = 8;
export const DASH_GROW = 8;

// table a/1/7/0 member 9 by raw stat 0..4
export const DASH_POWER = [1.5, 1.7, 2.0, 2.3, 2.6];     // by Power: px/step, x3 while dashing
export const DASH_DAMAGE = [6, 8, 10, 12, 20];           // by Power: stamina a dash hit takes (x2)
export const MAX_STAMINA = [70, 80, 90, 100, 120];       // by Stamina
export const WALK = [2.0, 2.5, 3.0, 3.5, 4.0];           // by Speed
export const PRESS = [15, 10, 15, 25, 30];               // by Jump: push of a press and the stamina it takes
export const JUMP_HEIGHTS = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  [8, 14, 18, 20, 21, 22, 22, 23, 23, 24],
  [10, 18, 24, 28, 29, 30, 30, 31, 31, 32],
  [10, 19, 27, 33, 37, 38, 38, 39, 39, 40],
  [10, 19, 27, 34, 40, 44, 45, 46, 47, 48],
];
export const FALL_SPEED = [0, 8, 8, 8, 8];

export const START = [[72, 96], [184, 96], [64, 136], [192, 136]];        // ground points
export const CPU_SPOT = [[48, 64], [208, 64], [32, 160], [224, 160]];      // ground points
export const HUMAN_SPOT = [[48, 48, 64], [208, 48, 64], [32, 144, 64], [224, 144, 64]];  // centre space, radius
export const SWITCH_BUTTON = { x0: 104, x1: 159, y0: 0, y1: 31 };
const EDGE = [[32, 160], [48, 64], [208, 64], [224, 160]];

export const ST = { STAND: 1, STAGGER: 2, FALL_OUT: 3, RETURN: 4, DASH_START: 5, DASH: 6, DASH_END: 7, JUMP_START: 8, JUMP_RISE: 9, JUMP_TOP: 10, JUMP_FALL: 11, LANDING: 12 };
const { STAND, STAGGER, FALL_OUT, RETURN, DASH_START, DASH, DASH_END, JUMP_START, JUMP_RISE, JUMP_TOP, JUMP_FALL, LANDING } = ST;

const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

/** the 4-way heading the CPU compares (1 up, 2 down, 3 left, 4 right) */
export function direction(vx, vy) {
  const a = Math.floor((((Math.atan2(vy, vx) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI) * 65536) & 0xffff;
  if (a <= 0x2000 || a >= 0xe000) return 4;
  if (a > 0x2000 && a < 0x6000) return 2;
  if (a >= 0x6000 && a <= 0xa000) return 3;
  return 1;
}

/** is a ground point inside the trapezoid of the ring? */
export function insideRing(gx, gy) {
  if (!(gy >= 64 && gy <= 160)) return false;
  const [x0, y0] = EDGE[0], [x1, y1] = EDGE[1], [x2, y2] = EDGE[2], [x3, y3] = EDGE[3];
  const left = ((y1 - y0) * (gx - x0)) / (x1 - x0) + y0;
  const right = ((y3 - y2) * (gx - x2)) / (x3 - x2) + y2;
  return gy >= left && gy >= right;
}

export function onSwitchButton(x, y) {
  return x >= SWITCH_BUTTON.x0 && x <= SWITCH_BUTTON.x1 && y >= SWITCH_BUTTON.y0 && y <= SWITCH_BUTTON.y1;
}

class Member {
  constructor(st) {
    this.st = st;
    this.dashPower = DASH_POWER[st.power];
    this.dashDamage = DASH_DAMAGE[st.power];
    this.maxSta = MAX_STAMINA[st.stamina];
    this.speed = WALK[st.speed];
    this.pressPower = PRESS[st.jump];
    this.pressDamage = PRESS[st.jump];
    this.jtype = st.jump;
    this.sta = this.maxSta;
    this.c = { failed: 0, jumped: 0, points: 0, hit: 0, fell: 0, dashed: 0, switched: 0, selfImpeded: 0 };
  }
}

class Part {
  constructor(idx, stats3) {
    this.idx = idx;
    this.members = stats3.map((s) => new Member(s));
    this.mem = 0;
    const [gx, gy] = START[idx];
    this.pos = [gx, gy - GROUND]; this.ppos = this.pos.slice();
    this.dest = this.pos.slice();
    this.vel = [0, 0];
    this.state = STAND;
    this.score = 0;
    this.attacker = null; this.attackerState = 0;
    this.pushed = false; this.exhausted = false; this.switching = false; this.switchState = 0;
    this.jumpReq = false; this.hasTarget = false; this.target = [0, 0];
    this.height = 0; this.fall = 0;
    this.stagger = 0; this.dashF = 0; this.jumpF = 0; this.fallOutF = 0; this.restF = 0; this.hitF = 0; this.retF = 0;
    this.dashDir = [0, 0]; this.direction = 2; this.swT = 0;
    this.hitMark = 0;
    // the person's touch, as the host keeps it
    this.touch = { started: false, touching: false, frames: 0, lastFrames: 0, onMon: false, x: 0, y: 0, sx: 0, sy: 0 };
  }
  get m() { return this.members[this.mem]; }
  get gx() { return this.pos[0]; }
  get gy() { return this.pos[1] + GROUND; }
}

export class RingDropSim {
  /**
   * @param o.stats   4 teams x 3 members of { power, speed, jump, stamina } raw 0-4
   * @param o.rand    makeRand(ctx.rng)
   * @param o.human   participant index a person steers, or -1
   * @param o.humans  several people (a room with friends): the participants they steer; wins over o.human
   * @param o.cpu     per participant: 0 normal, 1 Supreme (the same rules; the stronger teams make the difference)
   */
  constructor(o) {
    this.rand = o.rand;
    const people = o.humans ?? (o.human >= 0 ? [o.human] : []);
    this.humans = new Set(people);
    this.human = people.length ? people[0] : -1;      // the first person (the only one in a single-player event)
    this.parts = o.stats.map((s, i) => new Part(i, s));
    this.contacts = [0, 1, 2, 3].map(() => [0, 0, 0, 0]);
    this.timer = FRAMES;
    this.seconds = 60;
    this.cpus = this.parts.map(() => ({ wait: 0, decisions: 0, period: 0, chased: -1, going: false, chasing: false }));
    this.events = [];
    this.steps = 0;
  }

  get over() { return this.timer <= 0; }
  /** The CPU takes a person's participant over (they left the room). */
  takeOver(idx) {
    if (!this.humans.has(idx)) return;
    this.humans.delete(idx);
    this.human = this.humans.size ? [...this.humans][0] : -1;
    const tc = this.parts[idx].touch;
    tc.started = false; tc.touching = false; tc.onMon = false; tc.frames = 0;
  }
  get scores() { return this.parts.map((p) => p.score); }

  // ------------------------------------------------------------------------------------------------------------- helpers
  nextMember(p) { p.mem = (p.mem + 1) % 3; }
  resetToStart(p) {
    const [gx, gy] = START[p.idx];
    p.pos = [gx, gy - GROUND]; p.dest = p.pos.slice(); p.vel = [0, 0];
    p.direction = 2; p.pushed = false; p.jumpReq = false; p.hasTarget = false;
    p.ppos = p.pos.slice();
  }
  setState(p, st) {
    p.retF = st === RETURN ? 60 : 0;
    if (st === DASH_END) p.dashF = 16;
    p.state = st;
  }
  canAct(p) { return !p.pushed && !p.exhausted && !p.switching && p.state === STAND; }
  canSwitch(p) {
    if (!this.canAct(p)) return false;
    const [sx, sy, r] = HUMAN_SPOT[p.idx];
    return dist(p.pos[0], p.pos[1], sx, sy) <= r;
  }
  canCollide(p) { return p.state !== JUMP_TOP && !p.switching && p.state !== RETURN && p.state !== FALL_OUT; }
  outOfRing(p) {
    if (p.pos[0] <= 0 || p.pos[1] <= 0) return true;
    return !insideRing(p.pos[0], Math.trunc(p.pos[1] + GROUND));
  }
  /** a Pokémon in the ring at the moment: where its feet are */
  ground(p) { return [p.pos[0], p.pos[1] + GROUND]; }

  respawn(p) {
    p.m.sta = p.m.maxSta;
    this.nextMember(p);
    this.resetToStart(p);
    this.events.push({ type: "respawn", p: p.idx });
  }

  fallOut(p) {
    p.fallOutF = 60; p.stagger = 0;
    const a = p.attacker;
    const c = p.m.c;
    if (!a) {
      p.score = Math.max(0, p.score - 10);
      c.selfImpeded++;
    } else {
      a.score = Math.min(200, a.score + 10);
      a.m.c.points++;
      p.attacker = null;
    }
    c.fell++; c.failed++;
    this.setState(p, FALL_OUT);
    this.events.push({ type: "fallout", p: p.idx, by: a ? a.idx : -1, x: p.pos[0], y: p.pos[1] + GROUND });
  }

  startDash(p, tgt) {
    p.hasTarget = false;
    const d = norm(tgt[0] - p.pos[0], tgt[1] - p.pos[1]);
    p.dashDir = d;
    p.vel = [5 * d[0], 5 * d[1]];
    if (p.vel[0] !== 0 || p.vel[1] !== 0) {
      p.direction = direction(d[0], d[1]);
      p.dashF = 4;
      this.setState(p, DASH_START);
      p.m.c.dashed++;
      this.events.push({ type: "dash", p: p.idx });
    }
  }

  startJump(p) {
    p.jumpReq = false;
    p.jumpF = 5;
    if (p.m.jtype) p.m.c.jumped++;
    this.setState(p, JUMP_START);
    this.events.push({ type: "jump", p: p.idx });
  }

  staggerSet(p) {
    const f = 10 * (1 - p.m.sta / p.m.maxSta) - 3;
    p.stagger = Math.max(0, Math.trunc(f));
    this.setState(p, STAGGER);
  }

  land(p) {
    this.setState(p, LANDING);
    p.jumpF = 10; p.height = 0; p.dest = p.pos.slice();
  }

  startSwitch(p) {
    p.switching = true; p.switchState = 1; p.dest = p.pos.slice(); p.swT = 0;
    p.m.c.switched++;
    this.events.push({ type: "switch", p: p.idx });
  }

  // ------------------------------------------------------------------------------------------------------------- the step
  /**
   * cmd.touch: the person's finger { down, x, y } in field px (integers); cmd.act: direct actions of the person's Pokémon from keys or a pad:
   * { dest: [x, y] | null, jump, dash: [x, y] | null, swap }
   */
  step(cmd = {}, cmds = null) {
    const by = cmds || (this.human >= 0 ? { [this.human]: cmd } : {});
    this.events.length = 0;
    this.steps++;
    for (const p of this.parts) p.ppos = p.pos.slice();
    if (this.timer > 0) this.timer--;
    this.seconds = Math.ceil(this.timer / 30);
    if (this.timer <= 0) return;
    for (const p of this.parts) {
      if (this.humans.has(p.idx)) this.humanTouch(p, (by[p.idx] || {}).touch);
      this.switchMachine(p);
    }
    for (const p of this.parts) if (!this.humans.has(p.idx)) this.cpuUpdate(p.idx);
    for (const p of this.parts) { const c = by[p.idx]; if (this.humans.has(p.idx) && c && c.act) this.humanAct(p, c.act); }
    for (const p of this.parts) {
      const c = by[p.idx];
      if (this.humans.has(p.idx) && c && c.touch) this.touchToRequests(p);
      this.monUpdate(p);
    }
    this.updateCollisions();
    this.updateStamina();
  }

  // ------------------------------------------------------------------------------------------------------------- the person
  humanTouch(p, t) {
    const tc = p.touch;
    if (t && t.down) {
      if (tc.started && tc.touching) tc.started = false;
      else if (!tc.started && !tc.touching) {
        tc.started = true; tc.touching = true; tc.sx = t.x; tc.sy = t.y;
      }
      tc.x = t.x; tc.y = t.y;
      tc.frames++;
    } else if (tc.touching) {
      tc.lastFrames = tc.frames; tc.frames = 0; tc.started = false; tc.touching = false;
    }
  }

  touchToRequests(p) {
    const tc = p.touch;
    if (tc.started) {
      if (onSwitchButton(tc.x, tc.y)) {
        if (this.canSwitch(p)) this.startSwitch(p);
      } else if (!p.switching && p.state !== FALL_OUT && dist(p.pos[0], p.pos[1], tc.x, tc.y) < TOUCH_RADIUS) {
        tc.onMon = true;
      }
    } else if (tc.touching) {
      if (tc.onMon) {
        if (p.state === FALL_OUT) tc.onMon = false;
        else if (Math.abs(tc.x - Math.trunc(p.pos[0])) > 1 || Math.abs(tc.y - Math.trunc(p.pos[1])) > 1) p.dest = [tc.x, tc.y];
      }
    } else if (tc.lastFrames) {
      if (tc.onMon && (p.state === STAND || p.state === RETURN) && !p.exhausted && !p.switching) {
        const d = dist(tc.sx, tc.sy, tc.x, tc.y);
        if (d < TAP_PX) {
          if (tc.lastFrames <= TAP_FRAMES) { p.jumpReq = true; p.hasTarget = false; }
        } else if (!(d < FLICK_PX) && tc.lastFrames <= TAP_FRAMES) {
          p.hasTarget = true; p.jumpReq = false; p.target = [tc.x, tc.y];
        }
      }
      tc.onMon = false;
    }
  }

  /** keyboard / pad: the same requests a finger makes */
  humanAct(p, a) {
    if (a.swap && this.canSwitch(p)) this.startSwitch(p);
    if (p.switching || p.state === FALL_OUT) return;
    if (a.dest && !p.exhausted) p.dest = [a.dest[0], a.dest[1]];
    if (!p.exhausted && (p.state === STAND || p.state === RETURN)) {
      if (a.jump) { p.jumpReq = true; p.hasTarget = false; }
      else if (a.dash) { p.hasTarget = true; p.jumpReq = false; p.target = [a.dash[0], a.dash[1]]; }
    }
  }

  // ------------------------------------------------------------------------------------------------------------- the switch
  switchMachine(p) {
    if (!p.switching) return;
    const human = this.humans.has(p.idx);
    const swapAt = human ? 11 : 19, total = human ? 22 : 38;
    p.swT++;
    if (p.swT >= swapAt && p.switchState === 1) {
      this.nextMember(p);
      this.resetToStart(p);
      p.switchState = 2;
      this.events.push({ type: "swapped", p: p.idx });
    } else if (p.swT >= total && p.switchState === 2) {
      p.switching = false; p.switchState = 0;
      this.setState(p, RETURN);
    }
  }

  // ------------------------------------------------------------------------------------------------------------- movement
  move(p) {
    const dx = p.dest[0] - p.pos[0], dy = p.dest[1] - p.pos[1];
    const d = Math.hypot(dx, dy);
    let moving = d > 0;
    let mdx = dx, mdy = dy, md = d;
    if (p.pushed) {
      const speed = p.attackerState === DASH || p.attackerState === JUMP_RISE ? 1.0 : 0.7;
      if (p.stagger <= 0) {
        const [nx, ny] = norm(p.vel[0], p.vel[1]);
        const dec = [Math.abs(speed * nx), Math.abs(speed * ny)];
        for (let k = 0; k < 2; k++) {
          const v = p.vel[k];
          if (v !== 0) p.vel[k] = Math.abs(v) < dec[k] ? 0 : v - dec[k] * Math.sign(v);
        }
      }
      p.pos[0] += p.vel[0]; p.pos[1] += p.vel[1];
      p.dest = p.pos.slice();
      if (p.vel[0] !== 0 || p.vel[1] !== 0) return;
      this.contacts[p.idx] = [0, 0, 0, 0];
      p.attacker = null; p.pushed = false;
      mdx = p.dest[0] - p.pos[0]; mdy = p.dest[1] - p.pos[1]; md = Math.hypot(mdx, mdy); moving = md > 0;
    }
    if (!p.exhausted && p.stagger <= 0 && moving) {
      const [nx, ny] = norm(mdx, mdy);
      if (!p.pushed) p.direction = direction(nx, ny);
      let sp = p.m.speed;
      if (p.m.sta < 30) sp *= 0.5;
      if (md <= sp) { p.pos[0] += mdx; p.pos[1] += mdy; }
      else { p.pos[0] += sp * nx; p.pos[1] += sp * ny; }
      p.dashDir = [nx, ny];
    }
  }

  applyGravity(p) {
    if (p.state >= JUMP_RISE && p.state <= JUMP_FALL) return;
    if (p.height <= 0) { p.fall = 0; return; }
    p.height -= p.fall;
    if (p.height < 0) p.height = 0;
    p.fall += 2;
  }

  monUpdate(p) {
    if (p.hitF > 0) { p.hitF--; if (p.hitF > 0) return; }
    if (p.hitMark > 0) p.hitMark--;
    let st = p.state;
    if (st === DASH) {
      p.vel[0] += 0.7 * p.dashDir[0]; p.vel[1] += 0.7 * p.dashDir[1];
      p.pos[0] += p.vel[0]; p.pos[1] += p.vel[1];
    } else if (st === DASH_START || st === DASH_END || st === JUMP_START || st === JUMP_TOP || st === JUMP_FALL || st === LANDING) {
      // no walking
    } else this.move(p);
    st = p.state;
    switch (st) {
      case RETURN:
        if (this.outOfRing(p)) this.fallOut(p);
        else if (p.jumpReq) this.startJump(p);
        else if (p.hasTarget) this.startDash(p, p.target);
        else if (--p.retF <= 0) this.setState(p, STAND);
        break;
      case FALL_OUT:
        if (--p.fallOutF <= 0) { this.respawn(p); this.setState(p, RETURN); }
        break;
      case STAGGER:
        if (this.outOfRing(p)) this.fallOut(p);
        else if (--p.stagger <= 0) this.setState(p, STAND);
        break;
      case STAND:
        if (this.outOfRing(p)) this.fallOut(p);
        else if (!p.pushed) {
          if (p.jumpReq) this.startJump(p);
          else if (p.hasTarget) this.startDash(p, p.target);
        }
        break;
      case JUMP_START:
        if (--p.jumpF <= 0) { p.jumpF = 0; this.setState(p, JUMP_RISE); }
        break;
      case JUMP_RISE:
        p.height = JUMP_HEIGHTS[p.m.jtype][p.jumpF]; p.jumpF++;
        if (p.jumpF >= 10) { p.jumpF = 10; this.setState(p, JUMP_TOP); }
        break;
      case JUMP_TOP:
        if (--p.jumpF <= 0) { p.jumpF = 0; this.setState(p, JUMP_FALL); }
        break;
      case JUMP_FALL:
        if (p.height === 0) {
          this.land(p);
          if (this.outOfRing(p)) this.fallOut(p);
        } else {
          p.height -= FALL_SPEED[p.m.jtype];
          if (p.height <= 0) p.height = 0;
        }
        break;
      case LANDING:
        if (--p.jumpF <= 0) this.setState(p, STAND);
        break;
      case DASH_START:
        if (--p.dashF <= 0) { p.dashF = 6; this.setState(p, DASH); }
        break;
      case DASH:
        if (--p.dashF <= 0) { p.dest = p.pos.slice(); p.vel = [0, 0]; this.setState(p, DASH_END); }
        break;
      case DASH_END:
        if (--p.dashF <= 0) {
          p.vel = [0, 0]; p.dest = p.pos.slice(); this.setState(p, STAND);
          if (this.outOfRing(p)) this.fallOut(p);
        }
        break;
      default: break;
    }
    this.applyGravity(p);
  }

  // ------------------------------------------------------------------------------------------------------------- collisions
  touching(a, b) {
    if (Math.abs(a.height - b.height) > 5) return false;
    const ra = MON_RADIUS + (a.state === DASH ? DASH_GROW : 0);
    const rb = MON_RADIUS + (b.state === DASH ? DASH_GROW : 0);
    return dist(a.pos[0], a.pos[1], b.pos[0], b.pos[1]) <= ra + rb;
  }

  push(tgt, src, d) {
    if (tgt.state === JUMP_FALL) return false;
    let power = src.m.dashPower, damage = src.m.dashDamage;
    if (src.state === DASH) {
      power *= 3; damage *= 2;
      src.score = Math.min(200, src.score + 1);
      src.m.c.points++; src.m.c.hit++;
    } else if (src.state === JUMP_FALL) {
      power = src.m.pressPower; damage = src.m.pressDamage;
      src.score = Math.min(200, src.score + 2);
      src.m.c.points++; src.m.c.hit++;
    } else power = 3;
    tgt.vel[0] = clamp(tgt.vel[0] + power * d[0], -12, 12);
    tgt.vel[1] = clamp(tgt.vel[1] + power * d[1], -12, 12);
    src.direction = direction(d[0], d[1]);
    const attack = src.state === DASH || src.state === JUMP_FALL;
    if (attack) {
      tgt.hitF = 4; src.hitF = 4;
      tgt.m.sta = Math.max(0, tgt.m.sta - damage);
      tgt.hitMark = 6;
      this.events.push({ type: "hit", by: src.idx, to: tgt.idx, press: src.state === JUMP_FALL, x: tgt.pos[0], y: tgt.pos[1] + GROUND });
    }
    if (!tgt.attacker || attack) {
      tgt.attacker = src;
      if (src.attacker && src.attacker !== tgt) tgt.attacker = src.attacker;
    }
    tgt.pushed = true; tgt.attackerState = src.state;
    return true;
  }

  reaction(p) {
    if (!p.pushed) return 0;
    const st = p.state, ast = p.attackerState;
    if (st === JUMP_FALL) return 0;
    if (st === DASH_START || st === DASH || st === DASH_END || st === JUMP_START || st === LANDING) {
      if (ast === JUMP_FALL || ast === DASH) return 3;
      if (st === DASH) return 2;
      return 1;
    }
    if ((st === STAND || st === STAGGER || st === JUMP_RISE) && (ast === JUMP_FALL || ast === DASH)) return 3;
    return 0;
  }

  applyReaction(p, r) {
    if (r === 1) this.setState(p, STAND);
    else if (r === 2) { this.setState(p, DASH_END); p.dashF = 1; }
    else if (r === 3) this.staggerSet(p);
  }

  updateCollisions() {
    for (let i = 0; i < 4; i++) {
      const a = this.parts[i];
      if (!this.canCollide(a) || a.hitF > 0) continue;
      for (let j = i + 1; j < 4; j++) {
        const b = this.parts[j];
        if (!this.canCollide(b) || !this.touching(a, b)) continue;
        if (this.contacts[i][j] && !a.pushed) this.contacts[i][j] = this.contacts[j][i] = 0;
        if (this.contacts[i][j]) continue;
        let d = [a.pos[0] - b.pos[0], a.pos[1] - b.pos[1]];
        if (d[0] === 0 && d[1] === 0) d = [this.rand.int(64) - 32, this.rand.int(64) - 32];
        d = norm(d[0], d[1]);
        const pa = this.push(a, b, d);
        const pb = this.push(b, a, [-d[0], -d[1]]);
        const ra = this.reaction(a), rb = this.reaction(b);
        this.applyReaction(a, ra); this.applyReaction(b, rb);
        if (pa || pb) this.contacts[i][j] = this.contacts[j][i] = 1;
      }
    }
  }

  updateStamina() {
    for (const p of this.parts) {
      p.members.forEach((mem, k) => {
        let refill = 0;
        if (p.mem === k) {
          if (p.exhausted) {
            if (--p.restF <= 0) { mem.sta = 20; p.dest = p.pos.slice(); p.exhausted = false; }
          } else if (mem.sta <= 0) {
            p.restF = 60; p.exhausted = true; p.jumpReq = false; p.hasTarget = false;
            mem.c.failed++;
            this.events.push({ type: "exhausted", p: p.idx });
          }
        } else refill = 819 / 4096;
        mem.sta = Math.min(mem.maxSta, mem.sta + refill);
      });
    }
  }

  // ------------------------------------------------------------------------------------------------------------- the CPU
  cpuUpdate(i) {
    const p = this.parts[i], c = this.cpus[i];
    if (p.switching) return;
    if (c.chasing && !c.going) {
      const ch = c.chased;
      if (ch >= 0 && (this.parts[ch].state === FALL_OUT || this.parts[ch].switching || p.pushed)) { p.dest = p.pos.slice(); c.chasing = false; }
      else if (ch >= 0) p.dest = this.parts[ch].pos.slice();
    }
    if (c.going) {
      if (this.canAct(p)) {
        const [sx, sy] = CPU_SPOT[i];
        p.dest = [sx, sy];
        if (dist(p.pos[0], p.pos[1] + GROUND, sx, sy) <= 64) { this.startSwitch(p); p.dest = p.pos.slice(); c.going = false; }
        if (p.state === FALL_OUT) c.going = false;
      }
      return;
    }
    c.wait--;
    if (c.wait > 0) return;
    c.wait = 0;
    if (--c.period > 0) return;
    c.period = 3;
    if (!this.canAct(p)) return;
    this.decide(i);
    if (--c.decisions <= 0) {
      const pct = Math.trunc((100 * p.m.sta) / p.m.maxSta);
      const chance = pct < 10 ? 100 : pct < 20 ? 70 : pct < 30 ? 50 : pct < 40 ? 30 : pct < 50 ? 10 : 0;
      if (this.rand.int(100) < chance) c.going = true;
      c.decisions = 0;
    }
  }

  decide(i) {
    const p = this.parts[i], c = this.cpus[i];
    const kinds = [0, 0, 0, 0];
    let near = 0, close = 0;
    for (let j = 0; j < 4; j++) {
      if (j === i) continue;
      const o = this.parts[j];
      const d = dist(o.pos[0], o.pos[1], p.pos[0], p.pos[1]);
      const [nx, ny] = norm(o.pos[0] - p.pos[0], o.pos[1] - p.pos[1]);
      const dirc = direction(nx, ny);
      if (d <= 32) { kinds[j] = dirc === p.direction ? 3 : 1; close++; }
      else if (d <= 48) { if (dirc === p.direction) kinds[j] = 2; near++; }
    }
    let best = [0, 0];
    for (let j = 0; j < 4; j++) if (j !== i && best[1] < kinds[j]) best = [j, kinds[j]];
    const chances = [0, 10, 50, 80];
    if (this.rand.int(100) < chances[best[1]]) {
      const o = this.parts[best[0]];
      p.target = [Math.trunc(o.pos[0]), Math.trunc(o.pos[1])]; p.hasTarget = true; p.jumpReq = false;
      c.wait = 16;
      return;
    }
    let chance = 0;
    if (near) chance += 5;
    if (close) chance += [5, 10, 30][close - 1];
    if (this.rand.int(100) < chance) { p.jumpReq = true; p.hasTarget = false; c.wait = 20; return; }
    const roll = this.rand.int(100);
    if (roll < 60) {
      const roll2 = this.rand.int(100);
      if (c.chasing) return;
      let first = -1, second = -1, mn = 999;
      for (let j = 0; j < 4; j++) {
        const o = this.parts[j];
        if (j !== i && o.state !== FALL_OUT && o.state !== RETURN && !o.switching && mn > Math.trunc(o.m.sta)) { second = first; first = j; mn = Math.trunc(o.m.sta); }
      }
      c.chased = roll2 < 60 ? first : second;
      if (c.chased !== -1) { c.chasing = true; c.wait = 0; }
    } else if (roll < 80) c.wait = 10;
    else {
      p.dest = [this.rand.int(145) + 56, this.rand.int(80) + 72];
      c.wait = 10;
    }
  }

  result() {
    return this.parts.map((p) => ({ points: p.score, mons: p.members.map((m) => ({ ...m.c })) }));
  }
}
