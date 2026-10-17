// Mass battles ("batalla campal", silvers_hoard/mass.py): ready-made battles like the battle royale videos (a whole Pokédex, the
// starters, every legendary, the generations in teams, a giant against a crowd), a builder for your own (everybody against
// everybody, teams, or many against a few, with whole generations, the strongest of each, groups, names or your trainers' teams)
// and the battles already fought. #/campal/<id> watches one, lets you play one of its Pokémon (the engine replays your input log
// and keeps the run), lists the runs played on it (yours and friends'), makes a page for friends and records a video.
import React, { useState } from "react";
import { api } from "../api.js";
import { useApp } from "../context.js";
import { Busy, Empty, Field, Rel, Section, Spinner, useBusy, useLoad, useStored } from "../components/ui.jsx";
import { TrainerSelect } from "../components/silver.jsx";
import VideoExport from "../components/VideoExport.jsx";
import UnitPicker from "../battle/mass/UnitPicker.jsx";
import "../battle/mass/mass.css";
import { loc } from "../loc.js";
import { lazyChunk } from "../lazy.js";

// the screen carries the battle engine: it comes with the real-time chunk (CombateRt.jsx), only when a battle is watched
const MassScreen = lazyChunk(() => import("./CombateRt.jsx").then((m) => ({ default: m.MassScreen })));

const MODES = ["ffa", "teams", "boss"];
const KINDS = ["dex", "top", "starters", "legendaries", "random", "species", "trainer"];
const FLOORS = ["grass", "sand", "ice", "cave", "indoor", "water", "pyre", "summit", "meteor", "champion", "castle"];
const GENS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const COLORS = ["#3d8bfd", "#e5484d", "#30a46c", "#f5a524", "#8e4ec6", "#12a594", "#e93d82", "#ad7f58", "#6e56cf"];

const newTeam = (i, kind = "dex") => ({ kind, gens: [i % 9 + 1], count: 15, list: "", trainer_id: "", name: "", color: COLORS[i % COLORS.length], shiny: false,
  boss: { hp: 0, size: 0, power: 0 } });

export default function Campal({ param, query }) {
  return param ? <Watch id={param} query={query} /> : <Home />;
}

