// Choose how a battle is played: classic (turns) or real time (Legends: Z-A rules), the time limit and the arena (open or with
// rocks) of a real-time battle, and
// whether every Pokémon is levelled to 50 or 100 ("igualado") so a level 88 does not crush a level 44.
import React, { useEffect, useState } from "react";
import { api } from "../../api.js";

export const EQUAL_LEVELS = [0, 50, 100];

/** The level rules a battle sends: the extra rules the person set, with the equalized level on top when chosen. */
export function withEqualLevel(levelRules, level) {
  const clean = Object.fromEntries(Object.entries(levelRules || {}).filter(([, v]) => v));
  if (!level) return clean;
  return { level: Number(level) };
}

export function LevelFields({ t, level, onLevel }) {
  return (
    <div className="space-y-2">
      <span className="label">{t("eq_title")}</span>
      <div className="seg" role="group" aria-label={t("eq_title")}>
        {EQUAL_LEVELS.map((v) => (
          <button key={v} type="button" aria-pressed={Number(level || 0) === v} onClick={() => onLevel(v)}>{v ? t("eq_level", { n: v }) : t("eq_off")}</button>
        ))}
      </div>
      <p className="help">{Number(level) ? t("eq_help_on", { n: level }) : t("eq_help_off")}</p>
    </div>
  );
}

export const ARENAS = ["open", "rocks"];

let arenasCache = null;
/** The arenas drawn in the arena designer (arenas_list), read once per page load and again after one is saved. */
export function useCustomArenas() {
  const [list, setList] = useState(arenasCache || []);
  useEffect(() => {
    let alive = true;
    if (!arenasCache) {
      api.call("arenas_list", {}).then((r) => { arenasCache = r.arenas || []; if (alive) setList(arenasCache); }).catch(() => {});
    }
    return () => { alive = false; };
  }, []);
  return list;
}
export function forgetCustomArenas() { arenasCache = null; }

export function ArenaFields({ t, arena, onArena, compact = false }) {
  const custom = useCustomArenas();
  const isCustom = String(arena || "").startsWith("custom:");
  const value = isCustom ? "custom" : ARENAS.includes(arena) ? arena : "rocks";
  const current = isCustom ? custom.find((a) => a.value === arena) : null;
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="help">{t("rt_arena")}</span>
        <div className="seg" role="group" aria-label={t("rt_arena")}>
          {ARENAS.map((v) => <button key={v} type="button" aria-pressed={value === v} onClick={() => onArena(v)}>{t(`rt_arena_${v}`)}</button>)}
          {custom.length > 0 && <button type="button" aria-pressed={value === "custom"} onClick={() => onArena(isCustom ? arena : custom[0].value)}>{t("rt_arena_custom")}</button>}
        </div>
        {isCustom && (
          <select className="field max-w-xs" value={arena} onChange={(e) => onArena(e.target.value)} aria-label={t("rt_arena_custom")}>
            {!current && <option value={arena}>?</option>}
            {custom.map((a) => <option key={a.id} value={a.value}>{a.name}</option>)}
          </select>
        )}
        <a className="help btn-link" href="#/arenas">{t("arena_design")}</a>
      </div>
      {!compact && <p className="help">{isCustom ? t("rt_arena_help_custom", { n: current?.rocks?.length ?? 0 }) : t(`rt_arena_help_${value}`)}</p>}
    </div>
  );
}

export default function ModeFields({ t, mode, onMode, timeLimit, onTimeLimit, compact = false, level, onLevel, arena, onArena }) {
  return (
    <div className="space-y-3">
      {onLevel && <LevelFields t={t} level={level} onLevel={onLevel} />}
      <div className="space-y-2">
      <span className="label">{t("rt_mode")}</span>
      <div className="seg" role="group" aria-label={t("rt_mode")}>
        <button type="button" aria-pressed={mode !== "realtime"} onClick={() => onMode("classic")}>{t("mode_classic")}</button>
        <button type="button" aria-pressed={mode === "realtime"} onClick={() => onMode("realtime")}>{t("mode_realtime")}</button>
      </div>
      {mode === "realtime" && (
        <>
          {!compact && <p className="help">{t("mode_realtime_help")}</p>}
          {onArena && <ArenaFields t={t} arena={arena} onArena={onArena} compact={compact} />}
          {onTimeLimit && (
            <label className="flex flex-wrap items-center gap-2">
              <span className="help">{t("rt_time_limit")}</span>
              <input className="field max-w-[110px]" type="number" min={30} max={1800} step={30} value={timeLimit} onChange={(e) => onTimeLimit(Number(e.target.value))} />
            </label>
          )}
        </>
      )}
      </div>
    </div>
  );
}

export function ModeChip({ t, mode }) {
  return mode === "realtime" ? <span className="chip chip-rt">{t("rt_chip")}</span> : null;
}
