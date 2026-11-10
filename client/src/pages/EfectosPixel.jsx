// The pixelfx effects explorer (#/efectos, from Settings): every vendored effect animated, with its own colours or a type's, which
// moves play it, and a form to pin one to a move by hand. Pins live on the server (pixelfx_pin / pixelfx_unpin) and win over the
// automatic mapping in every battle screen with the "Pixel art (pixelfx)" animation style.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import { useApp } from "../context.js";
import { Busy, Field, Section, useBusy, useLoad } from "../components/ui.jsx";
import NAMES_ES from "../battle/names-es.js";
import { PINS_EVENT } from "../battle/pixelfx/gate.js";
import S from "./pixelfx-strings.js";

const PAGE = 24;
const ROLES = ["", "impact", "projectile", "beam", "area", "drop", "self"];
const TYPE_ES = { Normal: "Normal", Fire: "Fuego", Water: "Agua", Electric: "Eléctrico", Grass: "Planta", Ice: "Hielo", Fighting: "Lucha",
  Poison: "Veneno", Ground: "Tierra", Flying: "Volador", Psychic: "Psíquico", Bug: "Bicho", Rock: "Roca", Ghost: "Fantasma", Dragon: "Dragón",
  Dark: "Siniestro", Steel: "Acero", Fairy: "Hada" };

/** One animated effect; it only plays while it is on screen. */
function EffectCanvas({ lib, id, type, color, big = false, label }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !lib) return undefined;
    let stop = null;
    const start = () => { if (!stop) stop = lib.play(el, id, { type, color }); };
    const end = () => { if (stop) { stop(); stop = null; } };
    if (big || typeof IntersectionObserver === "undefined") { start(); return end; }
    const io = new IntersectionObserver(([e]) => (e.isIntersecting ? start() : end()), { rootMargin: "80px" });
    io.observe(el);
    return () => { io.disconnect(); end(); };
  }, [lib, id, type, color, big]);
  return <canvas ref={ref} aria-label={label} className={big ? "pixelfx-canvas pixelfx-big" : "pixelfx-canvas"}
    style={{ imageRendering: "pixelated", width: "100%", height: big ? 300 : 150, objectFit: "contain", background: "#16121e", borderRadius: 8 }} />;
}

