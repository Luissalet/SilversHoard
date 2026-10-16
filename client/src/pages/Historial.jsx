// Every battle with its result; open one to replay it.
import React, { useState } from "react";
import { api } from "../api.js";
import { useApp } from "../context.js";
import { Busy, Empty, ErrorBox, Icon, ICONS, Rel, Spinner, useBusy, useLoad } from "../components/ui.jsx";
import { Avatar } from "../components/silver.jsx";

export function BattleRow({ b, onDelete }) {
  const { t, changed, confirm } = useApp();
  const [busy, run] = useBusy();
  const cancel = async () => {
    if (!(await confirm({ title: t("cancel_battle"), message: t("cancel_battle_help"), confirmLabel: t("cancel_battle") }))) return;
    run("cancel", async () => { await api.call("battle_cancel", { id: b.id }); changed(); });
  };
  const won = (side) => b.winner_side === side;
  return (
    <div className="row-item battle-row">
      <a href={`#/combate/${b.id}`} className="flex min-w-0 flex-1 items-center gap-3">
        <span className={`vs-side ${won("p1") ? "is-winner" : ""}`}><Avatar url={b.p1.avatar_url} name={b.p1.name} size={34} /><span className="trunc">{b.p1.name}</span></span>
        <span className="help">vs</span>
        <span className={`vs-side ${won("p2") ? "is-winner" : ""}`}><Avatar url={b.p2.avatar_url} name={b.p2.name} size={34} /><span className="trunc">{b.p2.name}</span></span>
      </a>
      <span className="hide-sm chip">{t(`kind_${b.kind}`)}</span>
      {b.mode === "realtime" && <span className="hide-sm chip chip-rt">{t("rt_chip")}</span>}
      <span className={`chip ${b.status === "live" ? "chip-accent" : b.status === "running" ? "chip-amber" : b.status === "failed" ? "chip-danger" : ""}`}>
        {b.status === "ended" ? (b.winner_name ? t("winner_short", { name: b.winner_name }) : t("tie")) : t(`status_${b.status}`)}
      </span>
      <span className="hide-sm help num w-[70px] text-right">{b.turns ? t("turns_n", { n: b.turns }) : b.mode === "realtime" && b.summary?.seconds ? t("rt_seconds_n", { n: Math.round(b.summary.seconds) }) : ""}</span>
      <span className="hide-sm help w-[90px] text-right"><Rel ts={b.updated_at} /></span>
      {["live", "running"].includes(b.status) && <Busy busy={busy.cancel} className="btn btn-sm" onClick={cancel}>{t("cancel_battle")}</Busy>}
      {onDelete && b.status !== "live" && <button type="button" className="btn btn-sm btn-icon btn-ghost" onClick={() => onDelete(b)} aria-label={t("delete")}><Icon d={ICONS.trash} size={14} /></button>}
    </div>
  );
}

const KINDS = ["", "play", "watch", "gym", "league", "series", "tournament", "cup", "friend"];

export default function Historial() {
  const { t, confirm, notify, changed } = useApp();
  const [kind, setKind] = useState("");
  const [limit, setLimit] = useState(60);
  const { data, error, loading, reload } = useLoad(() => api.call("battles_list", { kind, limit }, { timeoutMs: 15000 }), [kind, limit]);
  const [, run] = useBusy();
  const del = async (b) => {
    if (!(await confirm({ title: t("delete_battle"), message: t("delete_battle_msg") }))) return;
    run("del", async () => { await api.call("battles_delete", { ids: [b.id] }); notify(t("deleted")); reload(); changed(); });
  };
  const list = data?.battles || [];
  return (
    <div className="space-y-4">
      <div className="page-head">
        <div className="min-w-0"><h1>{t("nav_history")}</h1><p className="help">{t("history_help")}</p></div>
        <select className="field max-w-[220px]" value={kind} onChange={(e) => setKind(e.target.value)} aria-label={t("kind")}>
          {KINDS.map((k) => <option key={k} value={k}>{k ? t(`kind_${k}`) : t("all_kinds")}</option>)}
        </select>
      </div>
      {error && <ErrorBox error={{ ...error, message: t("history_load_failed") }} onRetry={reload} />}
      {loading && !data ? <Spinner /> : list.length === 0 ? <Empty icon={ICONS.list} title={t("no_battles")}>{t("no_battles_help")}</Empty> : (
        <div className="panel divide-list p-0">{list.map((b) => <BattleRow key={b.id} b={b} onDelete={del} />)}</div>
      )}
      {list.length >= limit && <button type="button" className="btn" onClick={() => setLimit((l) => l + 60)}>{t("load_more")}</button>}
    </div>
  );
}
