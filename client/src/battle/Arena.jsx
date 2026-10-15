// The battle screen: the field with both sides (sprites on their platforms, HP cards, team dots, field effects, trainers and their
// lines) and the log. Reads the state kept by useBattlePlayer; draws nothing it does not know.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { L, STATUS_COLORS, STATUS_SHORT, STATUS_SHORT_EN, STAT_SHORT, TYPE_COLORS, nameOf, typeName, toID } from "./dex.js";
import { battleT } from "./strings.js";
import SoundButton from "./SoundControl.jsx";
import { useBackdropSetting, useMoveFxSetting, usePrefersReducedMotion } from "./fx/setting.js";
import { backdropFileUrl, backdropUrl, fieldLayer, seedOf, weatherLayer } from "./fx/backdrop.js";

const WEATHER_CLASS = { raindance: "w-rain", primordialsea: "w-rain", sunnyday: "w-sun", desolateland: "w-sun", sandstorm: "w-sand", hail: "w-snow",
  snowscape: "w-snow", snow: "w-snow", deltastream: "w-wind" };
const TERRAIN_CLASS = { electricterrain: "t-electric", grassyterrain: "t-grassy", psychicterrain: "t-psychic", mistyterrain: "t-misty" };

function hpColor(frac) {
  if (frac > 0.5) return "var(--hp-ok)";
  if (frac > 0.2) return "var(--hp-mid)";
  return "var(--hp-low)";
}

const KEYFRAMES = {
  // `lunge` ({dx, dy} in px, from the effect layer) sends a striking Pokémon toward its target instead of the small default hop
  // `ps`: Showdown's animation of the move already moves the sprite, so no hop of our own
  move: (back, a) => a?.ps ? [{ transform: "none" }, { transform: "none" }] : [{ transform: "translate(0,0)" }, { transform: a?.lunge ? `translate(${a.lunge.dx}px,${a.lunge.dy}px)` : back ? "translate(26px,-14px)" : "translate(-26px,14px)", offset: 0.4 }, { transform: "translate(0,0)" }],
  hit: () => [{ transform: "translateX(0)", filter: "brightness(1)" }, { transform: "translateX(-7px)", filter: "brightness(2.2)" }, { transform: "translateX(6px)", filter: "brightness(1)" },
    { transform: "translateX(-4px)", filter: "brightness(1.8)" }, { transform: "translateX(0)", filter: "brightness(1)" }],
  heal: () => [{ filter: "drop-shadow(0 0 0 #6fe08a)" }, { filter: "drop-shadow(0 0 14px #6fe08a)" }, { filter: "drop-shadow(0 0 0 #6fe08a)" }],
  faint: () => [{ transform: "translateY(0)", opacity: 1 }, { transform: "translateY(40px)", opacity: 0 }],
  switch: () => [{ transform: "scale(0.4)", opacity: 0, filter: "brightness(3)" }, { transform: "scale(1)", opacity: 1, filter: "brightness(1)" }],
  status: () => [{ filter: "saturate(1)" }, { filter: "saturate(2.2) hue-rotate(20deg)" }, { filter: "saturate(1)" }],
  boost: () => [{ filter: "brightness(1)" }, { filter: "brightness(1.5)" }, { filter: "brightness(1)" }],
  unboost: () => [{ filter: "brightness(1)" }, { filter: "brightness(0.6)" }, { filter: "brightness(1)" }],
  tera: () => [{ filter: "drop-shadow(0 0 0 #fff)" }, { filter: "drop-shadow(0 0 22px #fff) brightness(1.6)" }, { filter: "drop-shadow(0 0 6px #fff)" }],
};
const DURATION = { move: 420, hit: 420, heal: 600, faint: 650, switch: 380, status: 520, boost: 450, unboost: 450, tera: 900 };

