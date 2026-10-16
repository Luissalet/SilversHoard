// One character: choose its look (every Showdown sprite it has, game by game) and one of the teams it used in each game and
// battle (first battle, rematches, tournaments…), then make a trainer from them, or start an own team for the character.
import React, { useMemo, useState } from "react";
import { api } from "../api.js";
import { useApp } from "../context.js";
import { Busy, ErrorBox, Section, Spinner, useBusy, useLoad } from "../components/ui.jsx";
import { Avatar, MonIcon, OfficialArtGrid, RecordChip, fetchPicture } from "../components/silver.jsx";
import { ImageViewer } from "../components/viewer.jsx";
import { L, nameOf } from "../battle/dex.js";

// Teams read from the HeartGold/SoulSilver cartridge (pret/pokeheartgold): the mark, and the nature and IVs the game gives each Pokémon
const CART = {
  chip: ["datos del cartucho", "cartridge data"],
  help: ["Equipo exacto leído del cartucho (pret/pokeheartgold): naturaleza, IV, habilidad, objeto y movimientos del juego. IA según sus flags: nivel {level}, estilo {style} (entrenador n.º {rom}).",
    "Exact team read from the cartridge (pret/pokeheartgold): the game's nature, IVs, ability, item and moves. AI from its flags: level {level}, style {style} (trainer no. {rom})."],
};
const ivText = (ivs) => {
  const v = Object.values(ivs || {});
  if (!v.length) return "";
  return v.every((x) => x === v[0]) ? `IV ${v[0]}` : Object.entries(ivs).map(([k, x]) => `${k} ${x}`).join("/");
};

function VariantRow({ v, on, onPick, lang, t }) {
  const labels = lang === "en" ? v.labels : v.labels_es;
  const alt = lang === "en" ? v.labels_alt : v.labels_alt_es;
  const title = [...labels, v.with ? `${lang === "en" ? "with" : "con"} ${v.with}` : ""].filter(Boolean).join(" · ") || (lang === "en" ? v.game_name : v.game_name_es);
  return (
    <button type="button" className={`char-variant ${on ? "is-on" : ""}`} aria-pressed={on} onClick={onPick}>
      <Avatar url={v.sprite_url} name={title} size={44} />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <b>{title}</b>
          {v.trainer_class && <span className="help">{lang === "en" ? v.trainer_class : v.trainer_class_es}</span>}
          {v.location && <span className="help">· {v.location}</span>}
          {v.category && <span className="chip chip-cat">{t(`cat_${v.category}`)}</span>}
          {v.cartridge && (
            <span className="chip chip-ok" title={L(CART.help, lang).replace("{level}", t(`lvl_${v.ai?.level}`)).replace("{style}", t(`style_${v.ai?.style}`)).replace("{rom}", v.rom ?? "")}>
              {L(CART.chip, lang)}
            </span>
          )}
          {v.pool > 0 && <span className="chip" title={t("char_pool_help")}>{t("char_pool", { n: v.pool })}</span>}
          {on && <span className="chip">{t("char_selected")}</span>}
        </div>
        <div className="char-mons">
          {v.sets.map((s, i) => (
            <span key={i} className="char-mon" title={[s.species, nameOf("ability", s.ability, lang), nameOf("item", s.item, lang), s.nature ? nameOf("nature", s.nature, lang) : "",
              ivText(s.ivs), ...(s.moves || []).map((m) => nameOf("move", m, lang))].filter(Boolean).join(" · ")}>
              <MonIcon species={s.species} size={30} />
              <b>{s.species}</b>&nbsp;{t("char_level", { n: s.level })}{s.item ? ` · ${nameOf("item", s.item, lang)}` : ""}
              {s.nature ? ` · ${nameOf("nature", s.nature, lang)}` : ""}{s.ivs ? ` · ${ivText(s.ivs)}` : ""}
            </span>
          ))}
        </div>
        {v.sets.some((s) => s.level_range) && <div className="help">{t("char_level_range", { a: v.sets.find((s) => s.level_range).level_range[0], b: v.sets.find((s) => s.level_range).level_range[1], n: v.sets[0].level })}</div>}
        {alt?.length > 0 && <div className="help">{t("char_also", { list: alt.join(" / ") })}</div>}
        {v.note && <div className="help" title={t("char_note_en")}>{v.note}</div>}
      </div>
    </button>
  );
}

