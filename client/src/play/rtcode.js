// What a real-time battle puts in the result code of the playable page: the person's input log as one flat list of integers
// (nine per row, without the side: the friend is always the first seat), deflated and written in base64url. The app unpacks it
// (silvers_hoard/sharing.py: decode_rt_inputs) and replays the battle with the real-time simulator. A row of the simulator's log is
// [tick, side, mx, my, move, roll, switch, focus, plus, mega]; here it is [ticks since the previous row, mx and my in thousandths,
// move, roll, switch, focus, plus, mega].

/** The integers of a log (rows of the first seat only; rows with fewer than ten columns read as focused, no Plus, no Mega). */
export function flatRtInputs(rows) {
  const flat = [];
  let prev = 0;
  for (const row of rows) {
    if (row[1] !== 0) continue;
    const r = [...row];
    while (r.length < 10) r.push(r.length === 7 ? 1 : 0);
    flat.push(r[0] - prev, Math.round(r[2] * 1000), Math.round(r[3] * 1000), r[4], r[5] ? 1 : 0, r[6], r[7] ? 1 : 0, r[8] ? 1 : 0, r[9] ? 1 : 0);
    prev = r[0];
  }
  return flat;
}

/** Deflate (zlib) + base64url of some text. */
export async function deflateB64(text) {
  const bytes = new TextEncoder().encode(text);
  if (typeof CompressionStream === "undefined") throw new Error("CompressionStream unavailable");
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"));
  const buf = new Uint8Array(await new Response(stream).arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function packRtInputs(rows) {
  return deflateB64(JSON.stringify(flatRtInputs(rows)));
}

/** The inverse, for tests: base64url -> deflate -> rows in the simulator's format. */
export async function unpackRtInputs(text) {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
  const flat = JSON.parse(await new Response(stream).text());
  const rows = [];
  let tick = 0;
  for (let i = 0; i < flat.length; i += 9) {
    const [dt, mx, my, use, dodge, sw, focus, plus, mega] = flat.slice(i, i + 9);
    tick += dt;
    rows.push([tick, 0, mx / 1000, my / 1000, use, dodge, sw, focus, plus, mega]);
  }
  return rows;
}

/** A seed for a battle played on the page (kept short: it travels in the code). */
export function newSeed() {
  let hex = "";
  try {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  } catch {
    for (let i = 0; i < 16; i++) hex += Math.floor(Math.random() * 16).toString(16);
  }
  return `pg-${hex}`;
}
