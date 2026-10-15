// The trainers in real time: the same five levels and five styles as in the turn-based battles, turned into reflexes. Each tick
// the AI of a seat returns the same input a person gives (move the Pokémon, use a move, roll, switch). Levels change how fast
// it reacts, how often it dodges and how well it picks moves and switches; styles weigh damage, setup, status, protection and
// recovery like the turn-based AI does. It only reads the battle; its randomness comes from the seat's own generator, so a
// battle with the same seed plays the same way again.
import {TPS} from './moves.mjs';

const LEVELS = {
  random: {react: 0.9, dodge: 0, aim: 0, switching: false, spread: 1},
  easy: {react: 0.75, dodge: 0.08, aim: 0.3, switching: false, spread: 0.5},
  normal: {react: 0.45, dodge: 0.3, aim: 0.6, switching: false, spread: 0.2},
  hard: {react: 0.25, dodge: 0.6, aim: 0.85, switching: true, spread: 0.05},
  expert: {react: 0.15, dodge: 0.85, aim: 1, switching: true, spread: 0},
  master: {react: 0.15, dodge: 0.85, aim: 1, switching: true, spread: 0},     // the turn-based search has no real-time form
  neural: {react: 0.15, dodge: 0.85, aim: 1, switching: true, spread: 0},     // nor the turn-based policy
};
const STYLES = {
  balanced: {damage: 1, setup: 1, status: 1, protect: 1, heal: 1, range: 1},
  aggressive: {damage: 1.35, setup: 0.7, status: 0.5, protect: 0.4, heal: 0.6, range: 0.75},
  defensive: {damage: 0.9, setup: 0.8, status: 1.2, protect: 1.8, heal: 1.6, range: 1.3},
  setup: {damage: 1, setup: 2.2, status: 0.8, protect: 1, heal: 1, range: 1.1},
  stall: {damage: 0.75, setup: 0.8, status: 1.9, protect: 1.6, heal: 1.8, range: 1.25},
};

// Math.sqrt is exact in every JavaScript engine (Math.hypot is not), so battles replay the same in Node and in browsers.
const hyp = (x, y) => Math.sqrt(x * x + y * y);
const dist = (a, b) => hyp(a.x - b.x, a.y - b.y);
const norm = (x, y) => { const l = hyp(x, y); return l > 1e-9 ? {x: x / l, y: y / l} : {x: 0, y: 0}; };

const RANGED = new Set(['shot', 'beam', 'wave', 'cone']);
const ULT_SLOT = 9;   // sim.mjs ULT_SLOT: the input that unleashes the ultimate (rules version 5)
const SUPPORT = new Set(['helpinghand', 'followme', 'ragepowder']);   // doubles support moves (sim.mjs DOUBLES_MOVES)
const SPREAD = 0.75;
const ALLY_GAP = 4.2;   // doubles: keep this far from the partner, out of the reach of its quakes

/** Doubles: what a spread move is worth. The aimed foe, the other foe when it stands close enough to be caught too (x0.75 each
 * when both are), minus what a move that hits everything around would do to the partner nearby. */
function spreadValue(b, side, foe, p, v) {
  let total = Math.min(1, v);
  let n = 1;
  const other = b.foesOf(side).find((f) => f !== foe);
  if (other && b.onField(other)) {
    const near = p.shape === 'burst' ? dist(side, other) <= p.radius + 1.5 || dist(foe, other) <= p.radius
      : dist(foe, other) <= (p.shape === 'drop' ? p.radius * 1.5 : 2.5);
    const o = near ? expectedDamage(b, side, other, p) : 0;
    if (o > 0) { total += Math.min(1, o); n++; }
  }
  if (n > 1) total *= SPREAD;
  const ally = b.allyOf(side);
  if (p.target === 'allAdjacent' && ally && b.onField(ally) && dist(side, ally) <= p.radius + 2) {
    total -= 1.3 * Math.min(1, expectedDamage(b, side, ally, p) * SPREAD);
  }
  return total;
}

/** Doubles: which foe slot to lock on. Damage it can take, how much it threatens this Pokémon or its partner, how close it is.
 * A person's partner keeps the person's locked foe unless the other one is clearly better. */
