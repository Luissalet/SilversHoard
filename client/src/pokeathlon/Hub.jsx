// The Pokéathlon page: pick a course or a single event, set the teams up, play, see the records.
import React, { useEffect, useMemo, useState } from "react";
import { useApp } from "../context.js";
import Records from "./Records.jsx";
import RoomHub from "./RoomHub.jsx";
import Setup from "./Setup.jsx";
import Stage from "./Stage.jsx";
import { MedalBadge } from "./parts.jsx";
import { COURSES, courseByKey } from "./course.js";
import { loadNpcTeams, loadStats } from "./data.js";
import { EVENTS } from "./events/index.js";
import { STAT_COLORS, makeS } from "./strings.js";
import "./pokeathlon.css";

export default function Hub({ param, query }) {
  const { lang, go } = useApp();
  const s = useMemo(() => makeS(lang), [lang]);
  const en = lang === "en" ? "en" : "es";
  const [tab, setTab] = useState(param === "prueba" ? "events" : param === "records" ? "records" : param === "amigos" ? "friends" : "courses");
  const [stats, setStats] = useState(null);
  const [npc, setNpc] = useState(null);
  const [setup, setSetup] = useState(null);   // { course } | { eventId }
  const [playing, setPlaying] = useState(null); // config
  const [recordsVersion, setRecordsVersion] = useState(0);
  const [roomActive, setRoomActive] = useState(false);   // a room is open on the "with friends" tab: its screens take the whole page

  useEffect(() => { loadStats().then(setStats); loadNpcTeams().then(setNpc); }, []);
  useEffect(() => {
    const ev = query && query.get("event");
    if (ev && EVENTS[ev]) setSetup({ eventId: ev });
    const c = query && query.get("course");
    if (c && courseByKey(c)) setSetup({ course: courseByKey(c) });
  }, [query]);

  const leave = () => { setPlaying(null); setSetup(null); setRecordsVersion((v) => v + 1); if (query && (query.get("event") || query.get("course"))) go("#/pokeathlon"); };
  const again = () => { setPlaying(null); };

  if (playing) {
    return <Stage key={playing.seed} config={playing} onExit={leave} onAgain={again} onOther={() => { setPlaying(null); setSetup(null); setTab("events"); }} />;
  }
  if (setup) {
    if (!stats) return <p className="help">{s("loading_stats")}</p>;
    return <Setup course={setup.course || null} eventId={setup.eventId} stats={stats} npc={npc} onBack={() => { setSetup(null); if (query && (query.get("event") || query.get("course"))) go("#/pokeathlon"); }}
      onStart={(cfg) => setPlaying(cfg)} />;
  }

  return (
    <div className="pk-hub space-y-4">
      {!roomActive && (
        <>
          <div className="page-head">
            <div className="min-w-0"><h1>{s("title")}</h1><p className="help">{s("intro")}</p></div>
          </div>
          <div role="tablist" className="tabs">
            {[["courses", "tab_courses"], ["events", "tab_events"], ["friends", "tab_friends"], ["records", "tab_records"]].map(([id, key]) => (
              <button key={id} type="button" role="tab" className="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{s(key)}</button>
            ))}
          </div>
        </>
      )}

      {tab === "courses" && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {COURSES.map((c) => (
            <div key={c.key} className="panel pk-coursecard">
              <div className="flex items-center gap-3">
                {c.medal ? <MedalBadge stat={c.medal} size={46} /> : <span className="pk-nomedal pk-nomedal-big" aria-hidden="true" />}
                <div className="min-w-0 grow">
                  <h3>{s(`course_${c.key}`)}</h3>
                  <div className="help">{s("events_n", { n: c.events ? c.events.length : 4 })}{c.medal ? ` · ${s(`medal_${c.medal}`)}` : ""}</div>
                </div>
              </div>
              {c.events ? (
                <ul className="pk-evlist">{c.events.map((id) => <li key={id}>{EVENTS[id].names[en]}<span className="help"> — {EVENTS[id].stats.map((k) => s(`stat_${k}`)).join(" · ")}</span></li>)}</ul>
              ) : <p className="help">{s("course_supreme_help")}</p>}
              <button type="button" className="btn btn-primary" onClick={() => setSetup({ course: c })}>{s("pick")}</button>
            </div>
          ))}
        </div>
      )}

      {tab === "events" && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Object.keys(EVENTS).map((id) => {
            const mod = EVENTS[id];
            return (
              <div key={id} className="panel pk-coursecard">
                <div className="min-w-0">
                  <h3>{mod.names[en]}</h3>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {mod.stats.map((k) => <span key={k} className="chip" style={{ color: STAT_COLORS[k] }}>{s(`stat_${k}`)}</span>)}
                    <span className="chip">{id === "hurdle_dash" ? s("race") : s("seconds_n", { n: mod.seconds })}</span>
                  </div>
                </div>
                <p className="help">{mod.help[en]}</p>
                <button type="button" className="btn btn-primary" onClick={() => setSetup({ eventId: id })}>{s("play_alone")}</button>
              </div>
            );
          })}
        </div>
      )}

      {tab === "friends" && (stats ? <RoomHub stats={stats} onActive={setRoomActive} /> : <p className="help">{s("loading_stats")}</p>)}

      {tab === "records" && <Records version={recordsVersion} />}
    </div>
  );
}
