// One trainer: team (cards and Showdown text), AI and details, battle lines, record. Fight it, send it to a friend, copy it.
import React, { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { useApp } from "../context.js";
import { Busy, ErrorBox, Field, Icon, ICONS, Modal, Section, Spinner, Tabs, useBusy, useLoad, useStored } from "../components/ui.jsx";
import CooldownsTab from "../battle/rt/CooldownsTab.jsx";
import { useContextProvider, useCopilotRefresh } from "../components/hooks.js";
import { AiFields, Avatar, AvatarDialog, ExportDialog, FormatSelect, GymBadge, RecordChip, TeamCards, TrainerPictureViewer, TrainerSelect, creditLabel, originLabel } from "../components/silver.jsx";
import { BattleRow } from "./Historial.jsx";
import { loc } from "../loc.js";
import TeamBuilder from "../components/TeamBuilder.jsx";
import TrainerPoster from "../components/TrainerPoster.jsx";

function FightDialog({ trainer, onClose }) {
  const { t, lang, go, changed } = useApp();
  const [other, setOther] = useState("");
  const [mode, setMode] = useState("you_vs");
  const [busy, run] = useBusy();
  const start = () => run("s", async () => {
    const seats = mode === "you_vs" ? [{ trainer_id: other, human: true }, { trainer_id: trainer.id, human: false }]
      : mode === "you_with" ? [{ trainer_id: trainer.id, human: true }, { trainer_id: other, human: false }]
        : [{ trainer_id: trainer.id, human: false }, { trainer_id: other, human: false }];
    const b = await api.call("battle_start", { p1: seats[0], p2: seats[1] });
    changed();
    go(`#/combate/${b.id}`);
  });
  return (
    <Modal title={t("fight_title", { name: loc(trainer, lang) })} onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>{t("cancel")}</button><Busy busy={busy.s} className="btn btn-primary" disabled={!other} onClick={start}>{t("start_battle")}</Busy></>}>
      <div className="seg" role="group">
        <button type="button" aria-pressed={mode === "you_vs"} onClick={() => setMode("you_vs")}>{t("fight_you_vs")}</button>
        <button type="button" aria-pressed={mode === "you_with"} onClick={() => setMode("you_with")}>{t("fight_you_with")}</button>
        <button type="button" aria-pressed={mode === "ai"} onClick={() => setMode("ai")}>{t("fight_ai")}</button>
      </div>
      <TrainerSelect value={other} onChange={setOther} exclude={[trainer.id]} label={mode === "you_vs" ? t("your_trainer") : t("opponent")} />
    </Modal>
  );
}

function TeamTab({ tr, reload, startVisual = false }) {
  const { t, notify, changed } = useApp();
  const [paste, setPaste] = useState(tr.paste || "");
  const [editing, setEditing] = useState(false);
  const [check, setCheck] = useState(null);
  const [visual, setVisual] = useState(startVisual || !tr.team.length);
  const [busy, run] = useBusy();
  useEffect(() => { if (!editing) setPaste(tr.paste || ""); }, [tr.paste, editing]);
  const saveSets = async (sets) => {
    await api.call("trainer_update", { id: tr.id, team: sets });
    notify(t("saved"));
    setVisual(false);
    reload();
    changed();
  };
  if (visual) return <div className="space-y-3">
    {!tr.team.length && <p className="help">{t("trainer_empty_team")}</p>}
    <TeamBuilder team={tr.team} format={tr.format} onSave={saveSets} onCancel={() => setVisual(false)} />
  </div>;
  const validate = () => run("v", async () => setCheck(await api.call("team_validate", { format: tr.format, paste })));
  const save = () => run("s", async () => {
    await api.call("trainer_update", { id: tr.id, paste });
    notify(t("saved"));
    setEditing(false);
    setCheck(null);
    reload();
    changed();
  });
  return (
    <div className="space-y-3">
      {!tr.team.length ? <p className="help">{t("trainer_empty_team")}</p> : tr.summary ? <TeamCards summary={tr.summary} /> : tr.summary_error ? <div className="banner banner-warn">{tr.summary_error}</div> : <Spinner />}
      <div className="panel space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="flex-1">{t("team_text")}</h2>
          {!editing && <button type="button" className="btn btn-sm btn-primary" onClick={() => setVisual(true)}><Icon d={ICONS.grid} size={13} /> {t("tb_open")}</button>}
          {!editing && <button type="button" className="btn btn-sm" onClick={() => setEditing(true)}><Icon d={ICONS.pencil} size={13} /> {t("edit_text")}</button>}
          {editing && <Busy busy={busy.v} className="btn btn-sm" onClick={validate}>{t("validate")}</Busy>}
          {editing && <button type="button" className="btn btn-sm" onClick={() => { setEditing(false); setPaste(tr.paste || ""); setCheck(null); }}>{t("cancel")}</button>}
          {editing && <Busy busy={busy.s} className="btn btn-sm btn-primary" onClick={save}>{t("save")}</Busy>}
        </div>
        <textarea className="field" rows={editing ? 18 : 8} value={paste} readOnly={!editing} onChange={(e) => setPaste(e.target.value)} aria-label={t("team_text")} />
        {check && (check.ok ? <div className="banner banner-info">{t("team_valid", { format: check.format })}</div>
          : <div className="banner banner-warn space-y-1"><b>{t("team_problems", { format: check.format })}</b><ul className="list-disc pl-5">{check.problems.map((p, i) => <li key={i}>{p}</li>)}</ul></div>)}
        <p className="help">{t("team_text_help")}</p>
      </div>
    </div>
  );
}