function chooseAim(b, side, c, rng, opts) {
  const foes = b.foesOf(side);
  const on = foes.filter((f) => b.onField(f));
  if (on.length < 2) { if (on.length) side.aim = on[0].pos; return; }
  if (c.level === 'random') { side.aim = rng() < 0.5 ? 0 : 1; return; }
  const me = b.mon(side);
  const ally = b.allyOf(side);
  const score = foes.map((f) => {
    let give = 0;
    for (let i = 0; i < me.profiles.length; i++) if (!b.usable(side, i) || me.cds[i] < TPS) give = Math.max(give, expectedDamage(b, side, f, me.profiles[i]));
    let threat = 0;
    for (const p of b.mon(f).profiles) {
      if (p.category === 'Status') continue;
      for (const t of [side, ally]) {
        if (!t || !b.onField(t)) continue;
        const r = b.damage(f, t, p, {expected: true});
        if (!r.immune) threat = Math.max(threat, (r.dmg * p.hits) / Math.max(1, b.mon(t).hp));
      }
    }
    const busy = f.act && f.act.kind === 'windup' ? 0.1 : 0;
    return Math.min(1.6, give >= 1 ? 1.6 : give) + 0.35 * Math.min(1.5, threat) + busy - dist(side, f) * 0.02;
  });
  let pick = score[1] > score[0] ? 1 : 0;
  if (opts.lead) {
    const want = opts.lead.trainer.tgt || 0;
    if (score[want] * 1.5 + 0.2 >= score[pick]) pick = want;
  }
  side.aim = pick;
}

function cfg(side) {
  if (side.ai?.level === 'dummy') return {lv: LEVELS.easy, st: STYLES.balanced, level: 'easy'};   // a dummy that fights back
  return {lv: LEVELS[side.ai?.level] || LEVELS.normal, st: STYLES[side.ai?.style] || STYLES.balanced, level: side.ai?.level || 'normal'};
}

/** Expected fraction of the target's current HP a move takes off (0 for status moves), with immunities and absorbing abilities. */
export function expectedDamage(b, att, def, p) {
  if (p.category === 'Status') return 0;
  const r = b.damage(att, def, p, {expected: true});
  if (r.immune) return 0;
  const dm = b.mon(def);
  return Math.min(1.5, (r.dmg * p.hits) / Math.max(1, dm.hp));
}

/** How a Pokémon of a side would fare against the foe's active one: best damage it deals and best it takes, as HP fractions. */
function matchup(b, side, slot) {
  const foe = b.foe(side);
  if (!b.onField(foe)) return 0;
  const keep = side.active;
  side.active = slot;
  let give = 0;
  let take = 0;
  try {
    const me = side.mons[slot];
    for (const p of me.profiles) give = Math.max(give, expectedDamage(b, side, foe, p));
    for (const p of b.mon(foe).profiles) {
      if (p.category === 'Status') continue;
      const r = b.damage(foe, side, p, {expected: true});
      if (!r.immune) take = Math.max(take, (r.dmg * p.hits) / Math.max(1, me.hp));
    }
  } finally {
    side.active = keep;
  }
  return give - take;
}

function bestSlot(b, side, rng, smart) {
  const options = b.doubles ? b.bench(side) : side.mons.filter((m) => !m.fainted && m.slot !== side.active);
  if (!options.length) return -1;
  if (!smart) return options[Math.floor(rng() * options.length)].slot;
  let best = options[0].slot;
  let score = -Infinity;
  for (const m of options) {
    const s = matchup(b, side, m.slot) + (m.hp / m.maxhp) * 0.3;
    if (s > score) { score = s; best = m.slot; }
  }
  return best;
}

