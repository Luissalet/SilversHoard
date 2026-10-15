// Live battle with a friend on another computer (silvers_hoard/pvp.py): open a room with one of your trainers, send the link, wait for
// the friend to join with their team and start. Turn by turn or in real time. Each room also has a watch link for an audience, your
// lobby lists your open rooms to the friends who have its address, and your friends' lobbies list theirs here.
import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { useApp } from "../context.js";
import { Busy, Field, useBusy, useStored } from "../components/ui.jsx";
import { FormatSelect, TrainerSelect } from "../components/silver.jsx";
import { usePoll } from "../components/hooks.js";
import { useCustomArenas } from "../battle/rt/ModeFields.jsx";

function CopyLink({ url, t }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* the text can be selected by hand */ }
  };
  return (
    <div className="flex items-center gap-2 min-w-0">
      <input className="field font-mono text-xs flex-1 min-w-0" readOnly value={url} onFocus={(e) => e.target.select()} aria-label={t("pvp_link")} />
      <button type="button" className="btn btn-sm" onClick={copy}>{done ? t("copied") : t("copy")}</button>
    </div>
  );
}

function Room({ room, onClosed }) {
  const { t, go, changed } = useApp();
  const [r, setR] = useState(room);
  const [busy, run] = useBusy();
  usePoll(async () => {
    try { setR(await api.call("pvp_get", { room: room.id })); } catch { onClosed(); }
  }, 1500, r.status === "waiting" || r.status === "ready" || r.status === "live");
  const start = () => run("start", async () => {
    const out = await api.call("pvp_start", { room: room.id });
    changed();
    go(`#/combate/${out.battle.id}`);
  });
  const close = () => run("close", async () => { await api.call("pvp_close", { room: room.id }); onClosed(); });
  const links = r.links || {};
  return (
    <div className="panel space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <b>{t("pvp_room", { id: r.id })}</b>
        <span className="chip">{t(r.mode === "realtime" ? "mode_realtime" : "mode_classic")}</span>
        <span className="chip">{r.format}</span>
        <span className={`chip ${r.status === "ready" ? "chip-ok" : r.status === "waiting" ? "chip-amber" : "chip-accent"}`}>{t(`pvp_status_${r.status}`)}</span>
      </div>
      <p className="help">{t("pvp_send_link")}</p>
      <div className="space-y-2">
        {(links.lan || []).map((u) => <CopyLink key={u} url={u} t={t} />)}
        {links.public && <CopyLink url={links.public} t={t} />}
      </div>
      <p className="help">{links.public ? t("pvp_public_set") : t("pvp_lan_only", { port: links.port })}</p>
      {r.watch_links && (
        <details>
          <summary className="help cursor-pointer">{t("pvp_watch_link")}{r.spectators ? ` · ${t("pvp_spectators", { n: r.spectators })}` : ""}</summary>
          <div className="space-y-2 mt-2">
            {(r.watch_links.lan || []).map((u) => <CopyLink key={u} url={u} t={t} />)}
            {r.watch_links.public && <CopyLink url={r.watch_links.public} t={t} />}
          </div>
        </details>
      )}
      {r.guest ? (
        <div className="banner banner-info">{t("pvp_joined", { name: r.guest.name, n: r.guest.species.length })} <span className="help">{r.guest.species.join(", ")}</span></div>
      ) : <div className="help">{t("pvp_waiting_join")}</div>}
      {r.battle_id && <a className="btn" href={`#/combate/${r.battle_id}`}>{t("pvp_open_battle")}</a>}
      <div className="flex flex-wrap gap-2">
        <Busy busy={busy.start} className="btn btn-primary" disabled={r.status !== "ready"} onClick={start}>{t("pvp_start")}</Busy>
        <Busy busy={busy.close} className="btn" onClick={close}>{t("pvp_close")}</Busy>
      </div>
    </div>
  );
}

