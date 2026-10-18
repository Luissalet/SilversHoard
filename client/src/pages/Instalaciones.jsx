// Battle facilities: win streaks at the Battle Tower, Subway, Maison and Tree against one rival after another at level 50, with the
// facility's bosses on their battle. Pick a trainer, see each facility's record and open streak, start or continue one. The
// HeartGold/SoulSilver Battle Hall, Arcade and Castle keep their own rules (singles, doubles and multi with an AI partner, turn by
// turn or in real time) and play between battles on #/frontera/<run>.
import React, { useState } from "react";
import { api } from "../api.js";
import { useApp } from "../context.js";
import { Busy, Empty, ErrorBox, Field, Modal, Spinner, Switch, useBusy, useLoad, useStored } from "../components/ui.jsx";
import { MonIcon } from "../components/silver.jsx";
import { useContextProvider } from "../components/hooks.js";
import { Avatar, TrainerSelect } from "../components/silver.jsx";
import ModeFields from "../battle/rt/ModeFields.jsx";
import { L } from "../battle/dex.js";
import PlaceFilters, { matchesPlace } from "../components/PlaceFilters.jsx";
import DailyChallenge from "./DailyChallenge.jsx";

const S = {
  title: ["Instalaciones de combate", "Battle facilities"],
  intro: ["Rachas de victorias como en la Torre Batalla: un rival tras otro a nivel 50, tres Pokémon por bando (cuatro en dobles) elegidos en la vista previa, y el jefe de cada instalación en su combate. Perder acaba la racha; el récord es la más larga.",
    "Win streaks as in the Battle Tower: one rival after another at level 50, three Pokémon a side (four in doubles) picked at team preview, and each facility's boss on their battle. A loss ends the streak; the record is the longest one."],
  trainer: ["Entrenador", "Trainer"],
  all: ["Elige un entrenador para ver sus récords y empezar una racha.", "Pick a trainer to see their records and start a streak."],
  no_matches: ["Ninguna instalación de esa región o juego.", "No facility from that region or game."],
  singles: ["Individual", "Singles"],
  doubles: ["Dobles", "Doubles"],
  multi: ["Múltiple con compañero", "Multi with a partner"],
  per_side: ["{n} Pokémon por bando", "{n} Pokémon a side"],
  record: ["Récord", "Record"],
  record_of: ["Récord: {n} ({who})", "Record: {n} ({who})"],
  open_streak: ["Racha abierta: {n}", "Open streak: {n}"],
  continue: ["Continuar", "Continue"],
  start: ["Empezar racha", "Start a streak"],
  boss_at: ["Combate {n}", "Battle {n}"],
  start_title: ["Racha en {name}", "Streak at {name}"],
  auto: ["La IA juega por ti", "The AI plays for you"],
  auto_help: ["La racha se juega sola en segundo plano hasta perder o hasta el tope.", "The streak plays by itself in the background until it is lost or reaches the limit."],
  you_help: ["Juegas tú cada combate; al ganar, «Siguiente combate» trae al siguiente rival.", "You play every battle; after a win, «Next battle» brings the next rival."],
  stop_at: ["Parar tras (victorias, 0 = sin tope)", "Stop after (wins, 0 = no limit)"],
  abandon: ["Abandonar", "Give up"],
  gen_game: ["Gen. {g} · {game}", "Gen {g} · {game}"],
  rental: ["Pokémon de alquiler", "Rental Pokémon"],
  rental_help: ["Sin equipo propio: eliges 3 de 6 Pokémon de alquiler cada ronda y tras cada victoria puedes cambiar uno por uno del rival.",
    "No team of your own: pick 3 of 6 rental Pokémon each round and after each win you may swap one for one of the rival's."],
  rules_hall: ["Un Pokémon tuyo contra rivales del tipo que elijas en una tabla de 17 tipos. Cada tipo tiene rango 0-10: cada victoria lo sube y el nivel del rival sale de la fórmula del juego (tu nivel, el rango y cuántos tipos llevas). Rondas de 10; Argenta en los combates 50 y 170.",
    "One of your Pokémon against rivals of the type you pick on a 17-type board. Each type has a rank 0-10: every win ranks it up and the rival's level comes from the game's formula (your level, the rank and how many types you have ranked). Rounds of 10; Argenta on battles 50 and 170."],
  rules_arcade: ["Tres Pokémon (nivel 50 como máximo, sin objetos). Antes de cada combate gira la ruleta: estados, PS, clima, Espacio Raro, niebla, bayas u objetos, +3 niveles, cambio de equipos, saltar el combate o Puntos de Batalla. Delila en los combates 21 y 49.",
    "Three Pokémon (level 50 at most, no items). Before each battle the roulette spins: statuses, HP, weather, Trick Room, fog, berries or items, +3 levels, party swap, skipping the battle or Battle Points. Dahlia on battles 21 and 49."],
  rules_castle: ["Tres Pokémon (nivel 50 como máximo, sin objetos). Los PS y los PP no se recuperan entre combates: con Puntos de Castillo curas, alquilas objetos, espías al rival o cambias su nivel. Kokuran en los combates 21 y 49.",
    "Three Pokémon (level 50 at most, no items). HP and PP are not restored between battles: Castle Points heal, rent items, scout the rival or change its level. Darach on battles 21 and 49."],
  core_hall: ["Rivales del tipo que elijas en una tabla de 17 tipos: cada victoria sube el rango del tipo y el nivel del rival sale de la fórmula del juego. Rondas de 10.",
    "Rivals of the type you pick on a 17-type board: every win ranks the type up and the rival's level comes from the game's formula. Rounds of 10."],
  core_arcade: ["Nivel 50 como máximo, sin objetos. Antes de cada combate gira la ruleta: estados, PS, clima, Espacio Raro, niebla, bayas u objetos, +3 niveles, cambio de equipos, saltar el combate o Puntos de Batalla.",
    "Level 50 at most, no items. Before each battle the roulette spins: statuses, HP, weather, Trick Room, fog, berries or items, +3 levels, party swap, skipping the battle or Battle Points."],
  core_castle: ["Nivel 50 como máximo, sin objetos. Los PS y los PP no se recuperan entre combates: con Puntos de Castillo curas, alquilas objetos, espías al rival o cambias su nivel.",
    "Level 50 at most, no items. HP and PP are not restored between battles: Castle Points heal, rent items, scout the rival or change its level."],
  rules_double: ["Dobles: {double}", "Doubles: {double}"],
  double_hall: ["dos Pokémon tuyos contra dos copias del mismo Pokémon rival; sin Argenta.", "two of your Pokémon against two copies of the same rival Pokémon; no Argenta."],
  double_arcade: ["tus tres Pokémon en combate doble; sin Delila.", "your three Pokémon in a double battle; no Dahlia."],
  double_castle: ["tus tres Pokémon en combate doble; sin Kokuran.", "your three Pokémon in a double battle; no Darach."],
  rules_multi: ["Múltiple: tú y un compañero que juega la IA contra dos entrenadores; cada uno solo saca sus Pokémon. {multi}", "Multi: you and a partner played by the AI against two trainers; each only sends out their own Pokémon. {multi}"],
  multi_hall: ["Un Pokémon cada uno; los rivales van a rango 9 y a tu nivel; 12 PB por ronda.", "One Pokémon each; the rivals are rank 9 and at your level; 12 BP a round."],
  multi_arcade: ["Dos Pokémon cada uno; los eventos de la ruleta alcanzan a los cuatro de un bando y la puntuación cuenta los dos equipos.", "Two Pokémon each; the roulette's events reach all four of a side and the score counts both parties."],
  multi_castle: ["Dos Pokémon cada uno; los PC y los PS y PP que se arrastran son de los tuyos (tu compañero llega curado a cada combate).", "Two Pokémon each; Castle Points and the carried HP and PP are your own Pokémon's (your partner comes healed to every battle)."],
  partner: ["Compañero", "Partner"],
  partner_frontier: ["Compañeros de la instalación", "The facility's partners"],
  partner_own: ["O uno de tus entrenadores (sus primeros Pokémon)", "Or one of your trainers (their first Pokémon)"],
  partner_help: ["Juega la posición 2 con la IA; sus Pokémon salen de sus equipos del Frente Batalla.", "Plays slot 2 with the AI; their Pokémon come from their Battle Frontier sets."],
  realtime_frontier: ["En tiempo real la ruleta, el Espacio Raro, la niebla, los PS, los estados y los PP del castillo también cuentan (reglas de tiempo real 9).",
    "In real time the roulette, Trick Room, fog, HP, statuses and the castle's PP count too (real-time rules version 9)."],
  picks: ["Elige {n} Pokémon de tu equipo", "Pick {n} Pokémon of your team"],
  picks_help: ["Combaten en el orden en que los eliges.", "They battle in the order you pick them."],
  party_level: ["Nivel de tu Pokémon", "Your Pokémon's level"],
  party_level_help: ["El nivel de los rivales se calcula a partir de este.", "The rivals' level is worked out from this one."],
  bp: ["{n} PB", "{n} BP"],
  you_help_frontier: ["Juegas tú cada combate; entre combates eliges en la página de la racha (la tabla de tipos, la ruleta o los servicios del castillo).",
    "You play every battle; between battles you choose on the streak's page (the type board, the roulette or the castle's services)."],
  gen4: ["Reglas de la 4.ª generación: los Pokémon y movimientos posteriores no valen.", "Generation 4 rules: later Pokémon and moves are not allowed."],
};
const fill = (text, vars = {}) => text.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ""));
/** What a Frontier facility's doubles or multi challenge changes from its singles. */
const modeRules = (fmode, frontier, s) => `${s(`core_${frontier}`)} ${fmode === "multi" ? s("rules_multi", { multi: s(`multi_${frontier}`) })
  : s("rules_double", { double: s(`double_${frontier}`) })}`;

