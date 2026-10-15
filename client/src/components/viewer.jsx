// A picture shown big: a sprite enlarged by whole steps without blurring, a drawing, a photo or an official artwork fitted to the
// screen. Several pictures page with the arrows (keyboard too); each one can carry its own buttons (use it, download it…).
import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useApp } from "../context.js";
import { Icon, ICONS, Spinner } from "./ui.jsx";
import { PIXEL_MAX } from "../smooth-art.js";

/** items: [{url, title, sub, credit, href}]; index: the one shown first; actions(item, index) → buttons under it. */
export function ImageViewer({ items, index = 0, onClose, actions, onIndex }) {
  const { t } = useApp();
  const list = useMemo(() => (items || []).filter((x) => x && x.url), [items]);
  const [i, setI] = useState(Math.max(0, Math.min(index, list.length - 1)));
  const [nat, setNat] = useState(null);
  const [failed, setFailed] = useState(false);
  const item = list[i];
  useEffect(() => { setNat(null); setFailed(false); onIndex?.(i); }, [i, item?.url]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (e) => {
      // the viewer sits over dialogs: its keys are its own (Escape closes only the viewer)
      if (e.key === "Escape") { e.stopImmediatePropagation(); e.preventDefault(); onClose(); }
      else if (e.key === "ArrowRight" && list.length > 1) { e.stopImmediatePropagation(); setI((x) => (x + 1) % list.length); }
      else if (e.key === "ArrowLeft" && list.length > 1) { e.stopImmediatePropagation(); setI((x) => (x - 1 + list.length) % list.length); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [list.length, onClose]);
  if (!item) return null;
  const pixel = nat && Math.max(nat.w, nat.h) <= PIXEL_MAX;
  // pixel art: the largest whole factor that fits 70 % of the screen; anything else: fit, never past its own size
  const box = { w: Math.min(window.innerWidth - 48, 1100), h: window.innerHeight * 0.72 };
  let style = { maxWidth: box.w, maxHeight: box.h };
  if (pixel) {
    const k = Math.max(1, Math.floor(Math.min(box.w / nat.w, box.h / nat.h)));
    style = { width: nat.w * k, height: nat.h * k };
  }
  return createPortal(
    <div className="viewer-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} role="dialog" aria-modal="true"
      aria-label={item.title || t("viewer_title")}>
      <div className="viewer" onMouseDown={(e) => e.stopPropagation()}>
        <div className="viewer-head">
          <div className="min-w-0 flex-1">
            <b className="trunc block">{item.title || t("viewer_title")}</b>
            <span className="help trunc block">
              {[item.sub, nat ? `${nat.w} × ${nat.h} px` : "", list.length > 1 ? `${i + 1} / ${list.length}` : ""].filter(Boolean).join(" · ")}
            </span>
          </div>
          <a className="btn btn-sm btn-icon btn-ghost" href={item.url} download target="_blank" rel="noreferrer" title={t("viewer_open")} aria-label={t("viewer_open")}>
            <Icon d={ICONS.download} size={14} />
          </a>
          <button type="button" className="btn btn-sm btn-icon btn-ghost" onClick={onClose} aria-label={t("viewer_close")} title={t("viewer_close")}><Icon d={ICONS.close} size={14} /></button>
        </div>
        <div className="viewer-stage">
          {list.length > 1 && <button type="button" className="viewer-nav prev" onClick={() => setI((x) => (x - 1 + list.length) % list.length)} aria-label={t("viewer_prev")}><Icon d={ICONS.back} size={22} /></button>}
          {!nat && !failed && <div className="viewer-loading"><Spinner /></div>}
          {failed ? <div className="viewer-failed help">{t("viewer_failed")}</div> : (
            <img key={item.url} src={item.url} alt={item.title || ""} style={style} className={`viewer-img ${pixel ? "is-pixel" : "is-smooth"}`} draggable={false}
              onLoad={(e) => setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} onError={() => setFailed(true)} />
          )}
          {list.length > 1 && <button type="button" className="viewer-nav next" onClick={() => setI((x) => (x + 1) % list.length)} aria-label={t("viewer_next")}><Icon d={ICONS.chevron} size={22} /></button>}
        </div>
        {(item.credit || item.href) && (
          <div className="help viewer-credit">
            {item.credit}{item.href ? <> · <a className="btn-link" href={item.href} target="_blank" rel="noreferrer">{t("viewer_source")} ↗</a></> : null}
          </div>
        )}
        {actions && <div className="viewer-actions">{actions(item, i)}</div>}
        {list.length > 1 && (
          <div className="viewer-strip" role="tablist">
            {list.map((x, n) => (
              <button key={`${x.url}-${n}`} type="button" role="tab" aria-selected={n === i} className={`viewer-thumb ${n === i ? "is-on" : ""}`} onClick={() => setI(n)} title={x.title || ""}>
                <img src={x.thumb || x.url} alt="" loading="lazy" draggable={false} />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