/** Will something hit me soon? A projectile on its way, a strike or blast winding up in reach, a mark under my feet. */
function danger(b, side) {
  const foe = b.foe(side);
  const r = b.radius(side);
  for (const pr of b.projectiles) {
    if (pr.s === side.index) continue;
    const rx = side.x - pr.x, ry = side.y - pr.y;
    const v = hyp(pr.vx, pr.vy);
    const along = (rx * pr.vx + ry * pr.vy) / Math.max(1e-6, v);
    if (along < 0 || along > v * 0.45) continue;
    const perp = Math.abs(rx * pr.vy - ry * pr.vx) / Math.max(1e-6, v);
    if (perp <= pr.r + r + 0.1) return {dir: norm(-pr.vy, pr.vx), soon: along / v};
  }
  for (const mk of b.marks) {
    if (mk.s === side.index) continue;
    if (dist(mk, side) <= mk.r + r && mk.at - b.t <= 0.5 * TPS) return {dir: norm(side.x - mk.x || 1, side.y - mk.y), soon: (mk.at - b.t) / TPS};
  }
  // doubles: either foe winding up a strike, cone, burst or dash in reach, and the partner about to set off a quake around itself
  const threats = b.doubles ? [foe, ...b.foesOf(side).filter((f) => f !== foe)] : [foe];
  for (const f of threats) {
    if (b.onField(f) && f.act && (f.act.kind === 'windup' || f.act.kind === 'dash')) {
      const p = b.mon(f).profiles[f.act.slot];
      if (p && ['strike', 'cone', 'burst', 'dash'].includes(p.shape)) {
        const reach = p.shape === 'dash' ? p.reach + 1 : b.reachFor(f, side, p) + 0.3;
        const left = f.act.kind === 'dash' ? 0 : (f.act.end - b.t) / TPS;
        if (dist(f, side) <= reach && left <= 0.35) {
          const away = norm(side.x - f.x, side.y - f.y);
          return {dir: norm(-away.y + away.x * 0.6, away.x + away.y * 0.6), soon: left};
        }
      }
    }
  }
  const ally = b.doubles ? b.allyOf(side) : null;
  if (ally && b.onField(ally) && ally.act && ally.act.kind === 'windup') {
    const p = b.mon(ally).profiles[ally.act.slot];
    if (p && p.shape === 'burst' && p.target === 'allAdjacent' && p.category !== 'Status' && b.immune(ally, side, p) === '') {
      const left = (ally.act.end - b.t) / TPS;
      if (dist(ally, side) <= p.radius * 1.2 + b.radius(side) + 0.3 && left <= 0.45) return {dir: norm(side.x - ally.x || 1, side.y - ally.y), soon: left, away: true};
    }
  }
  return null;
}

