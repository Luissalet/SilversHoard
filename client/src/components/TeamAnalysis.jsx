import React, { useMemo, useState } from "react";
import { api } from "../api.js";
import { useApp } from "../context.js";
import { nameOf, typeName } from "../battle/dex.js";
import { Busy, ErrorBox } from "./ui.jsx";
import "../team-analysis.css";

const factor = (n) => n === null ? "—" : n === 0 ? "0×" : n === 0.25 ? "¼×" : n === 0.5 ? "½×" : `${n}×`;

export default function TeamAnalysis({ sets, format }) {
  const { t, lang } = useApp();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [view, setView] = useState("defence");
  const key = useMemo(() => JSON.stringify({ team: sets, format: format || "gen9nationaldexag" }), [sets, format]);
  const data = result?.key === key ? result.data : null;
  async function analyse() {
    setBusy(true); setError(null);
    try { setResult({ key, data: await api.call("team_analysis", JSON.parse(key)) }); }
    catch (e) { setError(e); }
    finally { setBusy(false); }
  }
  const label = (m) => m.name !== m.species ? m.name : nameOf("species", m.species, lang);
  const excluded = data?.members.flatMap((m) => m.excluded_moves.map((move) => ({ ...move, member: label(m), index: m.index }))) || [];
  return (
    <details className="panel team-analysis" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{t("ta_title")}</summary>
      {open && <div className="ta-body">
        <p className="help">{t("ta_help")}</p>
        <div className="ta-actions">
          <Busy className="btn" busy={busy} disabled={!sets.length} onClick={analyse}>{t(data ? "ta_refresh" : "ta_analyse")}</Busy>
          {!sets.length && <span className="help">{t("ta_empty")}</span>}
          {result && !data && <span className="help" role="status">{t("ta_changed")}</span>}
        </div>
        <ErrorBox error={error} onRetry={analyse} />
        {data && <>
          <p className="ta-scope">{t("ta_scope", { gen: data.gen })}</p>
          <div className="ta-findings">
            <div><b>{t("ta_shared")}</b><p>{data.shared_weaknesses.length ? data.shared_weaknesses.map((row) => `${typeName(row.type, lang)} (${row.weak.length})`).join(" · ") : t("ta_no_shared")}</p></div>
            <div><b>{t("ta_gaps")}</b><p>{data.uncovered_types.length ? data.uncovered_types.map((type) => typeName(type, lang)).join(" · ") : t("ta_no_gaps")}</p></div>
          </div>
          <div className="seg" role="group" aria-label={t("ta_matrix")}>
            <button type="button" aria-pressed={view === "defence"} onClick={() => setView("defence")}>{t("ta_defence")}</button>
            <button type="button" aria-pressed={view === "coverage"} onClick={() => setView("coverage")}>{t("ta_coverage")}</button>
          </div>
          <p className="help">{t(view === "defence" ? "ta_defence_help" : "ta_coverage_help")}</p>
          <div className="ta-scroll" tabIndex={0} role="region" aria-label={t(view === "defence" ? "ta_defence" : "ta_coverage")}>
            <table className="ta-table">
              <caption className="sr-only">{t(view === "defence" ? "ta_defence_help" : "ta_coverage_help")}</caption>
              <thead><tr><th scope="col">{t(view === "defence" ? "ta_incoming" : "ta_target")}</th>
                {data.members.map((m) => <th scope="col" key={m.index}><span>{label(m)}</span><small>{m.types.map((type) => typeName(type, lang)).join(" / ")}</small></th>)}
                <th scope="col">{t(view === "defence" ? "ta_weak_count" : "ta_cover_count")}</th>
              </tr></thead>
              <tbody>{data.types.map((type) => <tr key={type}>
                <th scope="row">{typeName(type, lang)}</th>
                {data.members.map((m) => {
                  const n = m[view][type];
                  return <td key={m.index} className={n === null ? "" : n === 0 ? "ta-zero" : n > 1 ? (view === "defence" ? "ta-weak" : "ta-strong") : n < 1 ? (view === "defence" ? "ta-strong" : "ta-weak") : ""}>
                    <span>{factor(n)}</span>
                  </td>;
                })}
                <td className="ta-count">{view === "defence" ? data.defence.find((row) => row.type === type).weak.length : data.coverage.find((row) => row.type === type).super_effective.length}</td>
              </tr>)}</tbody>
            </table>
          </div>
          <h3>{t("ta_speed")}</h3>
          <p className="help">{t("ta_speed_help")}</p>
          <ol className="ta-speed">{data.speed_order.map((index) => {
            const m = data.members[index];
            return <li key={index}><span>{label(m)} <small className="help">{t("ta_level", { n: m.level })}</small></span><b className="num">{m.speed}</b></li>;
          })}</ol>
          {excluded.length > 0 && <details className="ta-excluded"><summary>{t("ta_excluded", { n: excluded.length })}</summary>
            <ul>{excluded.map((move, i) => <li key={`${move.index}-${move.id}-${i}`}><b>{nameOf("move", move.name, lang)}</b> · {move.member}: {t(`ta_reason_${move.reason}`)}</li>)}</ul>
          </details>}
        </>}
      </div>}
    </details>
  );
}
