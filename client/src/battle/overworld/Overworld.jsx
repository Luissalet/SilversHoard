// A gym's map, walked tile by tile as in the games (keyboard, gamepad or the on-screen pad). A trainer who sees you calls out, walks
// up and their battle starts; talking to the leader only works once every trainer is beaten. Drawn on a canvas with tiles coloured
// from the gym's type and the people as their trainer sprites. The same component runs in the app and on the friends' playable page.
// Puzzles move you as in the games (the app checks maps with the same rules, gymmap.py _move): on ice you slide until something
// stops you, arrow tiles carry you the way they point, a switch opens every door. Some trainers turn on the spot, looking each way
// in turn. Buildings (Pokémon Center, shop, houses, gyms) stand on the map as solid props.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./overworld.css";
import { MPW_PROPS, MPW_TILES } from "./mpw-tiles.gen.js";

const STEP = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const WALKABLE = new Set([".", "=", ","]);
const PASSABLE = new Set([".", "=", ",", "_", "^", "v", "<", ">", "s"]);
const ARROWS = { "^": "up", v: "down", "<": "left", ">": "right" };
const TURN = { up: "right", right: "down", down: "left", left: "up" };
// buildings: size in tiles (the same as gymmap.PROPS)
export const PROPS = { center: [6, 6], shop: [5, 5], gym: [7, 7], gym_fire: [7, 7], gym_water: [7, 7], house: [5, 5], house_purple: [5, 5],
  bighouse: [7, 7], bighouse_green: [7, 7] };
const PROP_ROOF = { center: "#d9443b", shop: "#2f74d0", gym: "#3d4a5c", gym_fire: "#3d4a5c", gym_water: "#3d4a5c", house: "#3f8f4a",
  house_purple: "#6b4fa0", bighouse: "#6b4fa0", bighouse_green: "#3f8f4a" };
const MOVE_MS = 150;
const SLIDE_MS = 85;

/** One move with the puzzles' rules: the tiles you pass (the last one is where you stop) and whether the doors are open after it. */
export function movePath({ tile, blocked, x, y, dir, opened }) {
  const passable = (px, py, op) => !blocked(px, py) && (PASSABLE.has(tile(px, py)) || (tile(px, py) === "d" && op));
  let [dx, dy] = STEP[dir];
  let nx = x + dx, ny = y + dy;
  if (!passable(nx, ny, opened)) return null;
  const path = [];
  const seen = new Set();
  let d = dir;
  for (;;) {
    path.push([nx, ny]);
    const c = tile(nx, ny);
    if (c === "s") opened = true;
    if (ARROWS[c]) d = ARROWS[c];
    else if (c !== "_") break;
    const key = `${nx},${ny},${d}`;
    if (seen.has(key)) break;
    seen.add(key);
    [dx, dy] = STEP[d];
    if (!passable(nx + dx, ny + dy, opened)) break;
    nx += dx; ny += dy;
  }
  return { path, opened, sliding: path.length > 1 };
}

const TEXTS = {
  es: { opened: "¡Clic! Se han abierto las puertas.", move: "Flechas o WASD para andar · Intro o E para hablar · también con mando", spotted: "¡{name} te ha visto!", leader_wait: "{name}: «Vence antes a todos mis entrenadores.»",
    leader_go: "{name}: «Has llegado hasta aquí. ¡Veamos qué sabes hacer!»", beaten: "{name}: «Ya me has ganado.»", talk: "{name}: «¡A combatir!»", left: "Entrenadores por vencer: {n}" },
  en: { opened: "Click! The doors opened.", move: "Arrows or WASD to walk · Enter or E to talk · a gamepad works too", spotted: "{name} spotted you!", leader_wait: "{name}: “Beat all my trainers first.”",
    leader_go: "{name}: “You made it this far. Let's see what you've got!”", beaten: "{name}: “You already beat me.”", talk: "{name}: “Let's battle!”", left: "Trainers left: {n}" },
};

