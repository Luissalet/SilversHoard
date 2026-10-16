// The records the Pokéathlon keeps: the best total of each course (with its gold and silver), the five best scores of each event with the
// Pokémon that made them, the medals each Pokémon has won and the Athlete Points.
import React, { useEffect, useMemo, useState } from "react";
import { useApp } from "../context.js";
import { MedalBadge } from "./parts.jsx";
import { COURSES, EVENT_META, EVENT_ORDER, MEDAL_BITS, STAT_KEYS, formatScore } from "./course.js";
import { loadRecords } from "./data.js";
import { EVENTS } from "./events/index.js";
import { makeS } from "./strings.js";

const UNITS = { frames: "unit_frames", pennants: "unit_pennants", points: "unit_points", blocks: "unit_blocks", hits: "unit_hits", goals: "unit_goals", "laps*1024+px": "unit_laps" };

export default function Records({ version = 0 }) {
  const { lang, sprites } = useApp();
  const s = useMemo(() => makeS(lang), [lang]);
  const [data, setData] = useState(undefined);
  useEffect(() => { loadRecords().then(setData); }, [version]);
  if (data === undefined) return <p className="help">{s("loading_stats")}</p>;
  if (data === null) return <p className="help">{s("error_load")}</p>;
  const courses = data.courses || {};
  const events = data.events || {};
  const medals = data.medals || [];
  const empty = !Object.keys(courses).length && !Object.keys(events).some((k) => (events[k] || []).length) && !medals.length;
  const en = lang === "en" ? "en" : "es";
  return (
    <div className="pk-records space-y-4">
      {empty && <p className="help">{s("records_empty")}</p>}
      <div className="grid gap-3 md:grid-cols-3">
        <div className="panel"><span className="label">{s("athlete_points")}</span><div className="pk-big num">{data.athlete_points || 0}</div></div>
        <div className="panel"><span className="label">{s("plays")}</span><div className="pk-big num">{(data.totals && data.totals.courses) || 0}</div></div>
        <div className="panel"><span className="label">{s("wins")}</span><div className="pk-big num">{(data.totals && data.totals.wins) || 0}</div></div>
      </div>

      <section className="space-y-2">
        <h2>{s("tab_courses")}</h2>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {COURSES.map((c) => {
            const r = courses[c.key];
            return (
              <div key={c.key} className="panel pk-recordcard">
                <div className="flex items-center gap-2">
                  {c.medal && <MedalBadge stat={c.medal} size={34} />}
                  <h3 className="grow">{s(`course_${c.key}`)}</h3>
                  {r && r.medal && <span className={`chip pk-${r.medal}`}>{s(r.medal)}</span>}
                </div>
                {r ? (
                  <dl className="pk-dl">
                    <dt>{s("best_total")}</dt><dd className="num">{r.best}</dd>
                    <dt>{s("plays")}</dt><dd className="num">{r.plays}</dd>
                    <dt>{s("wins")}</dt><dd className="num">{r.wins}</dd>
                  </dl>
                ) : <p className="help">{s("no_record")}</p>}
              </div>
            );
          })}
        </div>
      </section>

      <section className="space-y-2">
        <h2>{s("top5")}</h2>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {EVENT_ORDER.map((id) => {
            const meta = EVENT_META[id];
            const list = events[id] || [];
            return (
              <div key={id} className="panel pk-recordcard">
                <h3>{EVENTS[id].names[en]}</h3>
                <div className="help">{s("target")}: {formatScore(id, meta.target)} · {s("trophy")}: {formatScore(id, meta.trophy)} · {s(UNITS[meta.unit])}</div>
                {list.length ? (
                  <ol className="pk-top">
                    {list.map((e, i) => (
                      <li key={i}>
                        <strong className="num">{formatScore(id, e.score)}</strong>
                        <span className="pk-icons">{(e.species || []).map((sp, j) => <img key={j} src={sprites.fallback(sp)} alt="" title={sp} width="24" height="24" className="pixelated" loading="lazy" />)}</span>
                      </li>
                    ))}
                  </ol>
                ) : <p className="help">{s("no_record")}</p>}
              </div>
            );
          })}
        </div>
      </section>

      {medals.length > 0 && (
        <section className="space-y-2">
          <h2>{s("medals_title")}</h2>
          <div className="pk-medalgrid">
            {medals.map((m) => (
              <div key={`${m.species}`} className="panel pk-medalcard">
                <img src={sprites.fallback(m.species)} alt="" width="40" height="40" className="pixelated" loading="lazy" />
                <strong className="trunc">{m.species}</strong>
                <span className="pk-medalbits">
                  {STAT_KEYS.map((k) => (m.mask & MEDAL_BITS[k] ? <MedalBadge key={k} stat={k} size={20} /> : <span key={k} className="pk-nomedal" />))}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
