// The screen of a mass battle: the app already ran it in the engine (silvers_hoard/mass.py), and this screen runs the same spec
// again, tick by tick, so you watch it happen: an intro with the title and a countdown, the field with every Pokémon, the sides'
// bars at the top (the giants' big health bar in "many against a few"), the knockouts in a feed, speeds up to ×8, a jump to the
// end, a camera that zooms (wheel), pans (drag), follows whoever you click or directs itself, and the result with the ranking. At
// the end the screen compares its own run with the engine's: the same spec gives the same battle.
//
// play={unit}: a person plays that Pokémon (keyboard, mouse or gamepad: battle/rt/input.js, the simple layout). The screen records
// the input log tick by tick, and at the end hands it to onPlayed (the app replays it in the engine; the friends' page turns it
// into a code). replay={unit, inputs}: a played run watched again. video={playing, speed, ticks, onProgress, onDone}: the
// recorder's page.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { MassBattle, TPS } from "../../../../engine/src/realtime/mass.mjs";
import { MassRenderer } from "./render.js";
import { nameOf } from "../dex.js";
import { SeatInput } from "../rt/input.js";
import { battleEnd, music, pickTrack, sfx, unlock } from "../../audio.js";
import "./mass.css";

const SPEEDS = [1, 2, 4, 8];
const INTRO_S = 3.2;
const AIM_MOUSE_MS = 2500;     // the mouse aims while it moved this recently; otherwise the nearest foe

