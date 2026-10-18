// Sound for battles, shared by the app, the real-time screen and the playable page. No audio files ship with the app:
//  - effects (hits, faints, jingles, move whooshes tinted by type, clicks...) are synthesised here with WebAudio;
//  - cries are fetched from a URL the caller gives (the app's cached route), decoded once and kept in memory;
//  - battle music is an <audio> element on a URL the caller gives, looped, with fades.
// A small mixer (master / music / effects / cries + mute) is stored in localStorage. Browsers block audio until the person does
// something, so the AudioContext is only created after the first click, key or touch.
import { MUSIC_OPTIONS } from "./sound-strings.js";

const KEY = "silver-sound";
const MUSIC_IDS = new Set(MUSIC_OPTIONS.map((x) => x.id));
const DEFAULTS = { master: 0.8, music: 0.5, sfx: 0.8, cries: 0.8, mute: false, music_track: "auto" };
const clamp01 = (n, d) => (Number.isFinite(Number(n)) ? Math.max(0, Math.min(1, Number(n))) : d);
const clean = (o) => ({ master: clamp01(o.master, DEFAULTS.master), music: clamp01(o.music, DEFAULTS.music), sfx: clamp01(o.sfx, DEFAULTS.sfx),
  cries: clamp01(o.cries, DEFAULTS.cries), mute: !!o.mute,
  music_track: o.music_track === "none" || MUSIC_IDS.has(o.music_track) ? o.music_track : "auto" });

function load() {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    return clean({ ...DEFAULTS, ...(raw ? JSON.parse(raw) : {}) });
  } catch { return { ...DEFAULTS }; }
}
let cfg = load();
const listeners = new Set();

export const getSettings = () => cfg;
export function setSettings(patch) {
  const previousTrack = cfg.music_track;
  cfg = clean({ ...cfg, ...patch });
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* private mode: the mixer still works for this visit */ }
  if (previousTrack !== cfg.music_track && requestedMusic) music.play(requestedMusic);
  applyVolumes();
  listeners.forEach((fn) => { try { fn(cfg); } catch { /* a listener must not break the mixer */ } });
}
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const silent = () => cfg.mute || cfg.master <= 0;

// ---------------------------------------------------------------------------------------------------------- context
let ctx = null;
let bus = null;
let unlocked = false;
let voices = 0;

function ensure() {
  if (ctx) return ctx;
  const AC = typeof globalThis !== "undefined" ? globalThis.AudioContext || globalThis.webkitAudioContext : null;
  const active = unlocked || (typeof navigator !== "undefined" && navigator.userActivation && navigator.userActivation.hasBeenActive);
  if (!AC || !active) return null;
  try {
    ctx = new AC();
    const master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp);
    comp.connect(ctx.destination);
    const sfx = ctx.createGain();
    const cries = ctx.createGain();
    sfx.connect(master);
    cries.connect(master);
    bus = { master, sfx, cries };
    applyVolumes();
  } catch { ctx = null; return null; }
  return ctx;
}

function applyVolumes() {
  if (bus) {
    bus.master.gain.value = silent() ? 0 : cfg.master;
    bus.sfx.gain.value = cfg.sfx;
    bus.cries.gain.value = cfg.cries;
  }
  musicVolume();
}

/** Call from a click / key / touch handler; the app also listens for the first one by itself. */
export function unlock() {
  unlocked = true;
  const c = ensure();
  if (c && c.state === "suspended") c.resume().catch(() => {});
  retryMusic();
}

if (typeof window !== "undefined") {
  const once = () => {
    unlock();
    if (ctx) for (const ev of ["pointerdown", "keydown", "touchstart"]) window.removeEventListener(ev, once, true);
  };
  for (const ev of ["pointerdown", "keydown", "touchstart"]) window.addEventListener(ev, once, true);
  // a hidden tab is silent (and the battle clock in the real-time screen pauses by itself)
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { ctx?.suspend?.().catch(() => {}); music.hold(true); } else { ctx?.resume?.().catch(() => {}); music.hold(false); }
  });
}

