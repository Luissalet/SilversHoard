// Draws a mass battle (engine/src/realtime/mass.mjs) on a canvas: the field, every Pokémon with its team's ring under its feet
// (walking sprites of SpriteCollab when the app has them, the battle sprites meanwhile), the giants several times bigger, moves'
// names in pills of their type's colour over whoever uses them, projectiles, beams, areas marked on the ground, hits and knockouts
// that dissolve. A camera frames the whole field and can zoom, pan and follow one Pokémon, or direct itself (auto: it keeps everyone
// still standing in the frame, closer as they thin out). The Pokémon a person plays wears a gold ring and its aim shows as a
// crosshair. With sound on, moves, hits and knockouts are heard (a crowd only by the loudest few). It reads the battle; it never
// changes it.
// The moves look as they do in one-on-one real time (rt/vfx.js): the same rays, balls, melee marks, areas, drops from the sky and
// hits by type; a wave (Surf, Earthquake... rules version 2) is drawn from the battle's own clock, so its front reaches each
// Pokémon on the frame it is hit.
import { TYPE_COLORS, nameOf } from "../dex.js";
import { sfx } from "../../audio.js";
import { Animator, dirRow, image, loadMeta } from "../rt/pmd.js";
import { Vfx } from "../rt/vfx.js";
import { TPS } from "../../../../engine/src/realtime/mass.mjs";

const FLOOR_COLORS = {
  grass: ["#4f8a4a", "#4a8345", "#2b4a2a"], sand: ["#d7bd86", "#cfb47c", "#8a7448"], ice: ["#cfe6f0", "#c4dfeb", "#7aa3b6"],
  cave: ["#4b4239", "#463e35", "#2a241f"], indoor: ["#b5875a", "#ad7f53", "#6d4c2e"], water: ["#4f8fbf", "#4a88b6", "#2a5677"],
  pyre: ["#5c5652", "#57514d", "#2f2b29"], summit: ["#e8eef2", "#dfe7ec", "#9aa9b3"], meteor: ["#58515e", "#524b58", "#2c2730"],
  champion: ["#7a5c8a", "#735684", "#3e2c48"], castle: ["#6b6660", "#65605a", "#3a3632"],
};
const TAU = Math.PI * 2;
const toId = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const rnd = (a, b) => a + Math.random() * (b - a);
// what a wave's front sheds as it rolls (particles of rt/vfx.js)
const NO_BATTLE = { doubles: false, sides: [] };   // rt/vfx.js only needs a battle for effects this screen never makes
const SPRAY = { wave: ["drop", ["#9cc8ff", "#ffffff", "#5f95f0"]], mudwave: ["drop", ["#b89363", "#8a6b35"]], quake: ["smoke", ["#d8c9a0", "#b8954a"]],
  electric: ["spark", ["#fff7a8", "#f7d02c"]], fire: ["glow", ["#ffd27a", "#ff9a3c", "#ff5a1f"]], poison: ["bubble", ["#c86bd0", "#a33ea1"]],
  sound: ["glow", ["#ffffff", "#dcd3ff"]], petals: ["leaf", ["#ffb3d1", "#ff8fbf"]], snow: ["flake", ["#ffffff", "#dff6ff"]] };

