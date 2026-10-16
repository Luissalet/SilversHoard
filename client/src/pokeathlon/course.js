// The rules around the ten events (SPEC 3): ranks, event points, the per-Pokémon counters, the closing ceremony's bonuses, the winner and the
// tie draw, the medals and which NPC teams a course draws. Pure functions: no DOM, no randomness except the rng it is given.

export const STAT_KEYS = ["speed", "power", "skill", "stamina", "jump"];

/** The ten events in the order of the game (the id of an event is its position here). */
export const EVENT_ORDER = ["hurdle_dash", "pennant_capture", "circle_push", "block_smash", "disc_catch", "lamp_jump", "relay_run", "ring_drop", "snow_throw", "goal_roll"];

/** lowerIsBetter: only Hurdle Dash (a time). target / trophy: the scores the game's records are compared with. */
export const EVENT_META = {
  hurdle_dash: { n: 0, lowerIsBetter: true, target: 3000, trophy: 2400, unit: "frames" },
  pennant_capture: { n: 1, lowerIsBetter: false, target: 35, trophy: 50, unit: "pennants" },
  circle_push: { n: 2, lowerIsBetter: false, target: 40, trophy: 60, unit: "points" },
  block_smash: { n: 3, lowerIsBetter: false, target: 80, trophy: 130, unit: "blocks" },
  disc_catch: { n: 4, lowerIsBetter: false, target: 40, trophy: 70, unit: "points" },
  lamp_jump: { n: 5, lowerIsBetter: false, target: 350, trophy: 500, unit: "points" },
  relay_run: { n: 6, lowerIsBetter: false, target: 12288, trophy: 16384, unit: "laps*1024+px" },
  ring_drop: { n: 7, lowerIsBetter: false, target: 70, trophy: 100, unit: "points" },
  snow_throw: { n: 8, lowerIsBetter: false, target: 30, trophy: 55, unit: "hits" },
  goal_roll: { n: 9, lowerIsBetter: false, target: 3, trophy: 9, unit: "goals" },
};

export const RANK_POINTS = [100, 80, 70, 60];
export const POINTS_CAP = 200;

/** The five solo courses and the supreme one, by key: the stat they reward (their medal) and the stat-order index used for the medal bit. */
export const MEDAL_BITS = { speed: 1, power: 2, skill: 4, stamina: 8, jump: 16 };

export const COUNTER_KEYS = ["failed", "jumped", "points", "hit", "fell", "dashed", "switched", "impeded"];

const COUNTER_ALIASES = {
  failed: ["failed", "fail", "fails", "failures"],
  jumped: ["jumped", "jump", "jumps", "jumpCount"],
  points: ["points", "point", "score", "scored"],
  hit: ["hit", "hits", "tackle", "tackles"],
  fell: ["fell", "fellDown", "fall", "falls", "fallen"],
  dashed: ["dashed", "dash", "dashes"],
  switched: ["switched", "switch", "switches", "swaps", "swapped"],
  impeded: ["impeded", "selfImpeded", "self", "selfHit"],
};

export const emptyCounters = () => ({ failed: 0, jumped: 0, points: 0, hit: 0, fell: 0, dashed: 0, switched: 0, impeded: 0 });

/** One Pokémon's counters as an event reports them (any of the names above, any missing) -> the eight counters. */
export function normCounters(raw) {
  const out = emptyCounters();
  if (!raw || typeof raw !== "object") return out;
  for (const key of COUNTER_KEYS) {
    for (const alias of COUNTER_ALIASES[key]) {
      if (raw[alias] !== undefined) {
        const v = Number(raw[alias]);
        if (Number.isFinite(v) && v > 0) out[key] = Math.min(9999, Math.round(v));
        break;
      }
    }
  }
  return out;
}

/** Standard competition ranks from 0: scores 20, 20, 15, 10 -> 0, 0, 2, 3. Equal scores keep the lower team first. */
export function rankOf(scores, lowerIsBetter = false) {
  const order = scores.map((_, i) => i).sort((a, b) => (lowerIsBetter ? scores[a] - scores[b] : scores[b] - scores[a]) || a - b);
  const ranks = new Array(scores.length).fill(0);
  order.forEach((team, pos) => {
    ranks[team] = pos > 0 && scores[team] === scores[order[pos - 1]] ? ranks[order[pos - 1]] : pos;
  });
  return ranks;
}

const cap = (v) => Math.max(0, Math.min(POINTS_CAP, Math.trunc(v)));

