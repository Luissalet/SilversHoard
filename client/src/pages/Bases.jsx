import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { useApp } from "../context.js";
import { Busy, CopyButton, ErrorBox, Field, Icon, ICONS, useBusy, useLoad } from "../components/ui.jsx";
import { Avatar, MonIcon, TrainerSelect, useTrainers } from "../components/silver.jsx";
import LeisureArt from "../components/LeisureArt.jsx";
import { suppliedSprites, spriteLabel } from "../components/SuppliedSprite.jsx";
import "./leisure.css";

const EMPTY = { name: "", trainer_id: "", style: "tree", message: "", decorations: [] };
const DIRS = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0] };

export default function Bases() {
  const { t, lang, go, notify } = useApp();
  const catalog = useLoad(() => api.call("leisure_catalog", { limit: 0 }), []);
  const [archived, setArchived] = useState(false);
  const list = useLoad(() => api.call("secret_bases_list", { archived }), [archived]);
  const [base, setBase] = useState({ ...EMPTY });
  const [editing, setEditing] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [tool, setTool] = useState("plant");
  const [filter, setFilter] = useState("");
  const [species, setSpecies] = useState("Pikachu");
  const [position, setPosition] = useState([3, 7]);
  const [guest, setGuest] = useState("");
  const [shared, setShared] = useState("");
  const [error, setError] = useState(null);
  const [busy, run] = useBusy();
  const trainers = useTrainers();
  const host = trainers.find((tr) => tr.id === base.trainer_id);
  const set = (key, value) => { setBase((b) => ({ ...b, [key]: value })); setDirty(true); };
  const open = (b) => { setBase(b); setEditing(false); setPosition([3, 7]); setDirty(false); setShared(""); setError(null); };
  const action = (key, fn) => run(key, async () => { setError(null); try { await fn(); } catch (e) { setError(e); } });
  const save = (extra = {}) => action("save", async () => {
    const { id, name, trainer_id, style, decorations, message } = base;
    const saved = await api.call("secret_base_save", { id: id || "", name, trainer_id, style, decorations, message, archived: !!base.archived, ...extra });
    setBase(saved); setDirty(false); list.reload(); notify(t("saved"));
  });
  const solid = new Set((catalog.data?.decorations || []).filter((d) => d.solid).map((d) => d.id));
  const footprint = (kind) => suppliedSprites[kind]?.footprint || [1, 1];
  const covers = (p, x, y) => { const [w, h] = footprint(p.kind); return x >= p.x && x < p.x + w && y >= p.y && y < p.y + h; };
  const labelOf = (id) => id === "erase" ? t("base_erase") : id.includes("-") ? spriteLabel(id, lang) : t(`decor_${id}`);
  const filtered = (catalog.data?.decorations || []).filter((d) => labelOf(d.id).toLocaleLowerCase().includes(filter.toLocaleLowerCase()));
  const walk = (x, y) => {
    if (x < 0 || x >= 8 || y < 0 || y >= 8 || Math.abs(x - position[0]) + Math.abs(y - position[1]) !== 1 || base.decorations.some((p) => covers(p, x, y) && solid.has(p.kind))) return;
    setPosition([x, y]);
  };
  useEffect(() => {
    if (editing) return undefined;
    const key = (e) => {
      if (e.target.closest("input,textarea,select") || e.target.closest("button") && !e.target.closest(".base-room")) return;
      const dir = DIRS[e.key];
      if (dir) { e.preventDefault(); walk(position[0] + dir[0], position[1] + dir[1]); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [editing, position, base.decorations, catalog.data]);
  const tile = (x, y) => {
    if (!editing) { walk(x, y); return; }
    if (x === 3 && (y === 1 || y === 7)) return;
    const hit = base.decorations.find((p) => covers(p, x, y));
    const others = base.decorations.filter((p) => p !== hit);
    if (tool !== "erase") {
      const [w, h] = footprint(tool);
      const cells = Array.from({ length: w * h }, (_, i) => [x + i % w, y + Math.floor(i / w)]);
      if (base.decorations.length >= 16 && !hit || cells.some(([cx, cy]) => cx >= 8 || cy >= 8 || cx === 3 && (cy === 1 || cy === 7) || others.some((p) => covers(p, cx, cy)))) {
        setError(new Error(t("base_no_space"))); return;
      }
    }
    setError(null);
    set("decorations", tool === "erase" ? others : [...others, { kind: tool, x, y, ...(tool === "doll" ? { species } : {}) }]);
  };
  const share = () => action("share", async () => { setShared(JSON.stringify(await api.call("secret_base_export", { id: base.id }), null, 2)); });
  const importBase = () => action("import", async () => { open(await api.call("secret_base_import", { payload: JSON.parse(shared) })); list.reload(); });
  const challenge = () => action("battle", async () => { const b = await api.call("secret_base_battle", { id: base.id, trainer_id: guest }); go(`#/combate/${b.id}`); });
  const near = Math.abs(position[0] - 3) + Math.abs(position[1] - 1) <= 1;
  return <div className="space-y-4">
    <div className="page-head"><div><h1>{t("nav_bases")}</h1><p className="help">{t("base_help")}</p></div>
      <button type="button" className="btn" onClick={() => { setBase({ ...EMPTY, decorations: [] }); setEditing(true); setDirty(false); setShared(""); }}>{t("base_new")}</button></div>
    {error && <ErrorBox error={error} />}{list.error && <ErrorBox error={list.error} onRetry={list.reload} />}
    <div className="base-workspace">
      <div className="space-y-3">
        <div className="leisure-choices flex flex-wrap gap-2"><button type="button" className="btn" aria-pressed={editing} onClick={() => setEditing(true)}>{t("base_edit")}</button>
          <button type="button" className="btn" aria-pressed={!editing} onClick={() => { setEditing(false); setPosition([3, 7]); }}>{t("base_visit")}</button>{dirty && <span className="help">{t("base_unsaved")}</span>}</div>
        <div className={`base-room base-${base.style}`} style={{ backgroundImage: `url(${suppliedSprites[`floor-${base.style}`].image})`, backgroundSize: "48px 48px" }} role="group" aria-label={base.name || t("nav_bases")} tabIndex={0}>
          {Array.from({ length: 64 }, (_, i) => {
            const x = i % 8, y = Math.floor(i / 8), item = base.decorations.find((p) => covers(p, x, y));
            const anchor = item && item.x === x && item.y === y;
            const [w, h] = item ? footprint(item.kind) : [1, 1];
            const isHost = x === 3 && y === 1, entrance = x === 3 && y === 7, player = !editing && x === position[0] && y === position[1];
            const label = item ? labelOf(item.kind) : t(isHost ? "base_host" : entrance ? "base_entrance" : "base_empty");
            return <button type="button" key={i} className={`base-tile ${entrance ? "is-entrance" : ""} ${player ? "is-player" : ""}`} onClick={() => tile(x, y)} aria-label={t("base_cell", { x: x + 1, y: y + 1, item: player ? t("base_player") : label })}>
              {isHost ? <Avatar url={host?.avatar_url} name={base.owner_name || host?.name || "?"} size={36} /> : player ? <Avatar url={trainers.find((tr) => tr.id === guest)?.avatar_url} name={t("base_player")} size={32} /> : item?.kind === "doll" ? <MonIcon species={item.species} size={36} /> : anchor ? <span className="base-furniture" style={{ width: `${w * 100}%`, height: `${h * 100}%` }}><LeisureArt kind={item.kind} size={32 * Math.max(w, h)} /></span> : entrance ? <Icon d={ICONS.external} size={22} /> : null}
            </button>;
          })}
        </div>
        <p className="help">{t(editing ? "base_decor_help" : "base_walk_help")}</p>
        {editing && <>
          <Field label={t("sprite_search")}><input className="field" type="search" value={filter} onChange={(e) => setFilter(e.target.value)} /></Field>
          <div className="leisure-palette base-palette" role="group" aria-label={t("base_edit")}>{filtered.map((d) => <button type="button" key={d.id} className="btn" aria-pressed={tool === d.id} onClick={() => setTool(d.id)}><LeisureArt kind={d.id} size={32} /><span>{labelOf(d.id)}<small className="help block">{d.footprint?.join(" × ") || "1 × 1"}</small></span></button>)}
            <button type="button" className="btn" aria-pressed={tool === "erase"} onClick={() => setTool("erase")}><Icon d={ICONS.trash} />{t("base_erase")}</button></div>
          {tool === "doll" && <Field label="Pokémon"><input className="field" value={species} onChange={(e) => setSpecies(e.target.value)} /></Field>}
          <p className="help">{base.decorations.length}/16 · {labelOf(tool)} {tool !== "erase" && footprint(tool).join(" × ")}</p>
          <p className="help">{t("base_gen4_replicas")}</p>
        </>}
        {!editing && <><p>{base.message}</p><TrainerSelect label={t("base_choose_guest")} value={guest} onChange={setGuest} />
          <Busy busy={busy.battle} className="btn btn-primary" disabled={!base.id || dirty || !guest || !near} onClick={challenge}>{t("base_challenge")}</Busy></>}
      </div>
      <div className="panel space-y-3">
        <Field label={t("name")}><input className="field" maxLength={60} value={base.name} onChange={(e) => set("name", e.target.value)} /></Field>
        <Field label={t("base_style")}><select className="field" value={base.style} onChange={(e) => set("style", e.target.value)}>{["tree", "cave", "shrub"].map((s) => <option key={s} value={s}>{t(`base_${s}`)}</option>)}</select></Field>
        <TrainerSelect label={t("base_owner")} value={base.trainer_id} onChange={(v) => set("trainer_id", v)} allowNone />
        <Field label={t("base_message")}><textarea className="field" rows={2} maxLength={500} value={base.message} onChange={(e) => set("message", e.target.value)} /></Field>
        <div className="flex flex-wrap gap-2"><Busy busy={busy.save} className="btn btn-primary" disabled={!base.name.trim() || base.decorations.length > 16} onClick={() => save()}>{t("save")}</Busy>
          {base.id && <><Busy busy={busy.share} className="btn" disabled={dirty} onClick={share}>{t("base_export")}</Busy><Busy busy={busy.save} className="btn" onClick={() => save({ archived: !base.archived })}>{t(base.archived ? "base_restore" : "base_archive")}</Busy></>}
        </div>
      </div>
    </div>
    <section className="space-y-2"><h2>{t("base_import")}</h2><Field label={t("base_json")}><textarea className="field" rows={4} value={shared} onChange={(e) => setShared(e.target.value)} /></Field>
      <div className="flex gap-2"><Busy busy={busy.import} className="btn" disabled={!shared.trim()} onClick={importBase}>{t("base_import")}</Busy>{shared && <CopyButton text={shared} />}</div></section>
    <section className="space-y-2"><div className="flex gap-2"><h2 className="flex-1">{t("nav_bases")}</h2><label className="flex gap-2"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />{t("base_archived")}</label></div>
      <div className="panel divide-list p-0">{list.data?.bases.map((b) => <button type="button" className="row-item w-full" key={b.id} onClick={() => open(b)}><Icon d={ICONS.home} /><b>{b.name}</b><span className="help">{b.owner_name} · {t(`base_${b.style}`)} · {b.decorations.length}/16</span></button>)}</div>
    </section>
  </div>;
}
