// Plays a battle log on screen: applies the protocol lines one by one with a pause after the ones that show something, so a
// battle reads like the games. Live battles push new lines as they arrive; replays can pause, step, jump to a turn or skip to the end.
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { applyLine, newState, turnMarks } from "./protocol.js";
import { newSfxState, playLine, sfxPre } from "./sfx.js";
import {abilityBoundary} from "../../../engine/src/ability-events.mjs";

const PAUSE = { move: 1, switch: 0.8, faint: 1.1, damage: 0.55, heal: 0.45, status: 0.6, boost: 0.5, effect: 0.45, big: 1.2, field: 0.6, turn: 0.35,
  win: 0.2, ability: 0.45, minor: 0.35, info: 0.3, raw: 0.2 };

/** `cryUrl(species)` gives the address of a Pokémon's cry (null: no cries, as in the offline playable page); `sound=false` keeps it silent.
 * `names` = {p1: [saved, shown], p2: [...]}: the trainers' names the log says (the seats' names in the reader's language). */
export function useBattlePlayer({ lang = "es", me = "p1", speedMs = 900, cryUrl = null, sound = true, names = null } = {}) {
  const [, rerender] = useReducer((x) => x + 1, 0);
  const r = useRef(null);
  if (!r.current) {
    r.current = { lines: [], applied: 0, state: newState(), log: [], anim: null, animId: 0, playing: true, timer: null, speedMs, lang, me,
      muted: false, sfx: newSfxState(), fx: null, abilities:[], abilitySeen:new Set(), abilityEpoch:0, names, namesKey: JSON.stringify(names) };
  }
  const p = r.current;
  p.speedMs = speedMs;
  p.cryUrl = cryUrl;
  p.sound = sound;

  const rebuild = useCallback((count) => {
    const st = newState();
    const log = [];
    for (let i = 0; i < count; i++) {
      const ev = applyLine(st, p.lines[i], { lang: p.lang, me: p.me, names: p.names });
      if (ev && ev.text) log.push({ i, text: ev.text, kind: ev.kind });
    }
    p.state = st;
    p.log = log;
    p.applied = count;
    p.anim = null;
    p.abilities = [];
    p.abilitySeen.clear();
    p.abilityEpoch++;
    p.sfx = newSfxState();
    p.fx?.clear?.();
  }, [p]);

  // quiet: the line is applied without effects (skipping to the end)
  const step = useCallback((quiet = false) => {
    if (p.applied >= p.lines.length) return 0;
    const line = p.lines[p.applied];
    const loud = p.sound && !p.muted && !quiet;
    const pre = loud ? sfxPre(p.state, line) : null;
    const ev = applyLine(p.state, line, { lang: p.lang, me: p.me, names: p.names });
    if (abilityBoundary(line)) p.abilitySeen.clear();
    if (ev?.ability && !quiet) {
      const a=ev.ability, key=`${a.side}:${a.slot}:${a.pokemon}:${a.ability}`;
      if (!p.abilitySeen.has(key)) p.abilities = [...p.abilities,{...a,id:`${p.abilityEpoch}:${p.applied}`}];
      p.abilitySeen.add(key);
    }
    if (ev && ev.text) p.log.push({ i: p.applied, text: ev.text, kind: ev.kind });
    if (ev && loud) playLine(p.state, line, ev, pre, p.sfx, { speedMs: p.speedMs, cryUrl: p.cryUrl });
    const base = ev ? (PAUSE[ev.kind] ?? 0.3) : 0;
    let wait = base;
    if (ev && ev.anim && !quiet && p.fx && p.speedMs >= 100) {
      // the effect layer plays the cue and says how long the line must last, so a move's effect ends before its damage shows
      try { wait = Math.max(base, p.fx.cue(ev.anim, { budgetMs: base * p.speedMs, speedMs: p.speedMs, lang: p.lang }) / p.speedMs); } catch { wait = base; }
    }
    if (ev && ev.anim) {
      p.animId += 1;
      p.anim = { ...ev.anim, id: p.animId, kind: ev.kind };
    }
    p.applied += 1;
    return ev ? wait : 0;
  }, [p]);

  const schedule = useCallback(() => {
    clearTimeout(p.timer);
    p.timer = null;
    if (!p.playing || p.applied >= p.lines.length) return;
    let pause = 0;
    let guard = 0;
    // apply silent lines at once, stop after the first one that shows something
    while (p.applied < p.lines.length && pause === 0 && guard++ < 500) pause = step();
    rerender();
    if (p.applied < p.lines.length) p.timer = setTimeout(schedule, Math.max(0, pause * p.speedMs));
  }, [p, step]);

  useEffect(() => () => clearTimeout(p.timer), [p]);

  // the language, the side shown at the bottom or the trainers' names changed: rebuild the texts
  const namesKey = JSON.stringify(names);
  useEffect(() => {
    if (p.lang !== lang || p.me !== me || p.namesKey !== namesKey) {
      p.lang = lang;
      p.me = me;
      p.names = names;
      p.namesKey = namesKey;
      rebuild(p.applied);
      rerender();
    }
  }, [lang, me, namesKey, p, rebuild]); // eslint-disable-line react-hooks/exhaustive-deps

  const api = useMemo(() => ({
    /** Replace everything; instant=true shows the end state at once (opening a finished battle or resuming a live one). */
    load(lines, { instant = false, playing = true } = {}) {
      clearTimeout(p.timer);
      p.lines = lines.slice();
      p.playing = playing;
      rebuild(instant ? p.lines.length : 0);
      rerender();
      if (!instant) schedule();
    },
    /** New lines of a live battle: they play after the ones still pending. */
    push(lines) {
      if (!lines || !lines.length) return;
      p.lines.push(...lines);
      if (!p.timer) schedule();
    },
    play() { p.playing = true; schedule(); rerender(); },
    pause() { p.playing = false; clearTimeout(p.timer); p.timer = null; rerender(); },
    toggle() { if (p.playing && p.timer) api.pause(); else api.play(); },
    stepOne() {
      p.playing = false;
      clearTimeout(p.timer);
      p.timer = null;
      let pause = 0;
      let guard = 0;
      while (p.applied < p.lines.length && pause === 0 && guard++ < 500) pause = step();
      rerender();
    },
    skip() {
      clearTimeout(p.timer);
      p.timer = null;
      p.muted = true;
      while (p.applied < p.lines.length) step(true);
      p.muted = false;
      p.anim = null;
      p.abilities = [];
      p.abilityEpoch++;
      p.fx?.clear?.();
      rerender();
    },
    seek(index, { play = false } = {}) {
      clearTimeout(p.timer);
      p.timer = null;
      rebuild(Math.max(0, Math.min(index, p.lines.length)));
      p.playing = play;
      rerender();
      if (play) schedule();
    },
    get state() { return p.state; },
    get log() { return p.log; },
    get anim() { return p.anim; },
    get abilities() { return p.abilities; },
    get abilityEpoch() { return p.abilityEpoch; },
    /** The effect layer of the arena (see battle/fx/stage.js): it plays the cues of the lines as they are shown. Returns a detach function. */
    attachFx(fx) {
      p.fx = fx;
      return () => { if (p.fx === fx) p.fx = null; };
    },
    get applied() { return p.applied; },
    get total() { return p.lines.length; },
    get lines() { return p.lines; },
    get caughtUp() { return p.applied >= p.lines.length; },
    get playing() { return p.playing && !!p.timer; },
    get marks() { return turnMarks(p.lines); },
  }), [p, rebuild, schedule, step]);
  return api;
}
