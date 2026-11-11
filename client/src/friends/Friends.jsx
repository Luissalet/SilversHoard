import React, { useEffect, useRef, useState } from "react";
import Arena from "../battle/Arena.jsx";
import Controls from "../battle/Controls.jsx";
import { makeSprites } from "../battle/dex.js";
import { useBattlePlayer } from "../battle/player.js";
import { installSmoothArt } from "../smooth-art.js";
import { friendsText } from "./strings.js";
import { decodeSignal, DuelPeer, encodeSignal } from "./peer.js";
import { duelRules, duelTeam, HostedDuel } from "./duel.js";

const sprites = makeSprites({ server: "https://play.pokemonshowdown.com/sprites", set: "gen5" });
const baseFormat = "gen9customgame";

function Field({ label, children }) {
  return <label className="friends-field"><span className="label">{label}</span>{children}</label>;
}

function CodeField({ label, code, t }) {
  const field = useRef(null);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      field.current?.focus();
      field.current?.select();
    }
  };
  return <div className="friends-code">
    <Field label={label}><textarea className="field" rows={2} ref={field} value={code} readOnly /></Field>
    <button type="button" className="btn" onClick={copy}>{t(copied ? "copied" : "copy")}</button>
  </div>;
}

function Battle({ view, side, lang, pending, choose, t }) {
  const player = useBattlePlayer({ lang, me: side, speedMs: 725 });
  const offset = useRef(0);
  useEffect(() => {
    const incoming = view.lines.slice(offset.current);
    if (incoming.length) player.push(incoming);
    offset.current = view.lines.length;
  }, [view.lines, player]);
  const seats = { p1: { name: view.names.p1 }, p2: { name: view.names.p2 } };
  const showResult = view.ended && player.state.ended && player.caughtUp;
  const request = !view.ended && !pending && player.total === view.lines.length && player.caughtUp && !view.request?.done && view.request;
  return <>
    <Arena player={player} seats={seats} me={side} sprites={sprites} lang={lang}>
      {request
        ? <Controls request={request} lang={lang} sprites={sprites} gametype={player.state.gametype}
          onChoose={choose} onForfeit={() => { if (confirm(t("forfeit"))) choose("forfeit"); }} />
        : !view.ended && <div className="b-controls"><div className="b-wait">{t("waiting")}</div></div>}
    </Arena>
    {showResult && <h2 className="friends-result" role="status">{view.winner ? t("won", { name: view.winner }) : t("tied")}</h2>}
  </>;
}