// ---------------------------------------------------------------------------------------------------------- building blocks
let noiseBuf = null;
function noiseBuffer() {
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

function envelope(g, t, vol, attack, dur) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(Math.max(0.0002, vol), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
}

function track(node, end) {
  voices += 1;
  node.onended = () => { voices -= 1; };
  node.stop(end);
}

/** One oscillator: f -> to over dur seconds. */
function tone(o, { f, to, dur = 0.15, wave = "sine", vol = 0.3, delay = 0, attack = 0.004, lfo, lfoDepth = 0 }) {
  if (voices > 40) return;
  const t = ctx.currentTime + (o.delay || 0) + delay;
  const pf = o.pitch || 1;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = wave;
  osc.frequency.setValueAtTime(f * pf, t);
  if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to * pf), t + dur);
  envelope(g, t, vol * (o.vol ?? 1), attack, dur);
  osc.connect(g);
  g.connect(o.out);
  if (lfo) {
    const l = ctx.createOscillator();
    const lg = ctx.createGain();
    l.frequency.value = lfo;
    lg.gain.value = lfoDepth;
    l.connect(lg);
    lg.connect(osc.frequency);
    l.start(t);
    l.stop(t + dur + 0.03);
  }
  osc.start(t);
  track(osc, t + dur + 0.03);
}

/** A burst of filtered noise; the filter cut-off glides f -> to. */
function noise(o, { dur = 0.1, vol = 0.3, filter = "lowpass", f = 1000, to, q = 1, delay = 0, attack = 0.003 }) {
  if (voices > 40) return;
  const t = ctx.currentTime + (o.delay || 0) + delay;
  const pf = o.pitch || 1;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer();
  const flt = ctx.createBiquadFilter();
  flt.type = filter;
  flt.Q.value = q;
  flt.frequency.setValueAtTime(f * pf, t);
  if (to) flt.frequency.exponentialRampToValueAtTime(Math.max(20, to * pf), t + dur);
  const g = ctx.createGain();
  envelope(g, t, vol * (o.vol ?? 1), attack, dur);
  src.connect(flt);
  flt.connect(g);
  g.connect(o.out);
  src.start(t, Math.random() * 0.5);
  track(src, t + dur + 0.03);
}

const midi = (n) => 440 * 2 ** ((n - 69) / 12);

// ---------------------------------------------------------------------------------------------------------- the move whoosh by type
// Every type has its own timbre: a list of tone ("t") and noise ("n") parts, kept short and quiet.
const T = (wave, f, to, dur, vol, extra) => ({ k: "t", wave, f, to, dur, vol, ...extra });
const N = (filter, f, to, q, dur, vol, extra) => ({ k: "n", filter, f, to, q, dur, vol, ...extra });
const WHOOSH = {
  Normal: [N("bandpass", 900, 2400, 1, 0.16, 0.22), T("triangle", 320, 160, 0.12, 0.1)],
  Fire: [N("lowpass", 500, 3600, 0.7, 0.3, 0.3), T("sawtooth", 110, 260, 0.25, 0.1)],
  Water: [N("bandpass", 600, 1500, 4, 0.28, 0.22), T("sine", 500, 900, 0.08, 0.12), T("sine", 700, 1200, 0.08, 0.1, { delay: 0.09 })],
  Electric: [T("square", 1800, 300, 0.06, 0.1), T("square", 600, 2400, 0.06, 0.1, { delay: 0.07 }), N("highpass", 4000, 6000, 1, 0.15, 0.12)],
  Grass: [N("highpass", 3000, 6000, 0.5, 0.3, 0.18), T("triangle", 400, 600, 0.2, 0.06)],
  Ice: [T("sine", 2400, 3200, 0.25, 0.1), T("sine", 3100, 3600, 0.2, 0.08, { delay: 0.08 }), N("highpass", 6000, 8000, 1, 0.2, 0.1)],
  Fighting: [N("lowpass", 900, 150, 1, 0.1, 0.35), T("sine", 140, 60, 0.14, 0.5)],
  Poison: [T("sawtooth", 220, 150, 0.35, 0.08, { lfo: 9, lfoDepth: 20 }), N("bandpass", 700, 300, 3, 0.3, 0.1)],
  Ground: [N("lowpass", 300, 80, 1, 0.4, 0.5), T("sine", 70, 45, 0.35, 0.5)],
  Flying: [N("bandpass", 1200, 3200, 0.8, 0.25, 0.2), T("sine", 600, 1100, 0.2, 0.05)],
  Psychic: [T("sine", 400, 1200, 0.35, 0.12, { lfo: 7, lfoDepth: 40 }), T("sine", 800, 300, 0.35, 0.08, { delay: 0.05 })],
  Bug: [T("sawtooth", 180, 200, 0.3, 0.08, { lfo: 40, lfoDepth: 60 }), N("bandpass", 3000, 3000, 5, 0.2, 0.08)],
  Rock: [N("lowpass", 1200, 200, 1, 0.22, 0.4), T("square", 90, 50, 0.15, 0.25)],
  Ghost: [T("sine", 330, 110, 0.45, 0.12, { lfo: 5, lfoDepth: 30 }), N("bandpass", 500, 200, 6, 0.4, 0.1)],
  Dragon: [T("sawtooth", 90, 220, 0.35, 0.16), N("lowpass", 700, 1800, 1, 0.3, 0.2)],
  Dark: [T("square", 220, 70, 0.3, 0.1), N("lowpass", 900, 200, 1, 0.3, 0.2)],
  Steel: [T("square", 1500, 1500, 0.15, 0.06), T("square", 2250, 2250, 0.15, 0.05, { delay: 0.02 }), N("highpass", 3500, 5000, 1, 0.1, 0.15)],
  Fairy: [1047, 1319, 1568, 2093].map((f, i) => T("sine", f, f, 0.1, 0.1, { delay: 0.05 * i })),
};
WHOOSH.Stellar = WHOOSH.Psychic;

