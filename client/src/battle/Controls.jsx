// What a person chooses each turn, built from the simulator's request: lead order at team preview, moves (with targets in doubles
// and the generation's gimmick: Terastal, Mega, Z, Dynamax), switches, and forced switches after a faint. Sends a Showdown choice string.
import React, { useEffect, useMemo, useState } from "react";
import { TYPE_COLORS, nameOf, typeName } from "./dex.js";
import { battleT } from "./strings.js";
import { clickSound } from "../audio.js";

function parseCondition(cond) {
  const [hp, status] = String(cond || "").split(" ");
  if (hp === "0" || status === "fnt") return { frac: 0, fainted: true, status: "" };
  const [a, b] = hp.split("/").map(Number);
  return { frac: b ? a / b : 1, fainted: false, status: status || "", hp: a, maxhp: b };
}

function MonButton({ mon, index, onClick, disabled, sprites, lang, badge, selected }) {
  const c = parseCondition(mon.condition);
  const name = mon.ident.replace(/^p\d: /, "");
  return (
    <button type="button" className={`b-mon-btn ${selected ? "is-selected" : ""}`} disabled={disabled} onClick={onClick}
      title={`${name} · ${mon.species || ""}${mon.item_name ? ` @ ${nameOf("item", mon.item_name, lang)}` : ""}`}>
      <PartyPicture key={`${mon.species}:${mon.spriteid}:${sprites.pokemon(mon.species || name, { spriteid: mon.spriteid })}`} species={mon.species || name} spriteid={mon.spriteid} sprites={sprites} />
      <span className="b-mon-name trunc">{name}</span>
      <span className="b-mini-hp"><span style={{ width: `${c.frac * 100}%`, background: c.frac > 0.5 ? "var(--hp-ok)" : c.frac > 0.2 ? "var(--hp-mid)" : "var(--hp-low)" }} /></span>
      {badge && <span className="b-mon-badge">{badge}</span>}
    </button>
  );
}

function PartyPicture({ species, spriteid, sprites }) {
  const [failed, setFailed] = useState(0);
  if (failed > 1) return <span className="b-mon-icon" aria-label={species}>{species.slice(0, 2)}</span>;
  const src = failed ? sprites.fallback(species, { spriteid }) : sprites.pokemon(species, { spriteid });
  return <img key={`${failed}:${src}`} src={src} alt={species} className={`b-mon-icon ${sprites.pixelated ? "pixelated" : ""}`} onError={() => setFailed((n) => n + 1)} />;
}

function MoveButton({ move, onClick, disabled, lang, t, selected }) {
  const color = TYPE_COLORS[move.type] || "#777";
  const cat = move.category === "Physical" ? t("physical") : move.category === "Special" ? t("special") : t("status_cat");
  const tip = [move.desc, move.power ? `${t("power")}: ${move.power}` : "", move.accuracy ? `${t("accuracy")}: ${move.accuracy}%` : ""].filter(Boolean).join(" · ");
  return (
    <button type="button" className={`b-move ${selected ? "is-selected" : ""}`} style={{ "--type": color }} disabled={disabled} onClick={onClick} title={tip}>
      <span className="b-move-name">{nameOf("move", move.move, lang)}</span>
      <span className="b-move-meta">
        <span className="b-type" style={{ background: color }}>{typeName(move.type, lang)}</span>
        <span>{cat}{move.power ? ` · ${move.power}` : ""}</span>
        <span className="b-pp">{move.maxpp ? `${move.pp}/${move.maxpp}` : ""}</span>
      </span>
    </button>
  );
}

const TARGETED = ["normal", "any", "adjacentFoe", "adjacentAlly", "adjacentAllyOrSelf"];

