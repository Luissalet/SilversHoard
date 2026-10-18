// Where the pictures of Showdown's animations and backdrops come from. Kept apart from scene.js (which pulls in the big animation tables)
// so the arena's backdrop can use it from the main bundle.
export const SHOWDOWN = "https://play.pokemonshowdown.com";
import { portableAsset } from "../../../portable-assets.js";

/**
 * Where an image comes from. `local` (the app): Showdown's fx and backdrop pictures through the app's cache (/api/fx/…); otherwise
 * (the friends' playable page) straight from Showdown. Accepts "wisp.png", "fx/…", "sprites/gen6bgs/…" or a full Showdown URL.
 */
export function fxUrl(path, { local = true, base = "" } = {}) {
  let p = String(path || "");
  if (p.startsWith(SHOWDOWN + "/")) p = p.slice(SHOWDOWN.length + 1);
  else if (/^https?:/.test(p) || p.startsWith("data:") || p.startsWith("blob:") || p.startsWith("/")) return portableAsset(p);
  if (!p.includes("/")) p = `fx/${p}`;
  if (local) {
    if (p.startsWith("fx/") && !p.slice(3).includes("/")) return portableAsset(`${base}/api/fx/${p.slice(3)}`);
    if (p.startsWith("sprites/gen6bgs/")) return portableAsset(`${base}/api/fx/bg/${p.slice(16)}`);
  }
  return portableAsset(`${SHOWDOWN}/${p}`);
}
