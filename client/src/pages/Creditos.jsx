// Credits: where everything the app shows or plays comes from and under which licence, the artists of Showdown's trainer sprites
// (Showdown asks for credit to the artist when one is used elsewhere) and of the real-time arena's walking sprites (SpriteCollab),
// with a lookup for one sprite or one Pokémon. The two artist lists are downloaded once and kept (credits tool).
import React, { useState } from "react";
import { api } from "../api.js";
import { useApp } from "../context.js";
import { Busy, ErrorBox, Section, Spinner, useBusy, useLoad } from "../components/ui.jsx";
import { L } from "../battle/dex.js";

const S = {
  title: ["Créditos", "Credits"],
  intro: ["De dónde sale todo lo que la app enseña o hace sonar, con su licencia, y quién dibujó cada sprite. Silver's Hoard es un proyecto de aficionados sin relación con Nintendo, Game Freak, Creatures ni The Pokémon Company.",
    "Where everything the app shows or plays comes from, with its licence, and who drew each sprite. Silver's Hoard is a fan project, not affiliated with Nintendo, Game Freak, Creatures or The Pokémon Company."],
  sources: ["Fuentes", "Sources"],
  what: ["Qué", "What"],
  by: ["De", "By"],
  licence: ["Licencia", "Licence"],
  trainers: ["Sprites de entrenador", "Trainer sprites"],
  trainers_help: ["Muchos no son de los juegos: Showdown pide dar crédito a su artista. {n} sprites con autor.", "Many are not from the games: Showdown asks to credit their artist. {n} sprites with an author."],
  walking: ["Sprites de la arena en tiempo real (SpriteCollab)", "Real-time arena sprites (SpriteCollab)"],
  walking_help: ["CC BY-NC 4.0. {n} sprites de Pokémon y formas con autor.", "CC BY-NC 4.0. {n} Pokémon and form sprites with an author."],
  faces: ["Retratos con emoción (SpriteCollab)", "Portraits with emotions (SpriteCollab)"],
  faces_help: ["CC BY-NC 4.0. Las caras que acompañan a las frases, los K.O., las megaevoluciones y el resultado: {n} Pokémon y formas con autor.",
    "CC BY-NC 4.0. The faces next to trainers' lines, K.O.s, Mega Evolutions and results: {n} Pokémon and forms with an author."],
  sprites_n: ["{n} sprites", "{n} sprites"],
  more: ["Ver todos ({n})", "Show all ({n})"],
  less: ["Ver menos", "Show fewer"],
  lookup: ["Buscar autor", "Look up an author"],
  lookup_sprite: ["Sprite de entrenador (p. ej. acerola)", "Trainer sprite (e.g. acerola)"],
  lookup_species: ["Pokémon (p. ej. Rotom-Wash)", "Pokémon (e.g. Rotom-Wash)"],
  find: ["Buscar", "Find"],
  sprite_by: ["{name}: de {artist}", "{name}: by {artist}"],
  sprite_game: ["{name}: arte de los juegos (sin autor en Showdown)", "{name}: the games' own art (no author on Showdown)"],
  species_by: ["{name} (#{num}): {list}", "{name} (#{num}): {list}"],
  species_none: ["{name}: sin sprite de SpriteCollab con autor", "{name}: no SpriteCollab sprite with an author"],
  offline: ["Las listas de autores aún no se han descargado (o no hay conexión).", "The author lists are not downloaded yet (or there is no connection)."],
};

function Artists({ list, lang, s }) {
  const [all, setAll] = useState(false);
  const shown = all ? list : list.slice(0, 40);
  return (
    <div className="space-y-2">
      <div className="credit-artists">
        {shown.map((a) => <span key={a.artist} className="chip" title={s("sprites_n", { n: a.sprites })}>{a.artist} <span className="help num">{a.sprites}</span></span>)}
      </div>
      {list.length > 40 && <button type="button" className="btn btn-sm" onClick={() => setAll(!all)}>{all ? s("less") : s("more", { n: list.length })}</button>}
    </div>
  );
}

