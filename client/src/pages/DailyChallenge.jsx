import React, { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { useApp } from "../context.js";
import { Busy, ErrorBox, Field, Modal, useBusy, useLoad } from "../components/ui.jsx";
import { MonIcon } from "../components/silver.jsx";

export default function DailyChallenge({ initialDay = "" }) {
  const { t, lang, changed } = useApp();
  const [day, setDay] = useState(initialDay);
  const [page, setPage] = useState(null);
  const [saved, setSaved] = useState(null);
  const [pending, setPending] = useState("");
  const [saveError, setSaveError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [busy, run] = useBusy();
  const frame = useRef(null), queue = useRef(Promise.resolve());
  const { data, loading, error, reload } = useLoad(() => api.call("daily_challenge", { day }), [day]);
  useEffect(() => { setDay(initialDay); }, [initialDay]);
  const ready = data && !loading && !error && data.day === (day || data.current_day);
  const exportPage = async (play) => {
    const doc = await api.call("daily_challenge_export", { day: data.day });
    if (play) {
      const url = new URL(doc.url, location.href);
      url.searchParams.set("download", "false"); url.searchParams.set("lang", lang);
      setSaved(null); setPending(""); setSaveError(null); setPage({ ...doc, src: url.href });
    } else setPage((old) => old ? { ...old, download: doc } : { download: doc });
  };
  const receive = useRef(null);
  receive.current = (code) => {
    queue.current = queue.current.then(async () => {
      setSaving(true); setPending(code); setSaveError(null); setSaved(null);
      try {
        const result = await api.call("import", { content: code });
        setSaved(result); setPending(""); changed(); await reload();
      } catch (e) { setSaveError(e); }
      finally { setSaving(false); }
    });
  };
  useEffect(() => {
    const onResult = (event) => {
      if (event.origin !== location.origin || event.source !== frame.current?.contentWindow) return;
      if (event.data?.type === "silver-daily-result" && typeof event.data.code === "string") receive.current(event.data.code);
    };
    window.addEventListener("message", onResult);
    return () => window.removeEventListener("message", onResult);
  }, []);
  const entries = data?.boards?.flatMap((b) => b.entries) || [];
  return <section className="panel space-y-3" aria-labelledby="daily-title">
    <h2 id="daily-title">{t("daily_title")}</h2>
    <p className="help">{t("daily_intro")}</p>
    <div className="flex flex-wrap items-end gap-2">
      <Field label={t("daily_date")}><input type="date" className="field" value={day || data?.current_day || ""} onChange={(e) => setDay(e.target.value)} /></Field>
      <button className="btn" type="button" onClick={() => setDay("")}>{t("daily_today")}</button>
      {(data?.days || []).filter((d) => d !== (day || data.day)).slice(-7).reverse().map((d) =>
        <button type="button" className="btn btn-sm" key={d} onClick={() => setDay(d)}>{d}</button>)}
    </div>
    {error && <ErrorBox error={error} onRetry={reload} />}
    {loading && <p className="help" role="status">{t("daily_loading")}</p>}
    {ready && <>
      <div className="flex flex-wrap gap-3" aria-label={t("daily_rentals")}>
        {data.rentals.map((m, i) => <span key={i} className="flex items-center gap-1"><MonIcon species={m.species} size={36} /><span>{m.species}</span></span>)}
      </div>
      <div className="flex flex-wrap gap-2">
        <Busy busy={busy.play} className="btn btn-primary" disabled={!!busy.export} onClick={() => run("play", () => exportPage(true))}>{t("daily_play")}</Busy>
        <Busy busy={busy.export} disabled={!!busy.play} onClick={() => run("export", () => exportPage(false))}>{t("daily_export")}</Busy>
        {page?.download && <a className="btn" href={page.download.url} download={page.download.file}>{t("download")}</a>}
      </div>
      <h3>{t("daily_board")}</h3>
      {!entries.length ? <p className="help">{t("daily_empty")}</p> : <ol className="divide-list p-0">
        {entries.map((e) => <li className="row-item flex-wrap gap-2" key={e.id}>
          <span className="num">{e.rank}</span><b className="min-w-0 flex-1 trunc">{e.challenger}</b>
          <span className={e.won ? "chip chip-ok" : "chip"}>{t("daily_score", { n: e.battles_won })}</span>
          <a className="btn btn-sm" href={`#/combate/${e.battle_id}`}>{t("lb_replay")}</a>
        </li>)}
      </ol>}
    </>}
    {page?.src && <Modal wide title={t("daily_title")} onClose={() => setPage(null)}>
      <iframe ref={frame} src={page.src} title={t("daily_title")} className="w-full border-0 rounded" style={{ height: "min(76dvh, 850px)" }} allow="autoplay; gamepad" />
      {saving && <p role="status" className="help">{t("daily_saving")}</p>}
      {saved && <p role="status">{t("daily_saved")}</p>}
      {saveError && <><ErrorBox error={saveError} /><button type="button" className="btn" disabled={saving || !pending} onClick={() => receive.current(pending)}>{t("daily_retry")}</button></>}
      <p className="help">{t("daily_result_help")}</p>
    </Modal>}
  </section>;
}
