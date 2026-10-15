// The app's own building blocks: avatars, team strips and cards, pickers for trainers, formats and AI, the export and avatar
// dialogs, badges and job progress.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import { useApp } from "../context.js";
import { TYPE_COLORS, nameOf, spriteId, typeName } from "../battle/dex.js";
import { Bar, Busy, CopyButton, Field, Icon, ICONS, Modal, Spinner, Tabs, useBusy } from "./ui.jsx";
import { usePoll } from "./hooks.js";
import { BadgeArt } from "./badges.jsx";

export const AI_LEVELS = ["random", "easy", "normal", "hard", "expert"];
export const AI_STYLES = ["balanced", "aggressive", "defensive", "setup", "stall"];

export function Avatar({ url, name = "", size = 48, pixelated = true, className = "" }) {
  const [bad, setBad] = useState(false);
  useEffect(() => setBad(false), [url]);
  if (!url || bad) {
    return <span className={`avatar-fallback ${className}`} style={{ width: size, height: size, fontSize: size * 0.38 }} aria-hidden="true">{(name || "?").slice(0, 1).toUpperCase()}</span>;
  }
  return <img src={url} alt="" width={size} height={size} className={`avatar ${pixelated ? "pixelated" : ""} ${className}`} onError={() => setBad(true)} draggable={false} />;
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

export function TrainerSelect({ value, onChange, label, allowNone = false, exclude = [], id }) {
  const { t } = useApp();
  const list = useTrainers([value]);   // re-read when the value changes: a trainer made a moment ago is not in the cached list yet
  const [q, setQ] = useState("");
  const shown = list.filter((tr) => !exclude.includes(tr.id) && (!q || `${tr.name} ${tr.title} ${tr.species.join(" ")}`.toLowerCase().includes(q.toLowerCase())));
  const current = list.find((tr) => tr.id === value);
  return (
    <div className="trainer-select space-y-1.5">
      {label && <span className="label">{label}</span>}
      <div className="flex items-center gap-2">
        {current ? <Avatar url={current.avatar_url} name={current.name} size={40} /> : <span className="avatar-fallback" style={{ width: 40, height: 40 }}>?</span>}
        <select id={id} className="field" value={value || ""} onChange={(e) => onChange(e.target.value)}>
          {(allowNone || !value) && <option value="">{t("choose_trainer")}</option>}
          {shown.map((tr) => <option key={tr.id} value={tr.id}>{tr.name}{tr.title ? ` — ${tr.title}` : ""}</option>)}
        </select>
      </div>
      {list.length > 12 && <input className="field" placeholder={t("filter")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("filter")} />}
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
  const make = (fmt) => run(fmt, async () => setResult({ fmt, ...(await api.call("export", { kind, id, fmt, ...(fmt === "page" ? { friend_mode: friendMode } : {}) })) }));
  return (
    <Modal title={t("export_title", { name })} onClose={onClose} wide>
      <p className="help">{t(`export_help_${kind}`)}</p>
      {kind !== "league" && (
        <div className="space-y-1">
          <span className="label">{t("export_friend_mode")}</span>
          <div className="seg" role="group" aria-label={t("export_friend_mode")}>
            {["choose", "turns", "realtime"].map((v) => <button key={v} type="button" aria-pressed={friendMode === v} onClick={() => pickMode(v)}>{t(`export_mode_${v}`)}</button>)}
          </div>
          <div className="help">{t(`export_mode_help_${friendMode}`)}</div>
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
      </div>
      {Object.values(busy).some(Boolean) && <div className="flex items-center gap-2"><Spinner /> <span className="help">{t("working")}</span></div>}
      {result && (result.fmt === "page" || result.fmt === "file") && (
        <div className="banner banner-info flex flex-wrap items-center gap-2">
          <span className="min-w-0 flex-1 trunc">{result.file} · {Math.round(result.bytes / 1024)} KB</span>
          <a className="btn btn-primary btn-sm" href={api.exportUrl(result.file)} download={result.file}><Icon d={ICONS.download} size={14} /> {t("download")}</a>
          {result.fmt === "page" && <a className="btn btn-sm" href={`${api.exportUrl(result.file)}?download=false`} target="_blank" rel="noreferrer"><Icon d={ICONS.external} size={14} /> {t("open_page")}</a>}
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

export function AvatarDialog({ trainer, onClose, onSaved }) {
  const { t, notify, toastError, sprites } = useApp();
  const [tab, setTab] = useState("sprites");
  const [q, setQ] = useState(trainer?.name?.split(" ")[0]?.toLowerCase() || "");
  const [names, setNames] = useState([]);
  const [busy, run] = useBusy();
  const [jobId, setJobId] = useState("");
  const [candidates, setCandidates] = useState([]);
  const fileRef = useRef(null);
  useEffect(() => {
    const h = setTimeout(() => api.call("trainer_sprites_search", { query: q, limit: 160 }).then((r) => setNames(r.sprites)).catch(() => {}), 200);
    return () => clearTimeout(h);
  }, [q]);
  const job = useJob(jobId, (j) => {
    if (j.status === "done") { setCandidates(j.result?.candidates || []); notify(t("prospero_done")); onSaved?.(); }
    else toastError({ message: j.error || t("job_failed") });
  });
  const choose = (avatar) => run("save", async () => {
    await api.call("trainer_update", { id: trainer.id, avatar });
    notify(t("avatar_saved"));
    onSaved?.();
    onClose();
  });
  const [description, setDescription] = useState("");
  const [picked, setPicked] = useState(0);
  const [gameStyle, setGameStyle] = useState(true);
  const upload = (mode) => {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    run(mode, async () => {
      await api.uploadAvatar(file, { trainerId: trainer.id, mode });
      notify(t("avatar_saved"));
      onSaved?.();
      onClose();
    });
  };
  const draw = () => run("prospero", async () => {
    const files = fileRef.current?.files || [];
    setCandidates([]);
    const r = await api.drawAvatar(files, { description, trainerId: trainer.id, style: gameStyle });
    if (r.id) setJobId(r.id);
  });
  return (
    <Modal title={t("avatar_title", { name: trainer.name })} onClose={onClose} wide>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "sprites", label: t("avatar_tab_sprites") }, { id: "photo", label: t("avatar_tab_photo") },
        { id: "poses", label: t("avatar_tab_poses") }]} />
      {tab === "poses" && <PosesPanel trainer={trainer} onSaved={onSaved} />}
      {tab === "sprites" && (
        <div className="space-y-2">
          <input className="field" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("avatar_search")} aria-label={t("avatar_search")} />
          <div className="sprite-grid">
            {names.map((n) => (
              <button key={n} type="button" className="sprite-pick" onClick={() => choose(`sd:${n}`)} title={n} disabled={busy.save}>
                <img src={sprites.trainer(`sd:${n}`)} alt={n} loading="lazy" className="pixelated" />
                <span className="trunc">{n}</span>
              </button>
            ))}
          </div>
          <p className="help">{t("avatar_sprites_help")}</p>
        </div>
      )}
      {tab === "photo" && (
        <div className="space-y-3">
          <input ref={fileRef} type="file" accept="image/*" multiple className="field" aria-label={t("avatar_photos")}
            onChange={(e) => setPicked(Math.min(4, e.target.files?.length || 0))} />
          <div className="grid gap-2 sm:grid-cols-2">
            <Busy busy={busy.pixel} className="btn" disabled={!picked} onClick={() => upload("pixel")}>{t("avatar_pixel")}</Busy>
            <Busy busy={busy.upload} className="btn" disabled={!picked} onClick={() => upload("upload")}>{t("avatar_upload")}</Busy>
          </div>
          <p className="help">{t("avatar_photo_help")}</p>
          <div className="panel space-y-2">
            <b>{t("avatar_prospero")}</b>
            <input className="field" value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)}
              placeholder={t("avatar_description_ph")} aria-label={t("avatar_description")} />
            <label className="flex items-center gap-2"><input type="checkbox" checked={gameStyle} onChange={(e) => setGameStyle(e.target.checked)} /> {t("avatar_game_style")}</label>
            <div className="flex flex-wrap items-center gap-2">
              <Busy busy={busy.prospero || (job && job.status !== "done" && job.status !== "failed" && job.status !== "cancelled")} className="btn btn-primary"
                disabled={!picked && !description.trim()} onClick={draw}>{t("avatar_draw")}</Busy>
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
                    <button type="button" className="sprite-pick" onClick={() => choose(c.avatar)} title={t("avatar_use_sprite")}>
                      <img src={c.url} alt="" className="pixelated" /><span>{t("avatar_sprite")}</span>
                    </button>
                    {c.drawing && (
                      <button type="button" className="sprite-pick" onClick={() => choose(c.drawing.avatar)} title={t("avatar_use_drawing")}>
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
    </Modal>
  );
}

// the trainer's own sprite drawn again by Prospero from behind (the player's side of a battle) and in a victory pose (the end screen)
function PosesPanel({ trainer, onSaved }) {
  const { t, notify, toastError } = useApp();
  const [info, setInfo] = useState(null);
  const [jobId, setJobId] = useState("");
  const [candidates, setCandidates] = useState({});
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
  return (
    <div className="space-y-3">
      <p className="help">{t("poses_help")}</p>
      <div className="pose-row">
        <figure className="pose-cell"><img src={info.avatar_url} alt="" className="pixelated" /><figcaption>{t("pose_front")}</figcaption></figure>
        {["back", "win"].map((p) => (
          <figure key={p} className="pose-cell">
            {info.poses[p] ? <img src={info.poses[p]} alt="" className="pixelated" /> : <div className="pose-empty" aria-hidden="true">?</div>}
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
  const { sprites } = useApp();
  return useMemo(() => {
    if (!battle) return {};
    const seat = (s) => ({ name: s?.name || "", avatarUrl: s?.avatar_url || (s?.avatar ? sprites.trainer(s.avatar) : ""), dialogue: s?.dialogue || {},
      backUrl: s?.avatar_poses?.back || "", winUrl: s?.avatar_poses?.win || "" });
    return { p1: seat(battle.p1), p2: seat(battle.p2) };
  }, [battle?.id, battle?.p1?.avatar_url, battle?.p2?.avatar_url, battle?.p1?.avatar_poses?.back, battle?.p2?.avatar_poses?.back,
    battle?.p1?.avatar_poses?.win, battle?.p2?.avatar_poses?.win, sprites]); // eslint-disable-line react-hooks/exhaustive-deps
}