/** The four event points out of the four raw scores of an event (SPEC 3.2). */
export function eventPoints(eventId, raws) {
  const meta = EVENT_META[eventId];
  if (!meta) throw new Error(`Unknown event ${eventId}`);
  const raw = [0, 1, 2, 3].map((i) => Number(raws[i]) || 0);
  switch (eventId) {
    case "hurdle_dash": return raw.map((f) => (f <= 0 ? POINTS_CAP : cap(11500 / (f / 30))));
    case "pennant_capture": return raw.map((s) => cap(3 * s));
    case "circle_push": return raw.map((s) => cap(3 * s));
    case "block_smash": return raw.map((s) => cap(s));
    case "disc_catch": return raw.map((s) => cap(150 - 120 / (1 + 0.08 * s)));
    case "lamp_jump": return raw.map((s) => cap(s / 3.5));
    case "relay_run": return raw.map((s) => cap((s / 1024) * 10));
    case "ring_drop": return raw.map((s) => cap(1.5 * s));
    case "snow_throw": return raw.map((s) => cap(3 * s));
    case "goal_roll": {
      const ranks = rankOf(raw, false);
      return raw.map((s, i) => {
        const ties = ranks.filter((r, j) => j !== i && r === ranks[i]).length;
        return cap(RANK_POINTS[Math.min(3, ranks[i] + ties)] + 5 * Math.max(0, Math.min(99, s)));
      });
    }
    default: return raw.map(() => 0);
  }
}