function DetailsTab({ tr, reload, nameInput }) {
  const { t, notify, changed } = useApp();
  const [form, setForm] = useState(null);
  const [busy, run] = useBusy();
  useEffect(() => setForm({ name: tr.name, title: tr.title, owner: tr.owner, format: tr.format, ai_level: tr.ai_level, ai_style: tr.ai_style, notes: tr.notes, tags: (tr.tags || []).join(", ") }), [tr]);
  useContextProvider(() => form ? { kind: "trainer", object_id: tr.id, title: tr.name, dirty: JSON.stringify(form) !== JSON.stringify({ name: tr.name, title: tr.title, owner: tr.owner, format: tr.format, ai_level: tr.ai_level, ai_style: tr.ai_style, notes: tr.notes, tags: (tr.tags || []).join(", ") }), fields: form } : null);
  if (!form) return null;
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const save = () => run("s", async () => {
    await api.call("trainer_update", { id: tr.id, ...form, tags: form.tags.split(",").map((x) => x.trim()).filter(Boolean) });
    notify(t("saved"));
    reload();
    changed();
  });
  return (
    <div className="panel space-y-3 max-w-3xl">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("name")}><input ref={nameInput} autoFocus className="field" value={form.name} onChange={(e) => set("name", e.target.value)} maxLength={60} /></Field>
        <Field label={t("title_field")}><input className="field" value={form.title} onChange={(e) => set("title", e.target.value)} maxLength={60} placeholder={t("title_ph")} /></Field>
        <Field label={t("owner")}><input className="field" value={form.owner} onChange={(e) => set("owner", e.target.value)} maxLength={60} /></Field>
        <Field label={t("format")}><FormatSelect id="tr-format" value={form.format} onChange={(v) => set("format", v)} /></Field>
      </div>
      <AiFields level={form.ai_level} style={form.ai_style} onLevel={(v) => set("ai_level", v)} onStyle={(v) => set("ai_style", v)} />
      <p className="help">{t(`lvl_help_${form.ai_level}`)} {t(`style_help_${form.ai_style}`)}</p>
      <Field label={t("tags")}><input className="field" value={form.tags} onChange={(e) => set("tags", e.target.value)} placeholder="Kanto, rival" /></Field>
      <Field label={t("notes")}><textarea className="field" rows={4} value={form.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
      <Busy busy={busy.s} className="btn btn-primary" onClick={save}>{t("save")}</Busy>
    </div>
  );
}

