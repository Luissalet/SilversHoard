// Home: what is happening (live battles, running series and tournaments, challenges in progress) and where to start.
import React from "react";
import { api } from "../api.js";
import { useApp } from "../context.js";
import { Busy, Icon, ICONS, Section, useBusy } from "../components/ui.jsx";
import { Avatar, JobProgress } from "../components/silver.jsx";
import { BattleRow } from "./Historial.jsx";

export default function Inicio() {
  const { t, ov, go, changed } = useApp();
  const [busy, run] = useBusy();
  const c = ov?.counts || {};
  const quick = () => run("q", async () => {
    const a = await api.call("trainer_random", { ai_level: "hard" });
    const b = await api.call("trainer_random", { ai_level: "hard" });
    const battle = await api.call("battle_start", { p1: { trainer_id: a.id }, p2: { trainer_id: b.id } });
    changed();
    go(`#/combate/${battle.id}`);
  });
  const empty = ov && !c.trainers;
  return (
    <div className="space-y-6">
      <div className="page-head"><div className="min-w-0"><h1>Silver's Hoard</h1><p className="help">{t("home_help")}</p></div></div>
      <div className="summary panel">
        {[["trainers", "#/entrenadores"], ["gyms", "#/gimnasios"], ["leagues", "#/ligas"], ["battles", "#/historial"], ["badges", "#/medallas"]].map(([k, href]) => (
          <a key={k} className="kpi" href={href}><span>{t(`count_${k}`)}</span><b>{c[k] ?? "—"}</b></a>
        ))}
      </div>
      <div className="quick-grid">
        <a className="quick" href="#/combatir"><Icon d={ICONS.play} size={22} /><b>{t("quick_battle")}</b><span className="help">{t("quick_battle_help")}</span></a>
        <button type="button" className="quick" onClick={quick} disabled={busy.q}><Icon d={ICONS.refresh} size={22} /><b>{t("quick_watch")}</b><span className="help">{t("quick_watch_help")}</span></button>
        <a className="quick" href="#/personajes"><Icon d={ICONS.star} size={22} /><b>{t("quick_canon")}</b><span className="help">{t("quick_canon_help")}</span></a>
        <a className="quick" href="#/gimnasio/nuevo"><Icon d={ICONS.plus} size={22} /><b>{t("quick_gym")}</b><span className="help">{t("quick_gym_help")}</span></a>
        <a className="quick" href="#/compartir"><Icon d={ICONS.send} size={22} /><b>{t("quick_share")}</b><span className="help">{t("quick_share_help")}</span></a>
      </div>
      {empty && <div className="banner banner-info">{t("first_steps")}</div>}
      {(ov?.live_battles || []).length > 0 && <Section title={t("live_now")} count={ov.live_battles.length}><div className="panel divide-list p-0">{ov.live_battles.map((b) => <BattleRow key={b.id} b={b} />)}</div></Section>}
      {(ov?.jobs || []).length > 0 && (
        <Section title={t("running_jobs")} count={ov.jobs.length}>
          <div className="panel divide-list p-0">{ov.jobs.map((j) => <a key={j.id} href={`#/trabajo/${j.id}`} className="row-item"><span className="min-w-0 flex-1 trunc">{j.title}</span><span className="min-w-[160px]"><JobProgress job={j} /></span></a>)}</div>
        </Section>
      )}
      {(ov?.active_runs || []).length > 0 && (
        <Section title={t("challenges")} count={ov.active_runs.length}>
          <div className="panel divide-list p-0">
            {ov.active_runs.map((r) => (
              <a key={r.id} href={r.current?.battle_id ? `#/combate/${r.current.battle_id}` : "#/medallas"} className="row-item">
                <Avatar url={r.challenger_avatar_url} name={r.challenger_name} size={30} />
                <span className="min-w-0 flex-1 trunc"><b>{r.challenger_name}</b> → {r.target_name}</span>
                <span className="help">{t("stage_of", { n: r.step + 1, total: r.stages.length })}</span>
              </a>
            ))}
          </div>
        </Section>
      )}
      {(ov?.recent || []).length > 0 && <Section title={t("recent_battles")}><div className="panel divide-list p-0">{ov.recent.map((b) => <BattleRow key={b.id} b={b} />)}</div></Section>}
    </div>
  );
}
