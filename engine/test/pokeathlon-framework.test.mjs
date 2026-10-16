// The Pokéathlon's rules around the events: ranks and event points from raw scores, the counters of each Pokémon, the closing ceremony's
// bonuses (Challenge, No-Miss, Points Leader, Prize for Effort), the winner and the tie draw, the medals, the rival teams a course draws,
// the body saved on the server and the registry of the ten events.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COURSES, Course, EVENT_META, EVENT_ORDER, MASTER_SETS, MEDAL_BITS, challengeBonus, drawNpcTeams, emptyCounters, eventPoints, eventsOfCourse,
  formatScore, normCounters, randomTeam, rankOf, savePayload, starTotal,
} from '../../client/src/pokeathlon/course.js';
import {makeRng, hashSeed} from '../../client/src/pokeathlon/core.js';
import {EVENTS, EVENT_IDS} from '../../client/src/pokeathlon/events/index.js';

const STATS = ['speed', 'power', 'skill', 'stamina', 'jump'];
const stars = (n) => Object.fromEntries(STATS.map((k) => [k, n]));
const mon = (n, i = 0, base = n) => ({species: 'Pikachu', num: 25, form: '', name: `M${i}`, stars: stars(n), base: stars(base), derived: false});
const team = (index, n, base = n, human = false) => ({index, name: `T${index}`, color: '#fff', human, cpu: 0, mons: [mon(n, 0, base), mon(n, 1, base), mon(n, 2, base)]});
const four = (levels = [3, 3, 3, 3]) => levels.map((n, i) => team(i, n, n, i === 0));
const counters = (per = {}) => Object.fromEntries(Object.entries(per));
const detailWith = (spec) => [0, 1, 2, 3].map((t) => ({mons: [0, 1, 2].map((s) => (spec[`${t}.${s}`] || {}))}));

test('the ten events keep the order of the game and the targets the records compare with', () => {
  assert.deepEqual(EVENT_ORDER, ['hurdle_dash', 'pennant_capture', 'circle_push', 'block_smash', 'disc_catch', 'lamp_jump', 'relay_run', 'ring_drop', 'snow_throw', 'goal_roll']);
  assert.deepEqual(EVENT_IDS, EVENT_ORDER);
  assert.deepEqual(EVENT_ORDER.map((id) => EVENT_META[id].target), [3000, 35, 40, 80, 40, 350, 12288, 70, 30, 3]);
  assert.deepEqual(EVENT_ORDER.map((id) => EVENT_META[id].trophy), [2400, 50, 60, 130, 70, 500, 16384, 100, 55, 9]);
  assert.deepEqual(EVENT_ORDER.filter((id) => EVENT_META[id].lowerIsBetter), ['hurdle_dash']);
});

test('every event module follows the contract and has its official Spanish name', () => {
  const es = {hurdle_dash: 'Saltaobstáculos', pennant_capture: 'Atrapabanderas', circle_push: 'Pisacírculos', block_smash: 'Rompelosas', disc_catch: 'Atrapadiscos',
    lamp_jump: 'Botaluces', relay_run: 'Carrera de relevos', ring_drop: 'Fuera del ring', snow_throw: 'Nieve cruzada', goal_roll: 'Metegoles'};
  for (const id of EVENT_ORDER) {
    const mod = EVENTS[id];
    assert.equal(mod.id, id);
    assert.equal(mod.names.es, es[id]);
    assert.ok(mod.names.en);
    assert.ok(Array.isArray(mod.stats) && mod.stats.length >= 2 && mod.stats.every((k) => STATS.includes(k)), id);
    assert.ok(Number(mod.seconds) > 0, id);
    assert.ok(mod.help && mod.help.es && mod.help.en, id);
    assert.equal(typeof mod.create, 'function', id);
  }
});

test('ranks are competition ranks from zero and equal scores keep the lower team first', () => {
  assert.deepEqual(rankOf([20, 20, 15, 10]), [0, 0, 2, 3]);
  assert.deepEqual(rankOf([5, 9, 9, 1]), [2, 0, 0, 3]);
  assert.deepEqual(rankOf([3000, 2400, 3000, 2500], true), [2, 0, 2, 1]);
});

