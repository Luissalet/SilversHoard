// Badges earned here and by friends (through result codes), active challenges and the hall of fame.
// Also surfaces Pokéathlon medals, Frontier Brain emblems and Progress achievements without a second records page.
import React, { useMemo } from "react";
import { api } from "../api.js";
import { useApp } from "../context.js";
import { Busy, ErrorBox, Section, Spinner, useBusy, useLoad } from "../components/ui.jsx";
import { useCopilotRefresh } from "../components/hooks.js";
import { Avatar, GymBadge, MonIcon } from "../components/silver.jsx";
import { MedalBadge } from "../pokeathlon/parts.jsx";
import { loc } from "../loc.js";

const STAT_BITS = ["speed", "power", "skill", "stamina", "jump"];
const MEDAL_BITS = { speed: 1, power: 2, skill: 4, stamina: 8, jump: 16 };
const BRAIN_PRINT_AT = { tower: [21, 49], factory: [21, 49], arcade: [21, 49], castle: [21, 49], hall: [50, 170] };

function brainPrint(kind, number) {
  const pair = BRAIN_PRINT_AT[kind] || [21, 49];
  if (number === pair[1]) return "gold";
  if (number === pair[0]) return "silver";
  return "unknown";
}

function facilityKind(run) {
  const kind = run?.frontier?.kind || run?.challenger?.frontier?.kind || "";
  if (kind) return kind;
  const target = run?.target_id || "";
  return target.startsWith("facility:") ? target.slice(9) : (target || "facility");
}

/** Emblems from recorded boss wins only; a later loss does not remove one already earned. */
function frontierEmblemsFromRuns(runs) {
  const earned = new Map();
  for (const run of runs || []) {
    if (run.kind !== "facility") continue;
    const kind = facilityKind(run);
    for (const stage of run.stages || []) {
      if (!stage.boss || stage.result !== "won") continue;
      const number = Number(stage.number) || 0;
      const character = (stage.character || "").trim();
      const name = (stage.name || stage.name_en || "").trim();
      const print = brainPrint(kind, number);
      const id = `${kind}:${character || name || "brain"}:${print}:${number}`;
      if (earned.has(id)) continue;
      earned.set(id, {
        id, facility: kind, character, name, title: stage.title || stage.title_en || "",
        print, number, battle_id: stage.battle_id || "", run_id: run.id || "",
        challenger_name: run.challenger_name || "",
      });
    }
  }
  return [...earned.values()].sort((a, b) => a.facility.localeCompare(b.facility) || a.number - b.number);
}

function medalStats(mask) {
  return STAT_BITS.filter((k) => mask & MEDAL_BITS[k]);
}

