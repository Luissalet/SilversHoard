import React, { useState } from "react";
import { api } from "../api.js";
import { useApp } from "../context.js";
import { loc } from "../loc.js";
import { nameOf } from "../battle/dex.js";
import { useTrainers } from "./silver.jsx";
import { ErrorBox, Field, Spinner, useLoad } from "./ui.jsx";

function Frequencies({ title, help, rows, category, complete, battles }) {
  const { t, lang } = useApp();
  const max = Math.max(1, ...rows.map((row) => row.count));
  return <section className="min-w-0 space-y-2" aria-label={title}>
    <h3>{title}</h3><p className="help">{help}</p>
    <p className="help">{t("replay_stats_coverage", { n: complete, m: battles })}</p>
    {rows.length === 0 ? <p className="help">{t("replay_stats_no_rows")}</p> : <ol className="space-y-2">
      {rows.map((row) => <li key={row.name} className="min-w-0">
        <div className="flex items-start justify-between gap-2"><span className="min-w-0 break-words">{nameOf(category, row.name, lang)}</span><b className="num shrink-0">{row.count}</b></div>
        <div className="h-2 w-full overflow-hidden rounded-full" style={{ backgroundColor: "var(--line)" }} role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={row.count} aria-label={nameOf(category, row.name, lang)}>
          <div className="h-full rounded-full" style={{ backgroundColor: "var(--accent)", width: `${row.count / max * 100}%` }} />
        </div>
      </li>)}
    </ol>}
  </section>;
}

function Statistics({ kind }) {
  const { t, lang, version } = useApp();
  const trainers = useTrainers();
  const [mode, setMode] = useState("");
  const [trainerId, setTrainerId] = useState("");
  const [all, setAll] = useState(false);
  const { data, error, loading, reload } = useLoad(() => api.call("replay_statistics", { kind, mode, trainer_id: trainerId, limit: all ? 0 : 12 }), [kind, mode, trainerId, all, version]);
  // Do not label a previous response with newly selected filters while their request is in flight.
  const current = data?.filters.kind === kind && data?.filters.mode === mode && data?.filters.trainer_id === trainerId;
  return <div className="space-y-4 pt-4">
    <p className="help">{t("replay_stats_help")}</p>
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label={t("replay_stats_mode")}><select className="field" aria-label={t("replay_stats_mode")} value={mode} onChange={(e) => setMode(e.target.value)}>
        <option value="">{t("all")}</option><option value="classic">{t("replay_stats_classic")}</option><option value="realtime">{t("replay_stats_rt")}</option>
      </select></Field>
      <Field label={t("replay_stats_trainer")}><select className="field" aria-label={t("replay_stats_trainer")} value={trainerId} onChange={(e) => setTrainerId(e.target.value)}>
        <option value="">{t("all")}</option>{trainers.map((tr) => <option key={tr.id} value={tr.id}>{loc(tr, lang)}</option>)}
      </select></Field>
    </div>
    <label className="flex items-center gap-2"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />{t("replay_stats_all")}</label>
    {error ? <ErrorBox error={error} onRetry={reload} /> : loading || !current ? <Spinner /> : data.totals.battles === 0 ? <p className="help">{t("replay_stats_empty")}</p> : <>
      <p className="num">{t("replay_stats_battles", { n: data.totals.battles, m: data.totals.move_uses })}</p>
      <div className="grid gap-6 md:grid-cols-3">
        {[['moves', 'move', 'uses'], ['species', 'species', 'presence'], ['openings', 'species', 'leads']].map(([key, category, help]) =>
          <Frequencies key={key} title={t(`replay_stats_${key}`)} help={t(`replay_stats_${help}`)} rows={data[key]} category={category} complete={data.coverage[key]} battles={data.totals.battles} />)}
      </div>
      {['moves', 'species', 'openings'].some((key) => data.coverage[key] < data.totals.battles) && <p className="help">{t("replay_stats_partial")}</p>}
      {data.coverage.ambiguous_move_lines > 0 && <p className="help">{t("replay_stats_ambiguous", { n: data.coverage.ambiguous_move_lines })}</p>}
    </>}
  </div>;
}

export default function ReplayStatistics({ kind }) {
  const { t } = useApp();
  const [open, setOpen] = useState(false);
  return <details className="panel" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>{t("replay_stats")}</summary>
    {open && <Statistics kind={kind} />}
  </details>;
}