function parts(o, list) {
  for (const p of list.flat()) (p.k === "t" ? tone : noise)(o, p);
}

// ---------------------------------------------------------------------------------------------------------- cues
const hit = (o, k = 1) => {
  noise(o, { dur: 0.09, vol: 0.5 * k, filter: "lowpass", f: 2600, to: 300 });
  tone(o, { f: 180, to: 55, dur: 0.12, vol: 0.6 * k });
};
const arp = (o, notes, { step = 0.07, wave = "triangle", vol = 0.22, dur = 0.14 } = {}) => notes.forEach((n, i) => tone(o, { f: midi(n), dur, wave, vol, delay: i * step }));

const STATUS_CUE = {
  par: (o) => { [900, 400, 1200, 500].forEach((f, i) => tone(o, { f, to: f * 0.6, dur: 0.05, wave: "square", vol: 0.12, delay: i * 0.05 })); noise(o, { dur: 0.22, vol: 0.14, filter: "bandpass", f: 3000, q: 2 }); },
  brn: (o) => { [0, 0.07, 0.15].forEach((d) => noise(o, { dur: 0.07, vol: 0.2, filter: "highpass", f: 3500, delay: d })); tone(o, { f: 200, to: 420, dur: 0.25, wave: "sawtooth", vol: 0.1 }); },
  psn: (o) => [0, 0.09, 0.18].forEach((d, i) => tone(o, { f: 300 + i * 40, to: 600 + i * 60, dur: 0.1, vol: 0.2, delay: d })),
  slp: (o) => [72, 67, 64].forEach((n, i) => tone(o, { f: midi(n), dur: 0.3, vol: 0.18, delay: i * 0.22 })),
  frz: (o) => { [2093, 2637, 3136].forEach((f, i) => tone(o, { f, dur: 0.3, vol: 0.12, delay: i * 0.06 })); noise(o, { dur: 0.2, vol: 0.1, filter: "highpass", f: 6000 }); },
};
STATUS_CUE.tox = STATUS_CUE.psn;

