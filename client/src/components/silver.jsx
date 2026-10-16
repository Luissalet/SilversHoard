// The app's own building blocks: avatars, team strips and cards, pickers for trainers, formats and AI, the export and avatar
// dialogs, badges and job progress.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import { useApp } from "../context.js";
import { TYPE_COLORS, nameOf, spriteId, typeName } from "../battle/dex.js";
import { Bar, Busy, CopyButton, Field, Icon, ICONS, Modal, Spinner, Tabs, useBusy } from "./ui.jsx";
import { ImageViewer } from "./viewer.jsx";
import { usePoll } from "./hooks.js";
import { BadgeArt } from "./badges.jsx";
import { loc } from "../loc.js";

export const AI_LEVELS = ["random", "easy", "normal", "hard", "expert", "master", "neural"];
export const AI_STYLES = ["balanced", "aggressive", "defensive", "setup", "stall"];

export function Avatar({ url, name = "", size = 48, pixelated = true, className = "" }) {
  const [bad, setBad] = useState(false);
  useEffect(() => setBad(false), [url]);
  if (!url || bad) {
    return <span className={`avatar-fallback ${className}`} style={{ width: size, height: size, fontSize: size * 0.38 }} aria-hidden="true">{(name || "?").slice(0, 1).toUpperCase()}</span>;
  }
  return <img src={url} alt="" width={size} height={size} className={`avatar ${pixelated ? "pixelated" : ""} ${className}`} onError={() => setBad(true)} draggable={false} loading="lazy" />;
}

export function MonIcon({ species, spriteid, size = 40, title }) {
  const { sprites } = useApp();
  const [stage, setStage] = useState(0);
  const id = spriteid || spriteId(species);
  useEffect(() => setStage(0), [id]);
  if (!species && !spriteid) return null;
  const src = stage === 0 ? sprites.pokemon(species, { spriteid: id }) : sprites.fallback(species, { spriteid: id });
  if (stage > 1) return <span className="mon-missing" style={{ width: size, height: size }} title={title || species}>{String(species).slice(0, 2)}</span>;
  return <img src={src} alt={title || species} title={title || species} width={size} height={size} className={`mon-icon ${sprites.pixelated ? "pixelated" : ""}`}
    onError={() => setStage((s) => s + 1)} draggable={false} loading="lazy" />;
}

export function TeamStrip({ species = [], size = 36, max = 6 }) {
  return (
    <div className="team-strip">
      {species.slice(0, max).map((s, i) => <MonIcon key={`${s}-${i}`} species={s} size={size} />)}
      {species.length > max && <span className="help">+{species.length - max}</span>}
    </div>
  );
}

export function TypeChip({ type }) {
  const { lang } = useApp();
  if (!type) return null;
  return <span className="b-type" style={{ background: TYPE_COLORS[type] || "#777" }}>{typeName(type, lang)}</span>;
}

const STAT_SHORT = { hp: ["PS", "HP"], atk: ["Atq", "Atk"], def: ["Def", "Def"], spa: ["AtE", "SpA"], spd: ["DfE", "SpD"], spe: ["Vel", "Spe"] };
const statShort = (k, lang) => (STAT_SHORT[k] || [k, k])[lang === "en" ? 1 : 0];

