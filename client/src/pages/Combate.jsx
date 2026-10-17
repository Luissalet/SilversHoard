// One battle: live (a person chooses), watched (two AIs, played back), or a finished one replayed from its log.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import { useApp } from "../context.js";
import Arena from "../battle/Arena.jsx";
import Controls, { ReplayBar } from "../battle/Controls.jsx";
import { useBattlePlayer } from "../battle/player.js";
import { appCryUrl } from "../battle/sfx.js";
import { battleEnd, battleRole, battleType, genOfFormat, music, pickTrack } from "../audio.js";
import { Busy, Empty, ErrorBox, Field, Icon, ICONS, Spinner, useBusy, useLoad, useStored } from "../components/ui.jsx";
import { useContextProvider, usePoll } from "../components/hooks.js";
import { Avatar, GymBadge, useSeats } from "../components/silver.jsx";
import { battleTitle, loc, seatNames, winnerName } from "../loc.js";
import { lazyChunk } from "../lazy.js";
import AiNotes from "../components/AiNotes.jsx";
import VideoExport from "../components/VideoExport.jsx";
import { CupStrip } from "./Copa.jsx";
import { SaveExercise, ExerciseProgress, PracticeSuggestions } from "../components/Training.jsx";
import { classicSeekIndex, replayPosition } from "../history-search.js";
// the real-time screen carries the battle engine: loaded only when a real-time battle opens
const CombateRt = lazyChunk(() => import("./CombateRt.jsx"));

export function RunStrip({ run }) {
  const { t, lang } = useApp();
  if (!run) return null;
  return (
    <div className="run-strip">
      {run.kind === "facility" ? (
        <a href="#/instalaciones" className="run-target"><Icon d={ICONS.star} size={18} /> {loc(run, lang, "target_name")} · {t("run_streak", { n: run.streak || 0 })}</a>
      ) : (
        <a href={`#/${run.kind === "gym" ? "gimnasio" : "liga"}/${run.target_id}`} className="run-target">{run.kind === "gym" ? <GymBadge size={22} /> : <Icon d={ICONS.star} size={18} />} {loc(run, lang, "target_name")}</a>
      )}
      {(run.stages || []).map((s, j) => {
        const i = j + (run.stages_offset || 0);
        return (
        <span key={i} className={`run-stage ${s.result || (i === run.step && run.status === "active" ? "current" : "")}`} title={s.number ? `${s.number} · ${loc(s, lang)}` : loc(s, lang)}>
          <Avatar url={s.avatar_url} name={loc(s, lang)} size={26} />
          <span className="trunc">{loc(s, lang)}</span>
          {s.result === "won" && <Icon d={ICONS.check} size={13} />}
          {s.result === "lost" && <Icon d={ICONS.close} size={13} />}
        </span>
        );
      })}
      <span className={`chip ${run.status === "won" ? "chip-ok" : run.status === "lost" ? "chip-danger" : "chip-accent"}`}>{t(`run_${run.status}`)}</span>
    </div>
  );
}