function FrontierPicks({ trainerId, n, picks, onPicks, s }) {
  const { data } = useLoad(() => api.call("trainer_get", { id: trainerId }), [trainerId]);
  const team = data?.team || data?.trainer?.team || [];
  const toggle = (i) => onPicks(picks.includes(i) ? picks.filter((x) => x !== i) : picks.length < n ? [...picks, i] : picks);
  return (
    <div className="space-y-2">
      <span className="label">{s("picks", { n })}</span>
      <div className="pick-grid">
        {team.map((m, i) => (
          <button key={i} type="button" className={`pick ${picks.includes(i) ? "is-on" : ""}`} aria-pressed={picks.includes(i)} onClick={() => toggle(i)}>
            <MonIcon species={m.species} size={36} />
            <span className="trunc">{m.species}{m.level ? ` · ${m.level}` : ""}</span>
            {picks.includes(i) && <span className="chip chip-accent ml-auto">{picks.indexOf(i) + 1}</span>}
          </button>
        ))}
      </div>
      <p className="help">{s("picks_help")}</p>
    </div>
  );
}

function PartnerPick({ facility, trainerId, value, onChange, s, lang }) {
  const own = value && !(facility.partners || []).some((p) => p.id === value);
  return (
    <div className="space-y-2">
      <span className="label">{s("partner")}</span>
      <p className="help">{s("partner_frontier")}</p>
      <div className="flex flex-wrap gap-2" role="group" aria-label={s("partner_frontier")}>
        {(facility.partners || []).map((p) => (
          <button key={p.id} type="button" className={`pick ${value === p.id ? "is-on" : ""}`} aria-pressed={value === p.id} onClick={() => onChange(p.id)}
            title={lang === "en" ? p.name_en : `${p.name} (${p.name_en})`}>
            <Avatar url={p.avatar_url} name={p.name} size={36} />
            <span className="trunc">{lang === "en" ? p.name_en : p.name}</span>
          </button>
        ))}
      </div>
      <p className="help">{s("partner_help")}</p>
      <TrainerSelect value={own ? value : ""} onChange={(id) => onChange(id || (facility.partners?.[0]?.id ?? ""))} label={s("partner_own")} allowNone exclude={[trainerId]} />
    </div>
  );
}

