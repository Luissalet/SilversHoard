// What the shared assistant launcher asks this app for: the real objects open in the current view (trainer, gym, league, battle,
// job) and what the person is editing, plus a way to refresh the open view as the assistant applies changes.
const PAGE_NAMES = { "": "home", combatir: "battle_setup", combate: "battle", trabajo: "job", entrenadores: "trainers", entrenador: "trainer",
  gimnasios: "gyms", gimnasio: "gym", ligas: "leagues", liga: "league", personajes: "in_game_teams", historial: "history", medallas: "badges",
  compartir: "share", ajustes: "settings" };
const KIND_OF = { entrenador: "trainer", gimnasio: "gym", liga: "league", combate: "battle", trabajo: "job" };
const REFRESH_DEBOUNCE_MS = 250;

export function parseRoute(hash) {
  const [path, query = ""] = String(hash || "").replace(/^#\/?/, "").split("?");
  const parts = path.split("/").filter(Boolean).map((p) => { try { return decodeURIComponent(p); } catch { return p; } });
  return { page: parts[0] || "", param: parts[1] || null, query: new URLSearchParams(query) };
}

export function collectViews(target = globalThis.window) {
  const found = [];
  if (!target?.dispatchEvent) return found;
  target.dispatchEvent(new CustomEvent("silver:context-request", { detail: { provide: (snapshot) => { if (snapshot) found.push(snapshot); } } }));
  return found;
}

/** Pure core: never throws. */
export function buildContext({ hash, views = [] }) {
  const route = parseRoute(hash);
  const view = { page: PAGE_NAMES[route.page] ?? (route.page || "home") };
  const active = [];
  const kind = KIND_OF[route.page];
  if (kind && route.param && route.param !== "nuevo" && route.param !== "nueva") {
    view.object_id = route.param;
    active.push({ kind, object_id: route.param });
  }
  for (const v of views) {
    if (v.object_id && !active.some((a) => a.kind === v.kind && a.object_id === v.object_id)) active.push({ kind: v.kind, object_id: v.object_id, title: v.title || "" });
    else {
      const a = active.find((x) => x.kind === v.kind && x.object_id === v.object_id);
      if (a && v.title) a.title = v.title;
    }
  }
  const editor = views.find((v) => v.dirty) || views.find((v) => v.fields);
  if (editor) view.editor = editor;
  return { active_objects: active, view };
}

export function context() {
  return Promise.resolve(buildContext({ hash: globalThis.window?.location?.hash, views: collectViews() }));
}

const refreshHandlers = new Set();
let timer = null;

function runRefresh() {
  for (const fn of [...refreshHandlers]) {
    try { Promise.resolve(fn()).catch(() => {}); } catch { /* a refresh must never break the page */ }
  }
}

export function scheduleRefresh() {
  clearTimeout(timer);
  timer = setTimeout(runRefresh, REFRESH_DEBOUNCE_MS);
}

export function onCopilotRefresh(fn) {
  refreshHandlers.add(fn);
  return () => refreshHandlers.delete(fn);
}

/** Keep locally changed fields while accepting saved changes to untouched fields. */
export function mergeDraftFields(draft, previous, latest) {
  if (!draft || !previous) return latest;
  const merged = { ...latest };
  for (const [key, value] of Object.entries(draft)) {
    if (JSON.stringify(value) !== JSON.stringify(previous[key])) merged[key] = value;
  }
  return merged;
}

export const onTurnEnd = () => scheduleRefresh();

export function installCopilot(target = globalThis.window) {
  if (!target || target.hoardCopilot) return;
  target.hoardCopilot = { context, onTurnEnd, onChange: scheduleRefresh };
  target.addEventListener("hoard:copilot-turn-end", scheduleRefresh);
  target.addEventListener("hoard:copilot-change", scheduleRefresh);
}