export default function EfectosPixel() {
  const { lang, notify } = useApp();
  const tr = (k, vars = {}) => String(S[k]?.[lang === "en" ? 1 : 0] ?? k).replace(/\{(\w+)\}/g, (_, v) => vars[v] ?? "");
  const [lib, setLib] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { import("../battle/pixelfx/preview.js").then(setLib).catch(() => setFailed(true)); }, []);
  const moves = useLoad(() => api.call("pixelfx_moves", {}), []);
  const pins = useLoad(() => api.call("pixelfx_pins", {}), []);
  const [cat, setCat] = useState("");
  const [q, setQ] = useState("");
  const [onlyUsed, setOnlyUsed] = useState(false);
  const [type, setType] = useState("");
  const [page, setPage] = useState(0);
  const [sel, setSel] = useState("");
  const [form, setForm] = useState({ move: "", tint: false, color: "", role: "" });
  const [busy, run] = useBusy();
  const detailRef = useRef(null);

  const moveName = (m) => (lang === "en" ? m.name : NAMES_ES.moves?.[m.id] || m.name);
  const moveList = moves.data?.moves || [];
  const usage = useMemo(() => {
    const u = {};
    for (const m of moveList) { (u[m.effect] ||= []).push(m); if (m.hit?.effect && m.hit.effect !== m.effect) (u[m.hit.effect] ||= []).push(m); }
    return u;
  }, [moveList]);
  const ids = useMemo(() => {
    if (!lib) return [];
    const words = q.trim().toLowerCase();
    return lib.EFFECT_IDS.filter((id) => {
      if (cat && !id.startsWith(cat + "/")) return false;
      if (onlyUsed && !usage[id]) return false;
      if (!words) return true;
      const i = lib.effectInfo(id);
      return id.includes(words) || i.title.toLowerCase().includes(words) || i.tags.some((t) => t.includes(words)) || i.desc.toLowerCase().includes(words);
    });
  }, [lib, cat, q, onlyUsed, usage]);
  useEffect(() => { setPage(0); }, [cat, q, onlyUsed]);
  const shown = ids.slice(page * PAGE, page * PAGE + PAGE);
  const info = lib && sel ? lib.effectInfo(sel) : null;
  const users = (sel && usage[sel]) || [];
  const resolveMove = (text) => {
    const k = String(text || "").toLowerCase().replace(/[^a-z0-9áéíóúñü]/g, "");
    return moveList.find((m) => m.id === k || m.name.toLowerCase().replace(/[^a-z0-9]/g, "") === k
      || (NAMES_ES.moves?.[m.id] || "").toLowerCase().replace(/[^a-z0-9áéíóúñü]/g, "") === k) || null;
  };
  const target = resolveMove(form.move);
  const select = (id) => { setSel(id); setTimeout(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 30); };
  const changed = async () => {
    if (typeof window !== "undefined") window.dispatchEvent(new Event(PINS_EVENT));
    await Promise.all([moves.reload(), pins.reload()]);
  };
  const pin = () => run("pin", async () => {
    if (!target || !sel) return;
    const r = await api.call("pixelfx_pin", { move: target.id, effect: sel, tint: !!form.tint, color: form.color || "", role: form.role || "" });
    notify(tr("pinned", { move: moveName(target), effect: sel }));
    await changed();
    return r;
  });
  const unpin = (move) => run(`unpin-${move}`, async () => {
    await api.call("pixelfx_unpin", { move });
    notify(tr("unpinned"));
    await changed();
  });

  if (failed) return <p className="help">{tr("load_failed")}</p>;
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1>{tr("title")}</h1>
        <p className="help">{tr("intro")}</p>
        <p className="help"><a className="btn-link" href="#/ajustes">{tr("back")}</a></p>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Field label={tr("category")}>
          <select className="field" value={cat} onChange={(e) => setCat(e.target.value)} aria-label={tr("category")}>
            <option value="">{tr("all")} ({lib?.EFFECT_IDS.length ?? "…"})</option>
            {(lib?.CATEGORY_LIST || []).map((c) => <option key={c} value={c}>{lang === "en" ? c : lib.CATEGORY_ES[c]}</option>)}
          </select>
        </Field>
        <Field label={tr("search")}>
          <input className="field" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr("search_ph")} aria-label={tr("search")} />
        </Field>
        <Field label={tr("palette")} hint={tr("palette_help")}>
          <select className="field" value={type} onChange={(e) => setType(e.target.value)} aria-label={tr("palette")}>
            <option value="">{tr("own_colours")}</option>
            {(lib?.TYPES || []).map((ty) => <option key={ty} value={ty}>{lang === "en" ? ty : TYPE_ES[ty]}</option>)}
          </select>
        </Field>
        <label className="flex items-center gap-2 self-end pb-2">
          <input type="checkbox" checked={onlyUsed} onChange={(e) => setOnlyUsed(e.target.checked)} /> {tr("only_used")}
        </label>
      </div>

      {sel && info && (
        <section ref={detailRef} className="card space-y-3 p-3" aria-label={tr("detail")} data-testid="pixelfx-detail">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="mr-auto">{info.title} <span className="help">{sel}</span></h2>
            <button type="button" className="btn" onClick={() => setSel("")}>{tr("close")}</button>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <EffectCanvas lib={lib} id={sel} type={form.tint && target ? target.type : type} color={form.color} big label={info.title} />
              <p className="help">
                {lang === "en" ? info.category : lib.CATEGORY_ES[info.category]} · {info.loop ? tr("loop") : tr("once")} · {info.seconds} s · {info.size.join("×")} px
                {info.on_body ? ` · ${tr("on_body")}` : ""}
              </p>
              <p className="help">{tr("desc_original")}: {info.desc}</p>
              <p className="help">{tr("options")}: {info.options.join(", ")}</p>
              {info.palette && (
                <div className="flex gap-1" aria-label={tr("own_palette")}>
                  {info.palette.map((c, k) => <span key={k} title={c} style={{ width: 18, height: 18, background: c, borderRadius: 3, display: "inline-block" }} />)}
                </div>
              )}
            </div>
            <div className="space-y-3">
              <h3>{tr("pin_title")}</h3>
              <p className="help">{tr("pin_help")}</p>
              <Field label={tr("move")}>
                <input className="field" list="pixelfx-moves" value={form.move} onChange={(e) => setForm((f) => ({ ...f, move: e.target.value }))}
                  placeholder={tr("move_ph")} aria-label={tr("move")} data-testid="pixelfx-move" />
                <datalist id="pixelfx-moves">
                  {moveList.map((m) => <option key={m.id} value={moveName(m)}>{m.id}</option>)}
                </datalist>
              </Field>
              {target && (
                <p className="help" data-testid="pixelfx-current">
                  {tr("current", { move: moveName(target), effect: target.effect, source: tr(`src_${target.source}`) })}
                </p>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={tr("role")} hint={tr("role_help")}>
                  <select className="field" value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))} aria-label={tr("role")}>
                    {ROLES.map((r) => <option key={r} value={r}>{tr(`role_${r || "auto"}`)}</option>)}
                  </select>
                </Field>
                <Field label={tr("colour")} hint={tr("colour_help")}>
                  <div className="flex items-center gap-2">
                    <input type="color" value={form.color || "#ffffff"} onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))} aria-label={tr("colour")} />
                    <button type="button" className="btn" onClick={() => setForm((f) => ({ ...f, color: "" }))}>{tr("no_colour")}</button>
                  </div>
                </Field>
              </div>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.tint} onChange={(e) => setForm((f) => ({ ...f, tint: e.target.checked }))} /> {tr("tint")}
              </label>
              <Busy busy={busy.pin} className="btn btn-primary" disabled={!target} onClick={pin} data-testid="pixelfx-pin">
                {target ? tr("pin_to", { move: moveName(target) }) : tr("pin_pick")}
              </Busy>
              <div>
                <h3>{tr("used_by", { n: users.length })}</h3>
                <div className="flex flex-wrap gap-1">
                  {users.slice(0, 40).map((m) => (
                    <button key={m.id} type="button" className="chip" onClick={() => setForm((f) => ({ ...f, move: moveName(m) }))}>
                      {moveName(m)}{m.source === "pin" ? " ★" : ""}
                    </button>
                  ))}
                  {users.length > 40 && <span className="help">+{users.length - 40}</span>}
                  {!users.length && <span className="help">{tr("unused")}</span>}
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      <Section title={tr("effects")} count={ids.length} actions={(
        <>
          <button type="button" className="btn" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>{tr("prev")}</button>
          <span className="help">{tr("page", { n: page + 1, of: Math.max(1, Math.ceil(ids.length / PAGE)) })}</span>
          <button type="button" className="btn" disabled={(page + 1) * PAGE >= ids.length} onClick={() => setPage((p) => p + 1)}>{tr("next")}</button>
        </>
      )}>
        {!lib && <p className="help">{tr("loading")}</p>}
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
          {shown.map((id) => {
            const i = lib.effectInfo(id);
            const n = usage[id]?.length || 0;
            return (
              <button key={id} type="button" className={`card p-2 text-left space-y-1 ${sel === id ? "ring-2" : ""}`} onClick={() => select(id)}
                data-testid={`pixelfx-card-${id}`} aria-pressed={sel === id}>
                <EffectCanvas lib={lib} id={id} type={type} label={i.title} />
                <div className="text-sm font-semibold">{i.title}</div>
                <div className="help">{id} · {i.loop ? tr("loop") : tr("once")}{i.on_body ? ` · ${tr("on_body_short")}` : ""}</div>
                <div className="help">{n ? tr("moves_n", { n }) : tr("explorer_only")}</div>
              </button>
            );
          })}
        </div>
      </Section>

      <Section title={tr("pins")} count={pins.data?.count ?? 0}>
        {!pins.data?.count && <p className="help">{tr("no_pins")}</p>}
        {!!pins.data?.count && (
          <div className="overflow-x-auto">
            <table className="table w-full" data-testid="pixelfx-pins">
              <thead><tr><th>{tr("move")}</th><th>{tr("effect")}</th><th>{tr("auto")}</th><th /></tr></thead>
              <tbody>
                {pins.data.pins.map((p) => (
                  <tr key={p.move}>
                    <td>{lang === "en" ? p.name : NAMES_ES.moves?.[p.move] || p.name}</td>
                    <td><button type="button" className="btn-link" onClick={() => select(p.effect)}>{p.effect}</button>{p.color ? ` (${p.color})` : p.tint ? ` (${tr("tint_short")})` : ""}{p.role ? ` · ${tr(`role_${p.role}`)}` : ""}</td>
                    <td className="help">{p.auto?.effect || "—"}</td>
                    <td><Busy busy={busy[`unpin-${p.move}`]} className="btn" onClick={() => unpin(p.move)}>{tr("unpin")}</Busy></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
      <p className="help">{tr("credits")}</p>
    </div>
  );
}
