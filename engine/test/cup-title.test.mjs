import test from 'node:test';
import assert from 'node:assert/strict';
import {battleTitle} from '../../client/src/loc.js';

test('a cup battle title follows its generated cup title and seat names', () => {
  const battle = {title:'Cup: 2 trainers · You vs Rival',
    p1:{name:'You',i18n:{es:{name:'Tú'}}},p2:{name:'Rival'},
    cup:{title:'Cup: 2 trainers',i18n:{es:{title:'Copa: 2 entrenadores'},en:{title:'Cup: 2 trainers'}}}};
  assert.equal(battleTitle(battle,'es'),'Copa: 2 entrenadores · Tú vs Rival');
  assert.equal(battleTitle(battle,'en'),'Cup: 2 trainers · You vs Rival');
});

test('personal cup title stays literal in a battle even when it resembles an old default', () => {
  const battle = {title:'Copa de 2 · You vs Rival',p1:{name:'You'},p2:{name:'Rival'},cup:{title:'Copa de 2'}};
  assert.equal(battleTitle(battle,'es'),battle.title);
  assert.equal(battleTitle(battle,'en'),battle.title);
});