function fmt(s) {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, "0")}`;
}

function firstPad() {
  try {
    const pads = typeof navigator !== "undefined" && navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
    return pads.length ? pads[0].index : 0;
  } catch {
    return 0;
  }
}

export default function MassScreen({ doc, t, sprites, base = "", offline = false, onCheck = null, onAgain = null, onBack = null,
  play = null, replay = null, onPlayed = null, video = null, sound = true, extra = null, lang = "" }) {
  // moves are named in the page's language: the app, the friends' page and the video page all set it on the document
  const moveLang = lang || (typeof document !== "undefined" && document.documentElement.lang) || "es";
  const moveName = (name) => nameOf("move", name, moveLang);
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const sim = useRef(null);
  const [phase, setPhase] = useState("loading");
  const [progress, setProgress] = useState([0, 0]);
  const [speed, setSpeed] = useState(video?.speed || 1);
  const [hud, setHud] = useState(null);
  const [follow, setFollow] = useState(-1);
  const [auto, setAuto] = useState(!!video);
  const [check, setCheck] = useState(null);
  const [played, setPlayed] = useState(null);     // {state: saving|saved|bad, ...}
  const [error, setError] = useState(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const me = play ? play.unit : replay ? replay.unit : -1;
  // the battle is built again only when it is another battle (the page reloading the same one, with a new run in its list, keeps it)
  const specKey = `${doc.id || ""}:${doc.spec?.seed || ""}:${doc.spec?.teams?.length || 0}`;
  const live = !!play;

  const snapshot = useCallback(() => {
    const st = sim.current;
    if (!st) return;
    const b = st.b;
    const feed = [];
    for (let i = b.events.length - 1; i >= 0 && feed.length < 6; i--) {
      const e = b.events[i];
      if (e.k !== "ko") continue;
      const v = b.units[e.u];
      const k = e.by >= 0 ? b.units[e.by] : null;
      feed.push({ key: i, victim: v.name, vc: b.teams[v.team].color, by: k ? k.name : "", bc: k ? b.teams[k.team].color : "", mine: e.u === me || e.by === me });
    }
    const teams = b.teamStats();
    const giants = b.units.filter((u) => u.boss).map((u) => ({ i: u.i, name: u.name, hp: u.hp, maxhp: u.maxhp, color: b.teams[u.team].color, fainted: u.fainted }));
    const alive = b.units.filter((u) => !u.fainted).length;
    const shown = me >= 0 ? me : st.r.follow;
    const f = shown >= 0 ? b.units[shown] : null;
    setHud({ t: b.t / TPS, limit: b.timeLimit / TPS, teams, giants, alive, total: b.units.length, feed, ended: b.ended,
      follow: f ? { name: f.name, species: f.species, team: b.teams[f.team].name, color: b.teams[f.team].color, hp: f.hp, maxhp: f.maxhp, kos: f.kos,
        fainted: f.fainted, mine: shown === me,
        moves: f.moves.map((m, s) => ({ name: m.name, ready: f.cds[s] <= b.t, left: Math.max(0, (f.cds[s] - b.t) / TPS) })) } : null });
  }, [me]);

  // the friends' page switches language without rebuilding the battle
  useEffect(() => { if (sim.current?.r) sim.current.r.lang = moveLang; }, [moveLang]);

  // build the battle and the renderer, load the sprites
  useEffect(() => {
    let cancelled = false;
    let b;
    try {
      b = new MassBattle(me >= 0 ? { ...doc.spec, player: { unit: me } } : doc.spec, { inputs: replay?.inputs || [] });
    } catch (e) {
      setError(e);
      return undefined;
    }
    const r = new MassRenderer(canvasRef.current, b, { sprites, base, offline, sound, lang: moveLang,
      texts: { immune: t("mass_immune"), dodge: t("mass_dodge"), you: t("mass_you") } });
    r.auto = !!video;
    if (me >= 0) { r.follow = me; r.cam.zoom = 2.4; }
    sim.current = { b, r, acc: 0, last: 0, introAt: 0, input: live ? new SeatInput("solo", firstPad(), "simple") : null, held: new Set(),
      mouse: null, lastRow: null, click: false };
    // for checks from the browser console (and the app's QA)
    window.__silverMass = { get battle() { return sim.current?.b; }, get renderer() { return sim.current?.r; }, get inputs() { return sim.current?.b.inputs; } };
    r.resize(wrapRef.current?.clientWidth || 900);
    r.draw(0);
    // the crowd starts with its icons (one picture); the walking sprites keep arriving during the battle and replace them
    r.preload((d, n) => { if (!cancelled) setProgress([d, n]); }, 5000).then(() => {
      if (cancelled) return;
      if (video && !video.playing) { setPhase("ready"); return; }
      sim.current.introAt = performance.now();
      setPhase("intro");
    });
    snapshot();
    return () => { cancelled = true; };
  }, [specKey, sprites, base, offline]); // eslint-disable-line react-hooks/exhaustive-deps

  // the recorder starts the intro when it is recording
  useEffect(() => {
    if (video?.playing && phaseRef.current === "ready" && sim.current) { sim.current.introAt = performance.now(); setPhase("intro"); }
  }, [video?.playing, phase]);

  // music in the app (a page with no app behind it stays with the effects)
  useEffect(() => {
    if (offline || !sound || phase !== "intro") return;
    try { music.play(`${base}/api/music/${pickTrack(doc.id || doc.spec?.seed || "mass", 9)}`); } catch { /* sound is decoration */ }
  }, [phase === "intro"]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { try { music.stop({ fade: 0.6 }); } catch { /* nothing playing */ } }, []);

  // keep the canvas as wide as the screen allows
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => { sim.current?.r.resize(el.clientWidth); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const finish = useCallback(async () => {
    const st = sim.current;
    if (!st || st.done) return;
    st.done = true;
    setPhase("ended");
    snapshot();
    const sum = st.b.summary();
    if (sound) {
      try {
        if (sum.player) battleEnd(sum.player.team_won);
        else sfx("win");
      } catch { /* sound is decoration */ }
    }
    video?.onDone?.();
    if (live && onPlayed) {
      setPlayed({ state: "saving" });
      try {
        const out = await onPlayed({ unit: me, inputs: st.b.inputs.map((r) => r.slice()), hash: st.b.hash(), summary: sum });
        setPlayed({ state: "saved", ...(out || {}) });
      } catch (e) {
        setPlayed({ state: "bad", msg: String(e?.message || e) });
      }
      return;
    }
    if (onCheck && me < 0) {
      try { setCheck(await onCheck(st.b.hash())); } catch { setCheck(null); }
    }
  }, [onCheck, onPlayed, snapshot, live, me, sound, video]);

  /** The person's input for the next tick, as a row of the log when something changed (or a move or a roll was pressed). */
  const readInput = (st) => {
    const b = st.b;
    const u = b.units[me];
    if (!st.input || !u || u.fainted) return;
    const inp = st.input.take(st.held, 1);
    if (st.click) { inp.use = 0; st.click = false; }
    // the aim: the mouse while it moves over the field, otherwise the nearest foe (or straight ahead)
    let aim = null;
    if (st.mouse && performance.now() - st.mouse.at < AIM_MOUSE_MS) aim = st.r.toWorld(st.mouse.x, st.mouse.y);
    if (!aim) {
      let best = null;
      let bd = 18 * 18;
      for (const o of b.units) {
        if (o.fainted || o.team === u.team) continue;
        const d = (o.x - u.x) ** 2 + (o.y - u.y) ** 2;
        if (d < bd) { bd = d; best = o; }
      }
      aim = best ? { x: best.x, y: best.y } : { x: u.x + u.fx * 6, y: u.y + u.fy * 6 };
    }
    aim = { x: Math.max(0, Math.min(b.arena.w, aim.x)), y: Math.max(0, Math.min(b.arena.h, aim.y)) };
    st.r.aim = aim;
    const row = [b.t + 1, Math.round(inp.mx * 1000), Math.round(inp.my * 1000), inp.use >= 0 && inp.use < 4 ? inp.use : -1,
      Math.round(aim.x * 100), Math.round(aim.y * 100), inp.dodge ? 1 : 0];
    const prev = st.lastRow;
    if (row[3] >= 0 || row[6] || !prev || prev[1] !== row[1] || prev[2] !== row[2]) {
      b.input(row);
      st.lastRow = row;
    }
  };

  // the loop: 30 ticks a second times the speed, drawing every frame
  useEffect(() => {
    let raf = 0;
    let lastHud = 0;
    const frame = (now) => {
      raf = requestAnimationFrame(frame);
      const st = sim.current;
      if (!st) return;
      const dt = st.last ? Math.min(0.1, (now - st.last) / 1000) : 0;
      st.last = now;
      const ph = phaseRef.current;
      if (ph === "intro" && (now - st.introAt) / 1000 >= INTRO_S) setPhase("running");
      if (ph === "running" && !st.b.ended) {
        // while the person's Pokémon stands, the battle runs at its own pace
        const playing = live && me >= 0 && !st.b.units[me].fainted;
        st.acc += dt * (playing ? 1 : speedRef.current);
        let n = 0;
        while (st.acc >= 1 / TPS && n++ < 40 && !st.b.ended) {
          st.acc -= 1 / TPS;
          if (playing) readInput(st);
          st.b.step();
        }
        if (st.b.ended) finish();
        if (video?.onProgress) {
          const end = Math.max(1, Number(video.ticks) || st.b.timeLimit);
          video.onProgress(Math.min(1, st.b.t / end));
        }
      }
      st.r.draw(ph === "paused" ? 0 : dt);
      if (now - lastHud > 180) { lastHud = now; snapshot(); }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [finish, snapshot]); // eslint-disable-line react-hooks/exhaustive-deps

  // camera: wheel zooms, drag pans, a click follows a Pokémon (a click on nothing stops following); playing, a click fires move 1
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return undefined;
    let drag = null;
    const rect = () => c.getBoundingClientRect();
    const playing = () => live && sim.current && !sim.current.b.units[me]?.fainted;
    const wheel = (e) => { e.preventDefault(); const r = rect(); sim.current?.r.zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.18 : 1 / 1.18); };
    const down = (e) => { drag = { x: e.clientX, y: e.clientY, moved: 0 }; c.setPointerCapture?.(e.pointerId); unlock(); };
    const move = (e) => {
      const st = sim.current;
      if (st) { const r = rect(); st.mouse = { x: e.clientX - r.left, y: e.clientY - r.top, at: performance.now() }; }
      if (!drag || !st) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      drag.x = e.clientX;
      drag.y = e.clientY;
      if (drag.moved > 4 && !playing()) { st.r.pan(dx, dy); st.r.auto = false; setAuto(false); }
    };
    const up = (e) => {
      const st = sim.current;
      if (drag && drag.moved <= 4 && st) {
        if (playing()) {
          if (phaseRef.current === "running") st.click = true;
        } else {
          const r = rect();
          const who = st.r.pick(e.clientX - r.left, e.clientY - r.top);
          st.r.follow = who;
          st.r.auto = false;
          setAuto(false);
          if (who >= 0 && st.r.cam.zoom < 2.2) st.r.cam.zoom = 2.6;
          setFollow(who);
        }
      }
      drag = null;
    };
    const leave = () => { if (sim.current) sim.current.mouse = null; };
    const dbl = () => { if (playing()) return; sim.current?.r.reset(); setFollow(-1); setAuto(false); };
    c.addEventListener("wheel", wheel, { passive: false });
    c.addEventListener("pointerdown", down);
    c.addEventListener("pointermove", move);
    c.addEventListener("pointerup", up);
    c.addEventListener("pointerleave", leave);
    c.addEventListener("dblclick", dbl);
    return () => {
      c.removeEventListener("wheel", wheel);
      c.removeEventListener("pointerdown", down);
      c.removeEventListener("pointermove", move);
      c.removeEventListener("pointerup", up);
      c.removeEventListener("pointerleave", leave);
      c.removeEventListener("dblclick", dbl);
    };
  }, [live, me]);

  // keyboard. Watching: space pauses, 1-4 speeds. Playing: the controls (input.js), Esc or P pauses; once the person's Pokémon is
  // down, the watching keys come back.
  useEffect(() => {
    const isField = (e) => ["INPUT", "TEXTAREA", "SELECT"].includes(e.target?.tagName);
    const playing = () => live && sim.current && !sim.current.b.units[me]?.fainted && !sim.current.b.ended;
    const down = (e) => {
      if (isField(e)) return;
      const st = sim.current;
      if (playing()) {
        if (e.code === "Escape" || e.code === "KeyP") { setPhase((p) => (p === "running" ? "paused" : p === "paused" ? "running" : p)); return; }
        st.held.add(e.code);
        unlock();
        if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
        if (!e.repeat) st.input.key(e.code, true, true, 1);
        return;
      }
      if (e.code === "Space") { e.preventDefault(); setPhase((p) => (p === "running" ? "paused" : p === "paused" ? "running" : p)); }
      const n = ["Digit1", "Digit2", "Digit3", "Digit4"].indexOf(e.code);
      if (n >= 0) setSpeed(SPEEDS[n]);
    };
    const up = (e) => { sim.current?.held.delete(e.code); };
    const blur = () => { sim.current?.held.clear(); };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [live, me]);

  const skip = () => {
    const st = sim.current;
    if (!st) return;
    while (!st.b.ended) st.b.step();
    st.r.eventIndex = st.b.events.length;
    finish();
  };
  const followBest = () => {
    const st = sim.current;
    if (!st) return;
    const best = st.b.units.filter((u) => !u.fainted).sort((a, b) => b.kos - a.kos || b.dealt - a.dealt || a.i - b.i)[0];
    if (!best) return;
    st.r.follow = best.i;
    st.r.auto = false;
    setAuto(false);
    if (st.r.cam.zoom < 2.2) st.r.cam.zoom = 2.6;
    setFollow(best.i);
  };
  const autoCam = () => {
    const st = sim.current;
    if (!st) return;
    st.r.follow = -1;
    st.r.auto = true;
    setFollow(-1);
    setAuto(true);
  };

  if (error) return <div className="banner banner-warn">{String(error.message || error)}</div>;
  const mode = doc.spec.mode;
  const b = sim.current?.b;
  const sum = b?.ended ? b.summary() : null;
  const meDown = me >= 0 && hud?.follow?.mine && hud.follow.fainted;
  const controlsLocked = live && !meDown && phase !== "ended";
  return (
    <div className="mass-screen space-y-2">
      <div className="mass-top">
        {hud && mode === "boss" && hud.giants.map((g) => (
          <div key={g.i} className="mass-boss">
            <div className="mass-boss-name"><b>{g.name}</b><span className="num">{Math.ceil((100 * g.hp) / g.maxhp)}%</span></div>
            <div className="mass-bar is-big"><span style={{ width: `${(100 * g.hp) / g.maxhp}%`, background: g.color }} /></div>
          </div>
        ))}
        {hud && mode !== "ffa" && (
          <div className="mass-teams">
            {hud.teams.filter((_, i) => mode !== "boss" || i > 0).map((tm, k) => (
              <div key={`${tm.name}${k}`} className={`mass-team ${tm.alive ? "" : "is-out"}`}>
                <span className="mass-dot" style={{ background: tm.color }} />
                <span className="truncate">{tm.name}</span>
                <span className="num">{tm.alive}/{tm.size}</span>
                <div className="mass-bar"><span style={{ width: `${tm.maxhp ? (100 * tm.hp) / tm.maxhp : 0}%`, background: tm.color }} /></div>
              </div>
            ))}
          </div>
        )}
        {hud && mode === "ffa" && <div className="mass-left"><b className="num">{hud.alive}</b> {t("mass_left", { n: hud.total })}</div>}
        {hud && <div className="mass-clock num">{fmt(hud.t)} / {fmt(hud.limit)}</div>}
      </div>
      <div ref={wrapRef} className={`mass-stage ${live ? "is-playing" : ""}`}>
        <canvas ref={canvasRef} className="mass-canvas" />
        {phase === "loading" && (
          <div className="mass-overlay"><div className="mass-card"><b>{t("mass_loading")}</b><div className="help num">{progress[0]}/{progress[1] || "…"}</div></div></div>
        )}
        {phase === "intro" && (
          <div className="mass-overlay is-clear">
            <div className="mass-intro">
              <h2>{doc.title}</h2>
              <div className="mass-who">{me >= 0 && hud?.follow ? `${t("mass_you")}: ${hud.follow.name}` : t("mass_who_wins")}</div>
              <IntroCount t={t} />
            </div>
          </div>
        )}
        {phase === "paused" && live && <div className="mass-overlay is-clear"><div className="mass-intro"><h2>{t("mass_pause")}</h2></div></div>}
        {hud && hud.feed.length > 0 && (
          <div className="mass-feed">
            {hud.feed.map((f) => (
              <div key={f.key} className={f.mine ? "is-mine" : ""}>
                {f.by ? <><span style={{ color: f.bc }}>{f.by}</span> › </> : null}<span style={{ color: f.vc }}>{f.victim}</span>
              </div>
            ))}
          </div>
        )}
        {hud?.follow && (
          <div className={`mass-follow ${hud.follow.mine ? "is-mine" : ""}`}>
            <b style={{ color: hud.follow.color }}>{hud.follow.name}</b> <span className="help">{hud.follow.team}</span>
            <div className="mass-bar mass-follow-hp"><span style={{ width: `${(100 * hud.follow.hp) / hud.follow.maxhp}%`, background: hud.follow.hp / hud.follow.maxhp > 0.5 ? "#46d369" : hud.follow.hp / hud.follow.maxhp > 0.2 ? "#f5c542" : "#e5484d" }} /></div>
            <div className="num">{hud.follow.hp}/{hud.follow.maxhp} · {t("mass_kos", { n: hud.follow.kos })}</div>
            <div className="mass-moves">
              {hud.follow.moves.map((m, k) => (
                <span key={`${m.name}${k}`} className={m.ready ? "is-ready" : ""}>
                  {hud.follow.mine && <kbd>{k + 1}</kbd>} {moveName(m.name)}{!m.ready && hud.follow.mine ? ` ${m.left.toFixed(1)}s` : ""}
                </span>
              ))}
            </div>
          </div>
        )}
        {meDown && phase === "running" && live && <div className="mass-toast">{t("mass_you_fell")}</div>}
        {phase === "ended" && sum && (
          <div className="mass-overlay is-end">
            <div className="mass-card mass-result">
              <div className="mass-banner" style={{ background: sum.winner >= 0 ? b.teams[sum.winner].color : "#555" }}>
                {sum.winner >= 0 ? t("mass_wins", { name: sum.winner_name }) : t("mass_tie")}
              </div>
              <div className="help">{t(`mass_reason_${sum.reason}`, { s: fmt(sum.seconds) })}</div>
              {sum.player && (
                <div className="mass-mine">
                  <b>{t("mass_your_result", { name: sum.player.name, place: sum.player.place, n: sum.units, kos: sum.player.kos, dmg: sum.player.dealt })}</b>
                  {mode !== "ffa" && <div>{sum.player.team_won ? t("mass_team_won") : t("mass_team_lost")}</div>}
                </div>
              )}
              {sum.mvp && <div>{t("mass_mvp", { name: sum.mvp.name, n: sum.mvp.kos })}</div>}
              <table className="mass-rank">
                <thead><tr><th>#</th><th>{t("mass_pokemon")}</th>{mode !== "ffa" && <th>{t("mass_team")}</th>}<th>{t("mass_kos_h")}</th><th>{t("mass_damage")}</th></tr></thead>
                <tbody>
                  {sum.ranking.slice(0, 10).map((r) => (
                    <tr key={r.i} className={r.i === me ? "is-mine" : ""}><td className="num">{r.place}</td><td>{r.name}{r.alive ? " ★" : ""}</td>{mode !== "ffa" && <td>{r.team_name}</td>}<td className="num">{r.kos}</td><td className="num">{r.dealt}</td></tr>
                  ))}
                </tbody>
              </table>
              {played?.state === "saving" && <div className="help">{t("mass_play_saving")}</div>}
              {played?.state === "saved" && !played.node && <div className="help">{played.message || t("mass_play_saved")}</div>}
              {played?.node}
              {played?.state === "bad" && <div className="help text-amber-300">{t("mass_play_bad", { msg: played.msg })}</div>}
              {check && <div className={`help ${check.same ? "" : "text-amber-300"}`}>{check.same ? t("mass_check_ok") : t("mass_check_bad")}</div>}
              {extra}
              <div className="flex flex-wrap justify-center gap-2">
                {onAgain && <button type="button" className="btn btn-primary" onClick={onAgain}>{live ? t("mass_play_again") : t("mass_again")}</button>}
                {onBack && <button type="button" className="btn" onClick={onBack}>{t("mass_back")}</button>}
              </div>
            </div>
          </div>
        )}
      </div>
      {!video && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-sm" disabled={phase !== "running" && phase !== "paused"} onClick={() => setPhase((p) => (p === "running" ? "paused" : "running"))}>
            {phase === "paused" ? t("mass_resume") : t("mass_pause")}
          </button>
          <div className="seg" role="group" aria-label={t("mass_speed")}>
            {SPEEDS.map((v) => <button key={v} type="button" aria-pressed={speed === v} disabled={controlsLocked} onClick={() => setSpeed(v)}>×{v}</button>)}
          </div>
          <button type="button" className="btn btn-sm" disabled={phase === "ended" || phase === "loading" || controlsLocked} onClick={skip}>{t("mass_skip")}</button>
          {!controlsLocked && <button type="button" className="btn btn-sm" onClick={followBest} disabled={phase === "loading"}>{t("mass_follow_best")}</button>}
          {!controlsLocked && <button type="button" className="btn btn-sm" aria-pressed={auto} onClick={autoCam}>{t("mass_auto_cam")}</button>}
          {!controlsLocked && <button type="button" className="btn btn-sm" onClick={() => { sim.current?.r.reset(); setFollow(-1); setAuto(false); }}>{t("mass_whole_field")}</button>}
          <span className="help">{controlsLocked ? t("mass_keys") : follow >= 0 ? t("mass_following") : t("mass_camera_help")}</span>
        </div>
      )}
    </div>
  );
}

function IntroCount({ t }) {
  const [n, setN] = useState(3);
  useEffect(() => {
    const h = setInterval(() => setN((x) => x - 1), 800);
    return () => clearInterval(h);
  }, []);
  return <div className="mass-count">{n > 0 ? n : t("mass_fight")}</div>;
}