const CUES = {
  click: (o) => tone(o, { f: 1400, to: 900, dur: 0.04, wave: "square", vol: 0.08 }),
  hit: (o) => hit(o),
  chip: (o) => hit(o, 0.45),
  super: (o) => {
    hit(o, 0.9);
    tone(o, { f: 660, to: 1320, dur: 0.12, wave: "square", vol: 0.14 });
    tone(o, { f: 1760, dur: 0.14, vol: 0.14, delay: 0.1 });
    noise(o, { dur: 0.12, vol: 0.2, filter: "highpass", f: 5000, delay: 0.02 });
  },
  resisted: (o) => {
    noise(o, { dur: 0.08, vol: 0.22, filter: "lowpass", f: 700 });
    tone(o, { f: 110, to: 70, dur: 0.1, vol: 0.4 });
  },
  crit: (o) => {
    hit(o, 1.1);
    tone(o, { f: 500, to: 2400, dur: 0.1, wave: "sawtooth", vol: 0.16 });
    tone(o, { f: 1568, dur: 0.15, wave: "square", vol: 0.1, delay: 0.08 });
    tone(o, { f: 2093, dur: 0.2, wave: "square", vol: 0.1, delay: 0.14 });
  },
  miss: (o) => {
    noise(o, { dur: 0.22, vol: 0.18, filter: "bandpass", f: 2400, to: 500, q: 1.5 });
    tone(o, { f: 500, to: 300, dur: 0.15, vol: 0.08 });
  },
  faint: (o) => {
    tone(o, { f: 700, to: 70, dur: 0.65, vol: 0.32, lfo: 9, lfoDepth: 25 });
    noise(o, { dur: 0.35, vol: 0.14, filter: "lowpass", f: 1500, to: 150 });
  },
  statUp: (o) => arp(o, [72, 76, 79], { vol: 0.2 }),
  statDown: (o) => arp(o, [67, 64, 60], { vol: 0.2, wave: "square", step: 0.08 }),
  status: (o) => (STATUS_CUE[o.status] || ((x) => tone(x, { f: 440, to: 330, dur: 0.3, wave: "triangle", vol: 0.2, lfo: 14, lfoDepth: 18 })))(o),
  heal: (o) => {
    tone(o, { f: 784, to: 1568, dur: 0.25, vol: 0.18 });
    tone(o, { f: 1319, dur: 0.12, vol: 0.12, delay: 0.12 });
    tone(o, { f: 1760, dur: 0.16, vol: 0.12, delay: 0.2 });
  },
  switchIn: (o) => {
    noise(o, { dur: 0.05, vol: 0.3, filter: "bandpass", f: 1800, q: 1 });
    tone(o, { f: 300, to: 1100, dur: 0.1, vol: 0.25 });
    tone(o, { f: 2200, dur: 0.22, vol: 0.1, delay: 0.08 });
    tone(o, { f: 3000, dur: 0.2, vol: 0.06, delay: 0.14 });
  },
  switchOut: (o) => {
    tone(o, { f: 1000, to: 250, dur: 0.18, wave: "triangle", vol: 0.2 });
    noise(o, { dur: 0.2, vol: 0.15, filter: "bandpass", f: 1500, to: 400, q: 1 });
  },
  big: (o) => {
    arp(o, [60, 64, 67, 72, 76, 79], { step: 0.05, wave: "sine", vol: 0.16, dur: 0.3 });
    noise(o, { dur: 0.5, vol: 0.12, filter: "highpass", f: 3000, to: 8000 });
  },
  move: (o) => parts(o, WHOOSH[o.type] || WHOOSH.Normal),
  // a Plus move: the move's whoosh with a bright echo on top
  plus: (o) => {
    arp(o, [84, 88, 91], { step: 0.04, wave: "sine", vol: 0.13, dur: 0.18 });
    [0.09, 0.18].forEach((d, i) => tone(o, { f: midi(91), dur: 0.16, wave: "sine", vol: 0.08 / (i + 1), delay: d }));
  },
  megaEnd: (o) => arp(o, [79, 74, 67], { step: 0.08, wave: "triangle", vol: 0.16, dur: 0.22 }),
  roll: (o) => noise(o, { dur: 0.16, vol: 0.14, filter: "bandpass", f: 900, to: 2200, q: 1.2 }),
  thud: (o) => {
    noise(o, { dur: 0.12, vol: 0.26, filter: "lowpass", f: 900, to: 200 });
    tone(o, { f: 90, to: 50, dur: 0.12, vol: 0.3 });
  },
  win: (o) => {
    [72, 76, 79, 84].forEach((n, i) => { tone(o, { f: midi(n), dur: 0.18, wave: "triangle", vol: 0.25, delay: i * 0.11 }); tone(o, { f: midi(n), dur: 0.18, wave: "square", vol: 0.05, delay: i * 0.11 }); });
    [84, 79, 76, 72].forEach((n) => tone(o, { f: midi(n), dur: 0.9, wave: "triangle", vol: 0.14, delay: 0.5 }));
  },
  lose: (o) => {
    [67, 64, 60, 55].forEach((n, i) => tone(o, { f: midi(n), dur: i === 3 ? 0.9 : 0.3, wave: "triangle", vol: 0.22, delay: i * 0.24 }));
    tone(o, { f: midi(43), dur: 1.0, wave: "sine", vol: 0.16, delay: 0.7 });
  },
};

