// Defeated bodies have their own visual owner, so a replacement never erases them.
import {Animator, dirRow} from './pmd.js';
import {OverworldAnimator} from './overworld.js';
import {portraitFacing, upright} from './portrait-camera.js';

export const GROUND_SECONDS = 2.4;
const RECALL_SECONDS = .45;

export class DefeatPresentation {
  constructor() { this.bodies = []; }

  restore(battle, r) {
    // A seek restores persistent downed state, without replaying the historical fall.
    if (!battle.events?.some(e => e.k === 'faint')) return;
    const view = battle.view();
    view.sides.forEach((side, si) => {
      for (const unit of view.doubles ? side.units : [side]) {
        if (!side.mons[unit.active]?.fainted) continue;
        const event = [...battle.events].reverse().find(e => e.k === 'faint' && e.s === si
          && (e.u || 0) === (unit.pos || 0) && e.slot === unit.active);
        if (!event) continue;
        this.onEvent(event,battle,r);
        const body = this.bodies.at(-1);
        body.at = r.time - Math.max(GROUND_SECONDS,(battle.t-event.t)/30);
        body.animator?.update(2);
      }
    });
  }

  onEvent(e, battle, r) {
    const u = e.u || 0;
    if (e.k === 'faint') {
      const unit = r.unitOf(battle, e.s, u), mon = battle.sides[e.s].mons[e.slot];
      const ended = kind => battle.events.some(x => x.k === kind && x.s === e.s && x.slot === e.slot && x.t === e.t);
      const mega = !!mon.megaOn || ended('mega_end');
      const dynamax = !!mon.dynamaxUntil || ended('dynamax_end');
      const ultra = !!mon.ultraOn || ended('ultra_end');
      const source = r.animOf(e.s, e.slot, mega, dynamax, ultra);
      const animator = source instanceof OverworldAnimator ? new OverworldAnimator(source.meta)
        : source ? new Animator(source.meta, source.base) : null;
      animator?.play('HitGround', {hold:true, duration:1.2});
      const fallback = ultra ? r.ultraFallbacks?.[e.s]?.[e.slot] : dynamax ? r.dynamaxFallbacks?.[e.s]?.[e.slot]
        : mega ? r.megaFallbacks?.[e.s]?.[e.slot] : r.fallbacks[e.s]?.[e.slot];
      this.bodies.push({si:e.s, u, slot:e.slot, x:unit.x, y:unit.y, fx:unit.fx, fy:unit.fy,
        animator, fallback, scale:dynamax ? 2.2 : 1, at:r.time, recallAt:null});
    } else if (e.k === 'switch' || e.k === 'recall') {
      for (const body of this.bodies) if (body.si === e.s && body.u === u && body.recallAt === null) {
        body.recallAt = Math.max(r.time, body.at + GROUND_SECONDS);
      }
    }
  }

  draw(r, dt) {
    const reduced = !!r.reducedMotion?.matches, ctx = r.ctx;
    this.bodies = this.bodies.filter(b => b.recallAt === null || r.time < b.recallAt + RECALL_SECONDS);
    for (const b of this.bodies) {
      const recalling = b.recallAt !== null && r.time >= b.recallAt;
      const alpha = recalling ? Math.max(0, 1 - (r.time - b.recallAt) / RECALL_SECONDS) : 1;
      const x = r.px(b.x), y = r.py(b.y), k = r.k * b.scale;
      upright(ctx, x, y, r.portrait, () => {
        ctx.save();
        ctx.globalAlpha *= alpha;
        ctx.fillStyle = 'rgba(0,0,0,.32)';
        ctx.beginPath(); ctx.ellipse(x,y,.65*r.scale,.22*r.scale,0,0,Math.PI*2); ctx.fill();
        b.animator?.update(dt);
        const facing = r.portrait ? portraitFacing(b.fx,b.fy) : b;
        const drawn = b.animator?.draw(ctx,x,y,dirRow(facing.fx,facing.fy),k,{reduced});
        if (!drawn && b.fallback?.ready) {
          const img = b.fallback.img, h = 2.2*r.scale*b.scale, w = h*img.width/img.height;
          const p = reduced ? 1 : Math.min(1,(r.time-b.at)/.4);
          ctx.translate(x,y-w/2); ctx.rotate(Math.PI/2*p);
          ctx.drawImage(img,-w/2,-h/2,w,h);
        }
        ctx.restore();
      });
      if (recalling) {
        // A visible red return beam ends the held ground pose, also in plain mode.
        const from = r.trainerPos(b.si);
        ctx.save(); ctx.globalAlpha = alpha;
        ctx.strokeStyle = '#ff706e'; ctx.lineWidth = Math.max(2,r.scale*.1);
        ctx.beginPath(); ctx.moveTo(r.px(from.x),r.py(from.y)-r.scale*.6); ctx.lineTo(x,y); ctx.stroke();
        ctx.restore();
      }
    }
  }
}