function scoreMove(b, side, slot, c, rng) {
  const me = b.mon(side);
  const foe = b.foe(side);
  const fm = b.mon(foe);
  const p = me.profiles[slot];
  const hpMe = me.hp / me.maxhp;
  const {st} = c;
  if (b.doubles && SUPPORT.has(p.id)) {
    const ally = b.allyOf(side);
    if (!ally || !b.onField(ally)) return 0;
    const am = b.mon(ally);
    if (p.id === 'helpinghand') return ally.act && ally.act.kind !== 'switch' || am.profiles.some((q, i) => q.category !== 'Status' && am.cds[i] < 0.5 * TPS) ? 0.3 : 0.05;
    return am.hp / am.maxhp < 0.45 && hpMe > 0.5 ? 0.45 * st.protect : 0.08;   // Follow Me: draw the attacks from a weak partner
  }
  if (p.noEffect) return 0.01;
  // a projectile, beam or blast that would only hit a rock between the two is worth little while another line is free
  const walled = b.rocks.length && RANGED.has(p.shape) && b.onField(foe) && b.rockOnLine(side, foe, p.radius * 0.4);
  if (p.category !== 'Status') {
    if (!b.onField(foe)) return 0;
    if (foe.vol.protectUntil > b.t && !p.breaksProtect) return 0.02;
    let v = expectedDamage(b, side, foe, p);
    if (walled) v *= 0.05;
    if (b.doubles && b.spreadMove(p)) v = v >= 1 ? 1.6 * (spreadValue(b, side, foe, p, v) / Math.min(1, v)) : spreadValue(b, side, foe, p, v);
    else if (v >= 1) v = 1.6;                              // a knockout
    if (p.recharge) v *= 0.8;
    if (p.selfdestruct) v = hpMe < 0.25 ? v : v * 0.2;
    if (p.recoil) v *= hpMe > 0.4 ? 0.95 : 0.8;
    if (p.selfSwitch) v *= 1.05;
    return v * st.damage;
  }
  const id = p.id;
  const boosted = (k) => me.boosts[k] > 0;
  if (p.stalling || ['protect', 'detect', 'kingsshield', 'spikyshield', 'banefulbunker', 'obstruct', 'silktrap', 'doubleteam'].includes(id)) {
    const threat = foe.act && foe.act.kind === 'windup' && b.mon(foe).profiles[foe.act.slot]?.category !== 'Status';
    return threat ? 0.55 * st.protect : 0.03;
  }
  if (p.heal || ['rest', 'wish', 'moonlight', 'morningsun', 'synthesis', 'shoreup', 'roost', 'recover', 'slackoff', 'softboiled', 'strengthsap'].includes(id)) {
    if (hpMe > 0.7) return 0.02;
    return (1 - hpMe) * 0.9 * st.heal;
  }
  if (p.weather) return b.weather && b.weather.id === p.weather && b.weather.until > b.t ? 0 : 0.3;
  if (p.terrain) return b.terrain && b.terrain.id === p.terrain && b.terrain.until > b.t ? 0 : 0.25;
  if (p.sideCondition) {
    if (['stealthrock', 'spikes', 'toxicspikes', 'stickyweb'].includes(p.sideCondition)) {
      if (foe.hazards[p.sideCondition] && p.sideCondition !== 'spikes') return 0;
      return b.alive(foe).length >= 3 ? 0.35 * st.status : 0.05;
    }
    return side.cond[p.sideCondition] > b.t ? 0 : 0.3 * st.protect;
  }
  if (walled) return 0.01;
  if (p.status) {
    if (!b.onField(foe) || fm.status || b.statusImmune(foe, p.status, side) || b.immune(side, foe, p)) return 0;
    return (p.status === 'slp' ? 0.5 : p.status === 'tox' ? 0.45 : 0.4) * st.status;
  }
  if (p.boosts && (p.target === 'self' || p.shape === 'self')) {
    const keys = Object.keys(p.boosts).filter((k) => p.boosts[k] > 0);
    if (!keys.length) return 0.05;
    const fresh = keys.filter((k) => !boosted(k)).length;
    if (!fresh) return 0.02;
    return (hpMe > 0.55 ? 0.42 : 0.12) * (fresh / keys.length) * st.setup;
  }
  if (p.boosts) {
    const keys = Object.keys(p.boosts);
    const fresh = keys.filter((k) => fm.boosts[k] >= 0).length;
    return b.onField(foe) && fresh ? 0.18 * st.status : 0.01;
  }
  if (id === 'leechseed') return foe.vol.seededBy != null || fm.types.includes('Grass') ? 0 : 0.35 * st.status;
  if (p.volatile === 'confusion') return foe.vol.confusedUntil > b.t ? 0 : 0.2 * st.status;
  if (id === 'substitute') return side.vol.sub > 0 || hpMe < 0.5 ? 0 : 0.25 * st.protect;
  if (id === 'taunt') return 0.12;
  return 0.08 + rng() * 0.05;
}

/** The input of an AI seat for this tick (in doubles, of one slot). `opts.lead`: this slot is a person's partner, following the
 * slot the person controls: it attacks the person's locked foe unless the other is clearly better, stays near, dodges, and
 * leaves switching, Plus moves and Mega Evolution to the person. */
/** The training dummy's patterns: stand still, walk in circles, roll away from what comes at it. "fight" plays as the easy AI. */
function dummy(b, side, pattern) {
  const input = {mx: 0, my: 0, use: -1, dodge: false, sw: -1};
  if (side.need) { input.sw = side.mons.findIndex((m) => !m.fainted); return input; }
  if (pattern === 'walk' && !side.act) {
    const a = (b.t / TPS) * 0.9;
    input.mx = Math.round(Math.cos(a) * 1000) / 1000;
    input.my = Math.round(Math.sin(a) * 1000) / 1000;
  }
  if (pattern === 'dodge' && (!side.act || side.act.kind === 'approach') && b.t >= side.rollReady) {
    const d = danger(b, side);
    if (d) { input.dodge = true; input.mx = d.dir.x; input.my = d.dir.y; }
  }
  return input;
}