export default function Creditos() {
  const { lang, toastError } = useApp();
  const s = (k, v = {}) => L(S[k], lang).replace(/\{(\w+)\}/g, (_, x) => (v[x] ?? ""));
  const { data, error, reload } = useLoad(() => api.call("credits", {}), []);
  const [sprite, setSprite] = useState("");
  const [species, setSpecies] = useState("");
  const [found, setFound] = useState([]);
  const [busy, run] = useBusy();
  const look = (args) => run("look", async () => {
    try {
      const r = await api.call("credits", args);
      let line;
      if (r.sprite !== undefined) line = r.artist ? s("sprite_by", { name: r.sprite, artist: r.artist }) : s("sprite_game", { name: r.sprite });
      else line = r.artists?.length ? s("species_by", { name: r.species, num: r.num, list: r.artists.join(", ") }) : s("species_none", { name: r.species });
      setFound((x) => [line, ...x].slice(0, 6));
    } catch (e) { toastError(e); }
  });
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Spinner />;
  const tr = data.trainer_sprites;
  const wk = data.walking_sprites;
  const pf = data.portraits || { folders: 0, artists: [] };
  return (
    <div className="space-y-5">
      <div>
        <h1>{s("title")}</h1>
        <p className="help">{s("intro")}</p>
      </div>
      <Section title={s("sources")} count={data.sources.length}>
        <div className="panel overflow-x-auto">
          <table className="tbl credit-sources">
            <thead><tr><th>{s("what")}</th><th>{s("by")}</th><th>{s("licence")}</th></tr></thead>
            <tbody>
              {data.sources.map((x) => (
                <tr key={x.id}>
                  <td>{lang === "en" ? x.what : x.what_es}</td>
                  <td>{x.url ? <a className="btn-link" href={x.url} target="_blank" rel="noreferrer">{lang === "en" ? x.by : x.by_es || x.by}</a> : lang === "en" ? x.by : x.by_es || x.by}</td>
                  <td className="help">{lang === "en" ? x.licence : x.licence_es || x.licence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      <Section title={s("lookup")}>
        <div className="panel space-y-2">
          <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (sprite.trim()) look({ sprite: sprite.trim() }); }}>
            <input className="field flex-1" value={sprite} onChange={(e) => setSprite(e.target.value)} placeholder={s("lookup_sprite")} aria-label={s("lookup_sprite")} />
            <Busy busy={busy.look} className="btn" type="submit">{s("find")}</Busy>
          </form>
          <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (species.trim()) look({ species: species.trim() }); }}>
            <input className="field flex-1" value={species} onChange={(e) => setSpecies(e.target.value)} placeholder={s("lookup_species")} aria-label={s("lookup_species")} />
            <Busy busy={busy.look} className="btn" type="submit">{s("find")}</Busy>
          </form>
          {found.map((l, i) => <p key={i} className={i ? "help" : ""}>{l}</p>)}
        </div>
      </Section>
      <Section title={s("trainers")} count={tr.artists.length}>
        <div className="panel space-y-2">
          <p className="help">{s("trainers_help", { n: tr.credited })}</p>
          {tr.artists.length ? <Artists list={tr.artists} lang={lang} s={s} /> : <p className="help">{s("offline")}</p>}
        </div>
      </Section>
      <Section title={s("walking")} count={wk.artists.length}>
        <div className="panel space-y-2">
          <p className="help">{s("walking_help", { n: wk.folders })}</p>
          {wk.artists.length ? <Artists list={wk.artists} lang={lang} s={s} /> : <p className="help">{s("offline")}</p>}
        </div>
      </Section>
      <Section title={s("faces")} count={pf.artists.length}>
        <div className="panel space-y-2">
          <p className="help">{s("faces_help", { n: pf.folders })}</p>
          {pf.artists.length ? <Artists list={pf.artists} lang={lang} s={s} /> : <p className="help">{s("offline")}</p>}
        </div>
      </Section>
    </div>
  );
}
