import React, { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { useApp } from "../context.js";
import { ErrorBox, Icon, ICONS, useBusy, useLoad } from "./ui.jsx";
import { OfficialArtGrid } from "./silver.jsx";

export default function StyleReferences({ query = "" }) {
  const { t, sprites, notify } = useApp();
  const { data, error, reload } = useLoad(() => api.call("avatar_style_get"), []);
  const [busy, run] = useBusy();
  const [source, setSource] = useState("mine");
  const [search, setSearch] = useState(query);
  const [items, setItems] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const input = useRef(null);
  useEffect(() => {
    let off = false;
    setItems([]); setLoadError(null);
    const timer = setTimeout(async () => {
      try {
        const r = await api.call(source === "sprites" ? "trainer_sprites_search" : "avatar_images", { query: search, limit: 80 });
        if (!off) setItems(source === "sprites" ? r.sprites.map((name) => ({ url: sprites.trainer(`sd:${name}`), title: name, sprite: name })) :
          r.images.map((im) => ({ ...im, title: im.title || im.trainers.join(", ") || im.file })));
      } catch (e) { if (!off) setLoadError(e); }
    }, 200);
    return () => { off = true; clearTimeout(timer); };
  }, [source, search, sprites]);
  const add = (item) => run("add", async () => {
    // Copy the image into the reference library: it must never replace the trainer's identity image.
    const response = await fetch(item.url);
    if (!response.ok) throw new Error(t("style_ref_failed"));
    const blob = await response.blob();
    const added = await api.uploadStyleRefs([new File([blob], `${item.title || "reference"}.png`, { type: blob.type })]);
    const fresh = added.images.filter((im) => !data.images.some((old) => old.file === im.file)).map((im) => im.file);
    await api.call("avatar_style_set", { selected: [...fresh, ...data.used].slice(0, data.max) });
    await reload(); notify(t("style_ref_added"));
  });
  const remove = (file) => run(file, async () => { await api.call("avatar_style_set", { remove: [file] }); await reload(); });
  const removeSprite = (name) => run(name, async () => { await api.call("avatar_style_set", { sprites: data.sprites.filter((n) => n !== name).join(",") }); await reload(); });
  const select = (ref) => run("select", async () => { await api.call("avatar_style_set", { selected: data.used.includes(ref) ? data.used.filter((r) => r !== ref) : [...data.used, ref] }); await reload(); });
  return <section className="space-y-2" aria-label={t("style_refs")}>
    <b>{t("style_refs")}</b>
    {error && <ErrorBox error={error} onRetry={reload} />}
    {data && <>
      <p className="help">{t("style_refs_help", { n: data.max })}</p>
      <div className="style-refs">
        {data.images.map((im) => <div key={im.file} className={`style-ref${data.used.includes(im.file) ? " is-used" : ""}`}>
          <a href={im.url} target="_blank" rel="noreferrer"><img src={im.url} alt={im.file} /></a>
          <input type="checkbox" checked={data.used.includes(im.file)} disabled={busy.select || !data.used.includes(im.file) && data.used.length >= data.max} onChange={() => select(im.file)} aria-label={`${t("style_ref_use")} ${im.file}`} />
          <button type="button" className="btn btn-sm" disabled={busy[im.file]} onClick={() => remove(im.file)} aria-label={`${t("remove")} ${im.file}`}><Icon d={ICONS.trash} size={13} /></button>
        </div>)}
        {data.sprites.map((name) => <div key={name} className={`style-ref${data.used.includes(name) ? " is-used" : ""}`}>
          <img src={sprites.trainer(`sd:${name}`)} alt={name} className="pixelated" />
          <input type="checkbox" checked={data.used.includes(name)} disabled={busy.select || !data.used.includes(name) && data.used.length >= data.max} onChange={() => select(name)} aria-label={`${t("style_ref_use")} ${name}`} />
          <button type="button" className="btn btn-sm" disabled={busy[name]} onClick={() => removeSprite(name)} aria-label={`${t("remove")} ${name}`}><Icon d={ICONS.trash} size={13} /></button>
        </div>)}
      </div>
      <input ref={input} type="file" accept="image/*" multiple className="field" aria-label={t("style_refs_add")} onChange={(e) => {
        const files = [...e.target.files];
        if (files.length) run("upload", async () => {
          const added = await api.uploadStyleRefs(files);
          const fresh = added.images.filter((im) => !data.images.some((old) => old.file === im.file)).map((im) => im.file);
          await api.call("avatar_style_set", { selected: [...fresh, ...data.used].slice(0, data.max) });
          input.current.value = ""; await reload();
        });
      }} disabled={busy.upload} />
      <div className="seg" role="group" aria-label={t("style_ref_source")}>
        {["mine", "sprites", "art"].map((s) => <button key={s} type="button" aria-pressed={source === s} onClick={() => setSource(s)}>{t(`avatar_tab_${s}`)}</button>)}
      </div>
      {source === "art" ? <OfficialArtGrid query={query} onOpen={(i, images) => add(images[i])} /> : <>
        <input className="field" value={search} onChange={(e) => setSearch(e.target.value)} aria-label={t("avatar_search")} placeholder={t("avatar_search")} />
        {loadError && <ErrorBox error={loadError} />}
        <div className="sprite-grid art-grid">
          {items.map((item, i) => <button key={item.file || item.sprite || i} type="button" className="sprite-pick" disabled={busy.add}
            onClick={() => add(item)} title={`${t("art_as_style")}: ${item.title}`}><img src={item.url} alt={item.title} loading="lazy" /><span className="trunc">{item.title}</span></button>)}
        </div>
      </>}
    </>}
  </section>;
}
