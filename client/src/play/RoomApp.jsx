// The friend's side of a live battle (a room on someone's Silver's Hoard, silvers_hoard/pvp.py): pick a name and a team, join, wait for
// the host to start, then play. Turn by turn the host's app runs the battle and this page shows only this side's view and sends this
// side's choices; in real time this page runs the same simulator as the host's screen, in step through the room's WebSocket.
// Opened with a room's watch link, the page is for a spectator: it shows the battle read only (WatchRoom).
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildFormatId, dexNum, exportTeam, formatInfo, importTeam, randomTeam } from "../../../engine/src/core.mjs";
import Arena from "../battle/Arena.jsx";
import Controls from "../battle/Controls.jsx";
import { makeSprites } from "../battle/dex.js";
import { useBattlePlayer } from "../battle/player.js";
import { battleEnd } from "../audio.js";
import RtScreen from "../battle/rt/RtScreen.jsx";
import { rtRun } from "../../../engine/src/realtime/sim.mjs";
import { playT } from "./strings.js";
import { avatarSrc, TeamIcons } from "./PlayApp.jsx";

async function roomCall(room, path, body) {
  const url = `/api/room/${room.id}${path}`;
  const r = body
    ? await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ k: room.key, ...body }) })
    : await fetch(`${url}${url.includes("?") ? "&" : "?"}k=${encodeURIComponent(room.key)}`);
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(out.error || `HTTP ${r.status}`);
  return out;
}

export default function RoomApp({ data }) {
  return data.room?.role === "watch" ? <WatchRoom data={data} /> : <PlayRoom data={data} />;
}

