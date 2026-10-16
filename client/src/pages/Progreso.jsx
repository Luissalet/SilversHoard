// Progress: each trainer's record, streaks, MVPs, achievements and Pokédex (the species it used, saw and knocked out), worked out
// from its stored battles, challenges and facility streaks; with no trainer picked, every own trainer ranked by wins.
import React, { useState } from "react";
import { api } from "../api.js";
import { useApp } from "../context.js";
import { ErrorBox, Section, Spinner, useLoad, useStored } from "../components/ui.jsx";
import { useContextProvider } from "../components/hooks.js";
import { Avatar, MonIcon, TrainerSelect } from "../components/silver.jsx";
import { L, nameOf } from "../battle/dex.js";
import { loc } from "../loc.js";

const S = {
  title: ["Progreso", "Progress"],
  intro: ["Récords, rachas, Pokémon estrella, logros y Pokédex de cada entrenador, sacados de sus combates, retos e instalaciones.",
    "Records, streaks, star Pokémon, achievements and Pokédex of each trainer, from its battles, challenges and facilities."],
  trainer: ["Entrenador", "Trainer"],
  ranking: ["Clasificación", "Ranking"],
  battles: ["Combates", "Battles"],
  wins: ["Victorias", "Wins"],
  losses: ["Derrotas", "Losses"],
  ties: ["Empates", "Ties"],
  rate: ["Porcentaje", "Win rate"],
  kos: ["K.O.", "KOs"],
  streak: ["Racha actual", "Current streak"],
  best: ["Mejor racha", "Best streak"],
  last: ["Últimos combates", "Last battles"],
  by_kind: ["Por tipo de combate", "By kind of battle"],
  mvp: ["Pokémon estrella", "Star Pokémon"],
  achievements: ["Logros", "Achievements"],
  unlocked: ["{n} de {m}", "{n} of {m}"],
  dex: ["Pokédex", "Pokédex"],
  used: ["Usados ({n})", "Used ({n})"],
  beaten: ["Debilitados ({n})", "Knocked out ({n})"],
  seen: ["Vistos ({n})", "Seen ({n})"],
  facilities: ["Instalaciones", "Facilities"],
  badges: ["Medallas", "Badges"],
  hall: ["Hall de la Fama", "Hall of fame"],
  none: ["Todavía no hay combates.", "No battles yet."],
  battles_n: ["{n} combates", "{n} battles"],
  kos_n: ["{n} K.O.", "{n} KOs"],
  win: ["V", "W"], loss: ["D", "L"], tie: ["E", "T"],
  kind_play: ["Contra la IA", "Against the AI"], kind_watch: ["IA contra IA", "AI vs AI"], kind_gym: ["Gimnasio", "Gym"], kind_league: ["Liga", "League"],
  kind_facility: ["Instalación", "Facility"], kind_friend: ["Amigos", "Friends"], kind_hotseat: ["Dos personas", "Two people"],
};
const fill = (text, vars = {}) => text.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ""));

