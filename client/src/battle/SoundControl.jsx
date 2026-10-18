// The sound mixer on screen: a speaker button for the battle screens (a small panel with the sliders) and the sliders alone for the
// settings page. State lives in ../audio.js (and localStorage), so every control shows the same values.
import React, { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { getSettings, setSettings, sfx, subscribe, unlock } from "../audio.js";
import { MUSIC_OPTIONS, sndT } from "../sound-strings.js";
import { getLibrary, importFiles, loadLibrary, subscribe as subscribeLibrary } from "../music/store.js";

export const useSound = () => useSyncExternalStore(subscribe, getSettings, getSettings);

const SLIDERS = [["master", "snd_master"], ["music", "snd_music"], ["sfx", "snd_sfx"], ["cries", "snd_cries"]];

export function SoundSliders({ lang = "es", test = true }) {
  const t = sndT(lang);
  const s = useSound();
  return (
    <div className="snd-sliders">
      <label className="snd-row">
        <input type="checkbox" checked={s.mute} onChange={(e) => { unlock(); setSettings({ mute: e.target.checked }); }} />
        <span>{t("snd_mute")}</span>
      </label>
      {SLIDERS.map(([key, label]) => (
        <label key={key} className="snd-row">
          <span className="snd-label">{t(label)}</span>
          <input type="range" min={0} max={100} step={1} value={Math.round(s[key] * 100)} aria-label={t(label)}
            onChange={(e) => { unlock(); setSettings({ [key]: Number(e.target.value) / 100 }); }}
            onPointerUp={() => { if (key === "sfx" || key === "master") sfx("hit", { gap: 0 }); }} />
          <span className="num snd-val">{Math.round(s[key] * 100)}</span>
        </label>
      ))}
      {test && <button type="button" className="btn btn-sm" onClick={() => { unlock(); sfx("super", { gap: 0 }); sfx("win", { gap: 0, delay: 0.5 }); }}>{t("snd_test")}</button>}
    </div>
  );
}

export function MusicSelect({ lang }) {
  const t = sndT(lang);
  const s = useSound();
  const library = useSyncExternalStore(subscribeLibrary, getLibrary, getLibrary);
  const [uploading, setUploading] = useState(false);
  const [failure, setFailure] = useState("");
  const personal = typeof document !== "undefined" && !document.getElementById("silver-data");
  useEffect(() => { if (personal) loadLibrary(); }, [personal]);
  return (
    <div className="snd-track grid min-w-0 max-w-lg gap-1">
      <label className="grid gap-1"><span>{t("snd_track")}</span>
      <select className="field min-w-0" value={s.music_track} onChange={(e) => { unlock(); setSettings({ music_track: e.target.value }); }}>
        <option value="auto">{t("snd_track_auto")}</option>
        <option value="none">{t("snd_track_none")}</option>
        {personal && library.tracks.some((x) => !x.archived) && <optgroup label={t("snd_own")}>
          {library.tracks.filter((x) => !x.archived).map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
        </optgroup>}
        {["showdown", "pokerogue"].map((source) => <optgroup key={source} label={source === "showdown" ? "Showdown" : "PokéRogue"}>
          {MUSIC_OPTIONS.filter((x) => x.source === source).map((x) => <option key={x.id} value={x.id}>{x.label[lang === "en" ? 1 : 0]}</option>)}
        </optgroup>)}
      </select>
      </label>
      <span className="help">{t("snd_track_help")}</span>
      {personal && <div className="flex flex-wrap items-center gap-2">
        <label className="btn btn-sm relative overflow-hidden">{t(uploading ? "snd_importing" : "snd_add")}
          <input type="file" accept=".mp3,audio/mpeg" multiple disabled={uploading} aria-label={t("snd_add")} className="absolute inset-0 w-full opacity-0"
            onChange={async (e) => {
              const files = Array.from(e.target.files); e.target.value = ""; if (!files.length) return;
              setUploading(true); setFailure("");
              try { const result = await importFiles(files); setFailure(result.failures.join("; ")); if (result.imported.length) setSettings({ music_track: result.imported[0] }); }
              finally { setUploading(false); }
            }} />
        </label>
        <a className="btn-link" href="#/musica">{t("snd_library")}</a>
      </div>}
      {failure && <span role="alert" className="help">{failure}</span>}
    </div>
  );
}

function SpeakerIcon({ off }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 5 6 9H3v6h3l5 4z" fill="currentColor" />
      {off ? <path d="m16 9 5 6m0-6-5 6" /> : <><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M18.5 5.5a9 9 0 0 1 0 13" /></>}
    </svg>
  );
}

/** Speaker button with a panel of sliders; `className` places it (the battle screens put it in the corner of the field). */
export default function SoundButton({ lang = "es", className = "b-sound" }) {
  const t = sndT(lang);
  const s = useSound();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({});
  const box = useRef(null);
  const popup = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (!box.current?.contains(e.target) && !popup.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    const reposition = () => {
      const r = box.current.getBoundingClientRect();
      const below = window.innerHeight - r.bottom - 16;
      const above = r.top - 16;
      const down = below >= Math.min(320, above);
      setPosition({ left: Math.max(8, Math.min(r.right - 264, window.innerWidth - 272)),
        top: down ? r.bottom + 6 : undefined, bottom: down ? undefined : window.innerHeight - r.top + 6,
        maxHeight: Math.max(80, down ? below : above) });
    };
    reposition();
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc);
      window.removeEventListener("resize", reposition); window.removeEventListener("scroll", reposition, true); };
  }, [open]);
  const off = s.mute || s.master <= 0;
  return (
    <div className={className} ref={box}>
      <button type="button" className="btn btn-sm snd-btn" aria-expanded={open} aria-label={t("snd_title")} title={t("snd_title")}
        onClick={() => { unlock(); setOpen((o) => !o); }}>
        <SpeakerIcon off={off} />
      </button>
      {open && createPortal(
        <div ref={popup} className="snd-pop" style={position} role="dialog" aria-label={t("snd_title")}>
          <b>{t("snd_title")}</b>
          <MusicSelect lang={lang} />
          <SoundSliders lang={lang} test={false} />
        </div>, document.body,
      )}
    </div>
  );
}
