// Dynamax and Z choreography reads resolved events; it never delays or changes the simulation.
import { TYPE_COLORS } from '../dex.js';
import { rtMove } from '../../../../engine/src/realtime/moves.mjs';
import {drawBallFrame} from '../ball-art.js';
import {upright} from './portrait-camera.js';
import {specialMoveRecipe,paintSpecialMove} from './special-moves.js';

const TAU = Math.PI * 2;
const clamp = n => Math.max(0, Math.min(1, n));
const out = n => 1 - (1 - clamp(n)) ** 3;
const unit = (b, s, u = 0) => b.doubles ? b.sides[s]?.units[u] : b.sides[s];
const same = (a, s, u, slot) => a.s === s && a.u === u && a.slot === slot;
const color = type => TYPE_COLORS[type] || '#f3cd69';

function ellipse(ctx, x, y, rx, ry, stroke = true) {
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); stroke ? ctx.stroke() : ctx.fill();
}
function line(ctx, points) {
  ctx.beginPath(); points.forEach(([x,y], i) => i ? ctx.lineTo(x,y) : ctx.moveTo(x,y)); ctx.stroke();
}
function crystal(ctx, x, y, r) {
  ctx.beginPath(); ctx.moveTo(x,y-r); ctx.lineTo(x+r*.55,y); ctx.lineTo(x,y+r);
  ctx.lineTo(x-r*.55,y); ctx.closePath(); ctx.fill(); ctx.stroke();
  line(ctx, [[x,y-r],[x,y+r]]);
}

export class SpecialPresentation {
  constructor() { this.transforms = []; this.charges = []; this.attacks = []; this.impacts = []; }

  onEvent(e, battle) {
    const w = unit(battle, e.s, e.u || 0), m = w?.mons[w.active];
    if (!w) return;
    const who = {s:e.s, u:e.u || 0, slot:e.slot ?? w.active};
    if (e.k === 'ultra') {
      this.transforms=this.transforms.filter(n=>!same(n,who.s,who.u,who.slot));
      this.transforms.push({...who,age:0,x:w.x,y:w.y,life:1.25,ultra:true});
    } else if(e.k === 'ultra_end') {
      this.transforms=this.transforms.filter(n=>!same(n,who.s,who.u,who.slot));
    } else if (e.k === 'dynamax') {
      this.transforms = this.transforms.filter(n => !same(n, who.s, who.u, who.slot));
      this.transforms.push({...who, age:0, x:w.x, y:w.y, life:1.35, giant:true});
    } else if (e.k === 'dynamax_end') {
      this.transforms = this.transforms.filter(n => !same(n, who.s, who.u, who.slot));
      // A recall/faint already has its own exit; only an on-field timeout contracts the body.
      if (e.reason === 'time') this.transforms.push({...who, age:0, x:w.x, y:w.y, life:.55, giant:false});
    } else if (e.k === 'zmove') {
      this.charges = this.charges.filter(n => !same(n, who.s, who.u, who.slot));
      this.charges.push({...who, move:e.move, z:true, type:rtMove(e.move,battle.gen || 9)?.type, age:0, life:4});
    } else if (e.k === 'windup') {
      const z = this.charges.find(n => same(n, who.s, who.u, who.slot) && n.move === e.move);
      if (z) { z.type = e.type; z.life = Math.max(.2, e.ticks / 30); z.castSlot = w.act?.slot; }
      else if (m?.dynamaxUntil && m.profiles.some(p=>p.id===e.move && p.isMax))
        this.charges.push({...who,move:e.move,type:e.type,z:false,age:0,life:Math.max(.2,e.ticks/30),castSlot:w.act?.slot});
    } else if (e.k === 'use') {
      const z = this.charges.find(n => same(n, who.s, who.u, who.slot) && n.move === e.move);
      const max = !!m?.dynamaxUntil && (m.profiles || []).some(p => p.id === e.move && p.isMax);
      if (!z && !max) return;
      this.charges = this.charges.filter(n => n !== z);
      this.attacks.push({...who, move:e.move, type:e.type, category:e.category, shape:e.shape,
        age:0, life:6, x:w.x, y:w.y, z:!!z?.z, recipe:specialMoveRecipe(e.move,e.type,!!z?.z), released:e.t});
      // Never paint an impact at a guessed target: misses, guards and delayed projectiles stay truthful.
    } else if (e.k === 'hit') {
      if (e.hit > 0) return;
      const a = this.attacks.findLast(n => n.s === e.from && n.move === e.move && n.released <= e.t);
      if (a) this.impacts.push({x:w.x, y:w.y, type:e.type, z:a.z, recipe:a.recipe, age:0, life:a.z ? 1.2 : .95});
    } else if (['switch','faint','recall'].includes(e.k)) {
      this.charges = this.charges.filter(n => n.s !== who.s || n.u !== who.u);
      this.transforms = this.transforms.filter(n => n.s !== who.s || n.u !== who.u);
    } else if (e.k === 'fail') {
      this.charges = this.charges.filter(n => !same(n, who.s, who.u, who.slot) || n.move !== e.move);
    }
    // Doubles and repeated projectiles cannot grow an unbounded presentation backlog.
    this.attacks = this.attacks.slice(-16); this.impacts = this.impacts.slice(-24);
  }

