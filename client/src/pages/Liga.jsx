// One league: its gyms, the Elite Four and the champion, the hall of fame. Challenge it with a trainer that has the badges.
import React, { useState } from "react";
import { api } from "../api.js";
import { useApp } from "../context.js";
import { Busy, ErrorBox, Field, Icon, ICONS, Section, Spinner, useBusy, useLoad } from "../components/ui.jsx";
import { useContextProvider, useCopilotRefresh } from "../components/hooks.js";
import { Avatar, ExportDialog, FormatSelect, GymBadge, MonIcon, TeamStrip, TrainerSelect, useTrainers } from "../components/silver.jsx";
import { ChallengeDialog } from "./Gimnasio.jsx";
import { GymCard } from "./Gimnasios.jsx";

function LeagueEditor({ lg, onSaved, onCancel }) {
  const { t, notify, changed } = useApp();
  const trainers = useTrainers();
  const gyms = useLoad(() => api.call("gyms_list", {}), []);
  const [f, setF] = useState(() => ({ name: lg?.name || "", description: lg?.description || "", format: lg?.format || "", gyms: lg?.gyms || [], elite_four: lg?.elite_four || [],
    champion_id: lg?.champion_id || "", badges_required: lg?.badges_required ?? "" }));
  const [addE, setAddE] = useState("");
  const [busy, run] = useBusy();
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  useContextProvider(() => ({ kind: "league", object_id: lg?.id || "", title: f.name, dirty: true, fields: f }));
  const save = () => run("s", async () => {
    const out = await api.call("league_save", { id: lg?.id || "", ...f, badges_required: f.badges_required === "" ? undefined : Number(f.badges_required) });
    notify(t("saved"));
    changed();
    onSaved(out);
  });
  return (
    <div className="panel space-y-3 max-w-4xl">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("name")}><input className="field" value={f.name} onChange={(e) => set("name", e.target.value)} /></Field>
        <Field label={t("format")}><FormatSelect id="lg-format" value={f.format} onChange={(v) => set("format", v)} /></Field>
      </div>
      <Field label={t("description")}><input className="field" value={f.description} onChange={(e) => set("description", e.target.value)} /></Field>
      <div className="space-y-1">
        <span className="label">{t("league_gyms")}</span>
        <div className="pick-grid">
          {(gyms.data?.gyms || []).map((g) => (
            <label key={g.id} className={`pick ${f.gyms.includes(g.id) ? "is-on" : ""}`}>
              <input type="checkbox" checked={f.gyms.includes(g.id)} onChange={() => set("gyms", f.gyms.includes(g.id) ? f.gyms.filter((x) => x !== g.id) : [...f.gyms, g.id])} />
              <GymBadge image={g.badge_image} color={g.badge_color} size={24} /><span className="trunc">{g.name}</span>
              {f.gyms.includes(g.id) && <span className="chip num">{f.gyms.indexOf(g.id) + 1}</span>}
            </label>
          ))}
        </div>
      </div>
      <Field label={t("badges_required")}><input className="field max-w-[120px]" type="number" min={0} value={f.badges_required} onChange={(e) => set("badges_required", e.target.value)} placeholder={String(f.gyms.length)} /></Field>
      <div className="space-y-2">
        <span className="label">{t("elite_four")}</span>
        {f.elite_four.map((id, i) => {
          const tr = trainers.find((x) => x.id === id);
          return <div key={id} className="row-item panel"><span className="num help">{i + 1}</span><Avatar url={tr?.avatar_url} name={tr?.name} size={28} /><span className="flex-1 trunc">{tr?.name || id}</span>
            <button type="button" className="btn btn-sm btn-icon" onClick={() => set("elite_four", f.elite_four.filter((x) => x !== id))} aria-label={t("remove")}><Icon d={ICONS.close} size={13} /></button></div>;
        })}
        <div className="flex items-end gap-2"><div className="flex-1"><TrainerSelect value={addE} onChange={setAddE} exclude={[...f.elite_four, f.champion_id]} allowNone /></div>
          <button type="button" className="btn" disabled={!addE} onClick={() => { set("elite_four", [...f.elite_four, addE]); setAddE(""); }}>{t("add")}</button></div>
      </div>
      <TrainerSelect value={f.champion_id} onChange={(v) => set("champion_id", v)} label={t("champion")} />
      <div className="flex gap-2"><Busy busy={busy.s} className="btn btn-primary" disabled={!f.name || !f.champion_id} onClick={save}>{t("save")}</Busy><button type="button" className="btn" onClick={onCancel}>{t("cancel")}</button></div>
    </div>
  );
}