function LinesTab({ tr, reload }) {
  const { t, notify, lang } = useApp();
  const [d, setD] = useState(tr.dialogue || {});
  const [personality, setPersonality] = useState("");
  const [busy, run] = useBusy();
  useEffect(() => setD(tr.dialogue || {}), [tr.dialogue]);
  const save = () => run("s", async () => { await api.call("trainer_update", { id: tr.id, dialogue: d }); notify(t("saved")); reload(); });
  const write = () => run("w", async () => {
    const r = await api.call("trainer_dialogue_write", { id: tr.id, personality, lang });
    setD(r.dialogue);
    notify(t("lines_written", { model: r.model || "" }));
    reload();
  });
  return (
    <div className="panel space-y-3 max-w-3xl">
      <p className="help">{t("lines_help")}</p>
      {["intro", "last", "last_low", "win", "lose", "after", "on_ko", "on_faint", "on_super", "on_switch"].map((k) => (
        <Field key={k} label={t(`line_${k}`)}><input className="field" value={d[k] || ""} maxLength={280} onChange={(e) => setD((x) => ({ ...x, [k]: e.target.value }))} /></Field>
      ))}
      <div className="border-t pt-3 space-y-2" style={{ borderColor: "var(--line)" }}>
        <span className="label">{t("phase_title")}</span>
        <p className="help">{t("phase_help")}</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t("phase_when")}>
            <select className="field" value={d.phase_when || ""} onChange={(e) => setD((x) => ({ ...x, phase_when: e.target.value }))}>
              <option value="">{t("phase_when_none")}</option>
              <option value="half">{t("phase_when_half")}</option>
              <option value="last">{t("phase_when_last")}</option>
            </select>
          </Field>
          <Field label={t("phase_level")}>
            <select className="field" value={d.phase_level || ""} disabled={!d.phase_when} onChange={(e) => setD((x) => ({ ...x, phase_level: e.target.value }))}>
              <option value="">{t("phase_same")}</option>
              {["easy", "normal", "hard", "expert", "master", "neural"].map((l) => <option key={l} value={l}>{t(`lvl_${l}`)}</option>)}
            </select>
          </Field>
          <Field label={t("phase_style")}>
            <select className="field" value={d.phase_style || ""} disabled={!d.phase_when} onChange={(e) => setD((x) => ({ ...x, phase_style: e.target.value }))}>
              <option value="">{t("phase_same")}</option>
              {["balanced", "aggressive", "defensive", "setup", "stall"].map((st) => <option key={st} value={st}>{t(`style_${st}`)}</option>)}
            </select>
          </Field>
        </div>
        <Field label={t("line_phase")}><input className="field" value={d.phase || ""} maxLength={280} disabled={!d.phase_when} placeholder={t("line_phase_ph")}
          onChange={(e) => setD((x) => ({ ...x, phase: e.target.value }))} /></Field>
      </div>
      <div className="flex flex-wrap gap-2"><Busy busy={busy.s} className="btn btn-primary" onClick={save}>{t("save")}</Busy></div>
      <div className="border-t pt-3 space-y-2" style={{ borderColor: "var(--line)" }}>
        <Field label={t("personality")} hint={t("personality_help")}><input className="field" value={personality} onChange={(e) => setPersonality(e.target.value)} placeholder={t("personality_ph")} /></Field>
        <Busy busy={busy.w} className="btn" onClick={write}>{t("write_lines")}</Busy>
      </div>
    </div>
  );
}