/** The score of an event as the person reads it: 1:23.4 for the dash, laps for the relay, plain numbers elsewhere. */
export function formatScore(eventId, raw) {
  const v = Number(raw) || 0;
  if (eventId === "hurdle_dash") {
    const sec = Math.floor(v / 30);
    const tenths = Math.floor(((v % 30) * 10) / 30);
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}.${tenths}`;
  }
  if (eventId === "relay_run") {
    const laps = Math.floor(v / 1024);
    return `${laps}.${Math.floor(((v % 1024) * 10) / 1024)}`;
  }
  return String(Math.round(v));
}

/** Challenge Bonus: 75 minus the team's total ROM base stars (15 stats), between 0 and 75. */
export function challengeBonus(team) {
  let sum = 0;
  for (const mon of team.mons) {
    const b = mon.base || mon.stars;
    for (const k of STAT_KEYS) sum += Number(b[k]) || 1;
  }
  return Math.max(0, Math.min(75, 75 - sum));
}

export function starTotal(team) {
  let sum = 0;
  for (const mon of team.mons) for (const k of STAT_KEYS) sum += Number(mon.stars[k]) || 1;
  return sum;
}

// ---------------------------------------------------------------------------------------------------------------- the courses
const evs = (...nums) => nums.map((n) => EVENT_ORDER[n]);

/** The ten fixed event sets the master course draws from (SPEC 3.1). */
export const MASTER_SETS = [[4, 2, 9, 7], [7, 2, 3, 8], [5, 0, 9, 7], [3, 6, 8, 5], [8, 5, 3, 0], [1, 2, 9, 4], [2, 6, 5, 3], [0, 7, 3, 9], [9, 8, 4, 1], [6, 3, 7, 0]].map((s) => evs(...s));

/**
 * The five solo courses and the supreme one (the game's master course: four events out of ten fixed sets, always against the stronger NPC
 * teams, no medal). `id` is the course number of the game (it picks the NPC teams); `medal` the stat of the medal the winner gets.
 */
export const COURSES = [
  { key: "speed", id: 0, events: evs(0, 1, 6), medal: "speed" },
  { key: "power", id: 1, events: evs(3, 2, 9), medal: "power" },
  { key: "skill", id: 2, events: evs(8, 9, 1), medal: "skill" },
  { key: "stamina", id: 3, events: evs(7, 6, 3), medal: "stamina" },
  { key: "jump", id: 4, events: evs(5, 4, 0), medal: "jump" },
  { key: "supreme", id: 10, sets: MASTER_SETS, medal: "", supreme: true },
];

export const courseByKey = (key) => COURSES.find((c) => c.key === key) || null;

// ---------------------------------------------------------------------------------------------------------------- the teams
const starsOfNpc = (raw) => ({ power: raw[0] + 1, speed: raw[1] + 1, jump: raw[2] + 1, stamina: raw[3] + 1, skill: raw[4] + 1 });

/** An NPC team of data/npc_teams (from pokeathlon_npc_teams) as a team of the contract. nameFn(english) -> the name in the UI language. */
export function teamFromNpc(npc, index, { color, nameFn = (n) => n, cpu = 0 } = {}) {
  return {
    index, name: npc.name, color, human: false, cpu, npc: npc.team,
    mons: npc.mons.map((m) => {
      const stars = m.stars ? { ...m.stars } : starsOfNpc(m.rawBase);
      return { species: m.name, num: m.species || m.num || 0, form: m.form || "", name: nameFn(m.name), stars, base: { ...stars }, min: { ...stars }, max: { ...stars }, derived: false };
    }),
  };
}

/** A mon of the contract out of a row of pokeathlon_stats; `stars` may be set within [min, max] (default the base). */
export function monFromStats(row, { stars = null, name = "", nickname = "" } = {}) {
  const base = {}; const min = {}; const max = {};
  for (const k of STAT_KEYS) { base[k] = row.stars[k].base; min[k] = row.stars[k].min; max[k] = row.stars[k].max; }
  const chosen = {};
  for (const k of STAT_KEYS) chosen[k] = Math.max(min[k], Math.min(max[k], Math.round(stars && stars[k] !== undefined ? stars[k] : base[k])));
  return { species: row.name, num: row.num, form: row.forme || "", name: nickname || name || row.name, stars: chosen, base, min, max, derived: !!row.derived };
}

/** A random team of three from the whole dex (rows of pokeathlon_stats), with their base stars. */
export function randomTeam(rows, rng, { index, name, color, nameFn = (n) => n, cpu = 0 }) {
  const picked = [];
  const seen = new Set();
  const pool = rows.some((r) => !r.noRandom) ? rows.filter((r) => !r.noRandom) : rows;   // no cosmetic formes, Gigantamax or Totems
  while (picked.length < 3 && pool.length) {
    const row = pool[Math.floor(rng() * pool.length)];
    if (seen.has(row.baseSpecies || row.name)) continue;
    seen.add(row.baseSpecies || row.name);
    picked.push(monFromStats(row, { name: nameFn(row.name) }));
  }
  return { index, name, color, human: false, cpu, mons: picked };
}

/**
 * The NPC team numbers a course draws (SPEC 3.1.1): the five teams 5c..5c+4 of a solo course (the master course: the 25 teams 25..49),
 * +50 when supreme, drawn without replacement; returns team numbers 1..100.
 */
export function drawNpcTeams(courseId, supreme, count, rng) {
  const pool = [];
  if (courseId >= 10) for (let i = 25; i < 50; i++) pool.push(i);
  else for (let i = 0; i < 5; i++) pool.push(5 * courseId + i);
  let remaining = pool.length;
  const out = [];
  for (let n = 0; n < count && remaining > 0; n++) {
    const at = Math.floor(rng() * remaining);
    out.push(pool[at] + (supreme ? 50 : 0) + 1);
    remaining--;
    pool[at] = pool[remaining];
  }
  return out;
}

/** The events of a course; the master/supreme one draws one of the ten fixed sets. */
export function eventsOfCourse(course, rng) {
  if (course.events) return [...course.events];
  const sets = course.sets || [];
  return [...sets[Math.floor(rng() * sets.length)]];
}

// ------------------------------------------------------------------------------------------------------------- the course run
export class Course {
  /**
   * events: ids in order; teams: the four teams of the contract; key: the course's key (speed, power, skill, stamina, jump, supreme,
   * single); medal: the stat key of its medal ("" for none).
   */
  constructor({ key = "single", events, teams, supreme = false, seed = 1, medal = "" }) {
    this.key = key;
    this.events = events;
    this.teams = teams;
    this.supreme = supreme;
    this.seed = seed;
    this.medal = medal;
    this.rounds = [];
    this.mons = teams.map((t) => t.mons.map(() => emptyCounters()));
  }

  /** Take an event's result: converts it to event points, ranks it and adds the Pokémon's counters. */
  record(eventId, result) {
    const raw = [0, 1, 2, 3].map((i) => Number(result.raw[i]) || 0);
    const meta = EVENT_META[eventId];
    const points = eventPoints(eventId, raw);
    const ranks = rankOf(raw, meta.lowerIsBetter);
    const mons = this.teams.map((t, ti) => t.mons.map((_, si) => {
      const d = result.detail && result.detail[ti];
      const c = normCounters(d && d.mons ? d.mons[si] : null);
      const into = this.mons[ti][si];
      for (const k of COUNTER_KEYS) into[k] = Math.min(9999, into[k] + c[k]);
      return c;
    }));
    const round = { event: eventId, raw, points, ranks, mons };
    this.rounds.push(round);
    return round;
  }

  /** The event points added up so far. */
  totals() {
    return [0, 1, 2, 3].map((i) => this.rounds.reduce((s, r) => s + r.points[i], 0));
  }

  /**
   * The closing ceremony (SPEC 3.4): the bonuses in order, the totals, the winner (a tie for first is drawn by lots) and the medals.
   * The Points Leader is not awarded when nobody scored any point (the original gives everyone the bonus then; fixed here).
   */
  closing(rng) {
    const challenge = this.teams.map(challengeBonus);
    const flat = [];
    this.teams.forEach((t, ti) => t.mons.forEach((_, si) => flat.push({ team: ti, slot: si, c: this.mons[ti][si] })));

    const noMiss = flat.filter((m) => m.c.failed === 0 && m.c.fell === 0 && m.c.impeded === 0).map((m) => ({ team: m.team, slot: m.slot }));
    const maxPoints = Math.max(0, ...flat.map((m) => m.c.points));
    const leader = maxPoints > 0 ? flat.filter((m) => m.c.points === maxPoints).map((m) => ({ team: m.team, slot: m.slot })) : [];

    const kinds = ["jumped", "hit", "failed", "dashed"];
    const start = Math.floor(rng() * 4);
    let effortKind = -1;
    let effort = [];
    for (let i = 0; i < 4; i++) {
      const k = kinds[(start + i) % 4];
      const best = Math.max(0, ...flat.map((m) => m.c[k]));
      if (best > 0) {
        effortKind = (start + i) % 4;
        effort = flat.filter((m) => m.c[k] === best).map((m) => ({ team: m.team, slot: m.slot }));
        break;
      }
    }
    const per = (list, amount) => [0, 1, 2, 3].map((t) => list.filter((m) => m.team === t).length * amount);
    const bonus = {
      challenge,
      noMiss: per(noMiss, 10),
      leader: per(leader, 20),
      effort: per(effort, 10),
      noMissMons: noMiss, leaderMons: leader, effortMons: effort, effortKind,
    };
    const eventTotals = this.totals();
    const totals = eventTotals.map((v, i) => v + bonus.challenge[i] + bonus.noMiss[i] + bonus.leader[i] + bonus.effort[i]);
    const ranks = rankOf(totals, false);
    const tied = ranks.map((r, i) => (r === 0 ? i : -1)).filter((i) => i >= 0);
    let tie = false;
    let lots = null;
    const place = [...ranks];
    let winner = tied[0];
    if (tied.length > 1) {
      tie = true;
      const first = Math.floor(rng() * 4);
      lots = [0, 0, 0, 0];
      for (let i = 0; i < 4; i++) lots[(first + i) % 4] = i;
      winner = tied.reduce((best, t) => (lots[t] > lots[best] ? t : best), tied[0]);
      for (const t of tied) place[t] = t === winner ? 0 : 1;
    }
    const medalMask = this.medal && MEDAL_BITS[this.medal] ? MEDAL_BITS[this.medal] : 0;
    return {
      bonus, eventTotals, totals, ranks, place, tie, lots, winner,
      medal: medalMask ? { stat: this.medal, mask: medalMask, team: winner } : null,
      rounds: this.rounds.map((r) => ({ event: r.event, points: r.points, raw: r.raw, ranks: r.ranks })),
    };
  }
}

/** The body for pokeathlon_result_save out of a finished course (closing = null for a single event, which has no ceremony). */
export function savePayload(course, closing, { mode = "play", trainerId = "", lang = "es", extra = {} } = {}) {
  const lastRanks = course.rounds.length ? course.rounds[course.rounds.length - 1].ranks : [0, 1, 2, 3];
  return {
    course: course.key,
    supreme: course.supreme,
    mode,
    seed: course.seed >>> 0,
    trainer_id: trainerId,
    teams: course.teams.map((t) => ({
      name: t.name, color: t.color, human: !!t.human, cpu: t.cpu || 0, npc: t.npc || 0,
      mons: t.mons.map((m) => ({ species: m.species, num: m.num, form: m.form || "", name: m.name, stars: m.stars, base: m.base, derived: !!m.derived })),
    })),
    rounds: course.rounds.map((r) => ({ event: r.event, raw: r.raw, counters: r.mons })),
    bonuses: closing ? {
      challenge: closing.bonus.challenge, no_miss: closing.bonus.noMiss, points_leader: closing.bonus.leader, effort: closing.bonus.effort,
      effort_kind: closing.bonus.effortKind,
    } : null,
    winner: closing ? closing.winner : Math.max(0, lastRanks.indexOf(0)),
    place: closing ? closing.place : lastRanks,
    tie: closing ? closing.tie : false,
    lang,
    ...extra,
  };
}
