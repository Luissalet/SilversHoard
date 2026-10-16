// Circle Push rules (SPEC 30), with no screen: twelve Pokémon on one ring, dragged by a finger (or a CPU that acts like one), shoving
// each other; after each of six rounds the ones standing in a bonus zone score its points. 30 steps a second.
import { stat } from "../_kit/index.js";

export const RING = { x0: 16, y0: 16, x1: 240, y1: 176 };
export const RADIUS = 8;
export const TOUCH_RADIUS = 80;
export const ROUNDS = 6;
export const TILES = 43;
export const ROUND_INTERVAL = [8, 6, 6, 4, 4, 4];
export const TARGET_SCORE = 40;

export const PUSH_SPEED = [0.5, 1.0, 1.3, 1.6, 2.2]; // by Power, px per frame
export const MAX_STAMINA = [30, 40, 50, 60, 70]; // by Stamina, frames of pushing
export const RUN_SPEED = [2.0, 2.4, 2.8, 3.0, 3.5]; // by Speed

export const START = [
  [[40, 40], [40, 72], [88, 40]],
  [[216, 40], [168, 40], [216, 72]],
  [[40, 168], [88, 168], [40, 146]],
  [[216, 168], [216, 146], [168, 168]],
];

export const ZONE_KINDS = { 1: { r: 56, pts: 1 }, 2: { r: 32, pts: 2 }, 3: { r: 24, pts: 3 }, 4: { r: 16, pts: 5 } };
const Z = (...zs) => zs.map(([kind, x, y]) => ({ kind, x, y, r: ZONE_KINDS[kind].r, pts: ZONE_KINDS[kind].pts }));
export const LAYOUTS = [
  Z([1, 128, 96]),
  Z([3, 64, 64], [2, 144, 104]),
  Z([3, 200, 64], [2, 96, 112]),
  Z([3, 128, 56], [2, 128, 128]),
  Z([2, 192, 64], [3, 136, 56]),
  Z([2, 88, 80], [3, 200, 128]),
  Z([2, 64, 64], [2, 192, 64], [4, 56, 136]),
  Z([2, 72, 96], [3, 144, 96], [4, 200, 96]),
  Z([2, 192, 64], [3, 64, 96], [4, 184, 144]),
  Z([3, 144, 56], [2, 96, 136], [4, 184, 104]),
  Z([4, 208, 48], [2, 128, 96], [4, 48, 144]),
  Z([4, 128, 56], [3, 128, 96], [4, 128, 136]),
  Z([4, 200, 48], [3, 72, 96], [4, 184, 144]),
  Z([4, 104, 48], [3, 168, 112], [4, 48, 144]),
  Z([4, 48, 48], [4, 208, 48], [3, 128, 128]),
];
/** The layouts a round draws from: round 0 is always layout 0. */
export const SETS = [[0], [1, 2, 3, 4, 5], [1, 2, 3, 4, 5], [6, 7, 8, 9], [10, 11, 12, 13, 14], [10, 11, 12, 13, 14]];

const CPU_INTERVAL = 20;
const CELL = 32;
const COLS = 7;
const ROWS = 5;
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