/** props: request (annotated by the engine), lang, sprites, gametype, onChoose(choice), onForfeit, busy, sideLabel */
export default function Controls({ request, lang = "es", sprites, gametype = "singles", onChoose, onForfeit, busy, sideLabel }) {
  const t = battleT(lang);
  const [order, setOrder] = useState([]);
  const [parts, setParts] = useState([]);
  const [pending, setPending] = useState(null);
  const [gimmick, setGimmick] = useState(false);
  const reqKey = useMemo(() => JSON.stringify(request?.rqid ?? request), [request]);
  const pokemon = request?.side?.pokemon || [];
  const slots = request?.forceSwitch ? request.forceSwitch.length : (request?.active || []).length;
  const switchesIn = (list) => list.map((p) => /^switch (\d)/.exec(p)?.[1]).filter(Boolean).map(Number);
  const bench = (exclude) => pokemon.map((m, i) => ({ m, i })).filter(({ m, i }) => !m.active && !parseCondition(m.condition).fainted && !exclude.includes(i + 1) && !m.reviving);
  // slots that need nothing get "pass": no forced switch there, a fainted Pokémon with nobody left to send
  const fill = (list) => {
    const next = [...list];
    while (next.length < slots) {
      const s = next.length;
      if (request.forceSwitch && !request.forceSwitch[s]) { next.push("pass"); continue; }
      if (!request.forceSwitch && String(pokemon[s]?.condition || "").endsWith(" fnt")) { next.push("pass"); continue; }
      if (request.forceSwitch && !bench(switchesIn(next)).length) { next.push("pass"); continue; }
      break;
    }
    return next;
  };
  useEffect(() => {
    setOrder([]);
    setPending(null);
    setGimmick(false);
    if (!request || request.wait || request.done || request.teamPreview) { setParts([]); return; }
    const init = fill([]);
    if (slots > 0 && init.length >= slots) { setParts([]); if (!busy) onChoose(init.join(", ")); } else setParts(init);
  }, [reqKey]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!request) return null;
  if (request.wait || request.done) return <div className="b-controls"><div className="b-wait">{request.done ? t("chosen") : t("waiting")}</div></div>;

  const send = (choice) => { if (!busy) onChoose(choice); };

  if (request.teamPreview) {
    const need = Math.min(request.maxChosenTeamSize || pokemon.length, pokemon.length);
    const pickedAll = order.length >= need;
    return (
      <div className="b-controls" onClickCapture={clickSound}>
        <div className="b-ctrl-head"><b>{need < pokemon.length ? t("choose_n", { n: need }) : t("choose_lead")}</b>{sideLabel && <span className="help">{sideLabel}</span>}</div>
        <div className="b-team-grid">
          {pokemon.map((m, i) => {
            const pos = order.indexOf(i + 1);
            return <MonButton key={i} mon={m} index={i} sprites={sprites} lang={lang} selected={pos >= 0} badge={pos >= 0 ? String(pos + 1) : ""}
              disabled={busy || (pos < 0 && pickedAll)} onClick={() => setOrder((o) => (o.includes(i + 1) ? o.filter((x) => x !== i + 1) : [...o, i + 1]))} />;
          })}
        </div>
        <div className="b-ctrl-actions">
          <button type="button" className="btn btn-sm" onClick={() => setOrder([])} disabled={!order.length}>{t("reset")}</button>
          <button type="button" className="btn btn-primary btn-sm" disabled={busy || (!pickedAll && need < pokemon.length)}
            onClick={() => { const rest = pokemon.map((_, i) => i + 1).filter((x) => !order.includes(x)); send(`team ${[...order, ...rest].slice(0, need).join("")}`); }}>
            {t("start_battle")}
          </button>
        </div>
      </div>
    );
  }

  const slot = parts.length;
  const usedSwitches = switchesIn(parts);
  const advance = (choice) => {
    const next = fill([...parts, choice]);
    setPending(null);
    setGimmick(false);
    if (next.length >= slots) send(next.join(", "));
    else setParts(next);
  };

  if (request.forceSwitch) {
    const options = bench(usedSwitches);
    return (
      <div className="b-controls" onClickCapture={clickSound}>
        <div className="b-ctrl-head"><b>{t("choose_switch")}</b>{slots > 1 && <span className="help">{t("slot_n", { n: slot + 1 })}</span>}</div>
        <div className="b-team-grid">
          {options.map(({ m, i }) => <MonButton key={i} mon={m} sprites={sprites} lang={lang} disabled={busy} onClick={() => advance(`switch ${i + 1}`)} />)}
        </div>
        {parts.length > 0 && <div className="b-ctrl-actions"><button type="button" className="btn btn-sm" onClick={() => setParts([])}>{t("cancel")}</button></div>}
      </div>
    );
  }

  const active = request.active[slot] || {};
  const me = pokemon[slot] || {};
  const myName = (me.ident || "").replace(/^p\d: /, "");
  const gimmickKind = active.canTerastallize ? "terastallize" : active.canMegaEvo ? "mega" : active.canMegaEvoX ? "megax" : active.canMegaEvoY ? "megay"
    : active.canUltraBurst ? "ultra" : active.canDynamax ? "dynamax" : Array.isArray(active.canZMove) ? "zmove" : "";
  const gimmickUsed = parts.some((p) => / (terastallize|mega|megax|megay|ultra|dynamax|zmove)$/.test(p));
  const gimmickLabel = gimmickKind === "terastallize" ? t("terastallize", { type: typeName(active.canTerastallize, lang) }) : gimmickKind === "dynamax" ? t("dynamax")
    : gimmickKind === "zmove" ? t("zmove") : gimmickKind === "ultra" ? t("ultra") : gimmickKind ? t("mega") : "";
  const doubles = gametype !== "singles";
  const pickMove = (m, i) => {
    const target = m.target;
    const suffix = gimmick && gimmickKind ? ` ${gimmickKind}` : "";
    if (doubles && TARGETED.includes(target)) {
      setPending({ index: i + 1, target, suffix });
      return;
    }
    advance(`move ${i + 1}${suffix}`);
  };
  const targets = pending ? (() => {
    const out = [];
    const foes = [1, 2, ...(gametype === "triples" ? [3] : [])];
    if (["normal", "any", "adjacentFoe"].includes(pending.target)) for (const n of foes) out.push({ n, label: `${t("slot_n", { n })}` , foe: true });
    if (["normal", "any", "adjacentAlly"].includes(pending.target)) for (let n = 1; n <= slots; n++) if (n !== slot + 1) out.push({ n: -n, label: `${t("ally")} · ${(pokemon[n - 1]?.ident || "").replace(/^p\d: /, "")}` });
    if (pending.target === "adjacentAllyOrSelf") for (let n = 1; n <= slots; n++) out.push({ n: -n, label: (pokemon[n - 1]?.ident || "").replace(/^p\d: /, "") });
    return out;
  })() : [];
  const moves = active.moves || [];
  const zmoves = gimmickKind === "zmove" && gimmick ? active.canZMove : null;
  return (
    <div className="b-controls" onClickCapture={clickSound}>
      <div className="b-ctrl-head">
        <b>{t("your_move", { name: myName })}</b>
        {slots > 1 && <span className="help">{t("slot_n", { n: slot + 1 })}</span>}
        {sideLabel && <span className="help">{sideLabel}</span>}
        <span className="flex-1" />
        {gimmickKind && !gimmickUsed && (
          <label className="b-gimmick"><input type="checkbox" checked={gimmick} onChange={(e) => setGimmick(e.target.checked)} /> {gimmickLabel}</label>
        )}
      </div>
      {pending ? (
        <div className="b-targets">
          <b>{t("choose_target")}</b>
          {targets.map((x) => <button key={x.n} type="button" className="btn btn-sm" onClick={() => advance(`move ${pending.index} ${x.n}${pending.suffix}`)}>{x.label}</button>)}
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setPending(null)}>{t("cancel")}</button>
        </div>
      ) : (
        <div className="b-moves">
          {moves.map((m, i) => {
            const z = zmoves ? zmoves[i] : null;
            if (zmoves && !z) return <MoveButton key={i} move={m} lang={lang} t={t} disabled />;
            return <MoveButton key={i} move={z ? { ...m, move: z.move, type: z.type || m.type, power: 0 } : m} lang={lang} t={t} disabled={busy || m.disabled || (m.maxpp && m.pp <= 0)} onClick={() => pickMove(m, i)} />;
          })}
        </div>
      )}
      <div className="b-switches">
        <span className="help">{active.trapped ? t("trapped") : t("switch_to")}</span>
        <div className="b-team-row">
          {pokemon.map((m, i) => {
            const c = parseCondition(m.condition);
            const can = !active.trapped && !m.active && !c.fainted && !usedSwitches.includes(i + 1);
            return <MonButton key={i} mon={m} sprites={sprites} lang={lang} disabled={busy || !can} onClick={() => advance(`switch ${i + 1}`)}
              badge={m.active ? "●" : c.fainted ? "×" : ""} />;
          })}
        </div>
      </div>
      <div className="b-ctrl-actions">
        {parts.length > 0 && <button type="button" className="btn btn-sm" onClick={() => { setParts([]); setPending(null); }}>{t("cancel")}</button>}
        <span className="flex-1" />
        {onForfeit && <button type="button" className="btn btn-sm btn-danger" onClick={onForfeit} disabled={busy}>{t("forfeit")}</button>}
      </div>
    </div>
  );
}

