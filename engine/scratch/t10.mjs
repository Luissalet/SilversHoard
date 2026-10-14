import fs from 'node:fs';
import {playOut} from '../src/stats.mjs';
import {exportTeam} from '../src/core.mjs';
const c = JSON.parse(fs.readFileSync('../silvers_hoard/presets/canon.json','utf8'));
for (const k of ['gsc-red','em-wallace','frlg-brock','em-tateliza','gsc-silver-typhlosion','em-steven']) { const t=c.trainers.find(x=>x.key===k); console.log(k, t.name_es, t.format, '\n'+exportTeam(t.sets).split('\n\n').slice(0,2).join('\n--\n')); }
let errs=0; const t0=Date.now();
for (const t of c.trainers) { const r = playOut({format:t.format, p1:{name:t.name, sets:t.sets, ai:{level:'hard'}}, p2:{name:'Red', sets:c.trainers.find(x=>x.key==='gsc-red').sets, ai:{level:'hard'}}, seed:[1,2,3,4]}, {keepLog:false}); if (r.errors.length) {errs++; console.log(t.key, r.errors.slice(0,2));} }
console.log('errs', errs, Date.now()-t0, 'ms');
