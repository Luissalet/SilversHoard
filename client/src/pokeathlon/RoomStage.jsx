// A Pokéathlon room in play, for the host (inside the app) and for a friend or a spectator (the page the room server serves): the lobby
// where the people gather, then for every event the introduction (everybody presses ready once their sprites are in), the event itself in
// lockstep (runner.js + lockstep.js: this page runs the whole event, the room only relays the people's inputs), the results the host's page
// sent, and after the last event the closing ceremony. The WebSocket (pknet.js) may drop and come back: the room's "hello" says where the
// round stands and this page catches up. Messages arrive in handle(); the round's runner listens on `bus`.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../context.js";
import Ceremony from "./Ceremony.jsx";
import { TeamIcons } from "./parts.jsx";
import { hashSeed } from "./core.js";
import { Course, savePayload } from "./course.js";
import { saveResult } from "./data.js";
import { EVENTS } from "./events/index.js";
import { PkNet } from "./pknet.js";
import { EventRunner } from "./runner.js";
import { Intro, Results, evName } from "./Stage.jsx";
import { makeS } from "./strings.js";

const RESULTS_SECONDS = 14;

function useLocal(key, initial) {
  const [v, setV] = useState(() => { try { const r = localStorage.getItem(key); return r === null ? initial : JSON.parse(r); } catch { return initial; } });
  const set = (x) => { setV(x); try { localStorage.setItem(key, JSON.stringify(x)); } catch { /* not critical */ } };
  return [v, set];
}

/** Append frames to a buffer the way the room's stores do: only the ones that continue it. */
function pushFrames(buf, team, from, list) {
  const mine = buf.frames[team];
  (list || []).forEach((f, i) => { if (from + i === mine.length + 1) mine.push(f); });
}

const freshBuf = (r) => ({ r, go: null, ready: [], frames: [[], [], [], []] });

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

function LinkRow({ label, urls, s }) {
  const list = urls.filter(Boolean);
  const [copied, setCopied] = useState("");
  if (!list.length) return null;
  return (
    <div className="pk-linkrow">
      <span className="label">{label}</span>
      {list.map((u) => (
        <div key={u} className="pk-linkline">
          <input className="field num" readOnly value={u} aria-label={label} onFocus={(e) => e.target.select()} />
          <button type="button" className="btn btn-sm" onClick={async () => { if (await copyText(u)) { setCopied(u); setTimeout(() => setCopied(""), 1500); } }}>
            {copied === u ? s("room_copied") : s("room_copy")}
          </button>
        </div>
      ))}
    </div>
  );
}

function Lobby({ view, host, room, me, s, lang, status, onStart, onClose, onLeave }) {
  const { sprites } = useApp();
  const en = lang === "en" ? "en" : "es";
  const names = view.events.map((id) => EVENTS[id].names[en]);
  const title = view.event ? s("course_single") : s(`course_${view.course}`);
  const taken = view.seats.filter((x) => x.name).length;
  return (
    <div className="pk-lobby panel space-y-3">
      <div>
        <h1>{s("room_title", { name: title })}</h1>
        <p className="help">{names.join(" · ")}{view.supreme && view.course !== "supreme" ? ` · ${s("diff_supreme")}` : ""}</p>
      </div>
      <ul className="pk-seats">
        {view.seats.map((x) => (
          <li key={x.seat} className={`pk-seat${x.name ? " is-taken" : ""}${x.seat === me.seat && me.role === "seat" ? " is-you" : ""}`} style={{ "--team": ["#e5483d", "#3b82e6", "#35b25c", "#f0b429"][x.seat] }}>
            <span className="pk-dot" />
            {x.name ? (
              <>
                <strong className="trunc">{x.name}</strong>
                <span className="help trunc">{x.team}</span>
                <span className="pk-icons">{x.species.map((sp, i) => <img key={i} src={sprites.fallback(sp)} alt={sp} title={sp} width="28" height="28" className="pixelated" loading="lazy" />)}</span>
                {x.host && <span className="chip">{s("room_host")}</span>}
                <span className={`chip${x.connected ? "" : " chip-amber"}`}>{x.connected ? s("room_online") : s("room_offline")}</span>
              </>
            ) : x.free ? <span className="help">{s("room_seat_free")}</span> : <span className="help">{s("room_seat_cpu")}</span>}
          </li>
        ))}
      </ul>
      <p className="help">{s("room_npc_note")}{view.spectators ? ` · ${s("room_spectators", { n: view.spectators })}` : ""}</p>
      {host && room && room.links && (
        <div className="space-y-2">
          <LinkRow label={s("room_link_join")} urls={[...(room.links.public ? [room.links.public] : []), ...(room.links.lan || []), room.links.local]} s={s} />
          <LinkRow label={s("room_link_watch")} urls={[...(room.watch_links.public ? [room.watch_links.public] : []), ...(room.watch_links.lan || []), room.watch_links.local]} s={s} />
        </div>
      )}
      <div className="flex flex-wrap gap-2 items-center">
        {host ? (
          <>
            <button type="button" className="btn btn-primary" disabled={status !== "open"} onClick={onStart} autoFocus>{s("room_start", { n: taken })}</button>
            <button type="button" className="btn" onClick={onClose}>{s("room_close")}</button>
          </>
        ) : (
          <>
            <span className="help" role="status">{me.role === "watch" ? s("room_wait_watch") : s("room_wait_host")}</span>
            <button type="button" className="btn" onClick={onLeave}>{s("leave")}</button>
          </>
        )}
      </div>
    </div>
  );
}

