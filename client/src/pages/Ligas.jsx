// Leagues: gyms in order, an Elite Four and a champion; beat them all and you enter the hall of fame.
import React from "react";
import { api } from "../api.js";
import { useApp } from "../context.js";
import { Empty, ErrorBox, Icon, ICONS, Spinner, useLoad } from "../components/ui.jsx";
import { useCopilotRefresh } from "../components/hooks.js";
import { Avatar, GymBadge } from "../components/silver.jsx";

export default function Ligas() {
  const { t } = useApp();
  const { data, error, loading, reload } = useLoad(() => api.call("leagues_list", {}), []);
  useCopilotRefresh(reload);
  const list = data?.leagues || [];
  return (
    <div className="space-y-4">
      <div className="page-head">
        <div className="min-w-0"><h1>{t("nav_leagues")}</h1><p className="help">{t("leagues_help")}</p></div>
        <div className="flex flex-wrap gap-2">
          <a className="btn btn-primary" href="#/liga/nueva"><Icon d={ICONS.plus} size={14} /> {t("new_league")}</a>
          <a className="btn" href="#/personajes">{t("install_canon_league")}</a>
        </div>
      </div>
      {error && <ErrorBox error={error} onRetry={reload} />}
      {loading && !data ? <Spinner /> : list.length === 0 ? <Empty icon={ICONS.star} title={t("no_leagues")} action={<a className="btn btn-primary" href="#/personajes">{t("install_canon_league")}</a>}>{t("no_leagues_help")}</Empty> : (
        <div className="league-list">
          {list.map((lg) => (
            <a key={lg.id} href={`#/liga/${lg.id}`} className="league-card">
              <div className="min-w-0 flex-1 space-y-2">
                <div><b className="text-[16px]">{lg.name}</b><div className="help">{lg.description}</div></div>
                <div className="flex flex-wrap gap-1">{lg.gym_list.map((g) => <GymBadge key={g.id} color={g.badge_color} size={26} label={g.badge} />)}</div>
                <div className="flex flex-wrap items-center gap-2">
                  {lg.elite_list.map((e) => <Avatar key={e.id} url={e.avatar_url} name={e.name} size={34} />)}
                  {lg.champion && <span className="league-champ"><Avatar url={lg.champion.avatar_url} name={lg.champion.name} size={44} /><span className="help">{lg.champion.name}</span></span>}
                </div>
              </div>
              {lg.hall.length > 0 && <span className="chip chip-ok">{t("hall_n", { n: lg.hall.length })}</span>}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
