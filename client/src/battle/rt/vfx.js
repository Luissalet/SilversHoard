// The look of moves in the real-time arena: continuous rays for beams (ice crystals, zigzag lightning, flame and water jets,
// psychic rings, dragon helixes…), shaped projectiles (fireballs, ice shards, leaves, rocks, shadow orbs, stars, crescents),
// melee marks (claws, punches, bites), drops from the sky (lightning, falling rocks), ground quakes with screen shake, hit bursts
// by type, auras for boosts and heals, status particles and weather. Drawing only: it reads the battle's view and events and
// never changes the battle, so it may use Math.random freely.
import { TYPE_COLORS } from "../dex.js";

const H = 0.6;          // projectiles fly this many meters over the ground
const TAU = Math.PI * 2;
const rnd = (a = 0, b = 1) => a + Math.random() * (b - a);
const pick = (list) => list[Math.floor(Math.random() * list.length)];

function rgba(hex, a) {
  const n = parseInt((hex || "#cccccc").slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a))})`;
}

const has = (id, words) => words.some((w) => id.includes(w));

// Beams drawn as a ray from the user to the head of the beam.
const RAYS = {
  icebeam: "ice", aurorabeam: "aurora", bubblebeam: "bubbles", hyperbeam: "hyper", gigaimpact: "hyper", eternabeam: "hyper", dynamaxcannon: "hyper",
  solarbeam: "solar", solarblade: "solar", psybeam: "psy", psychic: "psy", signalbeam: "aurora", chargebeam: "electric", thunderbolt: "electric",
  zapcannon: "electric", flamethrower: "fire", blastburn: "fire", overheat: "fire", hydropump: "water", hydrocannon: "water", waterpulse: "rings",
  darkpulse: "dark", dragonpulse: "dragon", dracometeor: "dragon", originpulse: "water", flashcannon: "steel", steelbeam: "steel", armorcannon: "fire",
  dazzlinggleam: "fairy", fleurcannon: "fairy", moongeistbeam: "dark", prismaticlaser: "aurora", photongeyser: "psy", meteorbeam: "hyper",
  triattack: "tri", leafstorm: "leaves", frenzyplant: "leaves", hurricane: "wind", makeitrain: "coins",
};
// Projectiles with a shape of their own.
const BALLS = {
  shadowball: "shadow", aurasphere: "aura", focusblast: "aura", energyball: "energy", sludgebomb: "sludge", sludge: "sludge", gunkshot: "sludge",
  moonblast: "moon", mistball: "moon", lusterpurge: "aura", electroball: "electric", fireblast: "fire", pyroball: "fire", ember: "fire", flameburst: "fire",
  fireball: "fire", mysticalfire: "fire", weatherball: "orb", swift: "star", airslash: "crescent", aircutter: "crescent", aerialace: "crescent",
  razorleaf: "leaf", magicalleaf: "leaf", leafage: "leaf", seedbomb: "seed", bulletseed: "seed", iceshard: "ice", icebeam: "ice", iciclespear: "ice",
  icicle: "ice", frostbreath: "ice", powdersnow: "snow", rockthrow: "rock", rocktomb: "rock", rockblast: "rock", ancientpower: "rock", powergem: "gem",
  smackdown: "rock", mudshot: "mud", mudslap: "mud", mudbomb: "mud", watergun: "drop", scald: "drop", bubble: "bubble", octazooka: "drop",
  pinmissile: "needle", poisonsting: "needle", twineedle: "needle", spikecannon: "needle", bugbuzz: "rings", shadowsneak: "shadow", hex: "shadow",
  dragonbreath: "fire", dragondarts: "dart", thunderwave: "spark", thundershock: "electric", shockwave: "electric", voltswitch: "electric",
  waterspout: "drop", eruption: "fire", lavaplume: "fire", payday: "coin", pollenpuff: "energy", storedpower: "aura", psyshock: "psy",
};
const MELEE = [
  ["slash", ["slash", "claw", "cut", "scratch", "xscissor", "blade", "psychocut", "nightslash", "furyswipes", "aerialace", "sacredsword", "secretsword", "falseswipe", "dragontail", "leafblade", "crosschop"]],
  ["bite", ["bite", "fang", "crunch", "jaw", "chomp", "superfang", "hyperfang"]],
  ["punch", ["punch", "hammer", "fist", "uppercut", "knuckle", "bulletpunch", "machpunch", "meteormash", "drainpunch", "skyuppercut", "shadowpunch", "focuspunch"]],
  ["kick", ["kick", "stomp", "jumpkick", "tropkick", "doublekick", "lowsweep"]],
  ["pierce", ["horn", "drill", "peck", "jab", "megahorn", "smartstrike", "needle", "spike"]],
];
const DROPS = {
  thunder: "bolt", thunderclap: "bolt", boltstrike: "bolt", rockslide: "rocks", stoneedge: "spikes", earthpower: "erupt", fissure: "erupt",
  psychic: "psy", psyshock: "psy", psystrike: "psy", futuresight: "psy", doomdesire: "star", hurricane: "tornado", meteormash: "star",
  judgment: "star", spacialrend: "psy", roaroftime: "psy", sheercold: "ice",
};
const BURSTS = {
  earthquake: "quake", magnitude: "quake", bulldoze: "quake", precipiceblades: "quake", surf: "wave", muddywater: "mudwave", discharge: "electric",
  paraboliccharge: "electric", explosion: "explode", selfdestruct: "explode", mistyexplosion: "explode", mindblown: "explode", lavaplume: "fire",
  sludgewave: "poison", boomburst: "sound", petalblizzard: "petals", blizzard: "snow", heatwave: "fire", icywind: "snow", hypervoice: "sound",
  snarl: "sound", rockslide: "rocks", eruption: "fire", searingshot: "fire", dazzlinggleam: "fairy",
};

const melee = (id) => (MELEE.find(([, words]) => has(id, words)) || ["impact"])[0];

export class Vfx {
  constructor(renderer) {
    this.r = renderer;
    this.parts = [];
    this.rays = new Map();         // projectile id -> ray
    this.fx = [];                  // timed effects (bolts, claws, rings…)
    this.shake = 0;
    this.weatherT = 0;
    this.statusT = 0;
    this.pendingDrop = [null, null];
    this.lastBalls = new Map();
  }

  px(x) { return this.r.px(x); }
  py(y, z = 0) { return this.r.py(y) - z * this.r.scale; }

  // ------------------------------------------------------------ particles
  emit(n, base) {
    for (let i = 0; i < n; i++) {
      const p = typeof base === "function" ? base(i) : base;
      this.parts.push({ t: 0, z: 0, vx: 0, vy: 0, vz: 0, g: 0, drag: 0, rot: rnd(0, TAU), vr: 0, size: 0.12, kind: "dot", alpha: 1, ...p });
    }
    if (this.parts.length > 900) this.parts.splice(0, this.parts.length - 900);
  }

  burst(type, x, y, { z = H, power = 1 } = {}) {
    const col = TYPE_COLORS[type] || "#ffffff";
    const n = Math.round(14 * power);
    const radial = (speed, extra) => (i) => {
      const a = (i / n) * TAU + rnd(-0.3, 0.3);
      const v = rnd(0.5, 1) * speed;
      return { x, y, z, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.6, vz: rnd(0, speed * 0.6), ...extra(i) };
    };
    switch (type) {
      case "Fire":
        this.emit(n, radial(4, () => ({ life: rnd(0.35, 0.7), color: pick(["#ffd27a", "#ff9a3c", "#ff5a1f"]), size: rnd(0.12, 0.26), vz: rnd(1, 3), drag: 2, kind: "glow" })));
        break;
      case "Water":
        this.emit(n, radial(5, () => ({ life: rnd(0.4, 0.7), color: pick(["#9cc8ff", "#d8ecff", "#5f95f0"]), size: rnd(0.08, 0.16), vz: rnd(2, 5), g: 14, kind: "drop" })));
        break;
      case "Ice":
        this.emit(n, radial(4.5, () => ({ life: rnd(0.4, 0.8), color: pick(["#e8fbff", "#9fe6f0", "#c6f2ff"]), size: rnd(0.14, 0.3), vr: rnd(-8, 8), g: 6, kind: "shard" })));
        break;
      case "Electric":
        this.emit(n, radial(6, () => ({ life: rnd(0.2, 0.4), color: pick(["#fff7a8", "#f7d02c", "#ffffff"]), size: rnd(0.25, 0.45), kind: "spark", drag: 4 })));
        this.fx.push({ kind: "zap", x, y, z, t: 0, life: 0.25, color: "#fff27a" });
        break;
      case "Grass": case "Bug":
        this.emit(n, radial(3.5, () => ({ life: rnd(0.5, 0.9), color: pick(type === "Bug" ? ["#b7cc2a", "#8fa31a"] : ["#7ac74c", "#a7e06f", "#4f9a2c"]), size: rnd(0.14, 0.24), vr: rnd(-6, 6), g: 2, drag: 1.5, kind: "leaf" })));
        break;
      case "Rock": case "Ground":
        this.emit(n, radial(4, () => ({ life: rnd(0.5, 0.8), color: pick(type === "Rock" ? ["#b6a136", "#8d7a2a", "#d2c27a"] : ["#e2bf65", "#b8954a", "#8a6b35"]), size: rnd(0.12, 0.26), vr: rnd(-7, 7), vz: rnd(2, 5), g: 16, kind: "rock" })));
        this.emit(6, () => ({ x: x + rnd(-0.4, 0.4), y: y + rnd(-0.2, 0.2), z: 0.1, vx: rnd(-1, 1), vy: rnd(-0.3, 0.3), vz: rnd(0.3, 0.8), life: 0.8, color: "#d8c9a0", size: 0.35, kind: "smoke", alpha: 0.5 }));
        break;
      case "Poison":
        this.emit(n, radial(2.5, () => ({ life: rnd(0.5, 0.9), color: pick(["#c86bd0", "#a33ea1", "#7d2a80"]), size: rnd(0.1, 0.22), vz: rnd(0.5, 2), drag: 1, kind: "bubble" })));
        break;
      case "Psychic": case "Fairy":
        this.fx.push({ kind: "ring", x, y, z, t: 0, life: 0.45, r0: 0.2, r1: 1.4, color: col });
        this.emit(n, radial(3, () => ({ life: rnd(0.4, 0.8), color: type === "Fairy" ? pick(["#ffd1ea", "#ffffff", "#f3a6cf"]) : pick(["#ff9ab8", "#f95587", "#ffd0dd"]), size: rnd(0.12, 0.22), kind: "star", vr: rnd(-4, 4), drag: 2 })));
        break;
      case "Ghost": case "Dark":
        this.emit(n, radial(2.5, () => ({ life: rnd(0.5, 0.9), color: pick(type === "Ghost" ? ["#9b7ec9", "#4b2d73", "#c5b0f0"] : ["#3a2a3a", "#705746", "#1d141d"]), size: rnd(0.2, 0.35), vz: rnd(0.5, 2), drag: 1.5, kind: "smoke", alpha: 0.75 })));
        break;
      case "Steel":
        this.emit(n, radial(5, () => ({ life: rnd(0.25, 0.5), color: pick(["#ffffff", "#d6d6e6", "#9a9ab0"]), size: rnd(0.2, 0.4), kind: "spark", drag: 4 })));
        break;
      case "Dragon":
        this.emit(n, radial(4, () => ({ life: rnd(0.4, 0.7), color: pick(["#8f6bff", "#6f35fc", "#4cc3ff"]), size: rnd(0.14, 0.26), kind: "glow", drag: 2 })));
        break;
      case "Flying":
        this.emit(n, radial(4.5, () => ({ life: rnd(0.4, 0.8), color: pick(["#ffffff", "#dcd3ff"]), size: rnd(0.12, 0.2), vr: rnd(-5, 5), g: 1.5, drag: 2, kind: "feather" })));
        break;
      default:
        this.fx.push({ kind: "star", x, y, z, t: 0, life: 0.22, color: col });
        this.emit(Math.round(n * 0.7), radial(4.5, () => ({ life: rnd(0.2, 0.4), color: pick(["#ffffff", col]), size: rnd(0.18, 0.3), kind: "spark", drag: 4 })));
    }
  }

  // ------------------------------------------------------------ events
  onEvent(e, battle) {
    const side = (i) => battle.sides[i];
    switch (e.k) {
      case "shot": {
        const ray = RAYS[e.move] || (e.shape === "beam" && !BALLS[e.move] ? "generic" : null);
        if (ray) this.rays.set(e.id, { kind: ray, ox: e.x, oy: e.y, hx: e.x, hy: e.y, type: e.type, t: 0, gone: -1, s: e.s });
        break;
      }
      case "impact": case "fizzle": {
        const ray = this.rays.get(e.id);
        if (ray) { ray.hx = e.x; ray.hy = e.y; ray.gone = 0; }
        break;
      }
      case "use": {
        const a = side(e.s);
        if (e.shape === "strike" || e.shape === "dash") {
          const kind = melee(e.move);
          const reach = e.shape === "dash" ? 1.2 : 1.4;
          this.fx.push({ kind: `melee-${kind}`, x: a.x + a.fx * reach, y: a.y + a.fy * reach, fx: a.fx, fy: a.fy, z: H, t: 0, life: kind === "bite" ? 0.35 : 0.3,
            color: TYPE_COLORS[e.type] || "#ffffff", delay: e.shape === "dash" ? 0.12 : 0 });
        } else if (e.shape === "self") {
          const heal = has(e.move, ["recover", "roost", "softboiled", "milkdrink", "slackoff", "synthesis", "moonlight", "morningsun", "rest", "shoreup", "healorder", "lifedew", "junglehealing", "wish"]);
          this.fx.push({ kind: "aura", x: a.x, y: a.y, t: 0, life: 0.8, color: heal ? "#7ee08f" : TYPE_COLORS[e.type] || "#ffffff", heal });
          this.emit(16, () => ({ x: a.x + rnd(-0.6, 0.6), y: a.y + rnd(-0.25, 0.25), z: rnd(0, 0.5), vz: rnd(1.5, 3), life: rnd(0.5, 0.9),
            color: heal ? pick(["#7ee08f", "#d7ffd9"]) : pick([TYPE_COLORS[e.type] || "#ffffff", "#ffffff"]), size: rnd(0.1, 0.2), kind: heal ? "plus" : "glow" }));
        } else if (e.shape === "field") {
          const f = side(1 - e.s);
          this.fx.push({ kind: "ring", x: f.x, y: f.y, z: 0.05, t: 0, life: 0.6, r0: 0.3, r1: 2, color: TYPE_COLORS[e.type] || "#ffffff", flat: true });
        }
        break;
      }
      case "windup": {
        if (e.shape === "drop") {
          this.pendingDrop[e.s] = e.move;
          if (DROPS[e.move] === "bolt") this.fx.push({ kind: "cloud", x: e.tx, y: e.ty, t: 0, life: (e.ticks || 18) / 30 + 0.6 });
        }
        if (e.ticks > 6 && ["beam", "shot"].includes(e.shape)) {
          const a = side(e.s);
          this.fx.push({ kind: "charge", s: e.s, t: 0, life: e.ticks / 30, color: TYPE_COLORS[e.type] || "#ffffff", x: a.x, y: a.y });
        }
        break;
      }
      case "area": {
        const isDrop = this.pendingDrop[e.s] === e.move;
        if (isDrop) this.pendingDrop[e.s] = null;
        const kind = isDrop ? DROPS[e.move] || "ring" : e.arc === -1 ? BURSTS[e.move] || "ring" : BURSTS[e.move] || "cone";
        this.area(kind, e, isDrop);
        break;
      }
      case "hit": {
        const d = side(e.s);
        this.burst(e.type, d.x, d.y, { power: e.crit || e.eff > 1 ? 1.5 : 1 });
        if (e.crit || e.eff > 1) this.shake = Math.max(this.shake, e.crit ? 0.18 : 0.1);
        break;
      }
      case "boost": {
        if (e.same) break;
        const d = side(e.s);
        const up = e.stage > 0;
        this.emit(10, () => ({ x: d.x + rnd(-0.6, 0.6), y: d.y + rnd(-0.2, 0.2), z: up ? rnd(0, 0.4) : rnd(1.2, 1.8), vz: up ? rnd(1.5, 2.5) : -rnd(1.5, 2.5),
          life: 0.7, color: up ? "#ffb15c" : "#7fb2ff", size: 0.22, kind: up ? "up" : "down" }));
        break;
      }
      case "heal": {
        const d = side(e.s);
        this.emit(10, () => ({ x: d.x + rnd(-0.5, 0.5), y: d.y + rnd(-0.2, 0.2), z: rnd(0.2, 0.8), vz: rnd(0.8, 1.6), life: 0.8, color: pick(["#7ee08f", "#d7ffd9"]), size: 0.16, kind: "plus" }));
        break;
      }
      case "status": {
        const d = side(e.s);
        const col = { brn: "Fire", par: "Electric", psn: "Poison", tox: "Poison", frz: "Ice", slp: "Psychic" }[e.status];
        if (col) this.burst(col, d.x, d.y, { power: 0.7 });
        break;
      }
      case "faint": {
        const d = side(e.s);
        this.emit(12, () => ({ x: d.x + rnd(-0.5, 0.5), y: d.y + rnd(-0.2, 0.2), z: rnd(0, 0.8), vz: rnd(0.3, 1.2), life: 1.1, color: "#ffffff", size: rnd(0.25, 0.45), kind: "smoke", alpha: 0.5 }));
        break;
      }
      case "sub": case "substitute": break;
      default: break;
    }
  }

  area(kind, e, isDrop) {
    const col = TYPE_COLORS[e.type] || "#ffffff";
    const { x, y, r } = e;
    switch (kind) {
      case "bolt":
        this.fx.push({ kind: "bolt", x, y, t: 0, life: 0.4 });
        this.fx.push({ kind: "flash", t: 0, life: 0.18, color: "#fffbe0" });
        this.burst("Electric", x, y, { z: 0.1, power: 1.4 });
        this.shake = Math.max(this.shake, 0.12);
        break;
      case "rocks": case "spikes":
        for (let i = 0; i < 7; i++) {
          const ox = x + rnd(-r, r) * 0.8, oy = y + rnd(-r, r) * 0.5;
          if (kind === "rocks") this.emit(1, { x: ox, y: oy, z: rnd(4, 7), vz: -rnd(6, 10), g: 20, life: 0.6, color: pick(["#b6a136", "#9b8a2e", "#cdbf7a"]), size: rnd(0.3, 0.5), vr: rnd(-6, 6), kind: "rock", land: "Rock", delay: i * 0.03 });
          else this.fx.push({ kind: "spike", x: ox, y: oy, t: -i * 0.03, life: 0.55, h: rnd(0.9, 1.6), color: pick(["#b6a136", "#d2c27a"]) });
        }
        this.shake = Math.max(this.shake, 0.08);
        break;
      case "erupt":
        this.fx.push({ kind: "column", x, y, t: 0, life: 0.6, r, color: col });
        this.burst(e.type === "Ground" ? "Ground" : e.type, x, y, { z: 0.1, power: 1.6 });
        this.shake = Math.max(this.shake, 0.14);
        break;
      case "psy":
        this.fx.push({ kind: "ring", x, y, z: 0.6, t: 0, life: 0.55, r0: r * 1.4, r1: 0.1, color: col });
        this.fx.push({ kind: "ring", x, y, z: 0.6, t: -0.1, life: 0.55, r0: r * 1.4, r1: 0.1, color: "#ffffff" });
        this.burst("Psychic", x, y, { power: 1.1 });
        break;
      case "tornado":
        this.fx.push({ kind: "tornado", x, y, t: 0, life: 0.8, r, color: col });
        break;
      case "star":
        this.fx.push({ kind: "meteor", x, y, t: 0, life: 0.45, color: col });
        this.burst(e.type, x, y, { power: 1.3 });
        this.shake = Math.max(this.shake, 0.1);
        break;
      case "ice":
        this.fx.push({ kind: "column", x, y, t: 0, life: 0.6, r, color: "#c6f2ff" });
        this.burst("Ice", x, y, { power: 1.8 });
        break;
      case "quake":
        this.fx.push({ kind: "cracks", x, y, t: 0, life: 0.9, r, seed: Math.random() });
        this.emit(24, (i) => { const a = (i / 24) * TAU; return { x: x + Math.cos(a) * r * 0.9, y: y + Math.sin(a) * r * 0.55, z: 0.05, vx: Math.cos(a) * 0.6, vy: Math.sin(a) * 0.3, vz: rnd(0.4, 1), life: 0.9, color: "#d8c9a0", size: 0.45, kind: "smoke", alpha: 0.45 }; });
        this.shake = Math.max(this.shake, 0.28);
        break;
      case "wave": case "mudwave":
        this.fx.push({ kind: "waterring", x, y, t: 0, life: 0.6, r, color: kind === "mudwave" ? "#a07c45" : "#6390f0" });
        this.emit(26, (i) => { const a = (i / 26) * TAU; return { x: x + Math.cos(a) * r, y: y + Math.sin(a) * r * 0.6, z: 0.2, vz: rnd(2, 4), g: 12, life: 0.6, color: kind === "mudwave" ? "#b89363" : pick(["#9cc8ff", "#ffffff"]), size: 0.14, kind: "drop" }; });
        break;
      case "electric":
        this.fx.push({ kind: "zapring", x, y, t: 0, life: 0.45, r });
        break;
      case "explode":
        this.fx.push({ kind: "explosion", x, y, t: 0, life: 0.6, r });
        this.fx.push({ kind: "flash", t: 0, life: 0.2, color: "#fff1d0" });
        this.burst("Fire", x, y, { power: 2.2 });
        this.shake = Math.max(this.shake, 0.35);
        break;
      case "sound":
        for (let i = 0; i < 3; i++) this.fx.push({ kind: e.arc === -1 ? "ring" : "arcs", x, y, fx: e.fx, fy: e.fy, z: H, t: -i * 0.08, life: 0.45, r0: 0.4, r1: r, arc: e.arc, color: col });
        break;
      case "snow": case "fire": case "poison": case "petals": case "fairy": {
        this.fx.push({ kind: e.arc === -1 ? "ring" : "cone", x, y, fx: e.fx, fy: e.fy, r, arc: e.arc, t: 0, life: 0.45, color: col, z: 0.05, r0: 0.3, r1: r, flat: true });
        const n = 30;
        this.emit(n, () => {
          let dx, dy;
          if (e.arc === -1) { const a = rnd(0, TAU); dx = Math.cos(a); dy = Math.sin(a); } else {
            const base = Math.atan2(e.fy, e.fx); const half = Math.acos(Math.max(-1, Math.min(1, e.arc))); const a = base + rnd(-half, half); dx = Math.cos(a); dy = Math.sin(a);
          }
          const v = rnd(4, 8);
          const style = { snow: { kind: "flake", color: pick(["#ffffff", "#dff6ff"]), vr: rnd(-3, 3) }, fire: { kind: "glow", color: pick(["#ffd27a", "#ff9a3c", "#ff5a1f"]) },
            poison: { kind: "bubble", color: pick(["#c86bd0", "#a33ea1"]) }, petals: { kind: "leaf", color: pick(["#ffb3d1", "#ff8fbf", "#ffe0ee"]), vr: rnd(-6, 6) },
            fairy: { kind: "star", color: pick(["#ffd1ea", "#ffffff"]), vr: rnd(-4, 4) } }[kind];
          return { x, y, z: H, vx: dx * v, vy: dy * v * 0.8, life: (r / v) * rnd(0.8, 1.1), size: rnd(0.12, 0.22), drag: 0.5, ...style };
        });
        break;
      }
      case "cone":
        this.fx.push({ kind: "cone", x, y, fx: e.fx, fy: e.fy, r, arc: e.arc, t: 0, life: 0.4, color: col, flat: true });
        this.emit(16, () => { const base = Math.atan2(e.fy, e.fx); const half = Math.acos(Math.max(-1, Math.min(1, e.arc))); const a = base + rnd(-half, half); const v = rnd(5, 8);
          return { x, y, z: H, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.8, life: r / v, color: pick([col, "#ffffff"]), size: 0.14, kind: "glow", drag: 0.5 }; });
        break;
      default:
        this.fx.push({ kind: "ring", x, y, z: 0.05, t: 0, life: 0.45, r0: r * 0.4, r1: r, color: col, flat: true, fill: true });
        if (isDrop) this.burst(e.type, x, y, { z: 0.2 });
    }
  }

  // ------------------------------------------------------------ per frame
  update(dt, view) {
    this.shake = Math.max(0, this.shake - dt * 0.9);
    for (const p of this.parts) {
      if (p.delay > 0) { p.delay -= dt; continue; }
      p.t += dt;
      const k = p.drag ? Math.max(0, 1 - p.drag * dt) : 1;
      p.vx *= k; p.vy *= k;
      p.vz -= p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.rot += p.vr * dt;
      if (p.z < 0) {
        if (p.land && !p.landed) { p.landed = true; this.burst(p.land, p.x, p.y, { z: 0.05, power: 0.5 }); p.t = p.life; }
        if (p.g) { p.z = 0; p.vz = -p.vz * 0.3; p.vx *= 0.6; p.vy *= 0.6; }
      }
    }
    this.parts = this.parts.filter((p) => p.t < p.life);
    // rays follow their projectile
    const live = new Map(view.projectiles.map((p) => [p.id, p]));
    for (const [id, ray] of this.rays) {
      ray.t += dt;
      const pr = live.get(id);
      if (pr) { ray.hx = pr.x; ray.hy = pr.y; } else if (ray.gone < 0) ray.gone = 0;
      if (ray.gone >= 0) ray.gone += dt;
      if (ray.gone > 0.3) this.rays.delete(id);
    }
    // trails behind shaped projectiles
    for (const p of view.projectiles) {
      if (this.rays.has(p.id)) continue;
      const kind = BALLS[p.move] || (p.shape === "wave" ? "wave" : "orb");
      const back = { x: p.x - p.vx * 0.02, y: p.y - p.vy * 0.02 };
      if (["fire", "electric", "shadow", "sludge", "aura", "energy", "moon", "drop", "mud", "orb", "snow", "ice"].includes(kind) || kind === "wave") {
        const col = TYPE_COLORS[p.type] || "#ffffff";
        const style = { fire: ["glow", ["#ffd27a", "#ff9a3c", "#ff5a1f"]], electric: ["spark", ["#fff7a8", "#f7d02c"]], shadow: ["smoke", ["#4b2d73", "#1d141d", "#735797"]],
          sludge: ["bubble", ["#c86bd0", "#7d2a80"]], drop: ["drop", ["#9cc8ff", "#ffffff"]], mud: ["drop", ["#a07c45", "#7a5a2a"]], snow: ["flake", ["#ffffff"]], ice: ["flake", ["#dff6ff", "#ffffff"]] }[kind] || ["glow", [col, "#ffffff"]];
        if (Math.random() < 0.8) this.emit(1, { x: back.x + rnd(-0.1, 0.1), y: back.y + rnd(-0.1, 0.1), z: H + rnd(-0.1, 0.1), vx: rnd(-0.5, 0.5), vy: rnd(-0.5, 0.5), vz: kind === "fire" ? rnd(0.3, 1) : 0,
          g: style[0] === "drop" ? 6 : 0, life: rnd(0.2, 0.4), color: pick(style[1]), size: rnd(0.1, 0.2), kind: style[0], alpha: style[0] === "smoke" ? 0.7 : 1 });
      }
    }
    // rays shed particles along their length
    for (const ray of this.rays.values()) {
      if (ray.gone >= 0) continue;
      const dx = ray.hx - ray.ox, dy = ray.hy - ray.oy;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const ux = dx / len, uy = dy / len;
      const at = (f) => ({ x: ray.ox + dx * f, y: ray.oy + dy * f });
      if (ray.kind === "ice" && Math.random() < 0.9) {
        const q = at(rnd(0.1, 1));
        this.emit(1, { ...q, z: H + rnd(-0.15, 0.15), vx: -uy * rnd(-1, 1), vy: ux * rnd(-1, 1) * 0.6, g: 3, life: rnd(0.4, 0.7), color: pick(["#e8fbff", "#9fe6f0"]), size: rnd(0.14, 0.26), vr: rnd(-6, 6), kind: "shard" });
      } else if (ray.kind === "fire") {
        for (let i = 0; i < 3; i++) { const q = at(rnd(0.15, 1)); this.emit(1, { ...q, z: H + rnd(-0.1, 0.15), vx: ux * rnd(2, 5) - uy * rnd(-1, 1), vy: uy * rnd(2, 5) + ux * rnd(-1, 1) * 0.6, vz: rnd(0.3, 1.2), drag: 2, life: rnd(0.2, 0.4), color: pick(["#fff0a0", "#ffb347", "#ff6a1f", "#d8361a"]), size: rnd(0.16, 0.32), kind: "glow" }); }
      } else if (ray.kind === "water" && Math.random() < 0.8) {
        const q = at(rnd(0.2, 1)); this.emit(1, { ...q, z: H, vx: -uy * rnd(-1.5, 1.5), vy: ux * rnd(-1.5, 1.5) * 0.6, vz: rnd(1, 2.5), g: 12, life: 0.45, color: pick(["#9cc8ff", "#ffffff"]), size: 0.1, kind: "drop" });
      } else if (ray.kind === "bubbles") {
        const q = at(rnd(0.1, 1)); this.emit(1, { ...q, z: H + rnd(-0.2, 0.2), vx: ux * 2, vy: uy * 2, life: 0.35, color: "#bfe0ff", size: rnd(0.12, 0.22), kind: "ring-dot" });
      } else if (ray.kind === "leaves" || ray.kind === "coins") {
        const q = at(rnd(0.6, 1)); this.emit(1, { ...q, z: H + rnd(-0.3, 0.3), vx: ux * 6 - uy * rnd(-2, 2), vy: uy * 6 + ux * rnd(-2, 2), life: 0.3, color: ray.kind === "coins" ? pick(["#ffd700", "#ffe98a"]) : pick(["#7ac74c", "#a7e06f"]), size: 0.18, vr: rnd(-10, 10), kind: ray.kind === "coins" ? "coin" : "leaf" });
      }
    }
    // status particles on the Pokémon on the field
    this.statusT += dt;
    if (this.statusT > 0.22) {
      this.statusT = 0;
      for (const side of view.sides) {
        const mon = side.mons[side.active];
        if (!mon || mon.fainted || side.need) continue;
        const st = mon.status;
        if (st === "brn") this.emit(1, { x: side.x + rnd(-0.4, 0.4), y: side.y, z: rnd(0.3, 1), vz: 1.2, life: 0.5, color: pick(["#ff9a3c", "#ff5a1f"]), size: 0.14, kind: "glow" });
        else if (st === "psn" || st === "tox") this.emit(1, { x: side.x + rnd(-0.4, 0.4), y: side.y, z: rnd(0.2, 0.9), vz: 0.8, life: 0.6, color: "#c86bd0", size: 0.12, kind: "bubble" });
        else if (st === "par" && Math.random() < 0.5) this.emit(1, { x: side.x + rnd(-0.5, 0.5), y: side.y, z: rnd(0.3, 1.2), life: 0.15, color: "#fff27a", size: 0.35, kind: "spark" });
        else if (st === "frz") this.emit(1, { x: side.x + rnd(-0.5, 0.5), y: side.y, z: rnd(0.2, 1.2), vz: -0.3, life: 0.6, color: "#e8fbff", size: 0.16, kind: "flake", vr: 2 });
      }
    }
    // weather
    this.weather(dt, view);
    for (const f of this.fx) f.t += dt;
    this.fx = this.fx.filter((f) => f.t < f.life);
  }

  weather(dt, view) {
    const w = view.weather?.id;
    if (!w) return;
    this.weatherT += dt;
    const A = { w: 28, h: 17 };
    const rate = { raindance: 70, primordialsea: 110, snow: 30, hail: 30, sandstorm: 60, sunnyday: 4, desolateland: 6 }[w] || 0;
    let n = 0;
    while (this.weatherT > 1 / rate && n < 8) { this.weatherT -= 1 / rate; n++; }
    for (let i = 0; i < n; i++) {
      const x = rnd(-2, A.w + 2), y = rnd(-1, A.h + 1);
      if (w === "raindance" || w === "primordialsea") this.emit(1, { x: x - 1, y: y - 3, z: 3, vx: 3, vy: 9, vz: -12, life: 0.35, color: "#a8c8ff", size: 0.5, kind: "streak", alpha: 0.6, weather: true });
      else if (w === "snow" || w === "hail") this.emit(1, { x, y: y - 2, z: 3, vx: rnd(-0.5, 0.5), vy: 1.2, vz: -1.2, life: 2.4, color: "#ffffff", size: rnd(0.08, 0.16), kind: w === "hail" ? "shard" : "flake", vr: rnd(-2, 2), weather: true });
      else if (w === "sandstorm") this.emit(1, { x: -2, y, z: rnd(0.2, 2.5), vx: rnd(10, 16), vy: rnd(-0.5, 0.5), life: 2.2, color: pick(["#e2bf65", "#c9a24f"]), size: rnd(0.05, 0.1), kind: "dot", alpha: 0.7, weather: true });
      else if (w === "sunnyday" || w === "desolateland") this.emit(1, { x, y, z: rnd(1, 3), vz: -0.2, life: 1.6, color: "#fff2b0", size: rnd(0.05, 0.1), kind: "glow", alpha: 0.6, weather: true });
    }
  }

  shakeOffset() {
    if (this.shake <= 0) return [0, 0];
    const k = this.shake * this.r.scale;
    return [rnd(-k, k), rnd(-k, k) * 0.6];
  }

  // ------------------------------------------------------------ drawing
  /** Ground marks: cracks, flat rings and cones, under the Pokémon. */
  drawUnder(ctx) {
    const s = this.r.scale;
    for (const f of this.fx) {
      if (f.t < 0) continue;
      const p = f.t / f.life, a = 1 - p;
      if (f.kind === "cracks") {
        ctx.strokeStyle = `rgba(60,40,20,${0.8 * a})`;
        ctx.lineWidth = Math.max(1.5, s * 0.08);
        let seed = Math.floor(f.seed * 1e6) || 1;
        const r2 = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
        for (let i = 0; i < 9; i++) {
          let ang = (i / 9) * TAU + r2() * 0.4, cx = f.x, cy = f.y;
          ctx.beginPath();
          ctx.moveTo(this.px(cx), this.py(cy));
          const reach = f.r * Math.min(1, p * 4);
          for (let j = 0; j < 4; j++) { ang += (r2() - 0.5) * 0.9; cx += Math.cos(ang) * reach / 4; cy += Math.sin(ang) * reach / 4 * 0.6; ctx.lineTo(this.px(cx), this.py(cy)); }
          ctx.stroke();
        }
      } else if ((f.kind === "ring" || f.kind === "waterring" || f.kind === "zapring") && (f.flat || f.kind !== "ring")) {
        const rr = f.kind === "ring" ? f.r0 + (f.r1 - f.r0) * p : f.r * (0.3 + 0.7 * p);
        ctx.save();
        ctx.translate(this.px(f.x), this.py(f.y));
        ctx.scale(1, 0.6);
        ctx.lineWidth = Math.max(2, s * (f.kind === "waterring" ? 0.35 : 0.12) * a);
        if (f.kind === "zapring") {
          ctx.strokeStyle = `rgba(255,240,120,${a})`;
          ctx.beginPath();
          for (let i = 0; i <= 28; i++) { const ang = (i / 28) * TAU; const j = rr * s * (1 + (Math.random() - 0.5) * 0.15); ctx.lineTo(Math.cos(ang) * j, Math.sin(ang) * j); }
          ctx.stroke();
        } else {
          ctx.strokeStyle = f.kind === "waterring" ? rgba(f.color, 0.75 * a) : rgba(f.color, 0.9 * a);
          if (f.fill) { ctx.fillStyle = rgba(f.color, 0.2 * a); }
          ctx.beginPath();
          ctx.arc(0, 0, rr * s, 0, TAU);
          if (f.fill) ctx.fill();
          ctx.stroke();
          if (f.kind === "waterring") { ctx.strokeStyle = `rgba(255,255,255,${0.6 * a})`; ctx.lineWidth = Math.max(1, s * 0.06); ctx.stroke(); }
        }
        ctx.restore();
      } else if (f.kind === "cone") {
        const ang = Math.atan2(f.fy, f.fx);
        const half = Math.acos(Math.max(-1, Math.min(1, f.arc)));
        const g = ctx.createRadialGradient(this.px(f.x), this.py(f.y), 0, this.px(f.x), this.py(f.y), f.r * s);
        g.addColorStop(0, rgba(f.color, 0.5 * a));
        g.addColorStop(1, rgba(f.color, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(this.px(f.x), this.py(f.y));
        ctx.arc(this.px(f.x), this.py(f.y), f.r * s * (0.5 + 0.5 * p), ang - half, ang + half);
        ctx.closePath();
        ctx.fill();
      } else if (f.kind === "aura") {
        const g = ctx.createRadialGradient(this.px(f.x), this.py(f.y), 0, this.px(f.x), this.py(f.y), 1.3 * s);
        g.addColorStop(0, rgba(f.color, 0.45 * a));
        g.addColorStop(1, rgba(f.color, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(this.px(f.x), this.py(f.y), 1.3 * s, 0.6 * s, 0, 0, TAU);
        ctx.fill();
      }
    }
  }

  /** Rays, projectiles, melee marks, bolts and particles over the Pokémon. */
  drawOver(ctx, view, battle) {
    const s = this.r.scale;
    ctx.save();
    // rays
    for (const ray of this.rays.values()) this.drawRay(ctx, ray, battle);
    // projectiles that are not rays
    for (const p of view.projectiles) if (!this.rays.has(p.id)) this.drawBall(ctx, p);
    // timed effects
    for (const f of this.fx) {
      if (f.t < 0) continue;
      const p = f.t / f.life, a = 1 - p;
      if (f.kind.startsWith("melee-")) this.drawMelee(ctx, f, p, a);
      else if (f.kind === "bolt") this.drawBolt(ctx, f, p, a);
      else if (f.kind === "cloud") {
        const cx = this.px(f.x), cy = this.py(f.y, 3.2);
        ctx.fillStyle = `rgba(40,40,60,${0.55 * Math.min(1, f.t * 4) * Math.min(1, (f.life - f.t) * 4)})`;
        for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc(cx + (i - 2) * 0.45 * s, cy + Math.sin(i * 2.1 + f.t * 3) * 0.12 * s, (0.45 + (i % 2) * 0.15) * s, 0, TAU); ctx.fill(); }
      } else if (f.kind === "ring" && !f.flat) {
        const rr = f.r0 + (f.r1 - f.r0) * p;
        ctx.strokeStyle = rgba(f.color, 0.9 * a);
        ctx.lineWidth = Math.max(2, s * 0.1 * a + 1);
        ctx.beginPath();
        ctx.ellipse(this.px(f.x), this.py(f.y, f.z || 0), rr * s, rr * s * 0.75, 0, 0, TAU);
        ctx.stroke();
      } else if (f.kind === "arcs") {
        const ang = Math.atan2(f.fy, f.fx);
        const rr = f.r0 + (f.r1 - f.r0) * p;
        ctx.strokeStyle = rgba(f.color, 0.85 * a);
        ctx.lineWidth = Math.max(2, s * 0.1);
        ctx.beginPath();
        ctx.arc(this.px(f.x), this.py(f.y, H), rr * s, ang - 0.7, ang + 0.7);
        ctx.stroke();
      } else if (f.kind === "star") {
        this.drawStar(ctx, this.px(f.x), this.py(f.y, f.z), 0.9 * s * (0.5 + p), 0.35 * s * (0.5 + p), 6, rgba("#ffffff", a), rgba(f.color, a));
      } else if (f.kind === "zap") {
        ctx.strokeStyle = rgba(f.color, a);
        ctx.lineWidth = Math.max(1.5, s * 0.07);
        for (let i = 0; i < 4; i++) {
          const ang = Math.random() * TAU;
          this.zigzag(ctx, this.px(f.x), this.py(f.y, f.z), this.px(f.x) + Math.cos(ang) * s * 1.2, this.py(f.y, f.z) + Math.sin(ang) * s * 1.2, 4, s * 0.25);
        }
      } else if (f.kind === "spike") {
        const grow = Math.min(1, p * 5);
        const bx = this.px(f.x), by = this.py(f.y);
        ctx.fillStyle = rgba(f.color, a);
        ctx.strokeStyle = `rgba(60,50,20,${a})`;
        ctx.lineWidth = Math.max(1, s * 0.04);
        ctx.beginPath();
        ctx.moveTo(bx - 0.25 * s, by);
        ctx.lineTo(bx + 0.05 * s, by - f.h * grow * s);
        ctx.lineTo(bx + 0.3 * s, by);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else if (f.kind === "column") {
        const g = ctx.createLinearGradient(0, this.py(f.y, 3), 0, this.py(f.y));
        g.addColorStop(0, rgba(f.color, 0));
        g.addColorStop(1, rgba(f.color, 0.75 * a));
        ctx.fillStyle = g;
        const w = f.r * s * (0.6 + 0.4 * p);
        ctx.fillRect(this.px(f.x) - w / 2, this.py(f.y, 3 * Math.min(1, p * 3)), w, 3 * Math.min(1, p * 3) * s);
      } else if (f.kind === "tornado") {
        ctx.strokeStyle = rgba("#ffffff", 0.7 * a);
        ctx.lineWidth = Math.max(1.5, s * 0.06);
        for (let i = 0; i < 7; i++) {
          const z = i * 0.45, rr = (0.4 + i * 0.22) * s;
          ctx.beginPath();
          ctx.ellipse(this.px(f.x) + Math.sin(f.t * 12 + i) * 0.15 * s, this.py(f.y, z), rr, rr * 0.3, 0, f.t * 10 + i, f.t * 10 + i + 4.4);
          ctx.stroke();
        }
      } else if (f.kind === "meteor") {
        const z = 5 * (1 - Math.min(1, p * 2.5));
        const cx = this.px(f.x - 2 * (1 - Math.min(1, p * 2.5))), cy = this.py(f.y, z);
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 0.8 * s);
        g.addColorStop(0, `rgba(255,255,255,${a})`);
        g.addColorStop(1, rgba(f.color, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, 0.8 * s, 0, TAU);
        ctx.fill();
      } else if (f.kind === "explosion") {
        const rr = f.r * s * (0.3 + 0.9 * p);
        const g = ctx.createRadialGradient(this.px(f.x), this.py(f.y, 0.8), 0, this.px(f.x), this.py(f.y, 0.8), rr);
        g.addColorStop(0, `rgba(255,255,240,${a})`);
        g.addColorStop(0.4, `rgba(255,170,60,${0.9 * a})`);
        g.addColorStop(1, "rgba(200,60,20,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(this.px(f.x), this.py(f.y, 0.8), rr, 0, TAU);
        ctx.fill();
      } else if (f.kind === "charge") {
        const side = battle.sides[f.s];
        const cx = this.px(side.x + side.fx * 0.8), cy = this.py(side.y + side.fy * 0.8, H);
        const rr = 0.55 * s * Math.min(1, p * 1.3);
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr * 1.6);
        g.addColorStop(0, `rgba(255,255,255,${0.9})`);
        g.addColorStop(0.5, rgba(f.color, 0.8));
        g.addColorStop(1, rgba(f.color, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, rr * 1.6, 0, TAU);
        ctx.fill();
        if (Math.random() < 0.6) { const ang = rnd(0, TAU); const d = rnd(1, 1.6); this.emit(1, { x: side.x + side.fx * 0.8 + Math.cos(ang) * d, y: side.y + side.fy * 0.8 + Math.sin(ang) * d * 0.6, z: H, vx: -Math.cos(ang) * d * 3, vy: -Math.sin(ang) * d * 1.8, life: 0.3, color: f.color, size: 0.1, kind: "glow" }); }
      }
    }
    // particles
    for (const p of this.parts) if (!(p.delay > 0)) this.drawPart(ctx, p, s);
    // full-screen flashes
    for (const f of this.fx) if (f.kind === "flash" && f.t >= 0) { ctx.fillStyle = rgba(f.color, 0.55 * (1 - f.t / f.life)); ctx.fillRect(0, 0, this.r.canvas.width, this.r.canvas.height); }
    ctx.restore();
  }

  drawPart(ctx, p, s) {
    const a = (1 - p.t / p.life) * (p.alpha ?? 1);
    const x = this.px(p.x), y = this.py(p.y, p.z), r = p.size * s;
    switch (p.kind) {
      case "glow": {
        const g = ctx.createRadialGradient(x, y, 0, x, y, r * 1.6);
        g.addColorStop(0, rgba("#ffffff", a));
        g.addColorStop(0.35, rgba(p.color, a));
        g.addColorStop(1, rgba(p.color, 0));
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, r * 1.6, 0, TAU); ctx.fill();
        break;
      }
      case "shard": {
        ctx.save(); ctx.translate(x, y); ctx.rotate(p.rot);
        ctx.fillStyle = rgba(p.color, a); ctx.strokeStyle = rgba("#ffffff", a); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, -r * 1.4); ctx.lineTo(r * 0.5, 0); ctx.lineTo(0, r * 1.4); ctx.lineTo(-r * 0.5, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.restore();
        break;
      }
      case "flake": {
        ctx.save(); ctx.translate(x, y); ctx.rotate(p.rot);
        ctx.strokeStyle = rgba(p.color, a); ctx.lineWidth = Math.max(1, r * 0.35);
        for (let i = 0; i < 3; i++) { ctx.rotate(Math.PI / 3); ctx.beginPath(); ctx.moveTo(-r, 0); ctx.lineTo(r, 0); ctx.stroke(); }
        ctx.restore();
        break;
      }
      case "leaf": case "feather": {
        ctx.save(); ctx.translate(x, y); ctx.rotate(p.rot);
        ctx.fillStyle = rgba(p.color, a);
        ctx.beginPath(); ctx.ellipse(0, 0, r * 1.2, r * (p.kind === "feather" ? 0.3 : 0.5), 0, 0, TAU); ctx.fill();
        ctx.strokeStyle = rgba("#ffffff", a * 0.5); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(-r * 1.1, 0); ctx.lineTo(r * 1.1, 0); ctx.stroke();
        ctx.restore();
        break;
      }
      case "rock": {
        ctx.save(); ctx.translate(x, y); ctx.rotate(p.rot);
        ctx.fillStyle = rgba(p.color, a); ctx.strokeStyle = `rgba(60,45,20,${a})`; ctx.lineWidth = Math.max(1, r * 0.15);
        ctx.beginPath();
        for (let i = 0; i < 6; i++) { const ang = (i / 6) * TAU; const rr = r * (0.75 + ((i * 37) % 5) / 10); ctx.lineTo(Math.cos(ang) * rr, Math.sin(ang) * rr); }
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.restore();
        break;
      }
      case "spark": {
        ctx.strokeStyle = rgba(p.color, a); ctx.lineWidth = Math.max(1, r * 0.25);
        const ang = p.rot;
        ctx.beginPath(); ctx.moveTo(x - Math.cos(ang) * r, y - Math.sin(ang) * r); ctx.lineTo(x + Math.cos(ang) * r, y + Math.sin(ang) * r); ctx.stroke();
        break;
      }
      case "drop": {
        ctx.fillStyle = rgba(p.color, a);
        ctx.beginPath(); ctx.ellipse(x, y, r * 0.7, r, 0, 0, TAU); ctx.fill();
        break;
      }
      case "bubble": case "ring-dot": {
        ctx.strokeStyle = rgba(p.color, a); ctx.lineWidth = Math.max(1, r * 0.25);
        ctx.fillStyle = rgba(p.color, a * 0.25);
        ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); ctx.stroke();
        break;
      }
      case "smoke": {
        const g = ctx.createRadialGradient(x, y, 0, x, y, r * (1 + p.t / p.life));
        g.addColorStop(0, rgba(p.color, a));
        g.addColorStop(1, rgba(p.color, 0));
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, r * (1 + p.t / p.life), 0, TAU); ctx.fill();
        break;
      }
      case "star": this.drawStar(ctx, x, y, r * 1.3, r * 0.5, 5, rgba(p.color, a), null, p.rot); break;
      case "plus": {
        ctx.fillStyle = rgba(p.color, a);
        ctx.fillRect(x - r, y - r * 0.3, r * 2, r * 0.6);
        ctx.fillRect(x - r * 0.3, y - r, r * 0.6, r * 2);
        break;
      }
      case "up": case "down": {
        ctx.fillStyle = rgba(p.color, a);
        const d = p.kind === "up" ? -1 : 1;
        ctx.beginPath(); ctx.moveTo(x, y + d * r); ctx.lineTo(x - r * 0.8, y - d * r * 0.2); ctx.lineTo(x + r * 0.8, y - d * r * 0.2); ctx.closePath(); ctx.fill();
        break;
      }
      case "streak": {
        ctx.strokeStyle = rgba(p.color, a); ctx.lineWidth = Math.max(1, s * 0.03);
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - p.vx * 0.04 * s, y - (p.vy * 0.6 - p.vz) * 0.04 * s); ctx.stroke();
        break;
      }
      case "coin": {
        ctx.fillStyle = rgba(p.color, a);
        ctx.beginPath(); ctx.ellipse(x, y, r * Math.abs(Math.cos(p.rot)) + 1, r, 0, 0, TAU); ctx.fill();
        break;
      }
      default:
        ctx.fillStyle = rgba(p.color, a);
        ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    }
  }

  drawStar(ctx, x, y, R, r, n, fill, stroke, rot = -Math.PI / 2) {
    ctx.beginPath();
    for (let i = 0; i < n * 2; i++) { const ang = rot + (i / (n * 2)) * TAU; const rr = i % 2 ? r : R; ctx.lineTo(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr); }
    ctx.closePath();
    if (stroke) { ctx.fillStyle = stroke; ctx.fill(); ctx.save(); ctx.translate(x, y); ctx.scale(0.55, 0.55); ctx.translate(-x, -y); ctx.fillStyle = fill; ctx.fill(); ctx.restore(); } else { ctx.fillStyle = fill; ctx.fill(); }
  }

  zigzag(ctx, x1, y1, x2, y2, n, amp) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx = -dy / len, ny = dx / len;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    for (let i = 1; i < n; i++) { const f = i / n; const o = (Math.random() - 0.5) * 2 * amp; ctx.lineTo(x1 + dx * f + nx * o, y1 + dy * f + ny * o); }
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  drawRay(ctx, ray) {
    const s = this.r.scale;
    const fade = ray.gone >= 0 ? Math.max(0, 1 - ray.gone / 0.3) : 1;
    const x1 = this.px(ray.ox), y1 = this.py(ray.oy, H), x2 = this.px(ray.hx), y2 = this.py(ray.hy, H);
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const col = TYPE_COLORS[ray.type] || "#ffffff";
    const pulse = 1 + Math.sin(ray.t * 40) * 0.12;
    const line = (w, style) => { ctx.strokeStyle = style; ctx.lineWidth = Math.max(1, w); ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
    const glow = (w, c, a) => {
      ctx.globalCompositeOperation = "source-over";
      line(w * 2.2, rgba(c, 0.3 * a * fade));
      line(w * 1.3, rgba(c, 0.7 * a * fade));
      ctx.globalCompositeOperation = "lighter";
      line(w * 0.45, `rgba(255,255,255,${0.95 * fade})`);
    };
    const head = (rr, c) => { const g = ctx.createRadialGradient(x2, y2, 0, x2, y2, rr); g.addColorStop(0, `rgba(255,255,255,${fade})`); g.addColorStop(0.4, rgba(c, 0.85 * fade)); g.addColorStop(1, rgba(c, 0)); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x2, y2, rr, 0, TAU); ctx.fill(); };
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    switch (ray.kind) {
      case "electric": {
        for (let k = 0; k < 3; k++) {
          ctx.strokeStyle = k === 0 ? `rgba(255,255,255,${0.95 * fade})` : `rgba(255,236,90,${0.7 * fade})`;
          ctx.lineWidth = Math.max(1, s * (k === 0 ? 0.08 : 0.16));
          this.zigzag(ctx, x1, y1, x2, y2, Math.max(4, Math.round(len / (s * 0.7))), s * 0.35);
        }
        head(0.7 * s, "#f7d02c");
        break;
      }
      case "fire": glow(0.32 * s * pulse, "#ff7a2a", 0.8); head(0.65 * s, "#ffb347"); break;
      case "water": {
        glow(0.36 * s, "#4f86ef", 0.9);
        ctx.strokeStyle = `rgba(255,255,255,${0.6 * fade})`; ctx.lineWidth = Math.max(1, s * 0.05);
        ctx.beginPath();
        for (let i = 0; i <= 24; i++) { const f = i / 24; const o = Math.sin(f * 18 - ray.t * 30) * s * 0.12; ctx.lineTo(x1 + dx * f + nx * o, y1 + dy * f + ny * o); }
        ctx.stroke();
        head(0.6 * s, "#9cc8ff");
        break;
      }
      case "ice": {
        glow(0.26 * s, "#7fdcf0", 1);
        ctx.globalCompositeOperation = "source-over";
        for (let i = 1; i < 10; i++) { const f = (i / 10 + ray.t * 2) % 1; const cx = x1 + dx * f, cy = y1 + dy * f; this.drawStar(ctx, cx, cy, s * 0.22, s * 0.07, 6, `rgba(240,252,255,${0.85 * fade})`, null, ray.t * 6 + i); }
        ctx.globalCompositeOperation = "lighter";
        head(0.7 * s, "#c6f2ff");
        break;
      }
      case "hyper": glow(0.55 * s * pulse, "#ffb347", 1); line(0.9 * s * pulse, rgba("#ffe7a0", 0.18 * fade)); head(0.9 * s, "#ffe7a0"); break;
      case "solar": glow(0.6 * s * pulse, "#e9ff7a", 1); line(0.95 * s, rgba("#7ac74c", 0.2 * fade)); head(0.9 * s, "#f6ffb0"); break;
      case "psy": case "rings": case "dark": {
        const c = ray.kind === "psy" ? "#f95587" : ray.kind === "dark" ? "#8a5fb0" : col;
        line(0.2 * s, rgba(c, 0.6 * fade));
        ctx.strokeStyle = rgba(c, 0.95 * fade); ctx.lineWidth = Math.max(1.5, s * 0.07);
        const n = Math.max(3, Math.round(len / (s * 0.9)));
        for (let i = 0; i < n; i++) {
          const f = (i / n + ray.t * 3) % 1; const cx = x1 + dx * f, cy = y1 + dy * f; const rr = s * (0.25 + 0.25 * f);
          ctx.save(); ctx.translate(cx, cy); ctx.rotate(Math.atan2(dy, dx)); ctx.beginPath(); ctx.ellipse(0, 0, rr * 0.35, rr, 0, 0, TAU); ctx.stroke(); ctx.restore();
        }
        head(0.6 * s, c);
        break;
      }
      case "dragon": {
        for (const [c, ph] of [["#8f6bff", 0], ["#4cc3ff", Math.PI]]) {
          ctx.strokeStyle = rgba(c, 0.9 * fade); ctx.lineWidth = Math.max(1.5, s * 0.12);
          ctx.beginPath();
          for (let i = 0; i <= 30; i++) { const f = i / 30; const o = Math.sin(f * 14 - ray.t * 25 + ph) * s * 0.28; ctx.lineTo(x1 + dx * f + nx * o, y1 + dy * f + ny * o); }
          ctx.stroke();
        }
        head(0.75 * s, "#a58bff");
        break;
      }
      case "aurora": case "tri": {
        const cols = ray.kind === "tri" ? ["#ff6a3c", "#6fd3ff", "#ffe36a"] : ["#ff7ab6", "#ffd36a", "#7affb4", "#6fb7ff", "#c58bff"];
        cols.forEach((c, i) => {
          const o = (i - (cols.length - 1) / 2) * s * 0.11;
          ctx.strokeStyle = rgba(c, 0.8 * fade); ctx.lineWidth = Math.max(1.5, s * 0.1);
          ctx.beginPath(); ctx.moveTo(x1 + nx * o, y1 + ny * o); ctx.lineTo(x2 + nx * o, y2 + ny * o); ctx.stroke();
        });
        head(0.6 * s, "#ffffff");
        break;
      }
      case "bubbles": line(0.14 * s, rgba("#9cc8ff", 0.4 * fade)); head(0.45 * s, "#bfe0ff"); break;
      case "steel": glow(0.28 * s, "#d6d6e6", 1); head(0.65 * s, "#ffffff"); break;
      case "fairy": glow(0.3 * s, "#ff9ad1", 1); head(0.7 * s, "#ffd1ea"); break;
      case "leaves": line(0.22 * s, rgba("#7ac74c", 0.5 * fade)); head(0.55 * s, "#a7e06f"); break;
      case "coins": line(0.2 * s, rgba("#ffd700", 0.5 * fade)); head(0.55 * s, "#ffe98a"); break;
      case "wind": glow(0.3 * s, "#e0e8ff", 0.7); head(0.6 * s, "#ffffff"); break;
      default: glow(0.28 * s, col, 1); head(0.6 * s, col);
    }
    ctx.restore();
  }

  drawBall(ctx, p) {
    const s = this.r.scale;
    const kind = BALLS[p.move] || (p.shape === "wave" ? "wave" : "orb");
    const x = this.px(p.x), y = this.py(p.y, H);
    const col = TYPE_COLORS[p.type] || "#ffffff";
    const sp = Math.sqrt(p.vx * p.vx + p.vy * p.vy) || 1;
    const ang = Math.atan2(p.vy, p.vx);
    const t = performance.now() / 1000;
    const r = p.r * s;
    const orb = (c1, c2, rr = r * 1.3) => { const g = ctx.createRadialGradient(x, y, 0, x, y, rr); g.addColorStop(0, c1); g.addColorStop(0.45, c2); g.addColorStop(1, "rgba(0,0,0,0)"); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, rr, 0, TAU); ctx.fill(); };
    ctx.save();
    switch (kind) {
      case "shadow": orb("rgba(20,10,30,0.95)", "rgba(115,87,151,0.9)", r * 1.5); ctx.strokeStyle = "rgba(200,170,255,0.7)"; ctx.lineWidth = Math.max(1, s * 0.05); ctx.beginPath(); ctx.arc(x, y, r * 0.9, t * 8, t * 8 + 4); ctx.stroke(); break;
      case "aura": orb("rgba(255,255,255,0.95)", rgba(p.type === "Fighting" ? "#4c8dff" : col, 0.9), r * 1.5); ctx.strokeStyle = "rgba(160,200,255,0.8)"; ctx.lineWidth = Math.max(1, s * 0.05); ctx.beginPath(); ctx.arc(x, y, r * (1.1 + Math.sin(t * 20) * 0.1), 0, TAU); ctx.stroke(); break;
      case "energy": orb("rgba(240,255,220,0.95)", "rgba(122,199,76,0.9)", r * 1.5); break;
      case "sludge": orb("rgba(230,170,240,0.95)", "rgba(163,62,161,0.9)", r * 1.4); break;
      case "moon": orb("rgba(255,255,255,1)", "rgba(255,180,220,0.9)", r * 1.5); break;
      case "fire": orb("rgba(255,250,220,1)", "rgba(255,140,40,0.95)", r * 1.6); break;
      case "electric": {
        orb("rgba(255,255,255,1)", "rgba(247,208,44,0.95)", r * 1.4);
        ctx.strokeStyle = "rgba(255,245,150,0.9)"; ctx.lineWidth = Math.max(1, s * 0.05);
        for (let i = 0; i < 3; i++) { const a2 = Math.random() * TAU; this.zigzag(ctx, x, y, x + Math.cos(a2) * r * 2, y + Math.sin(a2) * r * 2, 3, r * 0.4); }
        break;
      }
      case "ice": case "gem": case "snow": {
        ctx.translate(x, y); ctx.rotate(ang + t * (kind === "snow" ? 6 : 0));
        ctx.fillStyle = kind === "gem" ? "rgba(255,240,170,0.95)" : "rgba(220,250,255,0.95)"; ctx.strokeStyle = kind === "gem" ? "#b6a136" : "#6fcfe0"; ctx.lineWidth = Math.max(1, s * 0.04);
        ctx.beginPath(); ctx.moveTo(r * 1.6, 0); ctx.lineTo(0, r * 0.55); ctx.lineTo(-r * 1.1, 0); ctx.lineTo(0, -r * 0.55); ctx.closePath(); ctx.fill(); ctx.stroke();
        break;
      }
      case "rock": case "mud": {
        ctx.translate(x, y); ctx.rotate(t * 9);
        ctx.fillStyle = kind === "mud" ? "#8a6b35" : "#b6a136"; ctx.strokeStyle = "#4a3a18"; ctx.lineWidth = Math.max(1, s * 0.05);
        ctx.beginPath(); for (let i = 0; i < 7; i++) { const a2 = (i / 7) * TAU; const rr = r * (0.8 + ((i * 3) % 4) / 10); ctx.lineTo(Math.cos(a2) * rr, Math.sin(a2) * rr); } ctx.closePath(); ctx.fill(); ctx.stroke();
        break;
      }
      case "leaf": case "seed": {
        ctx.translate(x, y); ctx.rotate(kind === "leaf" ? t * 14 : ang);
        ctx.fillStyle = kind === "seed" ? "#a07c45" : "#7ac74c"; ctx.strokeStyle = "#3f7a22"; ctx.lineWidth = Math.max(1, s * 0.04);
        ctx.beginPath(); ctx.ellipse(0, 0, r * 1.3, r * 0.55, 0, 0, TAU); ctx.fill(); ctx.stroke();
        break;
      }
      case "drop": case "bubble": {
        ctx.translate(x, y); ctx.rotate(ang);
        ctx.fillStyle = kind === "bubble" ? "rgba(190,225,255,0.35)" : "rgba(110,160,245,0.95)"; ctx.strokeStyle = "rgba(230,245,255,0.95)"; ctx.lineWidth = Math.max(1, s * 0.04);
        ctx.beginPath(); ctx.ellipse(0, 0, r * (kind === "bubble" ? 0.9 : 1.3), r * 0.8, 0, 0, TAU); ctx.fill(); ctx.stroke();
        break;
      }
      case "needle": case "dart": {
        ctx.translate(x, y); ctx.rotate(ang);
        ctx.strokeStyle = rgba(col, 1); ctx.lineWidth = Math.max(1.5, s * 0.07);
        ctx.beginPath(); ctx.moveTo(-r * 1.5, 0); ctx.lineTo(r * 1.2, 0); ctx.stroke();
        ctx.fillStyle = "#ffffff"; ctx.beginPath(); ctx.moveTo(r * 1.5, 0); ctx.lineTo(r * 0.9, r * 0.25); ctx.lineTo(r * 0.9, -r * 0.25); ctx.closePath(); ctx.fill();
        break;
      }
      case "star": this.drawStar(ctx, x, y, r * 1.4, r * 0.6, 5, "rgba(255,240,120,0.95)", null, t * 10); break;
      case "coin": ctx.fillStyle = "#ffd700"; ctx.beginPath(); ctx.ellipse(x, y, r * Math.abs(Math.cos(t * 12)) + 1, r, 0, 0, TAU); ctx.fill(); break;
      case "crescent": {
        ctx.translate(x, y); ctx.rotate(ang);
        ctx.fillStyle = "rgba(235,240,255,0.9)";
        ctx.beginPath(); ctx.arc(0, 0, r * 1.4, -1.3, 1.3); ctx.arc(-r * 0.5, 0, r * 1.1, 1.2, -1.2, true); ctx.closePath(); ctx.fill();
        break;
      }
      case "spark": case "wave": {
        const rr = r * (1 + 0.25 * Math.sin(t * 18));
        if (p.type === "Electric") { ctx.strokeStyle = "rgba(255,240,120,0.95)"; ctx.lineWidth = Math.max(1, s * 0.06); for (let i = 0; i < 2; i++) this.zigzag(ctx, x - rr, y + (i - 0.5) * rr * 0.6, x + rr, y + (i - 0.5) * rr * 0.6, 5, rr * 0.4); }
        else if (p.type === "Fire") orb("rgba(220,230,255,1)", "rgba(120,100,255,0.9)", r * 1.3);   // will-o-wisp's ghostly flame
        else if (p.type === "Grass" || p.type === "Poison" || p.type === "Bug") { for (let i = 0; i < 6; i++) { ctx.fillStyle = rgba(col, 0.7); ctx.beginPath(); ctx.arc(x + Math.cos(t * 5 + i) * rr * 0.8, y + Math.sin(t * 7 + i * 2) * rr * 0.5, r * 0.3, 0, TAU); ctx.fill(); } }
        else { ctx.strokeStyle = rgba(col, 0.9); ctx.lineWidth = Math.max(1.5, s * 0.06); for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(x, y, rr * (0.5 + i * 0.35), ang - 0.8, ang + 0.8); ctx.stroke(); } }
        break;
      }
      default: {
        const len = 0.7;
        const ux = p.vx / sp, uy = p.vy / sp;
        const g = ctx.createLinearGradient(this.px(p.x - ux * len), this.py(p.y - uy * len, H), x, y);
        g.addColorStop(0, rgba(col, 0)); g.addColorStop(1, rgba(col, 0.85));
        ctx.strokeStyle = g; ctx.lineCap = "round"; ctx.lineWidth = r * 1.2;
        ctx.beginPath(); ctx.moveTo(this.px(p.x - ux * len), this.py(p.y - uy * len, H)); ctx.lineTo(x, y); ctx.stroke();
        orb("rgba(255,255,255,0.95)", rgba(col, 0.9));
      }
    }
    ctx.restore();
  }

  drawMelee(ctx, f, p, a) {
    if (f.delay && f.t < f.delay) return;
    const s = this.r.scale;
    const kind = f.kind.slice(6);
    const x = this.px(f.x), y = this.py(f.y, f.z);
    const ang = Math.atan2(f.fy, f.fx);
    ctx.save();
    ctx.translate(x, y);
    ctx.lineCap = "round";
    if (kind === "slash") {
      ctx.rotate(ang + Math.PI / 2);
      for (let i = -1; i <= 1; i++) {
        ctx.strokeStyle = `rgba(255,255,255,${a})`; ctx.lineWidth = Math.max(1.5, s * 0.09);
        const k = Math.min(1, p * 3);
        ctx.beginPath(); ctx.moveTo(i * 0.28 * s - 0.5 * s, -0.7 * s); ctx.lineTo(i * 0.28 * s - 0.5 * s + k * s, -0.7 * s + k * 1.4 * s); ctx.stroke();
        ctx.strokeStyle = rgba(f.color, 0.8 * a); ctx.lineWidth = Math.max(1, s * 0.04); ctx.stroke();
      }
    } else if (kind === "bite") {
      const close = Math.min(1, p * 2.5);
      for (const d of [-1, 1]) {
        ctx.fillStyle = `rgba(255,255,255,${a})`;
        ctx.strokeStyle = `rgba(80,80,80,${a})`;
        ctx.lineWidth = 1;
        for (let i = 0; i < 4; i++) {
          const tx = (i - 1.5) * 0.3 * s, ty = d * (0.75 - close * 0.6) * s;
          ctx.beginPath(); ctx.moveTo(tx - 0.13 * s, ty); ctx.lineTo(tx + 0.13 * s, ty); ctx.lineTo(tx, ty - d * 0.32 * s); ctx.closePath(); ctx.fill(); ctx.stroke();
        }
      }
    } else if (kind === "punch" || kind === "kick") {
      this.drawStar(ctx, 0, 0, s * (0.6 + p * 0.6), s * (0.25 + p * 0.25), kind === "punch" ? 8 : 6, rgba("#ffffff", a), rgba(f.color, a));
    } else if (kind === "pierce") {
      ctx.rotate(ang);
      ctx.strokeStyle = `rgba(255,255,255,${a})`; ctx.lineWidth = Math.max(1.5, s * 0.08);
      for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(-0.6 * s, i * 0.25 * s); ctx.lineTo((-0.6 + Math.min(1, p * 3) * 1.4) * s, i * 0.1 * s); ctx.stroke(); }
    } else {
      ctx.strokeStyle = rgba(f.color, a); ctx.lineWidth = Math.max(2, s * 0.12);
      ctx.beginPath(); ctx.arc(0, 0, s * (0.4 + p * 0.6), ang - 1, ang + 1); ctx.stroke();
      this.drawStar(ctx, 0, 0, s * 0.5, s * 0.2, 6, rgba("#ffffff", a), null);
    }
    ctx.restore();
  }

  drawBolt(ctx, f, p, a) {
    const s = this.r.scale;
    const x = this.px(f.x), y = this.py(f.y);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let k = 0; k < 3; k++) {
      ctx.strokeStyle = k === 0 ? `rgba(255,255,255,${a})` : `rgba(255,236,90,${0.75 * a})`;
      ctx.lineWidth = Math.max(1.5, s * (k === 0 ? 0.12 : 0.26));
      this.zigzag(ctx, x + rnd(-0.3, 0.3) * s, 0, x, y, 9, s * 0.5);
    }
    const g = ctx.createRadialGradient(x, y, 0, x, y, 1.6 * s);
    g.addColorStop(0, `rgba(255,255,220,${a})`);
    g.addColorStop(1, "rgba(255,230,90,0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(x, y, 1.6 * s, 0.8 * s, 0, 0, TAU); ctx.fill();
    ctx.restore();
  }
}