function PlayRoom({ data }) {
  const [lang, setLang] = useState(() => (typeof navigator !== "undefined" && !String(navigator.language || "es").startsWith("es") ? "en" : "es"));
  const t = playT(lang);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  const room = data.room;
  const sprites = useMemo(() => makeSprites({ server: data.sprite_server || "https://play.pokemonshowdown.com/sprites", set: data.sprite_set || "gen5ani", dexNum }), [data]);
  const fid = useMemo(() => { try { return buildFormatId(room.format, []); } catch { return room.format; } }, [room.format]);
  const info = useMemo(() => { try { return formatInfo(fid); } catch { return { gen: 9, name: fid }; } }, [fid]);
  const [name, setName] = useState(() => { try { return localStorage.getItem("silver-play-name") || ""; } catch { return ""; } });
  const [tab, setTab] = useState("paste");
  const [paste, setPaste] = useState("");
  const [state, setState] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState("setup");      // setup, waiting, battle, done
  const host = room.host || {};
  const hostAvatar = avatarSrc(sprites, host.avatar);

  const pull = useCallback(async () => {
    const s = await roomCall(room, "");
    setState(s);
    return s;
  }, [room]);
  // a page reopened after joining picks the room up where it is
  useEffect(() => {
    pull().then((s) => {
      if (s.status === "live" || s.status === "ended") setPhase(s.status === "live" ? "battle" : "done");
    }).catch((e) => setError(e.message));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (phase !== "waiting") return undefined;
    const h = setInterval(() => {
      pull().then((s) => { if (s.status === "live") setPhase("battle"); if (s.status === "ended") setPhase("done"); }).catch((e) => setError(e.message));
    }, 1500);
    return () => clearInterval(h);
  }, [phase, pull]);

  const roll = () => {
    const r = randomTeam(`gen${info.gen || 9}randombattle`, String(Date.now()));
    setPaste(exportTeam(r.sets.slice(0, 6)));
  };
  const loadFile = async (file) => {
    if (!file) return;
    try {
      const obj = JSON.parse(await file.text());
      const tr = obj.trainer || obj;
      if (tr.name && !name) setName(tr.name);
      setPaste(exportTeam(importTeam(tr.team || tr.sets || obj)));
    } catch (e) { setError(e.message); }
  };
  const join = async () => {
    setBusy(true);
    setError("");
    try {
      try { localStorage.setItem("silver-play-name", name.trim()); } catch { /* not critical */ }
      const s = await roomCall(room, "/join", { name: name.trim(), paste });
      setState(s);
      setPhase("waiting");
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const header = (
    <header className="p-head">
      <div className="p-target">
        {hostAvatar && <img src={hostAvatar} alt="" className="p-avatar pixelated" onError={(e) => { e.currentTarget.style.display = "none"; }} />}
        <div className="min-w-0">
          <h1>{t("room_title", { name: host.name || "" })}</h1>
          <div className="help">{[t(room.mode === "realtime" ? "mode_realtime" : "mode_turns"), info.name || fid, room.level_rules?.level ? t("level_fixed", { n: room.level_rules.level }) : ""].filter(Boolean).join(" · ")}</div>
        </div>
      </div>
      <button type="button" className="btn btn-sm" onClick={() => setLang(lang === "es" ? "en" : "es")}>{t("language")}</button>
    </header>
  );

  if (phase === "battle" && state?.battle) {
    const me = { name: state.guest?.name || name, sets: [] };
    return (
      <div className="p-wrap">
        {header}
        {state.battle.mode === "realtime"
          ? <RoomRt t={t} lang={lang} sprites={sprites} room={room} state={state} hostAvatar={hostAvatar} onDone={() => pull().then(() => setPhase("done"))} />
          : <RoomTurns t={t} lang={lang} sprites={sprites} room={room} host={host} hostAvatar={hostAvatar} me={me} onEnd={(s) => { setState(s); setPhase("done"); }} />}
      </div>
    );
  }

  if (phase === "done") {
    const b = state?.battle || {};
    const won = b.winner_side === "p2";
    return (
      <div className="p-wrap">
        {header}
        <div className={`panel p-final ${won ? "is-won" : ""}`}>
          <h2>{b.winner_side ? (won ? t("room_won", { name: host.name }) : t("room_lost", { name: host.name })) : t("room_tie")}</h2>
          <p className="help">{t("room_done_help")}</p>
        </div>
        <footer className="help p-foot">{t("made_with")}</footer>
      </div>
    );
  }

  if (phase === "waiting") {
    return (
      <div className="p-wrap">
        {header}
        <div className="panel p-between">
          <b>{t("room_waiting", { name: host.name })}</b>
          {state?.guest && <p className="help">{t("room_joined_as", { name: state.guest.name, list: state.guest.species.join(", ") })}</p>}
          {error && <div className="banner banner-warn">{error}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="p-wrap">
      {header}
      <section className="panel space-y-3">
        <p className="help">{t("room_help", { name: host.name })}</p>
        <label className="block"><span className="label">{t("your_name")}</span><input className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} /></label>
        <span className="label">{t("your_team")}</span>
        <div className="seg" role="group">
          {["paste", "random", "file"].map((x) => <button key={x} type="button" aria-pressed={tab === x} onClick={() => { setTab(x); if (x === "random") roll(); }}>{t(`tab_${x}`)}</button>)}
        </div>
        {(tab === "paste" || tab === "random") && <textarea className="field" rows={10} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={t("paste_ph")} />}
        {tab === "random" && <button type="button" className="btn btn-sm" onClick={roll}>{t("roll")}</button>}
        {tab === "file" && <><input type="file" className="field" accept=".hoardtrainer,.json" onChange={(e) => loadFile(e.target.files?.[0])} /><p className="help">{t("file_help")}</p></>}
        {paste.trim() && <TeamIcons sets={(() => { try { return importTeam(paste); } catch { return []; } })()} sprites={sprites} />}
        {error && <div className="banner banner-warn">{error}</div>}
        <button type="button" className="btn btn-primary" onClick={join} disabled={busy || !paste.trim() || !name.trim()}>{t("room_join")}</button>
      </section>
      <footer className="help p-foot">{t("made_with")}</footer>
    </div>
  );
}

/** Turn by turn: the host's app runs the battle; this page shows this side's view and sends its choices. */
function RoomTurns({ t, lang, sprites, room, host, hostAvatar, me, onEnd }) {
  const player = useBattlePlayer({ lang, me: "p2", speedMs: 850 });
  const sinceRef = useRef(0);
  const [b, setB] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const last = useRef(null);
  const seats = useMemo(() => ({ p1: { name: host.name, avatarUrl: hostAvatar }, p2: { name: me.name, avatarUrl: "" } }), [host, hostAvatar, me.name]);
  const apply = useCallback((s) => {
    last.current = s;
    const x = s.battle;
    if (!x) return;
    if (x.lines?.length) player.push(x.lines);
    sinceRef.current = x.log_length || sinceRef.current;
    setB(x);
  }, [player]);
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      if (stop) return;
      try { apply(await roomCall(room, `?since=${sinceRef.current}`)); } catch (e) { setErr(e.message); }
      if (!stop && last.current?.battle?.status === "live") setTimeout(tick, 1200);
    };
    tick();
    return () => { stop = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (b && b.status !== "live" && player.state.ended && player.caughtUp) {
      battleEnd(b.winner_side ? b.winner_side === "p2" : null);
      const h = setTimeout(() => onEnd(last.current), 2600);
      return () => clearTimeout(h);
    }
    return undefined;
  }, [b?.status, player.state.ended, player.caughtUp]); // eslint-disable-line react-hooks/exhaustive-deps
  const choose = async (choice) => {
    setBusy(true);
    setErr("");
    try { apply(await roomCall(room, "/choose", { choice, since: sinceRef.current })); } catch (e) { setErr(e.message); }
    setBusy(false);
  };
  const forfeit = async () => {
    if (!window.confirm(t("room_forfeit_q"))) return;
    try { apply(await roomCall(room, "/forfeit", {})); } catch (e) { setErr(e.message); }
  };
  const request = b?.status === "live" && player.caughtUp && !busy && b.request && !b.request.done ? b.request : null;
  return (
    <>
      {err && <div className="banner banner-warn">{err}</div>}
      <Arena player={player} seats={seats} me="p2" sprites={sprites} lang={lang}>
        {request ? <Controls request={request} lang={lang} sprites={sprites} gametype={player.state.gametype} onChoose={choose} onForfeit={forfeit} />
          : b?.status === "live" ? <div className="b-controls"><div className="b-wait">{busy ? t("thinking") : t("room_their_turn", { name: host.name })}</div></div> : null}
      </Arena>
    </>
  );
}

/** Real time: the same simulator as the host's screen, in lockstep through the room. */
function RoomRt({ t, lang, sprites, room, state, hostAvatar, onDone }) {
  const rt = state.battle.rt;
  const seats = useMemo(() => ({ p1: { name: rt.spec.p1.name, avatarUrl: hostAvatar }, p2: { name: rt.spec.p2.name, avatarUrl: "" } }), [rt, hostAvatar]);
  const [battle, setBattle] = useState(() => ({ id: state.battle.id, status: "live", format: rt.spec.format, kind: "pvp", summary: null,
    rt: { spec: rt.spec, inputs: [], tick: 0, human: [true, true], time_limit: rt.time_limit, arena: rt.arena } }));
  const net = useMemo(() => ({ url: `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/room/${room.id}/ws?k=${encodeURIComponent(room.key)}`,
    seat: 1, delay: room.input_delay || 4, peerName: rt.spec.p1.name }), [room, rt]);
  const onFinish = useCallback(async (inputs, tick, forfeit) => {
    // the host's app stores the official result; this page shows what its own copy of the battle says
    const b = rtRun(rt.spec, { inputs, forfeit: forfeit || "", tick });
    const summary = b.summary();
    const ended = { ...battle, status: "ended", winner_side: summary.winner_side, summary: { seconds: b.t / 30 }, rt: { ...battle.rt, inputs: inputs.slice(), tick: b.t } };
    setBattle(ended);
    return ended;
  }, [rt, battle]);
  return <RtScreen key={battle.id} battle={battle} lang={lang} sprites={sprites} seats={seats} offline net={net} onFinish={onFinish}
    onContinue={onDone} continueLabel={t("battle_continue")} />;
}

/** A spectator: the room's public view, turn by turn polled from the room, in real time both players' frames through the WebSocket. */
function WatchRoom({ data }) {
  const [lang, setLang] = useState(() => (typeof navigator !== "undefined" && !String(navigator.language || "es").startsWith("es") ? "en" : "es"));
  const t = playT(lang);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  const room = data.room;
  const host = room.host || {};
  const sprites = useMemo(() => makeSprites({ server: data.sprite_server || "https://play.pokemonshowdown.com/sprites", set: data.sprite_set || "gen5ani", dexNum }), [data]);
  const hostAvatar = avatarSrc(sprites, host.avatar);
  const [state, setState] = useState(null);
  const [error, setError] = useState("");
  const [phase, setPhase] = useState("waiting");     // waiting, battle, done
  const pull = useCallback(async () => {
    const s = await roomCall(room, "/watch");
    setState(s);
    return s;
  }, [room]);
  useEffect(() => {
    if (phase !== "waiting") return undefined;
    let stop = false;
    const tick = () => pull().then((s) => {
      if (stop) return;
      if (s.status === "live" && s.battle) setPhase("battle");
      else if (s.status === "ended") setPhase("done");
    }).catch((e) => setError(e.message));
    tick();
    const h = setInterval(tick, 2000);
    return () => { stop = true; clearInterval(h); };
  }, [phase, pull]);
  const guestName = state?.guest?.name || "";
  const header = (
    <header className="p-head">
      <div className="p-target">
        {hostAvatar && <img src={hostAvatar} alt="" className="p-avatar pixelated" onError={(e) => { e.currentTarget.style.display = "none"; }} />}
        <div className="min-w-0">
          <h1>{t("watch_title", { name: host.name || "" })}</h1>
          <div className="help">{[guestName ? t("watch_vs", { a: host.name, b: guestName }) : "", t(room.mode === "realtime" ? "mode_realtime" : "mode_turns"), room.format,
            state?.spectators ? t("watch_count", { n: state.spectators }) : ""].filter(Boolean).join(" · ")}</div>
        </div>
      </div>
      <button type="button" className="btn btn-sm" onClick={() => setLang(lang === "es" ? "en" : "es")}>{t("language")}</button>
    </header>
  );
  if (phase === "battle" && state?.battle) {
    return (
      <div className="p-wrap">
        {header}
        <p className="help">{t("watch_note")}</p>
        {state.battle.mode === "realtime"
          ? <WatchRt t={t} lang={lang} sprites={sprites} room={room} state={state} hostAvatar={hostAvatar} onDone={() => pull().then(() => setPhase("done"))} />
          : <WatchTurns lang={lang} sprites={sprites} room={room} host={host} hostAvatar={hostAvatar} guest={guestName} onEnd={(s) => { setState(s); setPhase("done"); }} />}
      </div>
    );
  }
  if (phase === "done") {
    const b = state?.battle || {};
    return (
      <div className="p-wrap">
        {header}
        <div className="panel p-final">
          <h2>{b.winner_name ? t("watch_won", { name: b.winner_name }) : t("room_tie")}</h2>
          <p className="help">{t("watch_done_help", { name: host.name })}</p>
        </div>
        <footer className="help p-foot">{t("made_with")}</footer>
      </div>
    );
  }
  return (
    <div className="p-wrap">
      {header}
      <div className="panel p-between">
        <b>{state?.status === "ready" ? t("watch_ready", { a: host.name, b: guestName }) : t("watch_waiting", { name: host.name })}</b>
        {error && <div className="banner banner-warn">{error}</div>}
      </div>
      <footer className="help p-foot">{t("made_with")}</footer>
    </div>
  );
}

function WatchTurns({ lang, sprites, room, host, hostAvatar, guest, onEnd }) {
  const player = useBattlePlayer({ lang, me: "p1", speedMs: 850 });
  const sinceRef = useRef(0);
  const last = useRef(null);
  const [b, setB] = useState(null);
  const [err, setErr] = useState("");
  const seats = useMemo(() => ({ p1: { name: host.name, avatarUrl: hostAvatar }, p2: { name: guest, avatarUrl: "" } }), [host, hostAvatar, guest]);
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      if (stop) return;
      try {
        const s = await roomCall(room, `/watch?since=${sinceRef.current}`);
        last.current = s;
        const x = s.battle;
        if (x) {
          if (x.lines?.length) player.push(x.lines);
          sinceRef.current = x.log_length || sinceRef.current;
          setB(x);
        }
      } catch (e) { setErr(e.message); }
      if (!stop && last.current?.battle?.status === "live") setTimeout(tick, 1500);
    };
    tick();
    return () => { stop = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (b && b.status !== "live" && player.state.ended && player.caughtUp) {
      const h = setTimeout(() => onEnd(last.current), 2600);
      return () => clearTimeout(h);
    }
    return undefined;
  }, [b?.status, player.state.ended, player.caughtUp]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      {err && <div className="banner banner-warn">{err}</div>}
      <Arena player={player} seats={seats} me="p1" sprites={sprites} lang={lang} />
    </>
  );
}

