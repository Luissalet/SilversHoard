// The sound mapping of the battle screens (client/src/audio.js, client/src/battle/sfx.js) is plain JavaScript: checked here
// without a browser. Playing itself (WebAudio) needs a browser; these tests cover which cue goes with which event.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { genOfFormat, getSettings, pickTrack, sfx } from "../../client/src/audio.js";
import { applyLine, newState } from "../../client/src/battle/protocol.js";
import { levelOf, newSfxState, playLine, playRtEvent, preloadSfx, sfxPre } from "../../client/src/battle/sfx.js";
import moveTypes from "../../client/src/battle/move-types.js";

const SOUNDS_PY = readFileSync(new URL("../../silvers_hoard/sounds.py", import.meta.url), "utf8");
const WHITELIST = [...SOUNDS_PY.match(/TRACKS = \(([\s\S]*?)\)/)[1].matchAll(/"([a-z0-9-]+)"/g)].map((m) => m[1]);

test("a battle always gets the same track, from the right generation, and the server serves it", () => {
  assert.equal(WHITELIST.length, 18);
  for (const gen of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) {
    for (const id of ["a1", "b-22", "zz9", "battle-x"]) {
      const t = pickTrack(id, gen);
      assert.ok(WHITELIST.includes(t), t);
      assert.equal(t, pickTrack(id, gen));
    }
  }
  assert.match(pickTrack("any", 4), /^dpp-/);
  assert.match(pickTrack("any", 6), /^xy-/);
  assert.match(pickTrack("any", 7), /^sm-/);
  assert.match(pickTrack("any", 1), /^hgss-/);
  assert.match(pickTrack("any", 9), /^bw/);
  assert.equal(new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => pickTrack(id, 5))).size > 1, true, "ids spread over the tracks of a generation");
  assert.equal(genOfFormat("gen9nationaldexag"), 9);
  assert.equal(genOfFormat("gen4ou"), 4);
  assert.equal(genOfFormat("custom"), 0);
});

test("the mixer has sane defaults and never throws without a browser", () => {
  assert.equal(getSettings().mute, false);
  assert.doesNotThrow(() => sfx("hit"));
  assert.doesNotThrow(() => sfx("no-such-cue"));
});

test("move types are packed for every move", () => {
  assert.equal(moveTypes.flamethrower, "Fire");
  assert.equal(moveTypes.surf, "Water");
  assert.equal(moveTypes.thunderbolt, "Electric");
  assert.equal(moveTypes.shadowball, "Ghost");
  assert.ok(Object.keys(moveTypes).length > 800);
});

test("playback speed decides how much plays", () => {
  assert.equal(levelOf(900), 2);
  assert.equal(levelOf(450), 2);
  assert.equal(levelOf(200), 1);
  assert.equal(levelOf(100), 0);
});

function run(lines, speedMs = 900) {
  const state = newState();
  const heard = [];
  const crys = [];
  const mem = newSfxState();
  for (const line of lines) {
    const pre = sfxPre(state, line);
    const ev = applyLine(state, line, { lang: "en", me: "p1" });
    playLine(state, line, ev, pre, mem, {
      speedMs,
      cryUrl: (sp) => `/cry/${sp}`,
      sfx: (n, o) => heard.push(o && o.status ? `${n}:${o.status}` : n),
      cry: (u, o) => crys.push(o.faint ? `${u}!` : u),
    });
  }
  return { heard, crys };
}

await preloadSfx();

const OPEN = ["|player|p1|A", "|player|p2|B", "|start", "|switch|p1a: Garchomp|Garchomp, L50|100/100", "|switch|p2a: Charizard|Charizard, L50|100/100", "|turn|1"];