export default function Medallas() {
  const { t, lang, go, changed } = useApp();
  const L = (es, en) => (lang === "en" ? en : es);
  const badges = useLoad(() => api.call("badges_list", {}), []);
  const runs = useLoad(() => api.call("challenges_list", {}), []);
  const hall = useLoad(() => api.call("hall_of_fame", {}), []);
  const pokeGuest = useLoad(() => api.call("pokeathlon_records", { trainer_id: "", recent: 0 }), []);
  const progressRank = useLoad(() => api.call("progress_list", {}), []);
  useCopilotRefresh(() => {
    badges.reload(); runs.reload(); hall.reload(); pokeGuest.reload(); progressRank.reload();
  });
  const [busy, run] = useBusy();
  const byPerson = {};
  for (const b of badges.data?.badges || []) (byPerson[b.challenger_name] ||= []).push(b);
  const emblems = useMemo(() => frontierEmblemsFromRuns(runs.data?.challenges || []), [runs.data]);
  const guestMedals = pokeGuest.data?.medals || [];
  const achievers = (progressRank.data?.trainers || []).filter((r) => r.unlocked > 0);
  const next = (r) => run(r.id, async () => { const x = await api.call("challenge_next", { id: r.id }); changed(); const cur = x.stages[x.step]; if (cur?.battle_id) go(`#/combate/${cur.battle_id}`); });
  const abandon = (r) => run(`a${r.id}`, async () => { await api.call("challenge_abandon", { id: r.id }); runs.reload(); });
  return (
    <div className="space-y-5">
      <div className="page-head"><div className="min-w-0"><h1>{t("nav_badges")}</h1><p className="help">{t("badges_help")} {L("También el Pokéathlon (invitado), emblemas de Cerebros ganados y logros de Progreso.", "Also the Pokéathlon (guest), earned Frontier Brain emblems and Progress achievements.")}</p></div></div>
      {badges.error && <ErrorBox error={badges.error} onRetry={badges.reload} />}
      <Section title={t("badge_cases")}>
        {!badges.data ? <Spinner /> : Object.keys(byPerson).length === 0 ? <p className="help">{t("no_badges")}</p> : (
          <div className="badge-cases">
            {Object.entries(byPerson).map(([name, list]) => (
              <div key={name} className="badge-case">
                <b>{name}</b>
                <div className="flex flex-wrap gap-2">
                  {list.map((b) => <a key={b.id} href={`#/gimnasio/${b.gym_id}`} className="badge-slot" title={`${loc(b, lang, "gym_name")} · ${b.source === "friend" ? t("from_friend") : t("here")}${b.proof?.verified ? ` · ${t("badge_verified")}` : ""}`}><GymBadge image={b.badge_image} color={b.badge_color} size={40} label={b.badge} /><span className="help trunc">{b.badge || b.gym_name}</span></a>)}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
      <Section title={t("challenges")} count={(runs.data?.challenges || []).length}>
        {!runs.data ? <Spinner /> : (runs.data.challenges || []).length === 0 ? <p className="help">{t("no_challenges")}</p> : (
          <div className="panel divide-list p-0">
            {runs.data.challenges.map((r) => (
              <div key={r.id} className="row-item">
                <Avatar url={r.challenger_avatar_url} name={r.challenger_name} size={30} />
                <span className="min-w-0 flex-1 trunc"><b>{r.challenger_name}</b> → {loc(r, lang, "target_name")} <span className="help">({r.kind === "facility" ? t("run_streak", { n: r.streak || 0 }) : `${r.stages.filter((s) => s.result === "won").length}/${r.stages.length}`})</span></span>
                <span className={`chip ${r.status === "won" ? "chip-ok" : r.status === "lost" ? "chip-danger" : "chip-accent"}`}>{t(`run_${r.status}`)}</span>
                {r.status === "active" && <Busy busy={busy[r.id]} className="btn btn-sm btn-primary" onClick={() => next(r)}>{t("continue")}</Busy>}
                {r.status === "active" && <Busy busy={busy[`a${r.id}`]} className="btn btn-sm" onClick={() => abandon(r)}>{t("abandon")}</Busy>}
              </div>
            ))}
          </div>
        )}
      </Section>
      <Section title={t("hall_of_fame")} count={(hall.data?.hall || []).length}>
        {!hall.data ? <Spinner /> : (hall.data.hall || []).length === 0 ? <p className="help">{t("hall_empty")}</p> : (
          <div className="hall-list">
            {hall.data.hall.map((h) => (
              <div key={h.id} className="hall-card"><b>{h.champion_name}</b><span className="help">{h.league_name} · {new Date(h.earned_at * 1000).toLocaleDateString()}</span>
                <div className="flex flex-wrap gap-1">{(h.team || []).map((m, i) => <MonIcon key={i} species={m.species} size={40} />)}</div></div>
            ))}
          </div>
        )}
      </Section>

      <Section title={L("Pokéathlon (invitado)", "Pokéathlon (guest)")} count={guestMedals.length}>
        {pokeGuest.error && <ErrorBox error={pokeGuest.error} onRetry={pokeGuest.reload} />}
        {!pokeGuest.data ? <Spinner /> : guestMedals.length === 0 ? (
          <p className="help">{L("Aún no hay medallas del invitado. Las de cada entrenador siguen en Pokéathlon → Récords.", "No guest medals yet. Each trainer's stay on Pokéathlon → Records.")}</p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {guestMedals.map((m) => (
              <div key={m.species} className="panel flex items-center gap-2" title={m.species}>
                <MonIcon species={m.species} size={36} />
                <span className="help trunc">{m.species}</span>
                <span className="flex gap-1">{medalStats(m.mask).map((stat) => <MedalBadge key={stat} stat={stat} size={28} />)}</span>
                {m.complete && <span className="chip chip-ok">{L("completo", "complete")}</span>}
              </div>
            ))}
          </div>
        )}
        <p className="help mt-2"><a href="#/pokeathlon">{L("Abrir Pokéathlon / Récords", "Open Pokéathlon / Records")}</a></p>
      </Section>

      <Section title={L("Emblemas de la Frontera", "Frontier emblems")} count={emblems.length}>
        {runs.error && <ErrorBox error={runs.error} onRetry={runs.reload} />}
        {!runs.data ? <Spinner /> : emblems.length === 0 ? (
          <p className="help">{L("Ningún emblema: hace falta una victoria pública contra un Cerebro (no basta la racha).", "No emblems: a public win against a Frontier Brain is required (streak length alone is not enough).")}</p>
        ) : (
          <div className="panel divide-list p-0">
            {emblems.map((e) => (
              <div key={e.id} className="row-item">
                <span className={`chip ${e.print === "gold" ? "chip-accent" : "chip-ok"}`}>{e.print}</span>
                <span className="min-w-0 flex-1 trunc">
                  <b>{e.name || e.character || e.facility}</b>
                  <span className="help"> · {e.facility} #{e.number}{e.challenger_name ? ` · ${e.challenger_name}` : ""}</span>
                </span>
                {e.battle_id && <a className="btn btn-sm" href={`#/combate/${e.battle_id}`}>{L("Combate", "Battle")}</a>}
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title={L("Logros (Progreso)", "Achievements (Progress)")} count={achievers.length}>
        {progressRank.error && <ErrorBox error={progressRank.error} onRetry={progressRank.reload} />}
        {!progressRank.data ? <Spinner /> : achievers.length === 0 ? (
          <p className="help">{L("Nadie tiene logros desbloqueados todavía.", "Nobody has unlocked achievements yet.")}</p>
        ) : (
          <div className="panel divide-list p-0">
            {achievers.map((r) => (
              <a key={r.trainer_id} href="#/progreso" className="row-item" onClick={() => { try { localStorage.setItem("silver-progress-trainer", JSON.stringify(r.trainer_id)); } catch (_) { /* ignore */ } }}>
                <Avatar url={r.avatar_url} name={r.name} size={30} />
                <span className="min-w-0 flex-1 trunc"><b>{r.name}</b> <span className="help">{L(`${r.unlocked} logros`, `${r.unlocked} unlocked`)}</span></span>
              </a>
            ))}
          </div>
        )}
        <p className="help mt-2"><a href="#/progreso">{L("Abrir Progreso", "Open Progress")}</a></p>
      </Section>
    </div>
  );
}