export class Match {
  constructor({ teams, rng, humanTeam = -1, humanTeams = null }) {
    this.teams = teams;
    this.rng = rng;
    this.humans = new Set(humanTeams || (humanTeam >= 0 ? [humanTeam] : []));
    this.humanTeam = this.humans.size ? [...this.humans][0] : -1;
    this.frame = 0;
    this.over = false;
    this.events = [];
    this.round = 0;
    this.layout = 0; // the zones in force
    this.next = null; // the layout announced for the next round (during the break)
    this.phase = "play"; // play | end | score | break
    this.phaseT = 0;
    this.tickT = 0;
    this.timer = 0;
    this.playT = 0;
    this.queue = [];
    this.roundPoints = [];
    this.mons = [];
    for (let t = 0; t < 4; t++) {
      for (let s = 0; s < 3; s++) {
        const mon = teams[t].mons[s];
        const [x, y] = START[t][s];
        this.mons.push({
          team: t, member: s, id: t * 3 + s, x, y, tx: x, ty: y, state: 1,
          pushSpeed: PUSH_SPEED[stat(mon, "power")], runSpeed: RUN_SPEED[stat(mon, "speed")], maxStamina: MAX_STAMINA[stat(mon, "stamina")],
          stamina: MAX_STAMINA[stat(mon, "stamina")], exhausted: false, exhaustTimer: 0, boost: 0, boostTimer: 0,
          pushing: false, blocked: false, targetOut: false, score: 0, face: 0, moved: 0, ghostT: 0, touch: [],
          c: { failed: 0, fell: 0, points: 0, impeded: 0 },
        });
      }
    }
    this.held = [-1, -1, -1, -1];
    this.stylus = [null, null, null, null];
    this.cpu = teams.map((_, t) => ({ cursor: 0, skips: 0, on: !this.humans.has(t) }));
    this.skipBudget = 3;
  }

  push(type, extra) { this.events.push({ type, frame: this.frame, ...extra }); }
  drain() { const e = this.events; this.events = []; return e; }

  mon(team, member) { return this.mons[team * 3 + member]; }
  /** The CPU takes over a team a person left (a room with friends). */
  takeOver(team) {
    if (!this.humans.delete(team)) return;
    this.cpu[team].on = true;
    this.cpu[team].skips = 0;
    this.touchUp(team);
    if (this.humanTeam === team) this.humanTeam = this.humans.size ? [...this.humans][0] : -1;
  }

  teamMons(team) { return this.mons.slice(team * 3, team * 3 + 3); }
  get zones() { return LAYOUTS[this.layout]; }
  get interval() { return ROUND_INTERVAL[Math.min(this.round, ROUNDS - 1)]; }
  inRing(x, y) { return x >= RING.x0 && x < RING.x1 && y >= RING.y0 && y < RING.y1; }
  zoneAt(x, y, zones = this.zones) { return zones.filter((z) => dist(x, y, z.x, z.y) < z.r); }
  playing() { return this.phase === "play"; }

  // ---- the person's finger (or the keyboard's cursor) --------------------------------------------------------------------------
  /** A fresh touch at (x, y): the nearest of the team's Pokémon in the ring within 80 px is held and gets the boost. Returns its member or -1. */
  touchDown(team, x, y) {
    if (!this.playing()) return -1;
    let best = -1;
    let bd = TOUCH_RADIUS;
    for (const m of this.teamMons(team)) {
      if (m.state !== 1) continue;
      const d = dist(x, y, m.x, m.y);
      if (d <= bd) { bd = d; best = m.member; }
    }
    this.held[team] = best;
    this.stylus[team] = { x, y };
    if (best >= 0) {
      const m = this.mon(team, best);
      this.freshTouch(m);
      this.follow(m, x, y);
    }
    return best;
  }

  touchMove(team, x, y) {
    this.stylus[team] = { x, y };
    const h = this.held[team];
    if (h >= 0) this.follow(this.mon(team, h), x, y);
  }

  /** The finger lifts: the Pokémon is let go and keeps running to the last point it was dragged to. */
  touchUp(team) { this.held[team] = -1; this.stylus[team] = null; }

  follow(m, x, y) {
    if (m.exhausted || m.state !== 1) return;
    m.tx = x; m.ty = y;
    m.targetOut = !this.inRing(x, y);
  }

  /** The keyboard and the pad: hold `member` with the cursor at (x, y) without a new touch. */
  hold(team, member, x, y) {
    if (!this.playing()) return;
    const m = this.mon(team, member);
    this.held[team] = m && m.state === 1 && !m.exhausted ? member : -1;
    this.stylus[team] = { x, y };
    if (this.held[team] >= 0) this.follow(m, x, y);
  }

