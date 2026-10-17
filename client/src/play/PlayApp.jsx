// The page a friend opens: the gym (or trainer) inside it, a team of their own, and the battles, all in the browser with the same
// engine and AI as the app. At the end it gives a result code to send back.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applyLevelRules, buildFormatId, dexNum, exportTeam, importTeam, randomTeam, teamSummary, validateTeam, formatInfo } from "../../../engine/src/core.mjs";
import { Match, phaseOf, viewLines } from "../../../engine/src/match.mjs";
import Arena from "../battle/Arena.jsx";
import Controls from "../battle/Controls.jsx";
import { makeSprites, TYPE_COLORS, typeName } from "../battle/dex.js";
import { useBattlePlayer } from "../battle/player.js";
import { battleEnd } from "../audio.js";
import { playT } from "./strings.js";
import { BadgeArt } from "../components/badges.jsx";
import RtScreen from "../battle/rt/RtScreen.jsx";
import Overworld from "../battle/overworld/Overworld.jsx";
import { RULES_VERSION, rtRun } from "../../../engine/src/realtime/sim.mjs";
import { deflateB64, newSeed, packRtInputs } from "./rtcode.js";
import MassPlay from "./MassPlay.jsx";

const RESULT_PREFIX = "SILVERWIN1-";       // a result of battles played turn by turn
const RESULT_PREFIX_RT = "SILVERWIN2-";    // a result with real-time battles in it: they carry their replay
const LONG_CODE = 6000;                     // characters; longer than this and the page pushes the file
const readPref = (key) => { try { return localStorage.getItem(key) || ""; } catch { return ""; } };

export function avatarSrc(sprites, avatar) {
  return sprites.trainer(avatar);
}

function Badge({ color = "#c0c0c0", size = 64, image = "" }) {
  return <BadgeArt color={color} size={size} image={image} />;
}

export function TeamIcons({ sets, sprites }) {
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
  // a mass battle sent to watch or play one of its Pokémon (MassPlay.jsx)
  if (data?.kind === "mass" && data.mass?.spec) return <MassPlay data={data} lang={lang} setLang={setLang} />;
  if (!data || !data.payload) return <div className="p-wrap"><div className="panel">{t("no_data")}</div></div>;
  return <Challenge data={data} lang={lang} setLang={setLang} t={t} />;
}