function Sprite({ mon, back, sprites, anim, slotKey, size, scale = 1 }) {
  const [src, setSrc] = useState("");
  const [failed, setFailed] = useState(0);
  const ref = useRef(null);
  const species = mon?.species || "";
  useEffect(() => {
    setFailed(0);
    setSrc(species ? sprites.pokemon(species, { back, shiny: mon?.shiny }) : "");
    try { ref.current?.getAnimations?.().forEach((a) => a.cancel()); } catch { /* nothing to cancel */ }
  }, [species, mon?.name, back, mon?.shiny, sprites]);
  const mine = anim && anim.key === slotKey ? anim : null;
  useEffect(() => {
    const el = ref.current;
    if (!mine || !el || !el.animate || !KEYFRAMES[mine.type]) return;
    try {
      el.animate(KEYFRAMES[mine.type](back, mine), { duration: DURATION[mine.type] || 400, easing: "ease-out", fill: mine.type === "faint" ? "forwards" : "none" });
    } catch { /* animations are decoration */ }
  }, [mine?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!mon) return null;
  const onError = () => {
    if (failed === 0) { setSrc(sprites.fallback(species, { back })); setFailed(1); } else setFailed(2);
  };
  const cls = ["b-sprite", back ? "is-back" : "is-front", sprites.pixelated ? "pixelated" : "", mon.fainted ? "is-fainted" : ""];
  return (
    <div className={cls.filter(Boolean).join(" ")} data-fx-pos={slotKey} style={{ "--sprite-size": `${size}px`, "--sprite-scale": scale }}>
      <div className="b-sprite-img" ref={ref}>
        {failed < 2 && src ? <img src={src} alt={mon.species} onError={onError} draggable={false} /> : <div className="b-sprite-missing" aria-label={mon.species}>{mon.species.slice(0, 2)}</div>}
      </div>
      {mon.tera && <span className="b-tera-glow" style={{ "--tera": TYPE_COLORS[mon.tera] || "#fff" }} aria-hidden="true" />}
      {mine && (mine.type === "hit" || mine.type === "heal") && mine.delta ? (
        <span key={mine.id} className={`b-float ${mine.delta < 0 ? "is-loss" : "is-gain"}`}>{mine.delta < 0 ? "−" : "+"}{Math.round(Math.abs(mine.delta) * 100)}%</span>
      ) : null}
      {mine && (mine.type === "boost" || mine.type === "unboost") ? <span key={mine.id} className={`b-arrows ${mine.type}`} aria-hidden="true" /> : null}
    </div>
  );
}

function InfoCard({ mon, side, lang, exact, t }) {
  if (!mon) return null;
  const frac = mon.maxhp ? mon.hp / mon.maxhp : 0;
  const boosts = Object.entries(mon.boosts || {}).filter(([, v]) => v);
  const stShort = lang === "en" ? STATUS_SHORT_EN : STATUS_SHORT;
  return (
    <div className={`b-card ${side}`}>
      <div className="b-card-top">
        <b className="trunc">{mon.name}</b>
        {mon.gender && <span className={`b-gender g-${mon.gender}`}>{mon.gender === "M" ? "♂" : "♀"}</span>}
        <span className="b-level">{t("lv")}{mon.level}</span>
      </div>
      <div className="b-hp" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(frac * 100)} aria-label={t("hp")}>
        <span style={{ width: `${Math.max(0, Math.min(1, frac)) * 100}%`, background: hpColor(frac) }} />
      </div>
      <div className="b-card-bottom">
        {mon.status && <span className="b-status" style={{ background: STATUS_COLORS[mon.status] }}>{stShort[mon.status] || mon.status}</span>}
        {mon.tera && <span className="b-chip" style={{ background: TYPE_COLORS[mon.tera] }}>{typeName(mon.tera, lang)}</span>}
        {boosts.map(([k, v]) => <span key={k} className={`b-chip ${v > 0 ? "up" : "down"}`}>{L(STAT_SHORT[k] || [k, k], lang)} {v > 0 ? "+" : ""}{v}</span>)}
        <span className="b-hpnum">{exact && mon.maxhp && mon.maxhp !== 100 ? `${mon.hp}/${mon.maxhp}` : `${Math.round(frac * 100)}%`}</span>
      </div>
    </div>
  );
}

function TeamDots({ side, total }) {
  const team = side.team || [];
  const n = Math.max(total || 0, team.length);
  return (
    <div className="b-dots" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => {
        const m = team[i];
        const cls = !m || !m.seen ? "unknown" : m.fainted ? "fainted" : m.status ? "status" : "ok";
        return <span key={i} className={`b-dot ${cls}`} />;
      })}
    </div>
  );
}

function SideConditions({ side, lang }) {
  const entries = Object.entries(side.conditions || {});
  if (!entries.length) return null;
  return (
    <div className="b-conds">
      {entries.map(([k, n]) => <span key={k} className="b-chip">{nameOf("move", k, lang)}{n > 1 ? ` ×${n}` : ""}</span>)}
    </div>
  );
}

export function LogPanel({ log, lang, compact }) {
  const t = battleT(lang);
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log.length]);
  return (
    <div className={`b-log ${compact ? "compact" : ""}`} ref={ref} aria-live="polite" aria-label={t("log")}>
      {log.map((e, i) => (e.kind === "turn" ? <div key={i} className="b-log-turn">{e.text}</div> : <div key={i} className={`b-log-line k-${e.kind}`}>{e.text}</div>))}
    </div>
  );
}

