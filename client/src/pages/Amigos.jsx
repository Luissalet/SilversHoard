// Friends' results ranked: the week's challenge (everyone who plays that week's page fights with the same seed and the same AI luck)
// and every gym or trainer friends have played from a playable page, with the best result of each friend.
import React, { useState } from "react";
import { api } from "../api.js";
import { useApp } from "../context.js";
import { Busy, ErrorBox, ICONS, Icon, Section, Spinner, useBusy, useLoad } from "../components/ui.jsx";
import { useCopilotRefresh } from "../components/hooks.js";
import { GymBadge } from "../components/silver.jsx";
import { League, WeekVote } from "./FriendsLeague.jsx";

function Entry({ e, t, busy, onRemove }) {
  const result = e.won ? t("lb_won") : t("lb_reached", { n: Math.min(e.battles_won + 1, e.battles || 1), total: e.battles || 1 });
  return (
    <div className="row-item lb-row">
      <span className={`lb-rank ${e.rank <= 3 ? `lb-top lb-top-${e.rank}` : ""}`}>{e.rank}</span>
      <b className="min-w-0 flex-1 trunc">{e.challenger}</b>
      <span className={`chip ${e.won ? "chip-ok" : "chip-danger"}`}>{result}</span>
      {e.turns > 0 && <span className="help">{t(e.turns === 1 ? "lb_turn" : "lb_turns", { n: e.turns })}</span>}
      {e.verified && e.won && e.hp_left > 0 && <span className="help">{t("lb_hp", { n: e.hp_left })}</span>}
      <span className="chip" title={e.verified ? t("lb_verified_help") : t("lb_unverified_help")}>
        {e.verified && <Icon d={ICONS.check} size={12} />} {e.verified ? t("lb_verified") : t("lb_unverified")}
      </span>
      {e.attempts > 1 && <span className="help">{t("lb_attempts", { n: e.attempts })}</span>}
      {e.battle_id && <a className="btn btn-sm" href={`#/combate/${e.battle_id}`}>{t("lb_replay")}</a>}
      <Busy busy={busy[e.id]} className="btn btn-sm btn-icon" title={t("lb_remove")} aria-label={t("lb_remove")} onClick={() => onRemove(e)}>
        <Icon d={ICONS.trash} size={14} />
      </Busy>
    </div>
  );
}

function Board({ board, t, busy, onRemove }) {
  const daily = board.kind === "daily";
  const href = daily ? `#/instalaciones?daily=${encodeURIComponent(board.target_id.replace(/^daily-v1-/, ""))}`
    : board.kind === "gym" ? `#/gimnasio/${board.target_id}` : `#/entrenador/${board.target_id}`;
  return (
    <div className="panel divide-list p-0">
      <div className="row-item lb-head">
        {board.kind === "gym" && <GymBadge image={board.badge_image} color={board.badge_color || "#c0c0c0"} size={30} label={board.badge} />}
        <a className="min-w-0 flex-1 trunc btn-link" href={href}><b>{daily ? `${t("daily_title")} ${board.target_id.replace(/^daily-v1-/, "")}` : board.target_name}</b></a>
        <span className="help">{t(daily ? "daily_title" : board.kind === "gym" ? "lb_gym" : "lb_trainer")} · {t(board.results === 1 ? "lb_result" : "lb_results", { n: board.results })}</span>
      </div>
      {board.entries.map((e) => <Entry key={e.id} e={e} t={t} busy={busy} onRemove={onRemove} />)}
    </div>
  );
}

export default function Amigos() {
  const { t, confirm } = useApp();
  const [week, setWeek] = useState("current");
  const weekly = useLoad(() => api.call("leaderboard", { week }), [week]);
  const all = useLoad(() => api.call("leaderboard", {}), []);
  useCopilotRefresh(() => { weekly.reload(); all.reload(); });
  const [busy, run] = useBusy();
  const current = weekly.data?.current_week || all.data?.current_week || "";
  const weeks = [...new Set([current, ...(all.data?.weeks || [])].filter(Boolean))];
  const shown = week === "current" ? current : week;
  const remove = async (e) => {
    if (!(await confirm({ title: t("lb_remove"), message: t("lb_remove_confirm", { name: e.challenger }), confirmLabel: t("lb_remove"), danger: true }))) return;
    run(e.id, async () => { await api.call("leaderboard_remove", { ids: e.ids }); weekly.reload(); all.reload(); });
  };
  const boards = (load, empty) => (!load.data ? <Spinner /> : load.data.boards.length === 0 ? <p className="help">{empty}</p> : (
    <div className="space-y-3">{load.data.boards.map((b) => <Board key={`${b.kind}:${b.target_id}`} board={b} t={t} busy={busy} onRemove={remove} />)}</div>
  ));
  return (
    <div className="space-y-5">
      <div className="page-head"><div className="min-w-0"><h1>{t("nav_friends")}</h1><p className="help">{t("friends_help")}</p></div></div>
      {(weekly.error || all.error) && <ErrorBox error={weekly.error || all.error} onRetry={() => { weekly.reload(); all.reload(); }} />}
      <Section title={t("weekly_title", { week: shown })} actions={weeks.length > 1 && (
        <select className="field w-auto" value={week === "current" ? current : week} aria-label={t("weekly_pick")}
          onChange={(ev) => setWeek(ev.target.value === current ? "current" : ev.target.value)}>
          {weeks.map((w) => <option key={w} value={w}>{w === current ? t("weekly_this", { week: w }) : w}</option>)}
        </select>
      )}>
        <p className="help">{t("weekly_help")}</p>
        {boards(weekly, t("weekly_empty"))}
      </Section>
      <League />
      <WeekVote />
      <Section title={t("lb_all")}>
        {boards(all, t("lb_empty"))}
      </Section>
    </div>
  );
}