  update(dt, view) {
    for (const key of ['transforms','attacks','impacts'])
      this[key] = this[key].filter(n => (n.age += dt) < n.life);
    this.charges = this.charges.filter(n => {
      const w = unit(view,n.s,n.u);
      return w?.active === n.slot && !view.sides[n.s].mons[n.slot]?.fainted && w.act?.kind === 'windup' && w.act.slot === n.castSlot;
    });
    // A presentation clock can run ahead during existing hit-stop, or behind at replay speed.
    // Keep the crystal until the actual cast releases or is interrupted, never until a guessed deadline.
    for(const n of this.charges) {
      n.age += dt; n.life = Math.max(n.life,n.age+.15);
      const act=unit(view,n.s,n.u).act;
      n.progress=act.total ? clamp(1-act.left/act.total) : 1;
    }
  }

  bodyScale(s, u, slot, grown, reduced) {
    if (reduced) return grown;
    const n = this.transforms.find(n => same(n,s,u,slot));
    if (!n || n.ultra) return grown; // Ultra Burst changes form, never its physical display scale.
    if(!n.giant)return 1 + 1.2 * (1-out(n.age/.5));
    if(n.age<.16)return 1;
    if(n.age<.34)return 1-.94*out((n.age-.16)/.18);
    if(n.age<.52)return .06;
    return .06+(grown-.06)*out((n.age-.52)/.48);
  }

  bodyFlash(s,u,slot,reduced) {
    if(reduced)return 0;
    const n=this.transforms.find(n=>same(n,s,u,slot) && (n.giant || n.ultra));
    if(n?.ultra)return Math.sin(Math.PI*clamp(n.age/.8))*.9;
    return n && n.age>.12 && n.age<.5 ? Math.sin(Math.PI*clamp((n.age-.12)/.38)) : 0;
  }

  drawAtmosphere(ctx,r,reduced,detailed) {
    if(!detailed)return;
    const sky=this.transforms.find(n=>n.ultra) || this.charges.find(n=>n.move==='lightthatburnsthesky') || this.attacks.find(n=>n.recipe.motif==='skyburn' && n.age<1.4);
    if(!sky)return;
    ctx.save();ctx.fillStyle='rgba(8,17,34,.4)';ctx.fillRect(0,0,r.canvas.width,r.canvas.height);
    ctx.fillStyle='#d7f4ff';
    for(let i=0;i<24;i++) {
      const x=((i*.6180339)%1)*r.canvas.width,y=((i*.381966)%1)*r.canvas.height;
      ctx.globalAlpha=reduced?.5:.35+.25*Math.sin(sky.age*2+i);ctx.fillRect(x,y,Math.max(1,r.scale*.06),Math.max(1,r.scale*.06));
    }
    ctx.restore();
  }

