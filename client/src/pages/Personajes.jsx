// Characters: every leader, Elite Four member, champion, rival and boss of the nine generations with all the teams they used
// game by game, and their sprites (open one in Personaje.jsx). Below, the exact in-game teams of Crystal, FireRed/LeafGreen and
// Emerald with the whole leagues they make up.
import React, { useState } from "react";
import { api } from "../api.js";
import { useApp } from "../context.js";
import { Busy, ErrorBox, Section, Spinner, Tabs, useBusy, useLoad, useStored } from "../components/ui.jsx";
import { Avatar, GymBadge, TeamStrip } from "../components/silver.jsx";
import { TYPE_COLORS } from "../battle/dex.js";

export default function Personajes({ query }) {
  const { t } = useApp();
  const [tab, setTab] = useStored("silver-chars-tab", "all");
  const game = query?.get("game") || "";
  return (
    <div className="space-y-5">
      <div className="page-head">
        <div className="min-w-0"><h1>{t("nav_canon")}</h1><p className="help">{tab === "all" ? t("chars_help") : t("canon_help")}</p></div>
      </div>
      <Tabs tabs={[{ id: "all", label: t("chars_tab") }, { id: "exact", label: t("chars_exact_tab") }]} value={tab} onChange={setTab} />
      {tab === "all" ? (game ? <GameView game={game} category={query?.get("cat") || ""} /> : <AllCharacters />) : <ExactTeams />}
    </div>
  );
}

export const CATEGORY_KEYS = ["leaders", "elite", "champions", "trials", "rivals", "villains", "facilities", "tournaments", "others"];

function CharacterCard({ c, href }) {
  const { t, lang } = useApp();
  return (
    <a className="char-card" href={href}>
      <Avatar url={c.avatar_url} name={c.name} size={72} />
      <div className="min-w-0 flex-1 space-y-1">
        <b className="trunc block">{lang === "en" ? c.name : c.name_es}</b>
        <div className="help">{t("chars_teams_n", { n: c.teams })} · {t("chars_sprites_n", { n: c.sprites })}{c.installed ? ` · ${t("chars_made_n", { n: c.installed })}` : ""}</div>
        <TeamStrip species={c.species} size={26} />
        <div className="char-gens">{c.gens.map((g) => <span key={g} className="chip">{t("chars_gen_n", { n: g })}</span>)}</div>
      </div>
    </a>
  );
}

function GameCard({ g }) {
  const { t, lang } = useApp();
  return (
    <a className={`game-card gen-${g.gen}`} href={`#/personajes?game=${g.id}`}>
      <div className="game-card-faces" aria-hidden="true">{g.faces.map((f, i) => <img key={i} src={f} alt="" className="pixelated" loading="lazy" />)}</div>
      <div className="min-w-0 space-y-1">
        <b className="block">{lang === "en" ? g.name : g.name_es}</b>
        <div className="help">{t("chars_gen_n", { n: g.gen })} · {t("game_chars_n", { n: g.characters })} · {t("chars_teams_n", { n: g.teams })}</div>
        <div className="char-gens">{CATEGORY_KEYS.filter((k) => g.categories[k]).map((k) => <span key={k} className="chip">{t(`cat_${k}`)} {g.categories[k]}</span>)}</div>
      </div>
    </a>
  );
}

