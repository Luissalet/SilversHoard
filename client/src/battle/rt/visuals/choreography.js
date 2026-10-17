// Presentation only. Ground positions, hit timing and replay inputs belong to the engine.
const clamp = (n, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));

export function poseFor(profile, animator, ticks) {
  let name = ['strike', 'dash'].includes(profile?.shape) ? 'Attack'
    : ['self', 'field'].includes(profile?.shape) ? 'Charge' : 'Shoot';
  if (profile?.category === 'Special' && animator.has('SpAttack')) name = 'SpAttack';
  const meta = animator.meta?.a?.[name];
  const frames = meta?.d || [];
  const duration = frames.reduce((sum, n) => sum + n, 0);
  // HitFrame identifies the first contact/release pose. Reach it at the engine's existing windup boundary.
  // Old cache entries and sheets without that marker keep their previous full-sequence timing.
  if (Number.isInteger(meta?.hit) && meta.hit > 0 && meta.hit < frames.length && ticks > 0) {
    const lead = frames.slice(0, meta.hit).reduce((sum, n) => sum + n, 0);
    if (lead > 0) return {name, speed: lead / (ticks * 2)};
  }
  return {name, speed: ticks > 0 && duration > 0 ? clamp(duration / (ticks * 2), .15, 4) : 1.6};
}

export function motionFor(side, time, reduced = false) {
  const look = {lift: 0, opacity: 1, turn: 0, ring: ''};
  const act = side.act;
  if (!act || !['windup', 'dash'].includes(act.kind)) return look;
  const move = side.mons?.[side.active]?.moves?.[act.slot]?.id;
  const p = clamp(1 - act.left / (act.total || 30));
  if (move === 'dig') {
    look.ring = 'dig';
    look.opacity = act.kind === 'windup' ? 1 - clamp(p / .25) : clamp(p / .25);
  } else if (move === 'fly' || move === 'bounce') {
    look.ring = 'fly';
    if (!reduced) look.lift = act.kind === 'windup' ? clamp(p / .6) * 3.2 : (1 - p) * 3.2;
  } else if (move === 'rollout' || move === 'iceball') {
    if (!reduced) look.turn = time * (act.kind === 'dash' ? 22 : 12);
  }
  return look;
}

export function tossLift(age, reduced = false) {
  return !reduced && age > 0 && age < .65 ? Math.sin(age / .65 * Math.PI) * 1.8 : 0;
}