export default function LiveRoom() {
  const { t } = useApp();
  const arenas = useCustomArenas();
  const [me, setMe] = useStored("silver-pvp-me", "");
  const [mode, setMode] = useStored("silver-pvp-mode", "classic");
  const [format, setFormat] = useState("");
  const [level, setLevel] = useStored("silver-pvp-level", 0);
  const [arena, setArena] = useStored("silver-pvp-arena", "rocks");
  const [limit, setLimit] = useStored("silver-pvp-limit", 300);
  const [listed, setListed] = useStored("silver-pvp-listed", true);
  const [rooms, setRooms] = useState([]);
  const [busy, run] = useBusy();
  const reload = () => api.call("pvp_get", {}).then((r) => setRooms((r.rooms || []).filter((x) => x.status !== "ended"))).catch(() => {});
  useEffect(() => { reload(); }, []);
  const open = () => run("open", async () => {
    const r = await api.call("pvp_open", { trainer_id: me, mode, format, level_rules: Number(level) ? { level: Number(level) } : {}, rt_arena: arena, time_limit: Number(limit), listed: !!listed });
    setRooms((old) => [r, ...old]);
  });
  return (
    <div className="space-y-4">
      <div className="panel space-y-3">
        <p className="help">{t("pvp_help")}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <TrainerSelect label={t("pvp_you")} value={me} onChange={setMe} id="pvp-me" />
          <Field label={t("battle_mode")}>
            <div className="seg" role="group" aria-label={t("battle_mode")}>
              {["classic", "realtime"].map((v) => <button key={v} type="button" aria-pressed={mode === v} onClick={() => setMode(v)}>{t(`mode_${v}`)}</button>)}
            </div>
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t("format")}><FormatSelect id="pvp-format" value={format} onChange={setFormat} /></Field>
          <Field label={t("eq_title")}>
            <select className="field" value={level} onChange={(e) => setLevel(e.target.value)}>
              <option value={0}>{t("eq_off")}</option><option value={50}>50</option><option value={100}>100</option>
            </select>
          </Field>
          {mode === "realtime" && (
            <Field label={t("rt_arena")}>
              <select className="field" value={arena} onChange={(e) => setArena(e.target.value)}>
                <option value="open">{t("rt_arena_open")}</option>
                <option value="rocks">{t("rt_arena_rocks")}</option>
                {arenas.map((a) => <option key={a.id} value={a.value}>{a.name}</option>)}
              </select>
            </Field>
          )}
          {mode === "realtime" && (
            <Field label={t("training_time")}>
              <select className="field" value={limit} onChange={(e) => setLimit(e.target.value)}>
                {[60, 120, 300, 600].map((n) => <option key={n} value={n}>{n >= 120 ? `${n / 60} min` : `${n} s`}</option>)}
              </select>
            </Field>
          )}
        </div>
        <label className="flex items-center gap-2"><input type="checkbox" checked={!!listed} onChange={(e) => setListed(e.target.checked)} />
          <span className="help">{t("pvp_listed")}</span></label>
        <Busy busy={busy.open} className="btn btn-primary" onClick={open} disabled={!me}>{t("pvp_open")}</Busy>
      </div>
      {rooms.map((r) => <Room key={r.id} room={r} onClosed={() => setRooms((old) => old.filter((x) => x.id !== r.id))} />)}
      <Friends />
      <Lobby key={rooms.length} />
    </div>
  );
}

