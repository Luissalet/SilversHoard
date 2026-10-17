import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api.js";
import { initialLang, makeT, saveLang } from "./i18n.js";
import { AppContext } from "./context.js";
import { createSerialPoll } from "./polling.js";
import { ConfirmDialog, Icon, ICONS } from "./components/ui.jsx";
import { useCopilotRefresh } from "./components/hooks.js";
import { makeSprites } from "./battle/dex.js";
import Inicio from "./pages/Inicio.jsx";
import Combatir from "./pages/Combatir.jsx";
import Combate from "./pages/Combate.jsx";
import Entrenadores from "./pages/Entrenadores.jsx";
import Entrenador from "./pages/Entrenador.jsx";
import Gimnasios from "./pages/Gimnasios.jsx";
import Gimnasio from "./pages/Gimnasio.jsx";
import Ligas from "./pages/Ligas.jsx";
import Liga from "./pages/Liga.jsx";
import Instalaciones from "./pages/Instalaciones.jsx";
import Fabrica from "./pages/Fabrica.jsx";
import Frontera from "./pages/Frontera.jsx";
import Personajes from "./pages/Personajes.jsx";
import Personaje from "./pages/Personaje.jsx";
import Historial from "./pages/Historial.jsx";
import Trabajo from "./pages/Trabajo.jsx";
import Copa from "./pages/Copa.jsx";
import Arenas, { ArenaEditor } from "./pages/Arenas.jsx";
import Recorrido from "./pages/Recorrido.jsx";
import Medallas from "./pages/Medallas.jsx";
import Progreso from "./pages/Progreso.jsx";
import Creditos from "./pages/Creditos.jsx";
import Amigos from "./pages/Amigos.jsx";
import Campal from "./pages/Campal.jsx";
import Video from "./pages/Video.jsx";
import Compartir from "./pages/Compartir.jsx";
import Ajustes from "./pages/Ajustes.jsx";
import Pokeathlon from "./pages/Pokeathlon.jsx";
import Concursos from "./pages/Concursos.jsx";
import Bases from "./pages/Bases.jsx";
import SuppliedSprite from "./components/SuppliedSprite.jsx";

export { useApp } from "./context.js";

const I = {
  home: ICONS.home,
  swords: "M14.5 17.5L3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2M9.5 6.5L13 3h3v3l-3.5 3.5M5 14l-2 2 4 4 2-2",
  people: "M9 11a4 4 0 100-8 4 4 0 000 8zM2 21v-1a7 7 0 0114 0v1M17 11a3 3 0 100-6M22 21v-1a5 5 0 00-4-4.9",
  gym: "M3 21h18M5 21V10l7-5 7 5v11M9 21v-6h6v6M12 9.5h.01",
  trophy: "M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0zM7 6H4a3 3 0 003 4M17 6h3a3 3 0 01-3 4",
  tower: "M7 21V9l5-6 5 6v12M5 21h14M10 21v-4h4v4M10 11h4M10 14h4",
  arena: "M3 5h18v14H3zM12 5v14M12 9.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5M6.5 9a1.5 1.5 0 100 3 1.5 1.5 0 000-3",
  mass: "M5 8a2 2 0 100-4 2 2 0 000 4zM12 7a2 2 0 100-4 2 2 0 000 4zM19 8a2 2 0 100-4 2 2 0 000 4zM8 15a2 2 0 100-4 2 2 0 000 4zM16 15a2 2 0 100-4 2 2 0 000 4zM12 21a2 2 0 100-4 2 2 0 000 4z",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  book: "M4 4h6a2 2 0 012 2v14a2 2 0 00-2-2H4zM20 4h-6a2 2 0 00-2 2v14a2 2 0 012-2h6z",
  history: "M3 12a9 9 0 109-9 9 9 0 00-7 3.4M3 4v4h4M12 7v5l3 3",
  badge: "M12 2l3 6 6 .8-4.5 4.2 1.2 6.5L12 16.4 6.3 19.5l1.2-6.5L3 8.8 9 8z",
  podium: "M3 21h18M4 21v-6h5v6M9.5 21V10h5v11M15 21v-8h5v8M12 3l1 2.1 2.3.3-1.7 1.6.4 2.3-2-1.1-2 1.1.4-2.3-1.7-1.6 2.3-.3z",
  share: "M18 8a3 3 0 100-6 3 3 0 000 6zM6 15a3 3 0 100-6 3 3 0 000 6zM18 22a3 3 0 100-6 3 3 0 000 6zM8.6 13.5l6.8 4M15.4 6.5l-6.8 4",
  settings: ICONS.settings,
  stopwatch: "M12 21a8 8 0 100-16 8 8 0 000 16zM12 9v4l2.5 2M9.5 2h5M12 2v3M18.5 6.5l1.2-1.2",
};

