// The arena designer: real-time arenas drawn by hand (rocks on the 28 x 17 m field and a floor), their list, and a quick AI-vs-AI
// battle to try one. The battle engine applies the same limits as the editor (sim.mjs customRocks; silvers_hoard/arenas.py).
import React, { useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import { useApp } from "../context.js";
import { Busy, Empty, ErrorBox, Field, Icon, ICONS, Spinner, Switch, useBusy, useLoad } from "../components/ui.jsx";
import { forgetCustomArenas } from "../battle/rt/ModeFields.jsx";
import { ArenaField, FLOORS, W, H, blocked } from "../battle/rt/ArenaField.jsx";
export { ArenaField, FLOORS };

const MAX = 16;
const r3 = (v) => Math.round(v * 1000) / 1000;
const mirrored = (rocks) => rocks.flatMap((rk) => (Math.abs(rk.x - W / 2) <= 0.05 ? [rk] : [rk, { ...rk, x: r3(W - rk.x) }]));

const TEMPLATES = {
  pillars: [{ x: 9.5, y: 4.5, r: 1 }, { x: 9.5, y: 12.5, r: 1 }],
  center: [{ x: 14, y: 8.5, r: 2.2 }],
  corridor: [{ x: 10, y: 3, r: 1.3 }, { x: 10, y: 14, r: 1.3 }, { x: 14, y: 2.2, r: 1 }, { x: 14, y: 14.8, r: 1 }],
  scatter: [{ x: 8.5, y: 3.5, r: 0.7 }, { x: 11, y: 6, r: 0.9 }, { x: 9.5, y: 13, r: 1.1 }, { x: 12.5, y: 11, r: 0.6 }, { x: 14, y: 3.2, r: 0.8 }],
};
// places from the games: a floor and a few rocks where the place has them
const PLACES = {
  pyre: { floor: "pyre", rocks: [{ x: 9, y: 3.2, r: 0.55 }, { x: 11.5, y: 13.6, r: 0.55 }, { x: 8.2, y: 10.8, r: 0.5 }, { x: 12.6, y: 5.6, r: 0.5 }] },
  summit: { floor: "summit", rocks: [{ x: 10, y: 4, r: 1.1 }, { x: 10.5, y: 13, r: 0.9 }] },
  meteor: { floor: "meteor", rocks: [{ x: 9.5, y: 8.5, r: 0.9 }, { x: 12, y: 3, r: 0.7 }, { x: 12, y: 14, r: 0.7 }] },
  champion: { floor: "champion", rocks: [] },
  castle: { floor: "castle", rocks: [{ x: 9, y: 4, r: 0.6 }, { x: 9, y: 13, r: 0.6 }] },
};

function ArenaCard({ a }) {
  const { t } = useApp();
  return (
    <a className="panel arena-card" href={`#/arena/${a.id}`}>
      <ArenaField floor={a.floor} rocks={a.rocks} small />
      <b className="trunc">{a.name}</b>
      <span className="help">{t(`floor_${a.floor}`)} · {t("arena_rocks_n", { n: a.rocks.length })}</span>
      {a.used_by?.length > 0 && <span className="help trunc">{t("arena_used_by", { list: a.used_by.join(", ") })}</span>}
    </a>
  );
}

export default function Arenas() {
  const { t } = useApp();
  const { data, error, reload } = useLoad(() => api.call("arenas_list", {}), []);
  return (
    <div className="space-y-4">
      <div className="page-head">
        <div className="min-w-0"><h1>{t("nav_arenas")}</h1><p className="help">{t("arenas_help")}</p></div>
        <a className="btn btn-primary" href="#/arena/nueva"><Icon d={ICONS.plus} size={15} /> {t("arena_new")}</a>
      </div>
      {error && <ErrorBox error={error} onRetry={reload} />}
      {!data ? <Spinner /> : data.arenas.length === 0 ? <Empty title={t("arena_none")} action={<a className="btn btn-primary" href="#/arena/nueva">{t("arena_new")}</a>} />
        : <div className="arena-grid">{data.arenas.map((a) => <ArenaCard key={a.id} a={a} />)}</div>}
    </div>
  );
}

/** The editor: click to place, drag to move, a slider for the size; with symmetry on you edit the left half and the right one follows. */
export function ArenaEditor({ param }) {
  const { t, go, notify, confirm, changed } = useApp();
  const isNew = param === "nueva";
  const { data, error, reload } = useLoad(() => (isNew ? Promise.resolve(null) : api.call("arena_get", { id: param })), [param]);
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  if (!isNew && !data) return <Spinner />;
  return <EditorBody key={data?.id || "new"} arena={data} isNew={isNew} t={t} go={go} notify={notify} confirm={confirm} changed={changed} />;
}

function splitMirror(rocks) {
  // a stored arena that is symmetric is edited as its left half with symmetry on
  const left = rocks.filter((r) => r.x <= W / 2 + 0.05);
  const back = mirrored(left);
  const same = back.length === rocks.length && back.every((b) => rocks.some((r) => Math.abs(r.x - b.x) < 0.01 && Math.abs(r.y - b.y) < 0.01 && Math.abs(r.r - b.r) < 0.01));
  return same && rocks.length ? { mirror: true, rocks: left } : { mirror: false, rocks };
}

function EditorBody({ arena, isNew, t, go, notify, confirm, changed }) {
  const start = useMemo(() => splitMirror(arena?.rocks || []), [arena]);
  const [name, setName] = useState(arena?.name || "");
  const [floor, setFloor] = useState(arena?.floor || "grass");
  const [mirror, setMirror] = useState(isNew ? true : start.mirror);
  const [rocks, setRocks] = useState(start.rocks);
  const [sel, setSel] = useState(-1);
  const [busy, run] = useBusy();
  const svg = useRef(null);
  const drag = useRef(null);
  const all = mirror ? mirrored(rocks) : rocks;
  const ghosts = mirror ? all.filter((r) => !rocks.includes(r)) : [];

  const toField = (e) => {
    const pt = svg.current.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(svg.current.getScreenCTM().inverse());
    return { x: p.x, y: p.y };
  };
  const clampRock = (rk) => {
    const r = Math.max(0.4, Math.min(3, rk.r));
    let x = Math.max(r, Math.min(W - r, rk.x));
    if (mirror) x = Math.min(x, W / 2);
    return { x: r3(x), y: r3(Math.max(r, Math.min(H - r, rk.y))), r: r3(r) };
  };
  const onDown = (e) => {
    const hit = e.target?.dataset?.rock;
    const p = toField(e);
    if (hit !== undefined) {
      const i = Number(hit);
      setSel(i);
      drag.current = { i, dx: p.x - rocks[i].x, dy: p.y - rocks[i].y };
    } else {
      if (p.x < 0 || p.x > W || p.y < 0 || p.y > H) return;
      if (mirror && p.x > W / 2) { p.x = W - p.x; }
      if (all.length + (mirror && Math.abs(p.x - W / 2) > 0.05 ? 2 : 1) > MAX) { notify(t("arena_max")); return; }
      const rk = clampRock({ x: p.x, y: p.y, r: 1 });
      if (blocked(rk)) { notify(t("arena_blocked")); return; }
      setRocks((list) => [...list, rk]);
      setSel(rocks.length);
      drag.current = { i: rocks.length, dx: 0, dy: 0 };
    }
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e) => {
    if (!drag.current) return;
    const p = toField(e);
    const { i, dx, dy } = drag.current;
    setRocks((list) => list.map((rk, j) => (j === i ? clampRock({ ...rk, x: p.x - dx, y: p.y - dy }) : rk)));
  };
  const onUp = () => { drag.current = null; };
  const setR = (v) => setRocks((list) => list.map((rk, j) => (j === sel ? clampRock({ ...rk, r: Number(v) }) : rk)));
  const remove = () => { setRocks((list) => list.filter((_, j) => j !== sel)); setSel(-1); };
  const template = (k) => { setMirror(true); setRocks(TEMPLATES[k].map(clampRock)); setSel(-1); };
  const place = (k) => { setMirror(true); setFloor(PLACES[k].floor); setRocks(PLACES[k].rocks.map(clampRock)); setSel(-1); if (!name.trim()) setName(t(`floor_${k}`)); };
  const save = () => run("save", async () => {
    const out = await api.call("arena_save", { id: arena?.id || "", name: name.trim(), floor, rocks, mirror });
    forgetCustomArenas();
    changed();
    notify(t("arena_saved"));
    if (isNew) go(`#/arena/${out.id}`);
    return out;
  });
  const tryIt = () => run("try", async () => {
    const out = await save();
    if (!out) return;
    // two of your trainers at random (two new random ones if you have fewer), both played by the AI
    const mine = ((await api.call("trainers_list", {})).trainers || []).filter((x) => x.species?.length).sort(() => Math.random() - 0.5);
    const pick = mine.length >= 2 ? mine.slice(0, 2) : [await api.call("trainer_random", {}), await api.call("trainer_random", {})];
    const bt = await api.call("battle_start", { p1: { trainer_id: pick[0].id, ai_level: "hard" }, p2: { trainer_id: pick[1].id, ai_level: "hard" },
      mode: "realtime", rt_arena: out.value, title: out.name });
    go(`#/combate/${bt.id}`);
  });
  const del = async () => {
    if (!(await confirm({ title: t("arena_delete"), message: t("arena_delete_q"), confirmLabel: t("arena_delete"), danger: true }))) return;
    run("del", async () => { await api.call("arenas_delete", { ids: [arena.id] }); forgetCustomArenas(); changed(); go("#/arenas"); });
  };
  const current = sel >= 0 ? rocks[sel] : null;
  return (
    <div className="space-y-4">
      <div className="page-head">
        <div className="min-w-0"><h1 className="trunc">{name || t("arena_new")}</h1><p className="help">{t("arena_canvas_help")}</p></div>
        <div className="flex flex-wrap gap-2">
          {!isNew && <Busy busy={busy.del} className="btn" onClick={del}>{t("arena_delete")}</Busy>}
          <a className="btn" href="#/arenas">{t("nav_arenas")}</a>
        </div>
      </div>
      <div className="arena-editor">
        <div className="panel p-2" onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}>
          <ArenaField floor={floor} rocks={rocks} ghosts={ghosts} selected={sel} onDown={onDown} svgRef={svg} />
        </div>
        <div className="panel space-y-3">
          <Field label={t("arena_name")}><input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("arena_name_ph")} /></Field>
          <Field label={t("arena_floor")} hint={t("arena_floor_help")}>
            <div className="arena-floors" role="radiogroup" aria-label={t("arena_floor")}>
              {Object.keys(FLOORS).map((f) => (
                <button key={f} type="button" role="radio" aria-checked={floor === f} className={`arena-floor ${floor === f ? "is-on" : ""}`} onClick={() => setFloor(f)}>
                  <span style={{ background: `linear-gradient(90deg, ${FLOORS[f][0]} 50%, ${FLOORS[f][1]} 50%)` }} />{t(`floor_${f}`)}
                </button>
              ))}
            </div>
          </Field>
          <label className="flex items-center gap-2"><Switch checked={mirror} onChange={(v) => {
            setRocks(v ? rocks.filter((r) => r.x <= W / 2 + 0.05) : all);
            setSel(-1);
            setMirror(v);
          }} label={t("arena_mirror")} /> {t("arena_mirror")}</label>
          <p className="help">{t("arena_mirror_help")}</p>
          {current && (
            <div className="space-y-2">
              <Field label={t("arena_radius")}>
                <input type="range" min={0.4} max={3} step={0.1} value={current.r} onChange={(e) => setR(e.target.value)} aria-label={t("arena_radius")} />
                <span className="help num"> {current.r.toFixed(1)} m · ({current.x.toFixed(1)}, {current.y.toFixed(1)})</span>
              </Field>
              <button type="button" className="btn btn-sm" onClick={remove}>{t("arena_delete_rock")}</button>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <span className="help">{t("arena_template")}:</span>
            {Object.keys(TEMPLATES).map((k) => <button key={k} type="button" className="btn btn-sm" onClick={() => template(k)}>{t(`tpl_${k}`)}</button>)}
            <span className="help">{t("arena_places")}:</span>
            {Object.keys(PLACES).map((k) => <button key={k} type="button" className="btn btn-sm" onClick={() => place(k)}>{t(`floor_${k}`)}</button>)}
            <button type="button" className="btn btn-sm" onClick={() => { setRocks([]); setSel(-1); }}>{t("arena_clear")}</button>
          </div>
          <p className="help">{t("arena_rocks_n", { n: all.length })} / {MAX}</p>
          <div className="flex flex-wrap gap-2">
            <Busy busy={busy.save} className="btn btn-primary" disabled={!name.trim()} onClick={save}>{t("arena_save")}</Busy>
            <Busy busy={busy.try} className="btn" disabled={!name.trim()} onClick={tryIt}>{t("arena_try")}</Busy>
          </div>
        </div>
      </div>
    </div>
  );
}
