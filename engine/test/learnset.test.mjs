import test from 'node:test';
import assert from 'node:assert/strict';
import {dexSearch, isNatDexFormat, learnableMoves, speciesInfo} from '../src/core.mjs';

const moveIds = (species, format = '') => dexSearch('moves', '', {gen: 9, limit: 1000, species, format}).map((m) => m.id);

test('a Pokémon missing from the generation\'s Pokédex still only gets the moves it can learn', () => {
  // Scolipede is not in Scarlet and Violet: its gen 9 movepool is empty, which used to list every move in the game.
  const ids = moveIds('Scolipede');
  assert.ok(ids.length > 30 && ids.length < 150, `got ${ids.length} moves`);
  assert.ok(ids.includes('megahorn') && ids.includes('swordsdance'));
  assert.ok(!ids.includes('judgment') && !ids.includes('spore'));
});

test('National Dex formats add the moves the line learned in earlier games', () => {
  assert.ok(isNatDexFormat('gen9nationaldexag') && isNatDexFormat('[Gen 9] National Dex') && !isNatDexFormat('gen9ou'));
  const sv = new Set(moveIds('Tyranitar', 'gen9ou'));
  const nd = new Set(moveIds('Tyranitar', 'gen9nationaldexag'));
  assert.ok(nd.size > sv.size);
  assert.ok(!sv.has('pursuit') && nd.has('pursuit'));
  for (const id of sv) assert.ok(nd.has(id), `${id} missing from the National Dex pool`);
  assert.ok(!nd.has('judgment'));
});

test('an unknown Pokémon has no movepool and species_info follows the format', () => {
  assert.equal(learnableMoves('Notamon', 9), null);
  const info = speciesInfo('Scolipede', 9, 'gen9nationaldexag');
  assert.ok(info.moves.some((m) => m.id === 'megahorn') && !info.moves.some((m) => m.id === 'judgment'));
});
