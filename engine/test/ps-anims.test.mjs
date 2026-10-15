// Showdown's move animations on the turn-based screen (client/src/battle/fx/ps): every animation of the table runs against our scene
// without throwing, ends in a sane time, draws only pictures the table knows, and lands on the arena's own sprite positions.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BattleEffects, BattleMoveAnims, BattleStatusAnims } from "../../client/src/battle/fx/ps/anims.gen.js";
import { EASE, PsScene, buildMove, buildOther, buildStatus, easingFor, effectFiles, fxUrl, hasMoveAnim, moveAnimCount, parseBackground, spaceFrom }
  from "../../client/src/battle/fx/ps/scene.js";

const near = { x: 150, y: 260 }, far = { x: 470, y: 120 };
const space = spaceFrom({ near, far, width: 640 });
const sp = { url: "https://play.pokemonshowdown.com/sprites/gen5ani/pikachu.gif", w: 96, h: 96 };
const who = (center, isNear) => ({ center, near: isNear, sp, apply: () => {} });

test("the table has Showdown's 934 moves and they all play", () => {
  assert.ok(moveAnimCount() >= 900, `only ${moveAnimCount()} moves`);
  const bad = [];
  let longest = ["", 0];
  for (const id of Object.keys(BattleMoveAnims)) {
    for (const miss of [false, true]) {
      const s = buildMove(id, { space, attacker: who(near, true), defender: who(far, false), miss });
      if (!s) { bad.push(`${id}${miss ? " (miss)" : ""}`); continue; }
      const d = s.duration();
      if (!(Number.isFinite(d) && d >= 0 && d < 15000)) bad.push(`${id}: ${d} ms`);
      if (d > longest[1]) longest = [id, d];
    }
  }
  assert.deepEqual(bad, []);
  assert.ok(longest[1] > 1000, "some animations last over a second");
});

test("self moves and the far side work too", () => {
  for (const id of ["swordsdance", "recover", "raindance", "stealthrock", "protect"]) {
    const self = buildMove(id, { space, attacker: who(far, false) });
    assert.ok(self && self.duration() > 0, id);
  }
  const back = buildMove("icebeam", { space, attacker: who(far, false), defender: who(near, true) });
  assert.ok(back.effects.length > 0);
});

test("every effect picture is one of the table's (no unknown names)", () => {
  const known = new Set(effectFiles());
  for (const id of Object.keys(BattleMoveAnims)) {
    const s = buildMove(id, { space, attacker: who(near, true), defender: who(far, false) });
    assert.ok(s, id);
    for (const e of s.effects) {
      if (!e.src || e.src === sp.url) continue;
      assert.ok(known.has(e.src) || e.src.includes("pokemonshowdown.com"), `${id}: ${e.src}`);
    }
  }
  assert.ok(known.size >= 55);
});

test("Ice Beam is a line of icicles from the attacker to the defender and bursts of ice on it", () => {
  const s = buildMove("icebeam", { space, attacker: who(near, true), defender: who(far, false) });
  const centre = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  const icicles = s.effects.filter((e) => e.src === BattleEffects.icicle.url).map((e) => centre(e.segs[0].a));
  assert.equal(icicles.length, 4);
  // spaced along the line, each one further from the attacker
  for (let i = 0; i < 4; i++) {
    const f = (i + 1) / 5;
    const want = { x: near.x + (far.x - near.x) * f, y: near.y + (far.y - near.y) * f };
    assert.ok(Math.hypot(icicles[i].x - want.x, icicles[i].y - want.y) < 40, `icicle ${i}: ${JSON.stringify(icicles[i])}`);
  }
  const balls = s.effects.filter((e) => e.src === BattleEffects.iceball.url);
  assert.ok(balls.length >= 2);
  for (const b of balls) assert.ok(Math.hypot(centre(b.segs[0].b).x - far.x, centre(b.segs[0].b).y - far.y) < 2, "on the defender");
});

test("Earthquake shakes the field", () => {
  const s = buildMove("earthquake", { space, attacker: who(near, true), defender: who(far, false) });
  const shakes = [];
  for (let t = 0; t < s.duration(); t += 25) shakes.push(Math.abs(s.quakeAt(t)));
  assert.ok(Math.max(...shakes) > 3, "it moves");
  assert.equal(s.quakeAt(s.duration() + 1), 0);
});

test("the participants sit exactly where the arena draws them, doubles included", () => {
  const scene = new PsScene({ space });
  for (const c of [near, far, { x: 230, y: 280 }, { x: 520, y: 100 }]) {
    const z = c.y > 200 ? 0 : 200;
    const s = scene.sprite({ center: c, near: z === 0, sp });
    const r = scene.pos({ x: s.x, y: s.y, z }, sp);
    assert.ok(Math.abs(r.left + r.width / 2 - c.x) < 0.01 && Math.abs(r.top + r.height / 2 - c.y) < 0.01, JSON.stringify(c));
  }
});

test("a lunge moves the attacker's picture and brings it back", () => {
  const seen = [];
  const attacker = { center: near, near: true, sp, apply: (r) => seen.push(r) };
  const s = buildMove("tackle", { space, attacker, defender: who(far, false) });
  const mid = s.sprites[0].at(s.sprites[0].segs[0].t1);
  assert.ok(mid.left > s.sprites[0].rest.left + 20, "it moved toward the foe");
  const end = s.sprites[0].at(s.duration() + 1);
  assert.ok(Math.abs(end.left - s.sprites[0].rest.left) < 0.5 && Math.abs(end.top - s.sprites[0].rest.top) < 0.5, "and back");
  s.applySprites(100);
  assert.equal(seen.length, 1);
});

