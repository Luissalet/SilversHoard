// Hurdle Dash without a screen (SPEC 4, event 0): three lanes per team, each Pokémon runs 4096 px and jumps the hurdles; the result of a
// team is the sum of its three finish times in frames. The person's lanes jump on a tap; every other lane is played by the CPU, which
// rolls a boost / trip / clean jump at each hurdle exactly as the game's CPU does (its rolls are made as the hurdle arrives).
import { stat } from "../_kit/index.js";

export const TRACK = 4096;
export const STOP = 0x1080;
export const SPAWN_AHEAD = 0x150;
/** The Pokémon's feet sit where a hurdle edge at world y = 391 touches them. */
export const Y_MON = 391;

export const TOP_SPEED = [2.8, 3.2, 3.6, 4.0, 4.6];   // by Speed (raw 0-4)
export const ACCEL = [0.1, 0.2, 0.2, 0.2, 0.4];         // by Skill
export const RISE = [4, 8, 8, 8, 9];                    // jump rise = fall frames, by Jump
export const HANG = [20, 10, 10, 20, 42];
const UP = { 1: [-2, -3, 6, 12, 16, 17, 18, 18], 2: [-2, -3, 6, 11, 15, 17, 18, 19], 3: [-2, -3, 6, 11, 15, 17, 18, 19], 4: [-2, -3, 6, 10, 14, 17, 18, 19, 20] };
const DOWN = { 1: [18, 18, 17, 16, 13, 10, 6, 0], 2: [20, 20, 19, 18, 17, 15, 11, 6], 3: [20, 20, 19, 18, 17, 15, 11, 6], 4: [20, 20, 19, 18, 17, 15, 11, 6, 0] };
export const BOOST_CHANCES = [[10, 50], [20, 50], [30, 60], [20, 70], [30, 70], [40, 80]]; // [boost, clear] of a CPU Pokémon, one drawn per Pokémon

// the three lane patterns (flag index = track px / 8) and the layouts the host draws among (SPEC 4, event 0)
export const PATTERNS = {
  A: [55, 103, 151, 214, 246, 270, 286, 326, 361, 364, 408, 414, 449],
  B: [71, 119, 167, 214, 238, 254, 294, 326, 346, 350, 392, 398, 459],
  C: [87, 135, 183, 214, 230, 262, 278, 326, 376, 379, 423, 429, 469],
};
export const LAYOUTS = [["A", "B", "C"], ["B", "C", "A"], ["C", "A", "B"]];

/** Frames of a jump by phase: rise, hang, fall. */
export const jumpFrames = (jumpStat) => ({ rise: RISE[jumpStat], hang: HANG[jumpStat], fall: RISE[jumpStat] });

/** Height above the ground (track px) of a jumping Pokémon; for the hop (jump 0) a squash value, never a height. */
export function jumpHeight(jumpStat, phase, timer) {
  if (jumpStat === 0) return phase === 1 ? -4 : phase === 3 ? 4 : 0;
  if (phase === 1) return UP[jumpStat][Math.min(timer, UP[jumpStat].length - 1)];
  if (phase === 2) return UP[jumpStat][UP[jumpStat].length - 1];
  return DOWN[jumpStat][Math.min(timer, DOWN[jumpStat].length - 1)];
}

export const hurdleY = (dist, flag) => dist - 8 * flag + 320;
export const roundTime = (frames) => 3 * Math.floor(frames / 3);

export function makeRunner(team, lane, mon, layoutLetter, rng, human) {
  const speedStat = stat(mon, "speed");
  const jumpStat = stat(mon, "jump");
  const skillStat = stat(mon, "skill");
  const chance = human ? [0, 0] : BOOST_CHANCES[Math.floor(rng() * 6)];
  return {
    team, lane, human,
    top: TOP_SPEED[speedStat], acc: ACCEL[skillStat], jumpStat,
    speed: 1.0, carry: 0, dist: 0, boost: 0,
    state: 0, phase: 0, timer: 0, tripTimer: 0, height: 0,
    queued: false, queuedAt: 0,
    finished: false, time: 0, estimated: false,
    jumps: 0, trips: 0, dashes: 0, queuedJumps: 0,
    boostChance: chance[0], clearChance: chance[1],
    hurdles: PATTERNS[layoutLetter].map((flag) => ({ flag, knocked: false, rolled: false })),
  };
}

