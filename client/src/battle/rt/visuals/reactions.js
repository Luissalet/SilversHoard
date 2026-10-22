// Bounded, presentation-only body acting. Never writes into a battle or uses wall time/RNG.
const clamp = n => Math.max(0, Math.min(1, n));
const ease = n => 1 - (1 - clamp(n)) ** 3;
const neutral = () => ({x: 0, y: 0, lift: 0, turn: 0, sx: 1, sy: 1});
const keyOf = (battle, s, u = 0) => battle.doubles ? s * 2 + u : s;
const unitOf = (battle, s, u = 0) => battle.doubles ? battle.sides[s]?.units[u] : battle.sides[s];
const direction = (x, y) => { const d = Math.hypot(x, y) || 1; return {x: x / d, y: y / d}; };
const screenDirection = (d, portrait) => portrait ? {x: d.y, y: -d.x} : d;

export class FighterReactions {
  constructor() {
    this.reactions = Array(4).fill(null);
    this.releases = Array(4).fill(null);
  }

  onEvent(e, battle, time) {
    if (!Number.isInteger(e.s)) return;
    const u = e.u || 0, key = keyOf(battle, e.s, u), side = unitOf(battle, e.s, u);
    if (!side) return;
    if (e.k === 'switch' || e.k === 'recall') {
      this.reactions[key] = this.releases[key] = null;
      return;
    }
    if (e.k === 'use') {
      this.releases[key] = {slot: side.active, time, s: e.s, u, move: e.move, shape: e.shape,
        dir: direction(side.fx || 0, side.fy || 0)};
      return;
    }
    let target = side, targetKey = key, kind = e.k;
    if (kind === 'miss') {
      // A fog miss says nothing about the defender evading; don't invent a dodge.
      if (e.fog) return;
      target = battle.doubles ? battle.foe(side) : battle.sides[1 - e.s];
      if (!target) return;
      targetKey = keyOf(battle, target.index ?? 1 - e.s, target.pos || 0);
      kind = 'dodge';
    }
    if (!['hit', 'protected', 'dodge', 'flinch', 'heal'].includes(kind)) return;
    if (kind === 'hit' && !(e.dmg > 0)) return;
    // Resolve the actual releasing unit in doubles where the event records only its side.
    const candidates = this.releases.filter(r => r && r.s === e.from && r.move === e.move && time >= r.time && time - r.time < 2);
    const release = candidates.length === 1 ? candidates[0] : null;
    const source = release ? unitOf(battle, release.s, release.u) : !battle.doubles && Number.isInteger(e.from) ? unitOf(battle, e.from) : null;
    // A hit records the attacker's side, not its unit. Ambiguous doubles compress in place.
    const ambiguous = battle.doubles && Number.isInteger(e.from) && !release;
    const dir = ambiguous ? {x: 0, y: 0} : source && source !== target
      ? direction(target.x - source.x, target.y - source.y)
      : direction(-(target.fx || 0), -(target.fy || 0));
    const strength = kind === 'hit' ? Math.min(1.6, .65 + clamp(e.dmg / Math.max(1, e.maxhp)) * 1.8 + (e.crit ? .25 : 0)) : 1;
    const old = this.reactions[targetKey];
    // Simultaneous multihits remain one recoil, with the strongest impulse, not an endless restart.
    if (kind === 'hit' && old?.kind === 'hit' && old.slot === target.active && old.time === time) {
      old.strength = Math.max(old.strength, strength);
      return;
    }
    this.reactions[targetKey] = {kind, slot: target.active, time, dir, strength,
      life: kind === 'hit' ? .36 : kind === 'heal' ? .55 : .28};
  }

  sample(side, key, time, {reduced = false, portrait = false, special = false} = {}) {
    const out = neutral();
    if (reduced || side.mons?.[side.active]?.fainted || side.need || side.act?.kind === 'switch') return out;
    const face = screenDirection(direction(side.fx || 0, side.fy || 0), portrait);
    const release = this.releases[key];
    const age = release && release.slot === side.active ? time - release.time : -1;
    // Existing Dig/Fly/Rollout choreography owns its silhouette and leaves no extra body lean.
    if (!special && side.act?.kind === 'windup') {
      const p = ease(1 - side.act.left / Math.max(1, side.act.total || 30));
      out.x = -face.x * .18 * p;
      out.y = -face.y * .18 * p;
      out.sx += .04 * p; out.sy -= .07 * p;
      out.turn = -face.x * .09 * p;
    } else if (!special && age >= 0 && age < .28) {
      const p = age / .28;
      const kick = p < .18 ? ease(p / .18) : (1 - (p - .18) / .82) ** 3;
      const self = ['self', 'field'].includes(release.shape);
      const reach = ['strike', 'dash'].includes(release.shape) ? .42 : .23;
      out.x = self ? 0 : face.x * reach * kick;
      out.y = self ? 0 : face.y * reach * kick;
      out.lift = (self ? .18 : .08) * kick;
      out.sx -= .025 * kick; out.sy += .05 * kick;
      out.turn = self ? 0 : face.x * .1 * kick;
    }
    const hit = this.reactions[key];
    if (!hit || hit.slot !== side.active) return out;
    const t = time - hit.time;
    if (t < 0 || t >= hit.life) return out;
    const p = t / hit.life;
    const d = screenDirection(hit.dir, portrait);
    // Fast compression, then a single decelerating recovery; no oscillating sprite shake.
    const impulse = p < .16 ? ease(p / .16) : (1 - (p - .16) / .84) ** 3;
    if (hit.kind === 'heal') {
      out.lift += Math.sin(p * Math.PI) * .16;
    } else if (hit.kind === 'dodge') {
      out.x += -d.y * impulse * .5; out.y += d.x * impulse * .5;
      out.turn += (d.x || 1) * .14 * impulse;
    } else {
      const block = hit.kind === 'protected';
      const push = (block ? .12 : .5 * hit.strength) * impulse;
      out.x += d.x * push; out.y += d.y * push;
      out.turn += -d.x * (block ? .055 : .18) * impulse;
      out.sx += .06 * impulse; out.sy -= .075 * impulse;
      if (!block) out.lift += .1 * hit.strength * impulse;
    }
    return out;
  }
}

// A multihit burst is one total, so its number stays centred and legible even without motion.
export function damageTextMotion(age, reduced = false) {
  if (reduced) return {x: 0, rise: 0, scale: 1, alpha: clamp((1.1 - age) / .22)};
  const enter = ease(age / .09);
  return {x: 0, rise: .7 * enter * ease(age / .5),
    scale: 1 + .32 * (1 - clamp(age / .18)) ** 2,
    alpha: clamp((1.1 - age) / .25)};
}
