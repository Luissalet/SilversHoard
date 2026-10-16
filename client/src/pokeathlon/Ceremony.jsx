// The closing ceremony (SPEC 3.4): the bonuses one by one, the points of every event, the totals, the winner (a tie for first is drawn by
// lots), the medal, and the saving of the result.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../context.js";
import { MedalBadge, TeamIcons } from "./parts.jsx";
import { hashSeed, makeRng } from "./core.js";
import { savePayload } from "./course.js";
import { saveResult } from "./data.js";
import { EVENTS } from "./events/index.js";
import { makeS } from "./strings.js";

const EFFORT = ["effort_jumped", "effort_hit", "effort_failed", "effort_dashed"];

function CountUp({ to, ms = 900 }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const tick = (now) => {
      const f = Math.min(1, (now - t0) / ms);
      setV(Math.round(to * (1 - (1 - f) * (1 - f))));
      if (f < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, ms]);
  return <>{v}</>;
}

/** props: course (the Course), config, onExit(), onAgain(); canSave=false for a friend's or a spectator's page (the host's page saves the room's result). */
export default function Ceremony({ course, config, onExit, onAgain, canSave = true }) {
  const { lang } = useApp();
  const s = useMemo(() => makeS(lang), [lang]);
  const closing = useMemo(() => course.closing(makeRng(hashSeed(config.seed, "closing"))), [course, config.seed]);
  const [shown, setShown] = useState(0);
  const [saved, setSaved] = useState(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const didSave = useRef(false);
  const b = closing.bonus;

  const steps = useMemo(() => {
    const list = [
      { id: "challenge", label: s("bonus_challenge"), help: s("bonus_challenge_help"), values: b.challenge },
      { id: "noMiss", label: s("bonus_nomiss"), help: s("bonus_nomiss_help"), values: b.noMiss, mons: b.noMissMons },
      { id: "leader", label: s("bonus_leader"), help: s("bonus_leader_help"), values: b.leader, mons: b.leaderMons },
      {
        id: "effort", label: b.effortKind >= 0 ? `${s("bonus_effort")}: ${s(EFFORT[b.effortKind])}` : s("bonus_effort"),
        help: b.effortKind >= 0 ? "" : s("bonus_effort_none"), values: b.effort, mons: b.effortMons,
      },
    ];
    closing.rounds.forEach((r, i) => list.push({ id: `ev${i}`, label: s("event_points", { name: EVENTS[r.event].names[lang === "en" ? "en" : "es"] }), values: r.points }));
    list.push({ id: "total", label: s("total_points"), values: closing.totals, total: true });
    return list;
  }, [closing, b, s, lang]);

  useEffect(() => {
    if (shown >= steps.length) return undefined;
    const id = setTimeout(() => setShown((n) => n + 1), 1100);
    return () => clearTimeout(id);
  }, [shown, steps.length]);

  useEffect(() => {
    if (didSave.current || config.mode === "watch" || !canSave) return;
    didSave.current = true;
    saveResult(savePayload(course, closing, { mode: config.mode, lang })).then(setSaved).catch(() => setSaveFailed(true));
  }, [course, closing, config.mode, lang, canSave]);

  const done = shown >= steps.length;
  const winner = config.teams[closing.winner];
  const watch = config.mode === "watch";
  const ordered = [0, 1, 2, 3].sort((x, y) => closing.place[x] - closing.place[y] || closing.totals[y] - closing.totals[x] || x - y);

  return (
    <div className="pk-ceremony panel space-y-4">
      <div className="flex items-center gap-2">
        <h1 className="grow">{s("ceremony")}</h1>
        {!done && <button type="button" className="btn btn-sm" onClick={() => setShown(steps.length)}>{s("skip")}</button>}
      </div>
      <div className="overflow-x-auto">
        <table className="pk-table pk-ceremony-table">
          <thead>
            <tr>
              <th />
              {config.teams.map((t) => (
                <th key={t.index} style={{ "--team": t.color }} className={t.human ? "is-you" : ""}>
                  <span className="pk-dot" /> {t.name}
                  <div><TeamIcons team={t} size={26} /></div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {steps.slice(0, shown).map((step) => (
              <tr key={step.id} className={`pk-row-in${step.total ? " is-total" : ""}`}>
                <th scope="row">{step.label}{step.help && <small>{step.help}</small>}</th>
                {config.teams.map((t, ti) => (
                  <td key={ti} className="num" style={{ "--team": t.color }}>
                    {step.total ? <strong><CountUp to={step.values[ti]} /></strong> : <span className={step.values[ti] ? "" : "pk-zero"}>{step.values[ti] ? `+${step.values[ti]}` : "0"}</span>}
                    {step.mons && step.mons.filter((m) => m.team === ti).length > 0 && (
                      <span className="pk-icons">
                        {step.mons.filter((m) => m.team === ti).map((m) => (
                          <MonMini key={m.slot} team={t} slot={m.slot} />
                        ))}
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {done && (
        <div className="pk-winner" style={{ "--team": winner.color }}>
          <div className="pk-confetti" aria-hidden="true">{Array.from({ length: 28 }, (_, i) => <i key={i} style={{ left: `${(i * 37) % 100}%`, animationDelay: `${(i % 9) * 0.18}s` }} />)}</div>
          {closing.tie && <p className="pk-tie">{s("tie_title")}</p>}
          <h2>{s("winner_is", { name: winner.name })}</h2>
          <p className="num">{s("with_points", { n: closing.totals[closing.winner] })}</p>
          <TeamIcons team={winner} size={44} />
          {config.medal && !watch && canSave && !config.single && (
            <div className="pk-medalrow">
              <MedalBadge stat={config.medal} />
              <div>
                <strong>{s("medal_awarded", { name: winner.name, medal: s(`medal_${config.medal}`) })}</strong>
                <div className="help">{s("medal_for_mons")}</div>
              </div>
            </div>
          )}
          {!config.medal && !watch && canSave && !config.single && <p className="help">{s("no_medal")}</p>}
          {!canSave && <p className="help">{s("room_guest_note")}</p>}
          {watch && <p className="help">{s("no_medal_watch")}</p>}
          <ol className="pk-podium">
            {ordered.map((ti) => (
              <li key={ti} style={{ "--team": config.teams[ti].color }}>
                <span className="pk-place">{closing.place[ti] + 1}</span> {config.teams[ti].name} <span className="num">{closing.totals[ti]}</span>
              </li>
            ))}
          </ol>
          {saved && saved.new_course_record && <p className="pk-record">{s("new_course_record")}</p>}
          {saved && !saved.new_course_record && <p className="help">{s("saved")}</p>}
          {saveFailed && <p className="help">{s("not_saved")}</p>}
        </div>
      )}

      {done && (
        <div className="flex flex-wrap gap-2">
          {onAgain && <button type="button" className="btn btn-primary" onClick={onAgain} autoFocus>{s("again")}</button>}
          <button type="button" className="btn" onClick={onExit}>{s("finish")}</button>
        </div>
      )}
    </div>
  );
}

function MonMini({ team, slot }) {
  const { sprites } = useApp();
  const m = team.mons[slot];
  return <img src={sprites.fallback(m.species)} alt={m.name} title={m.name} width="26" height="26" className="pixelated" loading="lazy" />;
}
