// The trainers' names a battle shows in the reader's language: the log's |player| and |win| lines and the battle's title and winner.
import test from 'node:test';
import assert from 'node:assert/strict';
import {applyLine, newState, renameLine} from '../../client/src/battle/protocol.js';
import {battleTitle, loc, seatNames, winnerName} from '../../client/src/loc.js';

const seat = (name, en) => ({trainer_id: 'tr_x', name, i18n: en ? {es: {name}, en: {name: en}} : undefined});
const geeta = 'Ságita (Escarlata y Púrpura · Combates en Paldea)';
const battle = {p1: seat('Luis'), p2: seat(geeta, 'Geeta (Scarlet and Violet · Paldea battles)'), winner_side: 'p2',
  winner_name: geeta.slice(0, 40), title: `Copa · Luis vs ${geeta}`};

test('the log says the seat names in the reader\'s language, even cut to 40 characters', () => {
  const names = seatNames(battle, 'en');
  assert.equal(renameLine(`|player|p2|${geeta.slice(0, 40)}|sd:geeta|`, names), '|player|p2|Geeta (Scarlet and Violet · Paldea battles)|sd:geeta|');
  assert.equal(renameLine(`|win|${geeta.slice(0, 40)}`, names), '|win|Geeta (Scarlet and Violet · Paldea battles)');
  assert.equal(renameLine('|player|p1|Luis|', names), '|player|p1|Luis|');
  // another name on that side (a typed one), short prefixes and other lines stay as they are
  assert.equal(renameLine('|player|p2|Otra|', names), '|player|p2|Otra|');
  assert.equal(renameLine('|player|p2|Ságita|', names), '|player|p2|Ságita|');
  assert.equal(renameLine('|move|p2a: Gogoat|Leech Seed|p1a: Rotom', names), '|move|p2a: Gogoat|Leech Seed|p1a: Rotom');
  const st = newState();
  applyLine(st, `|player|p2|${geeta.slice(0, 40)}|`, {lang: 'en', names});
  const out = applyLine(st, `|win|${geeta.slice(0, 40)}`, {lang: 'en', names});
  assert.equal(st.sides.p2.name, 'Geeta (Scarlet and Violet · Paldea battles)');
  assert.equal(st.winner, st.sides.p2.name);
  assert.match(out.text, /^Geeta \(Scarlet and Violet · Paldea battles\) won/);
});

test('title, winner and names without a translation', () => {
  assert.equal(battleTitle(battle, 'en'), 'Copa · Luis vs Geeta (Scarlet and Violet · Paldea battles)');
  assert.equal(battleTitle({...battle, title: ''}, 'es'), `Luis vs ${geeta}`);
  assert.equal(winnerName(battle, 'en'), 'Geeta (Scarlet and Violet · Paldea battles)');
  assert.equal(winnerName({...battle, winner_side: 'p1'}, 'en'), geeta.slice(0, 40));
  assert.equal(winnerName({winner_name: 'Alguien'}, 'en'), 'Alguien');
  assert.equal(loc(battle.p1, 'en'), 'Luis');
  assert.equal(seatNames(null, 'en'), null);
  // a facility battle: the facility's name and the rival's
  const facility = {p1: seat('Luis'), p2: {trainer_id: '', name: 'Entrenadora Guay Nora', i18n: {es: {name: 'Entrenadora Guay Nora'}, en: {name: 'Ace Trainer Nora'}}},
    title: 'Metro Batalla: trenes individuales · 11 · Entrenadora Guay Nora',
    run: {target_name: 'Metro Batalla: trenes individuales', i18n: {en: {target_name: 'Battle Subway: Single Trains'}}}};
  assert.equal(battleTitle(facility, 'en'), 'Battle Subway: Single Trains · 11 · Ace Trainer Nora');
  assert.equal(battleTitle(facility, 'es'), facility.title);
});
