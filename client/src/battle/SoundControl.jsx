// The sound mixer on screen: a speaker button for the battle screens (a small panel with the sliders) and the sliders alone for the
// settings page. State lives in ../audio.js (and localStorage), so every control shows the same values.
import React, { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getSettings, setSettings, sfx, subscribe, unlock } from "../audio.js";
import { sndT } from "../sound-strings.js";

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
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  const off = s.mute || s.master <= 0;
  return (
    <div className={className} ref={box}>
      <button type="button" className="btn btn-sm snd-btn" aria-expanded={open} aria-label={t("snd_title")} title={t("snd_title")}
        onClick={() => { unlock(); setOpen((o) => !o); }}>
        <SpeakerIcon off={off} />
      </button>
      {open && (
        <div className="snd-pop" role="dialog" aria-label={t("snd_title")}>
          <b>{t("snd_title")}</b>
          <SoundSliders lang={lang} test={false} />
        </div>
      )}
    </div>
  );
}