function Ranking({ s, onPick }) {
  const { data, error, loading, reload } = useLoad(() => api.call("progress_list", {}), []);
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (loading && !data) return <Spinner />;
  return (
    <Section title={s("ranking")}>
      <div className="overflow-x-auto">
        <table className="tbl w-full">
          <thead><tr><th>{s("trainer")}</th><th className="r">{s("wins")}</th><th className="r">{s("losses")}</th><th className="r">{s("rate")}</th>
            <th className="r">{s("best")}</th><th className="r">{s("facilities")}</th><th className="r">{s("badges")}</th><th className="r">{s("achievements")}</th></tr></thead>
          <tbody>
            {(data?.trainers || []).map((r) => (
              <tr key={r.trainer_id} className="cursor-pointer" onClick={() => onPick(r.trainer_id)}>
                <td><span className="flex items-center gap-2"><Avatar url={r.avatar_url} name={r.name} size={28} /> {r.name}</span></td>
                <td className="r num">{r.record.wins}</td><td className="r num">{r.record.losses}</td><td className="r num">{Math.round(r.win_rate * 100)} %</td>
                <td className="r num">{r.best_streak}</td><td className="r num">{r.facility_best}</td><td className="r num">{r.badges}</td>
                <td className="r num">{r.unlocked}/{r.achievements}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function Stat({ label, value }) {
  return <div className="panel stat-tile"><div className="help">{label}</div><b className="num text-[22px]">{value}</b></div>;
}

export default function Progreso() {
  const { lang, t } = useApp();
  const s = (k, v) => fill(L(S[k], lang), v);
  const [trainerId, setTrainerId] = useStored("silver-progress-trainer", "");
  const [dexTab, setDexTab] = useState("used");
  const { data: p, error, loading, reload } = useLoad(() => (trainerId ? api.call("progress_get", { trainer_id: trainerId }) : Promise.resolve(null)), [trainerId]);
  const { data: fac } = useLoad(() => api.call("facilities_list", {}), []);
  useContextProvider(() => ({ kind: "progress", title: s("title"), fields: { trainer_id: trainerId, wins: p?.record?.wins, unlocked: p?.unlocked } }));
  const facName = (id) => { const f = (fac?.facilities || []).find((x) => x.id === id); return f ? (lang === "en" ? f.name : f.name_es) : id; };
  return (
    <div className="space-y-4">
      <div className="page-head"><div className="min-w-0"><h1>{s("title")}</h1><p className="help">{s("intro")}</p></div></div>
      <div className="max-w-md"><TrainerSelect value={trainerId} onChange={setTrainerId} label={s("trainer")} allowNone /></div>
      {!trainerId && <Ranking s={s} onPick={setTrainerId} />}
      {trainerId && error && <ErrorBox error={error} onRetry={reload} />}
      {trainerId && loading && !p && <Spinner />}
      {trainerId && p && (
        <>
          <div className="flex items-center gap-3">
            <Avatar url={p.avatar_url} name={loc(p, lang)} size={72} />
            <div><h2>{loc(p, lang)}</h2><div className="help">{s("battles_n", { n: p.record.battles })} · {s("kos_n", { n: p.record.kos })}</div></div>
          </div>
          {!p.record.battles && <p className="help">{s("none")}</p>}
          <div className="grid gap-2 grid-cols-2 sm:grid-cols-4 lg:grid-cols-7">
            <Stat label={s("wins")} value={p.record.wins} /><Stat label={s("losses")} value={p.record.losses} /><Stat label={s("ties")} value={p.record.ties} />
            <Stat label={s("rate")} value={`${Math.round(p.win_rate * 100)} %`} /><Stat label={s("streak")} value={p.streaks.current} />
            <Stat label={s("best")} value={p.streaks.best} /><Stat label={s("kos")} value={p.record.kos} />
          </div>
          {p.streaks.last.length > 0 && (
            <div className="flex flex-wrap items-center gap-1"><span className="help">{s("last")}:</span>
              {p.streaks.last.map((r, i) => <span key={i} className={`chip ${r === "win" ? "chip-ok" : r === "loss" ? "chip-danger" : ""}`}>{s(r)}</span>)}
            </div>
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            <Section title={s("by_kind")}>
              <table className="tbl w-full"><tbody>
                {Object.entries(p.by_kind).map(([k, v]) => (
                  <tr key={k}><td>{S[`kind_${k}`] ? s(`kind_${k}`) : k}</td><td className="r num">{v.wins} – {v.losses}{v.ties ? ` – ${v.ties}` : ""}</td></tr>
                ))}
                <tr><td>{s("badges")}</td><td className="r num">{p.challenges.badges}</td></tr>
                <tr><td>{s("hall")}</td><td className="r num">{p.challenges.hall}</td></tr>
                {Object.entries(p.facilities.per_facility).map(([id, n]) => <tr key={id}><td>{facName(id)}</td><td className="r num">{n}</td></tr>)}
              </tbody></table>
            </Section>
            <Section title={s("mvp")}>
              <table className="tbl w-full"><tbody>
                {p.mvp.map((m) => (
                  <tr key={m.species}>
                    <td><span className="flex items-center gap-2"><MonIcon species={m.species} size={32} /> {nameOf("species", m.species, lang)}</span></td>
                    <td className="r num">{s("kos_n", { n: m.kos })}</td><td className="r num help">{s("battles_n", { n: m.battles })}</td>
                  </tr>
                ))}
              </tbody></table>
            </Section>
          </div>
          <Section title={s("achievements")} count={s("unlocked", { n: p.unlocked, m: p.achievements.length })}>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {p.achievements.map((a) => (
                <div key={a.id} className={`panel achievement ${a.unlocked ? "is-on" : ""}`}>
                  <b>{lang === "en" ? a.name : a.name_es}</b>
                  <div className="help">{lang === "en" ? a.desc : a.desc_es}</div>
                </div>
              ))}
            </div>
          </Section>
          <Section title={s("dex")}>
            <div className="seg mb-2" role="group">
              {["used", "beaten", "seen"].map((k) => <button key={k} type="button" aria-pressed={dexTab === k} onClick={() => setDexTab(k)}>{s(k, { n: p.pokedex[k].length })}</button>)}
            </div>
            <div className="dex-grid">
              {/* knocked out: every species seen, the ones still to knock out as silhouettes */}
              {(dexTab === "beaten" ? p.pokedex.seen : p.pokedex[dexTab]).map((sp) => {
                const shadow = dexTab === "beaten" && !p.pokedex.beaten.includes(sp);
                return (
                  <span key={sp} className="dex-cell" title={shadow ? `${nameOf("species", sp, lang)} · ${t("dex_shadow")}` : nameOf("species", sp, lang)}
                    style={shadow ? { filter: "brightness(0)", opacity: 0.45 } : undefined}><MonIcon species={sp} size={40} /></span>
                );
              })}
            </div>
          </Section>
        </>
      )}
    </div>
  );
}
