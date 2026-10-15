// Settings: your name for what you send, defaults for new battles, sprites, playback, the engine and the picture prompt for Prospero.
import React, { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { useApp } from "../context.js";
import { Busy, Field, Icon, ICONS, Section, Switch, useBusy, useLoad } from "../components/ui.jsx";
import { AiFields, FormatSelect, MonIcon } from "../components/silver.jsx";

export default function Ajustes() {
  const { t, notify, refreshOv, ov } = useApp();
  const { data, reload } = useLoad(() => api.call("settings_get"), []);
  const stats = useLoad(() => fetch("/api/sprites/stats").then((r) => r.json()), []);
  const [f, setF] = useState(null);
  const [busy, run] = useBusy();
  useEffect(() => { if (data) setF(data); }, [data]);
  if (!f) return null;
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const save = () => run("s", async () => {
    const { client_names, ...rest } = f;
    await api.call("settings_set", rest);
    notify(t("saved"));
    reload();
    refreshOv();
  });
  return (
    <div className="space-y-5 max-w-3xl">
      <div className="page-head"><div className="min-w-0"><h1>{t("nav_settings")}</h1></div></div>
      <div className="panel space-y-3">
        <Field label={t("player_name")} hint={t("player_name_help")}><input className="field" value={f.player_name} onChange={(e) => set("player_name", e.target.value)} /></Field>
        <Field label={t("default_format")}><FormatSelect id="set-format" value={f.default_format} onChange={(v) => set("default_format", v)} /></Field>
        <AiFields level={f.default_ai_level} style={f.default_ai_style} onLevel={(v) => set("default_ai_level", v)} onStyle={(v) => set("default_ai_style", v)} />
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t("playback_ms")}><input className="field" type="number" min={0} max={5000} step={50} value={f.playback_ms} onChange={(e) => set("playback_ms", Number(e.target.value))} /></Field>
          <Field label={t("max_turns")}><input className="field" type="number" min={20} max={2000} value={f.max_turns} onChange={(e) => set("max_turns", Number(e.target.value))} /></Field>
          <Field label={t("series_default")}><input className="field" type="number" min={1} max={1000} value={f.series_default} onChange={(e) => set("series_default", Number(e.target.value))} /></Field>
        </div>
      </div>
      <Section title={t("sprites")}>
        <div className="panel space-y-3">
          <Field label={t("sprite_set")}>
            <select className="field" value={f.sprite_set} onChange={(e) => set("sprite_set", e.target.value)}>
              {["gen5ani", "gen5", "ani", "home", "dex"].map((s) => <option key={s} value={s}>{t(`set_${s}`)}</option>)}
            </select>
          </Field>
          <div className="flex gap-2">{["Pikachu", "Charizard", "Garchomp", "Koraidon"].map((s) => <MonIcon key={s} species={s} size={64} />)}</div>
          <label className="flex items-center gap-2"><Switch checked={f.sprite_downloads} onChange={(v) => set("sprite_downloads", v)} label={t("sprite_downloads")} /> {t("sprite_downloads")}</label>
          <p className="help">{t("sprite_downloads_help")} {stats.data ? t("sprite_cache", { n: stats.data.cached, mb: (stats.data.bytes / 1048576).toFixed(1) }) : ""}</p>
        </div>
      </Section>
      <Section title={t("engine")}>
        <div className="panel space-y-3">
          <p className="help">{ov?.engine?.running ? t("engine_on", { v: ov.engine.node }) : t("engine_idle")}{ov?.engine?.last_error ? ` · ${ov.engine.last_error}` : ""}</p>
          <Field label={t("node_path")} hint={t("node_path_help")}><input className="field" value={f.node_path} onChange={(e) => set("node_path", e.target.value)} placeholder="node" /></Field>
        </div>
      </Section>
      <Section title={t("prospero")}>
        <div className="panel space-y-3">
          <Field label={t("prospero_prompt")} hint={t("prospero_prompt_help")}><textarea className="field" rows={4} value={f.prospero_prompt} onChange={(e) => set("prospero_prompt", e.target.value)} /></Field>
          <Field label={t("prospero_engine")} hint={t("prospero_engine_help")}>
            <select className="field" value={f.prospero_engine || ""} onChange={(e) => set("prospero_engine", e.target.value)}>
              <option value="">{t("prospero_engine_default")}</option>
              <option value="qwen21">Qwen-Image 2.1</option><option value="flux">FLUX</option><option value="sdxl">SDXL</option>
            </select>
          </Field>
          <StyleRefs />
        </div>
      </Section>
      <Busy busy={busy.s} className="btn btn-primary" onClick={save}>{t("save")}</Busy>
    </div>
  );
}

/** The art-style references for drawn sprites: your own pictures (official art, anime stills) first, then trainer sprites. */
function StyleRefs() {
  const { t, notify, sprites } = useApp();
  const { data, reload } = useLoad(() => api.call("avatar_style_get"), []);
  const [names, setNames] = useState("");
  const [busy, run] = useBusy();
  const fileRef = useRef(null);
  useEffect(() => { if (data) setNames(data.sprites.join(", ")); }, [data]);
  if (!data) return null;
  const used = new Set(data.used);
  const saveNames = () => run("n", async () => { await api.call("avatar_style_set", { sprites: names }); notify(t("saved")); reload(); });
  const add = () => run("a", async () => {
    const files = fileRef.current?.files || [];
    if (!files.length) return;
    await api.uploadStyleRefs(files);
    fileRef.current.value = "";
    reload();
  });
  const remove = (file) => run(file, async () => { await api.call("avatar_style_set", { remove: [file] }); reload(); });
  return (
    <div className="space-y-2">
      <b>{t("style_refs")}</b>
      <p className="help">{t("style_refs_help", { n: data.max })}</p>
      <div className="style-refs">
        {data.images.map((i) => (
          <div key={i.file} className={`style-ref${used.has(i.file) ? " is-used" : ""}`}>
            <img src={i.url} alt="" />
            <button type="button" className="btn btn-sm btn-icon btn-ghost" onClick={() => remove(i.file)} aria-label={t("remove")} disabled={busy[i.file]}>
              <Icon d={ICONS.trash} size={13} />
            </button>
          </div>
        ))}
        {data.sprites.map((n) => (
          <div key={n} className={`style-ref${used.has(n) ? " is-used" : ""}`}>
            <img src={sprites.trainer(`sd:${n}`)} alt={n} className="pixelated" /><span className="help trunc">{n}</span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input ref={fileRef} type="file" accept="image/*" multiple className="field flex-1" aria-label={t("style_refs_add")} />
        <Busy busy={busy.a} className="btn" onClick={add}>{t("style_refs_add")}</Busy>
      </div>
      <Field label={t("style_sprites")} hint={t("style_sprites_help")}>
        <div className="flex gap-2">
          <input className="field flex-1" value={names} onChange={(e) => setNames(e.target.value)} placeholder="backpacker, acetrainer, pilot" />
          <Busy busy={busy.n} className="btn" onClick={saveNames}>{t("save")}</Busy>
        </div>
      </Field>
    </div>
  );
}
