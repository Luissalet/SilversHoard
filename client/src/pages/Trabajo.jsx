// The result of a series, tournament or team benchmark: win rates and MVPs, bracket / league table, or variant deltas, with every battle to replay.
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

function signed(n) {
  if (n > 0) return `+${n}`;
  return String(n);
}

function MetagameResult({ job }) {
  const { t, go } = useApp();
  const [busy, run] = useBusy();
  const r = job.result;
  const sample = r.metagame;
  const repeat = () => run("repeat", async () => {
    const next = await api.call("benchmark_start", {...job.args, ai_level: job.args.ai_level || null, sample_job_id: job.id, seed: String(r.seed)});
    go(`#/trabajo/${next.id}`);
  });
  const teams = Object.fromEntries(sample.pool.map((team) => [team.id, team]));
  return <div className="space-y-4">
    <div className="panel space-y-2">
      <h2>{t("meta_sample")}: {sample.generated}/{sample.requested}</h2>
      <p className="help">{t("meta_generated")}</p>
      {!sample.complete && <p role="status">{t("meta_incomplete", { n: sample.generated })} {t(`meta_reason_${sample.reason}`)}</p>}
      <p className="help">{t("format")}: <b>{sample.format_requested}</b> · {t("meta_usage_format")}: <b>{sample.usage_format || t("meta_no_data")}</b></p>
      <p className="help">{t("meta_set_formats")}: {sample.source_formats.join(", ") || t("meta_no_data")}</p>
      <p className="help">{t("meta_source")}: {sample.source}</p>
      <p className="help">{t("benchmark_seed")}: <b className="num">{String(r.seed)}</b> · {t("meta_ai")}: {t(`lvl_${r.rival_ai_level}`)}</p>
      <p className="help break-all">{t("meta_fingerprint")}: <code>{sample.corpus_sha256}</code></p>
      <Busy busy={busy.repeat} className="btn" onClick={repeat}>{t("meta_repeat")}</Busy>
      <p className="help">{t("meta_repeat_help")}</p>
    </div>
    {r.variants.map((row) => <section key={row.id} className="space-y-3" aria-label={row.name}>
      <div className="panel space-y-2">
        <h2>{row.name}</h2>
        <p>{t("wins_n", { n: row.wins })} · {t("meta_losses", { n: row.losses })} · {t("ties_n", { n: row.ties })} · {t("win_rate")}: <b>{row.played ? pct(row.win_rate) : "—"}</b></p>
        <p className="help">{t("meta_rate_help", { n: row.played })}</p>
      </div>
      <Section title={t("meta_threats")} count={row.threats.length}>
        <p className="help">{t("meta_threats_help")} {t(r.damage_unit === "pokemon_hp_bars" ? "meta_damage_classic" : "meta_damage_rt")}</p>
        {row.threats.length ? <div className="panel p-0 scroll-x"><table className="tbl">
          <thead><tr><th>{t("pokemon")}</th><th className="r">KOs</th><th className="r">{t("meta_damage")}</th><th className="r">{t("meta_appearances")}</th></tr></thead>
          <tbody>{row.threats.map((mon) => <tr key={mon.species}>
            <td><span className="flex items-center gap-2"><MonIcon species={mon.species} size={30} />{mon.species}</span></td>
            <td className="r num">{mon.kos}</td><td className="r num">{mon.damage.toFixed(2)}</td><td className="r num">{mon.appearances}</td>
          </tr>)}</tbody>
        </table></div> : <p className="help">{t("meta_no_threats")}</p>}
      </Section>
      <Section title={t("benchmark_by_rival")} count={row.by_rival.length}>
        <div className="panel p-0 scroll-x"><table className="tbl">
          <thead><tr><th>{t("benchmark_rivals")}</th><th>{t("tab_team")}</th><th className="r">{t("won")}</th><th className="r">{t("lost")}</th><th className="r">{t("tied")}</th><th>{t("benchmark_seed")}</th></tr></thead>
          <tbody>{row.by_rival.map((br) => <tr key={br.rival_id}>
            <td>{br.rival_name}</td>
            <td><details><summary>{teams[br.rival_id].sets.map((s) => s.species).join(", ")}</summary>
              <ul>{teams[br.rival_id].sets.map((s, index) => <li key={index}>
                <b>{s.species}</b> · {s.level} · {s.item} · {s.ability}<br />{s.moves.join(", ")}
              </li>)}</ul>
            </details></td>
            <td className="r num">{br.wins}</td><td className="r num">{br.losses}</td><td className="r num">{br.ties}</td>
            <td className="num">{br.seeds.map((seed) => seed.join(",")).join(" / ")}</td>
          </tr>)}</tbody>
        </table></div>
      </Section>
    </section>)}
  </div>;
}

