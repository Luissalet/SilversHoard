import React, { useState } from "react";
import { api } from "../api.js";
import { useApp } from "../context.js";
import { Busy, Icon, ICONS, Modal, useBusy } from "./ui.jsx";
import { JobProgress, useJob } from "./silver.jsx";
import StyleReferences from "./StyleReferences.jsx";

export default function TrainerPoster({ trainer, onClose }) {
  const { t, lang } = useApp();
  const [busy, run] = useBusy();
  const [jobId, setJobId] = useState("");
  const job = useJob(jobId);
  const running = Boolean(jobId) && (!job || ["queued", "running"].includes(job.status));
  const result = job?.status === "done" ? job.result : null;
  const create = () => run("create", async () => {
    const job = await api.call("trainer_poster", { id: trainer.id, lang });
    setJobId(job.id);
  });
  return <Modal title={t("poster_title", { name: trainer.name })} onClose={onClose} wide>
    <p className="help">{t("poster_help")}</p>
    <details className="panel"><summary>{t("style_refs")}</summary><div className="pt-3"><StyleReferences query={trainer.name} /></div></details>
    <Busy busy={busy.create || running} className="btn btn-primary" onClick={create}>
      <Icon d={ICONS.image} size={16} />{t(result ? "poster_again" : "poster_create")}
    </Busy>
    {job && <JobProgress job={job} />}
    {result && <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <a className="btn btn-primary" href={api.exportUrl(result.file)} download={result.file}><Icon d={ICONS.download} size={15} />{t("poster_download")}</a>
        <span className="help num">{result.width} × {result.height} · {Math.round(result.bytes / 1024)} KB</span>
      </div>
      {result.warnings?.length > 0 && <p className="banner banner-warn">{t("poster_missing", { n: result.warnings.length })}</p>}
      <img src={`${api.exportUrl(result.file)}?download=false`} className="block w-full h-auto" alt={t("poster_preview", { name: result.name })} />
      <p className="help">{t("poster_credits_help")}</p>
    </div>}
  </Modal>;
}