export class Race {
  /**
   * teams: the four teams of the contract; humanTeam: the index of the team a person taps for (-1 = the CPU plays all), or humanTeams
   * for several people (a room with friends); focus: the team whose finish ends the race when nobody plays; rng: seeded generator.
   */
  constructor({ teams, rng, humanTeam = -1, humanTeams = null, focus = 0 }) {
    this.teams = teams;
    this.rng = rng;
    this.humans = new Set(humanTeams || (humanTeam >= 0 ? [humanTeam] : []));
    this.humanTeam = this.humans.size ? [...this.humans][0] : -1;
    this.focus = focus;
    this.layout = Math.floor(rng() * 3);
    this.frame = 0;
    this.events = [];
    this.over = false;
    this.runners = teams.map((t, ti) => t.mons.map((mon, lane) => makeRunner(ti, lane, mon, LAYOUTS[this.layout][lane], rng, this.humans.has(ti))));
  }

  all() { return this.runners.flat(); }
  push(type, r, extra = {}) { this.events.push({ type, team: r.team, lane: r.lane, ...extra }); }
  drain() { const e = this.events; this.events = []; return e; }

  /** The jump of a Pokémon: its air time starts; a tap inside the 24 px before a hurdle makes it a timed one (a boost). */
  startJump(r, from = 0) {
    r.state = 1;
    r.phase = 1;
    r.timer = from;
    r.height = jumpHeight(r.jumpStat, 1, from);
    r.jumps++;
    this.push("jump", r);
  }

  isTimed(r) {
    if (r.jumpStat === 0) return false;
    return r.hurdles.some((h) => !h.knocked && hurdleY(r.dist, h.flag) > Y_MON - 24 && hurdleY(r.dist, h.flag) <= Y_MON);
  }

  boostUp(r) {
    r.boost = Math.min(4, r.boost + 1);
    r.speed = r.top + 1.0;
    r.dashes++;
    this.push("boost", r);
  }

  trip(r, hurdle) {
    if (hurdle) hurdle.knocked = true;
    r.state = 2;
    r.tripTimer = 0;
    r.speed = 0.5;
    r.boost = 0;
    r.trips++;
    r.height = 0;
    this.push("trip", r);
  }

  /** A tap on lane `lane` of a person's team. */
  tap(lane, team = this.humanTeam) {
    const r = this.runners[team] && this.runners[team][lane];
    if (!r || r.finished || this.over) return;
    if (r.state === 0) {
      const timed = this.isTimed(r);
      this.startJump(r);
      if (timed) this.boostUp(r);
    } else if (r.state === 1 && r.phase === 3) {
      r.queued = true;
      r.queuedAt = this.frame;
      r.queuedJumps++;
    }
  }

  contact(r) {
    return r.hurdles.find((h) => { const y = hurdleY(r.dist, h.flag); return !h.knocked && y >= 390 && y <= 408; }) || null;
  }

