// Bring things in from friends (share codes, result codes, .hoard* files, playable pages, Showdown teams) and see what you sent.
import React, { useRef, useState } from "react";
import { api } from "../api.js";
import { useApp } from "../context.js";
import { Busy, Field, Icon, ICONS, Section, useBusy } from "../components/ui.jsx";
import { FormatSelect } from "../components/silver.jsx";
import { ExerciseLibrary } from "../components/Training.jsx";

function ResultView({ r }) {
  const { t } = useApp();
  if (!r) return null;
  if (r.kind === "exercise") return <p className="banner banner-info" role="status">{t("training_imported",{name:r.exercise.title})}</p>;
  if (r.kind === "trainer") {
    return (
      <div className="banner banner-info">
        {t("imported_trainer", { name: r.trainer.name })} <a className="btn-link" href={`#/entrenador/${r.trainer.id}`}>{t("open")}</a>
        {r.player !== undefined && <> {t("imported_save", { n: r.trainer.team.length })}</>}
        {r.skipped?.length > 0 && <> {t("imported_save_skipped", { list: r.skipped.map((s) => {
          const m = String(s).match(/^(\d+): (egg|move|item|ability|species)(?: #(\d+))?$/);
          return m ? t(`ub_skip_${m[2]}`, { slot: m[1], id: m[3] || "" }) : s;
        }).join(", ") })}</>}
      </div>
    );
  }
  if (r.kind === "gym") return <div className="banner banner-info">{t("imported_gym", { name: r.gym.name })} <a className="btn-link" href={`#/gimnasio/${r.gym.id}`}>{t("open")}</a></div>;
  if (r.kind === "league") return <div className="banner banner-info">{t("imported_league", { name: r.league.name })} <a className="btn-link" href={`#/liga/${r.league.id}`}>{t("open")}</a></div>;
  if (r.kind === "result") {
    return (
      <div className={`banner ${r.won ? "banner-info" : "banner-warn"}`}>
        {r.won ? t("friend_won", { name: r.challenger, target: r.gym?.name || r.trainer?.name }) : t("friend_lost", { name: r.challenger, target: r.gym?.name || r.trainer?.name })}{" "}
        {r.verified ? <>{t("friend_checked")}{" "}</> : r.verified_real_time > 0 && <>{t("friend_verified", { n: r.verified_real_time })}{" "}</>}
        {r.week && <>{t("friend_week", { week: r.week })}{" "}</>}
        <a className="btn-link" href="#/amigos">{t("see_leaderboard")}</a>{" · "}
        {r.battle_id && <a className="btn-link" href={`#/combate/${r.battle_id}`}>{t("replay")}</a>}
      </div>
    );
  }
  return null;
}

export default function Compartir() {
  const { t, changed } = useApp();
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [format, setFormat] = useState("");
  const [result, setResult] = useState(null);
  const fileRef = useRef(null);
  const [busy, run] = useBusy();
  const importText = () => run("t", async () => { setResult(await api.call("import", { content: text, name, format })); setText(""); changed(); });
  const importFile = () => {
    const f = fileRef.current?.files?.[0];
    if (!f) return;
    run("f", async () => { setResult(await api.uploadImport(f, { name, format })); fileRef.current.value = ""; changed(); });
  };
  return (
    <div className="space-y-5">
      <div className="page-head"><div className="min-w-0"><h1>{t("nav_share")}</h1><p className="help">{t("share_help")}</p></div></div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="panel space-y-3">
          <h2>{t("import_paste")}</h2>
          <textarea className="field" rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder={t("import_paste_ph")} aria-label={t("import_paste")} />
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label={t("name_if_team")}><input className="field" value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label={t("format_if_team")}><FormatSelect id="imp-format" value={format} onChange={setFormat} /></Field>
          </div>
          <Busy busy={busy.t} className="btn btn-primary" disabled={!text.trim()} onClick={importText}>{t("import")}</Busy>
        </div>
        <div className="panel space-y-3">
          <h2>{t("import_file")}</h2>
          <input ref={fileRef} type="file" className="field" accept=".hoardtrainer,.hoardgym,.hoardleague,.silverexercise,.html,.json,.txt,.sav,.srm" />
          <Busy busy={busy.f} className="btn btn-primary" onClick={importFile}><Icon d={ICONS.upload} size={14} /> {t("import")}</Busy>
          <p className="help">{t("import_file_help")}</p>
        </div>
      </div>
      <ResultView r={result} />
      <ExerciseLibrary/>
      <Section title={t("how_sharing_works")}>
        <div className="panel space-y-2 max-w-3xl">
          <p><b>{t("export_page")}.</b> {t("how_page")}</p>
          <p><b>{t("export_file")}.</b> {t("how_file")}</p>
          <p><b>{t("export_code")}.</b> {t("how_code")}</p>
          <p><b>{t("result_code")}.</b> {t("how_result")}</p>
        </div>
      </Section>
    </div>
  );
}
