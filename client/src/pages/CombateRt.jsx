// A real-time battle (Legends: Z-A rules): its header and the arena screen. Live battles are played here; watched and finished
// ones replay from their seed and inputs (a watched battle starts replaying at once, while the app records it).
import React, { useCallback } from "react";
import { api } from "../api.js";
import { useApp } from "../context.js";
import RtScreen from "../battle/rt/RtScreen.jsx";
import { usePoll } from "../components/hooks.js";
import { useSeats } from "../components/silver.jsx";
import { RunStrip } from "./Combate.jsx";

export default function CombateRt({ battle, setData }) {
  const { t, lang, sprites, changed, go } = useApp();
  const seats = useSeats(battle);
  const title = battle.title || `${battle.p1.name} vs ${battle.p2.name}`;
  const humans = ["p1", "p2"].filter((s) => battle[s]?.human);

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
      mode: "realtime", time_limit: battle.rt?.time_limit || 0 });
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
            {battle.status === "running" && <span className="chip chip-amber">{t("status_running")}</span>}
            {battle.status === "live" && <span className="chip chip-accent">{t("status_live")}</span>}
            {battle.status === "ended" && <span className="chip chip-ok">{battle.winner_name ? t("winner_is", { name: battle.winner_name }) : t("tie")}</span>}
            {humans.length === 2 && <span className="chip">{t("hotseat")}</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {battle.status === "ended" && runActive && battle.winner_side === "p1" && <button type="button" className="btn btn-primary" onClick={nextStage}>{t("next_stage")}</button>}
          <a className="btn" href="#/combatir">{t("new_battle")}</a>
        </div>
      </div>
      <RunStrip run={battle.run} />
      <RtScreen key={battle.id} battle={battle} lang={lang} sprites={sprites} seats={seats} onFinish={onFinish} onSave={onSave}
        onAgain={!battle.run && battle.kind !== "friend" ? again : null} />
    </div>
  );
}
