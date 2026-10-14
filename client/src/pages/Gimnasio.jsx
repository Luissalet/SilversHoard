// One gym: who you face (gym trainers, then the leader), its rules and who has its badge. Challenge it, edit it, send it.
import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { useApp } from "../context.js";
import { Busy, ErrorBox, Field, Icon, ICONS, Modal, Section, Spinner, Switch, useBusy, useLoad } from "../components/ui.jsx";
import { useContextProvider, useCopilotRefresh } from "../components/hooks.js";
import { Avatar, ExportDialog, FormatSelect, GymBadge, RulesFields, TeamStrip, TrainerSelect, TypeChip, useTrainers } from "../components/silver.jsx";
import { TYPE_COLORS, typeName } from "../battle/dex.js";

const TYPES = Object.keys(TYPE_COLORS).filter((x) => !["Stellar", "???"].includes(x));

export function ChallengeDialog({ kind, target, onClose }) {
  const { t, go, changed } = useApp();
  const [challenger, setChallenger] = useState("");
  const [auto, setAuto] = useState(false);
  const [ignore, setIgnore] = useState(false);
  const [modern, setModern] = useState(false);
  const [busy, run] = useBusy();
  const start = () => run("s", async () => {
    const r = await api.call("challenge_start", { kind, target_id: target.id, challenger_id: challenger, auto, ignore_badges: ignore, format: modern ? "gen9customgame" : "" });
    changed();
    const first = r.stages[0]?.battle_id;
    go(first ? `#/combate/${first}` : "#/combatir");
  });
  return (
    <Modal title={t("challenge_title", { name: target.name })} onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>{t("cancel")}</button><Busy busy={busy.s} className="btn btn-primary" disabled={!challenger} onClick={start}>{t("challenge")}</Busy></>}>
      <TrainerSelect value={challenger} onChange={setChallenger} label={t("challenger")} />
      <label className="flex items-center gap-2"><Switch checked={auto} onChange={setAuto} label={t("challenge_auto")} /> {t("challenge_auto")}</label>
      <p className="help">{auto ? t("challenge_auto_help") : t("challenge_you_help")}</p>
      {kind === "league" && <label className="flex items-center gap-2"><Switch checked={ignore} onChange={setIgnore} label={t("ignore_badges")} /> {t("ignore_badges")}</label>}
      <label className="flex items-center gap-2"><Switch checked={modern} onChange={setModern} label={t("modern_rules")} /> {t("modern_rules")}</label>
      <p className="help">{modern ? t("modern_rules_help") : t("gym_rules_help", { format: target.format })}</p>
    </Modal>
  );
}

