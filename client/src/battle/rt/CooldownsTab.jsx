// A trainer's team in real time: each move's cooldown (Legends: Z-A's own or worked out from PP), what that Pokémon really waits
// with its Speed, its wind-up and its shape on the field.
import React from "react";
import { api } from "../../api.js";
import { useLoad, ErrorBox, Spinner } from "../../components/ui.jsx";
import { nameOf, typeName, TYPE_COLORS } from "../dex.js";

export default function CooldownsTab({ trainerId, t, lang }) {
  const { data, error, reload } = useLoad(() => api.call("rt_cooldowns", { trainer_id: trainerId }), [trainerId]);
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Spinner />;
  return (
    <div className="space-y-3">
      <p className="help">{t("rt_cooldowns_help")}</p>
      {data.pokemon.map((p, i) => (
        <div key={i} className="panel space-y-2">
          <div className="flex flex-wrap items-baseline gap-2"><b>{p.name}</b><span className="help">{t("lv")}{p.level} · {t("rt_speed_n", { n: p.stats.spe })}</span></div>
          <div className="overflow-x-auto">
            <table className="table w-full text-sm">
              <thead><tr><th className="text-left">{t("rt_ctrl_moves")}</th><th>PP</th><th>{t("rt_cooldown")}</th><th>{t("rt_final")}</th><th>{t("rt_shape")}</th></tr></thead>
              <tbody>
                {p.moves.map((m) => (
                  <tr key={m.id}>
                    <td><span className="type-dot" style={{ background: TYPE_COLORS[m.type] }} /> {nameOf("move", m.name, lang)} <span className="help">{typeName(m.type, lang)}</span></td>
                    <td className="text-center num">{m.pp ?? ""}</td>
                    <td className="text-center num">{m.cooldown} s <span className="help">({t(m.za ? "rt_src_za" : "rt_src_derived")})</span></td>
                    <td className="text-center num"><b>{m.final} s</b></td>
                    <td className="text-center">{t(`rt_shape_${m.shape}`)}{m.no_effect ? ` · ${t("rt_no_effect")}` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
