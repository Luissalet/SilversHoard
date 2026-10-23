// Ordinary attacks: anticipation, directional release, real projectile wakes and confirmed contact.
// All clocks are presentation clocks; no target, hit or movement is added to the simulation.
const COLORS = { Fire: '#ffad61', Water: '#7bdaff', Electric: '#ffe47b', Grass: '#b2e482', Ice: '#b9f5ff', Psychic: '#ffa3d4', Ghost: '#c4a9ff', Dark: '#c4b6d9', Dragon: '#acb6ff', Poison: '#e1a0f4', Fighting: '#ffc49d', Steel: '#d9ecf3', Fairy: '#ffbce2' };
const TAU=Math.PI*2,clamp=n=>Math.max(0,Math.min(1,n));
const unit=(b,s,u=0)=>b.doubles?b.sides[s]?.units[u]:b.sides[s];
const same=(a,b)=>a.s===b.s && a.u===b.u;
const bodyPoint=(r,x,y,h=.65)=>({x:r.px(x)+(r.portrait?h*r.scale:0),y:r.py(y)-(r.portrait?0:h*r.scale)});
const line=(c,p)=>{c.beginPath();p.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.stroke();};
const poly=(c,p)=>{c.beginPath();p.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();c.fill();};
export function contactMaterial(move,type) {
  if(/slash|claw|cut|blade|scratch|scissor/.test(move||''))return 'cut';
  if(/bite|fang|crunch|jaw/.test(move||''))return 'jaw';
  return {Electric:'fork',Water:'splash',Fire:'flame',Ice:'shard',Rock:'fracture',Ground:'fracture',Grass:'leaf'}[type] || 'burst';
}

export class ImpactAccents {
  constructor(renderer) { this.r = renderer; this.hits = []; this.charges=[];this.releases=[];this.guards=[]; }

  isSpecial(s,move) {
    return this.r.specials?.charges?.some(a=>a.s===s && a.move===move) || this.r.specials?.attacks?.some(a=>a.s===s && a.move===move);
  }

  onEvent(e,battle) {
    const w=unit(battle,e.s,e.u||0);if(!w)return;
    const who={s:e.s,u:e.u||0,slot:w.active};
    const mon=battle.sides[e.s].mons?.[w.active] || w.mons?.[w.active];
    if(['recall','switch','faint','flinch','fail','use'].includes(e.k))
      this.charges=this.charges.filter(n=>!same(n,who));
    if(['recall','switch','faint'].includes(e.k))this.releases=this.releases.filter(n=>!same(n,who));
    if(e.k==='protected') {
      this.guards.push({...who,x:w.x,y:w.y,age:0,life:.28});this.guards=this.guards.slice(-8);return;
    }
    if(mon?.dynamaxUntil || this.isSpecial(e.s,e.move))return;
    const category=e.category || mon?.profiles?.find(p=>p.id===e.move)?.category;
    if(category==='Status' || ['self','field'].includes(e.shape))return;
    if(e.k==='windup' && e.ticks>0) {
      this.charges=this.charges.filter(n=>!same(n,who));
      this.charges.push({...who,move:e.move,type:e.type,shape:e.shape,age:0,life:Math.max(.1,e.ticks/30)});
      this.charges=this.charges.slice(-4);
    } else if(e.k==='use') {
      const fx=w.fx||0,fy=w.fy||0,length=Math.hypot(fx,fy)||1;
      this.releases.push({...who,move:e.move,type:e.type,shape:e.shape,x:w.x,y:w.y,fx:fx/length,fy:fy/length,age:0,life:6});
      this.releases=this.releases.slice(-16);
    }
  }

  hit(event, target) {
    if (!(event.dmg > 0) || (event.hit !== undefined && event.hit !== 0) || !target) return;
    const strong = !!event.crit || event.eff > 1 || event.hp <= 0 || event.dmg/Math.max(1,event.maxhp)>=.28;
    const casters=this.releases.filter(n=>n.s===event.from && n.move===event.move && n.age<6);
    const caster=casters.length===1?casters[0]:null;
    const dx=caster?target.x-caster.x:0,dy=caster?target.y-caster.y:0,len=Math.hypot(dx,dy)||1;
    this.hits.push({ x: target.x, y: target.y, color: COLORS[event.type] || '#f3e8c9', strong, age: 0, life: strong ? .48 : .32,
      fx:dx/len,fy:dy/len,material:contactMaterial(event.move,event.type),special:!!this.isSpecial(event.from,event.move) });
    if (this.hits.length > 16) this.hits.shift();
  }

  update(dt) {
    for(const key of ['hits','charges','releases','guards'])this[key]=this[key].filter(n=>(n.age+=dt)<n.life);
  }

  drawUnder(ctx,impactEnabled=true) {
    if(!impactEnabled || this.r.reducedMotion?.matches)return;
    const r=this.r,s=r.scale;
    for(const n of this.hits) {
      if(n.special || n.age>.065)continue;
      // A two-frame ink silhouette under the actual body, never a full-screen flash.
      const {x,y}=bodyPoint(r,n.x,n.y),rad=s*(n.strong?1.35:.95),p=n.age/.065;
      ctx.save();ctx.globalAlpha=.85*(1-p*p);ctx.fillStyle='#101922';
      poly(ctx,Array.from({length:20},(_,i)=>{const a=i*TAU/20,d=rad*(i%2?.46:1);return[x+Math.cos(a)*d,y+Math.sin(a)*d];}));
      ctx.restore();
    }
  }

