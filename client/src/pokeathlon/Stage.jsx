// A course in play: for each event the introduction card, the canvas with the event itself (countdown, play, "Fin"), the results of the
// round; after the last one the closing ceremony. A single event plays the same way with one round and no ceremony.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../context.js";
import { useStored } from "../components/ui.jsx";
import Ceremony from "./Ceremony.jsx";
import { TeamIcons } from "./parts.jsx";
import { hashSeed } from "./core.js";
import { Course, EVENT_META, formatScore, savePayload } from "./course.js";
import { loadRecords, saveResult } from "./data.js";
import { EVENTS } from "./events/index.js";
import { EventRunner } from "./runner.js";
import { STAT_COLORS, makeS } from "./strings.js";

export const evName = (id, lang) => EVENTS[id].names[lang === "en" ? "en" : "es"];

/** actions: a node that replaces the go / leave buttons (a room has its own). */
export function Intro({ eventId, round, total, config, bestScore, s, lang, onGo, onExit, actions = null }) {
  const mod = EVENTS[eventId];
  const watch = config.mode === "watch";
  const units = { frames: "unit_frames", pennants: "unit_pennants", points: "unit_points", blocks: "unit_blocks", hits: "unit_hits", goals: "unit_goals", "laps*1024+px": "unit_laps" };
  return (
    <div className="pk-intro panel space-y-3">
      <div className="help">{total > 1 ? s("round_n", { n: round + 1, m: total }) : s("course_single")}</div>
      <h1>{evName(eventId, lang)}</h1>
      <div className="pk-meta">
        <div>
          <span className="label">{s("key_stats")}</span>
          <div className="flex flex-wrap gap-2">{mod.stats.map((k) => <span key={k} className="chip" style={{ color: STAT_COLORS[k] }}>{s(`stat_${k}`)}</span>)}</div>
        </div>
        <div>
          <span className="label">{s("length")}</span>
          <div>{eventId === "hurdle_dash" ? s("race") : s("seconds_n", { n: mod.seconds })}</div>
        </div>
        <div>
          <span className="label">{s("best_record")}</span>
          <div className="num">{bestScore === null ? s("no_record") : `${formatScore(eventId, bestScore)} ${s(units[EVENT_META[eventId].unit])}`}</div>
        </div>
      </div>
      <div>
        <span className="label">{s("controls")}</span>
        <p>{mod.help[lang === "en" ? "en" : "es"]}</p>
      </div>
      <div className="pk-teams-preview">
        {config.teams.map((t) => (
          <div key={t.index} className="pk-teamchip" style={{ "--team": t.color }}>
            <span className="pk-dot" />
            <span className="trunc">{t.name}</span>
            <TeamIcons team={t} />
          </div>
        ))}
      </div>
      {actions || (
        <div className="flex gap-2">
          <button type="button" className="btn btn-primary" onClick={onGo} autoFocus>{watch ? s("go_watch") : s("go")}</button>
          <button type="button" className="btn" onClick={onExit}>{s("leave")}</button>
        </div>
      )}
    </div>
  );
}

function Play({ config, eventId, round, onFinish, s, lang }) {
  const { sprites } = useApp();
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const runner = useRef(null);
  const finishRef = useRef(onFinish);
  finishRef.current = onFinish;
  const [loading, setLoading] = useState(true);
  const [muted, setMuted] = useStored("silver-pokeathlon-muted", false);
  const [full, setFull] = useState(false);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  const fit = useCallback(() => {
    const w = wrapRef.current;
    const r = runner.current;
    if (!w || !r) return;
    const isFull = document.fullscreenElement === w;
    const width = isFull ? Math.min(w.clientWidth, (w.clientHeight - 56) * (16 / 9)) : Math.min(w.clientWidth, 1280);
    r.resize(Math.max(320, width));
  }, []);

  useEffect(() => {
    const r = new EventRunner({
      canvas: canvasRef.current, mod: EVENTS[eventId], teams: config.teams, seed: hashSeed(config.seed, eventId, round), lang,
      mode: "play", supreme: config.supreme, base: "", iconUrl: (mon) => sprites.fallback(mon.species), muted: mutedRef.current,
      onFinish: (res) => finishRef.current(res),
      onPhase: (p) => { if (p === "ready") { setLoading(false); r.start(); } },
    });
    runner.current = r;
    fit();
    r.prepare();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : null;
    if (ro && wrapRef.current) ro.observe(wrapRef.current);
    const onFs = () => { setFull(document.fullscreenElement === wrapRef.current); fit(); };
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      if (ro) ro.disconnect();
      r.destroy();
      runner.current = null;
    };
  }, [eventId, round]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (runner.current) runner.current.muted = muted; }, [muted]);

  const toggleFull = () => {
    const w = wrapRef.current;
    if (!w) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if (w.requestFullscreen) w.requestFullscreen().catch(() => {});
  };

  return (
    <div className={`pk-stage${full ? " is-full" : ""}`} ref={wrapRef}>
      <div className="pk-toolbar">
        <strong className="trunc">{evName(eventId, lang)}</strong>
        <span className="grow" />
        <button type="button" className="btn btn-sm" onClick={() => runner.current && runner.current.pause(true)}>{s("pause")}</button>
        <button type="button" className="btn btn-sm" onClick={() => setMuted(!muted)} aria-pressed={!muted} title={muted ? s("sound_off") : s("sound_on")}>
          {muted ? s("sound_off") : s("sound_on")}
        </button>
        <button type="button" className="btn btn-sm" onClick={toggleFull}>{full ? s("exit_fullscreen") : s("fullscreen")}</button>
      </div>
      <div className="pk-canvaswrap">
        <canvas ref={canvasRef} className="pk-canvas" width="960" height="540" aria-label={evName(eventId, lang)} />
        {loading && <div className="pk-loading" role="status">{s("loading_sprites")}</div>}
      </div>
      {!full && <p className="help pk-help">{EVENTS[eventId].help[lang === "en" ? "en" : "es"]}</p>}
    </div>
  );
}

