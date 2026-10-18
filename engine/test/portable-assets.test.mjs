import assert from "node:assert/strict";
import test from "node:test";
import { EMPTY_IMAGE, installPortableAssets, portableAsset } from "../../client/src/portable-assets.js";
import { makeSprites } from "../../client/src/battle/dex.js";
import { fxUrl } from "../../client/src/battle/fx/ps/url.js";
import { RebornRunner } from "../../client/src/battle/fx/reborn/runner.js";

const SERVER = "https://play.pokemonshowdown.com/sprites";
const DATA = "data:image/png;base64,cached";

test("standalone sprites use their cached fallback and every missing presentation stays local", () => {
  installPortableAssets({ files: { mew: DATA, effect: DATA }, urls: { [`${SERVER}/gen5/mew.png`]: "mew", "https://play.pokemonshowdown.com/fx/wisp.png": "effect" } });
  try {
    const sprites = makeSprites({ server: SERVER });
    assert.equal(sprites.pokemon("Mew"), DATA); // animated absent, static cached
    for (const url of [sprites.pokemon("Uncached"), sprites.fallback("Uncached"), sprites.trainer("sd:uncached"),
      sprites.portrait("Mew", "Happy", { num: 151 }), fxUrl("missing.png", { local: false }), fxUrl("missing.png")]) {
      assert.match(url, /^data:image\//);
      assert.doesNotMatch(url, /^https?:/);
    }
    assert.equal(fxUrl("wisp.png", { local: false }), DATA);
    assert.equal(portableAsset("https://missing.invalid/anything", { missing: "" }), "");
    assert.match(decodeURIComponent(sprites.pokemon("<Uncached>")), />UN<\/text>/);
  } finally { installPortableAssets(null); }
});

test("app and live-room providers retain their original routes and embedded files remain exact", () => {
  installPortableAssets(null);
  assert.equal(makeSprites().pokemon("Mew"), "/api/sprites/pokemon/mew?back=0&shiny=0&set=gen5ani");
  assert.equal(makeSprites({ server: SERVER }).pokemon("Mew"), `${SERVER}/gen5ani/mew.gif`);
  assert.equal(fxUrl("wisp.png"), "/api/fx/wisp.png");
  installPortableAssets({ files: {}, urls: {} });
  try {
    assert.equal(portableAsset(DATA), DATA);
    assert.equal(portableAsset("blob:embedded"), "blob:embedded");
    assert.equal(portableAsset("https://missing.invalid/image"), EMPTY_IMAGE);
  } finally { installPortableAssets(null); }
});

test("missing standalone Reborn animation never starts a fetch and leaves Silver's fallback available", () => {
  const oldDocument = globalThis.document, oldFetch = globalThis.fetch;
  let requests = 0;
  globalThis.document = { getElementById: () => ({}) };
  globalThis.fetch = () => { requests++; throw new Error("No request may start"); };
  installPortableAssets({ files: {}, urls: {} });
  try {
    const runner = new RebornRunner({});
    assert.equal(runner.load("leaf-blade"), null);
    assert.equal(runner.anims.get("leaf-blade").state, "bad");
    assert.equal(runner.image("PRAS- Grass"), null);
    assert.equal(runner.url("sound", "PRSFX- Leaf Blade.wav"), "");
    assert.equal(requests, 0);
  } finally { installPortableAssets(null); globalThis.document = oldDocument; globalThis.fetch = oldFetch; }
});

test("cached King's Shield sheets and sounds resolve with encodeURIComponent apostrophes", () => {
  const oldDocument = globalThis.document;
  globalThis.document = { getElementById: () => ({}) };
  const runner = new RebornRunner({});
  const names = [["sheet", "PRAS- King's Shield"], ["sound", "PRSFX- King's Shield1.wav"], ["sound", "PRSFX- King's Shield2.wav"]];
  const urls = Object.fromEntries(names.map(([kind, name]) => [runner.url(kind, name), `${kind}/${name}`]));
  const files = Object.fromEntries(names.map(([kind, name]) => [`${kind}/${name}`, `data:${kind === "sheet" ? "image/png" : "audio/wav"};base64,exact`]));
  installPortableAssets({ files, urls });
  try {
    for (const [kind, name] of names) assert.equal(runner.url(kind, name), files[`${kind}/${name}`]);
  } finally { installPortableAssets(null); globalThis.document = oldDocument; }
});