/** A friend's result that came as a short code: who played, who won and each stage, without a replay to show. */
function FriendResult({ battle }) {
  const { t, lang } = useApp();
  const stages = battle.summary?.stages || [];
  const side = (key) => (
    <div className={`series-side${battle.winner_side === key ? " is-winner" : ""}`}>
      <Avatar url={battle[key].avatar_url} name={loc(battle[key], lang)} size={72} />
      <b>{loc(battle[key], lang)}</b>
    </div>
  );
  return (
    <div className="space-y-3">
      <div className="panel series-score">
        {side("p1")}
        <div className="series-mid"><span className="help">vs</span><b>{t("turns_n", { n: battle.turns || 0 })}</b></div>
        {side("p2")}
      </div>
      {stages.length > 1 && (
        <div className="run-strip">
          {stages.map((st, i) => (
            <span key={i} className={`run-stage ${st.won ? "won" : "lost"}`}>{st.won ? t("won") : t("lost")} · {st.name} · {t("turns_n", { n: st.turns || 0 })}</span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Combate({ param, query }) {
  const { t, lang, sprites, settings, notify, toastError, changed, go, confirm } = useApp();
  const [speedMs, setSpeedMs] = useStored("silver-speed", settings.playback_ms || 900);
  const { data: battle, error, reload, setData } = useLoad(() => api.call("battle_get", { id: param, since: 0 }), [param]);
  // a friend playing from another computer (a live-battle room) is not a seat of this screen: it sees and plays its own side only
  const humans = battle ? ["p1", "p2"].filter((s) => battle[s]?.human && !battle[s]?.remote) : [];
  const remote = battle ? ["p1", "p2"].find((s) => battle[s]?.remote) || "" : "";
  const me = humans[0] || "p1";
  const player = useBattlePlayer({ lang, me, speedMs, cryUrl: appCryUrl, names: seatNames(battle, lang) });
  const loaded = useRef("");
  const lengthRef = useRef(0);
  const [busy, run] = useBusy();
  const [bubble, setBubble] = useState(null);
  const [practiceSide, setPracticeSide] = useState("p1");
  const [practiceTurn, setPracticeTurn] = useState(1);
  const [practiceError, setPracticeError] = useState(null);
  const [comparison, setComparison] = useState(null);
  const seats = useSeats(battle);

  // first load: a finished battle plays back from the start; a live one opens where it is (its first turn plays)
  useEffect(() => {
    if (!battle || loaded.current === battle.id + battle.status) return;
    if (battle.status === "running") return;
    const lines = battle.lines || [];
    const fresh = battle.status === "live" && (battle.turn || 0) <= 1;
    const firstOpen = !loaded.current.startsWith(battle.id);
    if (firstOpen) player.load(lines, { instant: battle.status === "live" && !fresh });
    else player.push(lines.slice(player.total));
    loaded.current = battle.id + battle.status;
    lengthRef.current = battle.log_length || lines.length;
    if (fresh && seats.p2?.dialogue?.intro) setBubble({ side: "p2", text: seats.p2.dialogue.intro, mood: "intro" });
  }, [battle?.id, battle?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const searchTurn = replayPosition(query, 'classic')?.turn;
  useEffect(() => {
    if (battle?.status !== 'ended' || battle.mode === 'realtime' || searchTurn === undefined) return;
    const at = classicSeekIndex(battle.lines || [], searchTurn);
    if (at !== null) { player.seek(at, {play: false}); setBubble(null); }
  }, [battle?.id, battle?.status, searchTurn]); // eslint-disable-line react-hooks/exhaustive-deps

  // the rival talks: the lines the family's model writes for the AI's moves arrive while the battle is played back
  usePoll(async () => {
    const b = await api.call("battle_get", { id: param, since: lengthRef.current });
    setData((old) => (old ? { ...old, banter: b.banter, banter_pending: b.banter_pending } : old));
  }, 4000, !!battle?.banter_pending);

  // a live battle with a friend: their moves arrive while this screen waits
  usePoll(async () => {
    const b = await api.call("battle_get", { id: param, since: lengthRef.current });
    if ((b.log_length || 0) !== lengthRef.current || b.status !== "live") {
      lengthRef.current = b.log_length;
      player.push(b.lines || []);
      setData({ ...b, lines: [] });
      if (b.status !== "live") changed();
    } else setData((old) => (old ? { ...old, requests: b.requests } : old));
  }, 1200, !!remote && battle?.status === "live");

  // a watched battle: wait for the AIs to finish, then play it
  usePoll(async () => {
    const b = await api.call("battle_get", { id: param, since: 0 });
    if (b.status !== "running") setData(b);
  }, 1000, battle?.status === "running");

  useEffect(() => {
    if (!bubble) return undefined;
    const h = setTimeout(() => setBubble(null), 4200);
    return () => clearTimeout(h);
  }, [bubble]);

  // battle music: one track per battle (it fits the format's generation), looped while the battle plays; it fades out at the end
  // with a short victory or defeat cue, and starts again when an ended battle is replayed from the start
  const musicOn = !!battle && battle.mode !== "realtime" && (battle.status === "live" || battle.status === "ended") && !(battle.kind === "friend" && !battle.log_length);
  const trackUrl = battle ? `/api/music/${pickTrack(battle.id, genOfFormat(battle.format), { source: settings.music_source, role: battleRole(battle), type: battleType(battle) })}` : "";
  useEffect(() => {
    if (musicOn && !player.state.ended) music.play(trackUrl);
  }, [musicOn, trackUrl, player.state.ended]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => music.stop({ fade: 0.8 }), []);
  useEffect(() => {
    if (!musicOn || !player.state.ended || !player.caughtUp) return;
    const st = player.state;
    battleEnd(st.tie || !st.winner ? null : st.winner === st.sides[me].name);
  }, [musicOn, player.state.ended, player.caughtUp]); // eslint-disable-line react-hooks/exhaustive-deps

  // end-of-battle line from the trainer who won or lost
  useEffect(() => {
    if (!battle || !player.state.ended || !player.caughtUp) return;
    const w = battle.winner_side;
    if (!w) return;
    const loser = w === "p1" ? "p2" : "p1";
    const line = seats[w]?.dialogue?.win || seats[loser]?.dialogue?.lose;
    if (line) setBubble({ side: seats[w]?.dialogue?.win ? w : loser, text: line, mood: seats[w]?.dialogue?.win ? "win" : "lose" });
  }, [player.state.ended, player.caughtUp]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = useCallback((side, choice) => run("choose", async () => {
    const b = await api.call("battle_choose", { id: param, side, choice, since: lengthRef.current });
    lengthRef.current = b.log_length;
    player.push(b.lines || []);
    setData({ ...b, lines: [] });
    if (b.status === "ended") changed();
  }), [param, player, run, setData, changed]);

  const forfeit = useCallback(async (side) => {
    if (!(await confirm({ title: t("forfeit"), message: t("forfeit_confirm"), confirmLabel: t("forfeit") }))) return;
    run("forfeit", async () => {
      const b = await api.call("battle_forfeit", { id: param, side, since: lengthRef.current });
      lengthRef.current = b.log_length;
      player.push(b.lines || []);
      setData({ ...b, lines: [] });
      changed();
    });
  }, [confirm, t, run, param, player, setData, changed]);

  const rematch = () => run("rematch", async () => {
    const seat = (s) => (s.trainer_id ? { trainer_id: s.trainer_id, human: s.human, ai_level: s.ai?.level, ai_style: s.ai?.style }
      : { team: s.sets || [], name: s.name, human: s.human });
    const b = await api.call("battle_start", { p1: seat(battle.p1), p2: seat(battle.p2), format: battle.format, rules: battle.rules || [], level_rules: battle.level_rules || {} });
    go(`#/combate/${b.id}`);
  });
  const practice = () => run("practice", async () => {
    setPracticeError(null);
    try {
      const b = await api.call("battle_practice", { id: param, turn: practiceTurn, side: practiceSide });
      changed();
      go(`#/combate/${b.id}`);
    } catch (e) { setPracticeError(e); }
  });
  const compare = () => run("compare", async () => {
    setComparison(await api.call("battle_compare", { id: param }));
  });
  useEffect(() => {
    setComparison(null);
    setPracticeError(null);
  }, [param]);
  const nextStage = () => run("next", async () => {
    const r = await api.call("challenge_next", { id: battle.run.id });
    const cur = r.stages[r.step];
    if (cur?.battle_id) go(`#/combate/${cur.battle_id}`);
    changed();
  });

  useContextProvider(() => battle ? ({ kind: "battle", object_id: battle.id, title: battleTitle({ ...battle, title: "" }, lang),
    fields: { status: battle.status, turn: player.state.turn, format: battle.format, me, ai_notes: battle.ai_notes_count || 0 } }) : null);

  if (error && !battle) return <ErrorBox error={error} onRetry={reload} />;
  if (!battle) return <div className="flex items-center gap-2"><Spinner /> {t("loading")}</div>;
  if (battle.mode === "realtime") {
    return (
      <React.Suspense fallback={<div className="flex items-center gap-2"><Spinner /> {t("rt_loading")}</div>}>
        <CombateRt battle={battle} setData={setData} query={query} />
      </React.Suspense>
    );
  }

  const live = battle.status === "live";
  const requestSide = live && player.caughtUp ? humans.find((s) => battle.requests?.[s] && !battle.requests[s].done) || (remote ? null : humans.find((s) => battle.requests?.[s])) : null;
  const request = requestSide ? battle.requests[requestSide] : null;
  const title = battleTitle(battle, lang);
  const who = (s) => loc(battle[s], lang);
  const runActive = battle.run && battle.run.status === "active";
  const wonStage = battle.status === "ended" && battle.winner_side === "p1" && runActive;

  return (
    <div className="space-y-4">
      <div className="page-head">
        <div className="min-w-0">
          <h1 className="trunc">{title}</h1>
          <div className="help flex flex-wrap items-center gap-2">
            <span className="chip">{battle.format_info?.name || battle.format}</span>
            <span className="chip">{t(`kind_${battle.kind}`)}</span>
            {battle.level_rules?.level ? <span className="chip">{t("eq_chip", { n: battle.level_rules.level })}</span> : null}
            {battle.status === "running" && <span className="chip chip-amber">{t("status_running")}</span>}
            {live && <span className="chip chip-accent">{t("status_live")}</span>}
            {battle.status === "ended" && <span className="chip chip-ok">{battle.winner_name ? t("winner_is", { name: winnerName(battle, lang) }) : t("tie")}</span>}
            {humans.length === 2 && <span className="chip">{t("hotseat")}</span>}
            {remote && <span className="chip chip-accent">{t("pvp_chip", { name: who(remote) })}</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {battle.run?.map && battle.status !== "live" && battle.run.status === "active" ? (
            <a className="btn btn-primary" href={`#/recorrido/${battle.run.id}`}>{t("gmap_back")}</a>
          ) : wonStage && battle.run.factory && ["pick", "swap"].includes(battle.run.factory.phase) ? (
            <a className="btn btn-primary" href={`#/fabrica/${battle.run.id}`}>{t("factory_next")}</a>
          ) : battle.status === "ended" && battle.run?.frontier ? (
            <a className={`btn ${wonStage ? "btn-primary" : ""}`} href={`#/frontera/${battle.run.id}`}>{lang === "en" ? "Battle Frontier streak" : "Racha del Frente Batalla"}</a>
          ) : wonStage && (battle.run.current?.battle_id && battle.run.current.battle_id !== battle.id
            ? <a className="btn btn-primary" href={`#/combate/${battle.run.current.battle_id}`}>{t("run_go_current")}</a>
            : <Busy busy={busy.next} className="btn btn-primary" onClick={nextStage}>{t("next_stage")}</Busy>)}
          {battle.status === "ended" && battle.log_length > 0 && <VideoExport battle={battle} />}
          {battle.status === "ended" && !battle.run && !battle.cup && battle.kind !== "friend" && battle.kind !== "pvp" && <Busy busy={busy.rematch} className="btn" onClick={rematch}>{t("rematch")}</Busy>}
          <a className="btn" href="#/combatir">{t("new_battle")}</a>
        </div>
      </div>
      <RunStrip run={battle.run} />
      <CupStrip cup={battle.cup} battle={battle} />
      {battle.practice && (
        <section className="panel space-y-2" aria-label={t("practice_title")}>
          <h2>{t("practice_title")}</h2>
          <p className="help">{t("practice_branch", { n: battle.practice.turn })}</p>
          <div className="flex flex-wrap gap-3 items-center">
            {battle.practice.source_id && <a className="btn" href={`#/combate/${battle.practice.source_id}`}>{t("practice_original")}</a>}
            {battle.practice.source_id && battle.status === "ended" && <Busy busy={busy.compare} onClick={compare}>{t("practice_compare")}</Busy>}
          </div>
          {comparison && <dl className="flex flex-wrap gap-5">
            {["original", "branch"].map((key) => <div key={key}>
              <dt className="label">{t(key === "branch" ? "practice_result" : "practice_original")}</dt>
              <dd>{comparison[key].winner_name ? t("winner_is", { name: winnerName(comparison[key], lang) }) : t("tie")} · {comparison[key].turns === 1 ? t("practice_one_turn") : t("turns_n", { n: comparison[key].turns })}</dd>
            </div>)}
          </dl>}
          {battle.practice.exercise_id && <ExerciseProgress battle={battle}/>}
        </section>
      )}
      {battle.kind === "friend" && !battle.log_length && <div className="banner banner-info">{t("no_replay")}</div>}
      {battle.kind === "friend" && !battle.log_length ? (
        <FriendResult battle={battle} />
      ) : battle.status === "running" ? (
        <Empty title={t("ai_playing")}><span className="flex items-center justify-center gap-2"><Spinner /> {t("ai_playing_help")}</span></Empty>
      ) : battle.status === "failed" ? (
        <ErrorBox error={{ message: battle.summary?.error || t("battle_failed") }} onRetry={reload} />
      ) : (
        <Arena player={player} seats={seats} me={me} sprites={sprites} lang={lang} bubble={bubble} backdrop={battle.run?.backdrop || ""} banter={battle.banter}
          toolbar={!live || !player.caughtUp ? <ReplayBar player={player} lang={lang} speedMs={speedMs} onSpeed={setSpeedMs} /> : null}>
          {request && (
            <Controls request={request} lang={lang} sprites={sprites} gametype={player.state.gametype} busy={busy.choose}
              sideLabel={humans.length === 2 ? who(requestSide) : ""} onChoose={(c) => choose(requestSide, c)} onForfeit={() => forfeit(requestSide)} />
          )}
          {live && !request && player.caughtUp && <div className="b-controls"><div className="b-wait">{remote ? t("pvp_waiting_friend", { name: who(remote) }) : t("waiting_ai")}</div></div>}
        </Arena>
      )}
      {battle.status === "ended" && player.state.ended && player.caughtUp && ["p2", "p1"].some((s) => seats[s]?.dialogue?.after) && (
        <div className="panel space-y-2">
          {["p2", "p1"].filter((s) => seats[s]?.dialogue?.after).map((s) => (
            <p key={s} className="m-0" style={{ fontStyle: "italic", borderLeft: "3px solid var(--accent)", paddingLeft: 10 }}>
              “{seats[s].dialogue.after}” <b style={{ fontStyle: "normal" }}>— {who(s)}</b>
            </p>
          ))}
        </div>
      )}
      {battle.status !== "running" && battle.status !== "failed" && (
        <AiNotes battle={battle} turn={player.state.turn} live={live} requestSide={requestSide} />
      )}
      {battle.status === "ended" && battle.log_length > 0 && (
        <section className="panel space-y-3" aria-label={t("practice_title")}>
          <h2>{t("practice_title")}</h2>
          <p className="help">{t(battle.practice_available ? "practice_help" : "practice_missing")}</p>
          {battle.practice_available && <>
            <div className="flex flex-wrap gap-3 items-end">
              <Field label={t("practice_turn")} className="w-40 min-w-0">
                <input type="number" min="1" max={battle.turns || battle.turn || 1} value={practiceTurn}
                  onChange={(e) => setPracticeTurn(Number(e.target.value))} />
              </Field>
              <Field label={t("practice_side")} className="min-w-0 flex-1">
                <select className="w-full" value={practiceSide} onChange={(e) => setPracticeSide(e.target.value)}>
                  {["p1", "p2"].map((s) => <option key={s} value={s}>{who(s)}</option>)}
                </select>
              </Field>
              <Busy busy={busy.practice} disabled={!Number.isInteger(practiceTurn) || practiceTurn < 1} onClick={practice}>{t("practice_start")}</Busy>
            </div>
            <ErrorBox error={practiceError} />
            <SaveExercise key={`${battle.id}:${practiceTurn}:${practiceSide}`} battle={battle} turn={practiceTurn} side={practiceSide}/>
            <PracticeSuggestions key={`${battle.id}:${practiceSide}`} battle={battle} side={practiceSide}/>
          </>}
        </section>
      )}
      {battle.errors && battle.errors.length > 0 && <div className="help">{battle.errors.join(" · ")}</div>}
    </div>
  );
}
