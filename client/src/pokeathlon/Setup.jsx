// Before a course: the person's team (three Pokémon, any of the Pokédex, their stars editable within the Pokémon's own range), the rivals
// (the game's NPC teams, random Pokémon or picked by hand), the difficulty and whether to play or watch. Also used for a single event.
import React, { useMemo, useState } from "react";
import { useApp } from "../context.js";
import { useStored } from "../components/ui.jsx";
import { useTrainers } from "../components/silver.jsx";
import { hashSeed, makeRng, TEAM_COLORS } from "./core.js";
import { eventsOfCourse } from "./course.js";
import { EVENTS } from "./events/index.js";
import { buildTeams, cleanTeam, rowsById } from "./data.js";
import { TeamEditor } from "./TeamEditor.jsx";
import { makeS } from "./strings.js";

function Choice({ name, value, options, onChange }) {
  return (
    <div className="pk-choice" role="radiogroup">
      {options.map((o) => (
        <label key={o.id} className={value === o.id ? "on" : ""}>
          <input type="radio" name={name} checked={value === o.id} onChange={() => onChange(o.id)} />
          <span><strong>{o.label}</strong>{o.help && <small>{o.help}</small>}</span>
        </label>
      ))}
    </div>
  );
}

/**
 * props: course (an item of COURSES, or null for a single event), eventId (single event), stats ({rows, full}), npc (Map or null),
 * onStart(config), onBack().
 */
export default function Setup({ course, eventId: eventIdProp, stats, npc, onStart, onBack }) {
  const { lang, sprites } = useApp();
  const s = useMemo(() => makeS(lang), [lang]);
  const rows = stats.rows;
  const byId = useMemo(() => rowsById(rows), [rows]);
  const trainers = useTrainers();
  const [saved, setSaved] = useStored("silver-pokeathlon-team", null);
  const [rivalMode, setRivalMode] = useStored("silver-pokeathlon-rivals", "npc");
  const [savedCustom, setSavedCustom] = useStored("silver-pokeathlon-custom", null);
  const [supremeChoice, setSupremeChoice] = useStored("silver-pokeathlon-supreme", false);
  const [mode, setMode] = useStored("silver-pokeathlon-mode", "play");
  const [eventId, setEventId] = useState(eventIdProp || Object.keys(EVENTS)[0]);
  const myName = s("my_team_default");
  const mine = useMemo(() => cleanTeam(saved, rows, myName), [saved, rows, myName]);
  const customRivals = useMemo(() => [0, 1, 2].map((i) => {
    const names = s("rival_names");
    return cleanTeam(savedCustom && savedCustom[i], rows, names[i]);
  }), [savedCustom, rows, lang]); // eslint-disable-line react-hooks/exhaustive-deps
  const setCustom = (i, team) => setSavedCustom(customRivals.map((t, j) => (j === i ? team : t)));
  const forcedSupreme = !!(course && course.supreme);
  const supreme = forcedSupreme || supremeChoice;
  const courseName = course ? s(`course_${course.key}`) : s("course_single");
  const mod = !course ? EVENTS[eventId] : null;

  const start = () => {
    const seed = (Math.floor(Math.random() * 0xffffffff) ^ Date.now()) >>> 0;
    const rng = makeRng(hashSeed(seed, "teams"));
    const courseId = course ? course.id : Math.floor(rng() * 5);
    const teams = buildTeams({
      rows, mine, rivals: rivalMode, customRivals, npc, courseId, supreme, watch: mode === "watch", rng, rivalNames: s("rival_names"),
    });
    const events = course ? eventsOfCourse(course, makeRng(hashSeed(seed, "events"))) : [eventId];
    onStart({ key: course ? course.key : "single", events, teams, supreme, mode, seed, medal: course ? course.medal : "", single: !course });
  };

  return (
    <div className="pk-setup space-y-4">
      <div className="page-head">
        <div className="min-w-0">
          <h1>{s("setup_title", { name: course ? courseName : courseName.toLowerCase() })}</h1>
          {course && <p className="help">{course.events ? course.events.map((id) => EVENTS[id].names[lang === "en" ? "en" : "es"]).join(" · ") : s("course_supreme_help")}</p>}
        </div>
        <button type="button" className="btn" onClick={onBack}>{s("back")}</button>
      </div>

      {!stats.full && <div className="banner banner-warn" role="status">{s("stats_fallback")}</div>}

      {!course && (
        <div className="panel space-y-2">
          <label className="label" htmlFor="pk-event">{s("event_to_play")}</label>
          <select id="pk-event" className="field max-w-sm" value={eventId} onChange={(e) => setEventId(e.target.value)}>
            {Object.keys(EVENTS).map((id) => <option key={id} value={id}>{EVENTS[id].names[lang === "en" ? "en" : "es"]}</option>)}
          </select>
          {mod && (
            <p className="help">
              {mod.stats.map((k) => s(`stat_${k}`)).join(" · ")} · {s("seconds_n", { n: mod.seconds })} — {mod.help[lang === "en" ? "en" : "es"]}
            </p>
          )}
        </div>
      )}

      <TeamEditor team={mine} rows={rows} byId={byId} onChange={setSaved} s={s} sprites={sprites} color={TEAM_COLORS[0]} title={s("your_team")} trainers={trainers} />

      <div className="panel space-y-3">
        <h2>{s("rivals")}</h2>
        <Choice name="pk-rivals" value={rivalMode} onChange={setRivalMode} options={[
          { id: "npc", label: s("rivals_npc"), help: s("rivals_npc_help") },
          { id: "random", label: s("rivals_random"), help: s("rivals_random_help") },
          { id: "custom", label: s("rivals_custom"), help: s("rivals_custom_help") },
        ]} />
        {rivalMode === "custom" && (
          <div className="space-y-3">
            {customRivals.map((t, i) => (
              <TeamEditor key={i} team={t} rows={rows} byId={byId} onChange={(next) => setCustom(i, next)} s={s} sprites={sprites} color={TEAM_COLORS[i + 1]} title={s("rival_n", { n: i + 1 })} trainers={trainers} />
            ))}
          </div>
        )}
        {!forcedSupreme && (
          <label className="pk-check">
            <input type="checkbox" checked={supremeChoice} onChange={(e) => setSupremeChoice(e.target.checked)} />
            <span><strong>{s("diff_supreme")}</strong><small>{s("diff_help")}</small></span>
          </label>
        )}
      </div>

      <div className="panel space-y-3">
        <h2>{s("mode")}</h2>
        <Choice name="pk-mode" value={mode} onChange={setMode} options={[
          { id: "play", label: s("mode_play"), help: s("mode_play_help") },
          { id: "watch", label: s("mode_watch"), help: s("mode_watch_help") },
        ]} />
      </div>

      <div className="flex gap-2">
        <button type="button" className="btn btn-primary" onClick={start}>{mode === "watch" ? s("start_watch") : s("start")}</button>
        <button type="button" className="btn" onClick={onBack}>{s("back")}</button>
      </div>
    </div>
  );
}