const lastAt = {};
/** Play an effect. opts: {type: move type, status, pitch, vol, delay, gap: minimum seconds since the last one with this name}. */
export function sfx(name, opts = {}) {
  if (silent() || cfg.sfx <= 0 || !CUES[name]) return;
  const c = ensure();
  if (!c || !bus) return;
  if (c.state === "suspended") c.resume().catch(() => {});
  const now = c.currentTime;
  const gap = opts.gap ?? 0.04;
  if (lastAt[name] !== undefined && now - lastAt[name] < gap) return;
  lastAt[name] = now;
  try { CUES[name]({ out: bus.sfx, pitch: opts.pitch || 1, vol: opts.vol ?? 1, delay: opts.delay || 0, type: opts.type, status: opts.status }); } catch { /* sound is decoration */ }
}
export const hasCue = (name) => !!CUES[name];

/** A recorded effect at `url` (an animation's sound) on the effects volume; rate changes its pitch. Silent when it cannot load. */
export function sample(url, { vol = 1, rate = 1 } = {}) {
  if (!url || silent() || cfg.sfx <= 0) return;
  const c = ensure();
  if (!c || !bus) return;
  if (c.state === "suspended") c.resume().catch(() => {});
  loadCry(url).then((buf) => {
    if (!buf || silent()) return;
    const src = c.createBufferSource();
    const g = c.createGain();
    src.buffer = buf;
    src.playbackRate.value = Math.max(0.5, Math.min(2, rate));
    g.gain.value = Math.max(0, Math.min(1, vol)) * 0.8;
    src.connect(g);
    g.connect(bus.sfx);
    src.start();
  });
}

// ---------------------------------------------------------------------------------------------------------- cries
const cryCache = new Map();
const cryVoices = [];
function loadCry(url) {
  if (!cryCache.has(url)) {
    if (cryCache.size > 120) cryCache.delete(cryCache.keys().next().value);
    const c = ctx;
    cryCache.set(url, fetch(url).then((r) => (r.ok ? r.arrayBuffer() : null)).then((b) => (b && c ? c.decodeAudioData(b) : null)).catch(() => null));
  }
  return cryCache.get(url);
}

/** Play the cry at `url` (null when there is none). faint=true: lower, slower and cut short. Silent when the cry is not available. */
export function cry(url, { faint = false, vol = 1 } = {}) {
  if (!url || silent() || cfg.cries <= 0) return;
  const c = ensure();
  if (!c || !bus) return;
  loadCry(url).then((buf) => {
    if (!buf || silent()) return;
    const src = c.createBufferSource();
    const g = c.createGain();
    src.buffer = buf;
    src.playbackRate.value = faint ? 0.7 : 1;
    const t = c.currentTime;
    g.gain.setValueAtTime(0.9 * vol, t);
    if (faint) { g.gain.setValueAtTime(0.9 * vol, t + 0.35); g.gain.linearRampToValueAtTime(0.0001, t + 0.6); }
    src.connect(g);
    g.connect(bus.cries);
    while (cryVoices.length >= 3) { try { cryVoices.shift().stop(); } catch { /* already over */ } }
    cryVoices.push(src);
    src.onended = () => { const i = cryVoices.indexOf(src); if (i >= 0) cryVoices.splice(i, 1); };
    src.start(t);
    if (faint) src.stop(t + 0.62);
  });
}