/** Your lobby address: one link that lists your open rooms to the friends you give it. */
function Lobby() {
  const { t } = useApp();
  const [lobby, setLobby] = useState(null);
  const [busy, run] = useBusy();
  useEffect(() => { api.call("pvp_lobby", {}).then(setLobby).catch(() => {}); }, []);
  const renew = () => run("renew", async () => { if (window.confirm(t("pvp_lobby_new_q"))) setLobby(await api.call("pvp_lobby_new_code", {})); });
  if (!lobby) return null;
  return (
    <div className="panel space-y-2">
      <b>{t("pvp_lobby")}</b>
      <p className="help">{t("pvp_lobby_help")}</p>
      {(lobby.lan || []).map((u) => <CopyLink key={u} url={u} t={t} />)}
      {lobby.public && <CopyLink url={lobby.public} t={t} />}
      <Busy busy={busy.renew} className="btn btn-sm" onClick={renew}>{t("pvp_lobby_new")}</Busy>
    </div>
  );
}

/** Your friends' lobbies and the rooms they have open: join one that waits for a rival, watch one being played. */
function Friends() {
  const { t } = useApp();
  const [data, setData] = useState(null);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [busy, run] = useBusy();
  const load = (refresh = false) => api.call("pvp_friends", { refresh }).then(setData).catch(() => {});
  useEffect(() => { load(); }, []);
  usePoll(() => load(), 10000, true);
  const add = () => run("add", async () => { await api.call("pvp_friend_add", { name, url }); setName(""); setUrl(""); await load(true); });
  const remove = (id) => run(`rm${id}`, async () => { await api.call("pvp_friend_remove", { id }); await load(true); });
  const rows = data?.friends || [];
  return (
    <div className="panel space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <b>{t("pvp_friends")}</b>
        <Busy busy={busy.refresh} className="btn btn-sm" onClick={() => run("refresh", () => load(true))}>{t("pvp_refresh")}</Busy>
      </div>
      <p className="help">{t("pvp_friends_help")}</p>
      {!rows.length && <div className="help">{t("pvp_friends_empty")}</div>}
      {rows.map((f) => (
        <div key={f.friend.id} className="space-y-1 border-t border-white/10 pt-2">
          <div className="flex flex-wrap items-center gap-2">
            <b>{f.friend.name || f.name}</b>
            <span className="help font-mono text-xs truncate">{f.friend.url.replace(/[?]c=.*/, "")}</span>
            <Busy busy={busy[`rm${f.friend.id}`]} className="btn btn-sm ml-auto" onClick={() => remove(f.friend.id)}>{t("pvp_friend_remove")}</Busy>
          </div>
          {!f.ok ? <div className="help">{t(f.error === "forbidden" ? "pvp_friend_forbidden" : "pvp_friend_offline")}</div>
            : !f.rooms.length ? <div className="help">{t("pvp_friend_none")}</div>
              : f.rooms.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center gap-2">
                  <span>{r.guest ? t("pvp_vs", { a: r.host, b: r.guest }) : r.host}</span>
                  <span className="chip">{t(r.mode === "realtime" ? "mode_realtime" : "mode_classic")}</span>
                  <span className="chip">{r.format}</span>
                  <span className={`chip ${r.status === "waiting" ? "chip-amber" : "chip-accent"}`}>{t(`pvp_status_${r.status}`)}</span>
                  {r.spectators ? <span className="help">{t("pvp_spectators", { n: r.spectators })}</span> : null}
                  {r.join_url && <a className="btn btn-sm btn-primary" href={r.join_url} target="_blank" rel="noreferrer">{t("pvp_join")}</a>}
                  {r.watch_url && <a className="btn btn-sm" href={r.watch_url} target="_blank" rel="noreferrer">{t("pvp_watch")}</a>}
                </div>
              ))}
        </div>
      ))}
      <div className="grid gap-2 sm:grid-cols-[160px_1fr_auto] items-end">
        <Field label={t("pvp_friend_name")}><input className="field" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label={t("pvp_friend_url")}><input className="field font-mono text-xs" value={url} placeholder="http://192.168.1.20:5240/lobby?c=…" onChange={(e) => setUrl(e.target.value)} /></Field>
        <Busy busy={busy.add} className="btn" onClick={add} disabled={url.trim().length < 10}>{t("pvp_friend_add")}</Busy>
      </div>
    </div>
  );
}
