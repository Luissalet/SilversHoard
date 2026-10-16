// What the Pokéathlon page asks the app for (the stars of every Pokémon, the game's NPC teams, the records) and the building of the four
// teams of a course out of the person's choices. Every call has a fallback so the page still plays with an older server.
import { api } from "../api.js";
import { TEAM_COLORS } from "./core.js";
import { drawNpcTeams, monFromStats, randomTeam, teamFromNpc } from "./course.js";
import { FALLBACK_ROWS } from "./fallback.js";

let statsPromise = null;
let npcPromise = null;

/** Every species and forme with its Pokéathlon stars: { rows, full } (full = false when only the short fallback list could be had). */
export function loadStats() {
  if (!statsPromise) {
    statsPromise = api.call("pokeathlon_stats", { limit: 0 })
      .then((r) => ({ rows: Array.isArray(r.species) && r.species.length ? r.species : FALLBACK_ROWS, full: Array.isArray(r.species) && r.species.length > 100 }))
      .catch(() => ({ rows: FALLBACK_ROWS, full: false }));
  }
  return statsPromise;
}

/** The 100 NPC teams by number (1-100), or null when the app has none to give. */
export function loadNpcTeams() {
  if (!npcPromise) {
    npcPromise = api.call("pokeathlon_npc_teams", {})
      .then((r) => {
        const map = new Map();
        for (const team of r.teams || []) map.set(Number(team.team), team);
        return map.size ? map : null;
      })
      .catch(() => null);
  }
  return npcPromise;
}

export const loadRecords = () => api.call("pokeathlon_records", {}).catch(() => null);
export const saveResult = (payload) => api.call("pokeathlon_result_save", payload);

export const rowsById = (rows) => new Map(rows.map((r) => [r.id, r]));

const DEFAULT_IDS = ["pikachu", "machamp", "gyarados"];

/** The person's own team as the page keeps it: { name, mons: [{ id, stars }] } with three entries. */
export function defaultTeam(rows, name) {
  const byId = rowsById(rows);
  const ids = DEFAULT_IDS.filter((id) => byId.has(id));
  while (ids.length < 3 && rows.length) ids.push(rows[ids.length % rows.length].id);
  return { name, mons: ids.slice(0, 3).map((id) => ({ id, stars: null })) };
}

/** A saved team checked against the table: unknown ids are replaced, the star values clamped into the Pokémon's range. */
export function cleanTeam(team, rows, name) {
  const byId = rowsById(rows);
  const base = defaultTeam(rows, name);
  const mons = [0, 1, 2].map((i) => {
    const m = team && team.mons && team.mons[i];
    return m && byId.has(m.id) ? { id: m.id, stars: m.stars || null } : base.mons[i];
  });
  return { name: (team && team.name) || name, mons };
}

/** A team of the contract out of a { name, mons: [{ id, stars }] } spec (index 0 is the person's own, in red). */
export function teamFromSpec(spec, byId, index, { human = false, cpu = 0 } = {}) {
  return {
    index, name: spec.name, color: TEAM_COLORS[index], human, cpu,
    mons: spec.mons.map((m) => monFromStats(byId.get(m.id), { stars: m.stars })),
  };
}

export function randomSpec(rows, rng, name) {
  const t = randomTeam(rows, rng, { index: 0, name, color: "#fff" });
  return { name, mons: t.mons.map((m) => ({ id: rows.find((r) => r.name === m.species).id, stars: null })) };
}

/**
 * The four teams of a course. `mine` is the person's spec; rivals: "npc" | "random" | "custom" (customRivals = three specs).
 * `course.id` picks the game's NPC teams (a single event draws from a random solo course).
 */
export function buildTeams({ rows, mine, rivals = "npc", customRivals = [], npc = null, courseId = 0, supreme = false, watch = false, rng, rivalNames = ["Team 2", "Team 3", "Team 4"] }) {
  const byId = rowsById(rows);
  const cpu = supreme ? 1 : 0;
  const teams = [teamFromSpec(mine, byId, 0, { human: !watch, cpu })];
  let npcNums = [];
  if (rivals === "npc" && npc) npcNums = drawNpcTeams(courseId, supreme, 3, rng);
  for (let i = 1; i <= 3; i++) {
    const color = TEAM_COLORS[i];
    if (rivals === "custom" && customRivals[i - 1]) {
      teams.push(teamFromSpec(customRivals[i - 1], byId, i, { cpu }));
    } else if (rivals === "npc" && npc && npc.get(npcNums[i - 1])) {
      teams.push(teamFromNpc(npc.get(npcNums[i - 1]), i, { color, cpu }));
    } else {
      teams.push(randomTeam(rows, rng, { index: i, name: rivalNames[i - 1], color, cpu }));
    }
  }
  return teams;
}