/** actions: a node that replaces the buttons (a room advances by itself). */
export function Results({ course, last, config, s, lang, isLast, onNext, onAgain, onOther, onExit, actions = null }) {
  const eventId = last.event;
  const order = [0, 1, 2, 3].sort((a, b) => last.ranks[a] - last.ranks[b] || a - b);
  const totals = course.totals();
  const single = config.single;
  const topTied = last.ranks.filter((r) => r === 0).length > 1;
  return (
    <div className="pk-results panel space-y-3">
      <h1>{s("results_event", { name: evName(eventId, lang) })}</h1>
      <table className="pk-table">
        <thead>
          <tr><th>#</th><th>{s("col_team")}</th><th className="num">{s("col_score")}</th><th className="num">{s("col_points")}</th>{!single && <th className="num">{s("col_total")}</th>}</tr>
        </thead>
        <tbody>
          {order.map((ti) => {
            const t = config.teams[ti];
            return (
              <tr key={ti} className={t.human ? "is-you" : ""} style={{ "--team": t.color }}>
                <td className="pk-placecell"><span className="pk-place">{last.ranks[ti] + 1}</span></td>
                <td><span className="pk-dot" /> <strong>{t.name}</strong> <TeamIcons team={t} size={24} /></td>
                <td className="num">{formatScore(eventId, last.raw[ti])}</td>
                <td className="num">+{last.points[ti]}</td>
                {!single && <td className="num"><strong>{totals[ti]}</strong></td>}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="help">{topTied ? s("tied_first") : s("winner_of_event", { name: config.teams[order[0]].name })}</p>
      {actions || <div className="flex flex-wrap gap-2">
        {single ? (
          <>
            <button type="button" className="btn btn-primary" onClick={onAgain} autoFocus>{s("again")}</button>
            <button type="button" className="btn" onClick={onOther}>{s("other_event")}</button>
            <button type="button" className="btn" onClick={onExit}>{s("finish")}</button>
          </>
        ) : (
          <button type="button" className="btn btn-primary" onClick={onNext} autoFocus>{isLast ? s("to_ceremony") : s("next_event")}</button>
        )}
      </div>}
    </div>
  );
}

/** props: config { key, events, teams, supreme, mode, seed, medal, single }, onExit(), onAgain(), onOther() (single events). */
export default function Stage({ config, onExit, onAgain, onOther }) {
  const { lang, confirm } = useApp();
  const s = useMemo(() => makeS(lang), [lang]);
  const courseRef = useRef(null);
  if (!courseRef.current) {
    courseRef.current = new Course({ key: config.key, events: config.events, teams: config.teams, supreme: config.supreme, seed: config.seed, medal: config.medal });
  }
  const course = courseRef.current;
  const [round, setRound] = useState(0);
  const [phase, setPhase] = useState("intro"); // intro | play | results | ceremony
  const [last, setLast] = useState(null);
  const [records, setRecords] = useState(null);
  const eventId = config.events[round];

  useEffect(() => { loadRecords().then(setRecords); }, []);
  const best = records && records.events && records.events[eventId] && records.events[eventId][0] ? Number(records.events[eventId][0].score) : null;

  const finished = useCallback((result) => {
    const r = course.record(eventId, result);
    setLast({ event: eventId, ...r });
    setPhase("results");
    if (config.single && config.mode !== "watch") {
      saveResult(savePayload(course, null, { mode: config.mode, lang })).then(() => loadRecords().then(setRecords)).catch(() => {});
    }
  }, [course, eventId, config, lang]);

  const leave = async () => {
    if (phase === "results" || phase === "ceremony" || (phase === "intro" && round === 0)) { onExit(); return; }
    const ok = await confirm({ title: s("leave"), message: s("leave_confirm"), confirmLabel: s("leave"), danger: true });
    if (ok) onExit();
  };

  if (phase === "ceremony") {
    return <Ceremony course={course} config={config} onExit={onExit} onAgain={onAgain} />;
  }
  if (phase === "results" && last) {
    const isLast = round >= config.events.length - 1;
    return (
      <Results course={course} last={last} config={config} s={s} lang={lang} isLast={isLast} onExit={onExit} onAgain={onAgain} onOther={onOther}
        onNext={() => { if (isLast) setPhase("ceremony"); else { setRound(round + 1); setPhase("intro"); } }} />
    );
  }
  if (phase === "play") {
    return <Play key={`${eventId}-${round}`} config={config} eventId={eventId} round={round} onFinish={finished} s={s} lang={lang} />;
  }
  return <Intro eventId={eventId} round={round} total={config.events.length} config={config} bestScore={best} s={s} lang={lang} onGo={() => setPhase("play")} onExit={leave} />;
}