function AllCharacters() {
  const { t, lang } = useApp();
  const [q, setQ] = useState("");
  const [view, setView] = useStored("silver-chars-view", "games");
  const [gen, setGen] = useStored("silver-chars-gen", 0);
  const [game, setGame] = useStored("silver-chars-game", "");
  const [cat, setCat] = useStored("silver-chars-cat", "");
  const byList = view === "list" || q.trim();
  const { data, error, loading, reload } = useLoad(() => api.call("characters_list", byList ? { query: q, gen: Number(gen) || 0, game, category: cat } : {}),
    [q, gen, game, cat, byList]);
  const list = data?.characters || [];
  const games = data?.games || [];
  const gens = [...new Set(games.map((g) => g.gen))];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input className="field max-w-xs" placeholder={t("search_canon")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("search_canon")} />
        <div className="seg" role="group" aria-label={t("chars_view")}>
          <button type="button" aria-pressed={!byList} onClick={() => { setView("games"); setQ(""); }}>{t("chars_by_game")}</button>
          <button type="button" aria-pressed={!!byList} onClick={() => setView("list")}>{t("chars_by_character")}</button>
        </div>
      </div>
      {byList && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="seg" role="group" aria-label={t("chars_gen")}>
            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((g) => <button key={g} type="button" aria-pressed={Number(gen) === g} onClick={() => setGen(g)}>{g ? g : t("all")}</button>)}
          </div>
          <select className="field max-w-[15rem]" value={game} onChange={(e) => setGame(e.target.value)} aria-label={t("chars_game")}>
            <option value="">{t("chars_all_games")}</option>
            {games.map((g) => <option key={g.id} value={g.id}>{lang === "en" ? g.name : g.name_es}</option>)}
          </select>
          <select className="field max-w-[13rem]" value={cat} onChange={(e) => setCat(e.target.value)} aria-label={t("chars_category")}>
            <option value="">{t("chars_all_categories")}</option>
            {CATEGORY_KEYS.map((k) => <option key={k} value={k}>{t(`cat_${k}`)}</option>)}
          </select>
          {data && <span className="help">{list.length} / {data.total}</span>}
        </div>
      )}
      {error && <ErrorBox error={error} onRetry={reload} />}
      {loading && !data ? <Spinner /> : byList ? (!list.length ? <p className="help">{t("chars_none")}</p> : (
        <div className="char-grid">
          {list.map((c) => <CharacterCard key={c.key} c={c} href={`#/personaje/${c.key}${game ? `?game=${game}` : gen ? `?gen=${gen}` : ""}`} />)}
        </div>
      )) : gens.map((n) => (
        <Section key={n} title={t(`gen_title_${n}`)}>
          <div className="game-grid">{games.filter((g) => g.gen === n).map((g) => <GameCard key={g.id} g={g} />)}</div>
        </Section>
      ))}
      <p className="help">{data?.source}</p>
    </div>
  );
}

function GameView({ game, category }) {
  const { t, lang, go } = useApp();
  const { data, error, loading, reload } = useLoad(() => api.call("characters_list", { game }), [game]);
  const card = data?.games.find((g) => g.id === game);
  const list = data?.characters || [];
  const sections = CATEGORY_KEYS.filter((k) => (!category || category === k) && list.some((c) => c.categories.includes(k)));
  return (
    <div className="space-y-4">
      <a className="btn-link" href="#/personajes">← {t("chars_all_games")}</a>
      {error && <ErrorBox error={error} onRetry={reload} />}
      {loading && !data ? <Spinner /> : !card ? <p className="help">{t("chars_none")}</p> : (
        <>
          <div className="flex flex-wrap items-baseline gap-2">
            <h2 className="text-[20px]">{lang === "en" ? card.name : card.name_es}</h2>
            <span className="help">{t("chars_gen_n", { n: card.gen })} · {t("game_chars_n", { n: card.characters })} · {t("chars_teams_n", { n: card.teams })}</span>
          </div>
          <div className="seg" role="group" aria-label={t("chars_category")}>
            <button type="button" aria-pressed={!category} onClick={() => go(`#/personajes?game=${game}`)}>{t("all")}</button>
            {CATEGORY_KEYS.filter((k) => card.categories[k]).map((k) => (
              <button key={k} type="button" aria-pressed={category === k} onClick={() => go(`#/personajes?game=${game}&cat=${k}`)}>{t(`cat_${k}`)} {card.categories[k]}</button>
            ))}
          </div>
          {sections.map((k) => (
            <Section key={k} title={t(`cat_${k}`)} count={list.filter((c) => c.categories.includes(k)).length}>
              <div className="char-grid">
                {list.filter((c) => c.categories.includes(k)).map((c) => <CharacterCard key={c.key} c={c} href={`#/personaje/${c.key}?game=${game}`} />)}
              </div>
            </Section>
          ))}
        </>
      )}
    </div>
  );
}

