// The friends' league (points from the results friends bring back, by month) and the vote that picks the rule of the week's
// challenge (silvers_hoard/friends.py). Shown on the Friends page.
import React, { useState } from "react";
import { api } from "../api.js";
import { useApp } from "../context.js";
import { Busy, Field, Section, Spinner, useBusy, useLoad } from "../components/ui.jsx";

function CopyLink({ url, t }) {
  const [done, setDone] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(url); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* select by hand */ } };
  return (
    <div className="flex items-center gap-2 min-w-0">
      <input className="field font-mono text-xs flex-1 min-w-0" readOnly value={url} onFocus={(e) => e.target.select()} aria-label={t("poll_link")} />
      <button type="button" className="btn btn-sm" onClick={copy}>{done ? t("copied") : t("copy")}</button>
    </div>
  );
}

export function League() {
  const { t, notify } = useApp();
  const [season, setSeason] = useState("");
  const lg = useLoad(() => api.call("friends_league", { season }), [season]);
  const [busy, run] = useBusy();
  const exportIt = () => run("x", async () => {
    const out = await api.call("friends_league_export", { season });
    notify(t("league_exported", { file: out.file }));
    window.open(out.url, "_blank", "noopener");
  });
  const d = lg.data;
  return (
    <Section title={t("league_title")} actions={d && (
      <div className="flex flex-wrap items-center gap-2">
        <select className="field w-auto" value={season || d.current} aria-label={t("league_season")} onChange={(e) => setSeason(e.target.value === d.current ? "" : e.target.value)}>
          {d.seasons.map((s) => <option key={s} value={s}>{s === d.current ? t("league_this_month", { s }) : s}</option>)}
          <option value="all">{t("league_all")}</option>
        </select>
        <Busy busy={busy.x} className="btn btn-sm" onClick={exportIt}>{t("league_export")}</Busy>
      </div>
    )}>
      <p className="help">{t("league_help", d?.points || { win: 3, verified: 1, battle: 1, weekly: 1 })}</p>
      {!d ? <Spinner /> : d.standings.length === 0 ? <p className="help">{t("league_empty")}</p> : (
        <div className="panel p-0 overflow-x-auto">
          <table className="lg-table">
            <thead><tr><th>#</th><th>{t("league_friend")}</th><th className="num">{t("league_points")}</th><th className="num">{t("league_wins")}</th>
              <th className="num">{t("league_verified")}</th><th className="num">{t("league_played")}</th><th className="num">{t("league_weekly")}</th></tr></thead>
            <tbody>
              {d.standings.map((e) => (
                <tr key={e.challenger}>
                  <td className={`lb-rank ${e.rank <= 3 ? `lb-top lb-top-${e.rank}` : ""}`}>{e.rank}</td><td><b>{e.challenger}</b></td><td className="num"><b>{e.points}</b></td>
                  <td className="num">{e.wins}</td><td className="num">{e.verified_wins}</td><td className="num">{e.played}</td><td className="num">{e.weekly}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

export function WeekVote() {
  const { t, lang, confirm } = useApp();
  const data = useLoad(() => api.call("poll_get", {}), []);
  const [kind, setKind] = useState("pokemon");
  const [text, setText] = useState("");
  const [rules, setRules] = useState([]);
  const [busy, run] = useBusy();
  const d = data.data;
  const open = () => run("open", async () => {
    const options = kind === "rule" ? rules : text.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean);
    await api.call("poll_open", { kind, options });
    setText(""); setRules([]);
    data.reload();
  });
  const close = (p) => run(p.id, async () => { await api.call("poll_close", { id: p.id }); data.reload(); });
  const clear = (week) => run(`c${week}`, async () => {
    if (!(await confirm({ title: t("poll_clear"), message: t("poll_clear_q", { week }), confirmLabel: t("poll_clear") }))) return;
    await api.call("week_rule_clear", { week }); data.reload();
  });
  const label = (o, k) => (k === "rule" ? (lang === "es" ? o.label_es : o.label_en) || o.value : o.value);
  const rule = d?.week_rules?.[d.current_week];
  return (
    <Section title={t("poll_title")}>
      <p className="help">{t("poll_help")}</p>
      {rule && (
        <div className="banner banner-info flex flex-wrap items-center gap-2">
          <span>{t(rule.kind === "pokemon" ? "poll_rule_pokemon" : "poll_rule_rule", { week: d.current_week, value: rule.value })}</span>
          <Busy busy={busy[`c${d.current_week}`]} className="btn btn-sm" onClick={() => clear(d.current_week)}>{t("poll_clear")}</Busy>
        </div>
      )}
      <div className="panel space-y-3">
        <div className="seg" role="group" aria-label={t("poll_kind")}>
          {["pokemon", "rule"].map((k) => <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>{t(`poll_kind_${k}`)}</button>)}
        </div>
        {kind === "pokemon" ? (
          <Field label={t("poll_options")}><textarea className="field" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Pikachu, Garchomp, Gengar" /></Field>
        ) : (
          <div className="flex flex-wrap gap-2">
            {(d?.rules || []).map((r) => (
              <label key={r.value} className="chip flex items-center gap-1">
                <input type="checkbox" checked={rules.includes(r.value)} onChange={(e) => setRules((x) => (e.target.checked ? [...x, r.value] : x.filter((v) => v !== r.value)))} />
                {lang === "es" ? r.label_es : r.label_en}
              </label>
            ))}
          </div>
        )}
        <Busy busy={busy.open} className="btn btn-primary" onClick={open} disabled={kind === "rule" ? rules.length < 2 : !text.trim()}>{t("poll_open")}</Busy>
      </div>
      {!d ? <Spinner /> : d.polls.map((p) => (
        <div key={p.id} className="panel space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <b>{t("poll_week", { week: p.week })}</b>
            <span className={`chip ${p.status === "open" ? "chip-accent" : "chip-ok"}`}>{p.status === "open" ? t("poll_status_open") : t("poll_winner", { value: label({ value: p.winner, ...(p.options.find((o) => o.value === p.winner) || {}) }, p.kind) })}</span>
            <span className="help">{t("poll_votes", { n: p.votes })}</span>
          </div>
          <div className="space-y-1">
            {p.options.map((o) => (
              <div key={o.value} className="poll-bar"><span className="trunc">{label(o, p.kind)}</span><i style={{ width: `${p.votes ? (o.votes / p.votes) * 100 : 0}%` }} /><b className="num">{o.votes}</b></div>
            ))}
          </div>
          {p.status === "open" && (
            <>
              {(p.links?.lan || []).map((u) => <CopyLink key={u} url={u} t={t} />)}
              {p.links?.public && <CopyLink url={p.links.public} t={t} />}
              {p.voters?.length > 0 && <p className="help">{t("poll_voters", { list: p.voters.join(", ") })}</p>}
              <Busy busy={busy[p.id]} className="btn btn-sm" onClick={() => close(p)} disabled={!p.votes}>{t("poll_close")}</Busy>
            </>
          )}
        </div>
      ))}
    </Section>
  );
}