/** One event of the course: the introduction (loading the sprites, ready), then the canvas. */
function RoundPlay({ cfg, round, me, view, net, bus, boot, base, s, lang, onFinished, onLeave }) {
  const { sprites } = useApp();
  const eventId = cfg.events[round];
  const seat = me.role === "seat" ? me.seat : -1;
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const runnerRef = useRef(null);
  const finishRef = useRef(onFinished);
  finishRef.current = onFinished;
  const viewRef = useRef(view);
  viewRef.current = view;
  const [loaded, setLoaded] = useState(false);
  const [started, setStarted] = useState(false);
  const [ready, setReady] = useState(boot.r === round ? boot.ready || [] : []);
  const [full, setFull] = useState(false);
  const [muted, setMuted] = useLocal("silver-pokeathlon-muted", false);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  const fit = useCallback(() => {
    const w = wrapRef.current;
    const r = runnerRef.current;
    if (!w || !r) return;
    const isFull = document.fullscreenElement === w;
    const width = isFull ? Math.min(w.clientWidth, (w.clientHeight - 56) * (16 / 9)) : Math.min(w.clientWidth, 1280);
    r.resize(Math.max(320, width));
  }, []);

  useEffect(() => {
    const seats = viewRef.current.seats;
    const teams = cfg.teams.map((t, i) => ({ ...t, human: !!(seats[i] && seats[i].human), mons: t.mons.map((m) => ({ ...m })) }));
    let pendingGo = boot.r === round && boot.go ? boot.go.humans : null;
    const run = new EventRunner({
      canvas: canvasRef.current, mod: EVENTS[eventId], teams, seed: hashSeed(cfg.seed, eventId, round), lang, mode: seat >= 0 ? "play" : "watch",
      supreme: cfg.supreme, base, iconUrl: (mon) => sprites.fallback(mon.species), muted: mutedRef.current,
      lockstep: {
        seat, delay: cfg.delay,
        send: (from, frames) => net.send({ k: "in", r: round, from, frames }, true),
        hash: (t, h) => net.send({ k: "hash", r: round, t, h: String(h) }, true),
        done: (res, sum) => net.send({ k: "done", r: round, res, sum: String(sum) }),
      },
      onFinish: (res) => finishRef.current(res),
      onPhase: (p) => {
        if (p !== "ready") return;
        setLoaded(true);
        if (pendingGo && !run.inst) { run.begin(pendingGo, { catchUp: true }); setStarted(true); }
      },
    });
    runnerRef.current = run;
    const begin = (humans, catchUp) => {
      if (run.inst) return;
      if (run.phase !== "ready") { pendingGo = humans; return; }
      run.begin(humans, { catchUp });
      setStarted(true);
    };
    const onMsg = (m) => {
      if (m.k === "hello") {
        if (m.round !== round) return;
        for (let t = 0; t < 4; t++) run.feed(t, 1, (m.frames && m.frames[t]) || []);
        if (seat >= 0 && m.have) run.resend(m.have[seat] || 0);
        if (m.ready) setReady(m.ready);
        if (m.phase === "play" && !run.inst) begin(m.humans, true);
        return;
      }
      if (m.r !== round) return;
      if (m.k === "in") run.feed(m.seat, m.from, m.frames);
      else if (m.k === "ready") setReady(m.seats);
      else if (m.k === "go") begin(m.humans, false);
    };
    bus.add(onMsg);
    if (boot.r === round) for (let t = 0; t < 4; t++) if (boot.frames[t].length) run.feed(t, 1, boot.frames[t]);
    fit();
    run.prepare();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : null;
    if (ro && wrapRef.current) ro.observe(wrapRef.current);
    const onFs = () => { setFull(document.fullscreenElement === wrapRef.current); fit(); };
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      bus.delete(onMsg);
      document.removeEventListener("fullscreenchange", onFs);
      if (ro) ro.disconnect();
      run.destroy();
      runnerRef.current = null;
    };
  }, [eventId, round]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (started) { fit(); const id = requestAnimationFrame(fit); return () => cancelAnimationFrame(id); } return undefined; }, [started, fit]);
  useEffect(() => { if (runnerRef.current) runnerRef.current.muted = muted; }, [muted]);

  const toggleFull = () => {
    const w = wrapRef.current;
    if (!w) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if (w.requestFullscreen) w.requestFullscreen().catch(() => {});
  };

  const mine = seat >= 0 ? view.seats[seat] : null;
  const playing = !!(mine && mine.human);
  const iAmReady = ready.includes(seat);
  const waitingFor = view.seats.filter((x) => x.human && x.seat !== seat && !ready.includes(x.seat)).map((x) => x.name);
  const actions = (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2 items-center">
        {playing ? (
          <button type="button" className="btn btn-primary" disabled={!loaded || iAmReady} autoFocus
            onClick={() => { net.send({ k: "ready", r: round }); setReady((x) => [...new Set([...x, seat])]); }}>
            {!loaded ? s("loading_sprites") : iAmReady ? s("room_ready_wait") : s("room_ready")}
          </button>
        ) : <span className="help" role="status">{seat >= 0 ? s("room_cpu_took_you") : s("room_wait_watch")}</span>}
        <button type="button" className="btn" onClick={onLeave}>{s("leave")}</button>
      </div>
      {playing && iAmReady && waitingFor.length > 0 && <p className="help" role="status">{s("room_waiting_for", { names: waitingFor.join(", ") })}</p>}
    </div>
  );

  return (
    <>
      {!started && (
        <Intro eventId={eventId} round={round} total={cfg.events.length} config={{ ...cfg, mode: seat >= 0 ? "play" : "watch" }} bestScore={null} s={s} lang={lang} actions={actions} />
      )}
      <div className={`pk-stage${full ? " is-full" : ""}`} ref={wrapRef} style={started ? undefined : { display: "none" }}>
        <div className="pk-toolbar">
          <strong className="trunc">{evName(eventId, lang)}</strong>
          {view.spectators > 0 && <span className="chip">{s("room_spectators", { n: view.spectators })}</span>}
          <span className="grow" />
          <button type="button" className="btn btn-sm" onClick={() => setMuted(!muted)} aria-pressed={!muted} title={muted ? s("sound_off") : s("sound_on")}>
            {muted ? s("sound_off") : s("sound_on")}
          </button>
          <button type="button" className="btn btn-sm" onClick={toggleFull}>{full ? s("exit_fullscreen") : s("fullscreen")}</button>
          <button type="button" className="btn btn-sm" onClick={onLeave}>{s("leave")}</button>
        </div>
        <div className="pk-canvaswrap">
          <canvas ref={canvasRef} className="pk-canvas" width="960" height="540" aria-label={evName(eventId, lang)} />
        </div>
        {!full && <p className="help pk-help">{EVENTS[eventId].help[lang === "en" ? "en" : "es"]}</p>}
      </div>
    </>
  );
}