function GymEditor({ gym, onSaved, onCancel }) {
  const { t, notify, changed } = useApp();
  const list = useTrainers();
  const [f, setF] = useState(() => ({ name: gym?.name || "", city: gym?.city || "", type: gym?.type || "", badge: gym?.badge || "", badge_color: gym?.badge_color || "#c0c0c0",
    description: gym?.description || "", format: gym?.format || "", rules: gym?.rules || [], level_rules: gym?.level_rules || {}, leader_id: gym?.leader_id || "", trainers: gym?.trainers || [] }));
  const [add, setAdd] = useState("");
  const [busy, run] = useBusy();
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  useContextProvider(() => ({ kind: "gym", object_id: gym?.id || "", title: f.name, dirty: true, fields: f }));
  const save = () => run("s", async () => {
    const out = await api.call("gym_save", { id: gym?.id || "", ...f, level_rules: Object.fromEntries(Object.entries(f.level_rules || {}).filter(([, v]) => v)) });
    notify(t("saved"));
    changed();
    onSaved(out);
  });
  const move = (i, d) => setF((x) => { const a = [...x.trainers]; const j = i + d; if (j < 0 || j >= a.length) return x; [a[i], a[j]] = [a[j], a[i]]; return { ...x, trainers: a }; });
  return (
    <div className="panel space-y-3 max-w-4xl">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("name")}><input className="field" value={f.name} onChange={(e) => set("name", e.target.value)} placeholder={t("gym_name_ph")} /></Field>
        <Field label={t("city")}><input className="field" value={f.city} onChange={(e) => set("city", e.target.value)} /></Field>
        <Field label={t("gym_type")}>
          <select className="field" value={f.type} onChange={(e) => { set("type", e.target.value); if (e.target.value && (!f.badge_color || f.badge_color === "#c0c0c0")) set("badge_color", TYPE_COLORS[e.target.value]); }}>
            <option value="">—</option>{TYPES.map((x) => <option key={x} value={x}>{typeName(x, "es")} · {x}</option>)}
          </select>
        </Field>
        <Field label={t("badge_name")}><div className="flex items-center gap-2"><GymBadge color={f.badge_color} size={32} /><input className="field" value={f.badge} onChange={(e) => set("badge", e.target.value)} placeholder={t("badge_ph")} /><input type="color" value={f.badge_color} onChange={(e) => set("badge_color", e.target.value)} aria-label={t("badge_color")} /></div></Field>
      </div>
      <Field label={t("description")}><textarea className="field" rows={2} value={f.description} onChange={(e) => set("description", e.target.value)} /></Field>
      <TrainerSelect value={f.leader_id} onChange={(v) => set("leader_id", v)} label={t("leader")} />
      <div className="space-y-2">
        <span className="label">{t("gym_trainers")}</span>
        {f.trainers.map((id, i) => {
          const tr = list.find((x) => x.id === id);
          return (
            <div key={id} className="row-item panel">
              <span className="num help">{i + 1}</span>
              <Avatar url={tr?.avatar_url} name={tr?.name} size={30} /><span className="min-w-0 flex-1 trunc">{tr?.name || id}</span>
              <button type="button" className="btn btn-sm btn-icon" onClick={() => move(i, -1)} aria-label="↑"><Icon d={ICONS.arrowUp} size={13} /></button>
              <button type="button" className="btn btn-sm btn-icon" onClick={() => setF((x) => ({ ...x, trainers: x.trainers.filter((y) => y !== id) }))} aria-label={t("remove")}><Icon d={ICONS.close} size={13} /></button>
            </div>
          );
        })}
        <div className="flex items-end gap-2">
          <div className="flex-1"><TrainerSelect value={add} onChange={setAdd} exclude={[f.leader_id, ...f.trainers]} allowNone /></div>
          <button type="button" className="btn" disabled={!add} onClick={() => { setF((x) => ({ ...x, trainers: [...x.trainers, add] })); setAdd(""); }}>{t("add")}</button>
        </div>
        <p className="help">{t("gym_trainers_help")}</p>
      </div>
      <Field label={t("format")}><FormatSelect id="gym-format" value={f.format} onChange={(v) => set("format", v)} /></Field>
      <RulesFields rules={f.rules} levelRules={f.level_rules} onRules={(v) => set("rules", v)} onLevelRules={(v) => set("level_rules", v)} />
      <div className="flex gap-2"><Busy busy={busy.s} className="btn btn-primary" disabled={!f.name || !f.leader_id} onClick={save}>{t("save")}</Busy><button type="button" className="btn" onClick={onCancel}>{t("cancel")}</button></div>
    </div>
  );
}

