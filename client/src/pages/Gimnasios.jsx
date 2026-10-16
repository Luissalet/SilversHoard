// Gyms: a leader (and gym trainers before), a type, a badge and rules. Challenge them, or send them to friends.
import React from "react";
import PlaceFilters, { matchesPlace } from "../components/PlaceFilters.jsx";
import { api } from "../api.js";
import { useApp } from "../context.js";
import { Empty, ErrorBox, Icon, ICONS, Spinner, useLoad, useStored } from "../components/ui.jsx";
import { useCopilotRefresh } from "../components/hooks.js";
import { Avatar, GymBadge, TypeChip, originLabel } from "../components/silver.jsx";
import { loc } from "../loc.js";

export function GymCard({ g }) {
  const { t, lang } = useApp();
  return (
    <a href={`#/gimnasio/${g.id}`} className="gym-card" style={{ "--badge": g.badge_color || "#c0c0c0" }}>
      <GymBadge image={g.badge_image} color={g.badge_color || "#c0c0c0"} size={44} label={loc(g, lang, "badge")} />
      <div className="min-w-0 flex-1 space-y-1">
        <b className="trunc block">{loc(g, lang)}</b>
        <div className="help trunc">{[loc(g, lang, "city"), loc(g, lang, "badge")].filter(Boolean).join(" · ")}</div>
        <div className="flex flex-wrap items-center gap-1">{g.type && <TypeChip type={g.type} />}<span className="chip">{originLabel(t, g.origin)}</span>{(g.trainers || []).length > 0 && <span className="chip">{t("plus_trainers", { n: g.trainers.length })}</span>}</div>
      </div>
      {g.leader && <div className="gym-leader"><Avatar url={g.leader.avatar_url} name={loc(g.leader, lang)} size={56} /><span className="help trunc">{loc(g.leader, lang)}</span></div>}
    </a>
  );
}

export default function Gimnasios() {
  const { t } = useApp();
  const { data, error, loading, reload } = useLoad(() => api.call("gyms_list", {}), []);
  useCopilotRefresh(reload);
  const [origin, setOrigin] = useStored("silver-gym-origin", "");
  const [region, setRegion] = useStored("silver-gym-region", "");
  const [game, setGame] = useStored("silver-gym-game", "");
  const all = data?.gyms || [];
  const list = all.filter((g) => (!origin || (g.origin || "own") === origin) && matchesPlace(g, region, game));
  return (
    <div className="space-y-4">
      <div className="page-head">
        <div className="min-w-0"><h1>{t("nav_gyms")}</h1><p className="help">{t("gyms_help")}</p></div>
        <div className="flex flex-wrap gap-2">
          <a className="btn btn-primary" href="#/gimnasio/nuevo"><Icon d={ICONS.plus} size={14} /> {t("new_gym")}</a>
          <a className="btn" href="#/ligas">{t("install_canon_league")}</a>
        </div>
      </div>
      {all.length > 0 && <PlaceFilters list={all} {...{ region, setRegion, game, setGame, origin, setOrigin }}
        origins={["own", "friend", "canon"].map((o) => [o, originLabel(t, o)])} />}
      {error && <ErrorBox error={error} onRetry={reload} />}
      {loading && !data ? <Spinner /> : all.length > 0 && list.length === 0 ? <p className="help">{t("no_matches")}</p> : list.length === 0 ? <Empty icon={ICONS.plus} title={t("no_gyms")} action={<a className="btn btn-primary" href="#/gimnasio/nuevo">{t("new_gym")}</a>}>{t("no_gyms_help")}</Empty> : (
        <div className="gym-grid">{list.map((g) => <GymCard key={g.id} g={g} />)}</div>
      )}
    </div>
  );
}
