// The in-game teams of the leaders, Elite Four, champions, rivals and bosses (Crystal, FireRed/LeafGreen, Emerald): add one
// trainer, or a whole league with its gyms and badges.
import React, { useState } from "react";
import { api } from "../api.js";
import { useApp } from "../context.js";
import { Busy, ErrorBox, Section, Spinner, useBusy, useLoad, useStored } from "../components/ui.jsx";
import { Avatar, GymBadge, TeamStrip } from "../components/silver.jsx";
import { TYPE_COLORS } from "../battle/dex.js";

export default function Personajes() {
  const { t, lang, notify, changed, go } = useApp();
  const [q, setQ] = useState("");
  const [region, setRegion] = useStored("silver-canon-region", "");
  const { data, error, loading, reload } = useLoad(() => api.call("canon_list", { query: q, region }), [q, region]);
  const [busy, run] = useBusy();
  const installTrainer = (key) => run(key, async () => { const r = await api.call("canon_install", { trainer_key: key }); notify(t("installed")); changed(); reload(); return r; });
  const installLeague = (key) => run(key, async () => { const r = await api.call("canon_install", { league_key: key }); notify(t("league_installed")); changed(); go(`#/liga/${r.league.id}`); });
  const groups = {};
  for (const tr of data?.trainers || []) (groups[`${tr.game} · ${tr.region}`] ||= []).push(tr);
  return (
    <div className="space-y-5">
      <div className="page-head">
        <div className="min-w-0"><h1>{t("nav_canon")}</h1><p className="help">{t("canon_help")}</p></div>
      </div>
      <Section title={t("leagues_ready")}>
        <div className="league-list">
          {(data?.leagues || []).map((lg) => (
            <div key={lg.key} className="league-card">
              <div className="min-w-0 flex-1 space-y-2">
                <div><b className="text-[16px]">{lang === "en" ? lg.name : lg.name_es}</b><div className="help">{lg.game} · {lg.region}</div></div>
                <div className="flex flex-wrap gap-1">{lg.gyms.map((g) => <GymBadge key={g.leader} color={TYPE_COLORS[g.type] || "#c0c0c0"} size={26} label={lang === "en" ? g.badge : g.badge_es} />)}</div>
              </div>
              {lg.installed_id ? <a className="btn" href={`#/liga/${lg.installed_id}`}>{t("open")}</a>
                : <Busy busy={busy[lg.key]} className="btn btn-primary" onClick={() => installLeague(lg.key)}>{t("install_league")}</Busy>}
            </div>
          ))}
        </div>
      </Section>
      <div className="flex flex-wrap items-center gap-2">
        <input className="field max-w-xs" placeholder={t("search_canon")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("search_canon")} />
        <div className="seg" role="group">{["", "Kanto", "Johto", "Hoenn"].map((r) => <button key={r} type="button" aria-pressed={region === r} onClick={() => setRegion(r)}>{r || t("all")}</button>)}</div>
      </div>
      {error && <ErrorBox error={error} onRetry={reload} />}
      {loading && !data ? <Spinner /> : Object.entries(groups).map(([g, list]) => (
        <Section key={g} title={g} count={list.length}>
          <div className="trainer-grid">
            {list.map((tr) => (
              <div key={tr.key} className="trainer-card">
                <Avatar url={tr.avatar_url} name={tr.name} size={72} />
                <div className="min-w-0 flex-1 space-y-1">
                  <b className="trunc block">{lang === "en" ? tr.name : tr.name_es}{tr.variant ? <span className="help"> · {lang === "en" ? tr.variant : tr.variant_es || tr.variant}</span> : null}</b>
                  <div className="help">{lang === "en" ? tr.class : tr.class_es} · {t("lv")} {Math.max(...tr.levels)}{tr.double ? ` · ${t("doubles")}` : ""}</div>
                  <TeamStrip species={tr.species} size={28} />
                  {tr.installed_id ? <a className="btn btn-sm" href={`#/entrenador/${tr.installed_id}`}>{t("open")}</a>
                    : <Busy busy={busy[tr.key]} className="btn btn-sm" onClick={() => installTrainer(tr.key)}>{t("add_trainer")}</Busy>}
                </div>
              </div>
            ))}
          </div>
        </Section>
      ))}
      <p className="help">{data?.source}</p>
    </div>
  );
}