test('event points are the game\'s conversions, capped at 200', () => {
  assert.deepEqual(eventPoints('hurdle_dash', [3000, 1725, 1000, 6000]), [115, 200, 200, 57]);
  assert.deepEqual(eventPoints('pennant_capture', [35, 70, 0, 10]), [105, 200, 0, 30]);
  assert.deepEqual(eventPoints('circle_push', [40, 3, 1, 90]), [120, 9, 3, 200]);
  assert.deepEqual(eventPoints('block_smash', [80, 250, 0, 12]), [80, 200, 0, 12]);
  assert.deepEqual(eventPoints('disc_catch', [0, 40, 1000, 5]), [30, 121, 148, 64]);
  assert.deepEqual(eventPoints('lamp_jump', [350, 700, 0, 35]), [100, 200, 0, 10]);
  assert.deepEqual(eventPoints('relay_run', [12 * 1024, 12 * 1024 + 512, 30 * 1024, 0]), [120, 125, 200, 0]);
  assert.deepEqual(eventPoints('ring_drop', [70, 200, 1, 0]), [105, 200, 1, 0]);
  assert.deepEqual(eventPoints('snow_throw', [30, 0, 80, 1]), [90, 0, 200, 3]);
});

test('goal roll pays the place and tied teams share the lowest place of their tie', () => {
  assert.deepEqual(eventPoints('goal_roll', [3, 1, 2, 0]), [115, 75, 90, 60]);
  assert.deepEqual(eventPoints('goal_roll', [3, 3, 1, 0]), [95, 95, 75, 60]);
  assert.deepEqual(eventPoints('goal_roll', [2, 2, 2, 2]), [70, 70, 70, 70]);
  assert.deepEqual(eventPoints('goal_roll', [99, 0, 0, 0]), [200, 60, 60, 60]);
});

test('scores are shown as the person reads them', () => {
  assert.equal(formatScore('hurdle_dash', 3000), '1:40.0');
  assert.equal(formatScore('hurdle_dash', 45), '0:01.5');
  assert.equal(formatScore('relay_run', 12 * 1024 + 512), '12.5');
  assert.equal(formatScore('block_smash', 81.4), '81');
});

test('the Challenge Bonus is 75 minus the base stars of the team, whatever stars it plays with', () => {
  assert.equal(challengeBonus(team(0, 1)), 60);
  assert.equal(challengeBonus(team(0, 3)), 30);
  assert.equal(challengeBonus(team(0, 5)), 0);
  assert.equal(challengeBonus(team(0, 5, 1)), 60, 'raised stars do not change it: the base ones count');
  assert.equal(starTotal(team(0, 5, 1)), 75);
});

test('a Pokémon\'s counters accept the names the events use and cap at 9999', () => {
  assert.deepEqual(normCounters({fellDown: 3, hits: 2, selfImpeded: 1, score: 4, dashes: 5, fails: 6}), {failed: 6, jumped: 0, points: 4, hit: 2, fell: 3, dashed: 5, switched: 0, impeded: 1});
  assert.deepEqual(normCounters(null), emptyCounters());
  assert.equal(normCounters({failed: 1e9}).failed, 9999);
  assert.equal(normCounters({failed: -3}).failed, 0);
});

function finishedCourse(spec, raws = [[1700, 3600, 3600, 3600], [60, 5, 5, 5], [8192, 1024, 1024, 1024]], teams = four()) {
  const course = new Course({key: 'speed', events: ['hurdle_dash', 'pennant_capture', 'relay_run'], teams, seed: 1, medal: 'speed'});
  raws.forEach((raw, i) => course.record(course.events[i], {raw, detail: detailWith(i === 0 ? spec : {})}));
  return course;
}

test('a course adds up the event points and the counters of every round', () => {
  const c = finishedCourse({'0.0': {jumped: 3, fell: 1}});
  assert.deepEqual(c.rounds.map((r) => r.points[0]), [200, 180, 80]);
  assert.deepEqual(c.totals(), [460, 120, 120, 120]);
  assert.deepEqual(c.rounds[0].ranks, [0, 1, 1, 1]);
  assert.equal(c.mons[0][0].jumped, 3);
  assert.equal(c.mons[0][0].fell, 1);
});