function RoomResults({ course, last, cfg, round, s, lang, onNext, onExit }) {
  const isLast = round >= cfg.events.length - 1;
  const auto = !(cfg.single && isLast);
  const [left, setLeft] = useState(RESULTS_SECONDS);
  useEffect(() => {
    if (!auto) return undefined;
    const id = setInterval(() => setLeft((n) => n - 1), 1000);
    return () => clearInterval(id);
  }, [auto]);
  useEffect(() => { if (auto && left <= 0) onNext(); }, [auto, left, onNext]);
  const actions = (
    <div className="flex flex-wrap gap-2 items-center">
      {cfg.single && isLast ? (
        <button type="button" className="btn btn-primary" onClick={onExit} autoFocus>{s("finish")}</button>
      ) : (
        <>
          <button type="button" className="btn btn-primary" onClick={onNext} autoFocus>{isLast ? s("to_ceremony") : s("next_event")}</button>
          <span className="help">{s("room_auto_next", { n: Math.max(0, left) })}</span>
        </>
      )}
    </div>
  );
  return <Results course={course} last={last} config={cfg} s={s} lang={lang} isLast={isLast} actions={actions} />;
}

/**
 * room: the room's view (the host's has the links); wsUrl: where the room's WebSocket is; host: this is the host's own page (it saves the
 * result); base: the URL prefix for the Pokémon walking sprites; onExit(); onClose() (host only: close the room).
 */
