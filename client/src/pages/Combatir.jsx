// Set up battles: one battle (you or the AI on each side), a series of AI battles between two trainers, or a tournament.
import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { useApp } from "../context.js";
import { Busy, Empty, Field, Icon, ICONS, Rel, Section, Switch, Tabs, useBusy, useStored } from "../components/ui.jsx";
import { AiFields, Avatar, FormatSelect, JobProgress, RulesFields, TeamStrip, TrainerSelect, useTrainers } from "../components/silver.jsx";
import { BattleRow } from "./Historial.jsx";

function SeatEditor({ label, seat, onChange, allowHuman = true }) {
  const { t } = useApp();
  const list = useTrainers();
  const trainer = list.find((x) => x.id === seat.trainer_id);
  const [busy, run] = useBusy();
  const randomTrainer = () => run("rnd", async () => {
    const tr = await api.call("trainer_random", {});
    onChange({ ...seat, trainer_id: tr.id });
  });
  return (
    <div className="panel space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="flex-1">{label}</h2>
        {allowHuman && (
          <div className="seg" role="group" aria-label={t("who_plays")}>
            <button type="button" aria-pressed={!!seat.human} onClick={() => onChange({ ...seat, human: true })}>{t("you")}</button>
            <button type="button" aria-pressed={!seat.human} onClick={() => onChange({ ...seat, human: false })}>{t("ai")}</button>
          </div>
        )}
      </div>
      <TrainerSelect value={seat.trainer_id} onChange={(v) => onChange({ ...seat, trainer_id: v, ai_level: undefined, ai_style: undefined })} label={t("trainer")} />
      <div className="flex flex-wrap gap-2">
        <Busy busy={busy.rnd} className="btn btn-sm" onClick={randomTrainer}>{t("random_trainer")}</Busy>
        {trainer && <a className="btn btn-sm" href={`#/entrenador/${trainer.id}`}>{t("open")}</a>}
      </div>
      {!seat.human && trainer && (
        <AiFields compact level={seat.ai_level || trainer.ai_level} style={seat.ai_style || trainer.ai_style}
          onLevel={(v) => onChange({ ...seat, ai_level: v })} onStyle={(v) => onChange({ ...seat, ai_style: v })} />
      )}
    </div>
  );
}

function SingleBattle() {
  const { t, go, changed, settings } = useApp();
  const [p1, setP1] = useStored("silver-seat-1", { trainer_id: "", human: true });
  const [p2, setP2] = useStored("silver-seat-2", { trainer_id: "", human: false });
  const [format, setFormat] = useState("");
  const [rules, setRules] = useState([]);
  const [levelRules, setLevelRules] = useState({});
  const [more, setMore] = useState(false);
  const [busy, run] = useBusy();
  const list = useTrainers();
  const t1 = list.find((x) => x.id === p1.trainer_id);
  useEffect(() => { if (t1 && !format) setFormat(t1.format); }, [t1?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const start = () => run("start", async () => {
    const clean = (s) => ({ trainer_id: s.trainer_id, human: !!s.human, ...(s.ai_level ? { ai_level: s.ai_level } : {}), ...(s.ai_style ? { ai_style: s.ai_style } : {}) });
    const b = await api.call("battle_start", { p1: clean(p1), p2: clean(p2), format: format || "", rules, level_rules: Object.fromEntries(Object.entries(levelRules).filter(([, v]) => v)) });
    changed();
    go(`#/combate/${b.id}`);
  });
  const both = !p1.human && !p2.human;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-2">
        <SeatEditor label={t("side_a")} seat={p1} onChange={setP1} />
        <SeatEditor label={t("side_b")} seat={p2} onChange={setP2} />
      </div>
      <div className="panel space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("format")}><FormatSelect id="battle-format" value={format} onChange={setFormat} /></Field>
          <div className="space-y-1">
            <span className="label">{t("mode")}</span>
            <p className="help">{both ? t("mode_watch") : p1.human && p2.human ? t("mode_hotseat") : t("mode_play")}</p>
          </div>
        </div>
        <button type="button" className="btn-link" onClick={() => setMore((m) => !m)}>{more ? t("less_rules") : t("more_rules")}</button>
        {more && <RulesFields rules={rules} levelRules={levelRules} onRules={setRules} onLevelRules={setLevelRules} />}
        <div className="flex flex-wrap gap-2">
          <Busy busy={busy.start} className="btn btn-primary" disabled={!p1.trainer_id || !p2.trainer_id} onClick={start}>
            <Icon d={ICONS.play} size={14} /> {both ? t("watch_battle") : t("start_battle")}
          </Busy>
          <button type="button" className="btn" onClick={() => { setP1(p2); setP2(p1); }}>{t("swap_sides")}</button>
        </div>
      </div>
    </div>
  );
}

function SeriesForm() {
  const { t, go, settings } = useApp();
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [count, setCount] = useState(settings.series_default || 20);
  const [format, setFormat] = useState("");
  const [busy, run] = useBusy();
  const start = () => run("s", async () => {
    const job = await api.call("series_start", { p1: { trainer_id: a }, p2: { trainer_id: b }, count: Number(count), format });
    go(`#/trabajo/${job.id}`);
  });
  return (
    <div className="panel space-y-3">
      <p className="help">{t("series_help")}</p>
      <div className="grid gap-3 lg:grid-cols-2">
        <TrainerSelect value={a} onChange={setA} label={t("side_a")} />
        <TrainerSelect value={b} onChange={setB} label={t("side_b")} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("series_count")}><input className="field" type="number" min={1} max={1000} value={count} onChange={(e) => setCount(e.target.value)} /></Field>
        <Field label={t("format")}><FormatSelect id="series-format" value={format} onChange={setFormat} /></Field>
      </div>
      <Busy busy={busy.s} className="btn btn-primary" disabled={!a || !b} onClick={start}>{t("series_start")}</Busy>
    </div>
  );
}