function rgba(hex, a) {
  const n = parseInt((hex || "#cccccc").slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export class MassRenderer {
  constructor(canvas, battle, { sprites, base = "", offline = false, texts = {}, sound = false, lang = "es" }) {
    this.canvas = canvas;
    this.lang = lang;   // the language of the moves' names over the Pokémon
    this.ctx = canvas.getContext("2d");
    this.b = battle;
    this.sprites = sprites;
    this.base = base;
    this.offline = offline;
    this.texts = texts;
    this.anims = battle.units.map(() => null);
    // the whole crowd's icons come in one picture (Showdown's icon sheet: through the app, or from the sprite server on a page with
    // no app behind it); single battle sprites only for the giants
    this.icons = image(offline ? `${String(sprites.server || "https://play.pokemonshowdown.com/sprites").replace(/\/$/, "")}/pokemonicons-sheet.png`
      : `${base}/api/sprites/pokemon-icons.png`);
    this.statics = battle.units.map((u) => (u.boss ? image(sprites.fallback(u.species, { spriteid: u.sprite_id })) : null));
    this.sound = sound;
    this.me = battle.player ?? -1;   // the Pokémon a person plays
    this.aim = null;                 // {x, y}: where the person aims
    this.auto = false;               // the camera directs itself
    this.credits = new Set();
    this.pills = [];          // {u, text, color, until}
    this.fx = [];             // short effects: {kind, x, y, r, color, t0, life, ...}
    this.dead = [];           // knocked-out units fading: {u, t0}
    this.flash = new Float32Array(battle.units.length);
    this.waves = [];          // waves rolling out: {x, y, r0, max, speed (m/s), t (tick it started), type, kind}
    this.rayN = 0;
    // the real-time effects, drawn through this screen's camera
    const me = this;
    this.vfx = new Vfx({ px: (x) => me.sx(x), py: (y) => me.sy(y), get scale() { return me.scale; }, get canvas() { return me.canvas; } });
    this.eventIndex = 0;
    this.time = 0;
    this.cam = { x: battle.arena.w / 2, y: battle.arena.h / 2, zoom: 1 };
    this.follow = -1;
    this.resize(canvas.clientWidth || 900);
  }

  /** Load the walking sprites, one per species (shared by every unit of that species). */
  async preload(onProgress = () => {}, timeout = 20000) {
    if (this.offline) return;
    const bySpecies = new Map();
    // a crowd of hundreds stays with its icons (one picture for all); walking sprites for up to 300, and always for the giants
    const crowd = this.b.units.length > 300;
    this.b.units.forEach((u, i) => {
      if (crowd && !u.boss) return;
      const key = `${u.num}|${u.forme}|${u.shiny ? 1 : 0}`;
      if (!bySpecies.has(key)) bySpecies.set(key, []);
      bySpecies.get(key).push(i);
    });
    const jobs = [...bySpecies.entries()];
    let done = 0;
    let next = 0;
    const worker = async () => {
      while (next < jobs.length) {
        const [key, list] = jobs[next++];
        const [num, form, shiny] = key.split("|");
        const meta = await loadMeta(Number(num), { form, shiny: shiny === "1", base: this.base });
        if (meta) {
          for (const who of meta.credit || []) this.credits.add(who);
          for (const i of list) this.anims[i] = new Animator(meta, this.base);
          for (const a of ["Idle", "Walk"]) if (meta.a?.[a]) image(`${this.base}/api/sprites/pmd-sheet/${meta.key}/${a}.png`);
        }
        done++;
        onProgress(done, jobs.length);
      }
    };
    await Promise.race([Promise.all(Array.from({ length: 6 }, worker)), new Promise((r) => setTimeout(r, timeout))]);
  }

  resize(width, maxHeight = 0) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const ratio = this.b.arena.w / this.b.arena.h;
    const maxH = maxHeight || Math.max(300, (window.innerHeight || 800) - 260);
    const w = Math.max(320, Math.floor(Math.min(width, maxH * ratio)));
    if (this.cssW && Math.abs(this.cssW - w) < 16 && this.dpr === dpr) return;
    this.cssW = w;
    this.dpr = dpr;
    const h = Math.floor(w / ratio);
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.base0 = (w * dpr) / this.b.arena.w;    // canvas pixels per meter at zoom 1
    this.floorCache = null;
  }

  get scale() { return this.base0 * this.cam.zoom; }
  sx(x) { return (x - this.cam.x) * this.scale + this.canvas.width / 2; }
  sy(y) { return (y - this.cam.y) * this.scale + this.canvas.height / 2; }
  /** Screen (CSS pixels) to field meters. */
  toWorld(px, py) {
    return { x: (px * this.dpr - this.canvas.width / 2) / this.scale + this.cam.x, y: (py * this.dpr - this.canvas.height / 2) / this.scale + this.cam.y };
  }

  zoomAt(px, py, factor) {
    const before = this.toWorld(px, py);
    this.cam.zoom = Math.max(1, Math.min(8, this.cam.zoom * factor));
    const after = this.toWorld(px, py);
    this.cam.x += before.x - after.x;
    this.cam.y += before.y - after.y;
    this.clampCam();
  }

  pan(dx, dy) {
    this.cam.x -= (dx * this.dpr) / this.scale;
    this.cam.y -= (dy * this.dpr) / this.scale;
    this.follow = -1;
    this.clampCam();
  }

  /** Whether a point of the field is inside the picture (with a margin): effects for a crowd are made only where the camera looks. */
  onScreen(fx, fy) {
    if (this.b.units.length <= 60) return true;
    const px = this.sx(fx);
    const py = this.sy(fy);
    return px > -80 && py > -80 && px < this.canvas.width + 80 && py < this.canvas.height + 80;
  }

  reset() { this.cam = { x: this.b.arena.w / 2, y: this.b.arena.h / 2, zoom: 1 }; this.follow = -1; this.auto = false; }

  /** The camera on its own: everyone still standing in the frame (with a margin), eased so it never jumps. */
  direct(dt) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const u of this.b.units) {
      if (u.fainted) continue;
      x0 = Math.min(x0, u.x - u.r); y0 = Math.min(y0, u.y - u.r * 2.5); x1 = Math.max(x1, u.x + u.r); y1 = Math.max(y1, u.y + u.r);
    }
    if (x0 === Infinity) return;
    const { w, h } = this.b.arena;
    const zoom = Math.max(1, Math.min(3.5, Math.min(w / (x1 - x0 + 6), h / (y1 - y0 + 4.5))));
    const k = Math.min(1, dt * 2.5);
    this.cam.zoom += (zoom - this.cam.zoom) * k;
    this.cam.x += ((x0 + x1) / 2 - this.cam.x) * k;
    this.cam.y += ((y0 + y1) / 2 - this.cam.y) * k;
    this.clampCam();
  }

  clampCam() {
    const hw = this.canvas.width / 2 / this.scale;
    const hh = this.canvas.height / 2 / this.scale;
    const { w, h } = this.b.arena;
    this.cam.x = hw * 2 >= w ? w / 2 : Math.min(w - hw, Math.max(hw, this.cam.x));
    this.cam.y = hh * 2 >= h ? h / 2 : Math.min(h - hh, Math.max(hh, this.cam.y));
  }

  /** The unit under a point of the screen (CSS pixels), or -1. */
  pick(px, py) {
    const p = this.toWorld(px, py);
    let best = -1;
    let bd = Infinity;
    for (const u of this.b.units) {
      if (u.fainted) continue;
      const d = (u.x - p.x) ** 2 + (u.y - 0.4 * u.size - p.y) ** 2;
      if (d < Math.max(1, u.r * u.r * 2.5) && d < bd) { bd = d; best = u.i; }
    }
    return best;
  }

  // ------------------------------------------------------------ events of the battle -> what the screen shows
  absorb() {
    const ev = this.b.events;
    const units = this.b.units;
    // a jump (skip to the end) brings thousands of events at once: only the sound of the last few
    const loud = this.sound && ev.length - this.eventIndex < 400;
    const close = (i) => i === this.me || i === this.follow || units[i]?.boss || units.length <= 30;
    for (; this.eventIndex < ev.length; this.eventIndex++) {
      const e = ev[this.eventIndex];
      const u = units[e.u];
      const color = TYPE_COLORS[e.type] || "#ffffff";
      switch (e.k) {
        case "use":
          // a crowd would bury the field in names: the giants and whoever you follow always, the rest while there is room
          if (u.boss || e.u === this.follow || e.u === this.me || this.pills.filter((p) => !units[p.u].boss).length < (units.length > 60 ? 8 : 14)) {
            this.pills.push({ u: e.u, text: nameOf("move", e.move, this.lang), color, until: this.time + 1.0 });
          }
          this.anims[e.u]?.play(["shot", "beam", "wave", "drop"].includes(e.shape) ? "Shoot" : "Attack", { speed: 1.4 });
          if (loud) sfx("move", { type: e.type, gap: close(e.u) ? 0.05 : 0.18, vol: close(e.u) ? 1 : 0.45 });
          break;
        case "hit":
          // a white flash on the one hit (a giant hit all the time only glints, or it would stay white)
          if (this.flash[e.u] < 0.2) this.flash[e.u] = u.boss ? (e.crit ? 0.35 : 0.15) : 0.8;
          // the type's hit burst (a crowd only where the camera looks)
          if (this.onScreen(u.x, u.y)) this.vfx.hitAt(e.id || "", e.type, u.x, u.y - 0.4 * u.size + 0.6, { strong: e.crit || e.eff > 1 });
          if ((units[e.by]?.boss || u.boss || e.u === this.follow || (units.length <= 40 && (e.crit || e.eff > 1))) && this.fx.filter((f) => f.kind === "num").length < 12) {
            const txt = e.crit ? `${e.dmg}!` : String(e.dmg);
            this.fx.push({ kind: "num", x: u.x, y: u.y - u.r * 2.2, text: txt, color: e.eff > 1 ? "#ffd54a" : e.eff < 1 ? "#b8c2cc" : "#ffffff", t0: this.time, life: 0.8 });
          }
          this.anims[e.u]?.play("Hurt", { speed: 1.5 });
          if (loud) sfx(e.crit ? "crit" : e.eff > 1 ? "super" : e.eff < 1 ? "resisted" : "hit", { gap: close(e.u) || close(e.by) ? 0.05 : 0.12, vol: close(e.u) || close(e.by) ? 1 : 0.4 });
          break;
        case "dodge":
          this.fx.push({ kind: "num", x: u.x, y: u.y - u.r * 2.2, text: this.texts.dodge || "Dodge!", color: "#9fe7ff", t0: this.time, life: 0.7 });
          if (loud) sfx("miss", { gap: 0.1 });
          break;
        case "roll":
          this.fx.push({ kind: "trail", x: u.x, y: u.y, x1: u.x + e.dx * 3.6, y1: u.y + e.dy * 3.6, w: u.r * 0.8, color: "#ffffff", t0: this.time, life: 0.3 });
          this.anims[e.u]?.play("Hop", { speed: 1.5 });
          if (loud) sfx("roll");
          break;
        case "immune":
          if (units.length > 40 && !u.boss && e.u !== this.follow) break;
          this.fx.push({ kind: "num", x: u.x, y: u.y - u.r * 2.2, text: this.texts.immune || "No effect", color: "#b8c2cc", t0: this.time, life: 0.9 });
          break;
        case "beam":
          this.vfx.rayAt(`b${this.rayN++}`, e.id || toId(e.move), e.type, e.x0, e.y0, e.x1, e.y1);
          break;
        case "burst":
          // all at once around the user (an explosion; every area move around the user in rules version 1)
          this.vfx.areaAt(e.id || toId(e.move), e.type, e.x, e.y, e.r);
          break;
        case "wave": {
          // rolls out at the battle's pace; drawn from its clock in draw(). An earthquake also cracks the ground under it
          const kind = this.vfx.areaKind(e.id || toId(e.move));
          this.waves.push({ x: e.x, y: e.y, r0: units[e.u]?.r || 0.4, max: e.r, speed: e.speed, t: e.t, type: e.type, kind });
          if (kind === "quake") this.vfx.areaAt(e.id, e.type, e.x, e.y, e.r);
          if (loud) sfx("move", { type: e.type, gap: 0.05, vol: close(e.u) ? 1 : 0.6 });
          break;
        }
        case "swing":
          if (e.shape === "cone") this.vfx.areaAt(e.id || toId(e.move), e.type, u.x, u.y, e.reach, { arc: e.arc ?? 0.55, fx: e.dx, fy: e.dy });
          else this.vfx.meleeAt(e.id || toId(e.move), e.type, u.x, u.y - 0.3 * u.size + 0.6, e.dx, e.dy);
          break;
        case "dash":
          this.fx.push({ kind: "trail", x: e.x0, y: e.y0, x1: e.x1, y1: e.y1, w: u.r, color, t0: this.time, life: 0.3 });
          this.vfx.meleeAt(e.id || toId(e.move), e.type, e.x1, e.y1 - 0.3 * u.size + 0.6, e.x1 - e.x0, e.y1 - e.y0, { dash: true });
          break;
        case "land":
          this.vfx.areaAt(e.id || "", e.type, e.x, e.y, e.r, { drop: true });
          break;
        case "impact":
          break;   // the hit itself shows (above)
        case "heal":
          this.fx.push({ kind: "num", x: u.x, y: u.y - u.r * 2.2, text: `+${e.n}`, color: "#6fe38a", t0: this.time, life: 0.8 });
          break;
        case "boost":
          this.fx.push({ kind: "ring", x: u.x, y: u.y, r: u.r * 1.6, color: "#ffb347", t0: this.time, life: 0.6 });
          break;
        case "ko":
          this.dead.push({ u: e.u, t0: this.time, x: u.x, y: u.y });
          this.fx.push({ kind: "poof", x: u.x, y: u.y - 0.4 * u.size, color: this.b.teams[u.team].color, t0: this.time, life: 0.8, r: u.r * 2 });
          if (loud) sfx(u.boss ? "big" : "faint", { gap: close(e.u) ? 0.05 : 0.2, vol: close(e.u) ? 1 : 0.5 });
          break;
        default:
      }
    }
  }

  // ------------------------------------------------------------ drawing
  /** Waves rolling out (rules version 2), from the battle's clock: the front is where the battle has it, so it reaches each
   * Pokémon on the frame it is hit; the water (the ground thrown up, the sparks...) behind it thins towards the middle. */
  drawWaves(x) {
    const now = this.b.t;
    const s = this.scale;
    this.waves = this.waves.filter((w) => now >= w.t && (now - w.t) / TPS < (w.max - w.r0) / w.speed + 0.35);
    for (const w of this.waves) {
      const secs = (now - w.t) / TPS;
      const r = Math.min(w.max, w.r0 + w.speed * secs);
      const over = Math.max(0, secs - (w.max - w.r0) / w.speed);
      const a = Math.max(0, 1 - over / 0.35);
      const col = TYPE_COLORS[w.type] || "#6390f0";
      const cx = this.sx(w.x);
      const cy = this.sy(w.y);
      const rr = r * s;
      const g = x.createRadialGradient(cx, cy, rr * 0.35, cx, cy, Math.max(1, rr));
      g.addColorStop(0, rgba(col, 0));
      g.addColorStop(0.75, rgba(col, 0.22 * a));
      g.addColorStop(1, rgba(col, 0.5 * a));
      x.fillStyle = g;
      x.beginPath(); x.arc(cx, cy, rr, 0, TAU); x.fill();
      // the crest (with foam on water) and two ripples behind it
      x.lineWidth = Math.max(2, s * 0.35);
      x.strokeStyle = rgba(col, 0.85 * a);
      x.beginPath(); x.arc(cx, cy, rr, 0, TAU); x.stroke();
      x.lineWidth = Math.max(1, s * 0.1);
      x.strokeStyle = `rgba(255,255,255,${((w.kind === "wave" ? 0.85 : 0.45) * a).toFixed(3)})`;
      x.beginPath(); x.arc(cx, cy, Math.max(0, rr - s * 0.12), 0, TAU); x.stroke();
      for (let i = 1; i <= 2; i++) {
        const ri = rr - i * s * 0.9;
        if (ri <= 0) break;
        x.lineWidth = Math.max(1, s * 0.08);
        x.strokeStyle = rgba(col, (0.35 * a) / i);
        x.beginPath(); x.arc(cx, cy, ri, 0, TAU); x.stroke();
      }
      // spray along the front while it rolls
      if (!over && this.onScreen(w.x, w.y)) {
        const [kind, colors] = SPRAY[w.kind] || ["glow", [col, "#ffffff"]];
        this.vfx.emit(Math.min(14, Math.ceil(r * 1.5)), () => {
          const ang = rnd(0, TAU);
          return { x: w.x + Math.cos(ang) * r, y: w.y + Math.sin(ang) * r, z: rnd(0.1, 0.5), vx: Math.cos(ang) * rnd(1, 3), vy: Math.sin(ang) * rnd(1, 3),
            vz: rnd(1.5, 3.5), g: kind === "drop" ? 12 : 0, drag: 1, life: rnd(0.3, 0.55), color: colors[Math.floor(Math.random() * colors.length)],
            size: rnd(0.1, 0.18), kind };
        });
      }
    }
  }

  drawFloor(x) {
    const { w, h } = this.b.arena;
    const [a, b2, edge] = FLOOR_COLORS[this.b.floor] || FLOOR_COLORS.grass;
    x.fillStyle = edge;
    x.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const x0 = this.sx(0);
    const y0 = this.sy(0);
    const s = this.scale;
    x.fillStyle = a;
    x.fillRect(x0, y0, w * s, h * s);
    // stripes and a speckle, so moving the camera reads
    x.fillStyle = b2;
    for (let i = 0; i < w; i += 4) x.fillRect(x0 + i * s, y0, 2 * s, h * s);
    x.fillStyle = "rgba(255,255,255,0.05)";
    for (let i = 1; i < w; i += 3) for (let j = 1; j < h; j += 3) x.fillRect(x0 + (i + ((j * 7) % 3) * 0.6) * s, y0 + j * s, Math.max(1, s * 0.12), Math.max(1, s * 0.12));
    x.strokeStyle = "rgba(0,0,0,0.35)";
    x.lineWidth = Math.max(2, s * 0.15);
    x.strokeRect(x0, y0, w * s, h * s);
  }

  draw(dt) {
    this.time += dt;
    this.absorb();
    const b = this.b;
    if (this.follow >= 0) {
      const f = b.units[this.follow];
      if (f.fainted) this.follow = -1;
      else { this.cam.x += (f.x - this.cam.x) * Math.min(1, dt * 5); this.cam.y += (f.y - this.cam.y) * Math.min(1, dt * 5); this.clampCam(); }
    } else if (this.auto) this.direct(dt);
    const x = this.ctx;
    const s = this.scale;
    // the real-time effects move on: rays, the balls' trails, particles (a crowd's projectiles only where the camera looks)
    const view = { projectiles: b.units.length > 60 ? b.projectiles.filter((p) => this.onScreen(p.x, p.y)) : b.projectiles, sides: [], doubles: false };
    this.vfx.update(dt, view);
    x.save();
    const [shx, shy] = this.vfx.shakeOffset();
    if (shx || shy) x.translate(shx * 0.6, shy * 0.6);
    x.imageSmoothingEnabled = false;
    this.drawFloor(x);
    // marks on the ground (areas about to land)
    for (const m of b.marks) {
      const k = Math.max(0, Math.min(1, 1 - (m.land - b.t) / 15));
      x.fillStyle = rgba(TYPE_COLORS[m.type] || "#ff5050", 0.12 + 0.25 * k);
      x.strokeStyle = rgba(TYPE_COLORS[m.type] || "#ff5050", 0.8);
      x.lineWidth = Math.max(1, s * 0.06);
      x.beginPath(); x.arc(this.sx(m.x), this.sy(m.y), m.r * s, 0, TAU); x.fill(); x.stroke();
    }
    this.vfx.drawUnder(x);
    this.drawWaves(x);
    // the fallen fade where they fell
    this.dead = this.dead.filter((d) => this.time - d.t0 < 1.2);
    // units, back to front
    // back to front, the giants over everybody
    const order = b.units.filter((u) => !u.fainted).sort((p, q) => (p.boss ? 1 : 0) - (q.boss ? 1 : 0) || p.y - q.y || p.i - q.i);
    const kBase = Math.max(0.5, s / 22);
    for (const u of order) {
      const px = this.sx(u.x);
      const py = this.sy(u.y);
      if (px < -200 || py < -200 || px > this.canvas.width + 200 || py > this.canvas.height + 200) continue;
      const team = b.teams[u.team];
      // team ring and shadow
      x.fillStyle = "rgba(0,0,0,0.25)";
      x.beginPath(); x.ellipse(px, py, u.r * s, u.r * s * 0.45, 0, 0, TAU); x.fill();
      x.strokeStyle = team.color;
      x.lineWidth = Math.max(1.5, s * 0.07 * Math.min(2, u.size));
      x.beginPath(); x.ellipse(px, py, u.r * s * 1.05, u.r * s * 0.5, 0, 0, TAU); x.stroke();
      const an = this.anims[u.i];
      let k = kBase * u.size;
      // a giant's sprite is as tall as its size says, whatever the picture's own size
      if (u.boss && an) k = Math.min(k, (u.r * 3.2 * s) / Math.max(12, an.height(1)));
      const fl = this.flash[u.i];
      if (fl > 0) this.flash[u.i] = Math.max(0, fl - dt * 5);
      let drawn = false;
      if (an) {
        an.loop(u.moving ? "Walk" : "Idle");
        an.update(dt);
        drawn = an.draw(x, px, py, dirRow(u.fx, u.fy), k, { flash: fl });
      }
      if (!drawn && this.icons?.ready && u.num > 0 && !u.boss) {
        // the icon: 40x30 cells, 12 to a row, by National Dex number
        const sz = Math.max(1, k * 1.25);
        const cx = (u.num % 12) * 40;
        const cy = Math.floor(u.num / 12) * 30;
        if (u.fx > 0) { x.save(); x.translate(px, 0); x.scale(-1, 1); x.drawImage(this.icons.img, cx, cy, 40, 30, -20 * sz, py - 27 * sz, 40 * sz, 30 * sz); x.restore(); }
        else x.drawImage(this.icons.img, cx, cy, 40, 30, px - 20 * sz, py - 27 * sz, 40 * sz, 30 * sz);
        drawn = true;
      }
      if (!drawn) {
        const st = this.statics[u.i];
        if (st?.ready) {
          const sz = Math.max(16, 40 * k * 0.8);
          if (u.fx > 0) { x.save(); x.translate(px, 0); x.scale(-1, 1); x.drawImage(st.img, -sz / 2, py - sz * 0.9, sz, sz); x.restore(); }
          else x.drawImage(st.img, px - sz / 2, py - sz * 0.9, sz, sz);
        } else {
          x.fillStyle = team.color;
          x.beginPath(); x.arc(px, py - u.r * s, u.r * s * 0.8, 0, TAU); x.fill();
        }
      }
      // a small health bar once hurt (the giants have theirs at the top)
      if (u.hp < u.maxhp && !u.boss) {
        const bw = Math.max(14, u.r * s * 2);
        const by = py - Math.max(u.r * s * 2.6, 26 * k);
        x.fillStyle = "rgba(0,0,0,0.55)";
        x.fillRect(px - bw / 2, by, bw, Math.max(3, s * 0.12));
        const f = u.hp / u.maxhp;
        x.fillStyle = f > 0.5 ? "#46d369" : f > 0.2 ? "#f5c542" : "#e5484d";
        x.fillRect(px - bw / 2, by, bw * f, Math.max(3, s * 0.12));
      }
      if (this.me === u.i) {
        x.strokeStyle = "#ffd54a";
        x.lineWidth = 3 * this.dpr;
        x.beginPath(); x.ellipse(px, py, u.r * s * 1.7, u.r * s * 0.85, 0, 0, TAU); x.stroke();
        const fs = Math.round(11 * this.dpr);
        x.font = `800 ${fs}px system-ui, sans-serif`;
        x.textAlign = "center";
        x.lineWidth = 3 * this.dpr;
        x.strokeStyle = "rgba(0,0,0,0.75)";
        const ty = py + u.r * s * 0.85 + fs * 1.2;
        x.strokeText(this.texts.you || "YOU", px, ty);
        x.fillStyle = "#ffd54a";
        x.fillText(this.texts.you || "YOU", px, ty);
      } else if (this.follow === u.i) {
        x.strokeStyle = "#ffffff";
        x.lineWidth = 2 * this.dpr;
        x.beginPath(); x.ellipse(px, py, u.r * s * 1.5, u.r * s * 0.75, 0, 0, TAU); x.stroke();
      }
    }
    // projectiles as real time draws them (fireballs, shadow balls, leaves, ice shards...), rays, melee marks, areas, particles
    this.vfx.drawOver(x, view, NO_BATTLE);
    // short effects
    this.fx = this.fx.filter((f) => this.time - f.t0 < f.life);
    for (const f of this.fx) {
      const k = (this.time - f.t0) / f.life;
      const px = this.sx(f.x);
      const py = this.sy(f.y);
      x.globalAlpha = 1 - k;
      if (f.kind === "beam" || f.kind === "trail") {
        x.strokeStyle = f.color;
        x.lineCap = "round";
        x.lineWidth = Math.min(12 * this.dpr, Math.max(2, f.w * s * (f.kind === "beam" ? 0.9 : 0.8) * (1 - k * 0.5)));
        x.beginPath(); x.moveTo(px, py - s * 0.5); x.lineTo(this.sx(f.x1), this.sy(f.y1) - s * 0.5); x.stroke();
        if (f.kind === "beam") { x.strokeStyle = "#ffffff"; x.lineWidth *= 0.35; x.stroke(); }
      } else if (f.kind === "ring") {
        x.strokeStyle = f.color;
        x.fillStyle = rgba(f.color, 0.25);
        x.lineWidth = Math.max(2, s * 0.12);
        x.beginPath(); x.arc(px, py, f.r * s * (0.4 + 0.6 * k), 0, TAU);
        if (f.fill) x.fill();
        x.stroke();
      } else if (f.kind === "arc") {
        const a = Math.atan2(f.dy, f.dx);
        x.strokeStyle = f.color;
        x.lineWidth = Math.max(2, s * 0.18);
        x.beginPath(); x.arc(px, py, f.r * s * 0.8, a - (f.wide ? 0.9 : 0.6), a + (f.wide ? 0.9 : 0.6)); x.stroke();
      } else if (f.kind === "spark") {
        x.fillStyle = f.color;
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * TAU + f.t0 * 7;
          const d = f.r * s * (0.3 + k);
          x.fillRect(px + Math.cos(a) * d - 2, py + Math.sin(a) * d - 2, 4 * this.dpr, 4 * this.dpr);
        }
      } else if (f.kind === "poof") {
        x.fillStyle = rgba(f.color, 0.8);
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * TAU + i;
          const d = f.r * s * k * (0.6 + (i % 3) * 0.2);
          x.beginPath(); x.arc(px + Math.cos(a) * d, py + Math.sin(a) * d - k * s, Math.max(1.5, s * 0.12 * (1 - k)), 0, TAU); x.fill();
        }
      } else if (f.kind === "num") {
        x.font = `bold ${Math.max(10, Math.round(Math.min(s * 0.42, 22 * this.dpr)))}px system-ui, sans-serif`;
        x.textAlign = "center";
        x.lineWidth = 3 * this.dpr;
        x.strokeStyle = "rgba(0,0,0,0.7)";
        x.strokeText(f.text, px, py - k * s);
        x.fillStyle = f.color;
        x.fillText(f.text, px, py - k * s);
      }
      x.globalAlpha = 1;
    }
    // where the person aims
    const me = this.me >= 0 ? b.units[this.me] : null;
    if (me && !me.fainted && this.aim) {
      const ax = this.sx(this.aim.x);
      const ay = this.sy(this.aim.y);
      const r = 9 * this.dpr;
      x.strokeStyle = "rgba(255,213,74,0.35)";
      x.lineWidth = 2 * this.dpr;
      x.setLineDash([4 * this.dpr, 5 * this.dpr]);
      x.beginPath(); x.moveTo(this.sx(me.x), this.sy(me.y) - s * 0.4); x.lineTo(ax, ay); x.stroke();
      x.setLineDash([]);
      x.strokeStyle = "#ffd54a";
      x.beginPath(); x.arc(ax, ay, r, 0, TAU); x.moveTo(ax - r * 1.6, ay); x.lineTo(ax - r * 0.5, ay); x.moveTo(ax + r * 0.5, ay); x.lineTo(ax + r * 1.6, ay);
      x.moveTo(ax, ay - r * 1.6); x.lineTo(ax, ay - r * 0.5); x.moveTo(ax, ay + r * 0.5); x.lineTo(ax, ay + r * 1.6); x.stroke();
    }
    // move names over whoever uses them
    this.pills = this.pills.filter((p) => p.until > this.time);
    const fs = Math.max(9, Math.round(Math.min(14, s * 0.42) * (this.dpr > 1 ? 1.4 : 1)));
    x.font = `600 ${fs}px system-ui, sans-serif`;
    x.textAlign = "center";
    for (const p of this.pills) {
      const u = b.units[p.u];
      if (u.fainted) continue;
      const px = this.sx(u.x);
      const py = this.sy(u.y) - Math.max(u.r * s * 2.6, 26 * kBase * u.size) - fs * 1.1;
      const tw = x.measureText(p.text).width + fs;
      x.fillStyle = rgba(p.color, 0.92);
      x.beginPath();
      if (x.roundRect) x.roundRect(px - tw / 2, py - fs * 0.85, tw, fs * 1.35, fs * 0.4); else x.rect(px - tw / 2, py - fs * 0.85, tw, fs * 1.35);
      x.fill();
      x.fillStyle = "#ffffff";
      x.fillText(p.text, px, py + fs * 0.2);
    }
    x.restore();
  }
}