  drawMotion(ctx,view) {
    const r=this.r,s=r.scale,reduced=!!r.reducedMotion?.matches;
    ctx.save();
    for(const n of this.charges) {
      const w=unit(view,n.s,n.u);if(!w || w.active!==n.slot || w.act?.kind!=='windup')continue;
      const p=clamp(1-w.act.left/Math.max(1,w.act.total)),{x,y}=bodyPoint(r,w.x,w.y);
      const a=Math.atan2(w.fy,w.fx);ctx.strokeStyle=COLORS[n.type]||'#f3e8c9';ctx.lineWidth=s*.055;
      if(reduced){ctx.globalAlpha=.6;line(ctx,[[x-s*.35,y],[x+s*.35,y]]);continue;}
      for(let i=0;i<6;i++) {
        const ang=a+i*TAU/6,d=s*(1.8-p*.9);ctx.globalAlpha=.35+.45*p;
        line(ctx,[[x+Math.cos(ang)*d,y+Math.sin(ang)*d*.7],[x+Math.cos(ang)*d*.75,y+Math.sin(ang)*d*.53]]);
      }
    }
    if(!reduced)for(const n of this.releases) {
      if(n.age>.27)continue;
      const w=unit(view,n.s,n.u);if(!w || w.active!==n.slot)continue;
      const p=n.age/.27,{x,y}=bodyPoint(r,w.x+n.fx*.65,w.y+n.fy*.65);
      ctx.globalAlpha=(1-p)*.85;ctx.strokeStyle=COLORS[n.type]||'#f3e8c9';ctx.lineWidth=s*.11*(1-p)+1;
      const a=Math.atan2(n.fy,n.fx),contact=['strike','dash'].includes(n.shape);
      ctx.beginPath();ctx.ellipse(x,y,s*(.4+p*.9),s*(.28+p*.5),a,-Math.PI*.7,Math.PI*.7);ctx.stroke();
      for(const off of [-1,1]) {
        const back=contact?-.4:-.8,dx=n.fx*s,dy=n.fy*s;
        line(ctx,[[x+dx*back-dy*off*.22,y+dy*back+dx*off*.22],[x+dx*(.7+p)-dy*off*.38,y+dy*(.7+p)+dx*off*.38]]);
      }
    }
    // Derive wakes from real heads/velocities, with a fixed draw budget and no fabricated arrival.
    if(!reduced)for(const p of (view.projectiles||[]).slice(0,24)) {
      if(this.isSpecial(p.s,p.move))continue;
      const len=Math.hypot(p.vx,p.vy);if(!len)continue;
      const dx=p.vx/len,dy=p.vy/len,{x,y}=bodyPoint(r,p.x,p.y,.6);
      ctx.strokeStyle=COLORS[p.type]||'#f3e8c9';
      for(let i=0;i<3;i++) {
        const off=(i-1)*s*.11;ctx.globalAlpha=.35-i*.06;ctx.lineWidth=Math.max(1,s*(.11-i*.025));
        line(ctx,[[x-dy*off,y+dx*off],[x-dx*s*(1.3+i*.3)-dy*off*.3,y-dy*s*(1.3+i*.3)+dx*off*.3]]);
      }
    }
    for(const n of this.guards) {
      const {x,y}=bodyPoint(r,n.x,n.y),p=reduced?.4:n.age/n.life;
      ctx.globalAlpha=(1-p)*.8;ctx.strokeStyle='#b7edff';ctx.lineWidth=s*.09;
      const points=Array.from({length:7},(_,i)=>{const a=i*TAU/6;return[x+Math.cos(a)*s*(r.portrait?1.1:.85),y+Math.sin(a)*s*(r.portrait?.85:1.1)];});line(ctx,points);
    }
    ctx.restore();
  }

  draw(ctx,view) {
    const r = this.r, reduced = !!r.reducedMotion?.matches;
    if(view)this.drawMotion(ctx,view);
    for (const hit of this.hits) {
      const k = reduced ? .35 : hit.age / hit.life;
      const radius = r.scale * (.25 + (1 - (1 - k) ** 3) * (hit.strong ? 1.45 : .85));
      ctx.save();
      const center=bodyPoint(r,hit.x,hit.y,.35);ctx.translate(center.x,center.y);
      if(r.portrait)ctx.rotate(Math.PI/2);
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
      if(!reduced && !hit.special) {
        const reach=r.scale*(hit.strong?2.1:1.45)*(1-(1-k)**3),fade=(1-k)**2;
        ctx.globalAlpha=fade;ctx.strokeStyle=hit.color;ctx.lineWidth=Math.max(1,r.scale*.12*(1-k));
        if(hit.material==='cut' || hit.material==='jaw') {
          const count=hit.material==='cut'?3:2;
          for(let i=0;i<count;i++) {
            const offset=(i-(count-1)/2)*r.scale*.3;
            line(ctx,[[-reach*.7+offset,reach*.65],[offset,-reach*.15],[reach*.6+offset,-reach*.7]]);
          }
        } else for(let i=0;i<8;i++) {
          const angle=i*TAU/8+(hit.fx||hit.fy?Math.atan2(r.portrait?-hit.fx:hit.fy,r.portrait?hit.fy:hit.fx):0),dx=Math.cos(angle),dy=Math.sin(angle);
          const tip=reach*(.8+(i%3)*.12),bend=hit.material==='fork'?.32:hit.material==='splash'?-.2:.06;
          line(ctx,[[dx*tip*.3,dy*tip*.3],[dx*tip*.6-dy*tip*bend,dy*tip*.6+dx*tip*bend],[dx*tip,dy*tip]]);
          if(['shard','leaf','fracture'].includes(hit.material)) {
            ctx.fillStyle=hit.color;const cx=dx*tip,cy=dy*tip,sz=r.scale*.14;
            poly(ctx,[[cx+dx*sz,cy+dy*sz],[cx-dy*sz*.5,cy+dx*sz*.5],[cx-dx*sz,cy-dy*sz]]);
          }
        }
      }
      ctx.restore();
    }
  }
}
