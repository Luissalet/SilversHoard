// Every trainer: your own, friends', in-game characters and random ones. Create one from a team, import, or roll a random one.
import React, { useState } from "react";
import { api } from "../api.js";
import { useApp } from "../context.js";
import { Busy, Empty, ErrorBox, Field, Icon, ICONS, Modal, Spinner, useBusy, useLoad, useStored } from "../components/ui.jsx";
import { useCopilotRefresh } from "../components/hooks.js";
import { Avatar, FormatSelect, RecordChip, TeamStrip, originLabel } from "../components/silver.jsx";

function NewTrainer({ onClose }) {
  const { t, go, changed, settings } = useApp();
  const [name, setName] = useState("");
  const [paste, setPaste] = useState("");
  const [format, setFormat] = useState(settings.default_format || "gen9nationaldexag");
  const [busy, run] = useBusy();
  const create = () => run("c", async () => {
    const tr = await api.call("trainer_create", { name, paste, format });
    changed();
    go(`#/entrenador/${tr.id}`);
  });
  const random = () => run("r", async () => {
    const team = await api.call("team_random", { format: "gen9randombattle" });
    const text = await api.call("team_import", { text: JSON.stringify(team.sets) });
    setPaste(text.paste);
  });
  return (
    <Modal title={t("new_trainer")} onClose={onClose} wide
      footer={<><button type="button" className="btn" onClick={onClose}>{t("cancel")}</button><Busy busy={busy.c} className="btn btn-primary" disabled={!name.trim() || !paste.trim()} onClick={create}>{t("create")}</Busy></>}>
      <Field label={t("name")}><input className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} /></Field>
      <Field label={t("format")}><FormatSelect id="new-format" value={format} onChange={setFormat} /></Field>
      <Field label={t("team_paste")} hint={t("team_paste_help")}>
        <textarea className="field" rows={12} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={"Garchomp @ Choice Scarf\nAbility: Rough Skin\n- Earthquake\n- Outrage"} />
      </Field>
      <Busy busy={busy.r} className="btn btn-sm" onClick={random}>{t("fill_random_team")}</Busy>
    </Modal>
  );
}

export default function Entrenadores() {
  const { t, changed, go, notify, confirm } = useApp();
  const [q, setQ] = useState("");
  const [origin, setOrigin] = useStored("silver-trainer-origin", "");
  const [showNew, setShowNew] = useState(false);
  const [showTrash, setShowTrash] = useState(false);
  const { data, error, loading, reload } = useLoad(() => api.call("trainers_list", { query: q, origin }), [q, origin]);
  const trash = useLoad(() => (showTrash ? api.call("trash_list") : Promise.resolve(null)), [showTrash]);
  useCopilotRefresh(reload);
  const [busy, run] = useBusy();
  const random = () => run("rnd", async () => { const tr = await api.call("trainer_random", {}); changed(); go(`#/entrenador/${tr.id}`); });
  const list = data?.trainers || [];
  const restore = (kind, id) => run(`r${id}`, async () => { await api.call("trash", { kind, ids: [id], action: "restore" }); notify(t("restored")); trash.reload(); reload(); changed(); });
  const purge = async (kind, id) => {
    if (!(await confirm({ title: t("purge"), message: t("purge_msg") }))) return;
    run(`p${id}`, async () => { await api.call("trash", { kind, ids: [id], action: "purge" }); trash.reload(); });
  };
  return (
    <div className="space-y-4">
      <div className="page-head">
        <div className="min-w-0"><h1>{t("nav_trainers")}</h1><p className="help">{t("trainers_help")}</p></div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary" onClick={() => setShowNew(true)}><Icon d={ICONS.plus} size={14} /> {t("new_trainer")}</button>
          <Busy busy={busy.rnd} className="btn" onClick={random}>{t("random_trainer")}</Busy>
          <a className="btn" href="#/personajes">{t("from_games")}</a>
          <a className="btn" href="#/compartir">{t("import")}</a>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input className="field max-w-xs" placeholder={t("search_trainers")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("search_trainers")} />
        <div className="seg" role="group" aria-label={t("origin")}>
          {["", "own", "friend", "canon", "random"].map((o) => <button key={o} type="button" aria-pressed={origin === o} onClick={() => setOrigin(o)}>{o ? originLabel(t, o) : t("all")}</button>)}
        </div>
        <span className="flex-1" />
        <button type="button" className="btn btn-sm" onClick={() => setShowTrash((s) => !s)}><Icon d={ICONS.trash} size={13} /> {t("trash")}</button>
      </div>
      {error && <ErrorBox error={error} onRetry={reload} />}
      {loading && !data ? <Spinner /> : list.length === 0 ? (
        <Empty icon={ICONS.plus} title={t("no_trainers")} action={<a className="btn btn-primary" href="#/personajes">{t("install_canon")}</a>}>{t("no_trainers_help")}</Empty>
      ) : (
        <div className="trainer-grid">
          {list.map((tr) => (
            <a key={tr.id} href={`#/entrenador/${tr.id}`} className="trainer-card">
              <Avatar url={tr.avatar_url} name={tr.name} size={72} />
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-1.5"><b className="trunc">{tr.name}</b>{tr.favorite ? <Icon d={ICONS.star} size={13} /> : null}</div>
                {tr.title && <div className="help trunc">{tr.title}</div>}
                <TeamStrip species={tr.species} size={30} />
                <div className="flex flex-wrap gap-1"><span className="chip">{originLabel(t, tr.origin)}</span><span className="chip">{t(`lvl_${tr.ai_level}`)}</span><RecordChip record={tr.record} /></div>
              </div>
            </a>
          ))}
        </div>
      )}
      {showTrash && (
        <div className="panel space-y-2">
          <h2>{t("trash")}</h2>
          {!trash.data ? <Spinner /> : [...trash.data.trainers.map((x) => ["trainer", x]), ...trash.data.gyms.map((x) => ["gym", x]), ...trash.data.leagues.map((x) => ["league", x])].length === 0 ? <p className="help">{t("trash_empty")}</p> : (
            <div className="divide-list">
              {[...trash.data.trainers.map((x) => ["trainer", x]), ...trash.data.gyms.map((x) => ["gym", x]), ...trash.data.leagues.map((x) => ["league", x])].map(([kind, x]) => (
                <div key={x.id} className="row-item">
                  <span className="chip">{t(`kind_obj_${kind}`)}</span>
                  <span className="min-w-0 flex-1 trunc">{x.name}</span>
                  <button type="button" className="btn btn-sm" onClick={() => restore(kind, x.id)}>{t("restore")}</button>
                  <button type="button" className="btn btn-sm btn-danger" onClick={() => purge(kind, x.id)}>{t("purge")}</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {showNew && <NewTrainer onClose={() => setShowNew(false)} />}
    </div>
  );
}