export default function Entrenador({ param, query }) {
  const { t, lang, notify, confirm, changed, go, settings } = useApp();
  const { data: tr, error, reload } = useLoad(() => api.call("trainer_get", { id: param }), [param]);
  useCopilotRefresh(reload);
  const [tab, setTab] = useStored("silver-trainer-tab", "team");
  const nameInput = useRef(null);
  useEffect(() => { if (query?.get("builder") === "1") setTab("team"); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  const [dialog, setDialog] = useState("");
  const [busy, run] = useBusy();
  if (error && !tr) return <ErrorBox error={error} onRetry={reload} />;
  if (!tr) return <Spinner />;
  const duplicate = () => run("dup", async () => { const x = await api.call("trainer_duplicate", { id: tr.id }); changed(); go(`#/entrenador/${x.id}`); });
  const fav = () => run("fav", async () => { await api.call("trainer_update", { id: tr.id, favorite: !tr.favorite }); reload(); });
  const del = async () => {
    if (!(await confirm({ title: t("to_trash"), message: t("trainer_trash_msg", { name: loc(tr, lang) }), confirmLabel: t("to_trash") }))) return;
    run("del", async () => { await api.call("trash", { kind: "trainer", ids: [tr.id] }); notify(t("moved_to_trash")); changed(); go("#/entrenadores"); });
  };
  return (
    <div className="space-y-4">
      <div className="page-head">
        <div className="avatar-wrap">
          <button type="button" className="avatar-button" onClick={() => setDialog(tr.avatar_url ? "view" : "avatar")} title={tr.avatar_url ? t("avatar_view") : t("change_avatar")}
            aria-label={tr.avatar_url ? t("avatar_view") : t("change_avatar")}><Avatar url={tr.avatar_url} name={loc(tr, lang)} size={96} /></button>
          <button type="button" className="avatar-edit btn btn-sm btn-icon" onClick={() => setDialog("avatar")} title={t("change_avatar")} aria-label={t("change_avatar")}>
            <Icon d={ICONS.pencil} size={13} />
          </button>
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="trunc">{loc(tr, lang)}</h1>
            <button type="button" className="btn" onClick={() => { setTab("details"); nameInput.current?.focus(); nameInput.current?.select(); }}>
              <Icon d={ICONS.pencil} size={14} /> {t("edit_name")}
            </button>
          </div>
          <div className="help">{loc(tr, lang, "title")}</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <span className="chip">{originLabel(t, tr.origin)}</span>
            {tr.owner && <span className="chip">{t("by", { name: tr.owner })}</span>}
            <span className="chip">{tr.format}</span>
            <span className="chip">{t(`lvl_${tr.ai_level}`)} · {t(`style_${tr.ai_style}`)}</span>
            <RecordChip record={tr.record} />
          </div>
          {tr.avatar_credit && <div className="help mt-1"><a className="btn-link" href="#/creditos">{creditLabel(t, tr)}</a></div>}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary" onClick={() => setDialog("fight")}><Icon d={ICONS.play} size={14} /> {t("fight")}</button>
          <button type="button" className="btn" onClick={() => setDialog("export")}><Icon d={ICONS.send} size={14} /> {t("send_friend")}</button>
          <button type="button" className="btn" onClick={() => setDialog("poster")}><Icon d={ICONS.image} size={14} /> {t("poster_button")}</button>
          <Busy busy={busy.fav} className="btn btn-icon" onClick={fav} aria-label={t("favorite")}><Icon d={ICONS.star} size={15} fill={tr.favorite ? "currentColor" : undefined} /></Busy>
          <Busy busy={busy.dup} className="btn" onClick={duplicate}>{t("duplicate")}</Busy>
          <Busy busy={busy.del} className="btn btn-danger" onClick={del}><Icon d={ICONS.trash} size={14} /></Busy>
        </div>
      </div>
      {tr.badges?.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">{tr.badges.map((b) => <span key={b.id} className="badge-pill" title={`${b.gym_name}`}><GymBadge image={b.badge_image} color={b.badge_color} size={22} label={b.badge} /> {b.badge || b.gym_name}</span>)}</div>
      )}
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "team", label: t("tab_team") }, { id: "details", label: t("tab_details") }, { id: "lines", label: t("tab_lines") }, { id: "realtime", label: t("mode_realtime_short") }, { id: "battles", label: t("tab_battles") }]} />
      {tab === "team" && <TeamTab tr={tr} reload={reload} startVisual={query?.get("builder") === "1"} />}
      {tab === "details" && <DetailsTab tr={tr} reload={reload} nameInput={nameInput} />}
      {tab === "lines" && <LinesTab tr={tr} reload={reload} />}
      {tab === "realtime" && <CooldownsTab trainerId={tr.id} t={t} lang={lang} />}
      {tab === "battles" && (tr.battles?.length ? <div className="panel divide-list p-0">{tr.battles.map((b) => <BattleRow key={b.id} b={b} />)}</div> : <p className="help">{t("no_battles")}</p>)}
      {dialog === "avatar" && <AvatarDialog trainer={tr} onClose={() => setDialog("")} onSaved={() => { reload(); changed(); }} />}
      {dialog === "view" && <TrainerPictureViewer trainer={tr} onClose={() => setDialog("")} onChange={() => setDialog("avatar")} />}
      {dialog === "export" && <ExportDialog kind="trainer" id={tr.id} name={tr.name} onClose={() => setDialog("")} />}
      {dialog === "poster" && <TrainerPoster trainer={tr} onClose={() => setDialog("")} />}
      {dialog === "fight" && <FightDialog trainer={tr} onClose={() => setDialog("")} />}
    </div>
  );
}
