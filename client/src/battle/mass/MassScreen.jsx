// The screen of a mass battle: the app already ran it in the engine (silvers_hoard/mass.py), and this screen runs the same spec
// again, tick by tick, so you watch it happen: an intro with the title and a countdown, the field with every Pokémon, the sides'
// bars at the top (the giants' big health bar in "many against a few"), the knockouts in a feed, speeds up to ×8, a jump to the
// end, a camera that zooms (wheel), pans (drag) and follows whoever you click, and the result with the ranking. At the end the
// screen compares its own run with the engine's: the same spec gives the same battle.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { MassBattle, TPS } from "../../../../engine/src/realtime/mass.mjs";
import { MassRenderer } from "./render.js";
import "./mass.css";

const SPEEDS = [1, 2, 4, 8];
const INTRO_S = 3.2;

function fmt(s) {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, "0")}`;
}

export default function MassScreen({ doc, t, sprites, base = "", offline = false, onCheck = null, onAgain = null, onBack = null }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const sim = useRef(null);
  const [phase, setPhase] = useState("loading");
  const [progress, setProgress] = useState([0, 0]);
  const [speed, setSpeed] = useState(1);
  const [hud, setHud] = useState(null);
  const [follow, setFollow] = useState(-1);
  const [check, setCheck] = useState(null);
  const [error, setError] = useState(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const speedRef = useRef(speed);
  speedRef.current = speed;

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
      feed.push({ key: i, victim: v.name, vc: b.teams[v.team].color, by: k ? k.name : "", bc: k ? b.teams[k.team].color : "" });
    }
    const teams = b.teamStats();
    const giants = b.units.filter((u) => u.boss).map((u) => ({ i: u.i, name: u.name, hp: u.hp, maxhp: u.maxhp, color: b.teams[u.team].color, fainted: u.fainted }));
    const alive = b.units.filter((u) => !u.fainted).length;
    const f = st.r.follow >= 0 ? b.units[st.r.follow] : null;
    setHud({ t: b.t / TPS, limit: b.timeLimit / TPS, teams, giants, alive, total: b.units.length, feed, ended: b.ended,
      follow: f ? { name: f.name, species: f.species, team: b.teams[f.team].name, color: b.teams[f.team].color, hp: f.hp, maxhp: f.maxhp, kos: f.kos,
        moves: f.moves.map((m, s) => ({ name: m.name, ready: f.cds[s] <= b.t })) } : null });
  }, []);

  // build the battle and the renderer, load the sprites
  useEffect(() => {
    let cancelled = false;
    let b;
    try {
      b = new MassBattle(doc.spec);
    } catch (e) {
      setError(e);
      return undefined;
    }
    const r = new MassRenderer(canvasRef.current, b, { sprites, base, offline, texts: { immune: t("mass_immune") } });
    sim.current = { b, r, acc: 0, last: 0, introAt: 0 };
    // for checks from the browser console (and the app's QA)
    window.__silverMass = { get battle() { return sim.current?.b; }, get renderer() { return sim.current?.r; } };
    r.resize(wrapRef.current?.clientWidth || 900);
    r.draw(0);
    // the crowd starts with its icons (one picture); the walking sprites keep arriving during the battle and replace them
    r.preload((d, n) => { if (!cancelled) setProgress([d, n]); }, 5000).then(() => {
      if (cancelled) return;
      sim.current.introAt = performance.now();
      setPhase("intro");
    });
    snapshot();
    return () => { cancelled = true; };
  }, [doc, sprites, base, offline]); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (onCheck) {
      try { setCheck(await onCheck(st.b.hash())); } catch { setCheck(null); }
    }
  }, [onCheck, snapshot]);

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
        st.acc += dt * speedRef.current;
        let n = 0;
        while (st.acc >= 1 / TPS && n++ < 40 && !st.b.ended) { st.acc -= 1 / TPS; st.b.step(); }
        if (st.b.ended) finish();
      }
      st.r.draw(ph === "paused" ? 0 : dt);
      if (now - lastHud > 180) { lastHud = now; snapshot(); }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [finish, snapshot]);

  // camera: wheel zooms, drag pans, a click follows a Pokémon (a click on nothing stops following)
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return undefined;
    let drag = null;
    const rect = () => c.getBoundingClientRect();
    const wheel = (e) => { e.preventDefault(); const r = rect(); sim.current?.r.zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.18 : 1 / 1.18); };
    const down = (e) => { drag = { x: e.clientX, y: e.clientY, moved: 0 }; c.setPointerCapture?.(e.pointerId); };
    const move = (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      drag.x = e.clientX;
      drag.y = e.clientY;
      if (drag.moved > 4) sim.current?.r.pan(dx, dy);
    };
    const up = (e) => {
      const st = sim.current;
      if (drag && drag.moved <= 4 && st) {
        const r = rect();
        const who = st.r.pick(e.clientX - r.left, e.clientY - r.top);
        st.r.follow = who;
        if (who >= 0 && st.r.cam.zoom < 2.2) st.r.cam.zoom = 2.6;
        setFollow(who);
      }
      drag = null;
    };
    const dbl = () => { sim.current?.r.reset(); setFollow(-1); };
    c.addEventListener("wheel", wheel, { passive: false });
    c.addEventListener("pointerdown", down);
    c.addEventListener("pointermove", move);
    c.addEventListener("pointerup", up);
    c.addEventListener("dblclick", dbl);
    return () => {
      c.removeEventListener("wheel", wheel);
      c.removeEventListener("pointerdown", down);
      c.removeEventListener("pointermove", move);
      c.removeEventListener("pointerup", up);
      c.removeEventListener("dblclick", dbl);
    };
  }, []);

  // keyboard: space pauses, 1-4 speeds
  useEffect(() => {
    const key = (e) => {
      if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target?.tagName)) return;
      if (e.code === "Space") { e.preventDefault(); setPhase((p) => (p === "running" ? "paused" : p === "paused" ? "running" : p)); }
      const n = ["Digit1", "Digit2", "Digit3", "Digit4"].indexOf(e.code);
      if (n >= 0) setSpeed(SPEEDS[n]);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

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
    if (st.r.cam.zoom < 2.2) st.r.cam.zoom = 2.6;
    setFollow(best.i);
  };

  if (error) return <div className="banner banner-warn">{String(error.message || error)}</div>;
  const mode = doc.spec.mode;
  const sum = sim.current?.b.ended ? sim.current.b.summary() : null;
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
            {hud.teams.filter((_, i) => mode !== "boss" || i > 0).map((tm) => (
              <div key={tm.name} className={`mass-team ${tm.alive ? "" : "is-out"}`}>
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
      <div ref={wrapRef} className="mass-stage">
        <canvas ref={canvasRef} className="mass-canvas" />
        {phase === "loading" && (
          <div className="mass-overlay"><div className="mass-card"><b>{t("mass_loading")}</b><div className="help num">{progress[0]}/{progress[1] || "…"}</div></div></div>
        )}
        {phase === "intro" && (
          <div className="mass-overlay is-clear">
            <div className="mass-intro">
              <h2>{doc.title}</h2>
              <div className="mass-who">{t("mass_who_wins")}</div>
              <IntroCount t={t} />
            </div>
          </div>
        )}
        {hud && hud.feed.length > 0 && (
          <div className="mass-feed">
            {hud.feed.map((f) => (
              <div key={f.key}>
                {f.by ? <><span style={{ color: f.bc }}>{f.by}</span> › </> : null}<span style={{ color: f.vc }}>{f.victim}</span>
              </div>
            ))}
          </div>
        )}
        {hud?.follow && (
          <div className="mass-follow">
            <b style={{ color: hud.follow.color }}>{hud.follow.name}</b> <span className="help">{hud.follow.team}</span>
            <div className="num">{hud.follow.hp}/{hud.follow.maxhp} · {t("mass_kos", { n: hud.follow.kos })}</div>
            <div className="mass-moves">{hud.follow.moves.map((m) => <span key={m.name} className={m.ready ? "is-ready" : ""}>{m.name}</span>)}</div>
          </div>
        )}
        {phase === "ended" && sum && (
          <div className="mass-overlay is-end">
            <div className="mass-card mass-result">
              <div className="mass-banner" style={{ background: sum.winner >= 0 ? sim.current.b.teams[sum.winner].color : "#555" }}>
                {sum.winner >= 0 ? t("mass_wins", { name: sum.winner_name }) : t("mass_tie")}
              </div>
              <div className="help">{t(`mass_reason_${sum.reason}`, { s: fmt(sum.seconds) })}</div>
              {sum.mvp && <div>{t("mass_mvp", { name: sum.mvp.name, n: sum.mvp.kos })}</div>}
              <table className="mass-rank">
                <thead><tr><th>#</th><th>{t("mass_pokemon")}</th>{mode !== "ffa" && <th>{t("mass_team")}</th>}<th>{t("mass_kos_h")}</th><th>{t("mass_damage")}</th></tr></thead>
                <tbody>
                  {sum.ranking.slice(0, 10).map((r) => (
                    <tr key={r.i}><td className="num">{r.place}</td><td>{r.name}{r.alive ? " ★" : ""}</td>{mode !== "ffa" && <td>{r.team_name}</td>}<td className="num">{r.kos}</td><td className="num">{r.dealt}</td></tr>
                  ))}
                </tbody>
              </table>
              {check && <div className={`help ${check.same ? "" : "text-amber-300"}`}>{check.same ? t("mass_check_ok") : t("mass_check_bad")}</div>}
              <div className="flex flex-wrap justify-center gap-2">
                {onAgain && <button type="button" className="btn btn-primary" onClick={onAgain}>{t("mass_again")}</button>}
                {onBack && <button type="button" className="btn" onClick={onBack}>{t("mass_back")}</button>}
              </div>
            </div>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-sm" disabled={phase !== "running" && phase !== "paused"} onClick={() => setPhase((p) => (p === "running" ? "paused" : "running"))}>
          {phase === "paused" ? t("mass_resume") : t("mass_pause")}
        </button>
        <div className="seg" role="group" aria-label={t("mass_speed")}>
          {SPEEDS.map((v) => <button key={v} type="button" aria-pressed={speed === v} onClick={() => setSpeed(v)}>×{v}</button>)}
        </div>
        <button type="button" className="btn btn-sm" disabled={phase === "ended" || phase === "loading"} onClick={skip}>{t("mass_skip")}</button>
        <button type="button" className="btn btn-sm" onClick={followBest} disabled={phase === "loading"}>{t("mass_follow_best")}</button>
        <button type="button" className="btn btn-sm" onClick={() => { sim.current?.r.reset(); setFollow(-1); }}>{t("mass_whole_field")}</button>
        <span className="help">{follow >= 0 ? t("mass_following") : t("mass_camera_help")}</span>
      </div>
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
