import { useEffect, useRef } from "react";
import { createSerialPoll } from "../polling.js";
import { onCopilotRefresh } from "../copilot-context.js";

/** Runs `fn` (reload what this view shows, in place) when the assistant finishes a turn. */
export function useCopilotRefresh(fn) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => onCopilotRefresh(() => ref.current()), []);
}

/** Answers the assistant launcher's context request with a snapshot of what this page shows: { kind, object_id, title, dirty, fields }. */
export function useContextProvider(getSnapshot) {
  const ref = useRef(getSnapshot);
  ref.current = getSnapshot;
  useEffect(() => {
    const onRequest = (event) => {
      try {
        const snapshot = ref.current();
        if (snapshot) event.detail?.provide?.(snapshot);
      } catch { /* a view that cannot describe itself is left out */ }
    };
    window.addEventListener("silver:context-request", onRequest);
    return () => window.removeEventListener("silver:context-request", onRequest);
  }, []);
}

// Calls `fn` now and then every `ms` while `active` is true; ticks are skipped while the tab is hidden.
export function usePoll(fn, ms, active = true) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!active) return undefined;
    const poll = createSerialPoll(() => ref.current(), { intervalMs: ms, isHidden: () => document.hidden });
    const onVisible = () => poll.wake();
    document.addEventListener("visibilitychange", onVisible);
    return () => { poll.stop(); document.removeEventListener("visibilitychange", onVisible); };
  }, [ms, active]);
}
