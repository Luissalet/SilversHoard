// One-shot runs for long work (series of battles, tournaments) so the live engine process stays free:
// `node src/cli.mjs < request.json` with {cmd, args}; progress goes to stderr as {"progress": x} lines, the answer to stdout.
import {series, tournament, tournamentBattles} from './stats.mjs';
import {handle} from './server.mjs';

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', async () => {
  let req;
  try { req = JSON.parse(raw); } catch (e) { process.stdout.write(JSON.stringify({ok: false, error: {code: 'bad_json', message: e.message}})); return; }
  const a = req.args || {};
  const progress = (x) => process.stderr.write(JSON.stringify({progress: x}) + '\n');
  try {
    let result;
    if (req.cmd === 'simulate') result = series(a.spec, Math.max(1, Math.min(Number(a.count) || 1, 1000)), progress);
    else if (req.cmd === 'tournament') {
      const total = tournamentBattles(a.entrants || [], a.kind, a.best_of);
      result = tournament(a, (n) => progress(total ? Math.min(1, n / total) : 1));
    } else {
      const r = await handle(req);
      process.stdout.write(JSON.stringify(r));
      return;
    }
    process.stdout.write(JSON.stringify({ok: true, result}));
  } catch (e) {
    process.stdout.write(JSON.stringify({ok: false, error: {code: e.code || 'engine_error', message: e.message || String(e)}}));
  }
});
