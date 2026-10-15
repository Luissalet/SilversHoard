// The neural AI level, in Node only: each decision of a side whose level is "neural" goes to the app's neural AI server
// (scripts/neural_ai_server.py, a reinforcement-learning policy on the GPU) with the battle's lines as that side saw them since its
// last decision and its request, and comes back as a Showdown choice. Registered when the app gives the server's address in
// SILVER_NEURAL_URL; a call that fails or a battle it does not play (doubles, generations 5-8) leaves the choice to the expert.
import {spawnSync} from 'node:child_process';
import {setNeuralSearch} from './ai.mjs';
import {viewLines} from './match.mjs';

export const NEURAL_GENS = new Set([1, 2, 3, 4, 9]);
const NEURAL_MS = 30000;
const sessions = new WeakMap();   // battle -> {key, from: {p1, p2}}: the server keeps each battle's memory under that key
let seq = 0;

// a synchronous POST (the AI is synchronous): a short Node child does the fetch and prints the answer
const CLIENT = "let d='';process.stdin.on('data',(c)=>{d+=c;}).on('end',async()=>{try{const r=await fetch(process.argv[1],{method:'POST',"
  + "headers:{'content-type':'application/json'},body:d,signal:AbortSignal.timeout(Number(process.argv[2]))});"
  + "process.stdout.write(await r.text());}catch(e){process.stdout.write(JSON.stringify({ok:false,error:String((e&&e.message)||e)}));}});";

export function neuralAvailable() {
  return !!process.env.SILVER_NEURAL_URL;
}

export function postSync(path, body, ms = NEURAL_MS, url = process.env.SILVER_NEURAL_URL) {
  if (!url) throw new Error('neural AI not configured');
  const r = spawnSync(process.execPath, ['-e', CLIENT, `${url.replace(/\/$/, '')}${path}`, String(ms)],
    {input: JSON.stringify(body), encoding: 'utf8', timeout: ms + 5000, windowsHide: true, maxBuffer: 4 << 20});
  if (r.error) throw r.error;
  const text = String(r.stdout || '').trim();
  return text ? JSON.parse(text) : {ok: false, error: 'no answer'};
}

function fresh() {
  return {key: `${Date.now().toString(36)}-${process.pid}-${++seq}`, from: {}};
}

/** The policy's choice for one side right now, or null when it does not play this battle. Throws when the server fails. */
export function neuralChoice(battle, sideId, req, opts = {}) {
  if (battle.gameType !== 'singles' || !NEURAL_GENS.has(battle.gen) || !req || (req.active && req.active.length !== 1)) return null;
  let s = sessions.get(battle);
  if (!s) sessions.set(battle, (s = fresh()));
  const side = battle.sides.find((x) => x && x.id === sideId);
  const lines = viewLines(battle.log, s.from[sideId] || 0, sideId);
  const started = Date.now();
  let out;
  try {
    out = postSync('/decide', {battle: s.key, side: sideId, name: side?.name || sideId, gen: battle.gen, lines, request: req},
      opts.neuralMs || NEURAL_MS);
  } catch (e) {
    sessions.set(battle, fresh());   // the server may have half of it: the next decision starts that battle over from its first line
    throw e;
  }
  if (!out.ok) {
    sessions.set(battle, fresh());
    throw new Error(out.error || 'neural AI failed');
  }
  s.from[sideId] = battle.log.length;
  if (opts.trace) opts.trace.neural = {action: out.action, ms: Date.now() - started, model_ms: out.ms || 0};
  return out.choice || null;
}

if (neuralAvailable()) setNeuralSearch(neuralChoice);