test("status, other animations and the easing curves", () => {
  for (const st of Object.keys(BattleStatusAnims)) assert.ok(buildStatus(st, { space, target: who(near, true) }), st);
  assert.equal(buildStatus("nothing", { space, target: who(near, true) }), null);
  assert.ok(buildOther("megaevo", { space, attacker: who(near, true) }).duration() > 0);
  for (const [k, f] of Object.entries(EASE)) {
    assert.ok(Math.abs(f(0)) < 1e-9 && Math.abs(f(1) - 1) < 1e-9, k);
  }
  assert.equal(easingFor("ballistic", { endTop: 10, oldTop: 50, endZ: 0 }).top, "ballisticUp");
  assert.equal(easingFor("decel", { endTop: 0, oldTop: 0, endZ: 0 }).left, "quadUp");
});

test("backgrounds, URLs and the unknown", () => {
  assert.deepEqual(parseBackground("#000000"), { kind: "color", color: "#000000" });
  const g = parseBackground("linear-gradient(#390000 30%, #B84038)");
  assert.equal(g.kind, "gradient");
  assert.deepEqual(g.stops.map((s) => s.at), [0.3, 1]);
  assert.equal(parseBackground("url('https://play.pokemonshowdown.com/fx/bg-space.jpg')").src, "https://play.pokemonshowdown.com/fx/bg-space.jpg");
  assert.equal(fxUrl("wisp.png"), "/api/fx/wisp.png");
  assert.equal(fxUrl("https://play.pokemonshowdown.com/fx/weather-hail.png"), "/api/fx/weather-hail.png");
  assert.equal(fxUrl("https://play.pokemonshowdown.com/sprites/gen6bgs/bg-icecave.jpg"), "/api/fx/bg/bg-icecave.jpg");
  assert.equal(fxUrl("wisp.png", { local: false }), "https://play.pokemonshowdown.com/fx/wisp.png");
  assert.equal(fxUrl(sp.url), "https://play.pokemonshowdown.com/sprites/gen5ani/pikachu.gif");
  assert.equal(hasMoveAnim("notamove"), false);
  assert.equal(buildMove("notamove", { space, attacker: who(near, true) }), null);
  assert.ok(buildMove("notamove", { space, attacker: who(near, true), defender: who(far, false), fallback: true }));
});

test("drawing calls the canvas with the pictures and the flashes", () => {
  const calls = [];
  const ctx = new Proxy({}, {
    get: (_, k) => (k === "createLinearGradient" ? () => ({ addColorStop() {} }) : typeof k === "string" && /^[a-z]/.test(k) ? (...a) => calls.push([k, ...a]) : undefined),
    set: () => true,
  });
  const img = { naturalWidth: 100, naturalHeight: 100 };
  const s = buildMove("hyperbeam", { space, attacker: who(near, true), defender: who(far, false), images: () => img, resolve: (p) => fxUrl(p, { local: false }) });
  for (let t = 0; t < s.duration(); t += 50) s.draw(t, ctx, ctx, { w: 640, h: 360, dpr: 1 });
  assert.ok(calls.some((c) => c[0] === "drawImage"));
  assert.ok(calls.some((c) => c[0] === "fillRect"), "Hyper Beam darkens the background");
});

test("backdrops: Showdown's lists, one per battle by generation, weather and field overlays", async () => {
  const gen = await import("../../client/src/battle/fx/ps/anims.gen.js");
  const bd = await import("../../client/src/battle/fx/backdrop.js");
  assert.deepEqual(bd.BACKDROPS, gen.BattleBackdrops);
  assert.deepEqual(bd.BACKDROPS_GEN5, gen.BattleBackdropsFive);
  assert.deepEqual(bd.BACKDROPS_GEN4, gen.BattleBackdropsFour);
  assert.deepEqual(bd.BACKDROPS_GEN3, gen.BattleBackdropsThree);
  assert.equal(bd.backdropPath(1, 5), "fx/bg-gen1.png");
  assert.match(bd.backdropPath(4, 7), /^fx\/bg-gen4/);
  assert.match(bd.backdropPath(9, 3), /^sprites\/gen6bgs\/bg-/);
  const s = bd.seedOf("Lance|Red|gen9ou");
  assert.equal(s, bd.seedOf("Lance|Red|gen9ou"));
  assert.equal(bd.backdropUrl({ gen: 9, seed: 0, local: true }), "/api/fx/bg/bg-aquacordetown.jpg");
  assert.equal(bd.backdropUrl({ gen: 5, seed: 0, local: false }), "https://play.pokemonshowdown.com/fx/bg-beach.png");
  assert.deepEqual(bd.weatherLayer("RainDance", { local: true }), { url: "/api/fx/weather-raindance.jpg", opacity: 0.5 });
  assert.equal(bd.weatherLayer("desolateland", { local: true }).opacity, 0.9);
  assert.equal(bd.weatherLayer("", { local: true }), null);
  assert.equal(bd.fieldLayer(["Trick Room", "Psychic Terrain"], { local: true }).url, "/api/fx/weather-psychicterrain.png");
  assert.equal(bd.fieldLayer(["Tailwind"], { local: true }), null);
});
