// The result of a series or a tournament: win rates and MVPs, or the bracket / league table, with every battle to replay.
import React from "react";
import { api } from "../api.js";
import { useApp } from "../context.js";
import { Busy, ErrorBox, Icon, ICONS, Section, Spinner, useBusy, useLoad } from "../components/ui.jsx";
import { usePoll } from "../components/hooks.js";
import { Avatar, JobProgress, MonIcon } from "../components/silver.jsx";
import { BattleRow } from "./Historial.jsx";

function pct(x) { return `${Math.round((x || 0) * 100)}%`; }

function SeriesResult({ job }) {
  const { t } = useApp();
  const r = job.result || {};
  if (!r.count) return null;
  const sides = ["p1", "p2"];
  return (
    <div className="space-y-4">
      <div className="panel series-score">
        {sides.map((s) => (
          <div key={s} className={`series-side ${r.wins[s] > r.wins[s === "p1" ? "p2" : "p1"] ? "is-winner" : ""}`}>
            <Avatar url={r[s]?.avatar_url} name={r[s]?.name} size={64} />
            <b>{r[s]?.name}</b>
            <span className="series-pct">{pct(r.win_rate[s])}</span>
            <span className="help">{t("wins_n", { n: r.wins[s] })}</span>
          </div>
        ))}
        <div className="series-mid"><span className="help">{t("battles_n", { n: r.count })}</span><span className="help">{t("avg_turns", { n: r.avg_turns })}</span>{r.wins.tie ? <span className="help">{t("ties_n", { n: r.wins.tie })}</span> : null}</div>
      </div>
      <div className="panel p-0 scroll-x">
        <table className="tbl">
          <thead><tr><th>{t("pokemon")}</th><th>{t("side")}</th><th className="r">{t("kos_per_battle")}</th><th className="r">{t("damage_per_battle")}</th><th className="r">{t("survival")}</th></tr></thead>
          <tbody>
            {(r.pokemon || []).map((m, i) => (
              <tr key={i}>
                <td><span className="flex items-center gap-2"><MonIcon species={m.species} size={30} /> {m.species}{(r.mvp?.p1 === m || (r.mvp?.p1?.species === m.species && r.mvp?.p1?.side === m.side) || (r.mvp?.p2?.species === m.species && r.mvp?.p2?.side === m.side)) && <span className="chip chip-accent">MVP</span>}</span></td>
                <td>{r[m.side]?.name}</td>
                <td className="r num">{m.kos_per_battle}</td>
                <td className="r num">{(m.damage || 0).toFixed(2)}</td>
                <td className="r num">{pct(m.survival)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="help">{t("series_samples_help")}</p>
    </div>
  );
}

function Bracket({ r, names }) {
  const { t } = useApp();
  return (
    <div className="bracket">
      {(r.rounds || []).map((round) => (
        <div key={round.round} className="bracket-round">
          <b className="help">{t("round_n", { n: round.round })}</b>
          {round.byes?.length > 0 && <div className="help">{t("byes")}: {round.byes.map((id) => names[id]?.name).join(", ")}</div>}
          {round.matches.map((mi) => {
            const m = r.matches[mi];
            return (
              <div key={mi} className="bracket-match">
                {[m.a, m.b].map((id, k) => (
                  <div key={id} className={`bracket-entrant ${m.advance === id ? "is-winner" : ""}`}>
                    <Avatar url={names[id]?.avatar_url} name={names[id]?.name} size={26} />
                    <span className="trunc flex-1">{names[id]?.name}</span>
                    <b className="num">{m.score[k]}</b>
                  </div>
                ))}
                <div className="flex flex-wrap gap-1">{m.games.map((g, gi) => <a key={gi} className="chip" href={`#/combate/${g.battle_id}`}>{t("game_n", { n: gi + 1 })}</a>)}</div>
              </div>
            );
          })}
        </div>
      ))}
      <div className="bracket-round">
        <b className="help">{t("champion")}</b>
        <div className="bracket-champion"><Avatar url={names[r.champion]?.avatar_url} name={names[r.champion]?.name} size={56} /><b>{names[r.champion]?.name}</b></div>
      </div>
    </div>
  );
}

function LeagueTable({ r, names }) {
  const { t } = useApp();
  return (
    <div className="panel p-0 scroll-x">
      <table className="tbl">
        <thead><tr><th>#</th><th>{t("trainer")}</th><th className="r">{t("played")}</th><th className="r">{t("won")}</th><th className="r">{t("tied")}</th><th className="r">{t("lost")}</th><th className="r">{t("points")}</th></tr></thead>
        <tbody>
          {(r.standings || []).map((row, i) => (
            <tr key={row.id}>
              <td className="num">{i + 1}</td>
              <td><span className="flex items-center gap-2"><Avatar url={names[row.id]?.avatar_url} name={row.name} size={26} /> {row.name}</span></td>
              <td className="r num">{row.played}</td><td className="r num">{row.won}</td><td className="r num">{row.tied}</td><td className="r num">{row.lost}</td><td className="r num"><b>{row.points}</b></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Trabajo({ param }) {
  const { t, notify, changed, go, confirm } = useApp();
  const { data: job, error, reload, setData } = useLoad(() => api.call("job_get", { id: param }), [param]);
  usePoll(async () => setData(await api.call("job_get", { id: param })), 1500, !!job && ["queued", "running"].includes(job.status));
  const [busy, run] = useBusy();
  if (error && !job) return <ErrorBox error={error} onRetry={reload} />;
  if (!job) return <Spinner />;
  const r = job.result || {};
  const names = Object.fromEntries((r.entrants || []).map((e) => [e.id, e]));
  const del = async () => {
    if (!(await confirm({ title: t("delete"), message: t("delete_job_msg") }))) return;
    run("del", async () => { await api.call("jobs_delete", { ids: [job.id] }); changed(); go("#/combatir"); });
  };
  return (
    <div className="space-y-4">
      <div className="page-head">
        <div className="min-w-0"><h1 className="trunc">{job.title || r.title}</h1><p className="help">{t(`job_kind_${job.kind}`)}</p></div>
        <div className="flex gap-2">
          {["queued", "running"].includes(job.status) && <Busy busy={busy.c} className="btn" onClick={() => run("c", async () => { await api.call("job_cancel", { id: job.id }); notify(t("cancelling")); })}>{t("cancel")}</Busy>}
          {!["queued", "running"].includes(job.status) && <Busy busy={busy.del} className="btn btn-danger" onClick={del}><Icon d={ICONS.trash} size={14} /> {t("delete")}</Busy>}
        </div>
      </div>
      <JobProgress job={job} />
      {job.kind === "series" && job.status === "done" && <SeriesResult job={job} />}
      {job.kind === "tournament" && job.status === "done" && (r.kind === "league" ? <LeagueTable r={r} names={names} /> : <Bracket r={r} names={names} />)}
      {(job.battles || []).length > 0 && (
        <Section title={t("battles")} count={job.battles.length}>
          <div className="panel divide-list p-0">{job.battles.map((b) => <BattleRow key={b.id} b={b} />)}</div>
        </Section>
      )}
    </div>
  );
}