test("a super effective hit makes one impact, not two; resisted, critical and plain hits have their own", () => {
  const sup = run([...OPEN, "|move|p1a: Garchomp|Stone Edge|p2a: Charizard", "|-supereffective|p2a: Charizard", "|-damage|p2a: Charizard|40/100"]);
  assert.deepEqual(sup.heard.slice(2), ["move", "super"]);
  const res = run([...OPEN, "|move|p1a: Garchomp|Ice Beam|p2a: Charizard", "|-resisted|p2a: Charizard", "|-damage|p2a: Charizard|90/100"]);
  assert.deepEqual(res.heard.slice(2), ["move", "resisted"]);
  const crit = run([...OPEN, "|move|p1a: Garchomp|Dragon Claw|p2a: Charizard", "|-crit|p2a: Charizard", "|-damage|p2a: Charizard|50/100"]);
  assert.deepEqual(crit.heard.slice(2), ["move", "crit"]);
  const plain = run([...OPEN, "|move|p1a: Garchomp|Dragon Claw|p2a: Charizard", "|-damage|p2a: Charizard|70/100",
    "|move|p1a: Garchomp|Dragon Claw|p2a: Charizard", "|-supereffective|p2a: Charizard", "|-damage|p2a: Charizard|10/100",
    "|move|p2a: Charizard|Tackle|p1a: Garchomp", "|-damage|p1a: Garchomp|90/100"]);
  assert.deepEqual(plain.heard.slice(2), ["move", "hit", "move", "super", "move", "hit"]);
});

test("chip damage, misses, status, boosts, healing and fainting", () => {
  const r = run([...OPEN, "|-damage|p2a: Charizard|80/100|[from] Sandstorm", "|move|p1a: Garchomp|Stone Edge|p2a: Charizard", "|-miss|p1a: Garchomp|p2a: Charizard",
    "|-status|p2a: Charizard|par", "|-boost|p1a: Garchomp|atk|1", "|-unboost|p2a: Charizard|def|1", "|-heal|p2a: Charizard|90/100|[from] item: Leftovers",
    "|-heal|p2a: Charizard|100/100", "|faint|p2a: Charizard"]);
  assert.deepEqual(r.heard.slice(2), ["chip", "move", "miss", "status:par", "statUp", "statDown", "heal", "faint"]);
  assert.deepEqual(r.crys.slice(-1), ["/cry/Charizard!"]);
});

test("switching: a ball sound and the cry, with the outgoing Pokémon recalled when it was standing", () => {
  const first = run(OPEN);
  assert.deepEqual(first.heard, ["switchIn", "switchIn"]);
  assert.deepEqual(first.crys, ["/cry/Garchomp", "/cry/Charizard"]);
  const swap = run([...OPEN, "|switch|p1a: Dragonite|Dragonite, L50|100/100"]);
  assert.deepEqual(swap.heard.slice(2), ["switchOut", "switchIn"]);
  const afterFaint = run([...OPEN, "|faint|p1a: Garchomp", "|switch|p1a: Dragonite|Dragonite, L50|100/100"]);
  assert.deepEqual(afterFaint.heard.slice(2), ["faint", "switchIn"]);
});

test("fast replays skip cries and small sounds", () => {
  const lines = [...OPEN, "|move|p1a: Garchomp|Stone Edge|p2a: Charizard", "|-supereffective|p2a: Charizard", "|-damage|p2a: Charizard|0 fnt", "|faint|p2a: Charizard"];
  const mid = run(lines, 250);
  assert.deepEqual(mid.heard, ["switchIn", "switchIn", "super", "faint"]);
  assert.deepEqual(mid.crys, []);
  const fast = run(lines, 100);
  assert.deepEqual(fast.heard, ["super", "faint"]);
});

test("real-time events", () => {
  const heard = [];
  const crys = [];
  const o = { cryUrl: (s) => `/cry/${s}`, sfx: (n) => heard.push(n), cry: (u, x) => crys.push(u + (x.faint ? "!" : "")) };
  for (const e of [{ k: "use", type: "Fire" }, { k: "hit", eff: 2 }, { k: "hit", eff: 0.5 }, { k: "hit", eff: 1, crit: true }, { k: "hit", eff: 1, hit: 0 }, { k: "miss" },
    { k: "status", status: "brn" }, { k: "boost", delta: 1 }, { k: "boost", delta: -1 }, { k: "boost", same: true }, { k: "switch", species: "Mew" }, { k: "recall" },
    { k: "faint", species: "Mew" }]) playRtEvent(e, o);
  assert.deepEqual(heard, ["move", "super", "resisted", "crit", "hit", "miss", "status", "statUp", "statDown", "switchIn", "switchOut", "faint"]);
  assert.deepEqual(crys, ["/cry/Mew", "/cry/Mew!"]);
  heard.length = 0;
  for (const e of [{ k: "use" }, { k: "chip" }, { k: "hit", eff: 1 }, { k: "faint" }]) playRtEvent(e, { ...o, speed: 4 });
  assert.deepEqual(heard, ["hit", "faint"]);
});
