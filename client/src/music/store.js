import { api } from "../api.js";
import { getSettings, setSettings, music as battleMusic, subscribe as subscribeSound, unlock } from "../audio.js";
import { MUSIC_OPTIONS } from "../sound-strings.js";
import { moveEntry, nextIndex, removeEntry } from "./queue.js";

let state = { loaded: false, tracks: [], playlists: [], queue: { tracks: [], index: 0, repeat: "off", shuffle: false },
  playing: false, time: 0, duration: 0, error: "", saving: false };
const listeners = new Set();
let audio = null;
let source = "";
let loading = null;
let writes = Promise.resolve();
let revision = 0;
const emit = (patch) => { state = { ...state, ...patch }; listeners.forEach((fn) => fn()); };
export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const getLibrary = () => state;
export const allTracks = (lang = "es") => [...state.tracks.filter((x) => !x.archived), ...MUSIC_OPTIONS.map((x) => ({ ...x, title: x.label[lang === "en" ? 1 : 0] }))];
export const titleOf = (id, lang) => allTracks(lang).find((x) => x.id === id)?.title || id;
const volume = () => { if (audio) { const s = getSettings(); audio.volume = s.mute ? 0 : s.master * s.music * 0.55; } };

function element() {
  if (audio) return audio;
  audio = new Audio();
  audio.preload = "metadata";
  audio.addEventListener("timeupdate", () => emit({ time: audio.currentTime }));
  audio.addEventListener("durationchange", () => emit({ duration: Number.isFinite(audio.duration) ? audio.duration : 0 }));
  audio.addEventListener("play", () => emit({ playing: true }));
  audio.addEventListener("pause", () => emit({ playing: false }));
  audio.addEventListener("ended", () => advance(true));
  audio.addEventListener("error", () => emit({ playing: false, error: "unavailable" }));
  subscribeSound(volume);
  window.addEventListener("silver-battle-music", () => pause());
  volume();
  return audio;
}

function syncAudio(play = state.playing) {
  const id = state.queue.tracks[state.queue.index];
  if (!id) { pause(); source = ""; if (audio) { audio.removeAttribute("src"); audio.load(); } emit({ time: 0, duration: 0 }); return; }
  const el = element();
  if (source !== id) {
    source = id;
    el.src = `/api/music/${encodeURIComponent(id)}`;
    emit({ time: 0, duration: 0 });
  }
  if (play) {
    unlock();
    battleMusic.stop({ fade: 0 });
    el.play().catch(() => emit({ playing: false, error: "unavailable" }));
  }
}

export async function loadLibrary() {
  if (loading) return loading;
  loading = (async () => {
    for (;;) {
      await writes;
      const requestedRevision = revision;
      const data = await api.call("music_library");
      if (requestedRevision !== revision) continue;
      emit({ ...data, loaded: true, error: "" });
      syncAudio();
      return;
    }
  })().catch((e) => emit({ error: e.message })).finally(() => { loading = null; });
  return loading;
}

function write(fn) {
  const task = writes.then(async () => {
    revision += 1;
    emit({ saving: true, error: "" });
    try { return await fn(); }
    catch (e) { emit({ error: e.message }); throw e; }
    finally { emit({ saving: false }); }
  });
  writes = task.catch(() => {});
  return task;
}

export function editQueue(transform, play, restart = false) {
  return write(async () => {
    const previous = state.queue;
    const queue = transform(state.queue);
    const data = await api.call("music_queue_set", queue);
    emit(data);
    if (typeof restart === "function" ? restart(previous) : restart) seek(0);
    syncAudio(play ?? state.playing);
  });
}

export const playTracks = (tracks, index = 0) => editQueue((q) => ({ ...q, tracks, index }), true, true);
export const enqueue = (id) => editQueue((q) => ({ ...q, tracks: [...q.tracks, id] }));
export const move = (from, to) => editQueue((q) => moveEntry(q, from, to));
export const remove = (index) => editQueue((q) => removeEntry(q, index), undefined, (q) => q.index === index);
export const clearQueue = () => editQueue((q) => ({ ...q, tracks: [], index: 0 }), false);
export const select = (index) => editQueue((q) => ({ ...q, index }), true, true);
export const setMode = (patch) => editQueue((q) => ({ ...q, ...patch }));
export function pause() { audio?.pause(); emit({ playing: false }); }
export function toggle() { if (state.playing) pause(); else { emit({ error: "" }); syncAudio(true); } }
export function seek(time) { if (audio && Number.isFinite(time)) audio.currentTime = time; }
export function previous() {
  if (audio && audio.currentTime > 3) { seek(0); return Promise.resolve(); }
  return select(Math.max(0, state.queue.index - 1));
}
export async function advance(ended = false) {
  const index = nextIndex(state.queue, { ended });
  if (index < 0) { pause(); return; }
  if (index === state.queue.index) { seek(0); syncAudio(true); return; }
  return select(index).catch(() => {});
}

export function savePlaylist(name, tracks, id = "") {
  return write(async () => {
    const { playlist } = await api.call("music_playlist_save", { id, name, tracks });
    emit({ playlists: [...state.playlists.filter((x) => x.id !== playlist.id), playlist] });
    return playlist;
  });
}
export function deletePlaylist(id) {
  return write(async () => {
    await api.call("music_playlist_delete", { id });
    emit({ playlists: state.playlists.filter((x) => x.id !== id) });
  });
}
export function updateTrack(id, patch) {
  return write(async () => {
    const data = await api.call("music_track_update", { id, ...patch });
    emit(data);
    if (patch.archived && getSettings().music_track === id) {
      setSettings({ music_track: "auto" });
    }
    syncAudio();
  });
}
export async function importFiles(files, progress) {
  const failures = [];
  const imported = [];
  const batch = Array.from(files);
  for (const [index, file] of batch.entries()) {
    progress?.(index + 1, batch.length);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/music/upload", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || data.detail || response.statusText);
      revision += 1;
      imported.push(data.track.id);
    } catch (e) { failures.push(`${file.name}: ${e.message}`); }
  }
  await loadLibrary();
  return { imported, failures };
}
