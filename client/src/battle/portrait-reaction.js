// Presentation-only expression state. Its clock is the battle clock, so pause and
// seek never leave a wall-clock timeout on a replacement Pokémon.
export class PortraitReaction {
  constructor() { this.reset(); }
  reset() { this.identity = null; this.hp = null; this.time = -1; this.until = -1; this.emotion = 'Normal'; this.eventId = null; this.cue = null; }
  sample(mon, {identity = '', epoch = 0, time = 0, action = '', confused = false, outcome = '', event = null, eventId = event} = {}) {
    const key = `${epoch}:${identity}:${mon?.species}:${!!mon?.shiny}`;
    if (key !== this.identity || time < this.time) {
      this.reset(); this.identity = key;
    }
    if (!mon) return 'Normal';
    const hp = healthFraction(mon);
    if (this.hp !== null && hp !== this.hp) {
      this.emotion = hp < this.hp ? 'Pain' : 'Happy';
      this.until = time + .85;
    }
    this.hp = hp; this.time = time;
    if (eventId !== this.eventId) {
      this.eventId = eventId;
      const emotion = {hit:'Pain',heal:'Happy',move:'Shouting',switch:'Inspired',boost:'Inspired'}[event];
      this.cue = emotion ? {emotion,until:time + (event === 'hit' || event === 'heal' ? .85 : .65)} : null;
    }
    if (outcome) return outcome === 'win' ? 'Joyous' : 'Sad';
    if (mon.fainted || mon.hp <= 0) return 'Dizzy';
    if (time < this.until) return this.emotion;
    if (this.cue && time < this.cue.until) return this.cue.emotion;
    if (confused) return 'Dizzy';
    if (mon.status === 'slp' || mon.status === 'frz') return 'Sigh';
    if (action === 'windup') return 'Determined';
    if (action === 'attack' || action === 'recover') return 'Shouting';
    if (mon.hp / Math.max(1,mon.maxhp) <= .2) return 'Worried';
    if (mon.status || mon.hp / Math.max(1,mon.maxhp) <= .5) return 'Determined';
    return 'Normal';
  }
}

// A presentation clock freezes explicitly on pause. Rebuild/seek starts a new
// epoch in the player, so jumping over HP changes never invents a fresh hit.
export class PortraitClock {
  constructor(now = () => performance.now()) { this.now = now; this.value = 0; this.at = now(); this.running = false; }
  get time() { return this.value + (this.running ? (this.now() - this.at) / 1000 : 0); }
  setRunning(running) { this.value = this.time; this.at = this.now(); this.running = running; }
  reset(running = false) { this.value = 0; this.at = this.now(); this.running = running; }
}

export function realtimePortraitReleases(view, reactions, time) {
  return view.sides.map((side,s)=>(side.units || [side]).map((unit,u)=>{
    const cue = reactions?.releases?.[view.doubles ? s*2+u : s];
    return cue && cue.slot === unit.active && time >= cue.time && time-cue.time < .65 ? cue.slot : -1;
  }));
}

export function healthFraction(mon) {
  return mon?.maxhp > 0 ? Math.max(0,Math.min(1,mon.hp / mon.maxhp)) : 0;
}