export function TeamCards({ summary = [] }) {
  const { lang, t } = useApp();
  return (
    <div className="team-cards">
      {summary.map((m, i) => (
        <div key={i} className={`team-card ${m.exists ? "" : "is-unknown"}`}>
          <MonIcon species={m.species} spriteid={m.sprite_id} size={72} />
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-baseline gap-1.5">
              <b className="trunc">{m.nickname || m.species}</b>
              {m.nickname && <span className="help">{m.species}</span>}
              <span className="help">{t("lv")} {m.level}</span>
            </div>
            <div className="flex flex-wrap gap-1">{(m.types || []).map((ty) => <TypeChip key={ty} type={ty} />)}{m.tera_type && <span className="chip" title={t("tera_type")}>Tera {typeName(m.tera_type, lang)}</span>}</div>
            <div className="help trunc">{[m.ability && nameOf("ability", m.ability, lang), m.item && nameOf("item", m.item, lang)].filter(Boolean).join(" · ")}</div>
            <div className="move-list">
              {(m.moves || []).map((mv, j) => (
                <span key={j} className="move-pill" style={{ "--type": TYPE_COLORS[mv.type] || "#777" }} title={mv.power ? `${mv.power}` : ""}>{nameOf("move", mv.name, lang)}</span>
              ))}
            </div>
            {m.points_total > 0 && <div className="sp-line" title={Object.entries(m.stats || {}).map(([k, v]) => `${statShort(k, lang)} ${v}`).join(" · ")}>
              {t("sp_line", { list: Object.entries(m.points).filter(([, v]) => v).map(([k, v]) => `${v} ${statShort(k, lang)}`).join(" · ") })}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

let trainersCache = null;
export function useTrainers(deps = []) {
  const [list, setList] = useState(trainersCache || []);
  const { version } = useApp();
  useEffect(() => {
    let off = false;
    api.call("trainers_list", {}).then((r) => { trainersCache = r.trainers; if (!off) setList(r.trainers); }).catch(() => {});
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, ...deps]);
  return list;
}

let characterCatalogCache = null;
export function useCharacterCatalog() {
  const [data, setData] = useState(characterCatalogCache);
  const [error, setError] = useState(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let off = false;
    api.call("characters_list", {}).then((r) => { characterCatalogCache = r; if (!off) { setData(r); setError(null); } }).catch((e) => { if (!off) setError(e); });
    return () => { off = true; };
  }, [retry]);
  return { data, error, reload: () => setRetry((n) => n + 1) };
}

export function TrainerFilters({ games = [], origin, setOrigin, game, setGame, region, setRegion }) {
  const { t, lang } = useApp();
  const regions = [...new Set(games.flatMap((g) => g.regions || []))];
  return <div className="trainer-filters">
    <label><span className="label">{t("origin")}</span><select className="field" value={origin} onChange={(e) => setOrigin(e.target.value)}>
      <option value="">{t("all")}</option>{["own", "friend", "canon", "random"].map((o) => <option key={o} value={o}>{originLabel(t, o)}</option>)}
    </select></label>
    <label><span className="label">{t("trainer_region")}</span><select className="field" value={region} onChange={(e) => { setRegion(e.target.value); if (!games.find((g) => g.id === game)?.regions?.includes(e.target.value)) setGame(""); }}>
      <option value="">{t("trainer_all_regions")}</option>{regions.map((r) => <option key={r} value={r}>{r === "Unova" && lang !== "en" ? "Teselia" : r}</option>)}
    </select></label>
    <label><span className="label">{t("chars_game")}</span><select className="field" value={game} onChange={(e) => setGame(e.target.value)}>
      <option value="">{t("chars_all_games")}</option>{games.filter((g) => !region || g.regions?.includes(region)).map((g) => <option key={g.id} value={g.id}>{lang === "en" ? g.name : g.name_es}</option>)}
    </select></label>
  </div>;
}

export function TrainerSelect({ value, onChange, label, allowNone = false, exclude = [], id }) {
  const { t, lang, changed } = useApp();
  const list = useTrainers([value]);   // re-read when the value changes: a trainer made a moment ago is not in the cached list yet
  const catalog = useCharacterCatalog();
  const [q, setQ] = useState("");
  const [origin, setOrigin] = useState("");
  const [game, setGame] = useState("");
  const [region, setRegion] = useState("");
  const [character, setCharacter] = useState(null);
  const [variant, setVariant] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const details = useRef(null);
  const request = useRef(0);
  useEffect(() => { request.current++; setCharacter(null); setBusy(false); setError(null); }, [game, region, origin]);
  const games = catalog.data?.games || [];
  const matches = (tr) => !q || [tr.name, tr.name_es, tr.character_name, tr.character_name_es, tr.title, tr.i18n?.en?.name, tr.i18n?.es?.name, ...(tr.species || [])].join(" ").toLocaleLowerCase().includes(q.toLocaleLowerCase());
  const shown = list.filter((tr) => !exclude.includes(tr.id) && (!origin || tr.origin === origin || origin === "own" && tr.origin === "random") && (!game || tr.games?.includes(game)) && (!region || tr.regions?.includes(region)) && matches(tr));
  const characters = (catalog.data?.characters || []).filter((c) => (!origin || origin === "canon") && (!game || c.games.includes(game)) && (!region || games.some((g) => c.games.includes(g.id) && g.regions?.includes(region))) && matches(c));
  const current = list.find((tr) => tr.id === value);
  const pick = (trainer) => { onChange(trainer); if (details.current) details.current.open = false; };
  const openCharacter = async (c) => {
    const token = ++request.current;
    setBusy(true); setError(null); setCharacter(null);
    try {
      const result = await api.call("character_get", { key: c.key });
      if (token !== request.current) return;
      const variants = result.variants.filter((v) => (!game || v.games.includes(game)) && (!region || games.some((g) => v.games.includes(g.id) && g.regions?.includes(region))));
      setCharacter({ ...result, variants }); setVariant(variants[0]?.id || "");
    } catch (e) { if (token === request.current) setError(e); }
    finally { if (token === request.current) setBusy(false); }
  };
  const install = async () => {
    const token = ++request.current;
    setBusy(true); setError(null);
    try {
      const { trainer } = await api.call("character_install", { key: character.key, variant, lang });
      changed();
      if (token !== request.current) return;
      if (exclude.includes(trainer.id)) throw new Error(t("trainer_already_selected"));
      pick(trainer.id); setCharacter(null);
    } catch (e) { if (token === request.current) setError(e); }
    finally { if (token === request.current) setBusy(false); }
  };
  return (
    <div className="trainer-select space-y-1.5">
      {label && <span className="label">{label}</span>}
      <details className="trainer-picker" ref={details}>
        <summary id={id} aria-label={label ? `${label}: ${loc(current, lang) || t("choose_trainer")}` : undefined} className="trainer-picker-summary"><Avatar url={current?.avatar_url} name={loc(current, lang)} size={48} /><span className="trainer-picker-name">{loc(current, lang) || t("choose_trainer")}{current?.title && <small className="help block">{loc(current, lang, "title")}</small>}</span></summary>
        <div className="trainer-picker-body space-y-3">
          <input className="field" placeholder={t("search_trainers")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("search_trainers")} />
          <TrainerFilters games={games} {...{ origin, setOrigin, game, setGame, region, setRegion }} />
          {allowNone && <button type="button" className="btn btn-sm" onClick={() => pick("")}>{t("trainer_clear")}</button>}
          {catalog.error && <div role="alert" className="help">{catalog.error.message} <button type="button" className="btn btn-sm" onClick={catalog.reload}>{t("retry")}</button></div>}
          {error && <p role="alert">{error.message}</p>}
          {busy && <Spinner />}
          {character && <div className="trainer-variant space-y-2">
            <div className="flex items-center gap-2"><Avatar url={character.avatar_url} name={character.name} size={64} /><b>{lang === "en" ? character.name : character.name_es}</b></div>
            <label><span className="label">{t("trainer_choose_team")}</span><select className="field" value={variant} onChange={(e) => setVariant(e.target.value)}>{character.variants.map((v) => <option key={v.id} value={v.id}>{lang === "en" ? v.label : v.label_es}</option>)}</select></label>
            <TeamStrip species={character.variants.find((v) => v.id === variant)?.species} size={32} />
            <Busy busy={busy} className="btn btn-primary" disabled={!variant} onClick={install}>{t("trainer_use_team")}</Busy>
          </div>}
          <div className="trainer-picker-results">
            {shown.length > 0 && <><p className="label">{t("trainer_saved")} · {shown.length}</p><div className="trainer-picker-grid">{shown.map((tr) => <button type="button" key={tr.id} className="trainer-choice" aria-pressed={value === tr.id} onClick={() => pick(tr.id)}><Avatar url={tr.avatar_url} name={loc(tr, lang)} size={56} /><span><b>{loc(tr, lang)}</b><small>{loc(tr, lang, "title")}</small></span></button>)}</div></>}
            {characters.length > 0 && <><p className="label">{t("from_games")} · {characters.length}</p><div className="trainer-picker-grid">{characters.map((c) => <button type="button" key={c.key} className="trainer-choice" onClick={() => openCharacter(c)}><Avatar url={c.avatar_url} name={c.name} size={56} /><span><b>{lang === "en" ? c.name : c.name_es}</b>{c.name !== c.name_es && <small>{lang === "en" ? c.name_es : c.name}</small>}<small>{t("chars_teams_n", { n: c.teams })}</small></span></button>)}</div></>}
            {!shown.length && !characters.length && <p className="help">{catalog.data ? t("chars_none") : t("loading")}</p>}
          </div>
        </div>
      </details>
      {current && <TeamStrip species={current.species} size={30} />}
    </div>
  );
}

let formatsCache = null;
export function FormatSelect({ value, onChange, id }) {
  const { t } = useApp();
  const [formats, setFormats] = useState(formatsCache || []);
  useEffect(() => {
    if (formatsCache) return;
    api.call("formats_list", {}).then((r) => { formatsCache = r.formats; setFormats(r.formats); }).catch(() => {});
  }, []);
  const listId = `${id || "fmt"}-list`;
  return (
    <>
      <input id={id} className="field" list={listId} value={value || ""} onChange={(e) => onChange(e.target.value)} placeholder="gen9nationaldexag" />
      <datalist id={listId}>{formats.filter((f) => !f.random).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</datalist>
      <span className="help mt-1 block">{t("format_help")}</span>
    </>
  );
}

export function AiFields({ level, style, onLevel, onStyle, compact }) {
  const { t } = useApp();
  return (
    <div className={`grid gap-2 ${compact ? "grid-cols-2" : "sm:grid-cols-2"}`}>
      <Field label={t("ai_level")}>
        <select className="field" value={level || "normal"} onChange={(e) => onLevel(e.target.value)}>
          {AI_LEVELS.map((l) => <option key={l} value={l}>{t(`lvl_${l}`)}</option>)}
        </select>
      </Field>
      <Field label={t("ai_style")}>
        <select className="field" value={style || "balanced"} onChange={(e) => onStyle(e.target.value)}>
          {AI_STYLES.map((s) => <option key={s} value={s}>{t(`style_${s}`)}</option>)}
        </select>
      </Field>
    </div>
  );
}

export function RulesFields({ rules = [], levelRules = {}, onRules, onLevelRules }) {
  const { t } = useApp();
  const [text, setText] = useState(rules.join(", "));
  useEffect(() => setText(rules.join(", ")), [rules.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  const setLR = (k, v) => onLevelRules({ ...levelRules, [k]: v ? Number(v) : undefined });
  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-3">
        <Field label={t("level_fixed")}><input className="field" type="number" min={1} max={100} value={levelRules.level || ""} onChange={(e) => setLR("level", e.target.value)} /></Field>
        <Field label={t("level_cap")}><input className="field" type="number" min={1} max={100} value={levelRules.level_cap || ""} onChange={(e) => setLR("level_cap", e.target.value)} /></Field>
        <Field label={t("level_min")}><input className="field" type="number" min={1} max={100} value={levelRules.level_min || ""} onChange={(e) => setLR("level_min", e.target.value)} /></Field>
      </div>
      <Field label={t("extra_rules")} hint={t("extra_rules_help")}>
        <input className="field" value={text} onChange={(e) => setText(e.target.value)} onBlur={() => onRules(text.split(",").map((x) => x.trim()).filter(Boolean))} placeholder="Sleep Clause Mod, !Team Preview" />
      </Field>
    </div>
  );
}

export function GymBadge({ color = "#c0c0c0", size = 34, label = "", image = "" }) {
  return <BadgeArt color={color} size={size} label={label} image={image} />;
}

export function JobProgress({ job }) {
  const { t } = useApp();
  if (!job) return null;
  const running = job.status === "running" || job.status === "queued";
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-[12.5px]">
        {running && <Spinner />}
        <span>{t(`job_${job.status}`)}</span>
        {running && <span className="help num">{Math.round((job.progress || 0) * 100)}%</span>}
        {job.error && <span className="help" style={{ color: "#ff9a8e" }}>{job.error}</span>}
      </div>
      {running && <Bar value={job.progress || 0} alarm={false} thin />}
    </div>
  );
}

/** Polls a job until it ends; `onDone(job)` once. */
export function useJob(jobId, onDone) {
  const [job, setJob] = useState(null);
  const done = useRef(false);
  useEffect(() => { done.current = false; setJob(null); }, [jobId]);
  usePoll(async () => {
    if (!jobId || done.current) return;
    const j = await api.call("job_get", { id: jobId });
    setJob(j);
    if (!["queued", "running"].includes(j.status) && !done.current) {
      done.current = true;
      onDone?.(j);
    }
  }, 1200, !!jobId);
  return job;
}

export function ExportDialog({ kind, id, name, onClose }) {
  const { t } = useApp();
  const [busy, run] = useBusy();
  const [result, setResult] = useState(null);
  const [friendMode, setFriendMode] = useState(() => { try { return localStorage.getItem("silver-friend-mode") || "choose"; } catch { return "choose"; } });
  const pickMode = (v) => { setFriendMode(v); try { localStorage.setItem("silver-friend-mode", v); } catch { /* the choice lasts this window */ } };
  const [weekly, setWeekly] = useState(false);
  const make = (fmt) => run(fmt, async () => setResult({ fmt, ...(await api.call("export", { kind, id, fmt, ...(fmt === "page" ? { friend_mode: weekly ? "turns" : friendMode, weekly } : {}) })) }));
  const { confirm } = useApp();
  const pokepaste = async () => {
    if (!(await confirm({ title: t("export_pokepaste"), message: t("export_pokepaste_confirm"), confirmLabel: t("export_pokepaste") }))) return;
    run("pokepaste", async () => setResult({ fmt: "pokepaste", ...(await api.call("pokepaste_export", { id })) }));
  };
  return (
    <Modal title={t("export_title", { name })} onClose={onClose} wide>
      <p className="help">{t(`export_help_${kind}`)}</p>
      {kind !== "league" && (
        <div className="space-y-1">
          <span className="label">{t("export_friend_mode")}</span>
          <div className="seg" role="group" aria-label={t("export_friend_mode")}>
            {["choose", "turns", "realtime"].map((v) => <button key={v} type="button" aria-pressed={(weekly ? "turns" : friendMode) === v} disabled={weekly && v !== "turns"}
              onClick={() => pickMode(v)}>{t(`export_mode_${v}`)}</button>)}
          </div>
          <div className="help">{t(`export_mode_help_${weekly ? "turns" : friendMode}`)}</div>
          <label className="flex items-start gap-2 pt-1">
            <input type="checkbox" checked={weekly} onChange={(e) => setWeekly(e.target.checked)} />
            <span><b>{t("export_weekly")}</b><span className="help block">{t("export_weekly_help")}</span></span>
          </label>
        </div>
      )}
      <div className="export-grid">
        {kind !== "league" && (
          <button type="button" className="export-option" onClick={() => make("page")} disabled={busy.page}>
            <Icon d={ICONS.external} size={20} /><b>{t("export_page")}</b><span className="help">{t("export_page_help")}</span>
          </button>
        )}
        <button type="button" className="export-option" onClick={() => make("file")} disabled={busy.file}>
          <Icon d={ICONS.download} size={20} /><b>{t("export_file")}</b><span className="help">{t("export_file_help")}</span>
        </button>
        {kind === "trainer" && (
          <button type="button" className="export-option" onClick={() => make("code")} disabled={busy.code}>
            <Icon d={ICONS.copy} size={20} /><b>{t("export_code")}</b><span className="help">{t("export_code_help")}</span>
          </button>
        )}
        {kind === "trainer" && (
          <button type="button" className="export-option" onClick={() => make("paste")} disabled={busy.paste}>
            <Icon d={ICONS.text} size={20} /><b>{t("export_paste")}</b><span className="help">{t("export_paste_help")}</span>
          </button>
        )}
        {kind === "trainer" && (
          <button type="button" className="export-option" onClick={pokepaste} disabled={busy.pokepaste}>
            <Icon d={ICONS.external} size={20} /><b>{t("export_pokepaste")}</b><span className="help">{t("export_pokepaste_help")}</span>
          </button>
        )}
      </div>
      {Object.values(busy).some(Boolean) && <div className="flex items-center gap-2"><Spinner /> <span className="help">{t("working")}</span></div>}
      {result && (result.fmt === "page" || result.fmt === "file") && (
        <div className="banner banner-info flex flex-wrap items-center gap-2">
          <span className="min-w-0 flex-1 trunc">{result.file} · {Math.round(result.bytes / 1024)} KB{result.week ? ` · ${t("weekly_this", { week: result.week })}` : ""}</span>
          <a className="btn btn-primary btn-sm" href={api.exportUrl(result.file)} download={result.file}><Icon d={ICONS.download} size={14} /> {t("download")}</a>
          {result.fmt === "page" && <a className="btn btn-sm" href={`${api.exportUrl(result.file)}?download=false`} target="_blank" rel="noreferrer"><Icon d={ICONS.external} size={14} /> {t("open_page")}</a>}
        </div>
      )}
      {result && result.fmt === "pokepaste" && (
        <div className="banner banner-info flex flex-wrap items-center gap-2">
          <a className="min-w-0 flex-1 trunc btn-link" href={result.url} target="_blank" rel="noreferrer">{result.url}</a>
          <CopyButton text={result.url} />
        </div>
      )}
      {result && (result.fmt === "code" || result.fmt === "paste") && (
        <div className="space-y-1">
          <div className="flex items-center gap-2"><b className="flex-1">{result.fmt === "code" ? t("export_code") : t("export_paste")}</b><CopyButton text={result.code || result.paste} /></div>
          <textarea className="field" rows={result.fmt === "code" ? 4 : 10} readOnly value={result.code || result.paste} onFocus={(e) => e.target.select()} />
        </div>
      )}
    </Modal>
  );
}

// A picture another site serves (the Pokémon Wiki's art, a link pasted by you), fetched by the page itself: some image servers
// answer browsers and turn the app's server away, so the bytes travel from here.
export async function fetchPicture(url) {
  const r = await fetch(url, { mode: "cors", credentials: "omit" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const blob = await r.blob();
  if (!blob.type.startsWith("image/")) throw new Error("not a picture");
  return blob;
}

const ART_CREDIT = "Pokémon Wiki (Fandom) · © Nintendo, Creatures, GAME FREAK";

/** "Sprite by X" for a Showdown sprite, "Art: X" for official art or a picture of your own with a credit. */
export function creditLabel(t, tr) {
  if (!tr?.avatar_credit) return "";
  return tr.avatar_kind && tr.avatar_kind !== "sprite" ? t("art_by", { name: tr.avatar_credit }) : t("sprite_by", { name: tr.avatar_credit });
}

/** The official artwork of a character or trainer class from the Pokémon Wiki: search, the pages found, the pictures (thumbs from
 * the wiki itself). onOpen(index, items) shows one big; selected marks the one in use (Personaje). */
export function OfficialArtGrid({ query: initial = "", onOpen, selected = "", compact = false, onLoaded }) {
  const { t, lang } = useApp();
  const [q, setQ] = useState(initial);
  const [page, setPage] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setQ(initial); setPage(""); }, [initial]);
  useEffect(() => {
    if (!q.trim() && !page) { setData(null); return undefined; }
    let alive = true;
    const h = setTimeout(() => {
      setLoading(true);
      setError("");
      api.call("official_art_search", { query: q, page, limit: 60 })
        .then((r) => { if (alive) { setData(r); onLoaded?.(r); } })
        .catch((e) => { if (alive) setError(e.message || String(e)); })
        .finally(() => alive && setLoading(false));
    }, 350);
    return () => { alive = false; clearTimeout(h); };
  }, [q, page]); // eslint-disable-line react-hooks/exhaustive-deps
  const items = (data?.images || []).map((im) => ({
    ...im, url: im.full, thumb: im.thumb, title: lang === "en" ? im.label : im.label_es, sub: im.page, credit: ART_CREDIT, href: im.page_url,
  }));
  return (
    <div className="space-y-2">
      {!compact && (
        <input className="field" value={q} onChange={(e) => { setQ(e.target.value); setPage(""); }} placeholder={t("art_search")} aria-label={t("art_search")} />
      )}
      {data?.pages?.length > 1 && (
        <div className="flex flex-wrap gap-1" role="group" aria-label={t("art_pages")}>
          {data.pages.slice(0, 8).map((p) => (
            <button key={p} type="button" className={`chip chip-btn ${p === data.page ? "is-on" : ""}`} aria-pressed={p === data.page} onClick={() => setPage(p)}>{p}</button>
          ))}
        </div>
      )}
      {loading && <Spinner />}
      {error && <p className="help" role="alert">{error}</p>}
      {!loading && data && items.length === 0 && <p className="help">{t("art_none", { q: data.page || q })}</p>}
      <div className="sprite-grid art-grid">
        {items.map((it, i) => (
          <button key={it.file} type="button" className={`sprite-pick art-pick ${selected === it.file ? "is-on" : ""}`} aria-pressed={selected === it.file}
            onClick={() => onOpen?.(i, items)} title={`${it.title} · ${it.width} × ${it.height}`}>
            <img src={it.thumb} alt={it.title} loading="lazy" referrerPolicy="no-referrer" />
            <span className="trunc">{it.title}</span>
          </button>
        ))}
      </div>
      <p className="help">{t("art_help")}</p>
    </div>
  );
}

const KINDS = ["", "photo", "art", "drawing", "sprite", "pose", "image"];

function OwnImages({ trainer, onOpen }) {
  const { t } = useApp();
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("");
  const [data, setData] = useState(null);
  useEffect(() => {
    const h = setTimeout(() => api.call("avatar_images", { query: q, kind, limit: 200 }).then(setData).catch(() => setData({ images: [] })), 200);
    return () => clearTimeout(h);
  }, [q, kind]);
  const items = (data?.images || []).map((im) => ({
    ...im, title: im.trainers.length ? im.trainers.join(", ") : im.title || t(`kind1_${im.kind}`),
    sub: [t(`kind1_${im.kind}`), im.title && im.trainers.length ? im.title : "", im.in_use.length ? t("in_use_by", { names: im.in_use.join(", ") }) : ""].filter(Boolean).join(" · "),
  }));
  return (
    <div className="space-y-2">
      <input className="field" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("own_search")} aria-label={t("own_search")} />
      <div className="flex flex-wrap gap-1" role="group" aria-label={t("own_kind")}>
        {KINDS.map((k) => (
          <button key={k || "all"} type="button" className={`chip chip-btn ${kind === k ? "is-on" : ""}`} aria-pressed={kind === k} onClick={() => setKind(k)}>
            {k ? t(`kind_${k}`) : t("all")}
          </button>
        ))}
      </div>
      {!data ? <Spinner /> : items.length === 0 ? <p className="help">{q ? t("own_none_q", { q }) : t("own_none")}</p> : (
        <div className="sprite-grid">
          {items.map((it, i) => (
            <button key={it.file} type="button" className={`sprite-pick ${trainer?.avatar === it.avatar ? "is-on" : ""}`} onClick={() => onOpen(i, items)} title={it.sub}>
              <img src={it.url} alt="" loading="lazy" className="pixelated" />
              <span className="trunc">{it.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const LOOK_KEY = "silver-draw-look";

export function AvatarDialog({ trainer, onClose, onSaved, initialTab = "" }) {
  const { t, notify, toastError, sprites } = useApp();
  const ownNow = String(trainer?.avatar || "").startsWith("file:");
  const [tab, setTab] = useState(initialTab || (ownNow ? "mine" : "sprites"));
  const [q, setQ] = useState(trainer?.name?.split(" ")[0]?.toLowerCase() || "");
  const [names, setNames] = useState(null);
  const [artists, setArtists] = useState({});
  const [busy, run] = useBusy();
  const [jobId, setJobId] = useState("");
  const [candidates, setCandidates] = useState([]);
  const [viewer, setViewer] = useState(null);
  const [link, setLink] = useState("");
  const [cut, setCut] = useState(false);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef(null);
  const pickRef = useRef(null);
  useEffect(() => {
    const h = setTimeout(() => api.call("trainer_sprites_search", { query: q, limit: 160 }).then((r) => { setNames(r.sprites); setArtists(r.artists || {}); }).catch(() => setNames([])), 200);
    return () => clearTimeout(h);
  }, [q]);
  const [look, setLook] = useState(() => { try { return localStorage.getItem(LOOK_KEY) || "art"; } catch { return "art"; } });
  const pickLook = (v) => { setLook(v); try { localStorage.setItem(LOOK_KEY, v); } catch { /* per-viewer convenience */ } };
  const job = useJob(jobId, (j) => {
    if (j.status === "done") { setCandidates(j.result?.candidates || []); notify(t("prospero_done")); onSaved?.(); }
    else toastError({ message: j.error || t("job_failed") });
  });
  const finish = () => { notify(t("avatar_saved")); onSaved?.(); onClose(); };
  const choose = (avatar) => run("save", async () => {
    await api.call("trainer_update", { id: trainer.id, avatar });
    finish();
  });
  // a picture as it is: no pixels, no drawing, nothing generated
  const useBlob = (blob, extra = {}) => run("upload", async () => {
    await api.uploadAvatar(blob, { trainerId: trainer.id, mode: "upload", cutBackground: cut, kind: "image", ...extra });
    finish();
  });
  const useUrl = (url, extra = {}) => run("upload", async () => {
    let blob = null;
    try { blob = await fetchPicture(url); } catch { blob = null; }
    if (blob) await api.uploadAvatar(blob, { trainerId: trainer.id, mode: "upload", cutBackground: cut, kind: "image", source: url, ...extra });
    else await api.call("avatar_from_url", { url, trainer_id: trainer.id, kind: extra.kind || "image", credit: extra.credit || "", title: extra.title || "", cut_background: cut });
    finish();
  });
  const styleRef = (url, name) => run("style", async () => {
    const blob = await fetchPicture(url);
    const ext = (blob.type.split("/")[1] || "png").replace("jpeg", "jpg");
    await api.uploadStyleRefs([new File([blob], `${String(name || "style").replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 40)}.${ext}`, { type: blob.type })]);
    notify(t("style_ref_added"));
  });
  useEffect(() => {
    // Ctrl+V: a copied picture, or the address of one (outside the text fields)
    const onPaste = (e) => {
      const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith("image/"));
      if (file) { e.preventDefault(); useBlob(file, { kind: "image" }); return; }
      const text = (e.clipboardData?.getData("text") || "").trim();
      const inField = e.target instanceof HTMLElement && e.target.closest("input, textarea");
      if (!inField && /^https?:\/\/\S+$/.test(text)) { e.preventDefault(); useUrl(text); }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }); // eslint-disable-line react-hooks/exhaustive-deps
  const onDrop = (e) => {
    e.preventDefault();
    setDrag(false);
    const file = [...(e.dataTransfer?.files || [])].find((f) => f.type.startsWith("image/"));
    if (file) return useBlob(file, { kind: "image" });
    const url = (e.dataTransfer?.getData("text/uri-list") || e.dataTransfer?.getData("text") || "").trim().split("\n")[0];
    if (/^https?:\/\//.test(url)) useUrl(url);
    return undefined;
  };
  const [description, setDescription] = useState("");
  const [picked, setPicked] = useState(0);
  const [gameStyle, setGameStyle] = useState(true);
  const upload = (mode) => {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    run(mode, async () => {
      await api.uploadAvatar(file, { trainerId: trainer.id, mode, kind: "photo", cutBackground: cut });
      finish();
    });
  };
  const draw = () => run("prospero", async () => {
    const files = fileRef.current?.files || [];
    setCandidates([]);
    const r = await api.drawAvatar(files, { description, trainerId: trainer.id, style: gameStyle, look });
    if (r.id) setJobId(r.id);
  });
  const spriteItems = (names || []).map((n) => ({ url: sprites.trainer(`sd:${n}`), title: n, avatar: `sd:${n}`,
    sub: artists[n] ? t("sprite_by", { name: artists[n] }) : t("avatar_tab_sprites") }));
  const candidateItems = candidates.flatMap((c) => [
    { url: c.url, title: t("avatar_sprite"), avatar: c.avatar },
    ...(c.drawing ? [{ url: c.drawing.url, title: t("avatar_drawing"), avatar: c.drawing.avatar }] : []),
  ]);
  const useButton = (item, label) => (
    <Busy busy={busy.save || busy.upload} className="btn btn-primary" onClick={() => (item.avatar ? choose(item.avatar) : useUrl(item.url, {
      kind: "art", credit: item.credit || "", title: item.file || item.title || "",
    }))}>{label}</Busy>
  );
  return (
    <Modal title={t("avatar_title", { name: trainer.name })} onClose={onClose} wide>
      <div className={`avatar-dialog ${drag ? "is-drag" : ""}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop}>
        <div className="avatar-upload-bar">
          <Busy busy={busy.upload} className="btn btn-primary" onClick={() => pickRef.current?.click()}><Icon d={ICONS.upload} size={14} /> {t("avatar_upload_any")}</Busy>
          <input ref={pickRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) useBlob(f, { kind: "image" }); }} />
          <form className="avatar-link" onSubmit={(e) => { e.preventDefault(); if (link.trim()) useUrl(link.trim()); }}>
            <input className="field" value={link} onChange={(e) => setLink(e.target.value)} placeholder={t("avatar_link_ph")} aria-label={t("avatar_link_ph")} inputMode="url" />
            <button type="submit" className="btn" disabled={!/^https?:\/\/\S+$/.test(link.trim()) || busy.upload}>{t("avatar_link_use")}</button>
          </form>
          <label className="flex items-center gap-2 help"><input type="checkbox" checked={cut} onChange={(e) => setCut(e.target.checked)} /> {t("avatar_cut_bg")}</label>
          <p className="help w-full">{t("avatar_upload_help")}</p>
        </div>
        <Tabs value={tab} onChange={setTab} tabs={[{ id: "sprites", label: t("avatar_tab_sprites") }, { id: "art", label: t("avatar_tab_art") },
          { id: "mine", label: t("avatar_tab_mine") }, { id: "photo", label: t("avatar_tab_photo") }, { id: "poses", label: t("avatar_tab_poses") }]} />
        {tab === "poses" && <PosesPanel trainer={trainer} onSaved={onSaved} />}
        {tab === "sprites" && (
          <div className="space-y-2">
            <input className="field" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("avatar_search")} aria-label={t("avatar_search")} />
            {names && names.length === 0 && (
              <div className="panel space-y-2">
                <p>{t("avatar_sprites_none", { q })}</p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn btn-sm" onClick={() => pickRef.current?.click()}>{t("avatar_upload_any")}</button>
                  <button type="button" className="btn btn-sm" onClick={() => setTab("mine")}>{t("avatar_tab_mine")}</button>
                  <button type="button" className="btn btn-sm" onClick={() => setTab("art")}>{t("avatar_tab_art")}</button>
                </div>
              </div>
            )}
            <div className="sprite-grid">
              {spriteItems.map((it, i) => (
                <button key={it.avatar} type="button" className={`sprite-pick ${trainer.avatar === it.avatar ? "is-on" : ""}`} onClick={() => setViewer({ items: spriteItems, index: i })}
                  onDoubleClick={() => choose(it.avatar)} title={`${it.title} · ${it.sub}`} disabled={busy.save}>
                  <img src={it.url} alt={it.title} loading="lazy" className="pixelated" />
                  <span className="trunc">{it.title}</span>
                </button>
              ))}
            </div>
            <p className="help">{t("avatar_sprites_help")} {t("avatar_click_big")}</p>
          </div>
        )}
        {tab === "art" && <OfficialArtGrid query={trainer.name || ""} onOpen={(index, items) => setViewer({ items, index, art: true })} />}
        {tab === "mine" && <OwnImages trainer={trainer} onOpen={(index, items) => setViewer({ items, index })} />}
        {tab === "photo" && (
          <div className="space-y-3">
            <input ref={fileRef} type="file" accept="image/*" multiple className="field" aria-label={t("avatar_photos")}
              onChange={(e) => setPicked(Math.min(4, e.target.files?.length || 0))} />
            <div className="grid gap-2 sm:grid-cols-2">
              <Busy busy={busy.upload} className="btn" disabled={!picked} onClick={() => upload("upload")}>{t("avatar_upload")}</Busy>
              <Busy busy={busy.pixel} className="btn" disabled={!picked} onClick={() => upload("pixel")}>{t("avatar_pixel")}</Busy>
            </div>
            <p className="help">{t("avatar_photo_help")}</p>
            <div className="panel space-y-2">
              <b>{t("avatar_prospero")}</b>
              <div className="seg" role="group" aria-label={t("draw_look")}>
                {["art", "sprite"].map((v) => <button key={v} type="button" aria-pressed={look === v} onClick={() => pickLook(v)}>{t(`draw_look_${v}`)}</button>)}
              </div>
              <p className="help">{t(`draw_look_${look}_help`)}</p>
              <input className="field" value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)}
                placeholder={t("avatar_description_ph")} aria-label={t("avatar_description")} />
              <label className="flex items-center gap-2"><input type="checkbox" checked={gameStyle} onChange={(e) => setGameStyle(e.target.checked)} /> {t(look === "art" ? "avatar_game_style_art" : "avatar_game_style")}</label>
              <div className="flex flex-wrap items-center gap-2">
                <Busy busy={busy.prospero || (job && job.status !== "done" && job.status !== "failed" && job.status !== "cancelled")} className="btn btn-primary"
                  disabled={!picked && !description.trim()} onClick={draw}>{t(look === "art" ? "avatar_draw_art" : "avatar_draw")}</Busy>
                <span className="help">{picked ? t("avatar_photos_n", { n: picked }) : t("avatar_no_photos")}</span>
              </div>
              <p className="help">{t("avatar_draw_help")}</p>
            </div>
            {job && <JobProgress job={job} />}
            {candidates.length > 0 && (
              <div className="space-y-1">
                <b>{t("avatar_candidates")}</b>
                <div className="candidate-grid">
                  {candidates.map((c) => (
                    <div key={c.file} className="candidate">
                      <button type="button" className="sprite-pick" onClick={() => setViewer({ items: candidateItems, index: candidateItems.findIndex((x) => x.avatar === c.avatar) })}
                        onDoubleClick={() => choose(c.avatar)} title={t("avatar_use_sprite")}>
                        <img src={c.url} alt="" className="pixelated" /><span>{t("avatar_sprite")}</span>
                      </button>
                      {c.drawing && (
                        <button type="button" className="sprite-pick" onClick={() => setViewer({ items: candidateItems, index: candidateItems.findIndex((x) => x.avatar === c.drawing.avatar) })}
                          onDoubleClick={() => choose(c.drawing.avatar)} title={t("avatar_use_drawing")}>
                          <img src={c.drawing.url} alt="" /><span>{t("avatar_drawing")}</span>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        {drag && <div className="avatar-drop-hint" aria-hidden="true">{t("avatar_drop_here")}</div>}
      </div>
      {viewer && (
        <ImageViewer items={viewer.items} index={viewer.index} onClose={() => setViewer(null)}
          actions={(item) => (
            <>
              {useButton(item, viewer.art ? t("art_use") : item.avatar?.startsWith("sd:") ? t("avatar_use_this_sprite") : t("avatar_use_this"))}
              {(viewer.art || item.kind === "art") && (
                <Busy busy={busy.style} className="btn" onClick={() => styleRef(item.url, item.file || item.title)}>{t("art_as_style")}</Busy>
              )}
            </>
          )} />
      )}
    </Modal>
  );
}

/** The trainer's picture big: front, and its poses when it has them; a button changes it. */
export function TrainerPictureViewer({ trainer, onClose, onChange }) {
  const { t } = useApp();
  const poses = trainer.avatar_poses || {};
  const items = [
    { url: trainer.avatar_url, title: trainer.name, sub: t("pose_front"), credit: creditLabel(t, trainer) },
    ...["back", "win"].filter((p) => poses[p]).map((p) => ({ url: poses[p], title: trainer.name, sub: t(`pose_${p}`) })),
  ];
  return (
    <ImageViewer items={items} onClose={onClose}
      actions={() => <button type="button" className="btn btn-primary" onClick={onChange}><Icon d={ICONS.pencil} size={14} /> {t("change_avatar")}</button>} />
  );
}

// the trainer's own sprite drawn again by Prospero from behind (the player's side of a battle) and in a victory pose (the end screen)
function PosesPanel({ trainer, onSaved }) {
  const { t, notify, toastError } = useApp();
  const [info, setInfo] = useState(null);
  const [jobId, setJobId] = useState("");
  const [candidates, setCandidates] = useState({});
  const [viewing, setViewing] = useState(-1);
  const [busy, run] = useBusy();
  const load = () => api.call("avatar_poses_get", { trainer_id: trainer.id }).then(setInfo).catch((e) => toastError(e));
  useEffect(() => { load(); }, [trainer.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const job = useJob(jobId, (j) => {
    if (j.status === "done") { setCandidates(j.result?.candidates || {}); notify(t("prospero_done")); load(); onSaved?.(); }
    else toastError({ message: j.error || t("job_failed") });
  });
  const running = !!job && !["done", "failed", "cancelled"].includes(job.status);
  const draw = (poses) => run("draw", async () => {
    setCandidates({});
    const r = await api.call("avatar_poses_draw", { trainer_id: trainer.id, poses, count: 2 });
    const id = r?.id || r?.job?.id;
    if (id) setJobId(id);
  });
  const pick = (pose, file) => run(pose, async () => {
    setInfo(await api.call("avatar_pose_set", { avatar: info.avatar, pose, file }));
    notify(t("avatar_saved"));
    onSaved?.();
  });
  if (!info) return <Spinner />;
  if (!info.can_draw) return <p className="help">{t("poses_own_only")}</p>;
  const views = [{ url: info.avatar_url, title: t("pose_front") }, ...["back", "win"].filter((p) => info.poses[p]).map((p) => ({ url: info.poses[p], title: t(`pose_${p}`) }))];
  const big = (url) => setViewing(Math.max(0, views.findIndex((v) => v.url === url)));
  return (
    <div className="space-y-3">
      <p className="help">{t("poses_help")}</p>
      <div className="pose-row">
        <figure className="pose-cell"><button type="button" className="pose-view" onClick={() => big(info.avatar_url)} aria-label={t("avatar_view")}><img src={info.avatar_url} alt="" className="pixelated" /></button><figcaption>{t("pose_front")}</figcaption></figure>
        {["back", "win"].map((p) => (
          <figure key={p} className="pose-cell">
            {info.poses[p] ? <button type="button" className="pose-view" onClick={() => big(info.poses[p])} aria-label={t("avatar_view")}><img src={info.poses[p]} alt="" className="pixelated" /></button> : <div className="pose-empty" aria-hidden="true">?</div>}
            <figcaption>{t(`pose_${p}`)}</figcaption>
            {info.poses[p] && <button type="button" className="btn btn-sm" disabled={busy[p]} onClick={() => pick(p, "")}>{t("pose_drop")}</button>}
          </figure>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Busy busy={busy.draw || running} className="btn btn-primary" onClick={() => draw([])}>{t("poses_draw")}</Busy>
        <Busy busy={busy.draw || running} className="btn" onClick={() => draw(["back"])}>{t("poses_draw_back")}</Busy>
        <Busy busy={busy.draw || running} className="btn" onClick={() => draw(["win"])}>{t("poses_draw_win")}</Busy>
      </div>
      {job && <JobProgress job={job} />}
      {Object.entries(candidates).filter(([, list]) => list.length > 1).map(([pose, list]) => (
        <div key={pose} className="space-y-1">
          <b>{t(`pose_${pose}`)} · {t("avatar_candidates")}</b>
          <div className="candidate-grid">
            {list.map((c) => (
              <button key={c.file} type="button" className={`sprite-pick ${info.poses[pose]?.endsWith(c.file) ? "is-on" : ""}`} onClick={() => pick(pose, c.avatar)}>
                <img src={c.url} alt="" className="pixelated" />
              </button>
            ))}
          </div>
        </div>
      ))}
      {viewing >= 0 && <ImageViewer items={views} index={viewing} onClose={() => setViewing(-1)} />}
    </div>
  );
}

export function originLabel(t, origin) {
  return t(`origin_${origin || "own"}`);
}

export function RecordChip({ record }) {
  const { t } = useApp();
  if (!record) return null;
  const { wins = 0, losses = 0, ties = 0 } = record;
  if (!wins && !losses && !ties) return null;
  return <span className="chip num" title={t("record")}>{wins}–{losses}{ties ? `–${ties}` : ""}</span>;
}

export function useSeats(battle) {
  const { sprites, lang } = useApp();
  return useMemo(() => {
    if (!battle) return {};
    const seat = (s) => ({ name: loc(s, lang), avatarUrl: s?.avatar_url || (s?.avatar ? sprites.trainer(s.avatar) : ""), dialogue: s?.dialogue || {},
      backUrl: s?.avatar_poses?.back || "", winUrl: s?.avatar_poses?.win || "" });
    return { p1: seat(battle.p1), p2: seat(battle.p2) };
  }, [battle?.id, battle?.p1?.avatar_url, battle?.p2?.avatar_url, battle?.p1?.avatar_poses?.back, battle?.p2?.avatar_poses?.back,
    battle?.p1?.avatar_poses?.win, battle?.p2?.avatar_poses?.win, battle?.p1?.name, battle?.p2?.name, sprites, lang]); // eslint-disable-line react-hooks/exhaustive-deps
}