function Watch({ id, query }) {
  const { t, go, lang, sprites, toastError, notify } = useApp();
  const { data, error, reload } = useLoad(() => api.call("mass_get", { id }), [id]);
  const [busy, run] = useBusy();
  // what the screen shows: the AI's battle, picking a Pokémon, playing it, or a played run again
  const [view, setView] = useState(() => (query?.get("play") ? { kind: "replay", play: query.get("play") } : { kind: "watch" }));
  const [run2, setRun2] = useState(0);
  const [page, setPage] = useState(null);
  const [replay, setReplay] = useState(null);
  React.useEffect(() => {
    if (view.kind !== "replay") return;
    setReplay(null);
    api.call("mass_play_get", { id, play_id: view.play }).then(setReplay).catch((e) => { toastError(e); setView({ kind: "watch" }); });
  }, [view.kind, view.play]); // eslint-disable-line react-hooks/exhaustive-deps
  if (error) return <div className="banner banner-warn">{String(error.message || error)}</div>;
  if (!data) return <Spinner label={t("mass_loading")} />;
  const again = () => run("again", async () => {
    try {
      const out = await api.call("mass_start", { again: id });
      go(`#/campal/${out.id}`);
    } catch (e) { toastError(e); }
  });
  const exportPage = () => run("page", async () => {
    try { setPage(await api.call("mass_export", { id })); } catch (e) { toastError(e); }
  });
  const removePlay = (pid) => run(`rm${pid}`, async () => { await api.call("mass_play_delete", { id, play_id: pid }); reload(); });
  const onPlayed = async ({ unit, inputs, hash }) => {
    const out = await api.call("mass_play", { id, unit, inputs, hash });
    notify(t("mass_play_saved"));
    reload();
    return out;
  };
  const plays = data.plays || [];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="page-title">{loc(data, lang, "title")}</h1>
        <span className="chip">{t(`mass_mode_${data.mode}`)}</span>
        <span className="chip">{t("mass_units", { n: data.units })}</span>
        {data.from && <span className="chip">{t("mass_from", { name: data.from })}</span>}
        {busy.again && <Spinner label={t("mass_running")} />}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="seg" role="group">
          <button type="button" aria-pressed={view.kind === "watch"} onClick={() => setView({ kind: "watch" })}>{t("mass_watch_ai")}</button>
          <button type="button" aria-pressed={view.kind === "pick" || view.kind === "play"} onClick={() => setView({ kind: "pick" })}>{t("mass_play")}</button>
        </div>
        <Busy busy={busy.page} className="btn btn-sm" onClick={exportPage}>{t("mass_page")}</Busy>
        <VideoExport tool="mass_video" args={{ id, play_id: view.kind === "replay" ? view.play : "" }} help={t("mass_video_help")} />
        {page && (
          <span className="help">
            {t("mass_page_done")} <a className="btn btn-sm" href={api.exportUrl(page.file)} download={page.file}>{t("mass_download")}</a>
          </span>
        )}
      </div>
      {view.kind === "pick" && <div className="panel"><UnitPicker spec={data.spec} t={t} onPick={(unit) => { setRun2((n) => n + 1); setView({ kind: "play", unit }); }} onCancel={() => setView({ kind: "watch" })} /></div>}
      {view.kind === "replay" && replay && <p className="help">{t("mass_replay_of", { who: loc(replay, lang, "challenger"), name: replay.name })}</p>}
      {view.kind !== "pick" && (view.kind !== "replay" || replay) && (
        <React.Suspense fallback={<Spinner label={t("mass_loading")} />}>
          <MassScreen key={`${data.id}:${view.kind}:${view.unit ?? view.play ?? ""}:${run2}`} doc={data} t={t} lang={lang} sprites={sprites}
            play={view.kind === "play" ? { unit: view.unit } : null}
            replay={view.kind === "replay" && replay ? { unit: replay.unit, inputs: replay.inputs } : null}
            onPlayed={view.kind === "play" ? onPlayed : null}
            onCheck={view.kind === "watch" ? (hash) => api.call("mass_check", { id, hash }) : null}
            onAgain={view.kind === "play" ? () => setRun2((n) => n + 1) : view.kind === "watch" ? again : null}
            onBack={() => (view.kind === "watch" ? go("#/campal") : setView({ kind: "watch" }))} />
        </React.Suspense>
      )}
      <Section title={t("mass_plays")} count={plays.length}>
        {!plays.length ? <Empty title={t("mass_plays_none")} /> : (
          <div className="panel p-0 overflow-x-auto">
            <table className="mass-rank">
              <thead><tr><th>{t("mass_place")}</th><th>{t("mass_player")}</th><th>{t("mass_pokemon")}</th>{data.mode !== "ffa" && <th>{t("mass_team")}</th>}<th>{t("mass_kos_h")}</th><th>{t("mass_damage")}</th><th /></tr></thead>
              <tbody>
                {plays.map((p) => (
                  <tr key={p.id}>
                    <td className="num">{p.place}/{p.of}{p.alive ? " ★" : ""}</td>
                    <td>{loc(p, lang, "challenger")}{p.source === "friend" ? <span className="help"> · {t("mass_source_friend")}</span> : null}</td>
                    <td>{p.name}</td>
                    {data.mode !== "ffa" && <td>{p.team_name}{p.team_won ? " ✓" : ""}</td>}
                    <td className="num">{p.kos}</td>
                    <td className="num">{p.dealt}</td>
                    <td className="whitespace-nowrap">
                      <button type="button" className="btn btn-sm" onClick={() => setView({ kind: "replay", play: p.id })}>{t("mass_watch_play")}</button>{" "}
                      <Busy busy={busy[`rm${p.id}`]} className="btn btn-sm" onClick={() => removePlay(p.id)}>{t("mass_delete")}</Busy>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}

function Home() {
  const { t, go, toastError, lang } = useApp();
  const { data: presets } = useLoad(() => api.call("mass_presets", {}), []);
  const { data: past, reload } = useLoad(() => api.call("mass_list", {}), []);
  const [busy, run] = useBusy();
  const start = (key, args) => run(key, async () => {
    try {
      const out = await api.call("mass_start", args);
      go(`#/campal/${out.id}`);
    } catch (e) { toastError(e); }
  });
  const remove = (id) => run(`rm${id}`, async () => { await api.call("mass_delete", { id }); reload(); });
  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">{t("mass_title")}</h1>
        <p className="help max-w-3xl">{t("mass_help")}</p>
      </div>
      <Section title={t("mass_presets")}>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {(presets?.presets || []).map((p) => (
            <div key={p.id} className="panel mass-preset space-y-2">
              <div className="flex items-center gap-2"><span className="chip">{t(`mass_mode_${p.mode}`)}</span><span className="help">{t(`floor_${p.floor}`)}</span></div>
              <b>{lang === "en" ? p.title_en : p.title}</b>
              <Busy busy={busy[p.id]} className="btn btn-primary btn-sm" onClick={() => start(p.id, { preset: p.id })}>{t("mass_go")}</Busy>
            </div>
          ))}
        </div>
      </Section>
      <Builder onStart={(args) => start("custom", args)} busy={busy.custom} />
      <Section title={t("mass_past")} count={past?.battles?.length || 0}>
        {!past?.battles?.length ? <Empty title={t("mass_none")} /> : (
          <div className="panel divide-list p-0">
            {past.battles.map((b) => (
              <div key={b.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <a href={`#/campal/${b.id}`} className="font-semibold">{loc(b, lang, "title")}</a>
                <span className="chip">{t(`mass_mode_${b.mode}`)}</span>
                <span className="help">{t("mass_units", { n: b.units })}</span>
                <span className="help">{b.winner_name ? t("mass_won_by", { name: b.winner_name }) : t("mass_tie")}</span>
                {b.played > 0 && <span className="chip">{t("mass_plays")}: {b.played}</span>}
                {b.from && <span className="chip">{t("mass_from", { name: b.from })}</span>}
                <span className="help ml-auto"><Rel ts={b.created_at} /></span>
                <Busy busy={busy[`rm${b.id}`]} className="btn btn-sm" onClick={() => remove(b.id)}>{t("mass_delete")}</Busy>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function Builder({ onStart, busy }) {
  const { t } = useApp();
  const [mode, setMode] = useStored("silver-mass-mode", "ffa");
  const [level, setLevel] = useStored("silver-mass-level", 50);
  const [floor, setFloor] = useStored("silver-mass-floor", "grass");
  const [limit, setLimit] = useStored("silver-mass-limit", 180);
  const [teams, setTeams] = useStored("silver-mass-teams", [newTeam(0), newTeam(2)]);
  const setTeam = (i, patch) => setTeams(teams.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const shown = mode === "ffa" ? teams.slice(0, Math.max(1, teams.length)) : teams;
  const args = () => ({
    mode, level: Number(level), floor, time_limit: Number(limit),
    teams: shown.map((x, i) => {
      const o = { kind: x.kind, name: x.name || undefined, color: x.color };
      if (["dex", "top", "legendaries", "random"].includes(x.kind)) o.gens = x.gens;
      if (["top", "random"].includes(x.kind)) o.count = Number(x.count) || 15;
      if (x.kind === "species") o.species = x.list.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
      if (x.kind === "trainer") o.trainer_id = x.trainer_id;
      if (x.shiny) o.shiny_chance = 1;
      if (mode === "boss" && i === 0 && (Number(x.boss.hp) || Number(x.boss.size) || Number(x.boss.power))) o.boss = x.boss;
      return o;
    }),
  });
  return (
    <Section title={t("mass_build")}>
      <div className="panel space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t("mass_mode")}>
            <div className="seg" role="group">
              {MODES.map((m) => <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}>{t(`mass_mode_${m}`)}</button>)}
            </div>
          </Field>
          <Field label={t("mass_level")}>
            <select className="field" value={level} onChange={(e) => setLevel(e.target.value)}>
              {[50, 100, 5, 0].map((v) => <option key={v} value={v}>{v ? v : t("mass_level_own")}</option>)}
            </select>
          </Field>
          <Field label={t("mass_floor")}>
            <select className="field" value={floor} onChange={(e) => setFloor(e.target.value)}>
              {FLOORS.map((f) => <option key={f} value={f}>{t(`floor_${f}`)}</option>)}
            </select>
          </Field>
          <Field label={t("mass_time")}>
            <select className="field" value={limit} onChange={(e) => setLimit(e.target.value)}>
              {[60, 120, 180, 300, 600].map((n) => <option key={n} value={n}>{n / 60} min</option>)}
            </select>
          </Field>
        </div>
        <p className="help">{t(`mass_mode_help_${mode}`)}</p>
        {shown.map((x, i) => (
          <div key={i} className="mass-team-edit space-y-2" style={{ borderColor: x.color }}>
            <div className="flex flex-wrap items-end gap-2">
              <b>{mode === "boss" ? (i === 0 ? t("mass_giants") : t("mass_crowd", { n: i })) : mode === "ffa" ? t("mass_group", { n: i + 1 }) : t("mass_team_n", { n: i + 1 })}</b>
              <Field label={t("mass_kind")}>
                <select className="field" value={x.kind} onChange={(e) => setTeam(i, { kind: e.target.value })}>
                  {KINDS.map((k) => <option key={k} value={k}>{t(`mass_kind_${k}`)}</option>)}
                </select>
              </Field>
              {mode !== "ffa" && <Field label={t("mass_name")}><input className="field max-w-[180px]" value={x.name} maxLength={40} placeholder={t("mass_name_auto")} onChange={(e) => setTeam(i, { name: e.target.value })} /></Field>}
              {mode !== "ffa" && <Field label={t("mass_color")}><input type="color" className="h-9 w-12" value={x.color} onChange={(e) => setTeam(i, { color: e.target.value })} /></Field>}
              {["top", "random"].includes(x.kind) && (
                <Field label={x.kind === "top" ? t("mass_count_each") : t("mass_count")}>
                  <input className="field max-w-[90px]" type="number" min={1} max={1100} value={x.count} onChange={(e) => setTeam(i, { count: e.target.value })} />
                </Field>
              )}
              <label className="flex items-center gap-1 help"><input type="checkbox" checked={!!x.shiny} onChange={(e) => setTeam(i, { shiny: e.target.checked })} /> {t("mass_shiny")}</label>
              {shown.length > (mode === "ffa" ? 1 : 2) && <button type="button" className="btn btn-sm ml-auto" onClick={() => setTeams(teams.filter((_, k) => k !== i))}>{t("mass_remove")}</button>}
            </div>
            {["dex", "top", "legendaries", "random"].includes(x.kind) && (
              <div className="flex flex-wrap items-center gap-1">
                <span className="help">{t("mass_gens")}:</span>
                {GENS.map((g) => (
                  <button key={g} type="button" className={`gmap-tool ${x.gens.includes(g) ? "is-on" : ""}`}
                    onClick={() => setTeam(i, { gens: x.gens.includes(g) ? x.gens.filter((y) => y !== g) : [...x.gens, g].sort() })}>{g}</button>
                ))}
              </div>
            )}
            {x.kind === "species" && <textarea className="field" rows={2} value={x.list} placeholder={t("mass_species_ph")} onChange={(e) => setTeam(i, { list: e.target.value })} />}
            {x.kind === "trainer" && <TrainerSelect value={x.trainer_id} onChange={(v) => setTeam(i, { trainer_id: v })} />}
            {mode === "boss" && i === 0 && (
              <div className="flex flex-wrap items-end gap-2">
                <span className="help">{t("mass_boss_help")}</span>
                {["hp", "size", "power"].map((k) => (
                  <Field key={k} label={t(`mass_boss_${k}`)}>
                    <input className="field max-w-[90px]" type="number" step="0.1" min={0} max={k === "hp" ? 200 : 5} value={x.boss[k] || ""} placeholder="auto"
                      onChange={(e) => setTeam(i, { boss: { ...x.boss, [k]: Number(e.target.value) || 0 } })} />
                  </Field>
                ))}
              </div>
            )}
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          {teams.length < 16 && <button type="button" className="btn btn-sm" onClick={() => setTeams([...teams, newTeam(teams.length)])}>{mode === "ffa" ? t("mass_add_group") : t("mass_add_team")}</button>}
          <Busy busy={busy} className="btn btn-primary" onClick={() => onStart(args())}>{t("mass_go")}</Busy>
          {busy && <span className="help">{t("mass_running")}</span>}
        </div>
      </div>
    </Section>
  );
}
