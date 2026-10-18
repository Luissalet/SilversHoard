import React, {useEffect, useRef, useState} from "react";
import {api} from "../api.js";
import {useApp} from "../context.js";
import {Busy, ErrorBox, Field} from "../components/ui.jsx";
import {TYPE_COLORS, typeName} from "../battle/dex.js";
import "../type-challenge.css";

const factor = n => `${n}×`;

export default function TypeChallenge() {
  const {t, lang} = useApp();
  const [gen, setGen] = useState("9"), [mode, setMode] = useState("dual"), [seed, setSeed] = useState("");
  const [deck, setDeck] = useState(null), [answers, setAnswers] = useState([]), [score, setScore] = useState(null);
  const [index, setIndex] = useState(0), [finished, setFinished] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(null), [pending, setPending] = useState(null);
  const gate = useRef(false), mounted = useRef(true), questionTitle = useRef(null), lastStart = useRef(null);
  useEffect(() => {mounted.current = true;return () => {mounted.current = false;};}, []);
  useEffect(() => {if (deck) questionTitle.current?.focus();}, [deck, index, finished]);
  const active = !!deck && !finished, question = deck?.questions[index], feedback = score?.feedback[index];
  async function start(spec = null) {
    if (gate.current) return;
    gate.current = true;setBusy(true);setError(null);setPending(null);
    try {
      const request = spec || {gen: Number(gen), mode, seed: seed.trim() || crypto.randomUUID()};
      lastStart.current = request;
      const next = await api.call("type_challenge", request);
      if (!mounted.current) return;
      setDeck(next);setGen(String(next.spec.gen));setMode(next.spec.mode);setAnswers([]);setScore(null);setIndex(0);setFinished(false);
    } catch (e) {if (mounted.current) setError(e);}
    finally {gate.current = false;if (mounted.current) setBusy(false);}
  }
  async function answer(type) {
    if (gate.current || feedback) return;
    gate.current = true;setBusy(true);setError(null);setPending(type);
    const nextAnswers = [...answers, type];
    try {
      const result = await api.call("type_challenge_score", {...deck.spec, answers: nextAnswers});
      if (!mounted.current) return;
      setAnswers(nextAnswers);setScore(result);setPending(null);
    } catch (e) {if (mounted.current) setError(e);}
    finally {gate.current = false;if (mounted.current) setBusy(false);}
  }
  const typeLabel = type => typeName(type, lang);
  const formula = choice => <span className="tc-formula"><b>{typeLabel(choice.type)}</b>: {choice.factors.map(f => `${typeLabel(f.type)} ${factor(f.multiplier)}`).join(" · ")} → <strong>{factor(choice.multiplier)}</strong></span>;
  return <section className="panel type-challenge" aria-labelledby="type-challenge-title">
    <header><h2 id="type-challenge-title">{t("tc_title")}</h2><p className="help">{t("tc_intro")}</p></header>
    <p className="help tc-scope">{t("tc_scope")}</p>
    {!active && <form className="tc-config" onSubmit={e => {e.preventDefault();start();}}>
      <Field label={t("tc_gen")}><select value={gen} disabled={busy} onChange={e => setGen(e.target.value)}>{Array.from({length: 9}, (_, i) => <option key={i + 1}>{i + 1}</option>)}</select></Field>
      <Field label={t("tc_mode")}><select value={mode} disabled={busy} onChange={e => setMode(e.target.value)}><option value="single">{t("tc_single")}</option><option value="dual">{t("tc_dual")}</option></select></Field>
      <Field label={t("tc_seed")}><input maxLength={100} value={seed} disabled={busy} placeholder={t("tc_random")} onChange={e => setSeed(e.target.value)} /></Field>
      <Busy busy={busy} onClick={() => start()} className="btn btn-primary">{t(finished ? "tc_new" : "tc_start")}</Busy>
    </form>}
    <ErrorBox error={error} onRetry={() => pending ? answer(pending) : start(lastStart.current)} />
    {active && <>
      <p className="help tc-settings">{t("tc_settings", {gen: deck.spec.gen, mode: t(deck.spec.mode === "dual" ? "tc_dual" : "tc_single")})}</p>
      <div className="tc-scoreline"><span>{t("tc_round", {n: index + 1})}</span><span>{t("tc_streak", {n: score?.streak || 0})}</span></div>
      <progress aria-label={t("tc_progress")} value={answers.length} max={10} />
      <h3 className="tc-question" tabIndex={-1} ref={questionTitle}>{t("tc_question", {name: question.species})}</h3>
      <p className="tc-defence">{question.types.map(type => <span key={type}><i aria-hidden="true" style={{background: TYPE_COLORS[type]}} />{typeLabel(type)}</span>)}</p>
      <div className="tc-options" role="group" aria-label={t("tc_options")}>
        {question.options.map(type => <button type="button" key={type} disabled={busy || !!feedback}
          className={`btn tc-option ${feedback?.best.type === type ? "tc-correct" : feedback?.chosen.type === type ? "tc-mistake" : ""}`}
          aria-pressed={feedback ? feedback.chosen.type === type : undefined} onClick={() => answer(type)}>
          <i aria-hidden="true" style={{background: TYPE_COLORS[type]}} />{typeLabel(type)}
          {feedback && (feedback.best.type === type || feedback.chosen.type === type) && <strong>{factor(feedback.best.type === type ? feedback.best.multiplier : feedback.chosen.multiplier)}</strong>}
        </button>)}
      </div>
      {feedback && <div className="tc-feedback" role="status">
        <h4>{t(feedback.correct ? "tc_right" : "tc_wrong")}</h4>
        <p>{t("tc_yours")}: {formula(feedback.chosen)}</p>
        {!feedback.correct && <p>{t("tc_best")}: {formula(feedback.best)}</p>}
      </div>}
      <div className="tc-actions">
        {feedback && <button type="button" className="btn btn-primary" onClick={() => index === 9 ? setFinished(true) : setIndex(index + 1)}>{t(index === 9 ? "tc_finish" : "tc_next")}</button>}
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => {setDeck(null);setAnswers([]);setScore(null);setError(null);}}>{t("tc_leave")}</button>
      </div>
    </>}
    {finished && score && <div className="tc-result">
      <h3 className="tc-question" tabIndex={-1} ref={questionTitle}>{t("tc_score", {n: score.correct})}</h3><p>{t("tc_record", {n: score.best_streak})} · {t("tc_settings", {gen: deck.spec.gen, mode: t(deck.spec.mode === "dual" ? "tc_dual" : "tc_single")})}</p>
      {score.feedback.some(f => !f.correct) ? <><h4>{t("tc_review")}</h4><ol>{score.feedback.filter(f => !f.correct).map(f => <li key={f.round} value={f.round}><b>{f.species}</b><p>{t("tc_yours")}: {formula(f.chosen)}</p><p>{t("tc_best")}: {formula(f.best)}</p></li>)}</ol></> : <p>{t("tc_perfect")}</p>}
      <button type="button" className="btn" disabled={busy} onClick={() => start(deck.spec)}>{t("tc_repeat")}</button>
      <details><summary>{t("tc_seed_used")}</summary><code>{deck.spec.seed}</code></details>
    </div>}
    <p className="help tc-session">{t("tc_session")}</p>
  </section>;
}