// ---------------------------------------------------------------------------------------------------------- music
let tr = null; // {el, url, fade, timer, wanted}
let held = false;
let pendingRetry = false;
let requestedMusic = "";
const musicLevel = () => (silent() ? 0 : cfg.master * cfg.music * 0.55);

/** Keep the app/export's audio origin; only replace a known battle-music route. */
export function musicTrackUrl(url, choice = cfg.music_track) {
  if (!url || choice === "none") return "";
  return MUSIC_IDS.has(choice) ? url.replace(/(\/api\/music\/)[^/?#]+(?:[?#].*)?$/, `$1${choice}`) : url;
}

function musicVolume() {
  if (!tr) return;
  const v = Math.max(0, Math.min(1, musicLevel() * tr.fade));
  try { tr.el.volume = v; } catch { /* element gone */ }
  if (musicLevel() <= 0 || held) { if (!tr.el.paused) tr.el.pause(); } else if (tr.wanted && tr.el.paused && !pendingRetry) startTrack(tr);
}

function fadeTo(t, to, secs, done) {
  clearInterval(t.timer);
  const from = t.fade;
  const t0 = Date.now();
  t.timer = setInterval(() => {
    const k = secs <= 0 ? 1 : Math.min(1, (Date.now() - t0) / (secs * 1000));
    t.fade = from + (to - from) * k;
    if (tr === t) musicVolume(); else try { t.el.volume = Math.max(0, Math.min(1, musicLevel() * t.fade)); } catch { /* gone */ }
    if (k >= 1) { clearInterval(t.timer); t.timer = null; done?.(); }
  }, 50);
}

function startTrack(t) {
  if (held || musicLevel() <= 0) return;
  const p = t.el.play();
  if (p && p.then) {
    p.then(() => { pendingRetry = false; if (t.fade < 1 && !t.timer) fadeTo(t, 1, 1.2); }).catch(() => { if (tr === t) pendingRetry = true; });
  }
}
function retryMusic() {
  if (pendingRetry && tr && tr.wanted) { pendingRetry = false; startTrack(tr); }
}

function dispose(t) {
  clearInterval(t.timer);
  t.wanted = false;
  try { t.el.pause(); t.el.removeAttribute("src"); t.el.load(); } catch { /* gone */ }
}

function stopTrack({ fade = 1.2 } = {}) {
  const t = tr;
  if (!t) return;
  tr = null;
  t.wanted = false;
  pendingRetry = false;
  if (fade <= 0 || t.el.paused) dispose(t); else fadeTo(t, 0, fade, () => dispose(t));
}

export const music = {
  /** Loop the track at `url` (fades in); the same url again does nothing, another one replaces it. */
  play(url) {
    requestedMusic = url;
    url = musicTrackUrl(url);
    if (!url) { stopTrack({ fade: 0.4 }); return; }
    if (!url || typeof Audio === "undefined") return;
    if (tr && tr.url === url && tr.wanted) return;
    stopTrack({ fade: 0.4 });
    const el = new Audio();
    el.loop = true;
    el.preload = "auto";
    el.volume = 0;
    el.src = url;
    const t = { el, url, fade: 0, timer: null, wanted: true };
    el.addEventListener("error", () => { if (tr === t) { dispose(t); tr = null; } });
    tr = t;
    pendingRetry = false;
    if (musicLevel() > 0) { fadeTo(t, 1, 1.2); startTrack(t); } else t.fade = 1;
  },
  /** Fade out and drop the current track. */
  stop({ fade = 1.2 } = {}) {
    requestedMusic = "";
    stopTrack({ fade });
  },
  get playing() { return !!tr && tr.wanted && !tr.el.paused; },
  /** Recording waits for the requested track; muted, unavailable and disposed tracks keep their usual silent fallback. */
  ready() {
    const el = tr?.el;
    if (!el || musicLevel() <= 0 || el.readyState >= 3) return Promise.resolve();
    return new Promise((resolve) => {
      const events = ["canplay", "error", "emptied"];
      const done = () => { for (const event of events) el.removeEventListener(event, done); resolve(); };
      for (const event of events) el.addEventListener(event, done);
    });
  },
  hold(on) { held = on; musicVolume(); if (!on) retryMusic(); },
};

// ---------------------------------------------------------------------------------------------------------- helpers for the screens
const TRACKS = {
  1: ["hgss-kanto-trainer", "hgss-johto-trainer"], 2: ["hgss-johto-trainer", "hgss-kanto-trainer"],
  3: ["oras-trainer", "oras-rival", "xd-miror-b", "colosseum-miror-b"], 4: ["dpp-trainer", "dpp-rival"],
  5: ["bw-trainer", "bw-rival", "bw2-rival", "bw2-kanto-gym-leader", "bw-subway-trainer", "bw2-homika-dogars"],
  6: ["xy-trainer", "xy-rival"], 7: ["sm-trainer", "sm-rival"],
};
const OTHER = ["bw-trainer", "bw-rival", "bw2-rival", "bw2-kanto-gym-leader"];

// PokeRogue's original tracks (Settings > music source; CC BY-NC-SA 4.0, by its community composers): a gym's battles sound like its
// type, an Elite Four like the abyss, the champion like the end of the road, and other battles get its two battle themes or a lively
// biome (`pr-<name>` on the music route)
const PR_TYPE = { Fire: ["volcano"], Water: ["sea", "seabed"], Grass: ["forest", "tall_grass"], Bug: ["jungle"], Ice: ["ice_cave", "snowy_forest"],
  Electric: ["power_plant"], Ground: ["desert", "wasteland"], Rock: ["rocky_coast", "ruins"], Ghost: ["graveyard"], Psychic: ["space"],
  Dark: ["slum", "abyss"], Fairy: ["fairy_cave"], Steel: ["construction_site", "laboratory"], Poison: ["swamp", "underground_well"],
  Flying: ["island"], Dragon: ["volcano", "space"], Fighting: ["metropolis"], Normal: ["plains", "metropolis"] };
const PR_BATTLE = ["battle_trainer_afd", "battle_rival_3_afd", "metropolis", "plains", "forest", "sea", "cave", "lake"];

/** The track of a battle: always the same for the same battle id. Showdown's: one that fits the generation (1-7; newer ones use a
 * default set). PokeRogue's (`source: "pokerogue"`): the champion and the Elite Four have their own, a gym's battles follow the gym's
 * `type`, and the rest get its battle themes or a lively biome. */
export function pickTrack(id, gen = 0, { source = "showdown", role = "", type = "" } = {}) {
  let h = 0;
  for (const ch of String(id || "")) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  if (source === "pokerogue") {
    const list = role === "champion" ? ["end"] : role === "elite" ? ["abyss", "space"] : (type && PR_TYPE[type]) || PR_BATTLE;
    return `pr-${list[h % list.length]}`;
  }
  const list = TRACKS[gen] || OTHER;
  return list[h % list.length];
}

/** Who a battle of a gym or league challenge is against: the gym's leader, an Elite Four member or the champion ("" otherwise). */
export function battleRole(battle) {
  const run = battle?.run;
  const stages = run?.stages || [];
  const i = stages.findIndex((s) => s.battle_id === battle.id);
  if (!run || i < 0) return "";
  if (run.kind === "gym") return i === stages.length - 1 ? "gym" : "";
  if (run.kind === "league") return i === stages.length - 1 ? "champion" : "elite";
  return "";
}
/** The type of the gym a challenge battle belongs to ("" otherwise). */
export function battleType(battle) {
  return battle?.run?.kind === "gym" ? battle.run.type || "" : "";
}

/** The battle is over: the music fades out and the victory (true) or defeat (false) cue plays; null: a tie, only the fade. */
export function battleEnd(won) {
  music.stop({ fade: 1.5 });
  if (won === null || won === undefined) return;
  sfx(won ? "win" : "lose", { gap: 0 });
}

/** Generation of a format id ("gen9nationaldexag" -> 9; 0 when it does not say). */
export function genOfFormat(format) {
  const m = /^gen(\d)/.exec(String(format || ""));
  return m ? Number(m[1]) : 0;
}

/** For onClickCapture on a group of buttons: a short click when an enabled button is pressed. */
export function clickSound(e) {
  const b = e.target && e.target.closest ? e.target.closest("button") : null;
  if (b && !b.disabled) sfx("click");
}