export default function Personaje({ param, query }) {
  const { t, lang, notify, changed, go } = useApp();
  const { data: c, error, reload } = useLoad(() => api.call("character_get", { key: param }), [param]);
  const [variantId, setVariantId] = useState("");
  const [sprite, setSprite] = useState("");
  const [art, setArt] = useState(null);          // an official artwork chosen instead of a sprite
  const [arts, setArts] = useState([]);
  const [viewer, setViewer] = useState(null);
  const [gen, setGen] = useState(Number(query?.get("gen")) || 0);
  const [game, setGame] = useState(query?.get("game") || "");
  const fits = (v) => (!gen || v.gen === gen) && (!game || v.games.includes(game));
  const [busy, run] = useBusy();

  const variant = useMemo(() => {
    if (!c) return null;
    return c.variants.find((v) => v.id === variantId) || [...c.variants].reverse().find((v) => !v.side && fits(v)) || [...c.variants].reverse().find(fits) || c.variants[c.variants.length - 1];
  }, [c, variantId, gen, game]); // eslint-disable-line react-hooks/exhaustive-deps
  const spriteId = sprite || variant?.sprite || c?.base_sprite || "";
  const spriteUrl = art ? art.url : c?.sprites.find((s) => s.id === spriteId)?.url || c?.avatar_url;

  const groups = useMemo(() => {
    const out = [];
    for (const v of c?.variants || []) {
      if (!fits(v)) continue;
      const key = `${v.side ? "z" : "a"}${v.game}`;
      let g = out.find((x) => x.key === key);
      if (!g) out.push((g = { key, game: lang === "en" ? v.game_name : v.game_name_es, gen: v.gen, side: v.side, list: [] }));
      g.list.push(v);
    }
    return out;
  }, [c, gen, game, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!c) return <Spinner />;
  const name = lang === "en" ? c.name : c.name_es;
  const gens = [...new Set(c.variants.map((v) => v.gen))].sort((a, b) => a - b);

  const install = (custom, empty = false) => run(custom ? (empty ? "e" : "c") : "a", async () => {
    let avatar = "";
    if (art) {
      // the wiki's image server answers the page, not the app's server: the page fetches the artwork and hands it over
      const blob = await fetchPicture(art.url);
      avatar = (await api.uploadAvatar(blob, { mode: "upload", kind: "art", credit: art.credit, source: art.url, title: art.file })).avatar;
    }
    const r = await api.call("character_install", { key: c.key, variant: empty ? "" : variant?.id || "", sprite: art ? "" : spriteId, custom, lang,
      ...(avatar ? { avatar, art: art.file } : {}) });
    changed();
    notify(r.trainer.existing ? t("char_exists") : t("char_created"));
    go(`#/entrenador/${r.trainer.id}${custom ? "?builder=1" : ""}`);
  });

  const looks = [
    ...c.sprites.map((x) => ({ url: x.url, title: lang === "en" ? x.label : x.label_es, sub: x.id, credit: x.artist ? t("sprite_by", { name: x.artist }) : "", sprite: x.id })),
    ...arts.map((x) => ({ ...x, art: x })),
  ];
  const lookIndex = Math.max(0, looks.findIndex((x) => (art ? x.art?.file === art.file : x.sprite === spriteId)));
  const pickLook = (x) => { if (x.art) { setArt(x.art); } else { setArt(null); setSprite(x.sprite); } };
  return (
    <div className="space-y-5">
      <a className="btn-link" href={query?.get("game") ? `#/personajes?game=${query.get("game")}` : "#/personajes"}>← {query?.get("game") ? t("char_back_game") : t("char_back")}</a>
      <div className="char-head">
        <button type="button" className="avatar-button" onClick={() => setViewer({ index: lookIndex })} title={t("avatar_view")} aria-label={t("avatar_view")}>
          <Avatar url={spriteUrl} name={name} size={112} />
        </button>
        <div className="min-w-0 space-y-1">
          <h1>{name}{lang !== "en" && c.name !== c.name_es ? <span className="help"> · {c.name}</span> : null}</h1>
          <div className="help">{t("chars_teams_n", { n: c.variants.length })} · {t("chars_sprites_n", { n: c.sprites.length })}</div>
          {art && <div className="help">{t("char_art_chosen", { label: art.title })}</div>}
          {!art && c.sprites.find((x) => x.id === spriteId)?.artist && (
            <div className="help"><a className="btn-link" href="#/creditos">{t("sprite_by", { name: c.sprites.find((x) => x.id === spriteId).artist })}</a></div>
          )}
          {c.bulbapedia && <a className="btn-link" href={c.bulbapedia} target="_blank" rel="noreferrer">Bulbapedia ↗</a>}
        </div>
      </div>

      <Section title={t("char_look")} count={c.sprites.length} sub={t("char_look_help")}>
        <div className="char-sprites" role="radiogroup" aria-label={t("char_look")}>
          {c.sprites.map((s) => (
            <button key={s.id} type="button" role="radio" aria-checked={!art && s.id === spriteId} className={`sprite-pick ${!art && s.id === spriteId ? "is-on" : ""}`}
              onClick={() => { if (!art && s.id === spriteId) setViewer({ index: looks.findIndex((x) => x.sprite === s.id) }); setArt(null); setSprite(s.id); }}
              onDoubleClick={() => setViewer({ index: looks.findIndex((x) => x.sprite === s.id) })}
              title={`${s.artist ? `${s.id} · ${t("sprite_by", { name: s.artist })}` : s.id} · ${t("char_click_again")}`}>
              <img src={s.url} alt="" loading="lazy" className="pixelated" />
              <span>{lang === "en" ? s.label : s.label_es}</span>
            </button>
          ))}
        </div>
      </Section>

      <Section title={t("char_art")} count={arts.length || undefined} sub={t("char_art_help")}>
        <OfficialArtGrid query={c.name} selected={art?.file || ""} onLoaded={(r) => setArts((r.images || []).map((im) => ({ ...im, url: im.full, thumb: im.thumb,
          title: lang === "en" ? im.label : im.label_es, sub: im.page, credit: "Pokémon Wiki (Fandom) · © Nintendo, Creatures, GAME FREAK", href: im.page_url })))}
          onOpen={(i, items) => { const it = items[i]; if (art?.file === it.file) setViewer({ index: c.sprites.length + i }); setArt(it); }} />
      </Section>

      <Section title={t("char_teams")} count={c.variants.length} sub={t("char_teams_help")}
        actions={<>
          {c.games.length > 1 && (
            <select className="field max-w-[16rem]" value={game} onChange={(e) => { setGame(e.target.value); setVariantId(""); }} aria-label={t("chars_game")}>
              <option value="">{t("chars_all_games")}</option>
              {c.games.map((g) => <option key={g.id} value={g.id}>{lang === "en" ? g.name : g.name_es}</option>)}
            </select>
          )}
          {gens.length > 1 && (
            <div className="seg" role="group" aria-label={t("chars_gen")}>
              {[0, ...gens].map((g) => <button key={g} type="button" aria-pressed={gen === g} onClick={() => { setGen(g); setVariantId(""); }}>{g ? t("chars_gen_n", { n: g }) : t("all")}</button>)}
            </div>
          )}
        </>}>
        <div className="space-y-4">
          {groups.map((g) => (
            <div key={g.key} className="char-game">
              <h3>{g.game} <span className="help">· {t("chars_gen_n", { n: g.gen })}{g.side ? ` · ${t("char_side")}` : ""}</span></h3>
              {g.list.map((v) => <VariantRow key={v.id} v={v} on={v.id === variant?.id} onPick={() => { setVariantId(v.id); setSprite(""); }} lang={lang} t={t} />)}
            </div>
          ))}
        </div>
      </Section>

      {c.installed.length > 0 && (
        <Section title={t("char_made")} count={c.installed.length}>
          <div className="trainer-grid">
            {c.installed.map((tr) => (
              <a key={tr.id} className="trainer-card" href={`#/entrenador/${tr.id}`}>
                <Avatar url={tr.avatar_url} name={tr.name} size={56} />
                <div className="min-w-0 flex-1 space-y-1"><b className="trunc block">{tr.name}</b><div className="help trunc">{tr.title}</div><RecordChip record={tr.record} /></div>
              </a>
            ))}
          </div>
        </Section>
      )}

      <p className="help">{t("char_source")}: {c.source}</p>

      <div className="char-actions">
        <Avatar url={spriteUrl} name={name} size={40} />
        <div className="min-w-0 flex-1"><b>{name}</b><div className="help trunc">{variant ? (lang === "en" ? variant.label : variant.label_es) : ""}</div></div>
        <Busy busy={busy.a} className="btn btn-primary" onClick={() => install(false)} title={t("char_add_help")}>{t("char_add")}</Busy>
        <Busy busy={busy.c} className="btn" onClick={() => install(true)} title={t("char_custom_help")}>{t("char_custom")}</Busy>
        <Busy busy={busy.e} className="btn btn-ghost" onClick={() => install(true, true)}>{t("char_custom_empty")}</Busy>
      </div>
      {viewer && (
        <ImageViewer items={looks} index={viewer.index} onClose={() => setViewer(null)}
          actions={(item) => <button type="button" className="btn btn-primary" onClick={() => { pickLook(item); setViewer(null); }}>{t("char_pick_look")}</button>} />
      )}
    </div>
  );
}