export default function Friends({ artReady }) {
  const [lang, setLang] = useState(() => navigator.language.startsWith("es") ? "es" : "en");
  const t = (key, params) => friendsText(lang, key, params);
  const [role, setRole] = useState(location.hash ? "guest" : "host");
  const [name, setName] = useState("");
  const [paste, setPaste] = useState("");
  const [format, setFormat] = useState(baseFormat);
  const [level, setLevel] = useState("");
  const [custom, setCustom] = useState(null);
  const [invite, setInvite] = useState(location.hash ? location.href : "");
  const [reply, setReply] = useState("");
  const [share, setShare] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [connection, setConnection] = useState("");
  const [view, setView] = useState(null);
  const [pending, setPending] = useState(null);
  const [artStatus, setArtStatus] = useState(null);
  const room = useRef(null);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  useEffect(() => {
    installSmoothArt();
    artReady.then(setArtStatus);
    return () => room.current?.peer.close();
  }, [artReady]);

  const showState = (state) => {
    setView((previous) => ({ ...state, lines: [...(previous?.lines || []), ...state.lines] }));
    setPending((revision) => revision === state.revision && !state.ended ? revision : null);
  };
  const publish = (active) => {
    showState(active.duel.state("p1"));
    if (!active.peer.send({ kind: "state", state: active.duel.state("p2") })) setConnection("failed");
  };
  const receive = (active, packet) => {
    if (active.role === "guest") {
      if (packet.kind === "state" && Array.isArray(packet.state?.lines) && packet.state.names) showState(packet.state);
      if (packet.kind === "error") { setError(String(packet.message || "invalidChoice")); setPending(null); }
      return;
    }
    if (packet.kind === "join" && !active.duel) {
      try {
        const opponent = duelTeam(active.settings, packet.name, packet.paste);
        active.duel = new HostedDuel(active.settings, active.own, opponent);
        publish(active);
      } catch (e) {
        active.peer.send({ kind: "error", message: e.message === "team" ? "invalidTeam" : e.message });
      }
    } else if (packet.kind === "choice" && active.duel) {
      try {
        active.duel.play("p2", packet);
        publish(active);
      } catch {
        active.peer.send({ kind: "error", message: "invalidChoice" });
      }
    }
  };
  const makeRoom = (id, settings, own) => {
    const active = { id, settings, role, own };
    active.peer = new DuelPeer({
      localOnly: new URLSearchParams(location.search).get("ice") === "local",
      onMessage: (packet) => { if (room.current === active) receive(active, packet); },
      onState: (state) => {
        if (room.current !== active) return;
        setConnection(state === "closed" ? "disconnected" : state);
        if (state === "open" && role === "guest" && !active.joined) active.joined = active.peer.send({ kind: "join", name, paste });
      },
    });
    room.current = active;
    return active;
  };
  const setup = async (event) => {
    event.preventDefault();
    setError("");
    if (!globalThis.RTCPeerConnection || !globalThis.crypto?.randomUUID) { setError("noBrowser"); return; }
    setBusy(true);
    try {
      const incoming = role === "guest" ? decodeSignal(invite, "offer") : null;
      const settings = duelRules(incoming?.settings || custom || {
        name: format, format, rules: [], level_rules: level ? { level: Number(level) } : {},
      });
      const own = duelTeam(settings, name, paste);
      const active = makeRoom(incoming?.id || crypto.randomUUID(), settings, own);
      if (incoming) {
        const response = await active.peer.answer(incoming.description);
        setShare(encodeSignal(active.id, response));
      } else {
        const offer = await active.peer.offer();
        const link = new URL(location.href);
        link.hash = encodeSignal(active.id, offer, settings);
        setShare(link.href);
      }
    } catch (e) {
      const previous = room.current;
      room.current = null;
      previous?.peer.close();
      setError(e.message === "ruleset" ? "invalidRules" : e.message === "team" ? "invalidTeam" : e.message);
    } finally {
      setBusy(false);
    }
  };
  const connect = async (event) => {
    event.preventDefault();
    const active = room.current;
    setError("");
    try {
      await active.peer.accept(decodeSignal(reply, "answer", active.id).description);
      setConnection((state) => state || "connecting");
    } catch (e) {
      setError(e.message === "signal" ? "signal" : "failed");
    }
  };
  const choose = (choice) => {
    const active = room.current;
    setError("");
    const command = { kind: "choice", choice, revision: view.revision };
    if (role === "guest") {
      if (active.peer.send(command)) setPending(view.revision);
      else setError("disconnected");
      return;
    }
    try {
      active.duel.play("p1", command);
      publish(active);
    } catch {
      setError("invalidChoice");
    }
  };
  const restart = () => {
    if (view && !view.ended && !confirm(t("leave"))) return;
    const previous = room.current;
    room.current = null;
    previous?.peer.close();
    history.replaceState(null, "", location.pathname + location.search);
    setRole("host"); setShare(""); setInvite(""); setReply(""); setView(null);
    setPending(null); setConnection(""); setError("");
  };
  const importRules = async (event) => {
    const file = event.currentTarget.files[0];
    event.currentTarget.value = "";
    if (!file) return;
    setError("");
    try {
      if (file.size > 64000) throw new Error();
      const document = JSON.parse(await file.text());
      if (document.kind !== "silver.ruleset" || document.version !== 1) throw new Error();
      setCustom(duelRules(document.ruleset));
    } catch {
      setError("invalidRules");
    }
  };
  const report = (message) => {
    try { return t(message); } catch { return message; }
  };
  const settings = room.current?.settings || custom;
  const side = role === "host" ? "p1" : "p2";
  return <main className={`p-wrap friends ${view ? "" : "friends-lobby"}`}>
    <header className="friends-head">
      <div><p className="friends-brand">Silver's Hoard</p><h1>{t("title")}</h1></div>
      <button type="button" className="btn btn-sm" onClick={() => setLang(lang === "es" ? "en" : "es")}>{lang === "es" ? "English" : "Español"}</button>
    </header>
    {artStatus === false && <p className="help" role="status">{t("artFailed")}</p>}
    {error && <p className="banner banner-warn" role="alert">{report(error)}</p>}
    {["failed", "disconnected"].includes(connection) && <p className="banner banner-warn" role="alert">{t(connection)}</p>}
    {view ? <>
      <Battle view={view} side={side} lang={lang} pending={pending !== null} choose={choose} t={t} />
      <button type="button" className="btn friends-exit" onClick={restart}>{t(view.ended ? "newRoom" : "cancelRoom")}</button>
    </> : <section className="friends-room">
      {settings && <p className="friends-rules">{t("ruleset")} <strong>{settings.name}</strong> <span>{settings.rules.join(", ")}</span></p>}
      {share ? <div className="friends-stack">
        <p>{t(role === "host" ? "offer_help" : "response_help")}</p>
        <CodeField label={t(role === "host" ? "offer" : "response")} code={share} t={t} />
        {role === "host" && !["connecting", "open"].includes(connection) &&
          <form className="friends-stack" onSubmit={connect}>
            <Field label={t("response")}><textarea className="field" rows={2} required value={reply} onChange={(e) => setReply(e.target.value)} /></Field>
            <button className="btn btn-primary">{t("connect")}</button>
          </form>}
        {!["failed", "disconnected"].includes(connection) &&
          <p role="status" className="help">{t(connection === "open" ? "connectingTeam" : connection ? "connecting" : "waiting")}</p>}
        <button type="button" className="btn friends-exit" onClick={restart}>{t("newRoom")}</button>
      </div> : <>
        <p>{t("description")}</p>
        <div className="seg friends-modes" role="group" aria-label={t("title")}>
          <button type="button" disabled={busy} aria-pressed={role === "host"} onClick={() => { setRole("host"); setError(""); }}>{t("hostTab")}</button>
          <button type="button" disabled={busy} aria-pressed={role === "guest"} onClick={() => { setRole("guest"); setError(""); }}>{t("guest")}</button>
        </div>
        <form className="friends-stack" onSubmit={setup}>
          {role === "guest" && <Field label={t("offer")}><textarea className="field" rows={2} required value={invite} onChange={(e) => setInvite(e.target.value)} /></Field>}
          <Field label={t("name")}><input className="field" required maxLength={40} autoComplete="nickname" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label={t("team")}><textarea className="field friends-team" rows={6} required maxLength={16000} value={paste} onChange={(e) => setPaste(e.target.value)} /></Field>
          {role === "host" && <>
            {!custom && <div className="friends-options">
              <Field label={t("format")}><input className="field" required maxLength={120} value={format} onChange={(e) => setFormat(e.target.value)} /></Field>
              <Field label={t("fixed")}><input className="field" type="number" min="1" max="100" value={level} onChange={(e) => setLevel(e.target.value)} /></Field>
            </div>}
            <div className="friends-import">
              <Field label={t("custom")}><input type="file" className="field" accept=".json,application/json" onChange={importRules} /></Field>
              {custom && <button type="button" className="btn" aria-label={t("clearRules")} onClick={() => setCustom(null)}>×</button>}
            </div>
          </>}
          <button className="btn btn-primary" disabled={busy || artStatus === null}>{t(busy ? "preparing" : role === "host" ? "host" : "join")}</button>
        </form>
      </>}
    </section>}
    {artStatus && <footer><a className="help" href="./art/CREDITS.md" target="_blank" rel="noreferrer">{t("credits")}</a></footer>}
  </main>;
}
