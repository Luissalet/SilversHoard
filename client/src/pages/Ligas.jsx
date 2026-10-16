// Leagues: gyms in order, an Elite Four and a champion; beat them all and you enter the hall of fame.
// Three tabs: every league of the games (there from the start: one not installed yet installs the first time it is opened),
// your own leagues and the ones friends sent you.
import React from "react";
import { api } from "../api.js";
import { useApp } from "../context.js";
import { Empty, ErrorBox, Icon, ICONS, Spinner, useBusy, useLoad, useStored } from "../components/ui.jsx";
import { useCopilotRefresh } from "../components/hooks.js";
import { Avatar, GymBadge } from "../components/silver.jsx";
import { loc } from "../loc.js";
import PlaceFilters, { matchesPlace } from "../components/PlaceFilters.jsx";

const TABS = ["games", "own", "friend"];

function LeagueCard({ lg, busy, onOpen }) {
  const { t, lang } = useApp();
  return (
    <a href={lg.id ? `#/liga/${lg.id}` : "#/ligas"} className="league-card" aria-busy={busy || undefined}
      onClick={(e) => { if (!lg.id) { e.preventDefault(); if (!busy) onOpen(lg); } }}>
      <div className="min-w-0 flex-1 space-y-2">
        <div><b className="text-[16px]">{loc(lg, lang)}</b><div className="help">{loc(lg, lang, "description")}</div></div>
        {lg.gym_list.length > 0 && <div className="flex flex-wrap gap-1">{lg.gym_list.map((g) => <GymBadge key={g.id} image={g.badge_image} color={g.badge_color} size={26} label={loc(g, lang, "badge")} />)}</div>}
        <div className="flex flex-wrap items-center gap-2">
          {lg.elite_list.map((e) => <Avatar key={e.id} url={e.avatar_url} name={loc(e, lang)} size={34} />)}
          {lg.champion && <span className="league-champ"><Avatar url={lg.champion.avatar_url} name={loc(lg.champion, lang)} size={44} /><span className="help">{loc(lg.champion, lang)}</span></span>}
        </div>
      </div>
      {busy ? <Spinner /> : lg.hall.length > 0 && <span className="chip chip-ok">{t("hall_n", { n: lg.hall.length })}</span>}
    </a>
  );
}

export default function Ligas() {
  const { t, go, changed } = useApp();
  const [tab, setTab] = useStored("silver-league-tab", "games");
  const [region, setRegion] = useStored("silver-league-region", "");
  const [game, setGame] = useStored("silver-league-game", "");
  const current = TABS.includes(tab) ? tab : "games";
  // the answer remembers its tab, so switching tabs never shows the other tab's leagues while the new ones load
  const { data, error, reload } = useLoad(() => (current === "games" ? api.call("leagues_catalog", {}) : api.call("leagues_list", { origin: current }))
    .then((r) => ({ tab: current, leagues: r.leagues || [] })), [current]);
  useCopilotRefresh(reload);
  const [busy, run] = useBusy();
  const open = (lg) => run(lg.key, async () => {
    const r = await api.call("canon_install", { league_key: lg.key });
    changed();
    go(`#/liga/${r.league.id}`);
  });
  const all = data?.tab === current ? data.leagues : null;
  const list = all && all.filter((lg) => matchesPlace(lg, region, game));
  const empty = current === "own"
    ? <Empty icon={ICONS.star} title={t("no_own_leagues")} action={<a className="btn btn-primary" href="#/liga/nueva">{t("new_league")}</a>}>{t("no_own_leagues_help")}</Empty>
    : <Empty icon={ICONS.star} title={t("no_friend_leagues")} action={<a className="btn btn-primary" href="#/compartir">{t("import")}</a>}>{t("no_friend_leagues_help")}</Empty>;
  return (
    <div className="space-y-4">
      <div className="page-head">
        <div className="min-w-0"><h1>{t("nav_leagues")}</h1><p className="help">{t("leagues_help")}</p></div>
        <div className="flex flex-wrap gap-2">
          <a className="btn btn-primary" href="#/liga/nueva"><Icon d={ICONS.plus} size={14} /> {t("new_league")}</a>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="seg" role="group" aria-label={t("origin")}>
          {TABS.map((x) => <button key={x} type="button" aria-pressed={current === x} onClick={() => setTab(x)}>{t(`leagues_tab_${x}`)}</button>)}
        </div>
        {all && all.some((lg) => lg.region || lg.game_id) && <div className="min-w-0 flex-1"><PlaceFilters list={all} {...{ region, setRegion, game, setGame }} /></div>}
      </div>
      {error && <ErrorBox error={error} onRetry={reload} />}
      {!list ? (error ? null : <Spinner />) : all.length > 0 && list.length === 0 ? <p className="help">{t("no_matches")}</p> : list.length === 0 ? empty : (
        <div className="league-list">
          {list.map((lg) => <LeagueCard key={lg.id || lg.key} lg={lg} busy={!!busy[lg.key]} onOpen={open} />)}
        </div>
      )}
    </div>
  );
}
