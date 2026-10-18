import React, { useEffect, useSyncExternalStore } from "react";
import { getSettings, setSettings, subscribe as subscribeSound } from "../audio.js";
import * as player from "./store.js";
import { musicT } from "./strings.js";
import "./music.css";

export const useMusic = () => useSyncExternalStore(player.subscribe, player.getLibrary, player.getLibrary);
const time = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

export default function MusicPlayer({ lang, version }) {
  const s = useMusic();
  const sound = useSyncExternalStore(subscribeSound, getSettings, getSettings);
  const t = musicT(lang);
  useEffect(() => { player.loadLibrary(); return () => player.pause(); }, []);
  useEffect(() => { if (version) player.loadLibrary(); }, [version]);
  if (!s.queue.tracks.length) return null;
  return <section className="music-player" aria-label={t("title")}>
    <div className="music-now">
      <a href="#/musica">{player.titleOf(s.queue.tracks[s.queue.index], lang)}</a>
      <span className="help">{s.queue.index + 1} / {s.queue.tracks.length}</span>
    </div>
    <div className="music-transport">
      <button type="button" className="btn btn-sm" onClick={() => player.previous().catch(() => {})} disabled={s.saving}>{t("previous")}</button>
      <button type="button" className="btn btn-primary" onClick={player.toggle}>{t(s.playing ? "pause" : "play")}</button>
      <button type="button" className="btn btn-sm" onClick={() => player.advance()} disabled={s.saving}>{t("next")}</button>
    </div>
    <label className="music-seek">
      <span className="sr-only">{t("seek")}</span>
      <input type="range" min="0" max={s.duration || 0} step="0.1" value={Math.min(s.time, s.duration)}
        disabled={!s.duration} onChange={(e) => player.seek(Number(e.target.value))} />
      <span className="num">{time(s.time)} / {time(s.duration)}</span>
    </label>
    <div className="music-modes">
      <label className="snd-row"><input type="checkbox" checked={s.queue.shuffle} onChange={(e) => player.setMode({ shuffle: e.target.checked }).catch(() => {})} disabled={s.saving} />{t("shuffle")}</label>
      <label><span className="sr-only">{t("repeat")}</span><select className="field" value={s.queue.repeat} disabled={s.saving}
        onChange={(e) => player.setMode({ repeat: e.target.value }).catch(() => {})}>
        <option value="off">{t("off")}</option><option value="all">{t("repeatAll")}</option><option value="one">{t("one")}</option>
      </select></label>
      <label className="music-volume"><span className="sr-only">{t("volume")}</span>
        <input type="range" min="0" max="100" value={Math.round(sound.music * 100)} onChange={(e) => setSettings({ music: Number(e.target.value) / 100 })} />
      </label>
    </div>
    {s.error && <div className="music-player-error" role="alert">{s.error === "unavailable" ? t("unavailable") : s.error}</div>}
  </section>;
}