function StartDialog({ facility, trainerId, onClose }) {
  const { lang, go, changed, settings, t } = useApp();
  const s = (k, v) => fill(L(S[k], lang), v);
  const frontier = facility.frontier || "";
  const fmode = facility.frontier_mode || "single";
  const [partner, setPartner] = useState(facility.partners?.[0]?.id || "");
  const [auto, setAuto] = useState(false);
  const [stopAt, setStopAt] = useState(facility.bosses.at(-1)?.at || 0);
  const realtimeOk = !frontier || (facility.modes || []).includes("realtime");
  const [mode, setMode] = useState(realtimeOk ? settings?.default_mode || "classic" : "classic");
  const [level, setLevel] = useState(50);
  const [picks, setPicks] = useState(() => Array.from({ length: facility.picks || 0 }, (_, i) => i));
  const [busy, run] = useBusy();
  const start = () => run("s", async () => {
    const r = await api.call("challenge_start", { kind: "facility", target_id: facility.id, challenger_id: trainerId, auto, stop_at: auto ? Number(stopAt) || 0 : 0,
      mode, level: Number(level) || 50, ...(frontier ? { picks } : {}), ...(fmode === "multi" ? { partner } : {}) });
    changed();
    if (frontier) { go(`#/frontera/${r.id}`); return; }
    const first = r.stages[0]?.battle_id;
    go(first ? `#/combate/${first}` : facility.rental ? `#/fabrica/${r.id}` : "#/instalaciones");
  });
  return (
    <Modal title={s("start_title", { name: lang === "en" ? facility.name : facility.name_es })} onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>{t("cancel")}</button><Busy busy={busy.s} className="btn btn-primary" disabled={(!!frontier && picks.length !== facility.picks) || (fmode === "multi" && !partner)} onClick={start}>{s("start")}</Busy></>}>
      <label className="flex items-center gap-2"><Switch checked={auto} onChange={setAuto} label={s("auto")} /> {s("auto")}</label>
      <p className="help">{auto ? s("auto_help") : frontier ? s("you_help_frontier") : s("you_help")}</p>
      {facility.rental && <p className="help">{s("rental_help")}</p>}
      {auto && <Field label={s("stop_at")}><input className="field" type="number" min={0} max={10000} value={stopAt} onChange={(e) => setStopAt(e.target.value)} /></Field>}
      {frontier && <p className="help">{fmode === "single" ? s(`rules_${frontier}`) : modeRules(fmode, frontier, s)} {s("gen4")}</p>}
      {frontier && <FrontierPicks trainerId={trainerId} n={facility.picks} picks={picks} onPicks={setPicks} s={s} />}
      {fmode === "multi" && <PartnerPick facility={facility} trainerId={trainerId} value={partner} onChange={setPartner} s={s} lang={lang} />}
      {frontier === "hall" && (
        <div className="space-y-2">
          <span className="label">{s("party_level")}</span>
          <div className="seg" role="group" aria-label={s("party_level")}>
            {[50, 100].map((v) => <button key={v} type="button" aria-pressed={Number(level) === v} onClick={() => setLevel(v)}>{v}</button>)}
          </div>
          <p className="help">{s("party_level_help")}</p>
        </div>
      )}
      {!frontier && <ModeFields t={t} mode={mode} onMode={setMode} level={level} onLevel={setLevel} />}
      {frontier && realtimeOk && <ModeFields t={t} mode={mode} onMode={setMode} />}
      {frontier && mode === "realtime" && <p className="help">{s("realtime_frontier")}</p>}
    </Modal>
  );
}