/** Floor, wall and accent colours from a gym type's colour. */
function palette(color = "#9aa0a6") {
  const c = color.replace("#", "");
  const n = parseInt(c.length === 3 ? c.split("").map((x) => x + x).join("") : c, 16) || 0x9aa0a6;
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const mix = (k, to) => `rgb(${Math.round(r + (to - r) * k)},${Math.round(g + (to - g) * k)},${Math.round(b + (to - b) * k)})`;
  return { floorA: mix(0.78, 235), floorB: mix(0.72, 225), wall: mix(0.45, 40), wallTop: mix(0.25, 70), carpet: mix(0.1, 120), accent: color };
}

// map.look "pixel": Scarloxy's 16 px tiles (MyPixelWorld Special Packs #01, CC BY 4.0) instead of shapes in the gym's colours
const OVER = new Set(["o", "*"]);   // drawn over the floor; the plant stands two tiles tall

function imgOf(cache, url) {
  if (!url) return null;
  let im = cache.get(url);
  if (!im) {
    im = new Image();   // no crossOrigin: the sprite servers send no CORS headers, and nothing reads the pixels back
    im.src = url;
    cache.set(url, im);
  }
  return im.complete && im.naturalWidth ? im : null;
}

/**
 * map: {w, h, tiles, start: [x, y], leader: {x, y, facing}, trainers: [{id, x, y, facing, sight}]}
 * people: {[trainerId | "leader"]: {name, avatarUrl}}; player: {name, avatarUrl}; beaten: [trainerId]
 * onBattle(trainerId | "leader"); saveKey: where the player's spot is kept between battles (localStorage).
 */
