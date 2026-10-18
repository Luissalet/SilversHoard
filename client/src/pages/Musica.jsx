import React, { useState } from "react";
import { useApp } from "../context.js";
import { setSettings } from "../audio.js";
import { useMusic } from "../music/MusicPlayer.jsx";
import * as player from "../music/store.js";
import { musicT } from "../music/strings.js";

const quietly = (promise) => promise.catch(() => {});

function Rename({ value, label, save, cancel, t }) {
  const [name, setName] = useState(value);
  return <form className="music-inline" onSubmit={(e) => { e.preventDefault(); if (name.trim()) save(name.trim()); }}>
    <label className="grow min-w-0"><span className="sr-only">{label}</span><input className="field w-full" value={name} onChange={(e) => setName(e.target.value)} maxLength={300} autoFocus /></label>
    <button className="btn btn-sm" disabled={!name.trim()}>{t("save")}</button><button type="button" className="btn btn-sm" onClick={cancel}>{t("cancel")}</button>
  </form>;
}

export default function Musica() {
  const { lang, confirm, notify } = useApp();
  const t = musicT(lang);
  const s = useMusic();
  const [view, setView] = useState("own");
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [editing, setEditing] = useState("");
  const [progress, setProgress] = useState("");
  const [failures, setFailures] = useState([]);
  const [dragging, setDragging] = useState(false);
  const playlist = s.playlists.find((x) => x.id === view);
  const tracks = player.allTracks(lang);
  const lookup = Object.fromEntries(tracks.map((x) => [x.id, x]));
  const base = playlist ? playlist.tracks.map((id) => lookup[id]).filter(Boolean) : view === "archived" ? s.tracks.filter((x) => x.archived) : view === "own" ? tracks.filter((x) => x.source === "local") : tracks;
  const shown = base.map((track, index) => ({ track, index })).filter(({ track }) => track.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()));

  async function upload(files) {
    if (!files.length || progress) return;
    setFailures([]);
    setProgress(t("importing"));
    try {
      const result = await player.importFiles(files, (i, n) => setProgress(`${t("importing")} ${i}/${n}`));
      setFailures(result.failures);
      if (result.imported.length) { notify(`${t("imported")}: ${result.imported.length}`); setView("own"); }
    } finally { setProgress(""); }
  }
  async function makePlaylist(e) {
    e.preventDefault();
    if (!name.trim()) return;
    const list = await player.savePlaylist(name.trim(), []).catch(() => null);
    if (list) { setView(list.id); setTarget(list.id); setName(""); }
  }
  async function saveQueue() {
    if (!name.trim()) return;
    const list = await player.savePlaylist(name.trim(), s.queue.tracks).catch(() => null);
    if (list) { setTarget(list.id); setView(list.id); setName(""); }
  }
  async function archive(track) {
    if (await confirm({ title: t("archive"), message: t("archiveHelp"), confirmLabel: t("archive") })) quietly(player.updateTrack(track.id, { archived: true }));
  }
  async function deleteList() {
    if (await confirm({ title: t("deleteConfirm"), message: t("deleteHelp"), confirmLabel: t("deletePlaylist") })) {
      await player.deletePlaylist(playlist.id).then(() => { setView("own"); if (target === playlist.id) setTarget(""); }).catch(() => {});
    }
  }
  const changeList = (next) => quietly(player.savePlaylist(playlist.name, next, playlist.id));
  const selectedTarget = s.playlists.find((x) => x.id === target);

  return <div className={`music-page ${dragging ? "music-drop-active" : ""}`}
    onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragging(true); } }}
    onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false); }}
    onDrop={(e) => { e.preventDefault(); setDragging(false); upload(e.dataTransfer.files); }}>
    <header className="page-head">
      <div><h1>{t("title")}</h1><p className="help">{t("help")}</p></div>
      <label className={`btn btn-primary music-upload ${progress ? "music-disabled" : ""}`}>
        {progress || t("add")}<input type="file" accept=".mp3,audio/mpeg" multiple disabled={!!progress} aria-label={t("add")}
          onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
      </label>
    </header>
    {progress && <p role="status">{progress}</p>}
    {failures.length > 0 && <div className="banner banner-danger" role="alert">{failures.map((text, i) => <div key={i}>{text}</div>)}</div>}
    {s.error && <div className="banner banner-danger" role="alert">{s.error === "unavailable" ? t("unavailable") : s.error} <button className="btn-link" onClick={player.loadLibrary}>{t("retry")}</button></div>}
    {!s.loaded ? <p role="status">{t("loading")}</p> : <>
      <div className="music-playlists">
        <h2>{t("playlists")}</h2>
        <form className="music-inline" onSubmit={makePlaylist}>
          <label className="grow min-w-0"><span className="sr-only">{t("name")}</span><input className="field w-full" placeholder={t("name")} value={name} maxLength={300} onChange={(e) => setName(e.target.value)} /></label>
          <button className="btn" disabled={s.saving || !name.trim()}>{t("create")}</button>
          <button type="button" className="btn" disabled={s.saving || !name.trim() || !s.queue.tracks.length} onClick={saveQueue}>{t("saveQueue")}</button>
        </form>
        <div className="music-list-tabs" role="group" aria-label={t("library")}>
          {[{ id: "own", name: t("own") }, { id: "all", name: t("all") }, ...s.playlists, { id: "archived", name: t("archived") }].map((x) =>
            <button type="button" key={x.id} className="btn btn-sm" aria-pressed={view === x.id} onClick={() => { setView(x.id); setQuery(""); setEditing(""); if (x.tracks) setTarget(x.id); }}>{x.name}{x.tracks ? ` (${x.tracks.length})` : ""}</button>)}
        </div>
      </div>
      <div className="music-columns">
        <section className="music-library" aria-label={t("library")}>
          <div className="music-section-head"><h2>{playlist ? playlist.name : t(view === "all" ? "all" : view === "archived" ? "archived" : "own")}</h2>
            {view !== "archived" && <button className="btn btn-sm" disabled={s.saving || !base.length} onClick={() => quietly(player.playTracks(base.map((x) => x.id)))}>{t("playAll")}</button>}
          </div>
          {playlist && <div className="music-inline">
            <button className="btn btn-sm" onClick={() => setEditing("playlist")}>{t("rename")}</button>
            <button className="btn btn-sm" onClick={deleteList} disabled={s.saving}>{t("deletePlaylist")}</button><span className="help">{t("addHelp")}</span>
          </div>}
          {editing === "playlist" && playlist && <Rename key={playlist.id} value={playlist.name} label={t("name")} t={t} cancel={() => setEditing("")}
            save={(next) => player.savePlaylist(next, playlist.tracks, playlist.id).then(() => setEditing("")).catch(() => {})} />}
          <div className="music-library-filters">
            <label className="grow min-w-0"><span className="sr-only">{t("search")}</span><input className="field w-full" type="search" placeholder={t("search")} value={query} onChange={(e) => setQuery(e.target.value)} /></label>
            {!playlist && view !== "archived" && <label><span className="sr-only">{t("choosePlaylist")}</span><select className="field" value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">{t("choosePlaylist")}</option>{s.playlists.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select></label>}
          </div>
          {!shown.length && <p className="help music-empty">{query ? t("noResults") : playlist ? t("playlistEmpty") : view === "archived" ? t("archiveEmpty") : t("empty")}</p>}
          <ol className="music-songs">
            {shown.map(({ track, index }) => <li key={`${track.id}:${index}`} className="music-song">
              <div className="music-song-info"><strong>{track.title}</strong><span className="help">{track.source === "local" ? `${t("personal")} · ${(track.bytes / 1048576).toFixed(1)} MB` : track.source === "showdown" ? "Showdown" : "PokéRogue"}</span></div>
              {editing === `${track.id}:${index}` ? <Rename value={track.title} label={t("songName")} t={t} cancel={() => setEditing("")}
                save={(title) => player.updateTrack(track.id, { title }).then(() => setEditing("")).catch(() => {})} /> : <div className="music-song-actions">
                {track.archived ? <button className="btn btn-sm" disabled={s.saving} onClick={() => quietly(player.updateTrack(track.id, { archived: false }))}>{t("restore")}</button> : <>
                  <button className="btn btn-sm" disabled={s.saving} onClick={() => quietly(player.playTracks(base.map((x) => x.id), index))}>{t("play")}</button>
                  <button className="btn btn-sm" disabled={s.saving} onClick={() => quietly(player.enqueue(track.id))} title={t("enqueue")}>{t("addShort")}</button>
                  {!playlist && <button className="btn btn-sm" disabled={s.saving || !selectedTarget} onClick={() => quietly(player.savePlaylist(selectedTarget.name, [...selectedTarget.tracks, track.id], selectedTarget.id))}>{t("addPlaylist")}</button>}
                  <button className="btn btn-sm" onClick={() => { setSettings({ music_track: track.id }); notify(t("battleSet")); }}>{t("battle")}</button>
                  {playlist && <><button className="btn btn-sm" aria-label={`${t("up")}: ${track.title}`} disabled={s.saving || index === 0} onClick={() => { const list = [...playlist.tracks]; [list[index - 1], list[index]] = [list[index], list[index - 1]]; changeList(list); }}>{t("up")}</button>
                    <button className="btn btn-sm" aria-label={`${t("down")}: ${track.title}`} disabled={s.saving || index === playlist.tracks.length - 1} onClick={() => { const list = [...playlist.tracks]; [list[index + 1], list[index]] = [list[index], list[index + 1]]; changeList(list); }}>{t("down")}</button>
                    <button className="btn btn-sm" disabled={s.saving} onClick={() => changeList(playlist.tracks.filter((_, i) => i !== index))}>{t("remove")}</button></>}
                  {track.source === "local" && !playlist && <><button className="btn btn-sm" onClick={() => setEditing(`${track.id}:${index}`)}>{t("rename")}</button>
                    <button className="btn btn-sm" disabled={s.saving} onClick={() => archive(track)}>{t("archive")}</button></>}
                </>}
              </div>}
            </li>)}
          </ol>
        </section>
        <section className="music-queue" aria-label={t("queue")}>
          <div className="music-section-head"><h2>{t("queue")} <span className="help">({s.queue.tracks.length})</span></h2><button className="btn btn-sm" disabled={s.saving || !s.queue.tracks.length} onClick={() => quietly(player.clearQueue())}>{t("clear")}</button></div>
          {!s.queue.tracks.length && <p className="help">{t("queueEmpty")}</p>}
          <ol className="music-songs">
            {s.queue.tracks.map((id, index) => <li key={`${id}:${index}`} className="music-queue-entry" aria-current={index === s.queue.index ? "true" : undefined}>
              <button type="button" className="btn-link music-queue-title" onClick={() => quietly(player.select(index))} disabled={s.saving}><span className="num">{index + 1}.</span> {player.titleOf(id, lang)}</button>
              <div className="music-song-actions"><button className="btn btn-sm" aria-label={`${t("up")}: ${index + 1}`} disabled={s.saving || index === 0} onClick={() => quietly(player.move(index, index - 1))}>{t("up")}</button>
                <button className="btn btn-sm" aria-label={`${t("down")}: ${index + 1}`} disabled={s.saving || index === s.queue.tracks.length - 1} onClick={() => quietly(player.move(index, index + 1))}>{t("down")}</button>
                <button className="btn btn-sm" aria-label={`${t("remove")}: ${index + 1}`} disabled={s.saving} onClick={() => quietly(player.remove(index))}>{t("remove")}</button></div>
            </li>)}
          </ol>
        </section>
      </div>
    </>}
  </div>;
}
