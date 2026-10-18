import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

const elements = [];
globalThis.Audio = class extends EventTarget {
  constructor() { super(); this.paused = true; this.readyState = 0; this.pauseCalls = 0; elements.push(this); }
  play() {
    this.paused = false;
    if (!this.pending) this.pending = Promise.withResolvers();
    return this.pending.promise;
  }
  pause() {
    this.pauseCalls++; this.paused = true;
    this.pending?.reject(new DOMException("Interrupted by pause", "AbortError")); this.pending = null;
  }
  removeAttribute(name) { if (name === "src") this.src = ""; }
  load() { this.readyState = 0; this.dispatchEvent(new Event("emptied")); }
  loaded() {
    this.readyState = 4; this.dispatchEvent(new Event("canplay"));
    this.pending?.resolve(); this.pending = null;
  }
};
class Node { constructor() { this.gain = { value: 1 }; } connect() {} }
globalThis.AudioContext = class {
  constructor() { this.state = "running"; this.destination = new Node(); }
  createGain() { return new Node(); }
  createDynamicsCompressor() { return new Node(); }
};
const { music, setSettings, unlock } = await import("../../client/src/audio.js");
afterEach(() => { music.stop({ fade: 0 }); music.hold(false); setSettings({ master: .8, music: .5, mute: false, music_track: "auto" }); });

test("unlock during the initial zero-volume fade does not abort the requested song", async () => {
  music.play("/api/music/bw-trainer"); const el = elements.at(-1);
  assert.equal(el.volume, 0);
  unlock(); // Creating the effects context applies mixer volumes before the first fade timer.
  assert.equal(el.pauseCalls, 0, "a fade starting at zero must not pause a pending play");
  el.loaded(); await Promise.resolve();
  assert.equal(music.playing, true);
});

test("recording readiness waits for delayed music without advancing or restarting it", async () => {
  music.play("/api/music/bw-trainer"); const el = elements.at(-1);
  let ready = false; const wait = music.ready().then(() => { ready = true; });
  await Promise.resolve(); assert.equal(ready, false);
  el.currentTime = 7; el.loaded(); await wait;
  assert.equal(ready, true); assert.equal(el.currentTime, 7); assert.equal(elements.at(-1), el);
  await music.ready();
});

test("unavailable or disposed music settles readiness instead of leaving an orphan wait", async () => {
  music.play("/api/music/bw-trainer"); const el = elements.at(-1);
  const unavailable = music.ready(); el.dispatchEvent(new Event("error")); await unavailable;
  music.play("/api/music/bw-rival"); const disposed = music.ready();
  music.stop({ fade: 0 }); await disposed;
});

test("a cancelled or silent music choice needs no audio download before recording", async () => {
  await music.ready();
  for (const patch of [{ music_track: "none" }, { music: 0 }, { master: 0 }, { mute: true }]) {
    setSettings({ music_track: "auto", music: .5, master: .8, mute: false, ...patch });
    music.play("/api/music/bw-trainer"); await music.ready();
    assert.equal(music.playing, false); music.stop({ fade: 0 });
  }
});

test("actual mixer silence and hold still pause, then resume the same song", async () => {
  music.play("/api/music/bw-trainer"); const el = elements.at(-1); el.loaded();
  await Promise.resolve();
  setSettings({ music: 0 }); assert.equal(el.paused, true);
  setSettings({ music: .5 }); assert.equal(el.paused, false);
  el.loaded(); await Promise.resolve();
  music.hold(true); assert.equal(el.paused, true);
  music.hold(false); assert.equal(el.paused, false);
});
