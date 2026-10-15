// The "move animations" setting of the turn-based screen (a per-viewer convenience kept in the browser's storage) and the reduced-motion
// preference that overrides it. Kept apart from the effect layer so the toggle does not pull the painter into the main bundle.
import { useEffect, useState } from "react";
import { useStored } from "../../components/ui.jsx";

export const MOVE_FX_KEY = "silver-move-fx";

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
