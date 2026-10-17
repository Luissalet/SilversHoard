import React, { useEffect, useRef, useState } from "react";
import { makeT } from "../i18n.js";
import { BadgeArt } from "./badges.jsx";
import "./poster.css";

// Used by the native PNG job, with one detached data snapshot and the existing badge artwork.
export default function PosterArt({ data }) {
  const t = makeT(data.lang);
  const root = useRef(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let off = false;
    (async () => {
      await document.fonts.ready;
      await Promise.all([...root.current.querySelectorAll("img")].map((img) => img.decode().catch(() => {})));
      requestAnimationFrame(() => { if (!off) setReady(true); });
    })();
    return () => { off = true; };
  }, [data]);
  const category = (source) => {
    if (source.category === "pokemon_sprite") return t("kind1_sprite");
    if (source.category === "shape") return t("poster_shape");
    if (source.category === "style_reference") return t("poster_style_reference");
    return t(`kind1_${source.category}`);
  };
  return <article ref={root} className="trainer-poster-art" data-poster-ready={ready ? "true" : "false"} style={{ "--poster-accent": data.accent }}>
    <header className="poster-topline"><span>Silver’s Hoard</span><span>{data.trainer.format}</span></header>
    <div className="poster-hero">
      <div className="poster-heading">
        <p className="poster-eyebrow">{t("poster_trainer")}</p>
        <h1>{data.trainer.name}</h1>
        {data.trainer.title && <p className="poster-subtitle">{data.trainer.title}</p>}
        <span className="poster-count">{t("poster_team_count", { n: data.team.length })} · {t("poster_badge_count", { n: data.badges.length })}</span>
      </div>
      <div className="poster-portrait">
        <div className="poster-halo" aria-hidden="true" />
        {data.portrait.src ? <img src={data.portrait.src} className={data.portrait.category === "sprite" ? "pixelated" : ""} alt={data.trainer.name} /> :
          <div className="poster-monogram">{Array.from(data.trainer.name).slice(0, 2).join("")}</div>}
      </div>
    </div>
    <section className="poster-team">
      <h2>{t("poster_team")}</h2>
      {data.team.length === 0 ? <p>{t("poster_no_team")}</p> : <ol className="poster-team-strip">
        {data.team.map((mon, i) => <li key={i}>
          <span className="poster-slot">{String(i + 1).padStart(2, "0")}</span>
          <div className="poster-mon-picture">{mon.src ? <img src={mon.src} alt={mon.species} className="pixelated" /> : <span>?</span>}</div>
          <b>{mon.name}{mon.shiny && <span className="poster-shiny"> ★</span>}</b>
          {mon.name !== mon.species && <span className="poster-species">{mon.species}</span>}
          <span className="poster-level">{t("lv")} {mon.level}</span>
        </li>)}
      </ol>}
    </section>
    <section className="poster-medals">
      <h2>{t("poster_badges")}</h2>
      {data.badges.length === 0 ? <p>{t("poster_no_badges")}</p> : <ol className="poster-badge-strip">
        {data.badges.map((badge, i) => <li key={i}>
          <BadgeArt image={badge.image} color={badge.color} size={78} label={badge.name} />
          <b>{badge.name}</b><span>{badge.gym}</span>
        </li>)}
      </ol>}
    </section>
    <footer className="poster-provenance">
      <h2>{t("poster_credits")}</h2>
      <div className="poster-source-grid">{data.sources.map((source, i) => <div key={i}>
        <b>{t(`poster_role_${source.role}`)} · {category(source)}</b>
        <span>{source.title}</span>
        <span>{source.credit || t("poster_artist_unknown")}</span>
        {source.copyright && <span>{source.copyright}</span>}
        <span className="poster-source-url">{source.source}</span>
      </div>)}</div>
      {data.warnings.length > 0 && <p className="poster-warning">{t("poster_missing", { n: data.warnings.length })}</p>}
    </footer>
  </article>;
}
