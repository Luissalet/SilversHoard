// Contact punctuation beneath the sprites, driven exclusively by presentation time.
const COLORS = { Fire: '#ffad61', Water: '#7bdaff', Electric: '#ffe47b', Grass: '#b2e482', Ice: '#b9f5ff', Psychic: '#ffa3d4', Ghost: '#c4a9ff', Dark: '#c4b6d9', Dragon: '#acb6ff', Poison: '#e1a0f4', Fighting: '#ffc49d', Steel: '#d9ecf3', Fairy: '#ffbce2' };

export class ImpactAccents {
  constructor(renderer) { this.r = renderer; this.hits = []; }

  hit(event, target) {
    if (!(event.dmg > 0) || (event.hit !== undefined && event.hit !== 0) || !target) return;
    const strong = !!event.crit || event.eff > 1 || event.hp <= 0;
    this.hits.push({ x: target.x, y: target.y, color: COLORS[event.type] || '#f3e8c9', strong, age: 0, life: strong ? .48 : .32 });
    if (this.hits.length > 16) this.hits.shift();
  }

  update(dt) {
    for (const hit of this.hits) hit.age += dt;
    this.hits = this.hits.filter(hit => hit.age < hit.life);
  }

  draw(ctx) {
    const r = this.r, reduced = !!r.reducedMotion?.matches;
    for (const hit of this.hits) {
      const k = reduced ? .35 : hit.age / hit.life;
      const radius = r.scale * (.25 + (1 - (1 - k) ** 3) * (hit.strong ? 1.45 : .85));
      ctx.save();
      ctx.translate(r.px(hit.x), r.py(hit.y) - r.scale * .35);
      ctx.globalAlpha = reduced ? .65 : (1 - k) * .85;
      ctx.strokeStyle = hit.color;
      ctx.lineWidth = Math.max(1, r.scale * (hit.strong ? .1 : .065) * (1 - k));
      ctx.beginPath();
      ctx.ellipse(0, r.scale * .25, radius, radius * .42, 0, 0, Math.PI * 2);
      ctx.stroke();
      if (hit.strong && !reduced) {
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const angle = i * Math.PI / 4;
          ctx.moveTo(Math.cos(angle) * radius * .7, Math.sin(angle) * radius * .7);
          ctx.lineTo(Math.cos(angle) * radius * 1.2, Math.sin(angle) * radius * 1.2);
        }
        ctx.stroke();
      }
      ctx.restore();
    }
  }
}
