// The battle backdrop and the weather and terrain layers of the turn-based screen in Pokémon Showdown's look: the same pictures its client
// shows, picked the way it picks them (by the format's generation, one per battle), and its full-field weather and terrain overlays.
// The lists of picture names come from the tables of Showdown's battle-animations.ts (MIT, Guangcong Luo and contributors) and the
// weather classes of its battle.css; the pictures themselves are downloaded on first use (the app's /api/fx cache, or straight from
// Showdown on the friends' playable page). Backdrops by Kyle Dove and the artists in pokemonshowdown.com/credits.
import { fxUrl } from "./ps/url.js";

export const BACKDROPS_GEN3 = ["bg-gen3.png", "bg-gen3-cave.png", "bg-gen3-ocean.png", "bg-gen3-sand.png", "bg-gen3-forest.png", "bg-gen3-arena.png"];
export const BACKDROPS_GEN4 = ["bg-gen4.png", "bg-gen4-cave.png", "bg-gen4-snow.png", "bg-gen4-indoors.png", "bg-gen4-water.png"];
export const BACKDROPS_GEN5 = ["bg-beach.png", "bg-beachshore.png", "bg-desert.png", "bg-meadow.png", "bg-thunderplains.png", "bg-city.png",
  "bg-earthycave.png", "bg-mountain.png", "bg-volcanocave.png", "bg-dampcave.png", "bg-forest.png", "bg-river.png", "bg-deepsea.png",
  "bg-icecave.png", "bg-route.png"];
export const BACKDROPS = ["bg-aquacordetown.jpg", "bg-beach.jpg", "bg-city.jpg", "bg-dampcave.jpg", "bg-darkbeach.jpg", "bg-darkcity.jpg",
  "bg-darkmeadow.jpg", "bg-deepsea.jpg", "bg-desert.jpg", "bg-earthycave.jpg", "bg-elite4drake.jpg", "bg-forest.jpg", "bg-icecave.jpg",
  "bg-leaderwallace.jpg", "bg-library.jpg", "bg-meadow.jpg", "bg-orasdesert.jpg", "bg-orassea.jpg", "bg-skypillar.jpg"];

// weather and terrain ids → Showdown's overlay picture (battle.css: .<id>weather)
const WEATHER = { sunnyday: "weather-sunnyday.jpg", desolateland: "weather-sunnyday.jpg", raindance: "weather-raindance.jpg",
  primordialsea: "weather-raindance.jpg", sandstorm: "weather-sandstorm.png", hail: "weather-hail.png", snow: "weather-hail.png",
  snowscape: "weather-hail.png", deltastream: "weather-strongwind.png" };
const INTENSE = new Set(["desolateland", "primordialsea", "deltastream"]);
const FIELD = { electricterrain: "weather-electricterrain.png", grassyterrain: "weather-grassyterrain.png", mistyterrain: "weather-mistyterrain.png",
  psychicterrain: "weather-psychicterrain.png", trickroom: "weather-trickroom.png", magicroom: "weather-magicroom.png",
  wonderroom: "weather-wonderroom.png", gravity: "weather-gravity.png" };

const toId = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

/** A small stable number from a text (the battle's players and format), so a battle keeps its backdrop in every replay. */
export function seedOf(text) {
  let h = 2166136261;
  for (const ch of String(text || "")) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}

/** Which backdrop Showdown would show for a generation: the path under its client ("fx/…" or "sprites/gen6bgs/…"). */
export function backdropPath(gen, seed) {
  const n = Math.abs(Number(seed) || 0);
  const g = Number(gen) || 9;
  if (g <= 1) return "fx/bg-gen1.png";
  if (g <= 2) return "fx/bg-gen2.png";
  if (g <= 3) return `fx/${BACKDROPS_GEN3[n % BACKDROPS_GEN3.length]}`;
  if (g <= 4) return `fx/${BACKDROPS_GEN4[n % BACKDROPS_GEN4.length]}`;
  if (g <= 5) return `fx/${BACKDROPS_GEN5[n % BACKDROPS_GEN5.length]}`;
  return `sprites/gen6bgs/${BACKDROPS[n % BACKDROPS.length]}`;
}

/** Every backdrop a gym can pick (gym_save backdrop), by file name. */
export const ALL_BACKDROPS = [...BACKDROPS, ...BACKDROPS_GEN5, ...BACKDROPS_GEN4, ...BACKDROPS_GEN3];

/** The path of a backdrop chosen by file name: the generation 6+ ones live with the sprites, the older ones with the effects. */
export function backdropFilePath(name) {
  const n = String(name || "");
  return BACKDROPS.includes(n) ? `sprites/gen6bgs/${n}` : `fx/${n}`;
}

/** The friends' playable page has no app behind it: there the pictures come straight from Showdown. */
export function isLocalApp() {
  try { return !document.getElementById("silver-data"); } catch { return true; }
}

/** URL of the backdrop for a battle. */
export function backdropUrl({ gen, seed, local = isLocalApp() }) {
  return fxUrl(backdropPath(gen, seed), { local });
}

/** URL of a backdrop chosen by file name (a gym's own). */
export function backdropFileUrl(name, { local = isLocalApp() } = {}) {
  return fxUrl(backdropFilePath(name), { local });
}

/** The weather overlay: {url, opacity} or null (Showdown shows it at 0.5, 0.9 for the strong weathers). */
export function weatherLayer(weather, { local = isLocalApp() } = {}) {
  const id = toId(weather);
  const file = WEATHER[id];
  return file ? { url: fxUrl(file, { local }), opacity: INTENSE.has(id) ? 0.9 : 0.5 } : null;
}

/** The terrain or room overlay (the last field effect that has one): {url, opacity} or null. */
export function fieldLayer(ids, { local = isLocalApp() } = {}) {
  let file = "";
  for (const id of ids || []) if (FIELD[toId(id)]) file = FIELD[toId(id)];
  return file ? { url: fxUrl(file, { local }), opacity: 0.55 } : null;
}