function TournamentForm() {
  const { t, go } = useApp();
  const list = useTrainers();
  const [picked, setPicked] = useState([]);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("bracket");
  const [bestOf, setBestOf] = useState(1);
  const [level, setLevel] = useState("");
  const [format, setFormat] = useState("");
  const [title, setTitle] = useState("");
  const [busy, run] = useBusy();
  const shown = list.filter((x) => !q || `${x.name} ${x.title} ${(x.tags || []).join(" ")}`.toLowerCase().includes(q.toLowerCase()));
  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const start = () => run("t", async () => {
    const job = await api.call("tournament_start", { trainer_ids: picked, kind, best_of: Number(bestOf), format, title, ...(level ? { ai_level: level } : {}) });
    go(`#/trabajo/${job.id}`);
  });
  return (
    <div className="panel space-y-3">
      <p className="help">{t("tournament_help")}</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={t("tournament_name")}><input className="field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("tournament_name_ph")} /></Field>
        <Field label={t("tournament_kind")}>
          <select className="field" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="bracket">{t("kind_bracket")}</option>
            <option value="league">{t("kind_league_table")}</option>
          </select>
        </Field>
        <Field label={t("best_of")}>
          <select className="field" value={bestOf} onChange={(e) => setBestOf(e.target.value)}>{[1, 3, 5, 7].map((n) => <option key={n} value={n}>{n}</option>)}</select>
        </Field>
        <Field label={t("same_ai")}>
          <select className="field" value={level} onChange={(e) => setLevel(e.target.value)}>
            <option value="">{t("each_own_ai")}</option>
            {["easy", "normal", "hard", "expert"].map((l) => <option key={l} value={l}>{t(`lvl_${l}`)}</option>)}
          </select>
        </Field>
      </div>
      <Field label={t("format")}><FormatSelect id="tour-format" value={format} onChange={setFormat} /></Field>
      <div className="flex flex-wrap items-center gap-2">
        <input className="field max-w-xs" placeholder={t("filter")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("filter")} />
        <button type="button" className="btn btn-sm" onClick={() => setPicked(Array.from(new Set([...picked, ...shown.map((x) => x.id)])))}>{t("select_shown")}</button>
        <button type="button" className="btn btn-sm" onClick={() => setPicked([])}>{t("clear")}</button>
        <span className="help">{t("n_selected", { n: picked.length })}</span>
      </div>
      <div className="pick-grid">
        {shown.map((x) => (
          <label key={x.id} className={`pick ${picked.includes(x.id) ? "is-on" : ""}`}>
            <input type="checkbox" checked={picked.includes(x.id)} onChange={() => toggle(x.id)} />
            <Avatar url={x.avatar_url} name={x.name} size={34} />
            <span className="min-w-0 flex-1"><b className="trunc block">{x.name}</b><TeamStrip species={x.species} size={22} /></span>
          </label>
        ))}
      </div>
      <Busy busy={busy.t} className="btn btn-primary" disabled={picked.length < 2} onClick={start}>{t("tournament_start")}</Busy>
    </div>
  );
}

export default function Combatir({ query }) {
  const { t, ov } = useApp();
  const [tab, setTab] = useStored("silver-battle-tab", "single");
  const jobs = ov?.jobs || [];
  return (
    <div className="space-y-5">
      <div className="page-head">
        <div className="min-w-0">
          <h1>{t("nav_battle")}</h1>
          <p className="help">{t("battle_page_help")}</p>
        </div>
      </div>
      {(ov?.live_battles || []).length > 0 && (
        <Section title={t("live_now")} count={ov.live_battles.length}>
          <div className="panel divide-list p-0">{ov.live_battles.map((b) => <BattleRow key={b.id} b={b} />)}</div>
        </Section>
      )}
      {jobs.length > 0 && (
        <Section title={t("running_jobs")} count={jobs.length}>
          <div className="panel divide-list p-0">
            {jobs.map((j) => (
              <a key={j.id} href={`#/trabajo/${j.id}`} className="row-item">
                <span className="min-w-0 flex-1 trunc">{j.title}</span>
                <span className="min-w-[160px]"><JobProgress job={j} /></span>
              </a>
            ))}
          </div>
        </Section>
      )}
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "single", label: t("tab_single") }, { id: "series", label: t("tab_series") }, { id: "tournament", label: t("tab_tournament") }]} />
      {tab === "single" && <SingleBattle />}
      {tab === "series" && <SeriesForm />}
      {tab === "tournament" && <TournamentForm />}
    </div>
  );
}
