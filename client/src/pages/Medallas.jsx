// Badges earned here and by friends (through result codes), active challenges and the hall of fame.
import React from "react";
import { api } from "../api.js";
import { useApp } from "../context.js";
import { Busy, ErrorBox, Section, Spinner, useBusy, useLoad } from "../components/ui.jsx";
import { useCopilotRefresh } from "../components/hooks.js";
import { Avatar, GymBadge, MonIcon } from "../components/silver.jsx";

export default function Medallas() {
  const { t, go, changed } = useApp();
  const badges = useLoad(() => api.call("badges_list", {}), []);
  const runs = useLoad(() => api.call("challenges_list", {}), []);
  const hall = useLoad(() => api.call("hall_of_fame", {}), []);
  useCopilotRefresh(() => { badges.reload(); runs.reload(); hall.reload(); });
  const [busy, run] = useBusy();
  const byPerson = {};
  for (const b of badges.data?.badges || []) (byPerson[b.challenger_name] ||= []).push(b);
  const next = (r) => run(r.id, async () => { const x = await api.call("challenge_next", { id: r.id }); changed(); const cur = x.stages[x.step]; if (cur?.battle_id) go(`#/combate/${cur.battle_id}`); });
  const abandon = (r) => run(`a${r.id}`, async () => { await api.call("challenge_abandon", { id: r.id }); runs.reload(); });
  return (
    <div className="space-y-5">
      <div className="page-head"><div className="min-w-0"><h1>{t("nav_badges")}</h1><p className="help">{t("badges_help")}</p></div></div>
      {badges.error && <ErrorBox error={badges.error} onRetry={badges.reload} />}
      <Section title={t("badge_cases")}>
        {!badges.data ? <Spinner /> : Object.keys(byPerson).length === 0 ? <p className="help">{t("no_badges")}</p> : (
          <div className="badge-cases">
            {Object.entries(byPerson).map(([name, list]) => (
              <div key={name} className="badge-case">
                <b>{name}</b>
                <div className="flex flex-wrap gap-2">
                  {list.map((b) => <a key={b.id} href={`#/gimnasio/${b.gym_id}`} className="badge-slot" title={`${b.gym_name} · ${b.source === "friend" ? t("from_friend") : t("here")}`}><GymBadge color={b.badge_color} size={40} label={b.badge} /><span className="help trunc">{b.badge || b.gym_name}</span></a>)}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
      <Section title={t("challenges")} count={(runs.data?.challenges || []).length}>
        {!runs.data ? <Spinner /> : (runs.data.challenges || []).length === 0 ? <p className="help">{t("no_challenges")}</p> : (
          <div className="panel divide-list p-0">
            {runs.data.challenges.map((r) => (
              <div key={r.id} className="row-item">
                <Avatar url={r.challenger_avatar_url} name={r.challenger_name} size={30} />
                <span className="min-w-0 flex-1 trunc"><b>{r.challenger_name}</b> → {r.target_name} <span className="help">({r.stages.filter((s) => s.result === "won").length}/{r.stages.length})</span></span>
                <span className={`chip ${r.status === "won" ? "chip-ok" : r.status === "lost" ? "chip-danger" : "chip-accent"}`}>{t(`run_${r.status}`)}</span>
                {r.status === "active" && <Busy busy={busy[r.id]} className="btn btn-sm btn-primary" onClick={() => next(r)}>{t("continue")}</Busy>}
                {r.status === "active" && <Busy busy={busy[`a${r.id}`]} className="btn btn-sm" onClick={() => abandon(r)}>{t("abandon")}</Busy>}
              </div>
            ))}
          </div>
        )}
      </Section>
      <Section title={t("hall_of_fame")} count={(hall.data?.hall || []).length}>
        {!hall.data ? <Spinner /> : (hall.data.hall || []).length === 0 ? <p className="help">{t("hall_empty")}</p> : (
          <div className="hall-list">
            {hall.data.hall.map((h) => (
              <div key={h.id} className="hall-card"><b>{h.champion_name}</b><span className="help">{h.league_name} · {new Date(h.earned_at * 1000).toLocaleDateString()}</span>
                <div className="flex flex-wrap gap-1">{(h.team || []).map((m, i) => <MonIcon key={i} species={m.species} size={40} />)}</div></div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
