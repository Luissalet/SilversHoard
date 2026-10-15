// The playable page's packing (scripts/pack_play.mjs): the inlined module script becomes a deflated base64 block that unpacks
// to the very same code, the data slot stays where the app fills it, and the loader runs after #root exists.
import test from 'node:test';
import assert from 'node:assert/strict';
import {moduleScript, packPage, unpackPage} from '../../scripts/pack_play.mjs';

const CODE = `var a="<\\/script>";${'console.log("x".repeat(3));'.repeat(500)}document.getElementById("root").textContent="ok";`;
const PAGE = `<!doctype html>\n<html><head><title>T</title>\n<script type="module">${CODE}</script>\n<style>body{color:red}</style></head>\n` +
  `<body>\n<script id="silver-data" type="application/json">__SILVER_DATA__</script>\n<div id="root"></div>\n</body>\n</html>\n`;

test('pack_play: the packed page runs the same script and keeps the data slot', () => {
  assert.equal(moduleScript(PAGE).code, CODE);
  const packed = packPage(PAGE);
  assert.equal(unpackPage(packed), CODE);
  assert.ok(packed.length < PAGE.length / 4, 'much smaller');
  assert.equal(moduleScript(packed), null, 'no inline module script left');
  assert.ok(packed.includes('<script id="silver-data" type="application/json">__SILVER_DATA__</script>'));
  assert.ok(packed.includes('<style>body{color:red}</style>'));
  const loader = packed.indexOf('new DecompressionStream("deflate")');
  assert.ok(loader > packed.indexOf('<div id="root"></div>') && loader < packed.indexOf('</body>'), 'the loader runs after #root');
  assert.equal(packPage('<html><body></body></html>'), '<html><body></body></html>', 'nothing to pack');
});
