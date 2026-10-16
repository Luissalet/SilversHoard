// Video: one finished battle's replay alone on a 16:9 stage, for recording a clip (battle_video). The app's headless browser opens
// #/video/<id>?record=1 and calls window.videoRecord(): the tab's picture and the page's own sound (effects, cries, music) go into
// one MediaRecorder whose chunks are handed to the recorder as they come. A person opening the page just watches the replay.
// A mass battle (#/video/mass_<id>?mspeed=2&play=<run>) is recorded the same way with its own screen (mass.py: video).
import React, { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { useApp } from "../context.js";
import Arena from "../battle/Arena.jsx";
import { useBattlePlayer } from "../battle/player.js";
import { useSeats } from "../components/silver.jsx";
import { loc, seatNames } from "../loc.js";
import { battleEnd, genOfFormat, music, pickTrack, unlock } from "../audio.js";
import { installTap } from "../video/tap.js";
// the real-time arena carries the battle engine: it comes with CombateRt's chunk, only when a real-time battle is recorded
const RtScreen = React.lazy(() => import("./CombateRt.jsx").then((m) => ({ default: m.RtScreen })));
const MassScreen = React.lazy(() => import("./CombateRt.jsx").then((m) => ({ default: m.MassScreen })));

const TAIL_MS = 3500;      // the end screen (winner, victory pose, jingle) stays this long

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Start a MediaRecorder on this tab's picture and the page's own sound; chunks go to the recorder, then onStart runs. */
function startRecording(run, onStart, delay = 1500) {
  (async () => {
    try {
      const audio = installTap();
      unlock();
      const tab = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false, preferCurrentTab: true,
        selfBrowserSurface: "include" });
      await window.__videoCaptureReady?.(); // native recorder may restore the viewport after the sharing bar appears
      const stream = new MediaStream([...tab.getVideoTracks(), ...audio.getAudioTracks()]);
      // Prefer the cheaper real-time encoder: VP9 can hold the captured picture for seconds under load.
      const type = ["video/webm;codecs=vp8,opus", "video/webm;codecs=vp9,opus", "video/webm"].find((x) => MediaRecorder.isTypeSupported(x));
      const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 160_000 });
      let chain = Promise.resolve();
      rec.ondataavailable = (e) => {
        if (!e.data || !e.data.size) return;
        chain = chain.then(() => e.data.arrayBuffer()).then((b) => window.__videoChunk?.(toBase64(b)));
      };
      rec.onstop = () => {
        tab.getTracks().forEach((t) => t.stop());
        chain.then(() => window.__videoDone?.({ seconds: (performance.now() - run.current.t0) / 1000, sound: audio.getAudioTracks().length > 0 }));
      };
      run.current.recorder = rec;
      run.current.sound = audio.getAudioTracks().length > 0;
      rec.start(1000);
      // Obtaining the stream does not mean it has delivered a picture. Keep the replay at tick zero until it does.
      const preview = document.createElement("video");
      preview.muted = true;
      preview.srcObject = tab;
      const frame = new Promise((resolve) => preview.requestVideoFrameCallback(resolve));
      await preview.play();
      await frame;
      preview.pause();
      preview.srcObject = null;
      setTimeout(onStart, delay);
    } catch (e) {
      window.__videoError?.(e.message || String(e));
    }
  })();
  return true;
}

export default function Video({ param, query }) {
  const recording = query?.get("record") === "1";
  // Real-time music starts while its replay is paused. Hook play() before the
  // asynchronously loaded battle mounts, so that first track enters the mix.
  useEffect(() => { if (recording) installTap(); }, [recording]);
  if (String(param || "").startsWith("mass_")) return <MassVideo id={param} query={query} />;
  return <BattleVideo param={param} query={query} />;
}

