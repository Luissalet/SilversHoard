// The friend's side of a Pokéathlon room (silvers_hoard/pokeathlon_rooms.py), the page the room server serves at /p/<room>?k=<key> (to play)
// and /pw/<room>?k=<key> (to watch). It carries the Pokéathlon runtime and events and talks to the room server only: the table of Pokémon
// for the team editor, the join, the walking sprites (through /pkr/<room>/<key>/…) and the WebSocket. Silver's Hoard is not needed.
import React, { useEffect, useMemo, useState } from "react";
import { dexNum } from "../../../engine/src/core.mjs";
import { AppContext } from "../context.js";
import { makeSprites } from "../battle/dex.js";
import RoomStage from "../pokeathlon/RoomStage.jsx";
import { TeamEditor } from "../pokeathlon/TeamEditor.jsx";
import { TEAM_COLORS } from "../pokeathlon/core.js";
import { cleanTeam, rowsById } from "../pokeathlon/data.js";
import { roomSocketUrl } from "../pokeathlon/pknet.js";
import { EVENTS } from "../pokeathlon/events/index.js";
import { makeS } from "../pokeathlon/strings.js";
import "../pokeathlon/pokeathlon.css";

const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* not critical */ } },
};

async function getJson(url) {
  const r = await fetch(url);
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(out.error || `HTTP ${r.status}`);
  return out;
}

function JoinForm({ room, s, lang, sprites, onJoined }) {
  const [rows, setRows] = useState(null);
  const [name, setName] = useState(() => store.get("silver-pkroom-name") || "");
  const [team, setTeam] = useState(() => store.get("silver-pkroom-team"));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    getJson(`/api/pk/${room.id}/stats?k=${encodeURIComponent(room.key)}`).then((r) => setRows(r.species)).catch((e) => setError(s("room_load_error", { error: e.message })));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const byId = useMemo(() => (rows ? rowsById(rows) : null), [rows]);
  const mine = useMemo(() => (rows ? cleanTeam(team, rows, name || s("my_team_default")) : null), [rows, team, name, lang]); // eslint-disable-line react-hooks/exhaustive-deps
  const en = lang === "en" ? "en" : "es";
  const title = room.view.event ? `${s("course_single")}: ${EVENTS[room.view.event].names[en]}` : s(`course_${room.view.course}`);
  const join = async () => {
    setBusy(true);
    setError("");
    try {
      store.set("silver-pkroom-name", name.trim());
      store.set("silver-pkroom-team", mine);
      const body = { k: room.key, name: name.trim(), team: { name: mine.name, mons: mine.mons.map((m) => ({ species: byId.get(m.id).name, stars: m.stars || {} })) } };
      const r = await fetch(`/api/pk/${room.id}/join`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const out = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(r.status === 409 ? s(out.error && /started/i.test(out.error) ? "room_join_started" : "room_join_full") : s("room_join_error", { error: out.error || r.status }));
      store.set(`silver-pkroom-${room.id}`, { seat: out.seat, key: out.seat_key });
      onJoined(out);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const taken = room.view.seats.filter((x) => x.name);
  return (
    <section className="panel space-y-3">
      <h2>{title}</h2>
      <p className="help">{s("room_join_help")}</p>
      <p className="help">{taken.length ? s("room_players", { names: taken.map((x) => x.name).join(", ") }) : ""}</p>
      <label className="block"><span className="label">{s("room_join_name")}</span><input className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} /></label>
      {mine && <TeamEditor team={mine} rows={rows} byId={byId} onChange={setTeam} s={s} sprites={sprites} color={TEAM_COLORS[1]} title={s("your_team")} />}
      {!rows && !error && <p className="help">{s("room_loading")}</p>}
      {error && <div className="banner banner-warn" role="alert">{error}</div>}
      <button type="button" className="btn btn-primary" onClick={join} disabled={busy || !mine || !name.trim()}>{s("room_join_button")}</button>
    </section>
  );
}

export default function PkRoomApp({ data }) {
  const room = data.room;
  const watch = room.role === "watch";
  const [lang, setLang] = useState(() => (typeof navigator !== "undefined" && !String(navigator.language || "es").startsWith("es") ? "en" : "es"));
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  const s = useMemo(() => makeS(lang), [lang]);
  const sprites = useMemo(() => makeSprites({ server: data.sprite_server || "https://play.pokemonshowdown.com/sprites", set: data.sprite_set || "gen5ani", dexNum }), [data]);
  // who this page plays as: the team key of the link (the host's own key), or the one a join gave back (kept for a reload)
  const [seatKey, setSeatKey] = useState(() => {
    if (watch) return room.key;
    if (room.seat >= 0) return room.key;
    const kept = store.get(`silver-pkroom-${room.id}`);
    return kept && kept.key ? kept.key : "";
  });
  const [gone, setGone] = useState(false);
  const ctx = useMemo(() => ({
    lang, setLang, sprites, settings: {}, go: () => {}, confirm: async (o) => window.confirm(o && o.message ? o.message : "?"),
    notify: () => {}, toastError: () => {}, t: (k) => k,
  }), [lang, sprites]);
  const wsUrl = seatKey ? roomSocketUrl({ path: `/api/pk/${room.id}/ws?k=${encodeURIComponent(seatKey)}` }) : "";
  const base = `/pkr/${room.id}/${seatKey || room.key}`;
  const en = lang === "en" ? "en" : "es";

  return (
    <AppContext.Provider value={ctx}>
      <div className="p-wrap pk-guest">
        <header className="p-head">
          <div className="p-target"><h1>{watch ? s("room_watch_title") : s("room_join_title")}</h1></div>
          <button type="button" className="btn btn-sm" onClick={() => setLang(en === "es" ? "en" : "es")}>{en === "es" ? "English" : "Castellano"}</button>
        </header>
        {gone ? (
          <div className="panel space-y-3"><h2>{s("room_closed")}</h2><p className="help">{s("room_closed_help")}</p></div>
        ) : seatKey ? (
          <RoomStage room={room.view} wsUrl={wsUrl} base={base} onExit={() => { if (!watch) { try { localStorage.removeItem(`silver-pkroom-${room.id}`); } catch { /* ok */ } } setGone(true); }} />
        ) : room.view.status !== "waiting" ? (
          <div className="panel"><p>{s("room_join_started")}</p></div>
        ) : (
          <JoinForm room={room} s={s} lang={lang} sprites={sprites} onJoined={(out) => setSeatKey(out.seat_key)} />
        )}
      </div>
    </AppContext.Provider>
  );
}
