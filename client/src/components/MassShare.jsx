import React, { useState } from "react";
import { api } from "../api.js";
import { useApp } from "../context.js";
import { Busy, Empty, Section, useBusy, useLoad } from "./ui.jsx";

export function MassShare() {
  const { t } = useApp();
  const { data, error } = useLoad(() => api.call("mass_list", {}), []);
  const [busy, run] = useBusy();
  const [exports, setExports] = useState({});
  const share = (id) => run(id, async () => {
    const out = await api.call("mass_export", { id });
    setExports((old) => ({ ...old, [id]: out }));
  });
  return (
    <Section title={t("mass_share_title")}>
      <p className="help">{t("mass_share_help")}</p>
      {error && <p role="alert">{String(error.message || error)}</p>}
      {data && !data.battles.length && <Empty title={t("mass_none")} />}
      {data?.battles.map((battle) => (
        <div key={battle.id} className="panel flex flex-wrap items-center gap-3 mt-2">
          <a className="flex-1 font-semibold" href={`#/campal/${battle.id}`}>{battle.title}</a>
          <Busy busy={busy[battle.id]} className="btn btn-sm" onClick={() => share(battle.id)}>{t("mass_share_export")}</Busy>
          {exports[battle.id] && <a className="btn btn-primary btn-sm" href={api.exportUrl(exports[battle.id].file)} download>{t("download")}</a>}
        </div>
      ))}
    </Section>
  );
}
