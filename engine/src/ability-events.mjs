// Public activation messages only: an equipped ability, a move or a suppressed ability is not an activation.
export const abilityBoundary = line => /^\|(move|switch|drag|turn|upkeep)\|/.test(line);

export function protocolAbility(line) {
  const p = String(line || '').split('|').slice(1), cmd = p[0];
  if (!cmd?.startsWith('-') || cmd === '-endability' || p.includes('[silent]')) return null;
  const from = p.find(x=>x.startsWith('[from] ability: '));
  let ability = '', ident = p[1];
  if (cmd === '-ability') {
    if (p.some(x=>x.startsWith('[from] move: '))) return null;
    ability = from ? from.slice(16) : p[2];
  } else if (cmd === '-activate' && p[2]?.startsWith('ability: ')) ability = p[2].slice(9);
  else if (from) {
    ability = from.slice(16);
    const of = p.find(x=>x.startsWith('[of] '));
    if (of) ident = of.slice(5);
  }
  // A fainted Pokémon's ability may still act (Aftermath); keep the identity from the event.
  const m = /^(p[12])([a-z])?: (.+)$/.exec(ident || '');
  return ability && m ? {side:m[1], slot:Math.max(0,(m[2] || 'a').charCodeAt(0)-97), pokemon:m[3], ability} : null;
}

export function protocolAbilities(lines) {
  const activations = [], seen = new Set();
  let turn = 0;
  (lines || []).forEach((line,index)=>{
    if (abilityBoundary(line)) seen.clear();
    if (line.startsWith('|turn|')) turn=Number(line.split('|')[2]) || turn;
    const e = protocolAbility(line);
    if (!e) return;
    const key = `${e.side}:${e.slot}:${e.pokemon}:${e.ability}`;
    if (!seen.has(key)) activations.push({id:index, line:index, turn, ...e});
    seen.add(key);
  });
  return activations;
}

export function realtimeAbility(e, battle, activeSlot) {
  if (e.k !== 'ability' || !e.id || !battle.dex.abilities.get(e.id).exists) return null;
  const side = battle.doubles ? battle.sides[e.s]?.units[e.u || 0] : battle.sides[e.s];
  const m = side?.mons[e.slot ?? activeSlot ?? side.active];
  return {side:`p${e.s + 1}`, slot:e.u || 0, pokemon:e.pokemon || m?.name || '?',
    ability:battle.dex.abilities.get(e.id).name, tick:e.t};
}

export function realtimeAbilities(battle) {
  const activations = [], seen = new Set(), slots = new Map();
  battle.events.forEach((e,index)=>{
    const unit = `${e.s}:${e.u || 0}`;
    if (e.k === 'switch') slots.set(unit,e.slot);
    const a = realtimeAbility(e,battle,slots.get(unit));
    if (!a) return;
    const key = `${a.tick}:${a.side}:${a.slot}:${a.pokemon}:${a.ability}`;
    if (!seen.has(key)) activations.push({id:index,...a});
    seen.add(key);
  });
  return activations;
}