const PAGES = [
  { path: "", key: "nav_home", icon: I.home, component: Inicio },
  { path: "combatir", key: "nav_battle", icon: I.swords, component: Combatir, badge: "live" },
  { path: "combate", key: "nav_battle", component: Combate, hidden: true, parent: "combatir" },
  { path: "trabajo", key: "nav_battle", component: Trabajo, hidden: true, parent: "combatir" },
  { path: "copa", key: "nav_battle", component: Copa, hidden: true, parent: "combatir" },
  { path: "campal", key: "nav_mass", icon: I.mass, component: Campal },
  { path: "entrenadores", key: "nav_trainers", icon: I.people, component: Entrenadores },
  { path: "entrenador", key: "nav_trainers", component: Entrenador, hidden: true, parent: "entrenadores" },
  { path: "gimnasios", key: "nav_gyms", icon: I.gym, component: Gimnasios },
  { path: "gimnasio", key: "nav_gyms", component: Gimnasio, hidden: true, parent: "gimnasios" },
  { path: "arenas", key: "nav_arenas", icon: I.arena, component: Arenas },
  { path: "arena", key: "nav_arenas", component: ArenaEditor, hidden: true, parent: "arenas" },
  { path: "recorrido", key: "nav_gyms", component: Recorrido, hidden: true, parent: "gimnasios" },
  { path: "ligas", key: "nav_leagues", icon: I.trophy, component: Ligas },
  { path: "liga", key: "nav_leagues", component: Liga, hidden: true, parent: "ligas" },
  { path: "instalaciones", key: "nav_facilities", icon: I.tower, component: Instalaciones },
  { path: "fabrica", key: "nav_facilities", component: Fabrica, hidden: true, parent: "instalaciones" },
  { path: "frontera", key: "nav_facilities", component: Frontera, hidden: true, parent: "instalaciones" },
  { path: "pokeathlon", key: "nav_facilities", label: ["Pokéathlon", "Pokéathlon"], icon: I.stopwatch, component: Pokeathlon },
  { path: "concursos", key: "nav_contests", icon: I.trophy, component: Concursos },
  { path: "bases", key: "nav_bases", icon: I.home, component: Bases },
  { path: "personajes", key: "nav_canon", icon: I.book, component: Personajes },
  { path: "personaje", key: "nav_canon", component: Personaje, hidden: true, parent: "personajes" },
  { path: "historial", key: "nav_history", icon: I.history, component: Historial },
  { path: "medallas", key: "nav_badges", icon: I.badge, component: Medallas },
  { path: "amigos", key: "nav_friends", icon: I.podium, component: Amigos },
  { path: "progreso", key: "nav_progress", icon: I.chart, component: Progreso },
  { path: "creditos", key: "nav_settings", component: Creditos, hidden: true, parent: "ajustes" },
  { path: "compartir", key: "nav_share", icon: I.share, component: Compartir },
  { path: "ajustes", key: "nav_settings", icon: I.settings, component: Ajustes },
  // a battle's replay alone on a 16:9 stage, recorded as a clip by battle_video: no sidebar, no page chrome
  { path: "video", key: "nav_battle", component: Video, hidden: true, parent: "combatir", bare: true },
];

const MENU_ART = { "": "menu-underground-radar", combatir: "menu-pokemon", campal: "menu-underground-sphere",
  entrenadores: "menu-trainer", gimnasios: "menu-flag", arenas: "menu-underground-radar", ligas: "menu-underground-treasure",
  instalaciones: "menu-underground-bag", pokeathlon: "menu-watch", concursos: "bw-gift-bow", bases: "doll-pikachu",
  personajes: "menu-pokedex", historial: "menu-save", medallas: "bw-royal-crown", amigos: "menu-chat",
  progreso: "menu-watch", compartir: "menu-chat", ajustes: "menu-options" };

