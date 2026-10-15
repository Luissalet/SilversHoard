// A cup's bracket, drawn as a tree that fills in while the matches are played: the AI's in the background one after another, yours
// when you play them (or send them to the simulator). Every game links to its battle; finished ones replay.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import { useApp } from "../context.js";
import { Busy, ErrorBox, Icon, ICONS, Spinner, useBusy, useLoad } from "../components/ui.jsx";
import { usePoll } from "../components/hooks.js";
import { Avatar } from "../components/silver.jsx";

const TROPHY = "M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0V4zM7 6H4v2a3 3 0 003 3M17 6h3v2a3 3 0 01-3 3";
const CARD_W = 214;
const CARD_H = 82;
const GAP_Y = 16;
const GAP_X = 54;
const HEAD = 30;

export function roundName(t, r, rounds) {
  const left = rounds - r;   // 1 = final
  const key = { 1: "cup_round_final", 2: "cup_round_semi", 3: "cup_round_quarter", 4: "cup_round_16", 5: "cup_round_32", 6: "cup_round_64" }[left];
  return key ? t(key) : t("round_n", { n: r + 1 });
}

function Entrant({ id, cup, m, side, mine }) {
  const { t } = useApp();
  if (id === "bye") return <div className="cup-entrant is-bye"><span className="cup-ghost" /><i>{t("cup_bye")}</i></div>;
  if (!id) return <div className="cup-entrant is-tbd"><span className="cup-ghost" /><i>{t("cup_tbd")}</i></div>;
  const e = cup.names[id] || { name: "?" };
  const won = m.state === "done" && m.winner === id;
  const lost = m.state === "done" && m.winner && m.winner !== id;
  return (
    <div className={`cup-entrant ${won ? "is-winner" : ""} ${lost ? "is-loser" : ""} ${id === cup.human_id ? "is-me" : ""} ${mine ? "is-new" : ""}`}>
      <Avatar url={e.avatar_url} name={e.name} size={24} />
      <span className="trunc flex-1" title={e.name}>{e.name}</span>
      {!m.bye && (m.games.length > 0 || m.state === "done") && <b className="num cup-score">{m.wins[side === "a" ? 0 : 1]}</b>}
    </div>
  );
}

function MatchCard({ cup, m, x, y, fresh, onWatch, onSim, busy }) {
  const { t } = useApp();
  const human = cup.human_id;
  const isMine = human && (m.a === human || m.b === human);
  const aiReady = m.state === "ready" && !isMine && cup.status === "active";
  return (
    <div className={`cup-match state-${m.state} ${m.bye ? "is-bye" : ""} ${isMine ? "is-mine" : ""} ${fresh.has(`${m.round}/${m.index}`) ? "just-won" : ""}`}
      style={{ left: x, top: y, width: CARD_W, height: CARD_H }} data-round={m.round} data-match={m.index}>
      <Entrant id={m.a} cup={cup} m={m} side="a" mine={fresh.has(`in:${m.round}/${m.index}/a`)} />
      <Entrant id={m.b} cup={cup} m={m} side="b" mine={fresh.has(`in:${m.round}/${m.index}/b`)} />
      <div className="cup-match-foot">
        {m.games.filter((g) => g.battle_id).map((g, gi) => (
          <a key={g.battle_id} className={`cup-game ${g.winner ? "is-done" : g.tie ? "is-tie" : "is-live"}`} href={`#/combate/${g.battle_id}`}
            title={t("cup_game_n", { n: gi + 1 })}>{gi + 1}</a>
        ))}
        {m.state === "live" && <span className="cup-tag cup-tag-live">{t("cup_live")}</span>}
        {m.state === "sim" && <span className="cup-tag cup-tag-sim">{t("cup_sim")}</span>}
        <span className="flex-1" />
        {aiReady && (
          <>
            <button type="button" className="cup-icon" title={t("cup_watch")} aria-label={t("cup_watch")} disabled={busy} onClick={() => onWatch(m)}><Icon d={ICONS.eye} size={14} /></button>
            <button type="button" className="cup-icon" title={t("cup_sim_match")} aria-label={t("cup_sim_match")} disabled={busy} onClick={() => onSim(m)}><Icon d={ICONS.play} size={13} /></button>
          </>
        )}
      </div>
    </div>
  );
}