export default function RoomStage({ room, wsUrl, host = false, base = "", onExit, onClose }) {
  const { lang, confirm } = useApp();
  const s = useMemo(() => makeS(lang), [lang]);
  const [view, setView] = useState(room);
  const [cfg, setCfg] = useState(null);
  const [me, setMe] = useState({ seat: -1, role: "" });
  const [screen, setScreen] = useState("lobby");     // lobby | round | results | ceremony | closed
  const [round, setRound] = useState(0);
  const [last, setLast] = useState(null);
  const [status, setStatus] = useState("connecting");
  const [notes, setNotes] = useState([]);
  const [tick, setTick] = useState(0);
  const [localDone, setLocalDone] = useState(-1);
  const [closedWhy, setClosedWhy] = useState("");
  const netRef = useRef(null);
  const courseRef = useRef(null);
  const resultsRef = useRef([]);
  const bufRef = useRef(freshBuf(-1));
  const busRef = useRef(new Set());
  const stRef = useRef({});
  stRef.current = { round, screen, cfg };
  const savedSingle = useRef(false);

  const note = (text, kind = "info") => {
    const id = Math.random();
    setNotes((n) => [...n.slice(-2), { id, text, kind }]);
    setTimeout(() => setNotes((n) => n.filter((x) => x.id !== id)), 9000);
  };

  const startCfg = (m) => {
    if (courseRef.current) return;
    const next = { teams: m.teams, events: m.events, seed: m.seed, course: m.course, supreme: !!m.supreme, medal: m.medal || "", single: !!m.single, delay: m.delay || 4, key: m.course };
    courseRef.current = new Course({ key: next.key, events: next.events, teams: next.teams, supreme: next.supreme, seed: next.seed, medal: next.medal });
    setCfg(next);
  };

  const applyResult = (r, res) => {
    const course = courseRef.current;
    if (!course || course.rounds.length !== r || !res) return;
    course.record(course.events[r], res);
    resultsRef.current[r] = res;
  };

  const emit = (m) => busRef.current.forEach((fn) => fn(m));
  // what arrived for round r while no page of it was open yet (a round starts for a computer that is still reading the results)
  const bufFor = (r) => {
    if (r < bufRef.current.r) return null;
    if (r > bufRef.current.r) bufRef.current = freshBuf(r);
    return bufRef.current;
  };

  const handle = (m) => {
    const buf = bufRef.current;
    switch (m.k) {
      case "hello": {
        setMe({ seat: m.seat, role: m.role });
        setView(m.room);
        const first = !courseRef.current;
        if (m.teams) startCfg(m);
        (m.results || []).forEach((res, i) => applyResult(i, res));
        setTick((t) => t + 1);
        if (m.phase === "play") bufRef.current = { r: m.round, go: { humans: m.humans }, ready: m.ready || [], frames: (m.frames || [[], [], [], []]).map((f) => f.slice()) };
        else if (buf.r !== m.round) bufRef.current = { ...freshBuf(m.round), ready: m.ready || [] };
        else buf.ready = m.ready || [];
        const course = courseRef.current;
        const st = stRef.current;
        if (first || st.screen === "lobby") {
          if (m.phase === "lobby") setScreen("lobby");
          else if (m.phase === "ended") setScreen(course && course.rounds.length >= course.events.length ? "ceremony" : "closed");
          else { setRound(m.round); setScreen("round"); }
        }
        emit(m);
        break;
      }
      case "start":
        startCfg(m);
        bufRef.current = freshBuf(0);
        setRound(0);
        setLocalDone(-1);
        setScreen("round");
        break;
      case "room": setView(m.room); break;
      case "ready": {
        const b = bufFor(m.r);
        if (b) b.ready = m.seats;
        emit(m);
        break;
      }
      case "go": {
        const b = bufFor(m.r);
        if (b) b.go = m;
        emit(m);
        break;
      }
      case "in": {
        const b = bufFor(m.r);
        if (b) pushFrames(b, m.seat, m.from, m.frames);
        emit(m);
        break;
      }
      case "result":
        applyResult(m.r, m.res);
        setTick((t) => t + 1);
        break;
      case "left": {
        const t = courseRef.current && courseRef.current.teams[m.seat];
        note(s("room_left", { name: t ? t.name : `#${m.seat + 1}`, why: s(`room_why_${m.why}`) }), "warn");
        break;
      }
      case "desync": note(s("room_desync"), "warn"); break;
      case "closed": {
        const course = courseRef.current;
        if (course && course.rounds.length >= course.events.length) break;
        setClosedWhy(m.why || "");
        setScreen("closed");
        break;
      }
      case "error": note(String(m.error || "error"), "warn"); break;
      default: break;
    }
  };
  const handleRef = useRef(handle);
  handleRef.current = handle;

  useEffect(() => {
    const net = new PkNet({ url: wsUrl, onMessage: (m) => handleRef.current(m), onStatus: setStatus });
    netRef.current = net;
    net.open();
    return () => net.close();
  }, [wsUrl]);

  const toResults = useCallback(() => {
    const course = courseRef.current;
    const st = stRef.current;
    const r = course && course.rounds[st.round];
    if (!r) return;
    setLast({ event: course.events[st.round], ...r });
    setScreen("results");
  }, []);

  // the host's result is the room's result: show it once this page's own banner is over (or soon after, for a page that lags)
  useEffect(() => {
    if (screen !== "round" || !resultsRef.current[round]) return undefined;
    if (localDone === round) { toResults(); return undefined; }
    const id = setTimeout(toResults, 5000);
    return () => clearTimeout(id);
  }, [screen, round, localDone, tick, toResults]);

  // a single event has no ceremony: the host's page saves it when its result is in
  useEffect(() => {
    if (screen !== "results" || !host || !cfg || !cfg.single || savedSingle.current) return;
    savedSingle.current = true;
    saveResult(savePayload(courseRef.current, null, { mode: "play", lang })).catch(() => note(s("not_saved"), "warn"));
  }, [screen]); // eslint-disable-line react-hooks/exhaustive-deps

  const next = useCallback(() => {
    const st = stRef.current;
    if (st.round >= st.cfg.events.length - 1) { setScreen("ceremony"); return; }
    setRound(st.round + 1);
    setLocalDone(-1);
    setScreen("round");
  }, []);

  const exit = () => {
    const net = netRef.current;
    if (net) { net.send({ k: "leave" }); setTimeout(() => net.close(), 200); }
    onExit();
  };
  const leave = async () => {
    if (screen === "round" || screen === "results") {
      const ok = confirm ? await confirm({ title: s("leave"), message: s("room_leave_confirm"), confirmLabel: s("leave"), danger: true }) : true;
      if (!ok) return;
    }
    exit();
  };

  const course = courseRef.current;
  return (
    <div className="pk-room space-y-3">
      {status !== "open" && screen !== "closed" && <div className="banner banner-warn" role="status">{status === "connecting" ? s("room_connecting") : s("room_reconnecting")}</div>}
      {notes.map((n) => <div key={n.id} className={`banner${n.kind === "warn" ? " banner-warn" : ""}`} role="status">{n.text}</div>)}
      {screen === "lobby" && (
        <Lobby view={view} host={host} room={room} me={me} s={s} lang={lang} status={status} onStart={() => netRef.current && netRef.current.send({ k: "start" })}
          onClose={() => { if (onClose) onClose(); }} onLeave={leave} />
      )}
      {screen === "round" && cfg && (
        <RoundPlay key={round} cfg={cfg} round={round} me={me} view={view} net={netRef.current} bus={busRef.current} boot={bufRef.current} base={base} s={s} lang={lang}
          onFinished={() => setLocalDone(round)} onLeave={leave} />
      )}
      {screen === "results" && cfg && last && course && (
        <RoomResults course={course} last={last} cfg={cfg} round={round} s={s} lang={lang} onNext={next} onExit={exit} />
      )}
      {screen === "ceremony" && cfg && course && (
        <Ceremony course={course} config={{ seed: cfg.seed, teams: cfg.teams, medal: cfg.medal, single: cfg.single, mode: "play" }} onExit={exit} onAgain={null} canSave={host} />
      )}
      {screen === "closed" && (
        <div className="panel space-y-3">
          <h1>{s("room_closed")}</h1>
          <p className="help">{closedWhy === "empty" ? s("room_closed_empty") : closedWhy === "forbidden" ? s("room_closed_key") : s("room_closed_help")}</p>
          <button type="button" className="btn btn-primary" onClick={onExit} autoFocus>{s("finish")}</button>
        </div>
      )}
    </div>
  );
}