export default function Overworld({ map, people = {}, player = {}, beaten = [], color, onBattle, saveKey = "", lang = "es", busy = false }) {
  const tx = TEXTS[lang === "en" ? "en" : "es"];
  const fill = (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? "");
  const canvas = useRef(null);
  const wrap = useRef(null);
  const imgs = useRef(new Map());
  const pal = useMemo(() => palette(color), [color]);
  const beatenSet = useMemo(() => new Set(beaten), [beaten]);
  const trainersLeft = (map.trainers || []).filter((t) => !beatenSet.has(t.id)).length;
  const [msg, setMsg] = useState("");
  const state = useRef(null);
  if (!state.current) {
    let saved = null;
    try { saved = saveKey ? JSON.parse(localStorage.getItem(saveKey) || "null") : null; } catch { saved = null; }
    const start = saved && Number.isInteger(saved.x) ? saved : { x: map.start[0], y: map.start[1], facing: "up" };
    state.current = { x: start.x, y: start.y, facing: start.facing || "up", from: null, t0: 0, locked: false, held: null, opened: !!saved?.opened, moving: false, stepMs: MOVE_MS,
      npc: Object.fromEntries((map.trainers || []).map((t) => [t.id, { x: t.x, y: t.y, facing: t.facing, from: null, t0: 0, bang: 0 }])) };
  }
  const tile = (x, y) => (x < 0 || y < 0 || x >= map.w || y >= map.h ? "#" : map.tiles[y * map.w + x]);
  // the tiles under the buildings
  const propCells = useMemo(() => {
    const out = new Set();
    for (const p of map.props || []) {
      const [pw, ph] = PROPS[p.kind] || [1, 1];
      for (let i = 0; i < pw; i++) for (let j = 0; j < ph; j++) out.add(`${p.x + i},${p.y + j}`);
    }
    return out;
  }, [map]);
  const occupied = useCallback((x, y) => {
    const s = state.current;
    if (map.leader.x === x && map.leader.y === y) return "leader";
    for (const t of map.trainers || []) { const p = s.npc[t.id]; if (p.x === x && p.y === y) return t.id; }
    return null;
  }, [map]);
  const save = useCallback(() => {
    const s = state.current;
    try { if (saveKey) localStorage.setItem(saveKey, JSON.stringify({ x: s.x, y: s.y, facing: s.facing, opened: s.opened })); } catch { /* not critical */ }
  }, [saveKey]);
  const see = (x, y) => (PASSABLE.has(tile(x, y)) || (tile(x, y) === "d" && state.current.opened)) && !propCells.has(`${x},${y}`);

  // a trainer who sees you: "!", then they walk up to you and the battle starts
  const spot = useCallback(() => {
    const s = state.current;
    for (const t of map.trainers || []) {
      if (beatenSet.has(t.id)) continue;
      const facing = s.npc[t.id].facing;   // turning trainers look a different way each moment
      const [dx, dy] = STEP[facing];
      let x = t.x, y = t.y;
      for (let i = 0; i < t.sight; i++) {
        x += dx; y += dy;
        if (!see(x, y)) break;
        if (x === s.x && y === s.y) {
          s.locked = true;
          s.npc[t.id].bang = performance.now();
          setMsg(fill(tx.spotted, { name: people[t.id]?.name || "?" }));
          const steps = Math.abs(s.x - t.x) + Math.abs(s.y - t.y) - 1;
          let k = 0;
          const walk = () => {
            const p = s.npc[t.id];
            if (k >= steps) {
              s.facing = { up: "down", down: "up", left: "right", right: "left" }[facing];
              save();
              setTimeout(() => onBattle?.(t.id), 350);
              return;
            }
            p.from = [p.x, p.y]; p.t0 = performance.now(); p.x += dx; p.y += dy; k++;
            setTimeout(walk, MOVE_MS + 20);
          };
          setTimeout(walk, 700);
          return true;
        }
        if (occupied(x, y)) break;
      }
    }
    return false;
  }, [map, beatenSet, people, onBattle, occupied, save, tx]); // eslint-disable-line react-hooks/exhaustive-deps

  const tryMove = useCallback((dir) => {
    const s = state.current;
    if (s.locked || busy || s.moving || (s.from && performance.now() - s.t0 < s.stepMs)) return;
    s.facing = dir;
    const res = movePath({ tile, blocked: (x, y) => !!occupied(x, y) || propCells.has(`${x},${y}`), x: s.x, y: s.y, dir, opened: s.opened });
    if (!res) return;
    setMsg("");
    // walk (or slide) tile by tile along the path; a trainer may spot you once you stop
    const ms = res.sliding ? SLIDE_MS : MOVE_MS;
    s.moving = true;
    s.stepMs = ms;
    let i = 0;
    const step = () => {
      const [nx, ny] = res.path[i];
      const d = ARROWS[tile(s.x, s.y)];
      if (d) s.facing = d;
      s.from = [s.x, s.y]; s.t0 = performance.now(); s.x = nx; s.y = ny;
      if (tile(nx, ny) === "s" && !s.opened) { s.opened = true; setMsg(tx.opened); }
      i++;
      if (i < res.path.length) setTimeout(step, ms);
      else setTimeout(() => { s.moving = false; s.stepMs = MOVE_MS; if (!spot()) save(); }, ms);
    };
    step();
  }, [busy, occupied, spot, save, propCells]); // eslint-disable-line react-hooks/exhaustive-deps

  // trainers who turn on the spot look each way in turn, and may catch you as they do
  useEffect(() => {
    if (!(map.trainers || []).some((t) => t.turns)) return undefined;
    const h = setInterval(() => {
      const s = state.current;
      if (s.locked || busy) return;
      for (const t of map.trainers || []) if (t.turns && !beatenSet.has(t.id)) s.npc[t.id].facing = TURN[s.npc[t.id].facing];
      if (!s.moving) spot();
    }, 1800);
    return () => clearInterval(h);
  }, [map, beatenSet, busy, spot]);

  const talk = useCallback(() => {
    const s = state.current;
    if (s.locked || busy) return;
    const [dx, dy] = STEP[s.facing];
    const who = occupied(s.x + dx, s.y + dy);
    if (!who) return;
    const name = people[who]?.name || "?";
    if (who === "leader") {
      if (trainersLeft > 0) { setMsg(fill(tx.leader_wait, { name })); return; }
      setMsg(fill(tx.leader_go, { name }));
    } else if (beatenSet.has(who)) {
      setMsg(fill(tx.beaten, { name }));
      return;
    } else {
      setMsg(fill(tx.talk, { name }));
    }
    s.locked = true;
    save();
    setTimeout(() => onBattle?.(who), 600);
  }, [busy, occupied, people, trainersLeft, beatenSet, onBattle, save]); // eslint-disable-line react-hooks/exhaustive-deps

  // keyboard and gamepad
  useEffect(() => {
    const keys = { ArrowUp: "up", KeyW: "up", ArrowDown: "down", KeyS: "down", ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right" };
    const down = (e) => {
      if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
      if (keys[e.code]) { e.preventDefault(); state.current.held = keys[e.code]; tryMove(keys[e.code]); }
      else if (["Enter", "Space", "KeyE"].includes(e.code)) { e.preventDefault(); talk(); }
    };
    const up = (e) => { if (keys[e.code] && state.current.held === keys[e.code]) state.current.held = null; };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    let raf = 0;
    let lastA = false;
    const pad = () => {
      const gp = (navigator.getGamepads?.() || []).find((g) => g);
      if (gp) {
        const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
        const b = (i) => !!gp.buttons[i]?.pressed;
        const dir = b(12) || ay < -0.5 ? "up" : b(13) || ay > 0.5 ? "down" : b(14) || ax < -0.5 ? "left" : b(15) || ax > 0.5 ? "right" : null;
        state.current.padDir = dir;
        if (b(0) && !lastA) talk();
        lastA = b(0);
      }
      const held = state.current.held || state.current.padDir;
      if (held) tryMove(held);
      raf = requestAnimationFrame(pad);
    };
    raf = requestAnimationFrame(pad);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); cancelAnimationFrame(raf); };
  }, [tryMove, talk]);

  // drawing
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const cv = canvas.current;
      const box = wrap.current;
      if (!cv || !box) { raf = requestAnimationFrame(draw); return; }
      const dpr = window.devicePixelRatio || 1;
      const ts = Math.max(18, Math.min(48, Math.floor(box.clientWidth / map.w)));
      const W = ts * map.w, H = ts * map.h;
      if (cv.width !== Math.floor(W * dpr)) { cv.width = Math.floor(W * dpr); cv.height = Math.floor(H * dpr); cv.style.width = `${W}px`; cv.style.height = `${H}px`; }
      const x = cv.getContext("2d");
      x.setTransform(dpr, 0, 0, dpr, 0, 0);
      x.imageSmoothingEnabled = false;
      const pixel = map.look === "pixel" && Object.keys(MPW_TILES).every((k) => imgOf(imgs.current, MPW_TILES[k]))
        && (map.props || []).every((p) => !MPW_PROPS[p.kind] || imgOf(imgs.current, MPW_PROPS[p.kind]));
      if (pixel) {
        const floor = imgOf(imgs.current, MPW_TILES["."]);
        for (let ty = 0; ty < map.h; ty++) {
          for (let tx2 = 0; tx2 < map.w; tx2++) {
            const c = map.tiles[ty * map.w + tx2];
            const px = tx2 * ts, py = ty * ts;
            const own = MPW_TILES[c] ? imgOf(imgs.current, MPW_TILES[c]) : null;
            if (OVER.has(c) || c === "." || !own) x.drawImage(floor, px, py, ts, ts);
            if (c !== "." && !OVER.has(c) && own) x.drawImage(own, px, py, ts, ts);
          }
        }
        // boulders and plants after the floor, row by row, so a tall plant covers the tile above it
        for (let ty = 0; ty < map.h; ty++) {
          for (let tx2 = 0; tx2 < map.w; tx2++) {
            const c = map.tiles[ty * map.w + tx2];
            if (c === "o") x.drawImage(imgOf(imgs.current, MPW_TILES.o), tx2 * ts, ty * ts, ts, ts);
            else if (c === "*") x.drawImage(imgOf(imgs.current, MPW_TILES["*"]), tx2 * ts, (ty - 1) * ts, ts, ts * 2);
          }
        }
      }
      for (let ty = 0; !pixel && ty < map.h; ty++) {
        for (let tx2 = 0; tx2 < map.w; tx2++) {
          const c = map.tiles[ty * map.w + tx2];
          const px = tx2 * ts, py = ty * ts;
          x.fillStyle = (tx2 + ty) % 2 ? pal.floorA : pal.floorB;
          x.fillRect(px, py, ts, ts);
          if (c === "#") {
            x.fillStyle = pal.wall; x.fillRect(px, py, ts, ts);
            x.fillStyle = pal.wallTop; x.fillRect(px, py, ts, ts * 0.35);
          } else if (c === "~") {
            x.fillStyle = "#3f7fb5"; x.fillRect(px, py, ts, ts);
            x.strokeStyle = "rgba(255,255,255,.35)"; x.lineWidth = 1;
            x.beginPath(); x.moveTo(px + ts * 0.15, py + ts * 0.5); x.quadraticCurveTo(px + ts * 0.3, py + ts * 0.35, px + ts * 0.5, py + ts * 0.5); x.stroke();
          } else if (c === "o") {
            x.fillStyle = "rgba(0,0,0,.2)"; x.beginPath(); x.ellipse(px + ts / 2, py + ts * 0.8, ts * 0.4, ts * 0.15, 0, 0, Math.PI * 2); x.fill();
            x.fillStyle = "#8f8a7c"; x.beginPath(); x.arc(px + ts / 2, py + ts * 0.5, ts * 0.38, 0, Math.PI * 2); x.fill();
            x.fillStyle = "rgba(255,255,255,.25)"; x.beginPath(); x.arc(px + ts * 0.4, py + ts * 0.38, ts * 0.12, 0, Math.PI * 2); x.fill();
          } else if (c === "*") {
            x.fillStyle = "#6b4a2b"; x.fillRect(px + ts * 0.3, py + ts * 0.6, ts * 0.4, ts * 0.3);
            x.fillStyle = "#3f8f4a"; x.beginPath(); x.arc(px + ts / 2, py + ts * 0.45, ts * 0.33, 0, Math.PI * 2); x.fill();
          } else if (c === "=") {
            x.fillStyle = pal.carpet; x.fillRect(px, py, ts, ts);
            x.fillStyle = "rgba(255,255,255,.12)"; x.fillRect(px, py + ts * 0.45, ts, ts * 0.1);
          } else if (c === ",") {
            x.fillStyle = "#5c9c4c"; x.fillRect(px, py, ts, ts);
            x.fillStyle = "#4b8a3e";
            for (let k = 0; k < 3; k++) x.fillRect(px + ts * (0.2 + k * 0.25), py + ts * 0.3, ts * 0.06, ts * 0.3);
          }
        }
      }
      // puzzle tiles, in both looks: ice shine, arrows, the switch and the doors
      for (let ty = 0; ty < map.h; ty++) {
        for (let tx2 = 0; tx2 < map.w; tx2++) {
          const c = map.tiles[ty * map.w + tx2];
          const px = tx2 * ts, py = ty * ts;
          if (c === "_" && !pixel) {
            x.fillStyle = "#cfeaf6"; x.fillRect(px, py, ts, ts);
            x.strokeStyle = "rgba(255,255,255,.8)"; x.lineWidth = Math.max(1, ts * 0.06);
            x.beginPath(); x.moveTo(px + ts * 0.2, py + ts * 0.7); x.lineTo(px + ts * 0.5, py + ts * 0.3); x.moveTo(px + ts * 0.5, py + ts * 0.8); x.lineTo(px + ts * 0.75, py + ts * 0.45); x.stroke();
          } else if (ARROWS[c]) {
            x.fillStyle = "#e9e3d2"; x.fillRect(px + ts * 0.08, py + ts * 0.08, ts * 0.84, ts * 0.84);
            x.strokeStyle = "#8a7f66"; x.lineWidth = Math.max(1, ts * 0.05); x.strokeRect(px + ts * 0.08, py + ts * 0.08, ts * 0.84, ts * 0.84);
            const [dx, dy] = STEP[ARROWS[c]];
            const cx = px + ts / 2, cy = py + ts / 2;
            x.fillStyle = "#d9443b";
            x.beginPath();
            x.moveTo(cx + dx * ts * 0.32, cy + dy * ts * 0.32);
            x.lineTo(cx - dx * ts * 0.1 - dy * ts * 0.28, cy - dy * ts * 0.1 + dx * ts * 0.28);
            x.lineTo(cx - dx * ts * 0.1 + dy * ts * 0.28, cy - dy * ts * 0.1 - dx * ts * 0.28);
            x.closePath(); x.fill();
          } else if (c === "s") {
            const on = state.current.opened;
            x.fillStyle = "#5a5f6b"; x.fillRect(px + ts * 0.22, py + ts * 0.22, ts * 0.56, ts * 0.56);
            x.fillStyle = on ? "#7ee08f" : "#e8c45a"; x.beginPath(); x.arc(px + ts / 2, py + ts / 2, ts * 0.18, 0, Math.PI * 2); x.fill();
          } else if (c === "d") {
            if (state.current.opened) {
              x.fillStyle = "rgba(0,0,0,.18)"; x.fillRect(px, py + ts * 0.85, ts, ts * 0.15);
            } else {
              x.fillStyle = "#8a5a2b"; x.fillRect(px, py, ts, ts);
              x.fillStyle = "#6b4520"; for (let k = 0; k < 3; k++) x.fillRect(px + ts * (0.15 + k * 0.3), py + ts * 0.1, ts * 0.08, ts * 0.8);
              x.fillStyle = "#e8c45a"; x.fillRect(px + ts * 0.42, py + ts * 0.45, ts * 0.16, ts * 0.12);
            }
          }
        }
      }
      // buildings: the tileset's own pictures, or a roof, a wall and a door in plain shapes
      for (const p of map.props || []) {
        const [pw, ph] = PROPS[p.kind] || [1, 1];
        const im = pixel && MPW_PROPS[p.kind] ? imgOf(imgs.current, MPW_PROPS[p.kind]) : null;
        const px = p.x * ts, py = p.y * ts, bw = pw * ts, bh = ph * ts;
        x.fillStyle = "rgba(0,0,0,.22)"; x.fillRect(px + ts * 0.2, py + bh - ts * 0.15, bw, ts * 0.25);
        if (im) { x.drawImage(im, px, py, bw, bh); continue; }
        x.fillStyle = "#efe6d0"; x.fillRect(px + ts * 0.2, py + bh * 0.45, bw - ts * 0.4, bh * 0.55);
        x.fillStyle = PROP_ROOF[p.kind] || "#888"; x.beginPath(); x.moveTo(px, py + bh * 0.5); x.lineTo(px + bw * 0.12, py); x.lineTo(px + bw * 0.88, py); x.lineTo(px + bw, py + bh * 0.5); x.closePath(); x.fill();
        x.fillStyle = "#6b4520"; x.fillRect(px + bw / 2 - ts * 0.45, py + bh - ts * 1.1, ts * 0.9, ts * 1.1);
        x.fillStyle = "#9fd3ff"; x.fillRect(px + ts * 0.6, py + bh * 0.62, ts * 0.9, ts * 0.7); x.fillRect(px + bw - ts * 1.5, py + bh * 0.62, ts * 0.9, ts * 0.7);
        if (p.kind === "center") { x.fillStyle = "#fff"; x.fillRect(px + bw / 2 - ts * 0.35, py + bh * 0.22, ts * 0.7, ts * 0.2); x.fillRect(px + bw / 2 - ts * 0.1, py + bh * 0.22 - ts * 0.25, ts * 0.2, ts * 0.7); }
      }
      // the entrance
      x.fillStyle = "rgba(255,255,255,.25)";
      x.fillRect(map.start[0] * ts + ts * 0.15, map.start[1] * ts + ts * 0.15, ts * 0.7, ts * 0.7);
      const now = performance.now();
      const at = (p) => {
        if (!p.from) return [p.x, p.y];
        const k = Math.min(1, (now - p.t0) / (p.stepMs || MOVE_MS));
        return [p.from[0] + (p.x - p.from[0]) * k, p.from[1] + (p.y - p.from[1]) * k];
      };
      const drawPerson = (px, py, url, facing, alpha = 1, crown = false, bang = 0) => {
        const cx = px * ts + ts / 2, foot = py * ts + ts * 0.92;
        x.globalAlpha = alpha;
        x.fillStyle = "rgba(0,0,0,.25)"; x.beginPath(); x.ellipse(cx, foot, ts * 0.32, ts * 0.12, 0, 0, Math.PI * 2); x.fill();
        const im = imgOf(imgs.current, url);
        const hpx = ts * 1.6;
        if (im) x.drawImage(im, cx - hpx / 2, foot - hpx, hpx, hpx);
        else { x.fillStyle = pal.accent; x.beginPath(); x.arc(cx, foot - ts * 0.45, ts * 0.32, 0, Math.PI * 2); x.fill(); }
        // which way they look
        const [dx, dy] = STEP[facing] || [0, 1];
        x.fillStyle = "rgba(255,255,255,.85)";
        x.beginPath();
        const ax = cx + dx * ts * 0.45, ay = foot - ts * 0.2 + dy * ts * 0.3;
        x.moveTo(ax + dx * ts * 0.12, ay + dy * ts * 0.12);
        x.lineTo(ax - dy * ts * 0.1, ay + dx * ts * 0.1);
        x.lineTo(ax + dy * ts * 0.1, ay - dx * ts * 0.1);
        x.closePath();
        x.fill();
        x.strokeStyle = "rgba(0,0,0,.55)"; x.lineWidth = Math.max(1, ts / 24); x.stroke();   // readable on light floors too
        if (crown) { x.fillStyle = "#e8c45a"; x.font = `${Math.round(ts * 0.5)}px sans-serif`; x.textAlign = "center"; x.fillText("♛", cx, foot - hpx - 2); }
        if (bang && now - bang < 1200) { x.fillStyle = "#fff"; x.strokeStyle = "#222"; x.lineWidth = 3; x.font = `bold ${Math.round(ts * 0.7)}px sans-serif`; x.textAlign = "center"; x.strokeText("!", cx, foot - hpx - 2); x.fillText("!", cx, foot - hpx - 2); }
        x.globalAlpha = 1;
      };
      const people2 = [];
      for (const t of map.trainers || []) {
        const p = state.current.npc[t.id];
        const [ax, ay] = at(p);
        people2.push([ay, () => drawPerson(ax, ay, people[t.id]?.avatarUrl, p.facing, beatenSet.has(t.id) ? 0.5 : 1, false, p.bang)]);
      }
      people2.push([map.leader.y, () => drawPerson(map.leader.x, map.leader.y, people.leader?.avatarUrl, map.leader.facing, 1, true)]);
      const s = state.current;
      const [mx, my] = at(s);
      people2.push([my, () => drawPerson(mx, my, player.avatarUrl, s.facing)]);
      people2.sort((a, b) => a[0] - b[0]).forEach(([, f]) => f());
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [map, pal, people, player, beatenSet]);

  const pad = (dir) => ({ onPointerDown: (e) => { e.preventDefault(); state.current.held = dir; tryMove(dir); },
    onPointerUp: () => { state.current.held = null; }, onPointerLeave: () => { if (state.current.held === dir) state.current.held = null; } });
  return (
    <div className="ow">
      <div className="ow-stage" ref={wrap}>
        <canvas ref={canvas} className="ow-canvas" aria-label="gym map" tabIndex={0} />
        {msg && <div className="ow-msg">{msg}</div>}
      </div>
      <div className="ow-bar">
        <span className="help">{fill(tx.left, { n: trainersLeft })} · {tx.move}</span>
        <div className="ow-pad" aria-hidden="true">
          <button type="button" className="ow-key up" {...pad("up")}>▲</button>
          <button type="button" className="ow-key left" {...pad("left")}>◀</button>
          <button type="button" className="ow-key talk" onClick={talk}>A</button>
          <button type="button" className="ow-key right" {...pad("right")}>▶</button>
          <button type="button" className="ow-key down" {...pad("down")}>▼</button>
        </div>
      </div>
    </div>
  );
}
