// The playable page is one HTML file friends download and open from disk, so its size on disk is what counts. After
// vite-plugin-singlefile has inlined everything, this plugin deflates the page's script (the battle engine with @pkmn/sim's data,
// about 8 MB) into a base64 block about a quarter of the size, plus a few lines that inflate it with the browser's
// DecompressionStream (which the page already needs for its result codes) and run it as the same module script. Nothing in the
// code changes: the browser runs the very bytes Vite produced. The data slot (`__SILVER_DATA__`) stays in its own tag.
import {deflateSync, inflateSync} from 'node:zlib';

const MODULE_OPEN = '<script type="module">';
const PAYLOAD_ID = 'silver-code';
const FAIL = 'Este navegador no puede abrir esta página: actualízalo (Chrome, Edge, Firefox o Safari recientes). / ' +
  'This browser cannot open this page: update it (a recent Chrome, Edge, Firefox or Safari).';

const loader = () => `<script>
(async () => {
  try {
    const b64 = document.getElementById(${JSON.stringify(PAYLOAD_ID)}).textContent.trim();
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const code = await new Response(new Blob([bin]).stream().pipeThrough(new DecompressionStream("deflate"))).text();
    const s = document.createElement("script");
    s.type = "module";
    s.textContent = code;
    document.body.appendChild(s);
  } catch (e) {
    console.error(e);
    document.getElementById("root").textContent = ${JSON.stringify(FAIL)};
  }
})();
</script>`;

/** The inline module script of a page and where it sits, or null. */
export function moduleScript(html) {
  // `<script type="module">`, with or without more attributes (Vite adds `crossorigin` in some builds)
  const start = html.indexOf(MODULE_OPEN.slice(0, -1));
  if (start < 0) return null;
  const open = html.indexOf('>', start) + 1;
  const end = html.indexOf('</script>', open);
  return {start, end, code: html.slice(open, end)};
}

/** The page with its inline module script packed, or the page unchanged when it has no inline module script. */
export function packPage(html) {
  const found = moduleScript(html);
  if (!found) return html;
  const {start, end, code} = found;
  const b64 = deflateSync(Buffer.from(code, 'utf8'), {level: 9}).toString('base64');
  const packed = html.slice(0, start) + `<script id="${PAYLOAD_ID}" type="application/octet-stream">${b64}</script>` +
    html.slice(end + '</script>'.length);
  const close = packed.lastIndexOf('</body>');
  if (close < 0) throw new Error('pack_play: the page has no </body>');
  return packed.slice(0, close) + loader() + '\n  ' + packed.slice(close);
}

/** The script a packed page runs (for tests). */
export function unpackPage(html) {
  const m = html.match(new RegExp(`<script id="${PAYLOAD_ID}" type="application/octet-stream">([^<]*)</script>`));
  return m ? inflateSync(Buffer.from(m[1].trim(), 'base64')).toString('utf8') : null;
}

/** Vite plugin for vite.play.config.js, after viteSingleFile. */
export function packPlayPlugin() {
  return {
    name: 'silver-pack-play',
    enforce: 'post',
    generateBundle(_, bundle) {
      for (const out of Object.values(bundle)) {
        if (out.type !== 'asset' || !out.fileName.endsWith('.html')) continue;
        const html = String(out.source);
        const found = moduleScript(html);
        if (!found) this.error(`pack_play: ${out.fileName} has no inline module script to pack`);
        const packed = packPage(html);
        if (unpackPage(packed) !== found.code) this.error('pack_play: the packed script does not unpack to the original one');
        out.source = packed;
      }
    },
  };
}