/**
 * props: player (useBattlePlayer), seats {p1: {name, avatarUrl, backUrl, winUrl, dialogue}, p2}, me ('p1'|'p2' at the bottom), sprites (makeSprites),
 * lang, exact (show HP numbers), children (controls under the field), bubble ({side, text}) for a trainer line.
 */
export default function Arena({ player, seats = {}, me = "p1", sprites, lang = "es", exact = true, children, bubble, toolbar, backdrop = "" }) {
  const t = battleT(lang);
  const st = player.state;
  const foe = me === "p1" ? "p2" : "p1";
  const anim = player.anim ? { ...player.anim, key: `${player.anim.side}${player.anim.slot}` } : null;
  const doubles = st.gametype === "doubles" || st.gametype === "triples";
  const slots = st.gametype === "triples" ? [0, 1, 2] : doubles ? [0, 1] : [0];
  const weather = WEATHER_CLASS[toID(st.field.weather)] || "";
  const terrain = TERRAIN_CLASS[toID(st.field.terrain)] || "";
  const activeOf = (sid, slot) => {
    const s = st.sides[sid];
    const i = s.active[slot];
    return i === null || i === undefined ? null : s.team[i];
  };
  const fieldLabel = useMemo(() => {
    const parts = [];
    if (st.field.weather) parts.push(nameOf("move", st.field.weather, lang) || st.field.weather);
    if (st.field.terrain) parts.push(nameOf("move", st.field.terrain, lang));
    for (const [k, on] of Object.entries(st.field.pseudo || {})) if (on) parts.push(nameOf("move", k, lang));
    return parts;
  }, [st.field.weather, st.field.terrain, st.field.pseudo, lang]);
  const ended = st.ended;

  // move effects: a canvas layer (loaded on demand) that plays each move between the sprites; off with the setting or reduced motion
  const [fxPref, setFxPref] = useMoveFxSetting();
  const reduced = usePrefersReducedMotion();
  const fxOn = fxPref && !reduced;
  const stageRef = useRef(null);
  const underRef = useRef(null);
  const overRef = useRef(null);
  const [fx, setFx] = useState(null);
  useEffect(() => {
    if (!fxOn) return undefined;
    let dead = false;
    let stage = null;
    let detach = null;
    import("./fx/stage.js").then((m) => {
      if (dead || !stageRef.current || !underRef.current || !overRef.current) return;
      stage = new m.FxStage({ host: stageRef.current, under: underRef.current, over: overRef.current });
      detach = player.attachFx(stage);
      setFx(stage);
    }).catch(() => { /* the effects are decoration: the screen works without them */ });
    return () => { dead = true; detach?.(); stage?.destroy(); setFx(null); };
  }, [fxOn, player]);
  const fxMons = [];
  for (const sid of [me, foe]) for (const i of slots) fxMons.push({ side: sid, slot: i, status: activeOf(sid, i)?.status || "" });
  const fxSig = fxMons.map((m) => m.status).join(",");
  useEffect(() => { fx?.sync({ weather: st.field.weather, mons: fxMons }); }, [fx, st.field.weather, fxSig]); // eslint-disable-line react-hooks/exhaustive-deps

  // Showdown's backdrop for the format's generation (one per battle, kept in replays) and its weather and terrain overlays
  const [backdropPref] = useBackdropSetting();
  const showdownField = backdropPref === "showdown";
  // a gym's own backdrop (its designer chose it) shows whatever the setting; otherwise the one Showdown would pick
  const bdUrl = useMemo(() => (backdrop ? backdropFileUrl(backdrop)
    : showdownField ? backdropUrl({ gen: st.gen, seed: seedOf(`${st.sides.p1.name}|${st.sides.p2.name}|${st.tier}`) }) : ""),
  [backdrop, showdownField, st.gen, st.sides.p1.name, st.sides.p2.name, st.tier]);
  const wLayer = showdownField ? weatherLayer(st.field.weather) : null;
  const fLayer = showdownField ? fieldLayer([st.field.terrain, ...Object.entries(st.field.pseudo || {}).filter(([, on]) => on).map(([k]) => k)]) : null;

  const winnerSide = ended && !st.tie ? (st.sides.p1.name === st.winner ? "p1" : st.sides.p2.name === st.winner ? "p2" : "") : "";
  return (
    <div className="b-wrap">
      <div className="b-main">
        <div className={`b-stage ${weather} ${terrain} ${doubles ? "is-doubles" : ""}${bdUrl ? " has-backdrop" : ""}`} ref={stageRef}>
          {bdUrl && <div className="b-backdrop" style={{ backgroundImage: `url(${bdUrl})` }} aria-hidden="true" />}
          {fLayer && <div className="b-layer" style={{ backgroundImage: `url(${fLayer.url})`, opacity: fLayer.opacity }} aria-hidden="true" />}
          {wLayer && <div className="b-layer" style={{ backgroundImage: `url(${wLayer.url})`, opacity: wLayer.opacity }} aria-hidden="true" />}
          <div className="b-platform foe" />
          <div className="b-platform me" />
          {fxOn && <canvas className="b-fx under" ref={underRef} aria-hidden="true" />}
          {fxOn && <canvas className="b-fx over" ref={overRef} aria-hidden="true" />}
          {!reduced && (
            <button type="button" className={`b-fx-toggle${fxPref ? " is-on" : ""}`} aria-pressed={fxPref} title={t("move_fx")} aria-label={t("move_fx")}
              onClick={() => setFxPref(!fxPref)}>✦</button>
          )}
          {fieldLabel.length > 0 && <div className="b-field-label">{fieldLabel.join(" · ")}</div>}
          {st.turn > 0 && <div className="b-turn">{t("turn_n", { n: st.turn })}</div>}
          <SoundButton lang={lang} />

          <div className="b-trainer foe">
            {seats[foe]?.avatarUrl && <img src={seats[foe].avatarUrl} alt="" className={sprites.pixelated ? "pixelated" : ""} draggable={false} />}
            <span className="trunc">{st.sides[foe].name !== foe ? st.sides[foe].name : seats[foe]?.name}</span>
          </div>
          <div className="b-trainer me">
            {seats[me]?.avatarUrl && <img src={seats[me].backUrl || seats[me].avatarUrl} alt="" className={sprites.pixelated ? "pixelated" : ""} draggable={false} />}
            <span className="trunc">{st.sides[me].name !== me ? st.sides[me].name : seats[me]?.name}</span>
          </div>

          <div className="b-cards foe">
            {slots.map((i) => <InfoCard key={i} mon={activeOf(foe, i)} side="foe" lang={lang} exact={exact} t={t} />)}
            <TeamDots side={st.sides[foe]} total={st.sides[foe].teamSize} />
            <SideConditions side={st.sides[foe]} lang={lang} />
          </div>
          <div className="b-cards me">
            {slots.map((i) => <InfoCard key={i} mon={activeOf(me, i)} side="me" lang={lang} exact={exact} t={t} />)}
            <TeamDots side={st.sides[me]} total={st.sides[me].teamSize} />
            <SideConditions side={st.sides[me]} lang={lang} />
          </div>

          <div className="b-mons foe">
            {slots.map((i) => (
              <div key={i} className={`b-slot s${i}`}>
                <Sprite mon={activeOf(foe, i)} back={false} sprites={sprites} anim={anim} slotKey={`${foe}${i}`} size={doubles ? 104 : 124} scale={(sprites.scale?.[1] || 1) * (doubles ? 0.86 : 1)} />
              </div>
            ))}
          </div>
          <div className="b-mons me">
            {slots.map((i) => (
              <div key={i} className={`b-slot s${i}`}>
                <Sprite mon={activeOf(me, i)} back sprites={sprites} anim={anim} slotKey={`${me}${i}`} size={doubles ? 128 : 156} scale={(sprites.scale?.[0] || 1) * (doubles ? 0.86 : 1)} />
              </div>
            ))}
          </div>

          {bubble && bubble.text && <div className={`b-bubble ${bubble.side === me ? "me" : "foe"}`}>{bubble.text}</div>}
          {ended && (
            <div className="b-result">
              <b>{st.tie ? t("tie") : t("winner", { name: st.winner })}</b>
              <span>{t("turns", { n: st.turn })}</span>
              {winnerSide && seats[winnerSide]?.avatarUrl && <img src={seats[winnerSide].winUrl || seats[winnerSide].avatarUrl} alt="" className={sprites.pixelated ? "pixelated" : ""} />}
            </div>
          )}
          {!st.started && !st.preview && player.total === 0 && <div className="b-loading">{t("waiting_start")}</div>}
        </div>
        {toolbar}
        {children}
      </div>
      <LogPanel log={player.log} lang={lang} />
    </div>
  );
}

export function TypeBadge({ type, lang }) {
  if (!type) return null;
  return <span className="b-type" style={{ background: TYPE_COLORS[type] || "#777" }}>{typeName(type, lang)}</span>;
}
