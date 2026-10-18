// Compare several team variants against the same rivals with shared seeds (job → Trabajo).
import React, { useMemo, useState } from "react";
import { api } from "../api.js";
import { useApp } from "../context.js";
import { Busy, Field, useBusy, useStored } from "./ui.jsx";
import { FormatSelect, useTrainers } from "./silver.jsx";
import ModeFields, { withEqualLevel } from "../battle/rt/ModeFields.jsx";

function IdPicks({ label, picked, onChange, exclude = [] }) {
  const { t } = useApp();
  const list = useTrainers();
  const [q, setQ] = useState("");
  const shown = useMemo(
    () => list.filter((x) => !exclude.includes(x.id) && (!q || `${x.name} ${x.title}`.toLowerCase().includes(q.toLowerCase()))),
    [list, q, exclude],
  );
  const toggle = (id) => onChange(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);
  return (
    <div className="panel space-y-2">
      <div className="flex items-center gap-2">
        <h2 className="flex-1">{label}</h2>
        <span className="help">{t("n_selected", { n: picked.length })}</span>
      </div>
      <input className="field" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("choose_trainer")} aria-label={label} />
      <div className="max-h-48 overflow-auto divide-list border rounded">
        {shown.map((tr) => (
          <label key={tr.id} className="row-item gap-2 cursor-pointer">
            <input type="checkbox" checked={picked.includes(tr.id)} onChange={() => toggle(tr.id)} />
            <span className="trunc flex-1">{tr.name}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

export default function TeamBenchmark() {
  const { t, go, settings } = useApp();
  const list = useTrainers();
  const [variants, setVariants] = useState([]);
  const [rivals, setRivals] = useState([]);
  const [reference, setReference] = useState("");
  const [games, setGames] = useState(2);
  const [source, setSource] = useState("trainers");
  const [rivalAi, setRivalAi] = useState("normal");
  const meta = source === "metagame";
  const [format, setFormat] = useState("");
  const [seed, setSeed] = useState("bench-1");
  const [mode, setMode] = useStored("silver-mode", settings.default_mode || "classic");
  const [equal, setEqual] = useStored("silver-equal-level", settings.default_level || 0);
  const [arena, setArena] = useStored("silver-rt-arena", "rocks");
  const [busy, run] = useBusy();
  const refOptions = variants.map((id) => list.find((x) => x.id === id)).filter(Boolean);

  const start = () => run("b", async () => {
    const job = await api.call("benchmark_start", {
      variant_ids: variants,
      rival_ids: meta ? [] : rivals,
      rival_source: source,
      rival_ai_level: rivalAi,
      reference_id: reference || variants[0] || "",
      games: Number(games) || 1,
      format,
      seed,
      mode,
      level_rules: withEqualLevel({}, equal),
      ...(mode === "realtime" ? { rt_arena: arena } : {}),
    });
    go(`#/trabajo/${job.id}`);
  });

  return (
    <div className="space-y-3">
      <Field label={t("meta_source")}>
        <select className="field" value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="trainers">{t("benchmark_rivals")}</option>
          <option value="metagame">{t("meta_sample")}</option>
        </select>
      </Field>
      <p className="help">{t(meta ? "meta_help" : "benchmark_help")}</p>
      <div className="grid gap-3 lg:grid-cols-2">
        <IdPicks label={t("benchmark_variants")} picked={variants} onChange={(v) => { setVariants(v); if (reference && !v.includes(reference)) setReference(""); }} exclude={meta ? [] : rivals} />
        {meta ? <div className="panel space-y-2">
          <Field label={t("meta_ai")}>
            <select className="field" value={rivalAi} onChange={(e) => setRivalAi(e.target.value)}>
              {["normal", "hard", "expert"].map((level) => <option key={level} value={level}>{t(`lvl_${level}`)}</option>)}
            </select>
          </Field>
          <p className="help">{t("meta_generated")}</p>
        </div> : <IdPicks label={t("benchmark_rivals")} picked={rivals} onChange={setRivals} exclude={variants} />}
      </div>
      <div className="panel space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("benchmark_reference")}>
            <select className="field" value={reference} onChange={(e) => setReference(e.target.value)}>
              <option value="">{t("benchmark_reference_first")}</option>
              {refOptions.map((tr) => <option key={tr.id} value={tr.id}>{tr.name}</option>)}
            </select>
          </Field>
          <Field label={t("benchmark_games")}>
            <input className="field" type="number" min={1} max={50} value={games} onChange={(e) => setGames(e.target.value)} />
          </Field>
          <Field label={t("format")}><FormatSelect id="bench-format" value={format} onChange={setFormat} /></Field>
          <Field label={t("benchmark_seed")}>
            <input className="field" value={seed} onChange={(e) => setSeed(e.target.value)} />
          </Field>
        </div>
        <ModeFields t={t} mode={mode} onMode={setMode} compact level={equal} onLevel={setEqual} arena={arena} onArena={setArena} />
        <Busy busy={busy.b} className="btn btn-primary" disabled={variants.length < (meta ? 1 : 2) || (!meta && rivals.length < 1)} onClick={start}>
          {t(meta ? "meta_start" : "benchmark_start")}
        </Busy>
      </div>
    </div>
  );
}
