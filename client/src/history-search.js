import names from './battle/names-es.js';
import {turnMarks} from './battle/protocol.js';

const norm = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const spanishMoves = new Map(Object.entries(names.moves).map(([id,label])=>[norm(label),id]));
const position = value => typeof value === 'string' && /^\d+$/.test(value) && Number(value)<=1_000_000 ? Number(value) : null;

export function canonicalMoveFilter(value) {
  const text=String(value || '').trim();
  return spanishMoves.get(norm(text)) || text;
}
export function replayPosition(query, mode) {
  const key=mode==='realtime' ? 'tick' : 'turn';
  const at=position(query?.get(key));
  return at===null ? null : {[key]:at};
}
export function classicSeekIndex(lines, turn) {
  const marks=turnMarks(lines);
  if(turn===0) return marks[0]?.index ?? 0;
  const mark=marks.find(m=>m.turn===turn);
  return mark ? mark.index+1 : null;
}
export function replaySearchHref(id, mode, match={}) {
  const key=mode==='realtime' ? 'tick' : 'turn';
  const at=match[key];
  const valid=Number.isInteger(at) && at>=0 && at<=1_000_000;
  return `#/combate/${encodeURIComponent(id)}${valid ? `?${key}=${at}` : ''}`;
}
