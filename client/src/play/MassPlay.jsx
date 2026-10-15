// A mass battle on the friends' playable page (silvers_hoard/mass.py: export_page): the friend watches the battle as the AI fought
// it, or picks one of its Pokémon and plays it (MassScreen with the page's own copy of the engine). A played battle gives a
// SILVERMASS1- code with the input log; the owner pastes it in Import and the app replays it before recording the run.
import React, { useMemo, useState } from "react";
import { dexNum } from "../../../engine/src/core.mjs";
import { makeSprites } from "../battle/dex.js";
import MassScreen from "../battle/mass/MassScreen.jsx";
import UnitPicker from "../battle/mass/UnitPicker.jsx";
import { massT } from "../pages/mass-strings.js";
import { playT } from "./strings.js";
import { packCode, packMassInputs } from "./rtcode.js";
import "../battle/mass/mass.css";

const PREFIX = "SILVERMASS1-";
const readName = () => { try { return localStorage.getItem("silver-play-name") || ""; } catch { return ""; } };

function CodeBox({ code, owner, t }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(code); setCopied(true); } catch { /* the friend can still select it */ }
  };
  const download = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([code], { type: "text/plain" }));
    a.download = "silver-campal.txt";
    a.click();
  };
  return (
    <div className="space-y-2 text-left">
      <b>{t("mass_code_title", { name: owner })}</b>
      <div className="help">{t("mass_code_help", { name: owner })}</div>
      <textarea className="field w-full" rows={4} readOnly value={code} onFocus={(e) => e.target.select()} />
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary btn-sm" onClick={copy}>{copied ? t("copied") : t("copy")}</button>
        <button type="button" className="btn btn-sm" onClick={download}>{t("download_code_file")}</button>
      </div>
    </div>
  );
}

export default function MassPlay({ data, lang, setLang }) {
  const m = data.mass;
  const mt = massT(lang);
  const pt = playT(lang);
  const t = (k, v) => (k.startsWith("mass_") ? mt(k, v) : pt(k, v));
  const owner = m.from || data.from || "";
  const sprites = useMemo(() => makeSprites({ server: data.sprite_server || "https://play.pokemonshowdown.com/sprites", set: data.sprite_set || "gen5ani", dexNum }), [data]);
  const [name, setName] = useState(readName);
  const [view, setView] = useState({ kind: "watch" });
  const [round, setRound] = useState(0);
  const doc = useMemo(() => ({ id: m.id, title: m.title, spec: m.spec }), [m]);
  const saveName = (v) => { setName(v); try { localStorage.setItem("silver-play-name", v.trim()); } catch { /* not critical */ } };
  const onPlayed = async ({ unit, inputs, hash }) => {
    const code = await packCode(PREFIX, { kind: "mass", v: 1, mass_id: m.id, title: m.title, challenger: (name || "Amigo").trim().slice(0, 60), unit,
      inputs: await packMassInputs(inputs), hash });
    return { node: <CodeBox code={code} owner={owner || "Silver's Hoard"} t={t} /> };
  };
  return (
    <div className="p-wrap">
      <header className="p-head">
        <div className="p-target"><h1>{m.title}</h1></div>
        <button type="button" className="btn btn-sm" onClick={() => setLang(lang === "es" ? "en" : "es")}>{t("language")}</button>
      </header>
      <p className="help">{t("mass_page_intro", { name: owner || "Silver's Hoard" })} {t(`mass_mode_${m.mode}`)} · {t("mass_units", { n: m.units })}</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="space-y-1"><span className="label">{t("your_name")}</span>
          <input className="field max-w-[220px]" value={name} maxLength={60} placeholder={t("mass_name_ph")} onChange={(e) => saveName(e.target.value)} />
        </label>
        <div className="seg" role="group">
          <button type="button" aria-pressed={view.kind === "watch"} onClick={() => setView({ kind: "watch" })}>{t("mass_watch_only")}</button>
          <button type="button" aria-pressed={view.kind !== "watch"} onClick={() => setView({ kind: "pick" })}>{t("mass_play")}</button>
        </div>
      </div>
      {view.kind === "pick" && <div className="panel"><UnitPicker spec={m.spec} t={t} onPick={(unit) => { setRound((n) => n + 1); setView({ kind: "play", unit }); }} onCancel={() => setView({ kind: "watch" })} /></div>}
      {view.kind !== "pick" && (
        <MassScreen key={`${view.kind}:${view.unit ?? ""}:${round}`} doc={doc} t={t} sprites={sprites} offline
          play={view.kind === "play" ? { unit: view.unit } : null}
          onPlayed={view.kind === "play" ? onPlayed : null}
          onCheck={view.kind === "watch" ? async (hash) => ({ same: hash === m.hash }) : null}
          onAgain={view.kind === "play" ? () => setRound((n) => n + 1) : null}
          onBack={view.kind === "play" ? () => setView({ kind: "pick" }) : null} />
      )}
      {(m.plays || []).length > 0 && (
        <section className="panel space-y-2">
          <b>{t("mass_plays")}</b>
          <table className="mass-rank">
            <thead><tr><th>{t("mass_place")}</th><th>{t("mass_player")}</th><th>{t("mass_pokemon")}</th><th>{t("mass_kos_h")}</th><th>{t("mass_damage")}</th></tr></thead>
            <tbody>
              {m.plays.map((p) => <tr key={p.id}><td className="num">{p.place}/{p.of}</td><td>{p.challenger}</td><td>{p.name}</td><td className="num">{p.kos}</td><td className="num">{p.dealt}</td></tr>)}
            </tbody>
          </table>
        </section>
      )}
      <footer className="p-foot help">{t("made_with")}</footer>
    </div>
  );
}