function ExactTeams() {
  const { t, lang, notify, changed, go } = useApp();
  const [q, setQ] = useState("");
  const [region, setRegion] = useStored("silver-canon-region", "");
  const { data, error, loading, reload } = useLoad(() => api.call("canon_list", { query: q, region }), [q, region]);
  const [busy, run] = useBusy();
  const installTrainer = (key) => run(key, async () => { const r = await api.call("canon_install", { trainer_key: key }); notify(t("installed")); changed(); reload(); return r; });
  const installLeague = (key) => run(key, async () => { const r = await api.call("canon_install", { league_key: key }); notify(t("league_installed")); changed(); go(`#/liga/${r.league.id}`); });
  const groups = {};
  for (const tr of data?.trainers || []) (groups[`${tr.game} · ${tr.region}`] ||= []).push(tr);
  return (
    <div className="space-y-5">
      <Section title={t("leagues_ready")}>
        <div className="league-list">
          {(data?.leagues || []).map((lg) => (
            <div key={lg.key} className="league-card">
              <div className="min-w-0 flex-1 space-y-2">
                <div><b className="text-[16px]">{lang === "en" ? lg.name : lg.name_es}</b><div className="help">{lg.game} · {lg.region}</div></div>
                <div className="flex flex-wrap gap-1">{lg.gyms.map((g) => <GymBadge key={g.leader} color={TYPE_COLORS[g.type] || "#c0c0c0"} size={26} label={lang === "en" ? g.badge : g.badge_es} />)}</div>
              </div>
              {lg.installed_id ? <a className="btn" href={`#/liga/${lg.installed_id}`}>{t("open")}</a>
                : <Busy busy={busy[lg.key]} className="btn btn-primary" onClick={() => installLeague(lg.key)}>{t("install_league")}</Busy>}
            </div>
          ))}
        </div>
      </Section>
      <div className="flex flex-wrap items-center gap-2">
        <input className="field max-w-xs" placeholder={t("search_canon")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("search_canon")} />
        <div className="seg" role="group">{["", "Kanto", "Johto", "Hoenn", "Sinnoh", "Unova", "Kalos", "Alola", "Galar", "Paldea"].map((r) => <button key={r} type="button" aria-pressed={region === r} onClick={() => setRegion(r)}>{r || t("all")}</button>)}</div>
      </div>
      {error && <ErrorBox error={error} onRetry={reload} />}
      {loading && !data ? <Spinner /> : Object.entries(groups).map(([g, list]) => (
        <Section key={g} title={g} count={list.length}>
          <div className="trainer-grid">
            {list.map((tr) => (
              <div key={tr.key} className="trainer-card">
                <Avatar url={tr.avatar_url} name={tr.name} size={72} />
                <div className="min-w-0 flex-1 space-y-1">
                  <b className="trunc block">{lang === "en" ? tr.name : tr.name_es}{tr.variant ? <span className="help"> · {lang === "en" ? tr.variant : tr.variant_es || tr.variant}</span> : null}</b>
                  <div className="help">{lang === "en" ? tr.class : tr.class_es} · {t("lv")} {Math.max(...tr.levels)}{tr.double ? ` · ${t("doubles")}` : ""}</div>
                  <TeamStrip species={tr.species} size={28} />
                  {tr.installed_id ? <a className="btn btn-sm" href={`#/entrenador/${tr.installed_id}`}>{t("open")}</a>
                    : <Busy busy={busy[tr.key]} className="btn btn-sm" onClick={() => installTrainer(tr.key)}>{t("add_trainer")}</Busy>}
                </div>
              </div>
            ))}
          </div>
        </Section>
      ))}
      <p className="help">{data?.source}</p>
    </div>
  );
}
