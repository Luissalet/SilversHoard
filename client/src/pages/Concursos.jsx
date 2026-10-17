import React, { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { useApp } from "../context.js";
import { Busy, ErrorBox, Field, Icon, ICONS, useBusy, useLoad } from "../components/ui.jsx";
import { MonIcon, TrainerSelect } from "../components/silver.jsx";
import LeisureArt from "../components/LeisureArt.jsx";
import { nameOf } from "../battle/dex.js";
import "./leisure.css";

const ARROWS = ["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft"];
function Direction({ direction }) {
  return <span style={{ display: "inline-flex", transform: `rotate(${direction * 90}deg)` }}><Icon d="M12 21V3M5 10l7-7 7 7" size={24} /></span>;
}

function Dance({ state, onSubmit, busy }) {
  const { t } = useApp();
  const [beat, setBeat] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [recorded, setRecorded] = useState([]);
  const clock = useRef(null);
  const hits = useRef(Array(8).fill(null));
  const tap = (direction) => {
    if (clock.current === null) return;
    const elapsed = performance.now() - clock.current;
    const slot = Math.floor(elapsed / 650);
    if (slot < 0 || slot > 7 || hits.current[slot]) return;
    hits.current[slot] = { direction, offset: Math.round(elapsed - slot * 650 - 325) };
    setRecorded([...hits.current]);
  };
  useEffect(() => {
    if (!playing) return undefined;
    const key = (e) => { const d = ARROWS.indexOf(e.key); if (d >= 0) { e.preventDefault(); tap(d); } };
    window.addEventListener("keydown", key);
    const timer = setInterval(() => {
      const b = Math.floor((performance.now() - clock.current) / 650);
      setBeat(Math.min(8, b));
      if (b >= 8) { setPlaying(false); clock.current = null; }
    }, 40);
    return () => { clearInterval(timer); window.removeEventListener("keydown", key); };
  }, [playing]);
  const start = () => { hits.current = Array(8).fill(null); setRecorded([]); setBeat(-1); clock.current = performance.now() + 650; setPlaying(true); };
  const submit = () => onSubmit({ steps: hits.current.map((h) => h?.direction ?? 0), timing: hits.current.map((h) => h?.offset ?? 2000) });
  return <div className="space-y-3">
    <p className="help">{t("contest_dance_help")}</p>
    <div className="contest-beats" role="list" aria-label={t("contest_dance")}>
      {state.dance.map((d, i) => <span key={i} role="listitem" aria-label={ARROWS[d]} aria-current={beat === i ? "step" : undefined} className={`${beat === i ? "is-current" : ""} ${recorded[i] ? "is-played" : ""}`}><Direction direction={d} /></span>)}
    </div>
    <div className="flex gap-2" role="group" aria-label={t("contest_dance")}>
      {ARROWS.map((key, i) => <button key={key} type="button" className="btn" disabled={!playing} aria-label={key} onClick={() => tap(i)}><Direction direction={i} /></button>)}
    </div>
    <p className="help" aria-live="polite">{t("contest_dance_done", { n: recorded.filter(Boolean).length })}</p>
    <div className="flex gap-2"><button type="button" className="btn" onClick={start} disabled={playing || busy}>{t("contest_dance_start")}</button>
      <Busy busy={busy} className="btn btn-primary" onClick={submit} disabled={beat < 8 || playing}>{t("contest_dance_send")}</Busy></div>
  </div>;
}

export default function Concursos() {
  const { t, lang } = useApp();
  const catalog = useLoad(() => api.call("leisure_catalog"), []);
  const history = useLoad(() => api.call("contests_list"), []);
  const [trainer, setTrainer] = useState("");
  const detail = useLoad(() => trainer ? api.call("trainer_get", { id: trainer }) : Promise.resolve(null), [trainer]);
  const [pokemon, setPokemon] = useState(0);
  const [category, setCategory] = useState("Cool");
  const [rank, setRank] = useState("normal");
  const [condition, setCondition] = useState(0);
  const [state, setState] = useState(null);
  const [accessories, setAccessories] = useState([]);
  const [move, setMove] = useState(0);
  const [judge, setJudge] = useState(0);
  const [busy, run] = useBusy();
  const [error, setError] = useState(null);
  const action = (key, fn) => run(key, async () => { setError(null); try { const s = await fn(); setState(s); history.reload(); } catch (e) { setError(e); } });
  const choose = (args) => action("choose", () => api.call("contest_choose", { id: state.id, revision: state.revision, ...args }));
  const start = () => action("start", () => api.call("contest_start", { trainer_id: trainer, pokemon, category, rank, condition: Number(condition) }));
  const team = detail.data?.id === trainer ? detail.data.team : [];
  return <div className="space-y-4">
    <div className="page-head"><div><h1>{t("nav_contests")}</h1><p className="help">{t("contest_help")}</p></div></div>
    {error && <ErrorBox error={error} />}{catalog.error && <ErrorBox error={catalog.error} onRetry={catalog.reload} />}
    {!state ? <div className="panel space-y-3">
      <TrainerSelect label={t("trainer")} value={trainer} onChange={(v) => { setTrainer(v); setPokemon(0); }} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Pokémon"><select className="field" value={pokemon} onChange={(e) => setPokemon(Number(e.target.value))}>{team.map((m, i) => <option key={i} value={i}>{m.name || m.species}</option>)}</select></Field>
        <Field label={t("contest_category")}><select className="field" value={category} onChange={(e) => setCategory(e.target.value)}>{catalog.data?.categories.map((c) => <option key={c} value={c}>{t(`category_${c}`)}</option>)}</select></Field>
        <Field label={t("contest_rank")}><select className="field" value={rank} onChange={(e) => setRank(e.target.value)}>{catalog.data?.ranks.map((r) => <option key={r} value={r}>{t(`rank_${r}`)}</option>)}</select></Field>
        <Field label={t("contest_condition")} hint={t("contest_condition_help")}><input className="field" type="number" min={0} max={255} value={condition} onChange={(e) => setCondition(e.target.value)} /></Field>
      </div><Busy busy={busy.start} className="btn btn-primary" disabled={!team.length} onClick={start}>{t("contest_start")}</Busy>
    </div> : <>
      <div className="flex flex-wrap gap-2">{["dress", "dance", "acting", "result"].map((p) => <span key={p} className={`chip ${state.phase === p ? "chip-accent" : ""}`} aria-current={state.phase === p ? "step" : undefined}>{t(`contest_${p}`)}</span>)}<span className="chip">{t(`category_${state.category}`)} · {t(`rank_${state.rank}`)}</span></div>
      <div className="contest-stage" aria-label={t(`contest_${state.phase}`)}>
        {state.entrants.map((e, i) => <div key={i} className={`contest-performer ${i === 0 ? "is-you" : ""}`}>
          <div className="contest-costume"><MonIcon species={e.species} size={96} />{i === 0 && <div className="contest-accessory-strip">{state.accessories.map((a) => <LeisureArt key={a} kind={a} size={22} />)}</div>}</div>
          <b>{e.species}</b><span className="help">{e.name}</span><span>{t("contest_score", { n: e.scores.reduce((a, b) => a + b, 0) })}</span>
        </div>)}
      </div>
      <div className="panel space-y-3">
        {state.phase === "dress" && <>
          <h2>{t("contest_theme", { theme: t(`theme_${state.theme}`) })}</h2><p className="help">{t("contest_dress_help")}</p>
          <div className="leisure-palette" role="group" aria-label={t("contest_accessories")}>{catalog.data?.accessories.map((a) => <button type="button" key={a.id} className={`btn ${accessories.includes(a.id) ? "is-on" : ""}`} aria-pressed={accessories.includes(a.id)} disabled={accessories.length >= 3 && !accessories.includes(a.id)} onClick={() => setAccessories((p) => p.includes(a.id) ? p.filter((x) => x !== a.id) : [...p, a.id])}>
            <LeisureArt kind={a.id} /><span>{t(`decor_${a.id}`)}<span className="help block">{t(`category_${a.category}`)} · {t(`theme_${a.theme}`)}</span></span></button>)}</div>
          <Busy busy={busy.choose} className="btn btn-primary" onClick={() => choose({ accessories })}>{t("contest_next")}</Busy>
        </>}
        {state.phase === "dance" && <Dance key={state.id} state={state} busy={busy.choose} onSubmit={choose} />}
        {state.phase === "acting" && <>
          <h2>{t("contest_round", { n: state.round + 1 })}</h2><p className="help">{t("contest_appeal_help")}</p>
          <Field label={t("contest_move")}><select className="field" value={move} onChange={(e) => setMove(Number(e.target.value))}>{state.entrants[0].moves.map((m, i) => <option key={i} value={i}>{nameOf("move", m.name, lang)} · {t(`category_${m.category}`)}</option>)}</select></Field>
          <div className="flex flex-wrap gap-2" role="group" aria-label={t("contest_acting")}>{state.voltage.map((v, i) => <button type="button" className="btn" key={i} aria-pressed={judge === i} onClick={() => setJudge(i)}>{t("contest_judge", { n: i + 1, v })}</button>)}</div>
          <Busy busy={busy.choose} className="btn btn-primary" onClick={() => choose({ move, judge })}>{t("contest_appeal")}</Busy>
          {state.events.filter((e) => e.phase === "acting" && e.round === state.round - 1).map((e) => <p key={e.entrant} className="help">{t("contest_event", { name: state.entrants[e.entrant].species, move: nameOf("move", e.move, lang), judge: e.judge + 1, points: e.points })}</p>)}
        </>}
        {state.phase === "result" && <><h2>{t("contest_place", { n: state.place })}{state.ribbon ? ` · ${t("contest_ribbon")}` : ""}</h2>
          <div className="leisure-score-table"><table><thead><tr><th>Pokémon</th>{["dress", "dance", "acting"].map((p) => <th key={p}>{t(`contest_${p}`)}</th>)}</tr></thead><tbody>{state.entrants.map((e, i) => <tr key={i}><th>{e.species}</th>{e.scores.map((s, j) => <td key={j}>{s}</td>)}</tr>)}</tbody></table></div>
          <button type="button" className="btn" onClick={() => { setState(null); setAccessories([]); }}>{t("contest_start")}</button></>}
      </div>
    </>}
    <p className="help">{t("contest_rules")}</p>
    {!!history.data?.contests.length && <section className="space-y-2"><h2>{t("contest_history")}</h2><div className="panel divide-list p-0">{history.data.contests.map((c) => <button key={c.id} type="button" className="row-item w-full" onClick={() => action("load", () => api.call("contest_get", { id: c.id }))}>
      <MonIcon species={c.entrants[0].species} size={40} /><b>{c.entrants[0].species}</b><span>{t(`category_${c.category}`)}</span><span className="help">{c.status === "done" ? t("contest_place", { n: c.place }) : t(`contest_${c.phase}`)}</span>{c.ribbon && <Icon d={ICONS.star} />}</button>)}</div></section>}
  </div>;
}
