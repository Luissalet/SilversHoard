import React, { useState } from "react";
import { api } from "../api.js";
import { useApp } from "../context.js";
import { Busy, ErrorBox, Field, useBusy, useLoad } from "./ui.jsx";
import { nameOf } from "../battle/dex.js";

export function PracticeSuggestions({battle, side}) {
  const {t, lang, go, changed} = useApp();
  const [result, setResult] = useState(null);
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);
  const [busy, run] = useBusy();
  const analyse = () => run("analyse", async()=>{
    setError(null);
    try {
      const r = await api.call("practice_suggestions",{id:battle.id, side, start_turn:result?.next_turn || 1});
      setResult(r); setItems(old=>[...old,...r.suggestions].sort((a,b)=>b.heuristic_gap-a.heuristic_gap));
    } catch(e) { setError(e); }
  });
  const label = o => {
    if (o.kind === "switch") return t("suggest_switch_to",{name:o.name});
    const move = nameOf("move",o.name,lang);
    return `${move}${o.gimmick?` · ${t(`suggest_${o.gimmick}`)}`:""}${o.target?` → ${o.target}`:""}`;
  };
  return <div className="space-y-3 border-t border-line pt-4">
    <h3>{t("suggest_title")}</h3><p className="help max-w-prose">{t("suggest_help")}</p>
    {(!result || result.next_turn) && <Busy busy={busy.analyse} onClick={analyse}>{t(result?"suggest_more":"suggest_analyse")}</Busy>}
    <ErrorBox error={error}/>
    {result && <p className="help" role="status">{t("suggest_range",{from:result.start_turn,to:result.end_turn,n:result.analysed,skipped:result.skipped})} {!result.next_turn && t("suggest_finished")}</p>}
    {result && !items.length && <p className="help">{t("suggest_empty")}</p>}
    {items.map(item=><article key={item.id} className="space-y-3 py-3 border-b border-line">
      <h4>{t("training_position",{n:item.turn,side:item.side.toUpperCase()})} · {item.slots.map(s=>s.mon).join(" / ")}</h4>
      <dl className="grid gap-2 sm:grid-cols-2"><div><dt className="help">{t("suggest_played")}</dt><dd>{item.slots.map(s=>label(s.actual)).join(" + ")}</dd></div><div><dt className="help">{t("suggest_alternative")}</dt><dd>{item.slots.map(s=>label(s.recommended)).join(" + ")}</dd></div></dl>
      <p className="help">{t(`suggest_reason_${item.reason}`)} {t("suggest_gap",{n:item.heuristic_gap})}</p>
      <div className="flex flex-wrap gap-2"><Busy busy={busy[item.id]} onClick={()=>run(item.id,async()=>{const b=await api.call("battle_practice",{id:battle.id,turn:item.turn,side});changed();go(`#/combate/${b.id}`);})}>{t("practice_start")}</Busy><button className="btn" onClick={()=>setItems(old=>old.filter(s=>s.id !== item.id))}>{t("suggest_discard")}</button></div>
      <SaveExercise battle={battle} turn={item.turn} side={side}/>
    </article>)}
  </div>;
}

function goalText(t, e) {
  return e.goal === "survive" ? t("training_survival", {n:e.target_turns}) : e.target_turns ? t("training_within", {n:e.target_turns}) : `${t("training_win")} · ${t("training_untimed")}`;
}

export function SaveExercise({ battle, turn, side }) {
  const {t, changed} = useApp();
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("win");
  const [turns, setTurns] = useState(0);
  const [saved, setSaved] = useState(null);
  const [busy, run] = useBusy();
  return <details className="space-y-3">
    <summary className="btn-link">{t("training_save")}</summary>
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label={t("training_name")}><input className="field" value={name} maxLength={200} onChange={e=>setName(e.target.value)} /></Field>
      <Field label={t("training_goal")}><select className="field" value={goal} onChange={e=>{setGoal(e.target.value);if(e.target.value === "survive" && !turns)setTurns(3);}}><option value="win">{t("training_win")}</option><option value="survive">{t("training_survive")}</option></select></Field>
      <Field label={t("training_turns")} hint={t("training_turns_help")}><input className="field" type="number" min={goal === "survive" ? 1 : 0} max={1000} value={turns} onChange={e=>setTurns(Number(e.target.value))} /></Field>
    </div>
    <Busy busy={busy.save} disabled={goal === "survive" && turns < 1} onClick={()=>run("save",async()=>{setSaved(await api.call("exercise_create",{battle_id:battle.id,turn,side,title:name,goal,target_turns:turns}));changed();})}>{t("training_save")}</Busy>
    {saved && <p className="help" role="status">{t("training_saved")} <a className="btn-link" href="#/compartir">{t("training_open")}</a></p>}
  </details>;
}

