// A stand-in for scripts/neural_ai_server.py in tests: answers /decide with the first legal choice of the request, remembers what it
// was sent per battle, and reports it on /seen. Prints its port on stdout when listening.
import http from 'node:http';

const seen = {};
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const send = (o) => { res.writeHead(200, {'content-type': 'application/json'}); res.end(JSON.stringify(o)); };
    if (req.url === '/health') return send({ok: true, model: 'fake', device: 'cpu', battles: Object.keys(seen).length});
    if (req.url === '/seen') return send(seen);
    const a = JSON.parse(body || '{}');
    const key = `${a.battle}:${a.side}`;
    const s = (seen[key] ||= {calls: 0, lines: 0, gen: a.gen, starts: 0});
    s.calls++;
    s.lines += (a.lines || []).length;
    if ((a.lines || []).some((l) => l.startsWith('|start'))) s.starts++;
    const r = a.request || {};
    const mons = r.side?.pokemon || [];
    let choice = 'default';
    if (r.teamPreview) choice = `team ${mons.map((_, i) => i + 1).join('')}`;
    else if (r.forceSwitch) {
      const i = mons.findIndex((p) => !p.active && !String(p.condition).endsWith(' fnt'));
      choice = i >= 0 ? `switch ${i + 1}` : 'pass';
    } else {
      const i = (r.active?.[0]?.moves || []).findIndex((m) => !m.disabled);
      choice = `move ${i + 1}`;
    }
    send({ok: true, choice, action: 0, ms: 1});
  });
});
server.listen(0, '127.0.0.1', () => process.stdout.write(`${server.address().port}\n`));