export function ReplayBar({ player, lang = "es", speedMs, onSpeed }) {
  const t = battleT(lang);
  const marks = player.marks;
  const current = marks.filter((m) => m.index < player.applied).length;
  const speeds = [[1800, "0,5×"], [900, "1×"], [450, "2×"], [200, "4×"]];
  return (
    <div className="b-replay" onClickCapture={clickSound}>
      <button type="button" className="btn btn-sm" onClick={() => player.seek(0, { play: true })} title={t("restart")} aria-label={t("restart")}>⏮</button>
      <button type="button" className="btn btn-sm" onClick={() => player.toggle()} aria-label={player.playing ? t("pause") : t("play")}>{player.playing ? "⏸" : "▶"}</button>
      <button type="button" className="btn btn-sm" onClick={() => player.stepOne()} title={t("step")} aria-label={t("step")}>⏭</button>
      <button type="button" className="btn btn-sm" onClick={() => player.skip()}>{t("to_end")}</button>
      {marks.length > 1 && (
        <input type="range" min={0} max={marks.length} value={current} className="b-scrub" aria-label={t("turn_n", { n: current })}
          onChange={(e) => { const n = Number(e.target.value); player.seek(n === 0 ? 0 : marks[n - 1].index + 1, { play: false }); }} />
      )}
      <span className="help num">{t("turn_n", { n: player.state.turn })}</span>
      {onSpeed && (
        <div className="seg" role="group" aria-label={t("speed")}>
          {speeds.map(([ms, label]) => <button key={ms} type="button" aria-pressed={Math.abs(speedMs - ms) < 60} onClick={() => onSpeed(ms)}>{label}</button>)}
        </div>
      )}
    </div>
  );
}
