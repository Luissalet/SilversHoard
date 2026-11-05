import React, { useRef, useState } from "react";
import { api } from "../api.js";
import { useApp } from "../context.js";
import { nameOf, typeName } from "../battle/dex.js";
import { usePoll } from "./hooks.js";
import { Busy, ErrorBox, Field, useBusy } from "./ui.jsx";
import TeamBuilder from "./TeamBuilder.jsx";

export default function RivalScout({ battle }) {
  const { t, lang, changed, go, notify } = useApp();
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState(battle.p2?.human && !battle.p1?.human ? "p1" : "p2");
  const [size, setSize] = useState(0);
  const [job, setJob] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(true);
  const [draft, setDraft] = useState(null);
  const [extra, setExtra] = useState([]);
  const [past, setPast] = useState([]);
  const [offset, setOffset] = useState(0);
  const [more, setMore] = useState(true);
  const [busy, run] = useBusy();
  const current = useRef(null);
  const epoch = useRef(0);
  const result = job?.status === "done" ? job.result : null;
  const running = job && ["queued", "running"].includes(job.status);
  const pair = battle.p1?.trainer_id && battle.p2?.trainer_id && battle.p1.trainer_id !== battle.p2.trainer_id;
  const act = (key, fn) => run(key, async () => { setError(null); try { await fn(); } catch (e) { setError(e); } });
  const close = () => { epoch.current++; current.current = null; setOpen(false); if (running) api.call("job_cancel", { id: job.id }).catch(setError); };
  const show = () => { setOpen(true); setJob(null); setDraft(null); setEditing(true); setError(null); };
  usePoll(async () => {
    const id = current.current;
    if (!id) return;
    try { const next = await api.call("job_get", { id }); if (current.current === id) setJob(next); }
    catch (e) { if (current.current === id) setError(e); }
  }, 600, open && !!running);
  const start = () => act("start", async () => {
    const token = epoch.current;
    const next = await api.call("rival_scout", { id: battle.id, rival_side: side, size, encounters: extra });
    if (token !== epoch.current) { await api.call("job_cancel", { id: next.id }); return; }
    current.current = next.id; setJob(next);
  });
  const loadPast = () => act("past", async () => {
    const r = await api.call("battles_list", { status: "ended", limit: 30, offset });
    setPast(x => [...x, ...r.battles.filter(b => b.id !== battle.id)]);
    setOffset(offset + r.battles.length); setMore(r.battles.length === 30);
  });
  const useDraft = (team) => act("validate", async () => {
    const v = await api.call("team_validate", { team, format: result.format, rules: result.rules, level_rules: result.level_rules });
    if (!v.ok) throw new Error((v.problems || []).join("\n"));
    setDraft(team); setEditing(false);
  });
  const save = async () => {
    const v = await api.call("team_validate", { team: draft, format: result.format, rules: result.rules, level_rules: result.level_rules });
    if (!v.ok) throw new Error((v.problems || []).join("\n"));
    if (result.rival_id) { await api.call("trainer_update", { id: result.rival_id, team: draft }); changed(); }
  };
  const rematch = () => act("rematch", async () => {
    await save();
    const seats = { ...result.rematch_seats };
    if (!result.rival_id) seats[side] = { ...seats[side], team: draft };
    const next = await api.call("battle_start", { ...seats, format: result.format, rules: result.rules, level_rules: result.level_rules,
      mode: battle.mode || "classic", time_limit: battle.rt?.time_limit || 0, rt_arena: battle.rt?.arena || "rocks",
      ...(battle.rt?.spec && "silver_special" in battle.rt.spec ? { silver_special: battle.rt.spec.silver_special } : {}) });
    changed(); go(`#/combate/${next.id}`);
  });
  if (battle.status !== "ended" || battle.run || battle.cup || ["friend", "pvp"].includes(battle.kind)) return null;
  return <section className="space-y-3" aria-label={t("scout_title")}>
    {!open ? <button type="button" className="btn" onClick={show}>{t("scout_title")}</button> : <>
      <div className="flex flex-wrap items-center justify-between gap-2"><h2>{t("scout_title")}</h2>
        <button type="button" className="btn" onClick={close}>{running ? t("scout_cancel_job") : t("cancel")}</button></div>
      <p className="help">{t("scout_help")}</p>
      <ErrorBox error={error} />
      {!job && <>
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t("scout_rival")} className="min-w-0 flex-1"><select value={side} onChange={e => setSide(e.target.value)}>
            {["p1", "p2"].map(s => <option key={s} value={s}>{s} · {battle[s]?.name}</option>)}</select></Field>
          <Field label={t("scout_size")} className="w-44"><input type="number" min="0" max="6" value={size} onChange={e => setSize(Number(e.target.value))} /></Field>
          <Busy busy={busy.start} className="btn btn-primary" onClick={start}>{t("scout_propose")}</Busy>
        </div>
        <p className="help">{t(pair ? "scout_pair" : "scout_direct")}</p>
        {!pair && <details><summary>{t("scout_more_encounters")}</summary><div className="space-y-2 mt-2">
          <p className="help">{t("scout_choose_side")}</p>
          {past.map(b => <Field key={b.id} label={`${b.p1?.name || "p1"} / ${b.p2?.name || "p2"} · ${b.format} · ${b.id}`}>
            <select value={extra.find(e => e.id === b.id)?.rival_side || ""} onChange={e => setExtra(x => [...x.filter(v => v.id !== b.id), ...(e.target.value ? [{ id: b.id, rival_side: e.target.value }] : [])])}>
              <option value="">{t("scout_skip")}</option>{["p1", "p2"].map(s => <option key={s} value={s}>{s} · {b[s]?.name}</option>)}
            </select></Field>)}
          {more && <Busy busy={busy.past} className="btn" onClick={loadPast}>{t("scout_load_encounters")}</Busy>}
        </div></details>}
      </>}
      {running && <div role="status" className="help">{t("scout_working")} · {Math.round((job.progress || 0) * 100)} %</div>}
      {job && ["failed", "cancelled"].includes(job.status) && <div role="alert" className="help">{job.error || t("status_cancelled")}</div>}
      {result && <>
        <h3>{t("scout_observed")}</h3>
        <p>{result.species.map(n => nameOf("species", n, lang)).join(" · ") || t("scout_none")}</p>
        <p className="help">{t("scout_partial")}</p>
        <ul className="space-y-1">{result.encounters.map(e => <li key={e.id} className="help">
          <a href={`#/combate/${e.id}`}>{e.id}</a> · {e.observed_side} · {e.species.map(n => nameOf("species", n, lang)).join(", ") || t("scout_none")}
        </li>)}</ul>
        {result.status !== "ready" ? <p role="status" className="help">{t(`scout_${result.reason}`)} {(result.problems || []).join(" · ")}</p> : <>
          <h3>{t("scout_proposal")}</h3>
          <p className="help">{t("scout_limits")} · {result.usage_format}</p>
          <ul className="space-y-2">{result.choices.map(c => <li key={c.species}>
            <b>{nameOf("species", c.species, lang)}</b><span className="help"> · {c.coverage.length
              ? c.coverage.map(x => `${typeName(x.move_type, lang)} ×${x.multiplier}: ${nameOf("species", x.species, lang)}`).join("; ") : t("scout_neutral")}
              {c.resists.length ? ` · ${t("scout_resists")}: ${c.resists.map(n => nameOf("species", n, lang)).join(", ")}` : ""}
              {` · ${c.source.source_format} / ${c.source.set_name}`}</span>
          </li>)}</ul>
          {editing ? <TeamBuilder team={draft || result.team} format={result.format} saveLabel={t("scout_use_draft")} onSave={useDraft} onCancel={close} /> : <>
            <p>{draft.map(m => nameOf("species", m.species, lang)).join(" · ")}</p>
            <p className="help">{t(result.rival_id ? "scout_save_help" : "scout_direct_save")}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn" disabled={busy.rematch || busy.save} onClick={() => setEditing(true)}>{t("scout_edit")}</button>
              {result.rival_id && <Busy busy={busy.save} className="btn" disabled={busy.rematch} onClick={() => act("save", async () => { await save(); notify(t("scout_saved")); })}>{t("scout_save")}</Busy>}
              <Busy busy={busy.rematch} disabled={busy.save} className="btn btn-primary" onClick={rematch}>{t(result.rival_id ? "scout_save_fight" : "scout_fight")}</Busy>
            </div>
          </>}
        </>}
      </>}
    </>}
  </section>;
}