export function Bracket({ cup, fresh = new Set(), onWatch = () => {}, onSim = () => {}, busy = false }) {
  const { t } = useApp();
  const rounds = cup.rounds || [];
  const first = rounds[0]?.length || 1;
  const height = HEAD + first * (CARD_H + GAP_Y);
  const colX = (r) => r * (CARD_W + GAP_X);
  const yOf = (r, i) => HEAD + ((i + 0.5) * (height - HEAD)) / rounds[r].length - CARD_H / 2;
  const width = colX(rounds.length) + 170;
  const champ = cup.champion ? cup.names[cup.champion] : null;
  const lines = [];
  rounds.forEach((rnd, r) => rnd.forEach((m, i) => {
    const x1 = colX(r) + CARD_W;
    const y1 = yOf(r, i) + CARD_H / 2;
    const last = r + 1 >= rounds.length;
    const x2 = last ? colX(r + 1) : colX(r + 1);
    const y2 = last ? HEAD + (height - HEAD) / 2 : yOf(r + 1, Math.floor(i / 2)) + CARD_H / 2;
    const mid = x1 + GAP_X / 2;
    const won = m.state === "done";
    lines.push(<path key={`${r}/${i}`} d={`M${x1} ${y1} H${mid} V${y2} H${x2}`} className={`cup-line ${won ? "is-won" : ""} ${won && m.winner === cup.human_id && cup.human_id ? "is-mine" : ""} ${fresh.has(`${r}/${i}`) ? "just-won" : ""}`} />);
  }));
  return (
    <div className="cup-scroll">
      <div className="cup-bracket" style={{ width, height: height + 8 }}>
        <svg className="cup-lines" width={width} height={height + 8} aria-hidden="true">{lines}</svg>
        {rounds.map((rnd, r) => (
          <div key={`h${r}`} className="cup-round-name" style={{ left: colX(r), width: CARD_W }}>{roundName(t, r, rounds.length)}</div>
        ))}
        {rounds.map((rnd, r) => rnd.map((m, i) => (
          <MatchCard key={`${r}/${i}`} cup={cup} m={m} x={colX(r)} y={yOf(r, i)} fresh={fresh} onWatch={onWatch} onSim={onSim} busy={busy} />
        )))}
        <div className="cup-round-name" style={{ left: colX(rounds.length), width: 160 }}>{t("cup_champion")}</div>
        <div className={`cup-champion ${champ ? "is-set" : ""}`} style={{ left: colX(rounds.length), top: HEAD + (height - HEAD) / 2 - 62 }}>
          <Icon d={TROPHY} size={26} />
          {champ ? <><Avatar url={champ.avatar_url} name={champ.name} size={56} /><b className="trunc">{champ.name}</b></> : <i className="help">{t("cup_tbd")}</i>}
        </div>
      </div>
    </div>
  );
}

/** What changed since the last poll: matches that just ended and the places their winners just took, for a moment of highlight. */
function useFresh(cup) {
  const prev = useRef(null);
  const [fresh, setFresh] = useState(new Set());
  useEffect(() => {
    if (!cup?.rounds) return undefined;
    const before = prev.current;
    prev.current = cup.rounds;
    if (!before || before.length !== cup.rounds.length) return undefined;
    const now = new Set();
    cup.rounds.forEach((rnd, r) => rnd.forEach((m, i) => {
      const old = before[r]?.[i];
      if (old && old.state !== "done" && m.state === "done") {
        now.add(`${r}/${i}`);
        if (r + 1 < cup.rounds.length) now.add(`in:${r + 1}/${Math.floor(i / 2)}/${i % 2 === 0 ? "a" : "b"}`);
      }
    }));
    if (!now.size) return undefined;
    setFresh(now);
    const id = setTimeout(() => setFresh(new Set()), 1600);
    return () => clearTimeout(id);
  }, [cup]);
  return fresh;
}

export function CupStrip({ cup, battle }) {
  const { t, go } = useApp();
  const [busy, run] = useBusy();
  if (!cup) return null;
  const next = cup.my_match && battle?.status !== "live" && cup.my_match.battle_id !== battle?.id;
  const play = () => run("p", async () => {
    const r = await api.call("cup_play", { id: cup.id });
    go(`#/combate/${r.battle_id}`);
  });
  return (
    <div className="run-strip cup-strip">
      <a href={`#/copa/${cup.id}`} className="run-target"><Icon d={TROPHY} size={18} /> {cup.title}</a>
      {cup.champion_name && <span className="chip chip-ok">{t("cup_champion_is", { name: cup.champion_name })}</span>}
      <span className="flex-1" />
      {next && <Busy busy={busy.p} className="btn btn-sm btn-primary" onClick={play}>{t("cup_next_game")}</Busy>}
      <a className="btn btn-sm" href={`#/copa/${cup.id}`}>{t("cup_back")}</a>
    </div>
  );
}

