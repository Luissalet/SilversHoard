// Video: one finished battle's replay alone on a 16:9 stage, for recording a clip (battle_video). The app's headless browser opens
// #/video/<id>?record=1 and calls window.videoRecord(): the tab's picture and the page's own sound (effects, cries, music) go into
// one MediaRecorder whose chunks are handed to the recorder as they come. A person opening the page just watches the replay.
import React, { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { useApp } from "../context.js";
import Arena from "../battle/Arena.jsx";
import { useBattlePlayer } from "../battle/player.js";
import { useSeats } from "../components/silver.jsx";
import { battleEnd, genOfFormat, music, pickTrack, unlock } from "../audio.js";
import { installTap } from "../video/tap.js";

const TAIL_MS = 3500;      // the end screen (winner, victory pose, jingle) stays this long

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export default function Video({ param, query }) {
  const { lang, setLang, sprites } = useApp();
  const speedMs = Math.max(200, Math.min(3000, Number(query?.get("speed")) || 900));
  const recording = query?.get("record") === "1";
  const [battle, setBattle] = useState(null);
  const [error, setError] = useState("");
  const player = useBattlePlayer({ lang, me: "p1", speedMs });
  const seats = useSeats(battle);
  const run = useRef({ started: false, ended: false, recorder: null, t0: 0, sound: false });

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
    music.play(`/api/music/${pickTrack(battle.id, genOfFormat(battle.format))}`);
    player.play();
  };

  useEffect(() => {
    if (!battle) return;
    player.load(battle.lines || [], { playing: false });
    window.videoRecord = () => {
      (async () => {
        try {
          const audio = installTap();
          unlock();
          const tab = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false, preferCurrentTab: true,
            selfBrowserSurface: "include" });
          const stream = new MediaStream([...tab.getVideoTracks(), ...audio.getAudioTracks()]);
          const type = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find((x) => MediaRecorder.isTypeSupported(x));
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
          setTimeout(start, 400);   // a moment of the opening frame before the battle starts
        } catch (e) {
          window.__videoError?.(e.message || String(e));
        }
      })();
      return true;
    };
    window.__videoReady = true;
    if (!recording) setTimeout(start, 800);
    return () => { window.__videoReady = false; music.stop({ fade: 0.3 }); };
  }, [battle?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // progress, then the end: the jingle and the winner's screen stay a moment before the recording stops
  useEffect(() => {
    const r = run.current;
    if (!r.started) return;
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
        <b>{battle.p1?.name}</b><span>vs</span><b>{battle.p2?.name}</b>
        <span className="help">{battle.format_info?.name || battle.format}</span>
      </div>
      <Arena player={player} seats={seats} me="p1" sprites={sprites} lang={lang} />
    </div>
  );
}