function BenchmarkResult({ job }) {
  const { t } = useApp();
  const r = job.result || {};
  const rows = r.variants || [];
  if (!rows.length) return null;
  const rivals = r.rivals || [];
  const improved = new Set(r.improved || []);
  const worsened = new Set(r.worsened || []);
  return (
    <div className="space-y-4">
      <div className="panel space-y-2">
        <div className="flex flex-wrap gap-3">
          <span className="help">{t("benchmark_reference")}: <b>{rows[0]?.name}</b></span>
          <span className="help">{t("benchmark_games")}: <b>{r.games}</b></span>
          {r.seed != null && r.seed !== "" && <span className="help">{t("benchmark_seed")}: <b className="num">{String(r.seed)}</b></span>}
        </div>
        {(improved.size > 0 || worsened.size > 0) && (
          <div className="flex flex-wrap gap-2">
            {[...improved].map((id) => {
              const row = rows.find((x) => x.id === id);
              return row ? <span key={`i-${id}`} className="chip chip-accent">{t("benchmark_improved")}: {row.name}</span> : null;
            })}
            {[...worsened].map((id) => {
              const row = rows.find((x) => x.id === id);
              return row ? <span key={`w-${id}`} className="chip">{t("benchmark_worsened")}: {row.name}</span> : null;
            })}
          </div>
        )}
      </div>
      <div className="panel p-0 scroll-x">
        <table className="tbl">
          <thead>
            <tr>
              <th>{t("trainer")}</th>
              <th className="r">{t("won")}</th>
              <th className="r">{t("lost")}</th>
              <th className="r">{t("tied")}</th>
              <th className="r">{t("win_rate")}</th>
              <th className="r">{t("benchmark_delta_wins")}</th>
              <th className="r">{t("benchmark_delta_rate")}</th>
              <th>{t("mvp")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className={row.id === r.reference_id ? "is-ref" : ""}>
                <td><b>{row.name}</b>{row.id === r.reference_id ? <span className="chip ml-2">{t("benchmark_reference")}</span> : null}</td>
                <td className="r num">{row.wins}</td>
                <td className="r num">{row.losses}</td>
                <td className="r num">{row.ties}</td>
                <td className="r num">{pct(row.win_rate)}</td>
                <td className="r num">{signed(row.delta?.wins || 0)}</td>
                <td className="r num">{signed(Math.round((row.delta?.win_rate || 0) * 1000) / 10)}%</td>
                <td>{row.mvp ? <span className="flex items-center gap-2"><MonIcon species={row.mvp.species} size={26} /> {row.mvp.species}</span> : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rivals.length > 0 && (
        <Section title={t("benchmark_by_rival")} count={rivals.length}>
          <div className="panel p-0 scroll-x">
            <table className="tbl">
              <thead>
                <tr>
                  <th>{t("trainer")}</th>
                  {rivals.map((rv) => <th key={rv.id} className="r">{rv.name}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td><b>{row.name}</b></td>
                    {(row.by_rival || []).map((br) => {
                      const d = (row.delta?.by_rival || []).find((x) => x.rival_id === br.rival_id);
                      return (
                        <td key={br.rival_id} className="r">
                          <div className="num">{br.wins}-{br.losses}{br.ties ? `-${br.ties}` : ""}</div>
                          <div className="help">{pct(br.win_rate)}{d && row.id !== r.reference_id ? ` (${signed(d.wins)})` : ""}</div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
      <p className="help">{t("benchmark_result_help")}</p>
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
  const meta = job.kind === "benchmark" && (job.args?.rival_source === "metagame" || r.rival_source === "metagame");
  const names = Object.fromEntries((r.entrants || []).map((e) => [e.id, e]));
  const del = async () => {
    if (!(await confirm({ title: t("delete"), message: t("delete_job_msg") }))) return;
    run("del", async () => { await api.call("jobs_delete", { ids: [job.id] }); changed(); go("#/combatir"); });
  };
  return (
    <div className="space-y-4">
      <div className="page-head">
        <div className="min-w-0"><h1 className={meta ? undefined : "trunc"}>{meta ? t("meta_sample") : job.title || r.title}</h1><p className="help">{meta ? t(job.args?.mode === "realtime" ? "mode_realtime" : "mode_classic") : t(`job_kind_${job.kind}`)}</p></div>
        <div className="flex gap-2">
          {["queued", "running"].includes(job.status) && <Busy busy={busy.c} className="btn" onClick={() => run("c", async () => { await api.call("job_cancel", { id: job.id }); notify(t("cancelling")); })}>{t("cancel")}</Busy>}
          {!["queued", "running"].includes(job.status) && <Busy busy={busy.del} className="btn btn-danger" onClick={del}><Icon d={ICONS.trash} size={14} /> {t("delete")}</Busy>}
        </div>
      </div>
      <JobProgress job={job} />
      {job.kind === "series" && job.status === "done" && <SeriesResult job={job} />}
      {job.kind === "tournament" && job.status === "done" && (r.kind === "league" ? <LeagueTable r={r} names={names} /> : <Bracket r={r} names={names} />)}
      {job.kind === "benchmark" && job.status === "done" && (r.rival_source === "metagame" ? <MetagameResult job={job} /> : <BenchmarkResult job={job} />)}
      {(job.battles || []).length > 0 && (
        <Section title={t("battles")} count={job.battles.length}>
          <div className="panel divide-list p-0">{job.battles.map((b) => <BattleRow key={b.id} b={b} />)}</div>
        </Section>
      )}
    </div>
  );
}
