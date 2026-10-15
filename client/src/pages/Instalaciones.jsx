// Battle facilities: win streaks at the Battle Tower, Subway, Maison and Tree against one rival after another at level 50, with the
// facility's bosses on their battle. Pick a trainer, see each facility's record and open streak, start or continue one.
import React, { useState } from "react";
import { api } from "../api.js";
import { useApp } from "../context.js";
import { Busy, Empty, ErrorBox, Field, Modal, Spinner, Switch, useBusy, useLoad, useStored } from "../components/ui.jsx";
import { useContextProvider } from "../components/hooks.js";
import { Avatar, TrainerSelect } from "../components/silver.jsx";
import ModeFields from "../battle/rt/ModeFields.jsx";
import { L } from "../battle/dex.js";

const S = {
  title: ["Instalaciones de combate", "Battle facilities"],
  intro: ["Rachas de victorias como en la Torre Batalla: un rival tras otro a nivel 50, tres Pokémon por bando (cuatro en dobles) elegidos en la vista previa, y el jefe de cada instalación en su combate. Perder acaba la racha; el récord es la más larga.",
    "Win streaks as in the Battle Tower: one rival after another at level 50, three Pokémon a side (four in doubles) picked at team preview, and each facility's boss on their battle. A loss ends the streak; the record is the longest one."],
  trainer: ["Entrenador", "Trainer"],
  all: ["Elige un entrenador para ver sus récords y empezar una racha.", "Pick a trainer to see their records and start a streak."],
  singles: ["Individual", "Singles"],
  doubles: ["Dobles", "Doubles"],
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
};
const fill = (text, vars = {}) => text.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ""));

function StartDialog({ facility, trainerId, onClose }) {
  const { lang, go, changed, settings, t } = useApp();
  const s = (k, v) => fill(L(S[k], lang), v);
  const [auto, setAuto] = useState(false);
  const [stopAt, setStopAt] = useState(facility.bosses.at(-1)?.at || 0);
  const [mode, setMode] = useState(settings?.default_mode || "classic");
  const [level, setLevel] = useState(50);
  const [busy, run] = useBusy();
  const start = () => run("s", async () => {
    const r = await api.call("challenge_start", { kind: "facility", target_id: facility.id, challenger_id: trainerId, auto, stop_at: auto ? Number(stopAt) || 0 : 0,
      mode, level: Number(level) || 50 });
    changed();
    const first = r.stages[0]?.battle_id;
    go(first ? `#/combate/${first}` : facility.rental ? `#/fabrica/${r.id}` : "#/instalaciones");
  });
  return (
    <Modal title={s("start_title", { name: lang === "en" ? facility.name : facility.name_es })} onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>{t("cancel")}</button><Busy busy={busy.s} className="btn btn-primary" onClick={start}>{s("start")}</Busy></>}>
      <label className="flex items-center gap-2"><Switch checked={auto} onChange={setAuto} label={s("auto")} /> {s("auto")}</label>
      <p className="help">{auto ? s("auto_help") : s("you_help")}</p>
      {facility.rental && <p className="help">{s("rental_help")}</p>}
      {auto && <Field label={s("stop_at")}><input className="field" type="number" min={0} max={10000} value={stopAt} onChange={(e) => setStopAt(e.target.value)} /></Field>}
      <ModeFields t={t} mode={mode} onMode={setMode} level={level} onLevel={setLevel} />
    </Modal>
  );
}

export default function Instalaciones() {
  const { lang, go, changed } = useApp();
  const s = (k, v) => fill(L(S[k], lang), v);
  const [trainerId, setTrainerId] = useStored("silver-facility-trainer", "");
  const [dialog, setDialog] = useState(null);
  const [busy, run] = useBusy();
  const { data, error, reload } = useLoad(() => api.call("facilities_list", { trainer_id: trainerId || "" }), [trainerId]);
  useContextProvider(() => ({ kind: "facilities", title: L(S.title, lang), fields: { trainer_id: trainerId } }));
  const keepGoing = (f) => run(f.id, async () => {
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
      <div className="max-w-md"><TrainerSelect value={trainerId} onChange={setTrainerId} label={s("trainer")} /></div>
      {!trainerId && <p className="help">{s("all")}</p>}
      {error && <ErrorBox error={error} onRetry={reload} />}
      {!data && !error && <div className="flex items-center gap-2"><Spinner /></div>}
      {data && !data.facilities.length && <Empty title={s("title")} />}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {(data?.facilities || []).map((f) => (
          <div key={f.id} className="panel facility-card space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="trunc">{lang === "en" ? f.name : f.name_es}</h3>
                <div className="help">{s("gen_game", { g: f.gen, game: f.game })} · {s(f.gametype)} · {s("per_side", { n: f.size })}{f.rental ? ` · ${s("rental")}` : ""}</div>
              </div>
              <span className="chip chip-accent num" title={s("record")}>{f.record}</span>
            </div>
            {f.rental && !f.bosses.length && <p className="help">{s("rental_help")}</p>}
            <div className="flex flex-wrap gap-2">
              {f.bosses.map((b) => (
                <span key={`${b.key}${b.at}`} className="facility-boss" title={`${b.name} · ${lang === "en" ? b.label : b.label_es}`}>
                  <Avatar url={b.avatar_url} name={b.name} size={40} />
                  <span className="help">{s("boss_at", { n: b.at })}</span>
                </span>
              ))}
            </div>
            <div className="help">{f.record_holder && !trainerId ? s("record_of", { n: f.record, who: f.record_holder }) : `${s("record")}: ${f.record}`}
              {f.active_run_id ? ` · ${s("open_streak", { n: f.active_streak })}` : ""}</div>
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
