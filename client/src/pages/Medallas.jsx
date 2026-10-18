// Badges earned here and by friends (through result codes), active challenges and the hall of fame.
// Also surfaces Pokéathlon medals, Frontier Brain emblems and Progress achievements without a second records page.
import React, { useMemo } from "react";
import { api } from "../api.js";
import { useApp } from "../context.js";
import { Busy, ErrorBox, Section, Spinner, useBusy, useLoad, useStored } from "../components/ui.jsx";
import { useCopilotRefresh } from "../components/hooks.js";
import { Avatar, GymBadge, MonIcon, TrainerSelect } from "../components/silver.jsx";
import { MedalBadge } from "../pokeathlon/parts.jsx";
import { loc } from "../loc.js";

const STAT_BITS = ["speed", "power", "skill", "stamina", "jump"];
const MEDAL_BITS = { speed: 1, power: 2, skill: 4, stamina: 8, jump: 16 };
// Facility-id and character maps mirror silvers_hoard/palmares.py (from facilities.FACILITIES).
const PRINT_AT_FACILITY = {
  tower3: { 35: "silver", 70: "gold" },
  tower4: { 21: "silver", 49: "gold" },
  tower: { 21: "silver", 49: "gold" },
  factory: { 21: "silver", 49: "gold" },
  factory4: { 21: "silver", 49: "gold" },
  arcade: { 21: "silver", 49: "gold" },
  arcade4: { 21: "silver", 49: "gold" },
  castle: { 21: "silver", 49: "gold" },
  castle4: { 21: "silver", 49: "gold" },
  hall: { 50: "silver", 170: "gold" },
  hall4: { 50: "silver", 170: "gold" },
};
const PRINT_AT_CHARACTER = {
  anabel: { 35: "silver", 70: "gold" },
  palmer: { 21: "silver", 49: "gold" },
  argenta: { 50: "silver", 170: "gold" },
};

function brainPrint(kind, number, character) {
  const byKind = PRINT_AT_FACILITY[kind];
  if (byKind && byKind[number]) return byKind[number];
  const byChar = character && PRINT_AT_CHARACTER[character];
  if (byChar && byChar[number]) return byChar[number];
  return "unknown";
}

function facilityKind(run) {
  const target = run?.target_id || "";
  if (target.startsWith("facility:")) return target.slice(9);
  if (target) return target;
  return run?.frontier?.kind || run?.challenger?.frontier?.kind || "facility";
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
      const print = brainPrint(kind, number, character);
      // Include challenger_id so two trainers who beat the same Brain keep distinct emblems.
      const cid = run.challenger_id || "";
      const id = `${cid}:${kind}:${character || name || "brain"}:${print}:${number}`;
      if (earned.has(id)) continue;
      earned.set(id, {
        id, facility: kind, character, name, title: stage.title || stage.title_en || "",
        print, number, battle_id: stage.battle_id || "", run_id: run.id || "",
        challenger_id: cid,
        challenger_name: run.challenger_name || "",
      });
    }
  }
  return [...earned.values()].sort((a, b) => a.facility.localeCompare(b.facility) || a.number - b.number || a.id.localeCompare(b.id));
}

function medalStats(mask) {
  return STAT_BITS.filter((k) => mask & MEDAL_BITS[k]);
}