  /** A fresh touch on the held Pokémon (the keyboard's burst button). */
  burst(team) {
    const h = this.held[team];
    if (h >= 0 && this.playing()) this.freshTouch(this.mon(team, h));
  }

  freshTouch(m) { m.boost = 2; m.boostTimer = 3; }

  // ---- the CPU -----------------------------------------------------------------------------------------------------------------
  cellOf(x, y) { return { c: Math.max(0, Math.min(COLS - 1, Math.floor((x - RING.x0) / CELL))), r: Math.max(0, Math.min(ROWS - 1, Math.floor((y - RING.y0) / CELL))) }; }

  cpuPick(m) {
    const rng = this.rng;
    const cur = this.cellOf(m.x, m.y);
    const cells = [];
    const consider = (c, r) => {
      const x0 = RING.x0 + c * CELL;
      const y0 = RING.y0 + r * CELL;
      let sx = x0 + rng() * CELL;
      let sy = y0 + rng() * CELL;
      let s = 0;
      const zones = this.zones;
      const centre = zones.find((z) => z.x >= x0 && z.x < x0 + CELL && z.y >= y0 && z.y < y0 + CELL);
      const inZone = zones.some((z) => dist(sx, sy, z.x, z.y) < z.r);
      if (inZone) s += 5;
      if (centre) { s += 4; sx = centre.x; sy = centre.y; }
      let others = 0;
      for (const o of this.mons) {
        if (o === m || o.state !== 1) continue;
        if (o.x >= x0 && o.x < x0 + CELL && o.y >= y0 && o.y < y0 + CELL) others += o.team !== m.team && o.pushSpeed > m.pushSpeed ? 2 : 1;
      }
      if (m.exhausted || m.state !== 1) {
        s = (others === 0 ? 2 : 0) + (c === cur.c && r === cur.r ? 2 : 0) + (inZone ? 4 : 0);
      } else s -= others;
      cells.push({ s, x: sx, y: sy });
    };
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const c = cur.c + dc;
        const r = cur.r + dr;
        if (c >= 0 && c < COLS && r >= 0 && r < ROWS) consider(c, r);
      }
    }
    let best = Math.max(...cells.map((x) => x.s));
    if (best < 3) {
      cells.length = 0;
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) consider(c, r);
      best = Math.max(...cells.map((x) => x.s));
    }
    const ties = cells.filter((x) => x.s === best);
    return ties[Math.min(ties.length - 1, Math.floor(rng() * ties.length))];
  }

  cpuTurn() {
    for (let t = 0; t < 4; t++) {
      const st = this.cpu[t];
      if (!st.on) continue;
      const member = 2 - (st.cursor % 3);
      st.cursor++;
      if (st.skips < this.skipBudget && this.rng() < 0.3) { st.skips++; continue; }
      const m = this.mon(t, member);
      if (m.state !== 1) continue;
      const pick = this.cpuPick(m);
      m.tx = pick.x; m.ty = pick.y;
      m.targetOut = false;
      this.freshTouch(m);
    }
  }

  // ---- movement ----------------------------------------------------------------------------------------------------------------
  /** Spread a push from `from` with vector v through the Pokémon in front of it (depth first, each at most once). */
  propagate(from, vx, vy, disp, seen) {
    for (const o of from.touch) {
      if (seen.has(o)) continue;
      const dx = o.x - from.x;
      const dy = o.y - from.y;
      const dl = Math.hypot(dx, dy) || 1e-6;
      const dot = vx * dx + vy * dy;
      if (dot <= 0) continue;
      const vl = Math.hypot(vx, vy) || 1e-6;
      const cos = dot / (vl * dl);
      let px = vx;
      let py = vy;
      if (cos < Math.SQRT1_2) { px = (dot / (dl * dl)) * dx; py = (dot / (dl * dl)) * dy; }
      seen.add(o);
      const d = disp.get(o) || { x: 0, y: 0 };
      d.x += px; d.y += py;
      disp.set(o, d);
      this.propagate(o, px, py, disp, seen);
    }
  }

  moveMons() {
    const live = this.mons.filter((m) => m.state === 1);
    for (const m of live) m.touch = [];
    for (let a = 0; a < live.length; a++) {
      for (let b = a + 1; b < live.length; b++) {
        if (dist(live[a].x, live[a].y, live[b].x, live[b].y) <= RADIUS * 2) { live[a].touch.push(live[b]); live[b].touch.push(live[a]); }
      }
    }
    const disp = new Map();
    const steps = [];
    for (const m of live) {
      m.pushing = false;
      m.blocked = false;
      m.moved = 0;
      if (this.held[m.team] === m.member && this.stylus[m.team]) this.follow(m, this.stylus[m.team].x, this.stylus[m.team].y);
      const dx = m.tx - m.x;
      const dy = m.ty - m.y;
      const dl = Math.hypot(dx, dy);
      const arrived = dl < 1e-6;
      if (!arrived) {
        const ux = dx / dl;
        const uy = dy / dl;
        m.face = Math.atan2(uy, ux);
        let step = m.exhausted ? 0.5 : m.runSpeed;
        if (dl <= step) step = dl;
        const front = m.touch.some((o) => ux * (o.x - m.x) + uy * (o.y - m.y) > 0);
        if (front) {
          m.blocked = true;
          if (!m.exhausted) {
            m.pushing = true;
            const sp = m.pushSpeed + m.boost;
            const vx = ux * sp;
            const vy = uy * sp;
            this.propagate(m, vx, vy, disp, new Set([m]));
            m.stamina--;
            if (m.stamina <= 0) {
              m.stamina = 0;
              m.exhausted = true;
              m.exhaustTimer = 60;
              m.tx = m.x; m.ty = m.y;
              if (this.held[m.team] === m.member) this.held[m.team] = -1;
              this.push("exhaust", { team: m.team, member: m.member });
            }
          }
        } else steps.push([m, ux * step, uy * step]);
      }
      if (!m.pushing && (!m.blocked || arrived)) {
        if (m.exhausted) {
          m.exhaustTimer--;
          if (m.exhaustTimer <= 0) { m.exhausted = false; m.stamina = m.maxStamina; }
        } else m.stamina = Math.min(m.maxStamina, m.stamina + 2);
      }
    }
    for (const [m, sx, sy] of steps) { m.x += sx; m.y += sy; m.moved = Math.hypot(sx, sy); }
    for (const [m, d] of disp) {
      m.x += d.x; m.y += d.y;
      m.moved = Math.max(m.moved, Math.hypot(d.x, d.y));
      if (!m.pushing && this.held[m.team] !== m.member) { m.tx = m.x; m.ty = m.y; }
      else if (this.held[m.team] !== m.member) {
        const bx = m.tx - m.x;
        const by = m.ty - m.y;
        if (bx * d.x + by * d.y < 0) { m.tx = m.x; m.ty = m.y; }
      }
    }
    for (const m of live) {
      if (m.boostTimer > 0) { m.boostTimer--; if (m.boostTimer === 0) m.boost = 0; }
    }
    // out of the ring
    for (const m of live) {
      if (!this.inRing(m.x, m.y)) {
        const own = m.targetOut && this.held[m.team] === m.member;
        m.state = 0;
        m.stamina = m.maxStamina; m.exhausted = false; m.exhaustTimer = 0; m.pushing = false; m.boost = 0; m.boostTimer = 0;
        m.c.failed++;
        m.c.fell++;
        if (own || m.targetOut) m.c.impeded++;
        if (this.held[m.team] === m.member) this.held[m.team] = -1;
        this.push("out", { team: m.team, member: m.member, x: Math.max(RING.x0, Math.min(RING.x1, m.x)), y: Math.max(RING.y0, Math.min(RING.y1, m.y)) });
      }
    }
    // ghosts come back as soon as nobody stands on them
    for (const m of this.mons) {
      if (m.state !== 2) continue;
      m.ghostT++;
      if (!live.some((o) => o.state === 1 && dist(o.x, o.y, m.x, m.y) <= RADIUS * 2)) { m.state = 1; m.stamina = m.maxStamina; }
    }
  }

  // ---- the rounds --------------------------------------------------------------------------------------------------------------
  endRound() {
    for (const m of this.mons) {
      if (m.state === 1 || m.state === 2) {
        m.tx = m.x; m.ty = m.y; m.boost = 0; m.boostTimer = 0; m.stamina = m.maxStamina; m.exhausted = false; m.exhaustTimer = 0; m.pushing = false;
      }
    }
    this.held = [-1, -1, -1, -1];
    this.stylus = [null, null, null, null];
    this.phase = "end";
    this.phaseT = 0;
    this.push("roundEnd", { round: this.round });
  }

  buildQueue() {
    this.queue = [];
    for (const z of this.zones) {
      for (const m of this.mons) if (m.state === 1 && dist(m.x, m.y, z.x, z.y) < z.r) this.queue.push({ m, pts: z.pts, zone: z });
    }
  }

  chooseLayout() {
    const set = SETS[Math.min(this.round, ROUNDS - 1)];
    const pool = set.filter((l) => l !== this.layout);
    return pool.length ? pool[Math.min(pool.length - 1, Math.floor(this.rng() * pool.length))] : set[0];
  }

  step() {
    if (this.over) return;
    this.frame++;
    if (this.phase === "play") {
      this.playT++;
      if (this.playT % CPU_INTERVAL === 1) this.cpuTurn();
      this.moveMons();
      this.tickT++;
      if (this.tickT >= this.interval) { this.tickT = 0; this.timer++; }
      if (this.timer >= TILES) this.endRound();
    } else if (this.phase === "end") {
      this.phaseT++;
      this.moveMons();
      if (this.phaseT >= 20) { this.buildQueue(); this.roundPoints.push([0, 0, 0, 0]); this.phase = "score"; this.phaseT = 0; }
    } else if (this.phase === "score") {
      this.phaseT++;
      if (this.queue.length && this.phaseT % 6 === 1) {
        const q = this.queue.shift();
        q.m.score += q.pts;
        q.m.c.points++;
        this.roundPoints[this.roundPoints.length - 1][q.m.team] += q.pts;
        this.push("credit", { team: q.m.team, member: q.m.member, pts: q.pts, x: q.m.x, y: q.m.y });
      }
      if (!this.queue.length && this.phaseT >= 18) {
        for (const m of this.mons) {
          if (m.state === 0) { const [x, y] = START[m.team][m.member]; m.x = x; m.y = y; m.tx = x; m.ty = y; m.state = 2; m.ghostT = 0; }
        }
        this.phase = "break";
        this.phaseT = 0;
      }
    } else if (this.phase === "break") {
      this.phaseT++;
      this.moveMons();
      if (this.phaseT === 30) {
        this.round++;
        if (this.round >= ROUNDS) { this.over = true; this.push("end"); return; }
        this.next = this.chooseLayout();
        this.push("announce", { round: this.round, layout: this.next });
      }
      if (this.phaseT >= 90) {
        this.layout = this.next;
        this.next = null;
        this.phase = "play";
        this.phaseT = 0;
        this.timer = 0;
        this.tickT = 0;
        this.playT = 0;
        for (const c of this.cpu) c.skips = 0;
        this.push("roundStart", { round: this.round });
      }
    }
  }

  scoreOf(team) { return this.teamMons(team).reduce((s, m) => s + m.score, 0); }

  result() {
    const raw = [0, 1, 2, 3].map((t) => this.scoreOf(t));
    const detail = [0, 1, 2, 3].map((t) => ({
      rounds: this.roundPoints.map((r) => r[t]),
      mons: this.teamMons(t).map((m) => ({ ...m.c, score: m.score })),
    }));
    return { raw, detail };
  }
}
