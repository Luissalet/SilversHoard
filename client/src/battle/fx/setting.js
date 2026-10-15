// The "move animations" setting of the turn-based screen (a per-viewer convenience kept in the browser's storage) and the reduced-motion
// preference that overrides it. Kept apart from the effect layer so the toggle does not pull the painter into the main bundle.
import { useEffect, useState } from "react";
import { useStored } from "../../components/ui.jsx";

export const MOVE_FX_KEY = "silver-move-fx";
export const FX_STYLE_KEY = "silver-fx-style";
export const BACKDROP_KEY = "silver-backdrop";
// "showdown": Pokémon Showdown's own animation of each move (934 of them) where it has one; "silver": the app's effects for every move
// "reborn": Pokémon Reborn's animations (748 moves, downloaded on first use), Silver's for the rest
export const FX_STYLES = ["showdown", "reborn", "silver"];
const okStyle = (v) => (FX_STYLES.includes(v) ? v : "showdown");

/** [on, setOn]: whether the moves animate (default on). */
export function useMoveFxSetting() {
  const [value, set] = useStored(MOVE_FX_KEY, true);
  return [value !== false, (v) => set(!!v)];
}

function reducedQuery() {
  try { return window.matchMedia("(prefers-reduced-motion: reduce)"); } catch { return null; }
}

/** True while the system asks for less motion: the screen then keeps its simple animations only. */
export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => !!reducedQuery()?.matches);
  useEffect(() => {
    const q = reducedQuery();
    if (!q) return undefined;
    const on = () => setReduced(q.matches);
    on();
    q.addEventListener?.("change", on);
    return () => q.removeEventListener?.("change", on);
  }, []);
  return reduced;
}

/** [style, setStyle]: which move animations the turn-based screen plays ("showdown" by default). */
export function useFxStyleSetting() {
  const [value, set] = useStored(FX_STYLE_KEY, "showdown");
  return [okStyle(value), (v) => set(okStyle(v))];
}

/** The same setting read outside React (the effect stage asks on every move, so a change applies at once). */
export function readFxStyle() {
  try {
    const raw = localStorage.getItem(FX_STYLE_KEY);
    return okStyle(raw === null ? "showdown" : JSON.parse(raw));
  } catch {
    return "showdown";
  }
}

/** [backdrop, set]: the field of the turn-based screen: "showdown" (its backdrops and weather overlays, the default), "pixel" (Scarloxy's
 * pixel-art backgrounds with Showdown's weather overlays) or "silver" (gradients). */
export function useBackdropSetting() {
  const [value, set] = useStored(BACKDROP_KEY, "showdown");
  const ok = (v) => (v === "silver" || v === "pixel" ? v : "showdown");
  return [ok(value), (v) => set(ok(v))];
}