export default function Liga({ param }) {
  const { t, go, confirm, notify, changed } = useApp();
  const isNew = param === "nueva";
  const { data: lg, error, reload } = useLoad(() => (isNew ? Promise.resolve(null) : api.call("league_get", { id: param })), [param]);
  useCopilotRefresh(reload);
  const [edit, setEdit] = useState(false);
  const [dialog, setDialog] = useState("");
  const [busy, run] = useBusy();
  if (isNew) return <div className="space-y-4"><h1>{t("new_league")}</h1><LeagueEditor onSaved={(x) => go(`#/liga/${x.id}`)} onCancel={() => go("#/ligas")} /></div>;
  if (error && !lg) return <ErrorBox error={error} onRetry={reload} />;
  if (!lg) return <Spinner />;
  const del = async () => {
    if (!(await confirm({ title: t("to_trash"), message: t("league_trash_msg", { name: lg.name }), confirmLabel: t("to_trash") }))) return;
    run("del", async () => { await api.call("trash", { kind: "league", ids: [lg.id] }); notify(t("moved_to_trash")); changed(); go("#/ligas"); });
  };
  return (
    <div className="space-y-5">
      <div className="page-head">
        <div className="min-w-0"><h1>{lg.name}</h1><p className="help">{lg.description}</p>
          <div className="mt-1 flex flex-wrap gap-1.5"><span className="chip">{lg.format}</span><span className="chip">{t("badges_needed", { n: lg.badges_required })}</span></div></div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary" onClick={() => setDialog("challenge")}><Icon d={ICONS.play} size={14} /> {t("challenge_league")}</button>
          <button type="button" className="btn" onClick={() => setDialog("export")}><Icon d={ICONS.send} size={14} /> {t("send_friend")}</button>
          <button type="button" className="btn" onClick={() => setEdit((e) => !e)}><Icon d={ICONS.pencil} size={14} /> {t("edit")}</button>
          <Busy busy={busy.del} className="btn btn-danger" onClick={del}><Icon d={ICONS.trash} size={14} /></Busy>
        </div>
      </div>
      {edit && <LeagueEditor lg={lg} onSaved={() => { setEdit(false); reload(); }} onCancel={() => setEdit(false)} />}
      <Section title={t("league_gyms")} count={lg.gym_list.length}><div className="gym-grid">{lg.gym_list.map((g) => <GymCard key={g.id} g={g} />)}</div></Section>
      <Section title={t("elite_and_champion")}>
        <div className="stage-list">
          {[...lg.elite_list, ...(lg.champion ? [{ ...lg.champion, is_leader: true }] : [])].map((tr, i) => (
            <a key={tr.id} href={`#/entrenador/${tr.id}`} className={`stage-card ${tr.is_leader ? "is-leader" : ""}`}>
              <span className="stage-n">{i + 1}</span><Avatar url={tr.avatar_url} name={tr.name} size={64} />
              <div className="min-w-0 flex-1"><b className="trunc block">{tr.name}</b><span className="help">{tr.is_leader ? t("champion") : t("elite_member")}</span><TeamStrip species={tr.species} size={28} /></div>
            </a>
          ))}
        </div>
      </Section>
      <Section title={t("hall_of_fame")} count={lg.hall.length}>
        {lg.hall.length === 0 ? <p className="help">{t("hall_empty")}</p> : (
          <div className="hall-list">
            {lg.hall.map((h) => (
              <div key={h.id} className="hall-card"><b>{h.champion_name}</b><span className="help">{new Date(h.earned_at * 1000).toLocaleDateString()}</span>
                <div className="flex flex-wrap gap-1">{(h.team || []).map((m, i) => <MonIcon key={i} species={m.species} size={40} />)}</div></div>
            ))}
          </div>
        )}
      </Section>
      {dialog === "challenge" && <ChallengeDialog kind="league" target={lg} onClose={() => setDialog("")} />}
      {dialog === "export" && <ExportDialog kind="league" id={lg.id} name={lg.name} onClose={() => setDialog("")} />}
    </div>
  );
}
