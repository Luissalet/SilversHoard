// The gym map editor: paint the room tile by tile, put the entrance, the leader and every gym trainer where they stand (looking one way,
// with a line of sight), or start from an automatic layout. The app checks the map when the gym is saved (gymmap.py): everybody on
// floor, every trainer and the leader reachable from the entrance.
import React, { useMemo, useState } from "react";
import { api } from "../api.js";
import { useApp } from "../context.js";
import { Busy, Field, useBusy } from "../components/ui.jsx";
import { Avatar } from "../components/silver.jsx";
import { MPW_TILES } from "../battle/overworld/mpw-tiles.gen.js";

const TILES = [[".", "#e8e2d4"], ["#", "#4a4038"], ["~", "#3f7fb5"], ["o", "#8f8a7c"], ["*", "#3f8f4a"], ["=", "#b04848"], [",", "#5c9c4c"]];
const COLORS = Object.fromEntries(TILES);
const LOOKS = ["colors", "pixel"];
const WALK = new Set([".", "=", ","]);
const FACINGS = ["up", "down", "left", "right"];
const ARROW = { up: "▲", down: "▼", left: "◀", right: "▶" };

function resize(map, w, h) {
  // what fits is kept, new space is floor, and the border is wall
  let tiles = "";
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const old = x < map.w && y < map.h ? map.tiles[y * map.w + x] : ".";
      tiles += x === 0 || y === 0 || x === w - 1 || y === h - 1 ? "#" : old === "#" && (x === map.w - 1 || y === map.h - 1) ? "." : old;
    }
  }
  const inside = (x, y) => x > 0 && y > 0 && x < w - 1 && y < h - 1;
  return { ...map, w, h, tiles, start: inside(map.start[0], map.start[1]) ? map.start : [Math.floor(w / 2), h - 2],
    leader: inside(map.leader.x, map.leader.y) ? map.leader : { ...map.leader, x: Math.floor(w / 2), y: 1 },
    trainers: map.trainers.filter((t) => inside(t.x, t.y)) };
}

