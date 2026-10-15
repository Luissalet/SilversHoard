// Compare recorded decisions with a trainer who only sees information revealed at that point.
import {Battle} from '@pkmn/sim';
import {EngineError} from './core.mjs';
import {chooseFor, freeze, makeRng} from './ai.mjs';

export function practiceSuggestions(input, side = 'p1', startTurn = 1, turnCount = 10, minGap = 0.35) {
  if (!Array.isArray(input) || !['p1', 'p2'].includes(side) || !Number.isInteger(startTurn) || startTurn < 1 ||
      !Number.isInteger(turnCount) || turnCount < 1 || !Number.isFinite(minGap) || minGap < 0) {
    throw new EngineError('invalid', 'Choose side p1/p2, positive start/count and a non-negative score gap.');
  }
  const read = prefix => {
    const line = input.find(l => typeof l === 'string' && l.startsWith(prefix));
    if (!line) throw new EngineError('invalid', 'This replay has no complete decision record.');
    return JSON.parse(line.slice(prefix.length));
  };
  const b = new Battle({...read('>start '), p1:read('>player p1 '), p2:read('>player p2 ')});
  b.send = () => {};
  const suggestions = [], seen = new Set();
  let analysed = 0, skipped = 0, nextTurn = null;
  for (const line of input) {
    if (!/^>p[12] /.test(line)) continue;
    const id = line.slice(1,3), choice = line.slice(4), req = b[side].activeRequest;
    if (id === side && !b.ended && req?.active && !req.wait && !b[side].isChoiceDone() && !seen.has(b.turn) && b.turn >= startTurn) {
      seen.add(b.turn);
      if (b.turn >= startTurn + turnCount) { nextTurn = b.turn; break; }
      const scratch = Battle.fromJSON(JSON.parse(freeze(b)));
      scratch.send = () => {};
      // A pending opponent choice is private, even when its line happens to be first in the record.
      for (const s of scratch.sides) s.clearChoice();
      const trace = {};
      chooseFor(scratch, side, {level:'expert', style:'balanced', hidden:true, allOptions:true,
        rng:makeRng(`practice:${side}:${b.turn}`), trace});
      const parts = choice.split(',').map((x,slot) => {
        const part = x.trim(), m = /^move ([^ ]+)(.*)$/.exec(part);
        if (!m || /^\d+$/.test(m[1])) return part;
        const i = req.active[slot]?.moves.findIndex(move => move.id === m[1]);
        return i >= 0 ? `move ${i + 1}${m[2]}` : part;
      });
      const slots = (trace.slots || []).map(slot => {
        const actual = slot.options.find(o => o.choice === parts[slot.slot]);
        const recommended = slot.options.find(o => o.choice === trace.choice.split(',')[slot.slot]?.trim());
        if (!actual || !recommended || !Number.isFinite(actual.score) || !Number.isFinite(recommended.score)) return null;
        const describe = o => ({choice:o.choice, kind:o.kind, name:o.name || o.species || o.choice,
          score:o.score, damage:o.dmg ?? null, ko:o.ko ?? null, gimmick:o.gimmick || '', target:o.target || ''});
        return {mon:slot.mon, hp:slot.hp, actual:describe(actual), recommended:describe(recommended)};
      });
      if (trace.belief_error || trace.error || !slots.length || slots.some(s => !s)) { skipped++; }
      else {
        analysed++;
        const gap = slots.reduce((n,s) => n + s.recommended.score - s.actual.score, 0) / slots.length;
        if (trace.choice !== parts.join(', ') && gap >= minGap) suggestions.push({id:`${side}:${b.turn}`, turn:b.turn, side,
          actual:choice, recommended:trace.choice, heuristic_gap:Math.round(gap * 1000) / 1000, slots,
          criterion:'expert_balanced_hidden', reason:slots.some(s=>s.recommended.kind === 'switch') ? 'switch' :
            slots.some(s=>s.recommended.ko > s.actual.ko) ? 'knockout' :
            slots.some(s=>s.recommended.damage > s.actual.damage) ? 'damage' : 'tactical'});
      }
    }
    if (!b.choose(id, choice)) throw new EngineError('invalid', 'A recorded decision cannot be replayed.');
  }
  suggestions.sort((a,b) => b.heuristic_gap - a.heuristic_gap || a.turn - b.turn);
  return {side, start_turn:startTurn, end_turn:startTurn + turnCount - 1, next_turn:nextTurn,
    analysed, skipped, suggestions, criterion:'expert_balanced_hidden', hidden:true};
}
