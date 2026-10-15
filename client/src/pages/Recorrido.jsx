// Walking a gym map during a challenge: the map with its people, and each battle starting when a trainer sees you or you talk to the
// leader. After a battle the challenge comes back here (Combate's "back to the gym"), with the beaten trainers greyed out.
import React from "react";
import { api } from "../api.js";
import { useApp } from "../context.js";
import { ErrorBox, Spinner, useBusy, useLoad } from "../components/ui.jsx";
import { GymBadge } from "../components/silver.jsx";
import Overworld from "../battle/overworld/Overworld.jsx";

export default function Recorrido({ param }) {
  const { t, go, lang, changed } = useApp();
  const { data: r, error, reload } = useLoad(() => api.call("challenge_get", { id: param }), [param]);
  const [busy, run] = useBusy();
  if (error && !r) return <ErrorBox error={error} onRetry={reload} />;
  if (!r) return <Spinner />;
  if (!r.map || !r.map.w) return <ErrorBox error={new Error(t("gmap_no_walk"))} />;
  const people = Object.fromEntries(Object.entries(r.people || {}).map(([k, v]) => [k, { name: v.name, avatarUrl: v.avatar_url }]));
  const cur = r.current;
  const onBattle = (who) => run("b", async () => {
    const out = await api.call("challenge_next", { id: r.id, stage: who });
    changed();
    if (out.current?.battle_id) go(`#/combate/${out.current.battle_id}`);
    else reload();
  });
  const ended = r.status !== "active";
  return (
    <div className="space-y-4">
      <div className="page-head">
        <div className="min-w-0 flex items-center gap-3">
          <GymBadge color={r.gym?.badge_color || "#c0c0c0"} size={40} />
          <div className="min-w-0"><h1 className="trunc">{r.target_name}</h1><p className="help">{t("gmap_walk_help", { name: r.challenger_name })}</p></div>
        </div>
        <div className="flex flex-wrap gap-2">
          {cur?.battle_id && !ended && <a className="btn btn-primary" href={`#/combate/${cur.battle_id}`}>{t("run_go_current")}</a>}
          <a className="btn" href={`#/gimnasio/${r.target_id}`}>{t("nav_gyms")}</a>
        </div>
      </div>
      {ended ? (
        <div className={`banner ${r.status === "won" ? "banner-info" : "banner-info"}`}>{t(r.status === "won" ? "gmap_won" : "gmap_lost")}</div>
      ) : (
        <div className="panel p-2">
          <Overworld map={r.map} people={people} player={{ name: r.player?.name, avatarUrl: r.player?.avatar_url }} beaten={r.beaten || []}
            color={r.gym?.badge_color} onBattle={onBattle} saveKey={`silver-walk-${r.id}`} lang={lang} busy={!!busy.b} />
        </div>
      )}
    </div>
  );
}