test('No-Miss: ten points per Pokémon that never failed, fell or hit itself', () => {
  const c = finishedCourse({'0.0': {failed: 1}, '1.2': {fell: 2}, '3.1': {impeded: 1}});
  const b = c.closing(makeRng(1)).bonus;
  assert.deepEqual(b.noMiss, [20, 20, 30, 20]);
  assert.equal(b.noMissMons.length, 9);
});

test('Points Leader: twenty per Pokémon with the most points, and nobody leads when nobody scored', () => {
  assert.deepEqual(finishedCourse({}).closing(makeRng(1)).bonus.leader, [0, 0, 0, 0]);
  const b = finishedCourse({'0.0': {points: 9}, '2.1': {points: 9}, '1.0': {points: 4}}).closing(makeRng(1)).bonus;
  assert.deepEqual(b.leader, [20, 0, 20, 0]);
});

test('Prize for Effort: ten per Pokémon with the most of one statistic, the next one when the drawn one is empty', () => {
  const b = finishedCourse({'0.0': {hit: 4}, '1.1': {hit: 4}, '2.0': {dashed: 9}}).closing(makeRng(5)).bonus;
  assert.ok([1, 3].includes(b.effortKind));
  assert.deepEqual(b.effort, b.effortKind === 1 ? [10, 10, 0, 0] : [0, 0, 10, 0]);
  const none = finishedCourse({}).closing(makeRng(5)).bonus;
  assert.equal(none.effortKind, -1);
  assert.deepEqual(none.effort, [0, 0, 0, 0]);
});

test('the closing adds the bonuses to the event points, names the winner and gives the course\'s medal', () => {
  const c = finishedCourse({'0.0': {points: 5}});
  const end = c.closing(makeRng(2));
  assert.deepEqual(end.bonus.challenge, [30, 30, 30, 30]);
  assert.equal(end.bonus.effortKind, -1, 'nobody jumped, hit, failed or dashed');
  assert.deepEqual(end.totals, [460 + 30 + 30 + 20, 180, 180, 180]);
  assert.equal(end.winner, 0);
  assert.deepEqual(end.place, [0, 1, 1, 1]);
  assert.equal(end.tie, false);
  assert.deepEqual(end.medal, {stat: 'speed', mask: MEDAL_BITS.speed, team: 0});
});

test('a tie for first place is drawn by lots among the tied teams only', () => {
  const equal = finishedCourse({}, [[3000, 3000, 3000, 3000], [10, 10, 10, 10], [4096, 4096, 4096, 4096]]);
  const winners = new Set();
  for (let seed = 1; seed <= 40; seed++) {
    const end = new Course({key: 'speed', events: equal.events, teams: equal.teams, seed: 1, medal: 'speed'});
    equal.rounds.forEach((r, i) => end.record(equal.events[i], {raw: r.raw, detail: detailWith({})}));
    const closing = end.closing(makeRng(seed));
    assert.equal(closing.tie, true);
    assert.equal(closing.place.filter((p) => p === 0).length, 1);
    assert.equal(closing.place[closing.winner], 0);
    assert.equal(closing.place.filter((p) => p === 1).length, 3);
    winners.add(closing.winner);
  }
  assert.ok(winners.size >= 3, 'every tied team can win the draw');
});

test('the supreme course has no medal and the single event no ceremony', () => {
  const sup = COURSES.find((c) => c.key === 'supreme');
  assert.equal(sup.medal, '');
  assert.equal(MASTER_SETS.length, 10);
  assert.ok(MASTER_SETS.every((s) => s.length === 4 && new Set(s).size === 4));
  const sets = MASTER_SETS.map((s) => s.join());
  const rng = makeRng(3);
  assert.ok(sets.includes(eventsOfCourse(sup, rng).join()));
  assert.deepEqual(eventsOfCourse(COURSES[0], rng), ['hurdle_dash', 'pennant_capture', 'relay_run']);
  assert.deepEqual(COURSES.slice(0, 5).map((c) => c.events.length), [3, 3, 3, 3, 3]);
  assert.deepEqual(COURSES.slice(0, 5).map((c) => c.medal), ['speed', 'power', 'skill', 'stamina', 'jump']);
});

