// The page a friend opens: the gym (or trainer) inside it, a team of their own, and the battles, all in the browser with the same
// engine and AI as the app. At the end it gives a result code to send back.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applyLevelRules, buildFormatId, exportTeam, importTeam, randomTeam, teamSummary, validateTeam, formatInfo } from "../../../engine/src/core.mjs";
import { Match, viewLines } from "../../../engine/src/match.mjs";
import Arena from "../battle/Arena.jsx";
import Controls from "../battle/Controls.jsx";
import { makeSprites, TYPE_COLORS, typeName } from "../battle/dex.js";
import { useBattlePlayer } from "../battle/player.js";
import { playT } from "./strings.js";

const RESULT_PREFIX = "SILVERWIN1-";

async function deflateB64(text) {
  const bytes = new TextEncoder().encode(text);
  if (typeof CompressionStream === "undefined") throw new Error("CompressionStream unavailable");
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"));
  const buf = new Uint8Array(await new Response(stream).arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function avatarSrc(sprites, avatar) {
  return sprites.trainer(avatar);
}

function Badge({ color = "#c0c0c0", size = 64 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" className="gym-badge">
      <path d="M20 2l15 8.7v18.6L20 38 5 29.3V10.7z" fill={color} stroke="#0008" strokeWidth="1.5" />
      <path d="M20 9l8.5 4.9v9.8L20 28.6l-8.5-4.9v-9.8z" fill="#fff4" stroke="#fff8" strokeWidth="1" />
    </svg>
  );
}

function TeamIcons({ sets, sprites }) {
  return (
    <div className="p-team">
      {sets.map((s, i) => <img key={i} src={sprites.pokemon(s.species)} alt={s.species} title={s.species} className={sprites.pixelated ? "pixelated" : ""}
        onError={(e) => { if (!e.currentTarget.dataset.fb) { e.currentTarget.dataset.fb = "1"; e.currentTarget.src = sprites.fallback(s.species); } }} />)}
    </div>
  );
}

export default function PlayApp({ data }) {
  const [lang, setLang] = useState(() => (typeof navigator !== "undefined" && !String(navigator.language || "es").startsWith("es") ? "en" : "es"));
  const t = playT(lang);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  if (!data || !data.payload) return <div className="p-wrap"><div className="panel">{t("no_data")}</div></div>;
  return <Challenge data={data} lang={lang} setLang={setLang} t={t} />;
}

function Challenge({ data, lang, setLang, t }) {
  const kind = data.kind;
  const target = kind === "gym" ? data.payload.gym : data.payload.trainer;
  const sprites = useMemo(() => makeSprites({ server: data.sprite_server || "https://play.pokemonshowdown.com/sprites", set: data.sprite_set || "gen5ani" }), [data]);
  const stages = useMemo(() => (kind === "gym" ? [...(target.trainers || []), target.leader] : [target]), [kind, target]);
  const format = target.format || (kind === "gym" ? target.leader.format : "gen9customgame");
  const rules = target.rules || [];
  const levelRules = target.level_rules || {};
  const [name, setName] = useState(() => { try { return localStorage.getItem("silver-play-name") || ""; } catch { return ""; } });
  const [tab, setTab] = useState("paste");
  const [paste, setPaste] = useState("");
  const [sets, setSets] = useState(null);
  const [problems, setProblems] = useState([]);
  const [phase, setPhase] = useState("setup");
  const [stage, setStage] = useState(0);
  const [results, setResults] = useState([]);
  const [code, setCode] = useState({ short: "", full: "" });
  const [copied, setCopied] = useState(false);
  const fid = useMemo(() => { try { return buildFormatId(format, rules); } catch { return "gen9customgame"; } }, [format, rules]);
  const info = useMemo(() => { try { return formatInfo(fid); } catch { return { gen: 9, name: fid }; } }, [fid]);
  const owner = data.from || data.payload.owner || target.owner || "";

  const check = (list) => {
    try {
      const prepared = applyLevelRules(importTeam(list), levelRules);
      const v = validateTeam(fid, prepared);
      setProblems(v.ok ? [] : v.problems);
      setSets(v.ok ? importTeam(list) : null);
      return v.ok;
    } catch (e) {
      setProblems([e.message]);
      setSets(null);
      return false;
    }
  };
  const roll = () => {
    const r = randomTeam(`gen${info.gen || 9}randombattle`, String(Date.now()));
    setPaste(exportTeam(r.sets));
    check(r.sets);
  };
  const loadFile = async (file) => {
    if (!file) return;
    try {
      const obj = JSON.parse(await file.text());
      const tr = obj.trainer || obj;
      if (tr.name && !name) setName(tr.name);
      setPaste(exportTeam(importTeam(tr.team || tr.sets || obj)));
      check(tr.team || tr.sets || obj);
    } catch (e) {
      setProblems([e.message]);
    }
  };

  const start = () => {
    if (!sets || !name.trim()) return;
    try { localStorage.setItem("silver-play-name", name.trim()); } catch { /* not critical */ }
    setResults([]);
    setStage(0);
    setPhase("battle");
  };

  const onBattleEnd = useCallback((res) => {
    setResults((r) => {
      const next = [...r, res];
      if (!res.won || stage + 1 >= stages.length) setPhase("done");
      else setPhase("between");
      return next;
    });
  }, [stage, stages.length]);

  useEffect(() => {
    if (phase !== "done") return;
    const won = results.length === stages.length && results.every((r) => r.won);
    const base = {
      kind, gym_id: kind === "gym" ? target.source_id : "", gym_name: kind === "gym" ? target.name : "", trainer_id: kind === "trainer" ? target.source_id : "",
      trainer_name: kind === "trainer" ? target.name : "", challenger: name.trim(), won, turns: results.reduce((a, r) => a + r.turns, 0),
      date: new Date().toISOString(), team: sets, team_paste: sets ? exportTeam(sets) : "", stages: results.map((r) => ({ name: r.opponent, won: r.won, turns: r.turns })),
    };
    (async () => {
      try {
        const short = RESULT_PREFIX + await deflateB64(JSON.stringify(base));
        const full = RESULT_PREFIX + await deflateB64(JSON.stringify({ ...base, log: results.flatMap((r) => r.lines) }));
        setCode({ short, full });
      } catch {
        setCode({ short: "", full: "" });
      }
    })();
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const header = (
    <header className="p-head">
      <div className="p-target">
        {kind === "gym" ? <Badge color={target.badge_color || TYPE_COLORS[target.type] || "#c0c0c0"} size={56} /> : null}
        <div className="min-w-0">
          <h1>{target.name}</h1>
          <div className="help">{[kind === "gym" ? target.city : target.title, kind === "gym" ? target.badge : "", owner ? t("from", { name: owner }) : ""].filter(Boolean).join(" · ")}</div>
        </div>
      </div>
      <button type="button" className="btn btn-sm" onClick={() => setLang(lang === "es" ? "en" : "es")}>{t("language")}</button>
    </header>
  );

  if (phase === "battle") {
    const opp = stages[stage];
    return (
      <div className="p-wrap">
        {header}
        <div className="help">{t("stage", { n: stage + 1, total: stages.length })}</div>
        <BattleView key={stage} t={t} lang={lang} sprites={sprites} me={{ name: name.trim(), sets }} opp={opp} fid={fid} levelRules={levelRules} onEnd={onBattleEnd} />
      </div>
    );
  }

  if (phase === "between") {
    const opp = stages[stage + 1];
    return (
      <div className="p-wrap">
        {header}
        <div className="panel p-between">
          <img src={avatarSrc(sprites, opp.avatar)} alt="" className="p-avatar pixelated" onError={(e) => { e.currentTarget.style.display = "none"; }} />
          <b>{t("next", { name: opp.name })}</b>
          {opp.dialogue?.intro && <p className="p-quote">“{opp.dialogue.intro}”</p>}
          <button type="button" className="btn btn-primary" onClick={() => { setStage((s) => s + 1); setPhase("battle"); }}>{t("start")}</button>
        </div>
      </div>
    );
  }

  if (phase === "done") {
    const won = results.length === stages.length && results.every((r) => r.won);
    const last = results[results.length - 1];
    const copy = async () => { try { await navigator.clipboard.writeText(code.short); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* the text is selectable */ } };
    const file = () => {
      const blob = new Blob([code.full], { type: "text/plain" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${(target.name || "silver").replace(/[^\w-]+/g, "-")}-${name.trim().replace(/[^\w-]+/g, "-")}.txt`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    };
    return (
      <div className="p-wrap">
        {header}
        <div className={`panel p-final ${won ? "is-won" : ""}`}>
          {won && kind === "gym" && <div className="p-badge-win"><Badge color={target.badge_color || TYPE_COLORS[target.type] || "#c0c0c0"} size={120} /></div>}
          <h2>{won ? (kind === "gym" ? t("won_all", { badge: target.badge || t("badge") }) : t("won_trainer", { name: target.name })) : t("lost_to", { name: last?.opponent || target.name })}</h2>
          <div className="space-y-2 w-full">
            <b>{t("result_code")}</b>
            <p className="help">{t("result_help", { name: owner || target.name })}</p>
            <textarea className="field" rows={4} readOnly value={code.short} onFocus={(e) => e.target.select()} />
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-primary" onClick={copy} disabled={!code.short}>{copied ? t("copied") : t("copy")}</button>
              <button type="button" className="btn" onClick={file} disabled={!code.full}>{t("download_result")}</button>
              <button type="button" className="btn" onClick={() => setPhase("setup")}>{t("retry")}</button>
            </div>
          </div>
        </div>
        <footer className="help p-foot">{t("made_with")}</footer>
      </div>
    );
  }

  const leader = kind === "gym" ? target.leader : target;
  return (
    <div className="p-wrap">
      {header}
      <div className="p-grid">
        <section className="panel space-y-3">
          <div className="p-leader">
            <img src={avatarSrc(sprites, leader.avatar)} alt="" className="p-avatar pixelated" onError={(e) => { e.currentTarget.style.display = "none"; }} />
            <div className="min-w-0">
              <span className="help">{kind === "gym" ? t("leader") : t("trainer_intro")}</span>
              <h2>{leader.name}</h2>
              {leader.title && <div className="help">{leader.title}</div>}
            </div>
          </div>
          {leader.dialogue?.intro && <p className="p-quote">“{leader.dialogue.intro}”</p>}
          <div className="flex flex-wrap gap-1.5">
            {kind === "gym" && target.type && <span className="b-type" style={{ background: TYPE_COLORS[target.type] || "#777" }}>{typeName(target.type, lang)}</span>}
            <span className="chip">{t("format")}: {info.name || fid}</span>
            {levelRules.level && <span className="chip">{t("level_fixed", { n: levelRules.level })}</span>}
            {levelRules.level_cap && <span className="chip">{t("level_cap", { n: levelRules.level_cap })}</span>}
            {levelRules.level_min && <span className="chip">{t("level_min", { n: levelRules.level_min })}</span>}
            {rules.map((r) => <span key={r} className="chip">{r}</span>)}
          </div>
          {kind === "gym" && <p className="help">{stages.length > 1 ? t("then_leader", { n: stages.length - 1 }) : t("only_leader")}</p>}
          {target.description && <p className="help">{target.description}</p>}
        </section>
        <section className="panel space-y-3">
          <label className="block"><span className="label">{t("your_name")}</span><input className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} /></label>
          <span className="label">{t("your_team")}</span>
          <div className="seg" role="group">
            {["paste", "random", "file"].map((x) => <button key={x} type="button" aria-pressed={tab === x} onClick={() => { setTab(x); if (x === "random") roll(); }}>{t(`tab_${x}`)}</button>)}
          </div>
          {tab === "paste" && <textarea className="field" rows={10} value={paste} onChange={(e) => { setPaste(e.target.value); setSets(null); }} placeholder={t("paste_ph")} />}
          {tab === "random" && <button type="button" className="btn btn-sm" onClick={roll}>{t("roll")}</button>}
          {tab === "file" && <><input type="file" className="field" accept=".hoardtrainer,.json" onChange={(e) => loadFile(e.target.files?.[0])} /><p className="help">{t("file_help")}</p></>}
          {sets && <><TeamIcons sets={sets} sprites={sprites} /><div className="help">{t("team_ok")}</div></>}
          {problems.length > 0 && <div className="banner banner-warn"><b>{t("problems")}</b><ul className="list-disc pl-5">{problems.map((p, i) => <li key={i}>{p}</li>)}</ul></div>}
          <div className="flex flex-wrap gap-2">
            {tab === "paste" && <button type="button" className="btn" onClick={() => check(paste)} disabled={!paste.trim()}>{t("check")}</button>}
            <button type="button" className="btn btn-primary" onClick={start} disabled={!sets || !name.trim()}>{t("start")}</button>
          </div>
        </section>
      </div>
      <footer className="help p-foot">{t("made_with")}</footer>
    </div>
  );
}

function BattleView({ t, lang, sprites, me, opp, fid, levelRules, onEnd }) {
  const player = useBattlePlayer({ lang, me: "p1", speedMs: 850 });
  const matchRef = useRef(null);
  const sinceRef = useRef(0);
  const [request, setRequest] = useState(null);
  const [busy, setBusy] = useState(false);
  const [bubble, setBubble] = useState(null);
  const ended = useRef(false);
  const seats = useMemo(() => ({
    p1: { name: me.name, avatarUrl: "" },
    p2: { name: opp.name, avatarUrl: avatarSrc(sprites, opp.avatar), dialogue: opp.dialogue || {} },
  }), [me.name, opp, sprites]);

  const sync = useCallback(() => {
    const m = matchRef.current;
    const st = m.state("p1", sinceRef.current);
    sinceRef.current = st.log_length;
    player.push(st.lines);
    setRequest(st.requests.p1 || null);
    if (st.ended && !ended.current) {
      ended.current = true;
      const won = st.winner_side === "p1";
      const line = won ? opp.dialogue?.lose : opp.dialogue?.win;
      if (line) setTimeout(() => setBubble({ side: "p2", text: line }), 600);
      const lines = viewLines(m.battle.log, 0, "omniscient");
      setTimeout(() => onEnd({ won, turns: m.battle.turn, opponent: opp.name, lines }), 2600);
    }
  }, [player, onEnd, opp]);

  useEffect(() => {
    const ai = opp.ai || { level: "normal", style: "balanced" };
    matchRef.current = new Match({ format: fid, level_rules: levelRules, p1: { name: me.name, sets: me.sets, ai: null }, p2: { name: opp.name, sets: opp.team, ai } });
    matchRef.current.advance();
    sync();
    if (opp.dialogue?.intro) setBubble({ side: "p2", text: opp.dialogue.intro });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!bubble) return undefined;
    const h = setTimeout(() => setBubble(null), 4000);
    return () => clearTimeout(h);
  }, [bubble]);

  const choose = (choice) => {
    setBusy(true);
    setTimeout(() => {
      try {
        matchRef.current.choose("p1", choice);
      } catch (e) {
        alertless(e);
      }
      sync();
      setBusy(false);
    }, 30);
  };
  const forfeit = () => { matchRef.current.forfeit("p1"); sync(); };
  return (
    <Arena player={player} seats={seats} me="p1" sprites={sprites} lang={lang} bubble={bubble}>
      {request && player.caughtUp && !busy ? <Controls request={request} lang={lang} sprites={sprites} gametype={player.state.gametype} onChoose={choose} onForfeit={forfeit} />
        : !player.state.ended ? <div className="b-controls"><div className="b-wait">{busy ? t("thinking") : "…"}</div></div> : null}
    </Arena>
  );
}

function alertless(e) {
  // a rejected choice is shown in the console only; the controls stay so the person picks again
  console.warn(e && e.message ? e.message : e);
}