function readHash() {
  const raw = window.location.hash.replace(/^#\/?/, "");
  const q = raw.indexOf("?");
  const path = q >= 0 ? raw.slice(0, q) : raw;
  const query = q >= 0 ? raw.slice(q + 1) : "";
  const parts = path.split("/").filter(Boolean).map((p) => { try { return decodeURIComponent(p); } catch { return p; } });
  return { page: parts[0] || "", param: parts[1] || null, query: new URLSearchParams(query), hash: window.location.hash };
}

function useHashRoute() {
  const [route, setRoute] = useState(readHash);
  useEffect(() => {
    const onChange = () => {
      const next = readHash();
      setRoute((cur) => {
        if (cur.page !== next.page || cur.param !== next.param) window.scrollTo(0, 0);
        return next;
      });
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

function Toasts({ toasts, onClose }) {
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((toast) => <ToastItem key={toast.id} toast={toast} onClose={onClose} />)}
    </div>
  );
}

function ToastItem({ toast, onClose }) {
  useEffect(() => {
    const timer = setTimeout(() => onClose(toast.id), toast.kind === "error" ? 10000 : 4500);
    return () => clearTimeout(timer);
  }, [toast, onClose]);
  return (
    <div className={`toast ${toast.kind === "error" ? "toast-error" : "toast-ok"}`} role={toast.kind === "error" ? "alert" : "status"}>
      <Icon d={toast.kind === "error" ? ICONS.warn : ICONS.check} size={15} />
      <div className="min-w-0 flex-1">
        <div>{toast.message}</div>
        {toast.hint && <div className="help">{toast.hint}</div>}
        {toast.action && <a className="btn-link" href={toast.action.href} onClick={() => onClose(toast.id)}>{toast.action.label}</a>}
      </div>
      <button type="button" className="btn-icon btn-ghost toast-x" onClick={() => onClose(toast.id)} aria-label="×"><Icon d={ICONS.close} size={13} /></button>
    </div>
  );
}

export default function App() {
  const route = useHashRoute();
  const [lang, setLang] = useState(initialLang);
  const t = useMemo(() => makeT(lang), [lang]);
  const [ov, setOv] = useState(null);
  const [ovError, setOvError] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [confirmReq, setConfirmReq] = useState(null);
  const [version, setVersion] = useState(0);
  const confirmResolve = useRef(null);

  useEffect(() => { document.documentElement.lang = lang; }, [lang]);

  const refreshOv = useCallback(async () => {
    try {
      setOv(await api.overview());
      setOvError(null);
    } catch (e) {
      setOvError(e);
    }
  }, []);
  const changed = useCallback(() => { setVersion((v) => v + 1); refreshOv(); }, [refreshOv]);
  useCopilotRefresh(changed);

  const busy = !!(ov && ((ov.jobs || []).length || (ov.live_battles || []).some((b) => b.status === "running")));
  useEffect(() => {
    const poll = createSerialPoll(refreshOv, { intervalMs: busy ? 3000 : 8000, isHidden: () => document.hidden });
    const onVisible = () => poll.wake();
    document.addEventListener("visibilitychange", onVisible);
    return () => { poll.stop(); document.removeEventListener("visibilitychange", onVisible); };
  }, [refreshOv, busy]);

  const closeToast = useCallback((id) => setToasts((list) => list.filter((x) => x.id !== id)), []);
  const pushToast = useCallback((toast) => setToasts((list) => [...list.slice(-2), { ...toast, id: Math.random().toString(36).slice(2) }]), []);
  const notify = useCallback((message, kind = "ok", action) => pushToast({ message, kind, action }), [pushToast]);
  const errorText = useCallback((error) => {
    if (!error) return "";
    const label = error.code && t.has(`err_${error.code}`) ? t(`err_${error.code}`) : "";
    const base = error.message || String(error);
    return label && label !== base ? `${label}: ${base}` : base;
  }, [t]);
  const toastError = useCallback((error) => pushToast({ message: errorText(error), hint: error?.hint || "", kind: "error" }), [pushToast, errorText]);
  const confirm = useCallback((request) => new Promise((resolve) => {
    confirmResolve.current = resolve;
    setConfirmReq(request);
  }), []);
  const closeConfirm = useCallback((answer) => {
    setConfirmReq(null);
    if (confirmResolve.current) confirmResolve.current(answer);
    confirmResolve.current = null;
  }, []);
  const changeLang = useCallback((next) => { api.setLanguage(next); saveLang(next); setLang(next); }, []);
  const settings = ov?.settings || {};
  const sprites = useMemo(() => makeSprites({ set: settings.sprite_set || "gen5ani" }), [settings.sprite_set]);
  const go = useCallback((hash) => { window.location.hash = hash; }, []);

  const value = useMemo(() => ({
    t, lang, setLang: changeLang, ov, ovError, refreshOv, changed, version, notify, toastError, errorText, confirm, route, sprites, settings, go,
  }), [t, lang, changeLang, ov, ovError, refreshOv, changed, version, notify, toastError, errorText, confirm, route, sprites, settings, go]);

  const page = PAGES.find((p) => p.path === route.page) || PAGES[0];
  const Component = page.component;
  const current = page.hidden ? page.parent : page.path;
  const badges = { live: (ov?.live_battles || []).length + (ov?.jobs || []).length };

  if (page.bare) {
    return (
      <AppContext.Provider value={value}>
        <Component key={`${page.path}/${route.param || ""}`} param={route.param} query={route.query} />
      </AppContext.Provider>
    );
  }

  return (
    <AppContext.Provider value={value}>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 skip-link focus:p-2">{t("skip")}</a>
      <div className="min-h-dvh md:grid md:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="sticky top-0 z-30 border-b md:flex md:h-dvh md:flex-col md:self-start md:border-b-0 md:border-r">
          <div className="brand">
            <img src="/icon-192.png" alt="" width="32" height="32" />
            <div className="min-w-0">Silver's Hoard<small>{t("subtitle")}</small></div>
            <div className="ml-auto flex items-center gap-2 md:hidden">
              <button type="button" className="btn btn-sm" onClick={() => changeLang(lang === "es" ? "en" : "es")} aria-label={t("language_label")}>{lang === "es" ? "EN" : "ES"}</button>
            </div>
          </div>
          <nav aria-label={t("sections")} className="mainnav">
            {PAGES.filter((p) => !p.hidden).map((p) => {
              const n = p.badge ? badges[p.badge] : 0;
              return (
                <a key={p.path} href={`#/${p.path}`} className="nav-link shrink-0" aria-current={p.path === current ? "page" : undefined}>
                  {MENU_ART[p.path] ? <SuppliedSprite id={MENU_ART[p.path]} size={20} /> : <Icon d={p.icon} />}
                  <span>{p.label ? p.label[lang === "en" ? 1 : 0] : t(p.key)}</span>
                  {n > 0 && <span className="nav-badge" aria-label={t("badge_n", { n })}>{n > 99 ? "99+" : n}</span>}
                </a>
              );
            })}
          </nav>
          <div className="hidden flex-1 md:block" />
          <div className="hidden space-y-3 border-t px-4 py-3 md:block" style={{ borderColor: "var(--line)" }}>
            <div className="flex items-center gap-2 text-[12.5px]">
              <span className="dot" style={{ background: ov?.engine?.running ? "var(--ok)" : ov ? "var(--warn)" : "var(--muted)" }} />
              <span>{ov?.engine?.running ? t("engine_on", { v: ov.engine.node || "" }) : t("engine_idle")}</span>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" className="btn btn-sm" onClick={() => changeLang(lang === "es" ? "en" : "es")}>{t("language")}</button>
              {ov?.version && <span className="help">v{ov.version}</span>}
              <a className="help btn-link" href="#/creditos">{t("credits")}</a>
            </div>
          </div>
        </aside>
        <main id="main" className="min-w-0 px-4 py-4 md:px-7 md:py-6">
          {ovError && !ov && (
            <div className="banner banner-danger mb-4" role="alert">
              {t("unreachable")}: {ovError.message}. <button type="button" className="btn-link" onClick={refreshOv}>{t("retry")}</button>
            </div>
          )}
          <Component key={`${page.path}/${route.param || ""}`} param={route.param} query={route.query} />
        </main>
      </div>
      <Toasts toasts={toasts} onClose={closeToast} />
      <ConfirmDialog request={confirmReq} onClose={closeConfirm} />
    </AppContext.Provider>
  );
}