function Challenge({ data, lang, setLang, t }) {
  const kind = data.kind;
  const target = kind === "gym" ? data.payload.gym : data.payload.trainer;
  const sprites = useMemo(() => makeSprites({ server: data.sprite_server || "https://play.pokemonshowdown.com/sprites", set: data.sprite_set || "gen5ani", dexNum, overworld: data.overworld }), [data]);
  const all = useMemo(() => (kind === "gym" ? [...(target.trainers || []), target.leader] : [target]), [kind, target]);
  // a gym with a map: the friend walks it and fights whoever they meet, the leader last; seq is the order the battles came in
  const walkMap = useMemo(() => (kind === "gym" && target.map?.w
    ? { ...target.map, trainers: (target.map.trainers || []).map((x) => ({ ...x, id: `t${x.id}` })) } : null), [kind, target]);
  const [seq, setSeq] = useState(() => all.map((_, i) => i));
  const stages = useMemo(() => seq.map((i) => all[i]), [seq, all]);
  const format = target.format || (kind === "gym" ? target.leader.format : "gen9nationaldexag");
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
  // how the friend may fight: the owner chose when exporting (turns, real time, or "choose": the friend picks for each battle)
  const rtInfo = data.rt && typeof data.rt === "object" ? data.rt : null;
  const allowed = !rtInfo || data.mode === "turns" ? "turns" : data.mode === "realtime" ? "realtime" : "choose";
  const [pick, setPick] = useState(() => (readPref("silver-play-mode") === "realtime" ? "realtime" : "turns"));
  const battleMode = allowed === "choose" ? pick : allowed;
  const [stageMode, setStageMode] = useState("turns");
  const setPickSaved = (v) => { setPick(v); try { localStorage.setItem("silver-play-mode", v); } catch { /* not critical */ } };
  const fid = useMemo(() => { try { return buildFormatId(format, rules); } catch { return "gen9nationaldexag"; } }, [format, rules]);
  const info = useMemo(() => { try { return formatInfo(fid); } catch { return { gen: 9, name: fid }; } }, [fid]);
  const owner = data.from || data.payload.owner || target.owner || "";
  // the week's challenge: every battle with the week's seed and AI luck (battle i: seed-i), the same for everyone who plays it
  const weekly = data.weekly && typeof data.weekly === "object" && data.weekly.seed ? data.weekly : null;
  // the rule friends voted for this week (a Pokémon the team must include, or a team-building rule): checked here and by the app
  const weekRule = weekly?.rule && typeof weekly.rule === "object" ? weekly.rule : null;
  const ruleFid = useMemo(() => { try { return weekRule?.kind === "rule" ? buildFormatId(format, [...rules, weekRule.value]) : fid; } catch { return fid; } }, [weekRule, format, rules, fid]);

  const check = (list) => {
    try {
      const prepared = applyLevelRules(importTeam(list), levelRules);
      const v = validateTeam(ruleFid, prepared);
      const problems = v.ok ? [] : [...v.problems];
      const norm = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      if (weekRule?.kind === "pokemon" && !prepared.some((m) => norm(m.species) === norm(weekRule.value) || norm(m.species).startsWith(`${norm(weekRule.value)}mega`))) {
        problems.push(t("weekly_rule_missing", { value: weekRule.value }));
      }
      setProblems(problems);
      setSets(!problems.length ? importTeam(list) : null);
      return !problems.length;
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
    setSeq(all.map((_, i) => i));
    try { localStorage.removeItem(`silver-play-walk-${target.source_id}-${name.trim()}`); } catch { /* not critical */ }
    setStageMode(battleMode);
    setPhase(walkMap ? "walk" : "battle");
  };

  // on the map: whoever saw you (or the leader you talked to) is the next battle
  const meet = (who) => {
    const idx = who === "leader" ? all.length - 1 : Number(String(who).slice(1));
    const next = results.length;
    setSeq((cur) => {
      const out = [...cur];
      const j = out.indexOf(idx);
      if (j >= next) [out[next], out[j]] = [out[j], out[next]];
      return out;
    });
    setStage(next);
    setStageMode(battleMode);
    setPhase("battle");
  };

  const onBattleEnd = useCallback((res) => {
    setResults((r) => {
      const next = [...r, res];
      if (!res.won || stage + 1 >= stages.length) setPhase("done");
      else setPhase(walkMap ? "walk" : "between");
      return next;
    });
  }, [stage, stages.length, walkMap]);

  useEffect(() => {
    if (phase !== "done") return;
    const won = results.length === stages.length && results.every((r) => r.won);
    const withRt = results.some((r) => r.rt);
    const base = {
      kind, gym_id: kind === "gym" ? target.source_id : "", gym_name: kind === "gym" ? target.name : "", trainer_id: kind === "trainer" ? target.source_id : "",
      trainer_name: kind === "trainer" ? target.name : "", challenger: name.trim(), won, turns: results.reduce((a, r) => a + r.turns, 0),
      date: new Date().toISOString(), team: sets, team_paste: sets ? exportTeam(sets) : "",
      // each battle travels with its record (the real-time replay, or the turn-based input log): the app plays it again
      stages: results.map((r) => (r.rt ? { name: r.opponent, won: r.won, turns: 0, mode: "realtime", rt: r.rt }
        : { name: r.opponent, won: r.won, turns: r.turns, ...(r.input ? { input: r.input, rng: r.rng, forfeit: r.forfeit || "" } : {}) })),
      ai_version: data.ai_version || "",
      ...(walkMap ? { order: stages.map((x) => x.source_id) } : {}),
      ...(weekly ? { weekly: weekly.week } : {}),
      ...(withRt ? { v: 2 } : results.some((r) => r.input) ? { v: 3 } : {}),
    };
    (async () => {
      try {
        // battles played in real time travel with their replay (seed, arena, inputs): the app plays them again to check the result
        const prefix = withRt ? RESULT_PREFIX_RT : RESULT_PREFIX;
        const log = results.flatMap((r) => r.lines);
        const full = prefix + await deflateB64(JSON.stringify({ ...base, log }));
        const short = withRt && !log.length ? full : prefix + await deflateB64(JSON.stringify(base));
        setCode({ short, full });
      } catch {
        setCode({ short: "", full: "" });
      }
    })();
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const header = (
    <header className="p-head">
      <div className="p-target">
        {kind === "gym" ? <Badge image={target.badge_image} color={target.badge_color || TYPE_COLORS[target.type] || "#c0c0c0"} size={56} /> : null}
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
        {stageMode === "realtime" && rtInfo
          ? <RtBattleView key={stage} t={t} lang={lang} sprites={sprites} me={{ name: name.trim(), sets }} opp={opp} rtInfo={rtInfo} levelRules={levelRules} onEnd={onBattleEnd} />
          : <BattleView key={stage} t={t} lang={lang} sprites={sprites} me={{ name: name.trim(), sets }} opp={opp} fid={fid} levelRules={levelRules} onEnd={onBattleEnd}
            seed={weekly ? `${weekly.seed}-${stage}` : ""} backdrop={kind === "gym" ? target.backdrop || "" : ""} />}
      </div>
    );
  }

  if (phase === "walk") {
    const fought = seq.slice(0, results.length);
    const people = Object.fromEntries([...(target.trainers || []).map((x, i) => [`t${i}`, { name: x.name, avatarUrl: avatarSrc(sprites, x.avatar) }]),
      ["leader", { name: target.leader.name, avatarUrl: avatarSrc(sprites, target.leader.avatar) }]]);
    return (
      <div className="p-wrap">
        {header}
        {allowed === "choose" && <ModePicker t={t} value={pick} onChange={setPickSaved} />}
        <div className="panel p-2">
          <Overworld map={walkMap} people={people} player={{ name: name.trim(), avatarUrl: "" }} beaten={fought.filter((i) => i < all.length - 1).map((i) => `t${i}`)}
            color={target.badge_color || TYPE_COLORS[target.type]} onBattle={meet} lang={lang} saveKey={`silver-play-walk-${target.source_id}-${name.trim()}`} />
        </div>
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
          {allowed === "choose" && <ModePicker t={t} value={pick} onChange={setPickSaved} />}
          {allowed !== "choose" && rtInfo && <p className="help">{t(allowed === "realtime" ? "mode_realtime_only" : "mode_turns_only")}</p>}
          <button type="button" className="btn btn-primary" onClick={() => { setStage((s) => s + 1); setStageMode(battleMode); setPhase("battle"); }}>{t("start")}</button>
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
          {won && kind === "gym" && <div className="p-badge-win"><Badge image={target.badge_image} color={target.badge_color || TYPE_COLORS[target.type] || "#c0c0c0"} size={120} /></div>}
          <h2>{won ? (kind === "gym" ? t("won_all", { badge: target.badge || t("badge") }) : t("won_trainer", { name: target.name })) : t("lost_to", { name: last?.opponent || target.name })}</h2>
          {stages[results.length - 1]?.dialogue?.after && <p className="p-quote">“{stages[results.length - 1].dialogue.after}”</p>}
          <div className="space-y-2 w-full">
            <b>{t("result_code")}</b>
            <p className="help">{t("result_help", { name: owner || target.name })}</p>
            {results.some((r) => r.rt) && !code.short && <div className="banner banner-warn">{t("rt_code_unavailable")}</div>}
            {code.short.length > LONG_CODE && <div className="banner banner-info">{t("code_long", { n: code.short.length })}</div>}
            <textarea className="field" rows={4} readOnly value={code.short} onFocus={(e) => e.target.select()} />
            <div className="flex flex-wrap gap-2">
              <button type="button" className={`btn ${code.short.length > LONG_CODE ? "" : "btn-primary"}`} onClick={copy} disabled={!code.short}>{copied ? t("copied") : t("copy")}</button>
              <button type="button" className={`btn ${code.short.length > LONG_CODE ? "btn-primary" : ""}`} onClick={file} disabled={!code.full}>{code.short.length > LONG_CODE ? t("download_code_file") : t("download_result")}</button>
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
            {allowed === "realtime" && <span className="chip chip-rt">{t("mode_chip_realtime")}</span>}
            {weekly && <span className="chip chip-rt">{t("weekly_chip", { week: weekly.week })}</span>}
            {weekRule && <span className="chip chip-rt">{t(weekRule.kind === "pokemon" ? "weekly_rule_pokemon" : "weekly_rule_rule", { value: weekRule.value })}</span>}
          </div>
          {weekly && <p className="help">{t("weekly_help")}</p>}
          {allowed !== "choose" && rtInfo && <p className="help">{t(allowed === "realtime" ? "mode_realtime_only" : "mode_turns_only")}</p>}
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
          {allowed === "choose" && <ModePicker t={t} value={pick} onChange={setPickSaved} />}
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

function BattleView({ t, lang, sprites, me, opp, fid, levelRules, onEnd, seed = "", backdrop = "" }) {
  const player = useBattlePlayer({ lang, me: "p1", speedMs: 850 });
  const matchRef = useRef(null);
  const sinceRef = useRef(0);
  const [request, setRequest] = useState(null);
  const [busy, setBusy] = useState(false);
  const [bubble, setBubble] = useState(null);
  const ended = useRef(false);
  const forfeited = useRef(false);
  const seats = useMemo(() => ({
    p1: { name: me.name, avatarUrl: "" },
    p2: { name: opp.name, avatarUrl: avatarSrc(sprites, opp.avatar), dialogue: opp.dialogue || {} },
  }), [me.name, opp, sprites]);

  const sync = useCallback(() => {
    const m = matchRef.current;
    const st = m.state("p1", sinceRef.current);
    // an AI that fails falls back to a default choice: the console says why (the battle goes on)
    if (st.errors?.length) console.warn("silver-ai " + st.errors.join(" | "));
    sinceRef.current = st.log_length;
    player.push(st.lines);
    setRequest(st.requests.p1 || null);
    if (st.ended && !ended.current) {
      ended.current = true;
      const won = st.winner_side === "p1";
      const line = won ? opp.dialogue?.lose : opp.dialogue?.win;
      if (line) setTimeout(() => setBubble({ side: "p2", text: line, mood: won ? "lose" : "win" }), 600);
      const lines = viewLines(m.battle.log, 0, "omniscient");
      // the battle's own record (seed, teams, every choice) and the AI's random-number key: the app replays it to check the result
      const record = { input: m.inputLog(), rng: m.id, forfeit: forfeited.current ? "p1" : "" };
      setTimeout(() => onEnd({ won, turns: m.battle.turn, opponent: opp.name, lines, ...record }), 2600);
    }
  }, [player, onEnd, opp]);

  // the victory or defeat cue plays when the battle on screen has caught up with the end of the log
  useEffect(() => {
    if (player.state.ended && player.caughtUp) battleEnd(player.state.tie || !player.state.winner ? null : player.state.winner === player.state.sides.p1.name);
  }, [player.state.ended, player.caughtUp]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const phase = phaseOf(opp.dialogue);
    const ai = { ...(opp.ai || { level: "normal", style: "balanced" }), ...(phase ? { phase } : {}) };
    matchRef.current = new Match({ ...(seed ? { id: seed, seed } : {}), format: fid, level_rules: levelRules, p1: { name: me.name, sets: me.sets, ai: null },
      p2: { name: opp.name, sets: opp.team, ai } });
    matchRef.current.advance();
    sync();
    if (opp.dialogue?.intro) setBubble({ side: "p2", text: opp.dialogue.intro, mood: "intro" });
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
  const forfeit = () => { forfeited.current = true; matchRef.current.forfeit("p1"); sync(); };
  return (
    <Arena player={player} seats={seats} me="p1" sprites={sprites} lang={lang} bubble={bubble} backdrop={backdrop}>
      {request && player.caughtUp && !busy ? <Controls request={request} lang={lang} sprites={sprites} gametype={player.state.gametype} onChoose={choose} onForfeit={forfeit} />
        : !player.state.ended ? <div className="b-controls"><div className="b-wait">{busy ? t("thinking") : "…"}</div></div> : null}
    </Arena>
  );
}

function alertless(e) {
  // a rejected choice is shown in the console only; the controls stay so the person picks again
  console.warn(e && e.message ? e.message : e);
}

/** Turn by turn or real time, when the owner left the choice to the friend. */
function ModePicker({ t, value, onChange }) {
  return (
    <div className="space-y-1 w-full">
      <span className="label">{t("battle_mode")}</span>
      <div className="seg" role="group" aria-label={t("battle_mode")}>
        {["turns", "realtime"].map((v) => <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>{t(`mode_${v}`)}</button>)}
      </div>
      <div className="help">{t(`mode_${value}_help`)}</div>
    </div>
  );
}

/** One battle in real time: the app's arena screen on the page's own copy of the simulator. The battle is recorded as its seed and the
 * friend's inputs; the page replays it itself to get the result (the way the app will), and puts the replay in the result code. */
function RtBattleView({ t, lang, sprites, me, opp, rtInfo, levelRules, onEnd }) {
  const seats = useMemo(() => ({ p1: { name: me.name, avatarUrl: "" }, p2: { name: opp.name, avatarUrl: avatarSrc(sprites, opp.avatar) } }), [me.name, opp, sprites]);
  const spec = useMemo(() => {
    const seed = newSeed();
    return {
      id: `play-${seed}`, seed, format: rtInfo.format, level_rules: levelRules, time_limit: rtInfo.time_limit, version: Math.min(rtInfo.version || RULES_VERSION, RULES_VERSION),
      // a gym's own arena (the arena designer) travels as the field itself; otherwise open or the seed's rocks
      arena: rtInfo.arena && typeof rtInfo.arena === "object" ? rtInfo.arena : rtInfo.arena === "open" ? "open" : "rocks",
      p1: { name: me.name, sets: me.sets, ai: null }, p2: { name: opp.name, sets: opp.team, ai: opp.ai || { level: "normal", style: "balanced" } },
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [battle, setBattle] = useState(() => ({
    id: spec.id, status: "live", format: spec.format, kind: "friend", summary: null, rt: { spec, inputs: [], tick: 0, human: [true, false], time_limit: spec.time_limit, arena: spec.arena },
  }));
  const outcome = useRef(null);

  const onFinish = useCallback(async (inputs, tick, forfeit) => {
    // the result is what the replay says: the same run the app does on import
    const b = rtRun(spec, { inputs, forfeit: forfeit || "", tick });
    const summary = b.summary();
    const won = summary.winner_side === "p1";
    let rt = null;
    try {
      rt = { trainer: opp.source_id, key: (rtInfo.keys || {})[opp.source_id] || "", v: spec.version, arena: spec.arena, seed: spec.seed, limit: spec.time_limit,
        inputs: await packRtInputs(inputs), tick: Math.max(0, Math.round(tick)), forfeit: forfeit || "" };
    } catch { /* no compression in this browser: the page says it cannot give a code */ }
    outcome.current = { won, turns: 0, seconds: Math.round(b.t / 30), opponent: opp.name, lines: [], mode: "realtime", rt };
    const ended = { id: spec.id, status: "ended", format: spec.format, kind: "friend", winner_side: summary.winner_side, summary: { seconds: b.t / 30 },
      rt: { spec, inputs: inputs.slice(), tick: b.t, human: [true, false], time_limit: spec.time_limit, arena: spec.arena } };
    setBattle(ended);
    return ended;
  }, [spec, opp, rtInfo]);

  return (
    <RtScreen key={spec.id} battle={battle} lang={lang} sprites={sprites} seats={seats} offline onFinish={onFinish}
      onContinue={() => onEnd(outcome.current || { won: false, turns: 0, opponent: opp.name, lines: [], mode: "realtime", rt: null })} continueLabel={t("battle_continue")} />
  );
}
