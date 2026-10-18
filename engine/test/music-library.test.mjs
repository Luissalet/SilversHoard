import test from "node:test";
import assert from "node:assert/strict";
import { moveEntry, nextIndex, removeEntry } from "../../client/src/music/queue.js";

const q = { tracks: ["a", "b", "a"], index: 2, repeat: "off", shuffle: false };
test("moving repeated songs preserves the current occurrence", () => {
  assert.deepEqual(moveEntry(q, 2, 0), { ...q, tracks: ["a", "a", "b"], index: 0 });
  assert.equal(moveEntry(q, 0, 1).index, 2);
  assert.equal(moveEntry(q, -1, 0), q);
});
test("removing songs before, at and after the current occurrence", () => {
  assert.deepEqual(removeEntry(q, 0), { ...q, tracks: ["b", "a"], index: 1 });
  assert.deepEqual(removeEntry(q, 2), { ...q, tracks: ["a", "b"], index: 1 });
  assert.deepEqual(removeEntry({ ...q, tracks: ["a"], index: 0 }, 0), { ...q, tracks: [], index: 0 });
});
test("queue end, repeat one/all and shuffle avoid the current occurrence", () => {
  assert.equal(nextIndex(q), -1);
  assert.equal(nextIndex({ ...q, repeat: "one" }, { ended: true }), 2);
  assert.equal(nextIndex({ ...q, repeat: "one" }), -1);
  assert.equal(nextIndex({ ...q, repeat: "all" }), 0);
  assert.equal(nextIndex({ ...q, tracks: [] }), -1);
  for (const index of [0, 1, 2]) for (const random of [() => 0, () => .999]) {
    const pick = nextIndex({ ...q, index, shuffle: true }, { random });
    assert.notEqual(pick, index);
    assert.ok(pick >= 0 && pick < 3);
  }
});
test("personal battle track selections survive preferences and preserve the origin", async () => {
  const { musicTrackUrl, getSettings, setSettings } = await import("../../client/src/audio.js");
  const id = "local-" + "a".repeat(64);
  setSettings({ music_track: id });
  assert.equal(getSettings().music_track, id);
  assert.equal(musicTrackUrl("https://silver.example/api/music/bw-trainer"), `https://silver.example/api/music/${id}`);
  setSettings({ music_track: "local-../../bad" });
  assert.equal(getSettings().music_track, "auto");
});

test("the listening player preserves navigation state, serializes queue edits and rejects stale reloads", async () => {
  const original = { window: globalThis.window, Audio: globalThis.Audio, fetch: globalThis.fetch };
  const win = new EventTarget();
  win.location = { origin: "http://silver.test" };
  globalThis.window = win;
  const created = [];
  globalThis.Audio = class extends EventTarget {
    currentTime = 0; duration = 18; paused = true;
    constructor() { super(); created.push(this); }
    play() { this.paused = false; this.dispatchEvent(new Event("play")); return Promise.resolve(); }
    pause() { this.paused = true; this.dispatchEvent(new Event("pause")); }
    removeAttribute() {}
    load() {}
  };
  let server = { tracks: [], playlists: [], queue: { tracks: [], index: 0, repeat: "off", shuffle: false } };
  let heldRead = null;
  let hold = false;
  const response = (data) => ({ ok: true, status: 200, text: async () => JSON.stringify(data) });
  globalThis.fetch = async (_, options) => {
    if (options.body instanceof FormData) {
      const track = { id: "local-" + "b".repeat(64), title: "Imported", source: "local" };
      server.tracks.push(track);
      return { ok: true, json: async () => ({ track }) };
    }
    const request = JSON.parse(options.body);
    if (request.name === "music_library") {
      const captured = structuredClone(server);
      if (hold) { hold = false; return new Promise((resolve) => { heldRead = () => resolve(response(captured)); }); }
      return response(captured);
    }
    if (request.name === "music_queue_set") { server.queue = request.arguments; return response({ queue: server.queue }); }
    throw new Error(request.name);
  };
  try {
    const p = await import("../../client/src/music/store.js");
    await p.loadLibrary();
    await p.playTracks(["bw-trainer", "xy-rival", "bw-trainer"], 2);
    assert.equal(p.getLibrary().playing, true);
    const el = created[0];
    el.currentTime = 9;
    await p.move(2, 0);
    assert.equal(el.currentTime, 9, "moving the current occurrence must not restart playback");
    await p.select(1);
    assert.equal(el.currentTime, 0, "selecting another occurrence starts it from the beginning");
    await Promise.all([p.enqueue("pr-volcano"), p.enqueue("bw-rival")]);
    assert.deepEqual(server.queue.tracks.slice(-2), ["pr-volcano", "bw-rival"]);
    hold = true;
    const stale = p.loadLibrary();
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(heldRead);
    await p.enqueue("xy-trainer");
    heldRead();
    await stale;
    assert.equal(p.getLibrary().queue.tracks.at(-1), "xy-trainer", "late snapshot cannot erase a newer queue edit");
    hold = true;
    const beforeImport = p.loadLibrary();
    await new Promise((resolve) => setImmediate(resolve));
    const importing = p.importFiles([new File(["mp3"], "new.mp3")]);
    await new Promise((resolve) => setImmediate(resolve));
    heldRead();
    await Promise.all([beforeImport, importing]);
    assert.equal(p.getLibrary().tracks.length, 1, "a read started before import cannot hide the imported song");
    assert.equal(created.length, 1, "refreshing metadata keeps the same audio element");
    win.dispatchEvent(new Event("silver-battle-music"));
    assert.equal(p.getLibrary().playing, false, "battle music pauses personal listening");
    await p.clearQueue();
    assert.equal(p.getLibrary().queue.tracks.length, 0);
  } finally {
    for (const [key, value] of Object.entries(original)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
  }
});