/** A mass battle (or one played run of it) on the 16:9 stage, its camera directing itself (or following whoever played). */
function MassVideo({ id, query }) {
  const { t, lang, setLang, sprites } = useApp();
  const rate = Math.max(1, Math.min(8, Number(query?.get("mspeed")) || 2));
  const playId = query?.get("play") || "";
  const recording = query?.get("record") === "1";
  const [doc, setDoc] = useState(null);
  const [run2, setRun2] = useState(null);
  const [playing, setPlaying] = useState(false);
  const run = useRef({ started: false, ended: false, recorder: null, t0: 0 });
  useEffect(() => {
    document.body.classList.add("video-mode");
    return () => document.body.classList.remove("video-mode");
  }, []);
  useEffect(() => {
    const wanted = query?.get("lang");
    if (wanted && wanted !== lang && ["es", "en"].includes(wanted)) setLang(wanted);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const fail = (e) => window.__videoError?.(e.message || String(e));
    api.call("mass_get", { id }).then(setDoc).catch(fail);
    if (playId) api.call("mass_play_get", { id, play_id: playId }).then(setRun2).catch(fail);
  }, [id, playId]);
  const ready = doc && (!playId || run2);
  const start = () => {
    const r = run.current;
    if (r.started) return;
    r.started = true;
    r.t0 = performance.now();
    setPlaying(true);
  };
  useEffect(() => {
    if (!ready) return undefined;
    // the tab capture takes a moment to deliver frames: the intro waits for it, so the title and the countdown are in the clip
    window.videoRecord = () => startRecording(run, start, 1500);
    window.__videoReady = true;
    if (!recording) setTimeout(start, 800);
    return () => { window.__videoReady = false; };
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps
  const done = () => {
    const r = run.current;
    if (r.ended) return;
    r.ended = true;
    setTimeout(() => { if (r.recorder && r.recorder.state !== "inactive") r.recorder.stop(); }, TAIL_MS);
  };
  if (!ready) return <div className="video-stage" />;
  const ticks = Math.round(((run2?.seconds ?? doc.summary?.seconds) || 0) * 30);
  return (
    <div className="video-stage">
      <div className="video-title">
        <b>{loc(doc, lang, "title")}</b>
        {run2 && <span className="help">{t("mass_replay_of", { who: run2.challenger, name: run2.name })}</span>}
      </div>
      <React.Suspense fallback={null}>
        <MassScreen doc={doc} t={t} sprites={sprites} replay={run2 ? { unit: run2.unit, inputs: run2.inputs } : null}
          video={{ playing, speed: rate, ticks, onProgress: (x) => window.__videoProgress?.(x), onDone: done }} />
      </React.Suspense>
    </div>
  );
}

function BattleVideo({ param, query }) {
  const { lang, setLang, sprites } = useApp();
  const speedMs = Math.max(200, Math.min(3000, Number(query?.get("speed")) || 900));
  const recording = query?.get("record") === "1";
  const [battle, setBattle] = useState(null);
  const [error, setError] = useState("");
  const player = useBattlePlayer({ lang, me: "p1", speedMs, names: seatNames(battle, lang) });
  const seats = useSeats(battle);
  const run = useRef({ started: false, ended: false, recorder: null, t0: 0, sound: false });
  const [rtPlaying, setRtPlaying] = useState(false);
  const [arenaReady, setArenaReady] = useState(false);
  const realtime = battle?.mode === "realtime";
  const stopSoon = () => {
    const r = run.current;
    if (r.ended) return;
    r.ended = true;
    setTimeout(() => { if (r.recorder && r.recorder.state !== "inactive") r.recorder.stop(); }, TAIL_MS);
  };

  useEffect(() => {
    document.body.classList.add("video-mode");
    return () => document.body.classList.remove("video-mode");
  }, []);
  useEffect(() => {
    const wanted = query?.get("lang");
    if (wanted && wanted !== lang && ["es", "en"].includes(wanted)) setLang(wanted);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    api.call("battle_get", { id: param }).then(setBattle).catch((e) => {
      setError(e.message || String(e));
      window.__videoError?.(e.message || String(e));
    });
  }, [param]);

  const start = () => {
    const r = run.current;
    if (r.started || !battle) return;
    r.started = true;
    r.t0 = performance.now();
    if (battle.mode === "realtime") { setRtPlaying(true); return; }   // the arena plays its own music
    music.play(`/api/music/${pickTrack(battle.id, genOfFormat(battle.format))}`);
    player.play();
  };

  useEffect(() => {
    if (!battle || (realtime && !arenaReady)) return;
    if (battle.mode !== "realtime") player.load(battle.lines || [], { playing: false });
    // Let React remove the loading overlay and paint the prepared arena before the native recorder opens capture.
    let first = 0, second = 0, timer = 0;
    first = requestAnimationFrame(() => { second = requestAnimationFrame(() => {
      window.videoRecord = () => startRecording(run, start);
      window.__videoReady = true;
      if (!recording) timer = setTimeout(start, 800);
    }); });
    return () => {
      cancelAnimationFrame(first); cancelAnimationFrame(second); clearTimeout(timer);
      window.__videoReady = false; music.stop({ fade: 0.3 });
    };
  }, [battle?.id, arenaReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // progress, then the end: the jingle and the winner's screen stay a moment before the recording stops
  useEffect(() => {
    const r = run.current;
    if (!r.started || realtime) return;
    if (player.total) window.__videoProgress?.(player.applied / player.total);
    if (r.ended || !player.state.ended || !player.caughtUp) return;
    r.ended = true;
    const st = player.state;
    battleEnd(st.tie || !st.winner ? null : true);
    setTimeout(() => { if (r.recorder && r.recorder.state !== "inactive") r.recorder.stop(); }, TAIL_MS);
  }, [player.applied, player.state.ended, player.caughtUp]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className="video-stage"><p className="help">{error}</p></div>;
  if (!battle) return <div className="video-stage" />;
  return (
    <div className="video-stage">
      <div className="video-title">
        <b>{loc(battle.p1, lang)}</b><span>vs</span><b>{loc(battle.p2, lang)}</b>
        <span className="help">{battle.format_info?.name || battle.format}</span>
      </div>
      {realtime ? (
        <React.Suspense fallback={null}>
          <RtScreen battle={battle} lang={lang} sprites={sprites} seats={seats}
            video={{ playing: rtPlaying, speed: speedMs < 700 ? 2 : 1, onReady: () => setArenaReady(true),
              onError: (e) => window.__videoError?.(e.message || String(e)),
              onProgress: (x) => window.__videoProgress?.(x), onDone: stopSoon }} />
        </React.Suspense>
      ) : <Arena player={player} seats={seats} me="p1" sprites={sprites} lang={lang} />}
    </div>
  );
}