export default function Instalaciones({ query }) {
  const { lang, go, changed } = useApp();
  const s = (k, v) => fill(L(S[k], lang), v);
  const [trainerId, setTrainerId] = useStored("silver-facility-trainer", "");
  const [region, setRegion] = useStored("silver-facility-region", "");
  const [game, setGame] = useStored("silver-facility-game", "");
  const [dialog, setDialog] = useState(null);
  const [busy, run] = useBusy();
  const { data, error, reload } = useLoad(() => api.call("facilities_list", { trainer_id: trainerId || "" }), [trainerId]);
  useContextProvider(() => ({ kind: "facilities", title: L(S.title, lang), fields: { trainer_id: trainerId } }));
  const keepGoing = (f) => run(f.id, async () => {
    if (f.frontier) { go(`#/frontera/${f.active_run_id}`); return; }
    if (f.rental && ["pick", "swap"].includes(f.active_phase)) { go(`#/fabrica/${f.active_run_id}`); return; }
    const r = await api.call("challenge_next", { id: f.active_run_id });
    changed();
    const cur = r.stages[r.step];
    go(cur?.battle_id ? `#/combate/${cur.battle_id}` : "#/instalaciones");
  });
  const giveUp = (f) => run(`x${f.id}`, async () => { await api.call("challenge_abandon", { id: f.active_run_id }); changed(); reload(); });
  return (
    <div className="space-y-4">
      <div className="page-head"><div className="min-w-0"><h1>{s("title")}</h1><p className="help">{s("intro")}</p></div></div>
      <DailyChallenge initialDay={query?.get("daily") || ""} />
      <div className="max-w-md"><TrainerSelect value={trainerId} onChange={setTrainerId} label={s("trainer")} /></div>
      {data?.facilities?.length > 0 && <PlaceFilters list={data.facilities} {...{ region, setRegion, game, setGame }} />}
      {!trainerId && <p className="help">{s("all")}</p>}
      {error && <ErrorBox error={error} onRetry={reload} />}
      {!data && !error && <div className="flex items-center gap-2"><Spinner /></div>}
      {data && !data.facilities.length && <Empty title={s("title")} />}
      {data?.facilities?.length > 0 && !data.facilities.some((f) => matchesPlace(f, region, game)) && <p className="help">{s("no_matches")}</p>}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {(data?.facilities || []).filter((f) => matchesPlace(f, region, game)).map((f) => (
          <div key={f.id} className="panel facility-card space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="trunc">{lang === "en" ? f.name : f.name_es}</h3>
                <div className="help">{s("gen_game", { g: f.gen, game: f.game })} · {s(f.frontier_mode === "multi" ? "multi" : f.gametype)} · {s("per_side", { n: f.size })}{f.rental ? ` · ${s("rental")}` : ""}</div>
              </div>
              <span className="chip chip-accent num" title={s("record")}>{f.record}</span>
            </div>
            {f.rental && !f.bosses.length && <p className="help">{s("rental_help")}</p>}
            {f.frontier && <p className="help">{f.frontier_mode && f.frontier_mode !== "single" ? modeRules(f.frontier_mode, f.frontier, s) : s(`rules_${f.frontier}`)}</p>}
            <div className="flex flex-wrap gap-2">
              {f.bosses.map((b) => (
                <span key={`${b.key}${b.at}`} className="facility-boss" title={`${b.name} · ${lang === "en" ? b.label : b.label_es}`}>
                  <Avatar url={b.avatar_url} name={b.name} size={40} />
                  <span className="help">{s("boss_at", { n: b.at })}</span>
                </span>
              ))}
            </div>
            <div className="help">{f.record_holder && !trainerId ? s("record_of", { n: f.record, who: f.record_holder }) : `${s("record")}: ${f.record}`}
              {f.active_run_id ? ` · ${s("open_streak", { n: f.active_streak })}` : ""}{f.frontier && f.bp ? ` · ${s("bp", { n: f.bp })}` : ""}</div>
            {trainerId && (
              <div className="flex flex-wrap gap-2">
                {f.active_run_id ? (
                  <>
                    <Busy busy={busy[f.id]} className="btn btn-primary" onClick={() => keepGoing(f)}>{s("continue")}</Busy>
                    <Busy busy={busy[`x${f.id}`]} className="btn" onClick={() => giveUp(f)}>{s("abandon")}</Busy>
                  </>
                ) : (
                  <button type="button" className="btn btn-primary" onClick={() => setDialog(f)}>{s("start")}</button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      {dialog && <StartDialog facility={dialog} trainerId={trainerId} onClose={() => { setDialog(null); reload(); }} />}
    </div>
  );
}