export default function Gimnasio({ param, query }) {
  const { t, go, confirm, notify, changed } = useApp();
  const isNew = param === "nuevo";
  const { data: g, error, reload } = useLoad(() => (isNew ? Promise.resolve(null) : api.call("gym_get", { id: param })), [param]);
  useCopilotRefresh(reload);
  const [edit, setEdit] = useState(isNew || query?.get("edit") === "1");
  const [dialog, setDialog] = useState("");
  const [busy, run] = useBusy();
  if (isNew) return <div className="space-y-4"><h1>{t("new_gym")}</h1><GymEditor onSaved={(x) => go(`#/gimnasio/${x.id}`)} onCancel={() => go("#/gimnasios")} /></div>;
  if (error && !g) return <ErrorBox error={error} onRetry={reload} />;
  if (!g) return <Spinner />;
  const del = async () => {
    if (!(await confirm({ title: t("to_trash"), message: t("gym_trash_msg", { name: g.name }), confirmLabel: t("to_trash") }))) return;
    run("del", async () => { await api.call("trash", { kind: "gym", ids: [g.id] }); notify(t("moved_to_trash")); changed(); go("#/gimnasios"); });
  };
  const stages = [...(g.gym_trainers || []), ...(g.leader ? [{ ...g.leader, is_leader: true }] : [])];
  return (
    <div className="space-y-4">
      <div className="page-head">
        <GymBadge color={g.badge_color || "#c0c0c0"} size={72} label={g.badge} />
        <div className="min-w-0">
          <h1 className="trunc">{g.name}</h1>
          <div className="help">{[g.city, g.badge].filter(Boolean).join(" · ")}</div>
          <div className="mt-1 flex flex-wrap gap-1.5">{g.type && <TypeChip type={g.type} />}<span className="chip">{g.format}</span>
            {g.level_rules?.level && <span className="chip">{t("level_fixed")}: {g.level_rules.level}</span>}{g.level_rules?.level_cap && <span className="chip">{t("level_cap")}: {g.level_rules.level_cap}</span>}
            {(g.rules || []).map((r) => <span key={r} className="chip">{r}</span>)}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary" onClick={() => setDialog("challenge")}><Icon d={ICONS.play} size={14} /> {t("challenge")}</button>
          <button type="button" className="btn" onClick={() => setDialog("export")}><Icon d={ICONS.send} size={14} /> {t("send_friend")}</button>
          <button type="button" className="btn" onClick={() => setEdit((e) => !e)}><Icon d={ICONS.pencil} size={14} /> {t("edit")}</button>
          <Busy busy={busy.del} className="btn btn-danger" onClick={del}><Icon d={ICONS.trash} size={14} /></Busy>
        </div>
      </div>
      {g.description && <p className="help max-w-3xl">{g.description}</p>}
      {edit ? <GymEditor gym={g} onSaved={() => { setEdit(false); reload(); }} onCancel={() => setEdit(false)} /> : (
        <Section title={t("gym_order")} count={stages.length}>
          <div className="stage-list">
            {stages.map((tr, i) => (
              <a key={tr.id} href={`#/entrenador/${tr.id}`} className={`stage-card ${tr.is_leader ? "is-leader" : ""}`}>
                <span className="stage-n">{i + 1}</span>
                <Avatar url={tr.avatar_url} name={tr.name} size={64} />
                <div className="min-w-0 flex-1"><b className="trunc block">{tr.name}</b><span className="help">{tr.is_leader ? t("leader") : tr.title || t("gym_trainer")}</span><TeamStrip species={tr.species} size={28} /></div>
              </a>
            ))}
          </div>
        </Section>
      )}
      <Section title={t("badge_holders")} count={(g.badges || []).length}>
        {(g.badges || []).length === 0 ? <p className="help">{t("no_badge_holders")}</p> : (
          <div className="panel divide-list p-0">
            {g.badges.map((b) => (
              <div key={b.id} className="row-item">
                <GymBadge color={b.badge_color || g.badge_color} size={22} />
                <span className="min-w-0 flex-1 trunc">{b.challenger_name}</span>
                <span className="chip">{b.source === "friend" ? t("from_friend") : t("here")}</span>
                {b.battle_id && <a className="btn btn-sm" href={`#/combate/${b.battle_id}`}>{t("replay")}</a>}
              </div>
            ))}
          </div>
        )}
      </Section>
      {dialog === "challenge" && <ChallengeDialog kind="gym" target={g} onClose={() => setDialog("")} />}
      {dialog === "export" && <ExportDialog kind="gym" id={g.id} name={g.name} onClose={() => setDialog("")} />}
    </div>
  );
}