test('a course draws its three rivals from five teams, the supreme course from twenty-five, +50 when supreme', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const a = drawNpcTeams(1, false, 3, makeRng(seed));
    assert.equal(new Set(a).size, 3);
    assert.ok(a.every((n) => n >= 6 && n <= 10), a.join());
    const b = drawNpcTeams(1, true, 3, makeRng(seed));
    assert.deepEqual(b, a.map((n) => n + 50));
    const c = drawNpcTeams(10, true, 3, makeRng(seed));
    assert.ok(c.every((n) => n >= 76 && n <= 100) && new Set(c).size === 3, c.join());
  }
  assert.deepEqual(drawNpcTeams(0, false, 3, makeRng(9)), drawNpcTeams(0, false, 3, makeRng(9)));
});

test('the seed gives the same randomness each time', () => {
  const a = makeRng(hashSeed('speed', 1));
  const b = makeRng(hashSeed('speed', 1));
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
  assert.notEqual(hashSeed('speed', 1), hashSeed('speed', 2));
});

test('the body saved on the server carries the course, the raw scores, the counters and the bonuses', () => {
  const c = finishedCourse({'0.0': {points: 5, hit: 2}});
  const end = c.closing(makeRng(2));
  const body = savePayload(c, end, {mode: 'play', trainerId: 't1', lang: 'es'});
  assert.equal(body.course, 'speed');
  assert.equal(body.mode, 'play');
  assert.equal(body.trainer_id, 't1');
  assert.equal(body.teams.length, 4);
  assert.equal(body.teams[0].human, true);
  assert.equal(body.teams[0].mons[0].base.speed, 3);
  assert.deepEqual(body.rounds.map((r) => r.event), ['hurdle_dash', 'pennant_capture', 'relay_run']);
  assert.deepEqual(body.rounds[0].raw, [1700, 3600, 3600, 3600]);
  assert.equal(body.rounds[0].counters[0][0].points, 5);
  assert.deepEqual(body.bonuses.challenge, end.bonus.challenge);
  assert.deepEqual(body.bonuses.points_leader, end.bonus.leader);
  assert.equal(body.winner, end.winner);
  assert.deepEqual(body.place, end.place);
  // a single event has no ceremony
  const single = new Course({key: 'single', events: ['block_smash'], teams: four(), seed: 1});
  single.record('block_smash', {raw: [90, 40, 30, 20], detail: detailWith({})});
  const sbody = savePayload(single, null, {mode: 'play'});
  assert.equal(sbody.course, 'single');
  assert.equal(sbody.bonuses, null);
  assert.equal(sbody.winner, 0);
  assert.deepEqual(sbody.place, [0, 1, 2, 3]);
});

test('random rival teams draw three different species and never a cosmetic forme, a Gigantamax or a Totem', () => {
  const row = (name, extra = {}) => ({name, baseSpecies: name.split('-')[0], num: 1, forme: '', stars: Object.fromEntries(STATS.map((k) => [k, {base: 3, min: 1, max: 4}])), ...extra});
  const rows = [row('Aipom'), row('Bellsprout'), row('Cubone'), row('Dratini'), row('Unown-B', {noRandom: true}), row('Pikachu-Gmax', {noRandom: true, forme: 'Gmax'})];
  for (let seed = 1; seed <= 60; seed++) {
    const t = randomTeam(rows, makeRng(seed), {index: 1, name: 'R', color: '#fff'});
    assert.equal(t.mons.length, 3);
    assert.equal(new Set(t.mons.map((m) => m.species)).size, 3);
    assert.ok(t.mons.every((m) => !m.species.includes('Unown') && !m.species.includes('Gmax')), t.mons.map((m) => m.species).join());
    assert.equal(t.mons[0].stars.speed, 3);
  }
});