export default function Copa({ param }) {
  const { t, go, confirm, changed } = useApp();
  const { data: cup, error, reload, setData } = useLoad(() => api.call("cup_get", { id: param }), [param]);
  const [busy, run] = useBusy();
  const fresh = useFresh(cup);
  usePoll(async () => { const c = await api.call("cup_get", { id: param }); setData(c); }, 900, !!cup && cup.status === "active");
  const act = (key, tool, args = {}, after) => run(key, async () => {
    const r = await api.call(tool, { id: param, ...args });
    if (after) after(r);
    else setData(r.cup || r);
    changed();
  });
  const names = cup?.names || {};
  const me = cup?.human_id ? names[cup.human_id] : null;
  const mm = cup?.my_match;
  const playedOf = useMemo(() => (cup ? t("cup_played", { n: cup.played, total: cup.total }) : ""), [cup, t]);
  if (error && !cup) return <ErrorBox error={error} onRetry={reload} />;
  if (!cup) return <Spinner />;
  const abandon = async () => {
    if (!(await confirm({ title: t("cup_abandon"), message: t("cup_abandon_q"), confirmLabel: t("cup_abandon"), danger: true }))) return;
    act("ab", "cup_abandon");
  };
  const remove = async () => {
    if (!(await confirm({ title: t("cup_delete"), message: t("cup_delete_q"), confirmLabel: t("cup_delete"), danger: true }))) return;
    run("del", async () => { await api.call("cups_delete", { ids: [cup.id] }); changed(); go("#/combatir"); });
  };
  const spec = cup.spec || {};
  const champ = cup.champion ? names[cup.champion] : null;
  return (
    <div className="space-y-4">
      <div className="page-head">
        <div className="min-w-0">
          <h1 className="trunc">{cup.title}</h1>
          <div className="help flex flex-wrap items-center gap-2">
            <span className={`chip ${cup.status === "done" ? "chip-ok" : cup.status === "active" ? "chip-accent" : ""}`}>{t(`cup_status_${cup.status}`)}</span>
            {spec.mode === "realtime" ? <span className="chip chip-rt">{t("rt_chip")}</span> : <span className="chip">{t("mode_classic_short")}</span>}
            <span className="chip">{spec.format_name || spec.format}</span>
            <span className="chip">{t("cup_entrants_n", { n: cup.entrants.length })}</span>
            {spec.best_of > 1 && <span className="chip">{t("cup_best_of", { n: spec.best_of })}</span>}
            {spec.level_rules?.level ? <span className="chip">{t("eq_chip", { n: spec.level_rules.level })}</span> : null}
            <span className="chip">{playedOf}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {cup.status === "active" && <Busy busy={busy.ab} className="btn" onClick={abandon}>{t("cup_abandon")}</Busy>}
          {cup.status !== "active" && <Busy busy={busy.del} className="btn" onClick={remove}>{t("cup_delete")}</Busy>}
          <a className="btn" href="#/combatir">{t("new_battle")}</a>
        </div>
      </div>

      {champ && (
        <div className="cup-banner">
          <Icon d={TROPHY} size={30} />
          <Avatar url={champ.avatar_url} name={champ.name} size={64} />
          <b>{t("cup_champion_is", { name: champ.name })}</b>
        </div>
      )}

      {cup.status === "active" && (
        <div className="cup-actions panel">
          {mm ? (
            <div className="cup-mine">
              <b>{t("cup_your_match")} · {roundName(t, mm.round, cup.rounds.length)}</b>
              <span className="flex items-center gap-2">
                <Avatar url={me?.avatar_url} name={me?.name} size={32} />
                {t("cup_your_match_vs", { me: me?.name || "", rival: names[mm.opponent]?.name || "" })}
                <Avatar url={names[mm.opponent]?.avatar_url} name={names[mm.opponent]?.name} size={32} />
              </span>
              <span className="flex flex-wrap gap-2">
                {mm.battle_id ? <a className="btn btn-primary" href={`#/combate/${mm.battle_id}`}>{t("cup_play_resume")}</a>
                  : <Busy busy={busy.play} className="btn btn-primary" onClick={() => act("play", "cup_play", {}, (r) => go(`#/combate/${r.battle_id}`))}>{t("cup_play")}</Busy>}
                {!mm.battle_id && <Busy busy={busy.sm} className="btn" onClick={() => act("sm", "cup_simulate")}>{t("cup_simulate_mine")}</Busy>}
              </span>
            </div>
          ) : cup.human_id ? <span className="help">{cup.human_alive ? t("cup_waiting") : t("cup_out")}</span> : null}
          <span className="flex-1" />
          {cup.simulating ? <span className="help flex items-center gap-2"><span className="cup-spin" />{t("cup_simulating")}</span>
            : cup.pending_ai > 0 && <span className="flex items-center gap-2"><span className="help">{t("cup_continue_help")}</span><Busy busy={busy.go} className="btn btn-sm" onClick={() => act("go", "cup_continue")}>{t("cup_continue")}</Busy></span>}
        </div>
      )}

      <div className="panel p-0">
        <Bracket cup={cup} fresh={fresh} busy={!!busy.w || !!busy.s}
          onWatch={(m) => act("w", "cup_watch", { round: m.round, match: m.index }, (r) => go(`#/combate/${r.battle_id}`))}
          onSim={(m) => act("s", "cup_simulate", { round: m.round, match: m.index })} />
      </div>
    </div>
  );
}