function ExerciseItem({ exercise:e, selected, onSelect }) {
  const {t, changed, go} = useApp();
  const [adaptive, setAdaptive] = useState(true);
  const [level, setLevel] = useState("normal");
  const [share, setShare] = useState(null);
  const [busy, run] = useBusy();
  return <article className="space-y-3 py-4 border-b border-line last:border-b-0">
    <label className="flex gap-2 items-center"><input type="checkbox" checked={selected} onChange={v=>onSelect(e.id,v.target.checked)} />{t("pack_include",{name:e.title})}</label>
    <div><h3>{e.title}</h3><p className="help">{goalText(t,e)} · {t("training_position",{n:e.turn,side:e.side.toUpperCase()})} · {e.format}</p></div>
    {e.pack && <p className="help">{t("pack_member",{name:e.pack.title,theme:t(`pack_${e.pack.theme}`),index:e.pack.index,total:e.pack.total})}</p>}
    <label className="flex gap-2 items-center"><input type="checkbox" checked={adaptive} onChange={v=>setAdaptive(v.target.checked)} />{t("training_adaptive")}</label>
    {adaptive ? <p className="help max-w-prose">{t("training_recommendation",{level:t(`lvl_${e.recommendation.level}`),passed:e.recommendation.passed,n:e.recommendation.samples})}</p> : <Field label={t("training_manual")} className="max-w-xs"><select className="field" value={level} onChange={v=>setLevel(v.target.value)}>{["random","easy","normal","hard","expert","master"].map(l=><option key={l} value={l}>{t(`lvl_${l}`)}</option>)}</select></Field>}
    <div className="flex flex-wrap gap-2">
      {!e.archived && <Busy busy={busy.start} className="btn btn-primary" onClick={()=>run("start",async()=>{const b=await api.call("exercise_start",{id:e.id,adaptive,ai_level:level});changed();go(`#/combate/${b.id}`);})}>{t("training_start")}</Busy>}
      <Busy busy={busy.export} onClick={()=>run("export",async()=>setShare(await api.call("exercise_export",{id:e.id})))}>{t("training_export")}</Busy>
      <Busy busy={busy.archive} onClick={()=>run("archive",async()=>{await api.call("exercise_archive",{id:e.id,archived:!e.archived});changed();})}>{t(e.archived?"training_restore":"training_archive")}</Busy>
    </div>
    {share && <div className="space-y-2"><Field label={t("training_share")}><textarea className="field font-mono" rows={4} readOnly value={share.code} onFocus={v=>v.target.select()} /></Field><a className="btn-link" href={share.url} download={share.file}>{t("training_file")}</a></div>}
    {!!e.attempts.length && <details><summary className="btn-link">{t("training_attempts")} ({e.attempts.length})</summary><ol className="space-y-2 mt-2">{e.attempts.map(a=><li key={a.id}><a className="btn-link" href={`#/combate/${a.id}`}>{t(a.passed?"training_passed":a.status === "ended"?"training_failed":"training_pending")}</a> · {t(`lvl_${a.ai_level}`)}</li>)}</ol></details>}
  </article>;
}

export function ExerciseLibrary() {
  const {t, version} = useApp();
  const [archived, setArchived] = useState(false);
  const [selected, setSelected] = useState([]);
  const [title, setTitle] = useState("");
  const [theme, setTheme] = useState("openings");
  const [share, setShare] = useState(null);
  const [busy, run] = useBusy();
  const {data,error,loading,reload} = useLoad(()=>api.call("exercises_list",{archived}),[version,archived]);
  const ids = selected.filter(id=>data?.exercises?.some(e=>e.id === id));
  const select = (id,checked) => setSelected(old=>checked ? [...old,id] : old.filter(value=>value !== id));
  return <section className="panel space-y-3" aria-label={t("training_title")}>
    <h2>{t("training_title")}</h2><p className="help max-w-prose">{t("training_help")}</p>
    <label className="flex gap-2 items-center"><input type="checkbox" checked={archived} onChange={e=>{setArchived(e.target.checked);setSelected([]);}} />{t("training_archived")}</label>
    <ErrorBox error={error} onRetry={reload}/>
    {loading && <p className="help" role="status">{t("loading")}</p>}
    {!loading && !error && !data?.exercises?.length && <p className="help">{t("training_empty")}</p>}
    {!!data?.exercises?.length && <div className="space-y-3 border-y border-line py-4">
      <h3>{t("pack_title")}</h3><p className="help max-w-prose">{t("pack_help")}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("pack_name")}><input className="field" value={title} maxLength={200} onChange={e=>setTitle(e.target.value)}/></Field>
        <Field label={t("pack_theme")}><select className="field" value={theme} onChange={e=>setTheme(e.target.value)}>{["attrition","openings","doubles"].map(value=><option key={value} value={value}>{t(`pack_${value}`)}</option>)}</select></Field>
      </div>
      <p className="help" role="status">{t("pack_selected",{n:ids.length})}</p>
      <div className="flex flex-wrap gap-2"><Busy busy={busy.pack} disabled={!ids.length || loading} onClick={()=>run("pack",async()=>setShare(await api.call("exercise_pack_export",{ids,title,theme})))}>{t("pack_export")}</Busy><button className="btn" disabled={!ids.length} onClick={()=>setSelected([])}>{t("pack_clear")}</button></div>
      {share && <div className="space-y-2"><Field label={t("pack_code")}><textarea className="field font-mono" rows={4} readOnly value={share.code} onFocus={e=>e.target.select()}/></Field><a className="btn-link" href={share.url} download={share.file}>{t("pack_file")}</a></div>}
    </div>}
    {data?.exercises?.map(e=><ExerciseItem key={e.id} exercise={e} selected={ids.includes(e.id)} onSelect={select}/>)}
  </section>;
}

export function ExerciseProgress({battle}) {
  const {t} = useApp();
  const {data,error,reload} = useLoad(()=>api.call("exercise_get",{id:battle.practice.exercise_id}),[battle.id,battle.turn,battle.turns,battle.status]);
  const attempt = data?.attempts?.find(a=>a.id === battle.id);
  return <div className="space-y-2">
    <p>{battle.practice.title}</p><p className="help">{goalText(t,battle.practice)}</p>
    <p role="status">{attempt && t(attempt.passed?"training_passed":attempt.status === "ended"?"training_failed":"training_pending")}</p>
    <p className="help max-w-prose">{t("training_no_original")}</p>
    <ErrorBox error={error} onRetry={reload}/><a className="btn-link" href="#/compartir">{t("training_open")}</a>
  </div>;
}