  stepRunner(r) {
    // acceleration, then the move
    if (!r.finished && r.state !== 2 && r.boost === 0 && r.speed < r.top) r.speed = Math.min(r.top, r.speed + r.acc);
    const px = r.speed + r.carry;
    const whole = Math.floor(px);
    r.carry = px - whole;
    if (r.dist < STOP) r.dist += whole;
    if (r.dist >= STOP) { r.dist = STOP; r.speed = 0; }
    if (!r.finished && r.dist >= TRACK) {
      r.finished = true;
      r.time = this.frame;
      this.push("finish", r, { time: r.time });
    }
    // the jump
    if (r.state === 1) {
      const f = jumpFrames(r.jumpStat);
      r.timer++;
      if (r.phase === 1 && r.timer >= f.rise) { r.phase = 2; r.timer = 0; }
      else if (r.phase === 2 && r.timer >= f.hang) { r.phase = 3; r.timer = 0; }
      else if (r.phase === 3 && r.timer >= f.fall) {
        r.state = 0; r.phase = 0; r.timer = 0; r.height = 0;
        const hit = !r.human ? null : this.contact(r);
        const queued = r.queued && f.rise - 5 >= this.frame - r.queuedAt;
        r.queued = false;
        if (hit && queued) { hit.knocked = true; r.state = 1; r.phase = 1; r.timer = 3; r.jumps++; this.boostUp(r); this.push("jump", r); }
        else if (hit) this.trip(r, hit);
        else if (queued) this.startJump(r);
      }
      if (r.state === 1) r.height = jumpHeight(r.jumpStat, r.phase, r.timer);
    } else if (r.state === 2) {
      r.tripTimer++;
      if (r.tripTimer > 30) { r.state = 0; r.tripTimer = 0; }
    } else if (r.human && !r.finished) {
      const hit = this.contact(r);
      if (hit) this.trip(r, hit);
    }
    // the CPU rolls once per hurdle, as it arrives (the game rolls at the flag; the same odds, a hurdle's travel later)
    if (!r.human && !r.finished) {
      for (const h of r.hurdles) {
        if (h.rolled || r.dist < 8 * h.flag + 60) continue;
        h.rolled = true;
        const roll = Math.floor(this.rng() * 100);
        if (roll < r.boostChance) { this.startJump(r); this.boostUp(r); }
        else if (roll < r.clearChance) { this.trip(r, h); }
        else this.startJump(r);
      }
    }
  }

  /** The CPU takes over a team a person left (a room with friends): it rolls the hurdles it has not met yet. */
  takeOver(team) {
    if (!this.humans.delete(team)) return;
    for (const r of this.runners[team]) {
      r.human = false;
      const chance = BOOST_CHANCES[Math.floor(this.rng() * 6)];
      r.boostChance = chance[0];
      r.clearChance = chance[1];
      for (const h of r.hurdles) if (r.dist >= 8 * h.flag + 60) h.rolled = true;
    }
    if (this.humanTeam === team) this.humanTeam = this.humans.size ? [...this.humans][0] : -1;
  }

  /**
   * One frame (1/30 s). taps: the lanes of the person's team tapped since the last step, or an object { team: lanes } when several
   * people play. The race ends when every person's team has finished (the focus team's when nobody plays).
   */
  step(taps = []) {
    if (this.over) return;
    this.frame++;
    if (Array.isArray(taps)) { for (const lane of taps) this.tap(lane); }
    else for (const team of Object.keys(taps).map(Number).sort((a, b) => a - b)) for (const lane of taps[team]) this.tap(lane, team);
    for (const r of this.all()) this.stepRunner(r);
    const judged = this.humans.size ? [...this.humans] : [this.focus];
    if (judged.every((t) => this.runners[t].every((r) => r.finished))) this.over = true;
    else if (this.frame > 7200) this.over = true;
  }

  /** The finish times; Pokémon still running when the race ends get the game's estimate. */
  times() {
    return this.runners.map((team) => team.map((r) => {
      if (r.finished) return { time: r.time, estimated: false };
      const left = Math.max(0, TRACK - r.dist);
      return { time: this.frame + Math.ceil(left / Math.max(r.speed, r.top, 0.5)), estimated: true };
    }));
  }

  result() {
    const t = this.times();
    const raw = t.map((team) => roundTime(team.reduce((s, x) => s + x.time, 0)));
    const detail = this.runners.map((team, ti) => ({
      times: t[ti].map((x) => x.time),
      mons: team.map((r) => ({ failed: r.trips, jumped: r.jumps, dashed: r.dashes })),
    }));
    return { raw, detail };
  }
}
