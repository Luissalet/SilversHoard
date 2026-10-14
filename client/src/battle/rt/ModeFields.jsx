// Choose how a battle is played: classic (turns) or real time (Legends: Z-A rules), and the time limit of a real-time battle.
import React from "react";

export default function ModeFields({ t, mode, onMode, timeLimit, onTimeLimit, compact = false }) {
  return (
    <div className="space-y-2">
      <span className="label">{t("rt_mode")}</span>
      <div className="seg" role="group" aria-label={t("rt_mode")}>
        <button type="button" aria-pressed={mode !== "realtime"} onClick={() => onMode("classic")}>{t("mode_classic")}</button>
        <button type="button" aria-pressed={mode === "realtime"} onClick={() => onMode("realtime")}>{t("mode_realtime")}</button>
      </div>
      {mode === "realtime" && (
        <>
          {!compact && <p className="help">{t("mode_realtime_help")}</p>}
          {onTimeLimit && (
            <label className="flex flex-wrap items-center gap-2">
              <span className="help">{t("rt_time_limit")}</span>
              <input className="field max-w-[110px]" type="number" min={30} max={1800} step={30} value={timeLimit} onChange={(e) => onTimeLimit(Number(e.target.value))} />
            </label>
          )}
        </>
      )}
    </div>
  );
}

export function ModeChip({ t, mode }) {
  return mode === "realtime" ? <span className="chip chip-rt">{t("rt_chip")}</span> : null;
}
