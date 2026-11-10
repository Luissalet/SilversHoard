// Entry point for the painter (rt/vfx.js): the style check is tiny and always loaded, the effects load the first time the "pixelfx"
// animation style is on. The effects pinned to moves by hand (the explorer) come from the server with them and again whenever the
// explorer changes one (window event PINS_EVENT).
import { pixelfxStyleOn, setPins } from "./mapping.js";

export const PINS_EVENT = "silver-pixelfx-pins";
export const PINS_URL = "/api/pixelfx/pins";

/** Reads the pinned effects from the server into the mapping (a failure keeps the last ones). */
export async function refreshPins() {
  if (typeof fetch === "undefined") return;
  try {
    const r = await fetch(PINS_URL, { headers: { Accept: "application/json" } });
    if (!r.ok) return;
    const body = await r.json();
    setPins(body.pins || []);
  } catch {
    /* offline or an old server: the automatic mapping carries on */
  }
}

let loading = null;
let listening = false;
/** The layer module (./layer.js), imported once, with the pins loaded. */
export const loadPixelfx = () => (loading ||= Promise.all([import("./layer.js"), refreshPins()]).then(([m]) => {
  if (!listening && typeof window !== "undefined") { listening = true; window.addEventListener(PINS_EVENT, () => { refreshPins(); }); }
  return m;
}));
export { pixelfxStyleOn };
