// A real-time battle (Legends: Z-A rules): its header and the arena screen. Live battles are played here; watched and finished
// ones replay from their seed and inputs (a watched battle starts replaying at once, while the app records it).
import React, { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { useApp } from "../context.js";
import RtScreen from "../battle/rt/RtScreen.jsx";
import { usePoll } from "../components/hooks.js";
import { useSeats } from "../components/silver.jsx";
import { battleTitle, loc, winnerName } from "../loc.js";
import { RunStrip } from "./Combate.jsx";
import VideoExport from "../components/VideoExport.jsx";
import { CupStrip } from "./Copa.jsx";

export { RtScreen };
export { default as MassScreen } from "../battle/mass/MassScreen.jsx";   // mass battles (Campal.jsx) come with the same chunk     // the video page records a real-time replay with it (same chunk)

export default function CombateRt({ battle, setData }) {
  const { t, lang, sprites, changed, go, settings } = useApp();
  const seats = useSeats(battle);
  const title = battleTitle(battle, lang);
  const humans = ["p1", "p2"].filter((s) => battle[s]?.human && !battle[s]?.remote);
  // a live battle against a friend on another computer: this screen plays its side and the friend's arrives through the room
  const remote = battle.p2?.remote ? "p2" : battle.p1?.remote ? "p1" : "";
  const [net, setNet] = useState(null);
  useEffect(() => {
    if (!remote || battle.status !== "live") return;
    api.call("pvp_get", {}).then((r) => {
      const room = (r.rooms || []).find((x) => x.battle_id === battle.id);
      if (room) setNet({ url: room.ws, seat: remote === "p2" ? 0 : 1, delay: room.input_delay, peerName: loc(battle[remote], lang) });
      else setNet({ missing: true });
    }).catch(() => setNet({ missing: true }));
  }, [battle.id, remote]); // eslint-disable-line react-hooks/exhaustive-deps

  usePoll(async () => {
    const b = await api.call("battle_get", { id: battle.id });
    if (b.status !== "running") { setData(b); changed(); }
  }, 1500, battle.status === "running");

  const onFinish = useCallback(async (inputs, tick, forfeit) => {
    const b = await api.call("battle_rt_finish", { id: battle.id, inputs, tick, forfeit: forfeit || "" });
    setData(b);
    changed();
    return b;
  }, [battle.id, setData, changed]);

  const onSave = useCallback((inputs, tick) => {
    api.call("battle_rt_save", { id: battle.id, inputs, tick }).catch(() => {});
  }, [battle.id]);

  const again = async () => {
    const seat = (s) => (s.trainer_id ? { trainer_id: s.trainer_id, human: s.human, ai_level: s.ai?.level, ai_style: s.ai?.style }
      : { team: s.sets || [], name: s.name, human: s.human });
    const b = await api.call("battle_start", { p1: seat(battle.p1), p2: seat(battle.p2), format: battle.format, level_rules: battle.level_rules || {},
      mode: "realtime", time_limit: battle.rt?.time_limit || 0, rt_arena: battle.rt?.arena || "rocks" });
    go(`#/combate/${b.id}`);
  };
  const runActive = battle.run && battle.run.status === "active";
  const nextStage = async () => {
    const r = await api.call("challenge_next", { id: battle.run.id });
    const cur = r.stages[r.step];
    if (cur?.battle_id) go(`#/combate/${cur.battle_id}`);
    changed();
  };

  return (
    <div className="space-y-4">
      <div className="page-head">
        <div className="min-w-0">
          <h1 className="trunc">{title}</h1>
          <div className="help flex flex-wrap items-center gap-2">
            <span className="chip chip-rt">{t("rt_chip")}</span>
            <span className="chip">{battle.format_info?.name || battle.format}</span>
            <span className="chip">{t(`kind_${battle.kind}`)}</span>
            {battle.level_rules?.level ? <span className="chip">{t("eq_chip", { n: battle.level_rules.level })}</span> : null}
            {battle.rt?.arena === "rocks" && <span className="chip">{t("rt_arena")}: {t("rt_arena_rocks").toLowerCase()}</span>}
            {battle.status === "running" && <span className="chip chip-amber">{t("status_running")}</span>}
            {battle.status === "live" && <span className="chip chip-accent">{t("status_live")}</span>}
            {battle.status === "ended" && <span className="chip chip-ok">{battle.winner_name ? t("winner_is", { name: winnerName(battle, lang) }) : t("tie")}</span>}
            {humans.length === 2 && <span className="chip">{t("hotseat")}</span>}
            {remote && <span className="chip chip-accent">{t("pvp_chip", { name: loc(battle[remote], lang) })}</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {battle.status === "ended" && runActive && battle.run?.map && <a className="btn btn-primary" href={`#/recorrido/${battle.run.id}`}>{t("gmap_back")}</a>}
          {battle.status === "ended" && battle.run?.frontier && <a className={`btn ${runActive && battle.winner_side === "p1" ? "btn-primary" : ""}`} href={`#/frontera/${battle.run.id}`}>{lang === "en" ? "Battle Frontier streak" : "Racha del Frente Batalla"}</a>}
          {battle.status === "ended" && runActive && !battle.run?.map && !battle.run?.frontier && battle.winner_side === "p1" && <button type="button" className="btn btn-primary" onClick={nextStage}>{t("next_stage")}</button>}
          {battle.status === "ended" && battle.log_length > 0 && <VideoExport battle={battle} />}
          <a className="btn" href="#/combatir">{t("new_battle")}</a>
        </div>
      </div>
      <RunStrip run={battle.run} />
      <CupStrip cup={battle.cup} battle={battle} />
      {remote && battle.status === "live" && net?.missing && <div className="banner banner-warn">{t("pvp_room_gone")}</div>}
      {battle.status === "cancelled" ? <p className="help">{t("status_cancelled")}</p> : remote && battle.status === "live" && !net ? null : (
        <RtScreen key={battle.id} battle={battle} lang={lang} sprites={sprites} seats={seats} onFinish={onFinish} onSave={onSave} musicSource={settings?.music_source}
          endActions={battle.status === "ended" && battle.log_length > 0 ? <VideoExport battle={battle} /> : null}
          net={net?.url ? net : null}
          onAgain={!battle.run && !battle.cup && battle.kind !== "friend" && battle.kind !== "pvp" ? again : null} />
      )}
    </div>
  );
}
