// Gyms: a leader (and gym trainers before), a type, a badge and rules. Challenge them, or send them to friends.
import React from "react";
import { api } from "../api.js";
import { useApp } from "../context.js";
import { Empty, ErrorBox, Icon, ICONS, Spinner, useLoad } from "../components/ui.jsx";
import { useCopilotRefresh } from "../components/hooks.js";
import { Avatar, GymBadge, TypeChip, originLabel } from "../components/silver.jsx";

export function GymCard({ g }) {
  const { t } = useApp();
  return (
    <a href={`#/gimnasio/${g.id}`} className="gym-card" style={{ "--badge": g.badge_color || "#c0c0c0" }}>
      <GymBadge color={g.badge_color || "#c0c0c0"} size={44} label={g.badge} />
      <div className="min-w-0 flex-1 space-y-1">
        <b className="trunc block">{g.name}</b>
        <div className="help trunc">{[g.city, g.badge].filter(Boolean).join(" · ")}</div>
        <div className="flex flex-wrap items-center gap-1">{g.type && <TypeChip type={g.type} />}<span className="chip">{originLabel(t, g.origin)}</span>{(g.trainers || []).length > 0 && <span className="chip">{t("plus_trainers", { n: g.trainers.length })}</span>}</div>
      </div>
      {g.leader && <div className="gym-leader"><Avatar url={g.leader.avatar_url} name={g.leader.name} size={56} /><span className="help trunc">{g.leader.name}</span></div>}
    </a>
  );
}

export default function Gimnasios() {
  const { t } = useApp();
  const { data, error, loading, reload } = useLoad(() => api.call("gyms_list", {}), []);
  useCopilotRefresh(reload);
  const list = data?.gyms || [];
  return (
    <div className="space-y-4">
      <div className="page-head">
        <div className="min-w-0"><h1>{t("nav_gyms")}</h1><p className="help">{t("gyms_help")}</p></div>
        <div className="flex flex-wrap gap-2">
          <a className="btn btn-primary" href="#/gimnasio/nuevo"><Icon d={ICONS.plus} size={14} /> {t("new_gym")}</a>
          <a className="btn" href="#/personajes">{t("install_canon_league")}</a>
        </div>
      </div>
      {error && <ErrorBox error={error} onRetry={reload} />}
      {loading && !data ? <Spinner /> : list.length === 0 ? <Empty icon={ICONS.plus} title={t("no_gyms")} action={<a className="btn btn-primary" href="#/gimnasio/nuevo">{t("new_gym")}</a>}>{t("no_gyms_help")}</Empty> : (
        <div className="gym-grid">{list.map((g) => <GymCard key={g.id} g={g} />)}</div>
      )}
    </div>
  );
}
