// "Video" on a finished battle: record its replay as a clip with sound (battle_video, a job), watch it here, download it or send it
// to Lumiere's Hoard, the family's video editor. Mass battles use it too (tool mass_video with their own arguments and help).
import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { useApp } from "../context.js";
import { Busy, Icon, ICONS, Modal, useBusy } from "./ui.jsx";
import { JobProgress, useJob } from "./silver.jsx";
import { L } from "../battle/dex.js";

const S = {
  button: ["Vídeo", "Video"],
  title: ["Vídeo de la repetición", "Replay video"],
  help: ["Se graba la repetición con su sonido (efectos, gritos y música) en un navegador sin ventana y queda como MP4 en la carpeta de exportaciones. Tarda lo que dura el combate.",
    "The replay is recorded with its sound (effects, cries and music) in a windowless browser and saved as an MP4 in the exports folder. It takes as long as the battle."],
  speed: ["Velocidad", "Speed"], slow: ["Lenta", "Slow"], normal: ["Normal", "Normal"], fast: ["Rápida", "Fast"],
  size: ["Tamaño", "Size"],
  lumiere: ["Mandarlo también a Lumiere's Hoard (editor de vídeo)", "Also send it to Lumiere's Hoard (video editor)"],
  record: ["Grabar vídeo", "Record video"],
  download: ["Descargar", "Download"],
  sent: ["En Lumiere's Hoard", "In Lumiere's Hoard"],
  not_sent: ["No se pudo mandar a Lumiere's Hoard: {e}", "Could not send it to Lumiere's Hoard: {e}"],
  missing: ["Para grabar hace falta: {what}", "Recording needs: {what}"],
  no_sound: ["Sin sonido", "No sound"],
};
const fill = (text, vars = {}) => text.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ""));

export default function VideoExport({ battle = null, tool = "battle_video", args = null, help = "", label = "" }) {
  const { lang, toastError, notify } = useApp();
  const s = (k, v) => fill(L(S[k], lang), v);
  const [open, setOpen] = useState(false);
  const [speed, setSpeed] = useState("normal");
  const [size, setSize] = useState("720p");
  const [lumiere, setLumiere] = useState(false);
  const [status, setStatus] = useState(null);
  const [jobId, setJobId] = useState("");
  const [result, setResult] = useState(null);
  const [busy, run] = useBusy();
  useEffect(() => { if (open && !status) api.call("video_status", {}).then(setStatus).catch(() => {}); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const job = useJob(jobId, (j) => {
    if (j.status === "done") { setResult(j.result); notify(s("title")); } else toastError({ message: j.error || "error" });
  });
  const running = !!job && ["queued", "running"].includes(job.status);
  const start = () => run("rec", async () => {
    setResult(null);
    const r = await api.call(tool, { ...(args || { id: battle.id }), speed, size, lang, lumiere });
    setJobId(r.id || r.job?.id || "");
  });
  const missing = status ? [!status.playwright && "Playwright", !status.browser && "Chrome / Edge"].filter(Boolean) : [];
  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}><Icon d={ICONS.video} size={15} /> {label || s("button")}</button>
      {open && (
        <Modal title={s("title")} onClose={() => setOpen(false)}>
          <div className="space-y-3">
            <p className="help">{help || s("help")}</p>
            {missing.length > 0 && <div className="banner banner-info">{s("missing", { what: missing.join(", ") })} · {status.hint}</div>}
            <div className="flex flex-wrap items-center gap-3">
              <span className="help">{s("speed")}</span>
              <div className="seg" role="group" aria-label={s("speed")}>
                {["slow", "normal", "fast"].map((k) => <button key={k} type="button" aria-pressed={speed === k} onClick={() => setSpeed(k)}>{s(k)}</button>)}
              </div>
              <span className="help">{s("size")}</span>
              <div className="seg" role="group" aria-label={s("size")}>
                {["720p", "1080p"].map((k) => <button key={k} type="button" aria-pressed={size === k} onClick={() => setSize(k)}>{k}</button>)}
              </div>
            </div>
            <label className="flex items-center gap-2"><input type="checkbox" checked={lumiere} onChange={(e) => setLumiere(e.target.checked)} /> {s("lumiere")}</label>
            <Busy busy={busy.rec || running} className="btn btn-primary" disabled={missing.length > 0} onClick={start}>{s("record")}</Busy>
            {job && <JobProgress job={job} />}
            {result && (
              <div className="space-y-2">
                <video className="video-preview" src={api.exportUrl(result.file) + "?download=false"} controls preload="metadata" />
                <div className="flex flex-wrap items-center gap-2">
                  <a className="btn btn-sm" href={api.exportUrl(result.file)} download={result.file}><Icon d={ICONS.download} size={14} /> {s("download")}</a>
                  <span className="help">{result.file} · {Math.round(result.bytes / 1024 / 1024 * 10) / 10} MB · {result.seconds} s{result.sound ? "" : ` · ${s("no_sound")}`}</span>
                  {result.lumiere && (result.lumiere.error ? <span className="help">{s("not_sent", { e: result.lumiere.error })}</span> : <span className="chip chip-ok">{s("sent")}</span>)}
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
