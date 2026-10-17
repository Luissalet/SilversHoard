import React, {useEffect, useRef, useState} from "react";
import {api} from "../api.js";
import {useApp} from "../context.js";
import {CopyButton, ErrorBox, Field, Icon, ICONS, useLoad} from "./ui.jsx";
import {ControllerSession, samplePads} from "../controller-diagnostics.js";

export default function ControllerDiagnostics() {
  const {t} = useApp();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(false);
  const [pads, setPads] = useState([]);
  const [selected, setSelected] = useState("");
  const [mode, setMode] = useState("realtime");
  const [layout, setLayout] = useState("za");
  const [failure, setFailure] = useState("");
  const [hidden, setHidden] = useState(false);
  const [, setRevision] = useState(0);
  const session = useRef(null), started = useRef(0);
  const {data: guide, error, reload} = useLoad(() => api.call("controller_guide"), []);
  const supported = typeof navigator !== "undefined" && typeof navigator.getGamepads === "function";
  const elapsed = () => performance.now() - started.current;
  const stop = (reason = "user") => {
    if (active) session.current?.event("stop", {reason}, elapsed());
    setActive(false); setRevision(n => n + 1);
  };
  useEffect(() => {
    if (!active || !open) return undefined;
    let raf = 0, lastPaint = -Infinity;
    const poll = now => {
      try {
        if (!document.hidden) {
          const snapshot = samplePads(navigator.getGamepads());
          session.current.observe(snapshot, now - started.current);
          if (now - lastPaint >= 100 || session.current.full) {
            setPads(snapshot); setRevision(n => n + 1); lastPaint = now;
          }
          if (session.current.full) { setActive(false); return; }
        }
        raf = requestAnimationFrame(poll);
      } catch (e) {
        session.current.event("error", {name: e.name || "Error"}, now - started.current);
        setFailure("controller_blocked"); setActive(false); setRevision(n => n + 1);
      }
    };
    const visibility = () => {
      setHidden(document.hidden);
      session.current.event("visibility", {hidden: document.hidden}, elapsed());
    };
    setHidden(document.hidden);
    document.addEventListener("visibilitychange", visibility);
    raf = requestAnimationFrame(poll);
    return () => {cancelAnimationFrame(raf); document.removeEventListener("visibilitychange", visibility);};
  }, [active, open]);
  const start = () => {
    if (!session.current) {
      started.current = performance.now();
      session.current = new ControllerSession(mode, layout, undefined, guide.log_limit);
    }
    session.current.event("start", {}, elapsed());
    setFailure(""); setActive(true);
  };
  const chooseMode = value => {
    const nextLayout = guide.modes.find(m => m.id === value).layouts[0];
    setMode(value); setLayout(nextLayout);
    session.current?.mode(value, nextLayout, elapsed()); setRevision(n => n + 1);
  };
  const chooseLayout = value => {
    setLayout(value); session.current?.mode(mode, value, elapsed()); setRevision(n => n + 1);
  };
  const download = () => {
    const blob = new Blob([JSON.stringify(session.current.export(), null, 2)], {type: "application/json"});
    const url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = "silver-controller-session.json"; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const clear = () => { session.current = null; setPads([]); setFailure(""); setRevision(n => n + 1); };
  const current = selected === "" ? pads[0] : pads.find(p => String(p.index) === selected);
  const modeInfo = guide?.modes.find(m => m.id === mode);
  const count = session.current?.entries.length || 0;
  return (
    <details className="panel" id="controller-diagnostics" onToggle={e => {setOpen(e.currentTarget.open); if (!e.currentTarget.open) stop("collapsed");}}>
      <summary className="cursor-pointer"><h2 className="inline">{t("controller_title")}</h2></summary>
      <div className="space-y-4 mt-3">
        <p className="help">{t("controller_help")}</p>
        <ErrorBox error={error} onRetry={reload}/>
        {!guide ? !error && <p role="status">{t("loading")}</p> : <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("controller_mode")}><select className="field" value={mode} onChange={e => chooseMode(e.target.value)}>
              {guide.modes.map(m => <option key={m.id} value={m.id}>{t(`controller_mode_${m.id}`)}</option>)}
            </select></Field>
            <Field label={t("controller_layout")}><select className="field" value={layout} onChange={e => chooseLayout(e.target.value)}>
              {modeInfo.layouts.map(value => <option key={value} value={value}>{t(`controller_layout_${value}`)}</option>)}
            </select></Field>
          </div>
          <div className="flex flex-wrap gap-2">
            {active ? <button type="button" className="btn min-h-11" onClick={() => stop()}><Icon d={ICONS.stop}/>{t("controller_stop")}</button>
              : <button type="button" className="btn btn-primary min-h-11" disabled={!supported || session.current?.full} onClick={start}><Icon d={ICONS.play}/>{t(count ? "controller_resume" : "controller_start")}</button>}
            <button type="button" className="btn min-h-11" disabled={!count} onClick={download}><Icon d={ICONS.download}/>{t("controller_download")}</button>
            <button type="button" className="btn min-h-11" disabled={active || !count} onClick={clear}>{t("controller_clear")}</button>
          </div>
          <p role="status">{t(!supported ? "controller_unsupported" : failure || (session.current?.full ? "controller_full" : active ? hidden ? "controller_hidden" : "controller_recording" : "controller_stopped"))}</p>
          {active && !pads.length && <p className="help">{t("controller_no_pad")}</p>}
          <p className="help num">{t("controller_events", {n: count, limit: guide.log_limit})}</p>
          {!!pads.length && <Field label={t("controller_device")}><select className="field" value={selected} onChange={e => setSelected(e.target.value)}>
            <option value="">{t("controller_first")}</option>
            {pads.map(p => <option key={p.index} value={p.index}>#{p.index}: {p.id}</option>)}
          </select></Field>}
          {current ? <section className="space-y-3" aria-label={t("controller_raw")}>
            <h3>{t("controller_raw")}</h3>
            <p className="break-words">#{current.index} {current.id}</p>
            <p className="help">{t(current.mapping === "standard" ? "controller_standard" : "controller_nonstandard")}</p>
            <div className="grid grid-cols-2 gap-3">
              {current.axes.map((value, i) => <label key={i} className="space-y-1">A{i} <output className="num">{value.toFixed(3)}</output>
                <meter className="block w-full" min={-1} max={1} value={value} aria-label={t("controller_axis", {n: i})}/></label>)}
            </div>
            <table className="table w-full"><thead><tr><th>{t("controller_button")}</th><th>{t("controller_value")}</th><th>{t("controller_pressed")}</th><th>{t("controller_touched")}</th></tr></thead>
              <tbody>{current.buttons.map((b,i) => <tr key={i}><th scope="row">B{i}</th><td className="num">{b.value.toFixed(3)}</td><td>{t(b.pressed ? "controller_yes" : "controller_no")}</td><td>{t(b.touched ? "controller_yes" : "controller_no")}</td></tr>)}</tbody>
            </table>
          </section> : selected !== "" && <p className="help">{t("controller_disconnected")}</p>}
          <section className="space-y-2" aria-label={t("controller_bindings")}>
            <h3>{t("controller_bindings")}</h3><p className="help">{t("controller_numbering")}</p>
            <dl className="space-y-2">{modeInfo.bindings[layout].map(([input, action]) => <div key={action} className="grid gap-1 sm:grid-cols-2"><dt className="font-semibold">{input}</dt><dd>{t(`controller_action_${action}`)}</dd></div>)}</dl>
          </section>
          <section className="space-y-2" aria-label={t("controller_log")}>
            <h3>{t("controller_log")}</h3><p className="help">{t("controller_log_help")}</p>
            {!!count && <pre className="help max-h-48 overflow-auto whitespace-pre-wrap break-words" tabIndex={0} aria-label={t("controller_recent")}>{JSON.stringify(session.current.entries.slice(-4), null, 2)}</pre>}
          </section>
          <details><summary className="cursor-pointer">{t("controller_firewall")}</summary><div className="space-y-2 mt-2">
            <p className="help">{t("controller_firewall_help", {port: guide.port})}</p>
            <textarea className="field" rows={4} readOnly value={guide.firewall_command} aria-label={t("controller_firewall_command")}/>
            <CopyButton text={guide.firewall_command} label={t("controller_firewall_copy")}/>
          </div></details>
        </>}
      </div>
    </details>
  );
}
