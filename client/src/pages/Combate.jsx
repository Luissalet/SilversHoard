// One battle: live (a person chooses), watched (two AIs, played back), or a finished one replayed from its log.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import { useApp } from "../context.js";
import Arena from "../battle/Arena.jsx";
import Controls, { ReplayBar } from "../battle/Controls.jsx";
import { useBattlePlayer } from "../battle/player.js";
import { Busy, Empty, ErrorBox, Icon, ICONS, Spinner, useBusy, useLoad, useStored } from "../components/ui.jsx";
import { useContextProvider, usePoll } from "../components/hooks.js";
import { Avatar, GymBadge, useSeats } from "../components/silver.jsx";

function RunStrip({ run }) {
  const { t } = useApp();
  if (!run) return null;
  return (
    <div className="run-strip">
      <a href={`#/${run.kind === "gym" ? "gimnasio" : "liga"}/${run.target_id}`} className="run-target">{run.kind === "gym" ? <GymBadge size={22} /> : <Icon d={ICONS.star} size={18} />} {run.target_name}</a>
      {(run.stages || []).map((s, i) => (
        <span key={i} className={`run-stage ${s.result || (i === run.step && run.status === "active" ? "current" : "")}`} title={s.name}>
          <Avatar url={s.avatar_url} name={s.name} size={26} />
          <span className="trunc">{s.name}</span>
          {s.result === "won" && <Icon d={ICONS.check} size={13} />}
          {s.result === "lost" && <Icon d={ICONS.close} size={13} />}
        </span>
      ))}
      <span className={`chip ${run.status === "won" ? "chip-ok" : run.status === "lost" ? "chip-danger" : "chip-accent"}`}>{t(`run_${run.status}`)}</span>
    </div>
  );
}

export default function Combate({ param }) {
  const { t, lang, sprites, settings, notify, toastError, changed, go, confirm } = useApp();
  const [speedMs, setSpeedMs] = useStored("silver-speed", settings.playback_ms || 900);
  const { data: battle, error, reload, setData } = useLoad(() => api.call("battle_get", { id: param, since: 0 }), [param]);
  const humans = battle ? ["p1", "p2"].filter((s) => battle[s]?.human) : [];
  const me = humans[0] || "p1";
  const player = useBattlePlayer({ lang, me, speedMs });
  const loaded = useRef("");
  const lengthRef = useRef(0);
  const [busy, run] = useBusy();
  const [bubble, setBubble] = useState(null);
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
    if (fresh && seats.p2?.dialogue?.intro) setBubble({ side: "p2", text: seats.p2.dialogue.intro });
  }, [battle?.id, battle?.status]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // end-of-battle line from the trainer who won or lost
  useEffect(() => {
    if (!battle || !player.state.ended || !player.caughtUp) return;
    const w = battle.winner_side;
    if (!w) return;
    const loser = w === "p1" ? "p2" : "p1";
    const line = seats[w]?.dialogue?.win || seats[loser]?.dialogue?.lose;
    if (line) setBubble({ side: seats[w]?.dialogue?.win ? w : loser, text: line });
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
  const nextStage = () => run("next", async () => {
    const r = await api.call("challenge_next", { id: battle.run.id });
    const cur = r.stages[r.step];
    if (cur?.battle_id) go(`#/combate/${cur.battle_id}`);
    changed();
  });

  useContextProvider(() => battle ? ({ kind: "battle", object_id: battle.id, title: `${battle.p1.name} vs ${battle.p2.name}`,
    fields: { status: battle.status, turn: player.state.turn, format: battle.format, me } }) : null);

  if (error && !battle) return <ErrorBox error={error} onRetry={reload} />;
  if (!battle) return <div className="flex items-center gap-2"><Spinner /> {t("loading")}</div>;

  const live = battle.status === "live";
  const requestSide = live && player.caughtUp ? humans.find((s) => battle.requests?.[s] && !battle.requests[s].done) || humans.find((s) => battle.requests?.[s]) : null;
  const request = requestSide ? battle.requests[requestSide] : null;
  const title = battle.title || `${battle.p1.name} vs ${battle.p2.name}`;
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
            {battle.status === "running" && <span className="chip chip-amber">{t("status_running")}</span>}
            {live && <span className="chip chip-accent">{t("status_live")}</span>}
            {battle.status === "ended" && <span className="chip chip-ok">{battle.winner_name ? t("winner_is", { name: battle.winner_name }) : t("tie")}</span>}
            {humans.length === 2 && <span className="chip">{t("hotseat")}</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {wonStage && <Busy busy={busy.next} className="btn btn-primary" onClick={nextStage}>{t("next_stage")}</Busy>}
          {battle.status === "ended" && !battle.run && battle.kind !== "friend" && <Busy busy={busy.rematch} className="btn" onClick={rematch}>{t("rematch")}</Busy>}
          <a className="btn" href="#/combatir">{t("new_battle")}</a>
        </div>
      </div>
      <RunStrip run={battle.run} />
      {battle.kind === "friend" && !battle.log_length && <div className="banner banner-info">{t("no_replay")}</div>}
      {battle.status === "running" ? (
        <Empty title={t("ai_playing")}><span className="flex items-center justify-center gap-2"><Spinner /> {t("ai_playing_help")}</span></Empty>
      ) : battle.status === "failed" ? (
        <ErrorBox error={{ message: battle.summary?.error || t("battle_failed") }} onRetry={reload} />
      ) : (
        <Arena player={player} seats={seats} me={me} sprites={sprites} lang={lang} bubble={bubble}
          toolbar={!live || !player.caughtUp ? <ReplayBar player={player} lang={lang} speedMs={speedMs} onSpeed={setSpeedMs} /> : null}>
          {request && (
            <Controls request={request} lang={lang} sprites={sprites} gametype={player.state.gametype} busy={busy.choose}
              sideLabel={humans.length === 2 ? battle[requestSide].name : ""} onChoose={(c) => choose(requestSide, c)} onForfeit={() => forfeit(requestSide)} />
          )}
          {live && !request && player.caughtUp && <div className="b-controls"><div className="b-wait">{t("waiting_ai")}</div></div>}
        </Arena>
      )}
      {battle.errors && battle.errors.length > 0 && <div className="help">{battle.errors.join(" · ")}</div>}
    </div>
  );
}
