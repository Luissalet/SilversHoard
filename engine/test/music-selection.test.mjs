import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MUSIC_OPTIONS } from "../../client/src/sound-strings.js";

const stored = new Map();
globalThis.localStorage = { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, v) };
const created = [];
globalThis.Audio = class {
  constructor() { this.paused = true; this.currentTime = 0; this.events = {}; created.push(this); }
  addEventListener(k, fn) { this.events[k] = fn; }
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
  removeAttribute(k) { if (k === "src") this.src = ""; }
  load() {}
};
const { getSettings, music, musicTrackUrl, setSettings } = await import("../../client/src/audio.js");
afterEach(() => { music.stop({ fade: 0 }); music.hold(false); setSettings({ music_track: "auto", mute: false, master: 0.8, music: 0.5 }); });

test("the selector exposes every existing server track once, with both labels", () => {
  const source = readFileSync(new URL("../../silvers_hoard/sounds.py", import.meta.url), "utf8");
  const standard = [...source.match(/TRACKS = \(([\s\S]*?)\)/)[1].matchAll(/"([a-z0-9-]+)"/g)].map((m) => m[1]);
  const community = [...source.split("PR_TRACKS = {")[1].split("NEGATIVE_TTL_S")[0].matchAll(/"([a-z0-9_]+)"/g)].map((m) => `pr-${m[1]}`);
  assert.deepEqual(MUSIC_OPTIONS.map((x) => x.id).sort(), [...standard, ...community].sort());
  assert.equal(new Set(MUSIC_OPTIONS.map((x) => x.id)).size, MUSIC_OPTIONS.length);
  assert.ok(MUSIC_OPTIONS.every((x) => x.label.length === 2 && x.label.every(Boolean)));
});

test("manual music preserves the audio origin, automatic restores the battle default", () => {
  assert.equal(musicTrackUrl("https://silver.example/api/music/bw-trainer", "pr-volcano"), "https://silver.example/api/music/pr-volcano");
  assert.equal(musicTrackUrl("/api/music/bw-trainer", "xy-rival"), "/api/music/xy-rival");
  assert.equal(musicTrackUrl("/api/music/bw-trainer", "auto"), "/api/music/bw-trainer");
  assert.equal(musicTrackUrl("/api/music/bw-trainer", "none"), "");
  assert.equal(musicTrackUrl("/other/audio.mp3", "xy-rival"), "/other/audio.mp3");
  assert.equal(musicTrackUrl(undefined, "xy-rival"), "");
});

test("changing the choice during playback switches immediately and keeps volume settings", async () => {
  music.play("/api/music/bw-trainer");
  setSettings({ music_track: "xy-rival" });
  const track = created.at(-1);
  await new Promise((resolve) => setTimeout(resolve, 80)); // the existing fade updates volume every 50ms
  assert.equal(track.src, "/api/music/xy-rival");
  assert.equal(track.paused, false);
  assert.equal(getSettings().master, 0.8);
  assert.equal(getSettings().music, 0.5);
  track.currentTime = 12;
  setSettings({ sfx: 0.6 });
  music.play("/api/music/bw-trainer");
  assert.equal(created.at(-1), track);
  assert.equal(track.currentTime, 12, "sliders and repeated music effects do not restart the song");
  setSettings({ music_track: "auto" });
  assert.equal(created.at(-1).src, "/api/music/bw-trainer");
});

test("no music can resume automatically, but a finished battle cannot be resurrected", () => {
  music.play("/api/music/bw-trainer");
  setSettings({ music_track: "none" });
  assert.equal(music.playing, false);
  setSettings({ music_track: "pr-volcano" });
  assert.equal(created.at(-1).src, "/api/music/pr-volcano");
  music.stop({ fade: 0 });
  const count = created.length;
  setSettings({ music_track: "xy-trainer" });
  assert.equal(created.length, count, "a preference change after battleEnd/unmount stays silent");
  assert.equal(music.playing, false);
});

test("a music choice made while muted or held keeps those states", async () => {
  setSettings({ mute: true });
  music.play("/api/music/bw-trainer");
  setSettings({ music_track: "xy-rival" });
  assert.equal(created.at(-1).paused, true);
  setSettings({ mute: false });
  assert.equal(created.at(-1).paused, false);
  music.hold(true);
  setSettings({ music_track: "pr-forest" });
  assert.equal(created.at(-1).paused, true);
  music.hold(false);
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(created.at(-1).paused, false);
});

test("the viewer's choice persists; older mixer data and unknown tracks fall back to automatic", async () => {
  setSettings({ music_track: "pr-volcano" });
  const reloaded = await import(`../../client/src/audio.js?music-persistence=${Date.now()}`);
  assert.equal(reloaded.getSettings().music_track, "pr-volcano");
  setSettings({ music_track: "missing-track" });
  assert.equal(getSettings().music_track, "auto");
  stored.set("silver-sound", JSON.stringify({ master: 0.4, music: 0.2, mute: true }));
  const old = await import(`../../client/src/audio.js?old-mixer=${Date.now()}`);
  assert.equal(old.getSettings().music_track, "auto");
  assert.equal(old.getSettings().master, 0.4);
  assert.equal(old.getSettings().mute, true);
});