  // All coordinates here are world-space feet. The renderer rotates this layer with portrait battles.
  drawGround(ctx, r, view, reduced, detailed) {
    const s = r.scale;
    ctx.save();
    if (detailed) for (const n of this.transforms) {
      const w = unit(view,n.s,n.u);
      if (!w || w.active !== n.slot) continue;
      if(n.ultra)continue;
      const x=r.px(w.x), y=r.py(w.y), p=n.age/n.life;
      if(!reduced && n.giant && n.age>=.3 && n.age<.58) {
        const from=r.trainerPos(n.s),f=clamp((n.age-.3)/.28);
        const bx=r.px(from.x)+(x-r.px(from.x))*f,by=r.py(from.y)+(y-r.py(from.y))*f-Math.sin(f*Math.PI)*s*3;
        ctx.globalAlpha=1;ctx.strokeStyle='#ff639c';ctx.lineWidth=s*.1;
        drawBallFrame(ctx,bx,by,s*(.6+f*.9),n.age,false,false);ellipse(ctx,bx,by,s*(.5+f*.6),s*(.5+f*.6));
      }
      if (!reduced && n.giant) {
        // Converging pillars give the growth a gathering phase and a heavy release.
        const envelope=Math.sin(Math.PI*clamp(n.age/1.1));
        const glow=ctx.createRadialGradient(x,y-s*1.5,0,x,y-s*1.5,s*4.5);
        glow.addColorStop(0,'rgba(83,11,60,.6)');glow.addColorStop(1,'rgba(83,11,60,0)');
        ctx.fillStyle=glow;ctx.globalAlpha=envelope;
        ctx.fillRect(x-s*5,y-s*7,s*10,s*8);
        ctx.strokeStyle='#d64a85';ctx.lineWidth=s*.2;
        for(let i=0;i<9;i++) {
          const a=i*TAU/9+n.age*.45,d=s*(.8+(1-clamp(n.age/.7))*2.5);
          const bx=x+Math.cos(a)*d,by=y+Math.sin(a)*d*.3;
          line(ctx,[[bx,by],[bx+Math.cos(a)*s*.2,by-s*(2+envelope*2)]]);
        }
      }
      ctx.globalAlpha = (1-p)*.8; ctx.strokeStyle='#ff639c'; ctx.lineWidth=Math.max(2,s*.1);
      const spread=reduced ? 2 : 1+out(clamp((n.age-.75)/.6))*4;
      ellipse(ctx,x,y,s*spread,s*spread*.34);
      if (!reduced && n.age>.8) {
        ctx.globalAlpha=(1-p)*.55;
        for(let i=0;i<10;i++) {
          const a=i*TAU/10, d=s*(1.5+p*3);
          line(ctx,[[x+Math.cos(a)*s,y+Math.sin(a)*s*.34],
            [x+Math.cos(a)*d,y+Math.sin(a)*d*.34],
            [x+Math.cos(a+.12)*d*1.18,y+Math.sin(a+.12)*d*.4]]);
        }
      }
    }
    if (detailed) for (const n of this.charges) {
      const w=unit(view,n.s,n.u); if(!w)continue;
      const x=r.px(w.x),y=r.py(w.y),p=n.progress || 0;
      ctx.globalAlpha=.65;ctx.strokeStyle=color(n.type);ctx.lineWidth=Math.max(2,s*.07);
      ellipse(ctx,x,y,s*(reduced?1.3:2.4-p),s*(reduced?.45:.8-p*.35));
    }
    ctx.restore();
  }