function WatchRt({ t, lang, sprites, room, state, hostAvatar, onDone }) {
  const rt = state.battle.rt;
  const seats = useMemo(() => ({ p1: { name: rt.spec.p1.name, avatarUrl: hostAvatar }, p2: { name: rt.spec.p2.name, avatarUrl: "" } }), [rt, hostAvatar]);
  const [battle, setBattle] = useState(() => ({ id: state.battle.id, status: "live", format: rt.spec.format, kind: "pvp", summary: null,
    rt: { spec: rt.spec, inputs: [], tick: 0, human: [false, false], time_limit: rt.time_limit, arena: rt.arena } }));
  const net = useMemo(() => ({ url: `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/room/${room.id}/ws?k=${encodeURIComponent(room.key)}`,
    seat: 2, delay: room.input_delay || 4, peerName: rt.spec.p1.name }), [room, rt]);
  const onFinish = useCallback(async (inputs, tick, forfeit) => {
    const b = rtRun(rt.spec, { inputs, forfeit: forfeit || "", tick });
    const summary = b.summary();
    const ended = { ...battle, status: "ended", winner_side: summary.winner_side, summary: { seconds: b.t / 30 }, rt: { ...battle.rt, inputs: inputs.slice(), tick: b.t } };
    setBattle(ended);
    return ended;
  }, [rt, battle]);
  return <RtScreen key={battle.id} battle={battle} lang={lang} sprites={sprites} seats={seats} offline net={net} onFinish={onFinish}
    onContinue={onDone} continueLabel={t("battle_continue")} />;
}
