// After the app is rebuilt, an open page still asks for the old chunk names, which are gone: reload once to pick up the new ones
// instead of leaving a blank page. A second failure within a minute is a real error and shows as one (also with storage blocked,
// so it never loops).
import React from "react";

const KEY = "silver-chunk-reload";

export function lazyChunk(load) {
  return React.lazy(() => load().catch((err) => {
    let last;
    try { last = Number(sessionStorage.getItem(KEY)) || 0; } catch { last = Date.now(); }
    if (Date.now() - last > 60000) {
      try { sessionStorage.setItem(KEY, String(Date.now())); } catch { /* storage off */ }
      window.location.reload();
      return new Promise(() => {});
    }
    throw err;
  }));
}