  drawBody(ctx, r, side, si, mon, x, y, height, reduced, detailed) {
    if (mon.fainted) return;
    const s=r.scale, n=this.transforms.find(n=>same(n,si,side.pos || 0,side.active));
    ctx.save();
    if (mon.is_dynamax && !(n?.giant && n.age<.52)) {
      // Three moving storm clouds, rather than a generic enlarged selection ring.
      const top=y-height-s*.35;
      ctx.fillStyle='#4c193f';ctx.strokeStyle='#ff76a9';ctx.lineWidth=Math.max(1,s*.055);
      ctx.globalAlpha=detailed?.88:.5;
      for(let i=0;i<3;i++) {
        const a=i*TAU/3+(reduced?0:r.time*.65),cx=x+Math.cos(a)*s*.85,cy=top+Math.sin(a)*s*.19;
        ctx.beginPath();ctx.ellipse(cx,cy,s*.46,s*.17,0,0,TAU);
        ctx.ellipse(cx-s*.22,cy+s*.06,s*.24,s*.13,0,0,TAU);
        ctx.ellipse(cx+s*.2,cy+s*.06,s*.24,s*.13,0,0,TAU);ctx.fill();ctx.stroke();
      }
      if (detailed && !reduced) {
        ctx.globalAlpha=.3;ctx.strokeStyle='#ff9aba';
        for(let i=0;i<5;i++) {
          const p=(r.time*.55+i/5)%1,a=i*2.4+r.time*.25;
          ellipse(ctx,x+Math.cos(a)*s*(.7+p*.5),y-height*p,s*(.12+p*.08),s*.06);
        }
      }
    }
    if(detailed && n?.ultra) {
      const p=n.age/n.life,cy=y-height*.5,burst=out(clamp((p-.4)/.6));
      const spectrum=['#ffe391','#c5f6ff','#d1b5ff','#fbafce'];
      // Light enters a faceted cocoon, then its facets split away to reveal the PMD form.
      for(let i=0;i<8;i++) {
        const a=i*TAU/8,d=s*(reduced?1.2:p<.4?3.4-5*p:1.4+burst*2.6);
        const dx=Math.cos(a)*d,dy=Math.sin(a)*d*.8;
        ctx.globalAlpha=reduced?.65:(1-p)*.9;ctx.strokeStyle=spectrum[i%4];ctx.fillStyle=spectrum[i%4];ctx.lineWidth=s*.06;
        if(p<.4 || reduced)line(ctx,[[x+dx,cy+dy],[x+dx*.35,cy+dy*.35]]);
        else crystal(ctx,x+dx,cy+dy,s*(.3+burst*.15));
      }
      ctx.strokeStyle='#fff1bc';ctx.fillStyle='rgba(255,237,172,.2)';ctx.globalAlpha=reduced?.7:(1-p)*.9;
      ctx.lineWidth=s*.08;crystal(ctx,x,cy,s*(reduced?1.2:1.3+burst*.8));
      if(!reduced && p>.45){ctx.globalAlpha=(1-p)*.5;ellipse(ctx,x,y,s*(1+burst*3),s*(.4+burst));}
    } else if (detailed && n) {
      const p=n.age/n.life;
      ctx.globalAlpha=(1-p)*.8; ctx.strokeStyle='#ffb6ce';ctx.lineWidth=s*.12;
      const radius=s*(reduced?1.5:1.2+out(clamp(n.age/.7))*1.8);
      ellipse(ctx,x,y-height*.45,radius,Math.max(radius,height*.58));
      if (!reduced) for(let i=0;i<12;i++) {
        const a=i*TAU/12+n.age*.7,progress=(n.age*1.4+i/12)%1;
        const d=radius*(1.6-progress);
        line(ctx,[[x+Math.cos(a)*d,y-height*.45+Math.sin(a)*d],
          [x+Math.cos(a)*d*.8,y-height*.45+Math.sin(a)*d*.8]]);
      }
    }
    const z=this.charges.find(n=>same(n,si,side.pos || 0,side.active));
    if (z) {
      const p=z.progress || 0,cy=y-height*.55;
      if(detailed)paintSpecialMove(ctx,specialMoveRecipe(z.move,z.type,z.z),{x,y:cy,scale:s,age:z.age,progress:p,stage:'charge',reduced,color:color(z.type)});
      if(z.z) {
      ctx.strokeStyle=color(z.type);ctx.fillStyle='#fff4c3';ctx.lineWidth=Math.max(1,s*.06);
      ctx.globalAlpha=.9;
      crystal(ctx,x,cy-height*.5-s*.5,s*(.32+p*.16));
      if(detailed) {
        ctx.strokeStyle=color(z.type);ctx.globalAlpha=.7;
        const count=reduced?4:8;
        for(let i=0;i<count;i++) {
          const a=i*TAU/count+(reduced?0:z.age*2),d=s*(reduced?1.2:2.3-p*1.1);
          const dx=Math.cos(a)*d,dy=Math.sin(a)*d*.75;
          line(ctx,[[x+dx,cy+dy],[x+dx*.7,cy+dy*.7]]);
        }
        ellipse(ctx,x,cy,s*(1+p*.3),height*.6+s*.25);
      }
      }
    }
    ctx.restore();
  }