export function think(b, side, opts = {}) {
  if (side.ai?.level === 'dummy' && side.ai.pattern !== 'fight') return dummy(b, side, side.ai.pattern || 'still');
  const partner = !!opts.lead;
  const c = partner ? {lv: LEVELS.hard, st: STYLES.balanced, level: 'hard'} : cfg(side);
  const rng = side.aiRng;
  const brain = side.brain;
  const reactTicks = Math.max(1, Math.round(c.lv.react * TPS));
  const input = {mx: 0, my: 0, use: -1, dodge: false, sw: -1};
  let foe = b.foe(side);
  // replacing a fainted Pokémon or coming back from a pivot move
  if (side.need) {
    if (partner || side.vacant) return input;   // the person picks the partner's next Pokémon (or the time runs out)
    if (b.t - side.needSince >= reactTicks) input.sw = bestSlot(b, side, rng, c.lv.switching || c.level === 'normal');
    return input;
  }
  const me = b.mon(side);
  if (!me || me.fainted || side.vacant) return input;
  // Mega Evolution as soon as the gauge allows it (rules version 2)
  if (b.version >= 2 && !partner && b.canMega(side)) input.mega = true;
  // the ultimate (rules version 5): after a reaction delay, with the foe within reach and not rolling away
  if (b.version >= 5 && !partner && b.ultReady(side) && (!side.act || side.act.kind === 'approach')) {
    if (brain.ultSince == null) brain.ultSince = b.t;
    if (b.t - brain.ultSince >= reactTicks && dist(side, foe) <= 14 && !(foe.act && foe.act.kind === 'roll')) {
      brain.ultSince = null;
      input.use = ULT_SLOT;
      return input;
    }
  }
  // dodging is a reflex, checked every tick
  if (!side.act || side.act.kind === 'approach') {
    const d = danger(b, side);
    if (d && b.t >= side.rollReady && brain.dodgeCheck !== b.t) {
      brain.dodgeCheck = b.t;
      if (brain.lastDangerAt == null || b.t - brain.lastDangerAt > reactTicks) {
        brain.lastDangerAt = b.t;
        if (rng() < c.lv.dodge) {
          input.dodge = true;
          input.mx = d.dir.x; input.my = d.dir.y;
          if (rng() < 0.5 && !d.away) { input.mx = -input.mx; input.my = -input.my; }
          return input;
        }
      }
    }
  }
  // decisions every reaction step
  if (brain.next == null || b.t >= brain.next) {
    brain.next = b.t + reactTicks + Math.floor(rng() * reactTicks * 0.5);
    brain.plan = null;
    if (b.doubles) { chooseAim(b, side, c, rng, opts); foe = b.foe(side); }
    if (b.onField(foe) && (!side.act || side.act.kind === 'approach')) {
      // switching out of a bad matchup
      if (!partner && c.lv.switching && side.switchesLeft > 0 && me.hp / me.maxhp > 0.3 && b.t - (brain.lastSwitch || -1e9) > 6 * TPS && b.canSwitch(side, bestSlot(b, side, rng, true))) {
        const now = matchup(b, side, side.active);
        const cand = bestSlot(b, side, rng, true);
        if (cand >= 0 && now < -0.4 && matchup(b, side, cand) > now + 0.45) {
          brain.lastSwitch = b.t;
          input.sw = cand;
          return input;
        }
      }
      // pick a ready move
      const ready = me.profiles.map((p, i) => i).filter((i) => !b.usable(side, i));
      if (ready.length) {
        let pick = -1;
        if (c.level === 'random') pick = ready[Math.floor(rng() * ready.length)];
        else {
          const scored = ready.map((i) => [i, scoreMove(b, side, i, c, rng) * (1 + (rng() - 0.5) * c.lv.spread * 2)]).sort((x, y) => y[1] - x[1]);
          if (scored[0][1] > 0.04) pick = scored[0][0];
          // the AI holds a weak move when a much better one is about to come back
          const soon = me.profiles.map((p, i) => i).filter((i) => me.cds[i] > 0 && me.cds[i] < 0.8 * TPS);
          if (pick >= 0 && soon.length && c.level !== 'easy') {
            const later = Math.max(...soon.map((i) => scoreMove(b, side, i, c, rng)));
            if (later > scored[0][1] * 2 && later > 0.4) pick = -1;
          }
        }
        if (pick >= 0) {
          input.use = pick;
          brain.lastUse = b.t;
          // a Plus move on its strongest move when a gauge segment is full and the foe is in reach (rules version 2); a Pokémon
          // that can still Mega Evolve keeps the gauge for that
          if (!partner && b.plusReady(side) && !(me.mega && !side.megaUsed) && me.profiles[pick].category !== 'Status' &&
            dist(side, foe) <= b.reachFor(side, foe, me.profiles[pick]) + 0.5) {
            const dmg = (i) => expectedDamage(b, side, foe, me.profiles[i]);
            const mine = dmg(pick);
            if (mine > 0 && ready.every((i) => dmg(i) <= mine)) input.plus = true;
          }
        }
      }
    }
  }
  // movement: keep the distance the next move wants, sidestep, stay off the walls
  if (!side.act && b.onField(foe)) {
    const melee = me.profiles.some((p, i) => ['strike', 'dash'].includes(p.shape) && me.cds[i] < 1.5 * TPS && p.category !== 'Status');
    const want = (melee ? 1.4 : 6.5) * c.st.range;
    const to = norm(foe.x - side.x, foe.y - side.y);
    const d = dist(side, foe);
    let mx = 0, my = 0;
    if (d > want + 0.8) { mx += to.x; my += to.y; }
    else if (d < want - 0.8 && !melee) { mx -= to.x; my -= to.y; }
    if (brain.strafeUntil == null || b.t >= brain.strafeUntil) {
      brain.strafe = rng() < 0.5 ? 1 : -1;
      brain.strafeUntil = b.t + Math.round((1 + rng() * 1.5) * TPS);
    }
    const strafe = c.level === 'random' ? 0.3 : c.level === 'easy' ? 0.25 : 0.55;
    mx += -to.y * brain.strafe * strafe;
    my += to.x * brain.strafe * strafe;
    const margin = 2;
    if (side.x < margin) mx += 0.8; if (side.x > 28 - margin) mx -= 0.8;
    if (side.y < margin) my += 0.8; if (side.y > 17 - margin) my -= 0.8;
    if (c.level === 'random' && rng() < 0.02) { brain.wander = norm(rng() - 0.5, rng() - 0.5); }
    if (c.level === 'random' && brain.wander) { mx += brain.wander.x; my += brain.wander.y; }
    if (b.doubles) {
      // keep out of the partner's quakes, and a person's partner stays within reach of the person's Pokémon
      const ally = b.allyOf(side);
      if (ally && b.onField(ally)) {
        const da = dist(side, ally);
        if (da < ALLY_GAP) {
          const aw = da > 1e-6 ? norm(side.x - ally.x, side.y - ally.y) : {x: 0, y: side.pos ? 1 : -1};
          const k = ((ALLY_GAP - da) / ALLY_GAP) * 1.2;
          mx += aw.x * k; my += aw.y * k;
        }
      }
      if (opts.lead && b.onField(opts.lead) && dist(side, opts.lead) > 7.5) {
        const tl = norm(opts.lead.x - side.x, opts.lead.y - side.y);
        mx += tl.x * 0.8; my += tl.y * 0.8;
      }
    }
    // rocks: step out of the line when one stands between the two, and walk around them
    if (b.rocks.length) {
      const rk = b.rockOnLine(side, foe, 0.3);
      if (rk) {
        const off = (rk.x - side.x) * -to.y + (rk.y - side.y) * to.x;
        mx -= -to.y * Math.sign(off || 1) * 0.8;
        my -= to.x * Math.sign(off || 1) * 0.8;
      }
    }
    const n = b.steer(side, norm(mx, my));
    input.mx = n.x; input.my = n.y;
  }
  return input;
}