export default function Medallas() {
  const { t, lang, go, changed } = useApp();
  // "" = Pokéathlon guest; a trainer id never merges guest medals (server filters by trainer_id).
  const [personId, setPersonId] = useStored("silver-palmares-person", "");
  const badges = useLoad(() => api.call("badges_list", {}), []);
  const runs = useLoad(() => api.call("challenges_list", {}), []);
  const hall = useLoad(() => api.call("hall_of_fame", {}), []);
  // Unified medals / Frontier emblems / Progress achievements (guest vs trainer; server filters before dedup).
  const card = useLoad(() => api.call("palmares_get", { trainer_id: personId || "" }), [personId]);
  useCopilotRefresh(() => {
    badges.reload(); runs.reload(); hall.reload(); card.reload();
  });
  const [busy, run] = useBusy();
  const byPerson = {};
  for (const b of badges.data?.badges || []) (byPerson[b.challenger_name] ||= []).push(b);
  // Prefer API; fall back to client-side derivation (same filter-before-dedup rules) if palmares_get is unavailable.
  const emblems = useMemo(() => {
    if (card.data?.frontier_emblems) return card.data.frontier_emblems;
    const list = runs.data?.challenges || [];
    const scoped = personId ? list.filter((r) => r.challenger_id === personId) : list;
    return frontierEmblemsFromRuns(scoped);
  }, [card.data, runs.data, personId]);
  const medals = card.data?.pokeathlon_medals || [];
  const achievements = (card.data?.achievements || []).filter((a) => a.unlocked);
  const next = (r) => run(r.id, async () => { const x = await api.call("challenge_next", { id: r.id }); changed(); const cur = x.stages[x.step]; if (cur?.battle_id) go(`#/combate/${cur.battle_id}`); });
  const abandon = (r) => run(`a${r.id}`, async () => { await api.call("challenge_abandon", { id: r.id }); runs.reload(); });
  return (
    <div className="space-y-5">
      <div className="page-head"><div className="min-w-0"><h1>{t("nav_badges")}</h1><p className="help">{t("badges_help")} {t("palmares_help_extra")}</p></div></div>
      <div className="max-w-md">
        <TrainerSelect value={personId} onChange={setPersonId} label={t("palmares_person")} allowNone />
        <p className="help mt-1">{personId ? t("palmares_person_help_trainer") : t("palmares_person_help_guest")}</p>
      </div>
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

      <Section title={personId ? t("palmares_pokeathlon_trainer") : t("palmares_pokeathlon_guest")} count={medals.length}>
        {card.error && <ErrorBox error={card.error} onRetry={card.reload} />}
        {!card.data ? <Spinner /> : medals.length === 0 ? (
          <p className="help">{t("palmares_pokeathlon_empty")}</p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {medals.map((m) => (
              <div key={m.species} className="panel flex items-center gap-2" title={m.species}>
                <MonIcon species={m.species} size={36} />
                <span className="help trunc">{m.species}</span>
                <span className="flex gap-1">{medalStats(m.mask).map((stat) => <MedalBadge key={stat} stat={stat} size={28} />)}</span>
                {m.complete && <span className="chip chip-ok">{t("palmares_complete")}</span>}
              </div>
            ))}
          </div>
        )}
        <p className="help mt-2"><a href="#/pokeathlon">{t("palmares_open_pokeathlon")}</a></p>
      </Section>

      <Section title={t("palmares_frontier_emblems")} count={emblems.length}>
        {card.error && !card.data && <ErrorBox error={card.error} onRetry={card.reload} />}
        {!card.data && !runs.data ? <Spinner /> : emblems.length === 0 ? (
          <p className="help">{t("palmares_frontier_empty")}</p>
        ) : (
          <div className="panel divide-list p-0">
            {emblems.map((e) => (
              <div key={e.id} className="row-item">
                <span className={`chip ${e.print === "gold" ? "chip-accent" : "chip-ok"}`}>
                {e.print === "gold" ? t("palmares_print_gold") : e.print === "silver" ? t("palmares_print_silver") : t("palmares_print_unknown")}
              </span>
                <span className="min-w-0 flex-1 trunc">
                  <b>{e.name || e.character || e.facility}</b>
                  <span className="help"> · {e.facility} #{e.number}{e.challenger_name ? ` · ${e.challenger_name}` : ""}</span>
                </span>
                {e.battle_id && <a className="btn btn-sm" href={`#/combate/${e.battle_id}`}>{t("palmares_battle")}</a>}
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title={t("palmares_achievements")} count={personId ? achievements.length : undefined}>
        {!personId ? (
          <p className="help">{t("palmares_achievements_pick")} <a href="#/progreso">{t("palmares_open_progress")}</a></p>
        ) : card.error ? <ErrorBox error={card.error} onRetry={card.reload} />
          : !card.data ? <Spinner />
            : achievements.length === 0 ? <p className="help">{t("palmares_achievements_empty")}</p>
              : (
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {achievements.map((a) => (
                    <div key={a.id} className="panel achievement is-on">
                      <b>{lang === "en" ? a.name : a.name_es}</b>
                      <div className="help">{lang === "en" ? a.desc : a.desc_es}</div>
                    </div>
                  ))}
                </div>
              )}
        {personId && <p className="help mt-2"><a href="#/progreso" onClick={() => { try { localStorage.setItem("silver-progress-trainer", JSON.stringify(personId)); } catch (_) { /* ignore */ } }}>{t("palmares_open_progress_card")}</a></p>}
      </Section>
    </div>
  );
}