  drawAttacks(ctx, r, view, reduced, detailed) {
    if(!detailed)return;
    const s=r.scale;
    ctx.save();
    // The bright head follows the real projectile and ends exactly where it fizzles or hits.
    for(const p of view.projectiles) {
      const a=this.attacks.findLast(n=>n.s===p.s && n.u===(p.u || 0) && n.move===p.move);
      if(!a || a.category==='Status')continue;
      const x=r.px(p.x),y=r.py(p.y)-s*.65;
      upright(ctx,x,y,!!r.portrait,()=>paintSpecialMove(ctx,a.recipe,{x,y,scale:s,age:a.age,progress:.8,stage:'travel',reduced,color:color(a.type)}));
    }
    for(const a of this.attacks) {
      if(a.age>.55)continue;
      const w=unit(view,a.s,a.u);if(!w || w.active!==a.slot)continue;
      if(a.category==='Status') {
        const x=r.px(w.x),y=r.py(w.y)-s*.5;
        upright(ctx,x,y,!!r.portrait,()=>paintSpecialMove(ctx,a.recipe,{x,y,scale:s,age:a.age,progress:a.age/.55,reduced,color:color(a.type)}));
      }
      ctx.globalAlpha=(1-a.age/.55)*.8;ctx.strokeStyle=color(a.type);ctx.lineWidth=s*.12;
      const radius=s*(1+(reduced?.4:out(a.age/.55)*2.5));
      ellipse(ctx,r.px(w.x),r.py(w.y)-s*.7,radius,radius*.6);
    }
    for(const n of this.impacts) {
      const p=n.age/n.life,x=r.px(n.x),y=r.py(n.y)-s*.65;
      ctx.globalAlpha=(1-p)*.9;ctx.strokeStyle=color(n.type);ctx.fillStyle=color(n.type);
      upright(ctx,x,y,!!r.portrait,()=>paintSpecialMove(ctx,n.recipe,{x,y,scale:s,age:n.age,progress:p,reduced,color:color(n.type)}));
    }
    ctx.restore();
  }

  drawScreen(ctx, r, reduced, detailed) {
    if(!detailed)return;
    const n=this.charges.find(n=>n.z) || this.transforms.find(n=>n.giant || n.ultra);
    if(!n)return;
    const width=r.canvas.width,height=r.canvas.height;
    // A command cut-in sits in a free band in portrait, away from both external HUDs.
    const h=Math.min(height*.14,width*.15),w=Math.min(width*.4,height*.8);
    const x=n.s===0?width*.965-w:width*.035,y=r.portrait?height*.37:height*.06;
    const age=n.age,fade=Math.min(1,age/.1,(n.life-age)/.18);
    ctx.save();ctx.globalAlpha=Math.max(0,fade);
    const reveal=reduced?1:out(age/.22);
    ctx.beginPath();ctx.rect(x,y,w*reveal,h);ctx.clip();
    ctx.fillStyle='rgba(16,25,34,.94)';ctx.fillRect(x,y,w,h);
    ctx.strokeStyle=n.move?color(n.type):'#ff76a9';ctx.lineWidth=Math.max(2,h*.035);
    line(ctx,[[x,y+h],[x+w*.92,y+h],[x+w,y+h*.25]]);
    const trainer=r.trainers[n.s];
    if(trainer?.ready) {
      const img=trainer.img,scale=Math.min(h*.95/img.height,h*.9/img.width);
      ctx.drawImage(img,x+h*.08,y+h-img.height*scale,img.width*scale,img.height*scale);
    }
    ctx.fillStyle='#fff4d4';ctx.strokeStyle=n.move?color(n.type):'#ff76a9';
    crystal(ctx,x+h*1.1,y+h*.47,h*.24);
    const title=n.ultra?(r.texts.lang==='es'?'ULTRAEXPLOSIÓN':'ULTRA BURST'):n.move?(r.texts.lang==='es'?'PODER Z':'Z-POWER'):'DYNAMAX';
    let size=h*.34;ctx.font=`italic 800 ${size}px "Barlow Condensed", sans-serif`;
    while(size>10 && ctx.measureText(title).width>w-h*1.55)ctx.font=`italic 800 ${--size}px "Barlow Condensed", sans-serif`;
    ctx.fillStyle='#f0f4ed';ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillText(title,x+h*1.5,y+h*.5);
    ctx.restore();
  }

}