/** gym: the gym being edited ({id, trainers, leader…}); value / onChange: the map ({} for none). */
export default function GymMapEditor({ gymId, trainerIds, people, value, onChange }) {
  const { t, toastError } = useApp();
  const [busy, run] = useBusy();
  const [tool, setTool] = useState("#");
  const [who, setWho] = useState("");      // placing: "start", "leader" or a trainer id
  const [painting, setPainting] = useState(false);
  const map = value && value.w ? value : null;
  const placed = useMemo(() => new Set((map?.trainers || []).map((x) => x.id)), [map]);
  const auto = () => run("gen", async () => {
    const out = await api.call("gym_map_generate", { trainer_ids: trainerIds, seed: String(Date.now()) });
    onChange(out.map);
  });
  if (!map) {
    return (
      <div className="space-y-2">
        <p className="help">{t("gmap_none")}</p>
        <Busy busy={busy.gen} className="btn" onClick={auto}>{t("gmap_auto")}</Busy>
      </div>
    );
  }
  const set = (patch) => onChange({ ...map, ...patch });
  const pixel = map.look === "pixel";
  const paint = (x, y) => {
    if (who) {
      if (!WALK.has(map.tiles[y * map.w + x])) { toastError(new Error(t("gmap_on_floor"))); return; }
      const clash = (map.start[0] === x && map.start[1] === y) || (map.leader.x === x && map.leader.y === y) || map.trainers.some((q) => q.x === x && q.y === y && q.id !== who);
      if (clash) return;
      if (who === "start") set({ start: [x, y] });
      else if (who === "leader") set({ leader: { ...map.leader, x, y } });
      else {
        const old = map.trainers.find((q) => q.id === who);
        set({ trainers: [...map.trainers.filter((q) => q.id !== who), { id: who, x, y, facing: old?.facing || "down", sight: old?.sight || 3 }] });
      }
      return;
    }
    const i = y * map.w + x;
    if (map.tiles[i] === tool) return;
    set({ tiles: map.tiles.slice(0, i) + tool + map.tiles.slice(i + 1) });
  };
  const sel = who && who !== "start" ? (who === "leader" ? map.leader : map.trainers.find((q) => q.id === who)) : null;
  const setSel = (patch) => {
    if (who === "leader") set({ leader: { ...map.leader, ...patch } });
    else set({ trainers: map.trainers.map((q) => (q.id === who ? { ...q, ...patch } : q)) });
  };
  const cell = 26;
  return (
    <div className="gmap space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="help">{t("gmap_paint")}:</span>
        {TILES.map(([c, col]) => (
          <button key={c} type="button" className={`gmap-tool ${!who && tool === c ? "is-on" : ""}`} onClick={() => { setWho(""); setTool(c); }} title={t(`gmap_tile_${c === "." ? "floor" : c === "#" ? "wall" : c === "~" ? "water" : c === "o" ? "boulder" : c === "*" ? "plant" : c === "=" ? "carpet" : "grass"}`)}>
            {map.look === "pixel" ? <img src={MPW_TILES[c]} alt="" className="gmap-swatch" /> : <span style={{ background: col }} />}{t(`gmap_tile_${c === "." ? "floor" : c === "#" ? "wall" : c === "~" ? "water" : c === "o" ? "boulder" : c === "*" ? "plant" : c === "=" ? "carpet" : "grass"}`)}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="help">{t("gmap_place")}:</span>
        <button type="button" className={`gmap-tool ${who === "start" ? "is-on" : ""}`} onClick={() => setWho("start")}>⌂ {t("gmap_start")}</button>
        <button type="button" className={`gmap-tool ${who === "leader" ? "is-on" : ""}`} onClick={() => setWho("leader")}>
          <Avatar url={people.leader?.avatarUrl} name={people.leader?.name} size={20} /> {t("leader")}
        </button>
        {trainerIds.map((id, i) => (
          <button key={id} type="button" className={`gmap-tool ${who === id ? "is-on" : ""} ${placed.has(id) ? "" : "is-missing"}`} onClick={() => setWho(id)}>
            <Avatar url={people[id]?.avatarUrl} name={people[id]?.name} size={20} /> {i + 1}. {people[id]?.name || "?"}
          </button>
        ))}
      </div>
      {sel && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="help">{t("gmap_facing")}:</span>
          <div className="seg">{FACINGS.map((f) => <button key={f} type="button" aria-pressed={sel.facing === f} onClick={() => setSel({ facing: f })}>{ARROW[f]}</button>)}</div>
          {who !== "leader" && (
            <label className="flex items-center gap-2"><span className="help">{t("gmap_sight")}</span>
              <input type="range" min={1} max={8} value={sel.sight || 3} onChange={(e) => setSel({ sight: Number(e.target.value) })} /> <b className="num">{sel.sight || 3}</b>
            </label>
          )}
        </div>
      )}
      <div className="gmap-scroll" onPointerUp={() => setPainting(false)} onPointerLeave={() => setPainting(false)}>
        <svg className="gmap-grid" width={map.w * cell} height={map.h * cell} viewBox={`0 0 ${map.w} ${map.h}`} role="img" aria-label={t("gmap_title")}>
          {pixel && <g pointerEvents="none" style={{ imageRendering: "pixelated" }}>
            {Array.from(map.tiles).map((c, i) => {
              const x = i % map.w, y = Math.floor(i / map.w);
              return <image key={`f${i}`} href={MPW_TILES[c === "o" || c === "*" ? "." : c]} x={x} y={y} width={1} height={1} />;
            })}
            {Array.from(map.tiles).map((c, i) => {
              const x = i % map.w, y = Math.floor(i / map.w);
              return c === "o" ? <image key={`o${i}`} href={MPW_TILES.o} x={x} y={y} width={1} height={1} />
                : c === "*" ? <image key={`p${i}`} href={MPW_TILES["*"]} x={x} y={y - 1} width={1} height={2} /> : null;
            })}
          </g>}
          {Array.from(map.tiles).map((c, i) => {
            const x = i % map.w, y = Math.floor(i / map.w);
            return <rect key={i} x={x} y={y} width={1} height={1} fill={pixel ? "transparent" : COLORS[c]} stroke="rgba(0,0,0,.15)" strokeWidth={0.03}
              onPointerDown={(e) => { e.preventDefault(); setPainting(true); paint(x, y); }} onPointerEnter={() => { if (painting && !who) paint(x, y); }} />;
          })}
          <text x={map.start[0] + 0.5} y={map.start[1] + 0.72} fontSize={0.7} textAnchor="middle" pointerEvents="none">⌂</text>
          {[{ ...map.leader, id: "leader" }, ...map.trainers].map((p) => (
            <g key={p.id} pointerEvents="none">
              {p.id !== "leader" && (() => {
                const [dx, dy] = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[p.facing];
                return <rect x={Math.min(p.x, p.x + dx * p.sight) + (dx < 0 ? 0 : dx ? 1 : 0)} y={Math.min(p.y, p.y + dy * p.sight) + (dy < 0 ? 0 : dy ? 1 : 0)}
                  width={dx ? p.sight : 1} height={dy ? p.sight : 1} fill="rgba(255,200,0,.18)" />;
              })()}
              <image href={people[p.id]?.avatarUrl || ""} x={p.x - 0.25} y={p.y - 0.6} width={1.5} height={1.5} preserveAspectRatio="xMidYMax meet" style={{ imageRendering: "pixelated" }} />
              <text x={p.x + 0.85} y={p.y + 0.95} fontSize={0.42} fill="#fff" stroke="#000" strokeWidth={0.06} paintOrder="stroke">{ARROW[p.facing]}</text>
            </g>
          ))}
        </svg>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t("gmap_size")}>
          <div className="flex items-center gap-1">
            <input className="field max-w-[70px]" type="number" min={7} max={32} value={map.w} onChange={(e) => onChange(resize(map, Math.max(7, Math.min(32, Number(e.target.value) || 7)), map.h))} />
            ×
            <input className="field max-w-[70px]" type="number" min={7} max={24} value={map.h} onChange={(e) => onChange(resize(map, map.w, Math.max(7, Math.min(24, Number(e.target.value) || 7))))} />
          </div>
        </Field>
        <Field label={t("gmap_look")}>
          <div className="seg">{LOOKS.map((l) => <button key={l} type="button" aria-pressed={(map.look || "colors") === l} onClick={() => set({ look: l === "colors" ? undefined : l })}>{t(`gmap_look_${l}`)}</button>)}</div>
        </Field>
        <Busy busy={busy.gen} className="btn btn-sm" onClick={auto}>{t("gmap_auto_again")}</Busy>
        <button type="button" className="btn btn-sm" onClick={() => onChange({})}>{t("gmap_remove")}</button>
      </div>
      <p className="help">{t("gmap_help")}</p>
    </div>
  );
}
