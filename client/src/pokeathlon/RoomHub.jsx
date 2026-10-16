// The "With friends" tab of the Pokéathlon page: open a room (a course, the Supreme one or a single event) for up to three friends on other
// computers, see and re-enter the rooms that are open, and play in one as the host (RoomStage). Friends join with a link in any browser.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import { useApp } from "../context.js";
import { useStored } from "../components/ui.jsx";
import { useTrainers } from "../components/silver.jsx";
import { TEAM_COLORS } from "./core.js";
import { COURSES } from "./course.js";
import { cleanTeam, rowsById } from "./data.js";
import { EVENTS } from "./events/index.js";
import { roomSocketUrl } from "./pknet.js";
import RoomStage from "./RoomStage.jsx";
import { TeamEditor } from "./TeamEditor.jsx";
import { makeS } from "./strings.js";

export default function RoomHub({ stats, onActive = null }) {
  const { lang, sprites, settings, toastError } = useApp();
  const s = useMemo(() => makeS(lang), [lang]);
  const en = lang === "en" ? "en" : "es";
  const rows = stats.rows;
  const byId = useMemo(() => rowsById(rows), [rows]);
  const trainers = useTrainers();
  const [saved, setSaved] = useStored("silver-pokeathlon-team", null);
  const mine = useMemo(() => cleanTeam(saved, rows, s("my_team_default")), [saved, rows, lang]); // eslint-disable-line react-hooks/exhaustive-deps
  const [kind, setKind] = useStored("silver-pokeathlon-room-kind", "speed");
  const [event, setEvent] = useStored("silver-pokeathlon-room-event", Object.keys(EVENTS)[0]);
  const [maxFriends, setMaxFriends] = useStored("silver-pokeathlon-room-friends", 3);
  const [supreme, setSupreme] = useStored("silver-pokeathlon-room-supreme", false);
  const [listed, setListed] = useStored("silver-pokeathlon-room-listed", true);
  const [hostName, setHostName] = useStored("silver-pokeathlon-room-name", "");
  const [rooms, setRooms] = useState([]);
  const [active, setActive] = useState(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => { if (onActive) onActive(!!active); return () => { if (onActive) onActive(false); }; }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = useCallback(() => api.call("pokeathlon_room_get", {}).then((r) => { if (alive.current) setRooms(r.rooms || []); }).catch(() => {}), []);
  useEffect(() => {
    alive.current = true;
    if (active) return () => { alive.current = false; };
    refresh();
    const id = setInterval(refresh, 4000);
    return () => { alive.current = false; clearInterval(id); };
  }, [active, refresh]);

  const open = async () => {
    setBusy(true);
    try {
      const team = { name: mine.name, mons: mine.mons.map((m) => ({ species: byId.get(m.id).name, stars: m.stars || {} })) };
      const view = await api.call("pokeathlon_room_open", {
        course: kind, event: kind === "single" ? event : "", supreme: !!supreme, host_name: hostName || settings.player_name || "", team, max_friends: maxFriends, listed,
      });
      setActive(view);
    } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  const close = async (id) => {
    try { await api.call("pokeathlon_room_close", { room: id }); } catch (e) { toastError(e); }
    setActive(null);
    refresh();
  };

  if (active) {
    return (
      <RoomStage room={active} wsUrl={roomSocketUrl({ path: active.ws_path, port: active.port })} host base="" onExit={() => { setActive(null); refresh(); }} onClose={() => close(active.id)} />
    );
  }

  const roomTitle = (r) => (r.event ? `${s("course_single")}: ${EVENTS[r.event].names[en]}` : s(`course_${r.course}`));
  return (
    <div className="pk-roomhub space-y-4">
      <p className="help">{s("room_intro")}</p>

      {rooms.length > 0 && (
        <div className="panel space-y-2">
          <h2>{s("room_open_rooms")}</h2>
          <ul className="pk-roomlist">
            {rooms.map((r) => (
              <li key={r.id} className="pk-roomrow">
                <div className="min-w-0 grow">
                  <strong>{roomTitle(r)}</strong>
                  <div className="help trunc">{r.seats.filter((x) => x.name).map((x) => x.name).join(", ")} · {s(`room_status_${r.status}`)}{r.spectators ? ` · ${s("room_spectators", { n: r.spectators })}` : ""}</div>
                </div>
                {r.status !== "ended" && <button type="button" className="btn btn-sm btn-primary" onClick={() => setActive(r)}>{s("room_enter")}</button>}
                <button type="button" className="btn btn-sm" onClick={() => close(r.id)}>{s("room_close")}</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="panel space-y-3">
        <h2>{s("room_new")}</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="label" htmlFor="pk-room-kind">{s("room_what")}</label>
            <select id="pk-room-kind" className="field" value={kind} onChange={(e) => setKind(e.target.value)}>
              {COURSES.map((c) => <option key={c.key} value={c.key}>{s(`course_${c.key}`)}</option>)}
              <option value="single">{s("course_single")}</option>
            </select>
          </div>
          {kind === "single" && (
            <div>
              <label className="label" htmlFor="pk-room-event">{s("event_to_play")}</label>
              <select id="pk-room-event" className="field" value={event} onChange={(e) => setEvent(e.target.value)}>
                {Object.keys(EVENTS).map((id) => <option key={id} value={id}>{EVENTS[id].names[en]}</option>)}
              </select>
            </div>
          )}
          <div>
            <span className="label">{s("room_friends")}</span>
            <div className="pk-choice pk-choice-row" role="radiogroup">
              {[1, 2, 3].map((n) => (
                <label key={n} className={maxFriends === n ? "on" : ""}>
                  <input type="radio" name="pk-room-friends" checked={maxFriends === n} onChange={() => setMaxFriends(n)} />
                  <span><strong>{n}</strong></span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="label" htmlFor="pk-room-name">{s("room_your_name")}</label>
            <input id="pk-room-name" className="field" value={hostName} maxLength={40} placeholder={settings.player_name || ""} onChange={(e) => setHostName(e.target.value)} />
          </div>
        </div>
        {kind !== "supreme" && (
          <label className="pk-check">
            <input type="checkbox" checked={supreme} onChange={(e) => setSupreme(e.target.checked)} />
            <span><strong>{s("diff_supreme")}</strong><small>{s("diff_help")}</small></span>
          </label>
        )}
        <label className="pk-check">
          <input type="checkbox" checked={listed} onChange={(e) => setListed(e.target.checked)} />
          <span><strong>{s("room_listed")}</strong><small>{s("room_listed_help")}</small></span>
        </label>
      </div>

      <TeamEditor team={mine} rows={rows} byId={byId} onChange={setSaved} s={s} sprites={sprites} color={TEAM_COLORS[0]} title={s("your_team")} trainers={trainers} />

      <div className="flex gap-2">
        <button type="button" className="btn btn-primary" onClick={open} disabled={busy}>{s("room_open")}</button>
      </div>
    </div>
  );
}
