// Drawing only. Embedded game textures are shared by the app, replay, videos and playable HTML.
import art from "../../../../silvers_hoard/presets/supplied_sprites.json" with { type: "json" };
import catalog from "../../../../silvers_hoard/presets/rt_move_effects.json" with { type: "json" };
import { effectProfile } from './supplied-moves.js';
import { upright } from './portrait-camera.js';

const FRAMES = { Fire: ["fx-fire-0", "fx-fire-1"], Ice: Array.from({length: 8}, (_, i) => `fx-ice-shards-${i}`),
  Ghost: Array.from({length: 6}, (_, i) => `fx-shadow-ball-${i}`), Normal: ["fx-swift-0"] };
const loaded = new Map();
const impacts = new WeakMap();
const idOf = move => String(move || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const GBA_PROJECTILES = {ember:'ember',flameburst:'fire-burst',pyroball:'flame',thundershock:'lightning',
  powergem:'gold-sparks',iceshard:'ice-shatter',iciclespear:'ice-shatter'};
const GBA_IMPACTS = {waterpulse:'water-orbs',bubblebeam:'water-orbs',aquajet:'water-orbs',
  aurasphere:'blue-pulse',dragonpulse:'blue-pulse',drainingkiss:'hearts',playrough:'hearts',thunderpunch:'lightning'};

export function frameFor(projectile, time, reduced = false) {
  // Swift's star is specific to Swift. Other Normal moves keep their own presentation.
  if (projectile.type === "Normal" && projectile.move !== "swift") return null;
  if (!["ball", "orb", "shard", "star", "shot", "projectile"].includes(projectile.shape)) return null;
  const specific = `fx-gba-${GBA_PROJECTILES[idOf(projectile.move)]}`;
  if (art.sprites[specific]) return specific;
  const atlas = `fx-sky-${String(projectile.type).toLowerCase()}`;
  if (art.sprites[atlas]) return atlas;
  const frames = FRAMES[projectile.type];
  return frames?.[(reduced ? 0 : Math.floor(Math.max(0, time) * 12)) % frames.length] || null;
}

export function queueSuppliedImpact(renderer, x, y, time, move = '') {
  const list = impacts.get(renderer) || [];
  const specific = `fx-gba-${GBA_IMPACTS[idOf(move)]}`;
  list.push({x,y,time,id:art.sprites[specific] ? specific : 'fx-ranger-impact'});
  impacts.set(renderer,list);
}

export function clearSuppliedImpacts(renderer) { impacts.delete(renderer); }

function drawFrame(ctx, id, frame, size) {
  let img = loaded.get(id);
  const sprite = art.sprites[id];
  if (!img) { img = new Image(); img.src = sprite.image; loaded.set(id, img); }
  if (!img.complete || !img.naturalWidth) return;
  if (sprite.frames) {
    const w=sprite.frame_width,h=sprite.frame_height;
    ctx.drawImage(img,frame%sprite.columns*w,Math.floor(frame/sprite.columns)*h,w,h,-size/2,-size/2,size,size);
  } else ctx.drawImage(img,-size/2,-size/2,size,size);
}

export function drawSuppliedProjectiles(ctx, renderer, view, reduced = false) {
  if (typeof Image === "undefined") return;
  for (const p of view.projectiles || []) {
    const id = frameFor(p, renderer.time, reduced);
    if (!id) continue;
    const sprite=art.sprites[id];
    const frame=sprite.frames ? (reduced ? 0 : Math.floor(Math.max(0,renderer.time)*sprite.fps)%sprite.frames) : 0;
    const size = Math.max(.45, Math.min(1.6, (p.r || .3) * 3)) * renderer.scale;
    ctx.save();
    ctx.translate(renderer.px(p.x), renderer.py(p.y - .6));
    ctx.imageSmoothingEnabled = false;
    drawFrame(ctx,id,frame,size);
    ctx.restore();
  }
  const keep=[];
  for (const impact of impacts.get(renderer) || []) {
    const sprite=art.sprites[impact.id];
    if (!sprite) continue;
    const age=renderer.time-impact.time;
    if (age<0 || age>=sprite.frames/sprite.fps) continue;
    keep.push(impact);
    ctx.save();
    ctx.translate(renderer.px(impact.x),renderer.py(impact.y-.6));
    ctx.imageSmoothingEnabled=false;
    drawFrame(ctx,impact.id,reduced ? 0 : Math.floor(age*sprite.fps),renderer.scale*1.5);
    ctx.restore();
  }
  impacts.set(renderer,keep);
}

const profileFor = (move,type,shape) => {
  const base=catalog.profiles[idOf(move)];
  // Weather Ball, Hidden Power and type-changing abilities use the public event type.
  return base && (!type||type===base.type) ? base : effectProfile({id:move,type,shape:shape||base?.shape,noEffect:base?.available===false});
};
const unitOf = (battle,e) => battle.doubles ? battle.sides[e.s]?.units[e.u || 0] : battle.sides[e.s];

/** Shared RT/mass material layer. Positions come from public events and views;
 * queues, anchors and images belong to this renderer and never to the simulator.
 */
export class SuppliedEffects {
  constructor(renderer) {
    this.r=renderer; this.time=0; this.queue=[]; this.origins=new Map();
  }

  material(move,type,shape) { return profileFor(move,type,shape); }

  push(kind,profile,geometry,life=.65) {
    if (!profile.available) return;
    this.queue.push({kind,profile,...geometry,at:this.eventAt??this.time,life});
    if (this.queue.length>128) this.queue.splice(0,this.queue.length-128);
    // Decode before the first visible frame; drawing retains procedural fallback while loading.
    if (typeof Image!=='undefined') for (const id of [profile.prepare,profile.travel,profile.impact,profile.area,profile.contact]) {
      if (!loaded.has(id) && art.sprites[id]) {const im=new Image();im.src=art.sprites[id].image;loaded.set(id,im);}
    }
  }

  event(e,battle) {
    if (Number.isFinite(battle.t)) this.time=battle.t/30;
    const u=unitOf(battle,e),profile=profileFor(e.move,e.type,e.shape);
    if (!u) return;
    this.eventAt=Number.isFinite(e.t)?e.t/30:undefined;
    const anchor={x:u.x,y:u.y,fx:u.fx ?? 1,fy:u.fy ?? 0,s:e.s,u:e.u || 0,slot:u.active};
    if (e.k==='windup' && e.ticks>0 && profile.available) {
      this.push('prepare',profile,anchor,Math.max(.04,e.ticks/30));
    } else if (e.k==='use') {
      // A completed use stops its charge immediately, including priority moves.
      this.queue=this.queue.filter(q=>q.kind!=='prepare'||q.s!==e.s||q.u!==(e.u||0));
      if (['strike','dash'].includes(profile.shape)) this.contact(e.move,e.type,u.x,u.y,u.fx,u.fy,profile.shape==='dash',anchor);
      else if (profile.shape==='self') this.push('self',profile,anchor,.85);
      else if (profile.shape==='field') this.push('field',profile,anchor,1);
      else if (['shot','beam','wave'].includes(profile.shape)) this.push('muzzle',profile,{...anchor,x:u.x+u.fx*.7,y:u.y+u.fy*.7},.25);
    } else if (e.k==='shot') {
      this.origins.set(e.id,{x:e.x,y:e.y});
    } else if (e.k==='area') {
      this.area(e.move,e.type,e.x,e.y,e.r,e.arc,e.fx,e.fy,profile.shape==='drop');
    } else if (e.k==='hit') {
      this.impact(e.move,e.type,u.x,u.y);
    } else if (['flinch','faint','switch','switchout'].includes(e.k)) {
      this.queue=this.queue.filter(q=>q.kind!=='prepare'||q.s!==e.s||q.u!==(e.u||0));
    }
    this.eventAt=undefined;
  }

  impact(move,type,x,y) {this.push('impact',profileFor(move,type),{x,y},.55);}
  area(move,type,x,y,r,arc=-1,fx=1,fy=0,drop=false) {this.push(drop?'drop':arc===-1?'burst':'cone',profileFor(move,type),{x,y,r,arc,fx,fy},drop?.7:.85);}
  contact(move,type,x,y,fx=1,fy=0,dash=false,anchor={}) {
    const len=Math.hypot(fx,fy)||1;
    this.push(dash?'dash':'contact',profileFor(move,type),{...anchor,x,y,fx:fx/len,fy:fy/len},dash?.6:.35);
  }
  beam(move,type,x0,y0,x1,y1) {this.push('beam',profileFor(move,type),{x:x0,y:y0,x1,y1},.42);}

  update(dt,view) {
    this.time=Number.isFinite(view?.seconds)?view.seconds:this.time+Math.max(0,dt);
    this.queue=this.queue.filter(q=>this.time>=q.at&&this.time-q.at<q.life);
  }

  draw(ctx,view,reduced=false) {
    if (typeof Image==='undefined') return;
    const r=this.r;let budget=256;
    const stamp=(id,x,y,size,age=0,life=0,angle=0,alpha=1,flat=false)=>{
      if (budget<=0 || !art.sprites[id] || !Number.isFinite(x+y+size)) return false;
      let img=loaded.get(id);
      if (!img) {img=new Image();img.src=art.sprites[id].image;loaded.set(id,img);}
      if (!img.complete||!img.naturalWidth) return false;
      const a=art.sprites[id],fw=a.frame_width||a.width,fh=a.frame_height||a.height;
      const frame=reduced?0:life?Math.min((a.frames||1)-1,Math.floor(Math.max(0,age/life)*(a.frames||1))):Math.floor(this.time*(a.fps||12))%(a.frames||1);
      const w=size*r.scale*fw/Math.max(fw,fh),h=size*r.scale*fh/Math.max(fw,fh);
      ctx.save();ctx.globalAlpha*=alpha;ctx.translate(r.px(x),r.py(y)-(flat?0:.6*r.scale));ctx.rotate(angle);
      ctx.imageSmoothingEnabled=false;
      ctx.drawImage(img,frame%(a.columns||1)*fw,Math.floor(frame/(a.columns||1))*fh,fw,fh,-w/2,-h/2,w,h*(flat?.55:1));
      ctx.restore();budget--;return true;
    };
    const line=(p,x0,y0,x1,y1,age,life,alpha=1)=>{
      const dx=x1-x0,dy=y1-y0,len=Math.hypot(dx,dy),n=Math.min(22,Math.max(1,Math.ceil(len/.7)));
      for(let i=0;i<n;i++) {const t=(i+.5)/n;stamp(p.travel,x0+dx*t,y0+dy*t,.95,age+i*.025,life,Math.atan2(dy,dx),alpha);}
    };
    // Derive persistent overlays from this frame's public state. No event timer
    // can outlive a cure, switch, faint, replay seek or doubles slot replacement.
    if (!view.ended) {
      const units=view.statusUnits || (view.sides||[]).flatMap(s=>(view.doubles?s.units||[]:[s])
        .map(u=>({...u,mon:s.mons?.[u.active]})));
      for (const u of units) {
        const mon=u.mon||u;
        if (u.vacant||u.need||mon.fainted||mon.hp===0) continue;
        const statuses=[mon.status,...['confused','taunt','protect'].filter(k=>u[k])];
        let above=0;
        upright(ctx,r.px(u.x),r.py(u.y),!!r.portrait,()=>{
          for (const status of statuses) {
            const fx=catalog.statuses?.[status];
            if (!fx) continue;
            const head=fx.placement==='head',size=u.size||1;
            stamp(fx.sprite,u.x+(head?above++*.45:0),u.y-(head?size+.35:.1*size),fx.size*size);
          }
        });
      }
    }
    const live=new Set();
    for(const shot of view.projectiles||[]) {
      live.add(shot.id);const p=profileFor(shot.move,shot.type,shot.shape);
      if (!p.available) continue;
      let origin=this.origins.get(shot.id);
      if (!origin) {origin={x:shot.x,y:shot.y};this.origins.set(shot.id,origin);}
      if(shot.shape==='beam') line(p,origin.x,origin.y,shot.x,shot.y,0,0,.9);
      else {
        const len=Math.hypot(shot.vx||0,shot.vy||0)||1,dx=(shot.vx||0)/len,dy=(shot.vy||0)/len;
        if(!reduced) for(let i=3;i>0;i--)stamp(p.travel,shot.x-dx*i*.35,shot.y-dy*i*.35,.85-i*.12,0,0,Math.atan2(dy,dx),.3);
      }
      const shotSize=Math.max(.8,Math.min(1.55,(shot.r||.35)*3));
      if(p.motion==='triad') for(let i=0;i<3;i++) {
        const angle=i*Math.PI*2/3+(reduced?0:this.time*3);
        stamp(p.travel,shot.x+Math.cos(angle)*.3,shot.y+Math.sin(angle)*.3,shotSize*.65);
      } else stamp(p.travel,shot.x,shot.y,shotSize,0,0,p.motion==='spin'&&!reduced?this.time*8:0);
    }
    for(const id of this.origins.keys())if(!live.has(id))this.origins.delete(id);
    for(const q of this.queue) {
      const age=this.time-q.at,t=reduced?.5:Math.min(1,Math.max(0,age/q.life)),p=q.profile;
      const alpha=reduced?1:Math.min(1,(1-t)*4);
      if(q.kind==='prepare') {
        const u=view.sides?.[q.s]?.units?.[q.u]||view.sides?.[q.s];
        if(u && (u.active!==undefined && u.active!==q.slot || u.act && u.act.kind!=='windup'))continue;
        stamp(p.prepare,u?.x??q.x,u?.y??q.y,reduced?1:1.6-t*.65,age,q.life,0,.65,true);
        if(!reduced)stamp(p.travel,(u?.x??q.x)+q.fx*.6,(u?.y??q.y)+q.fy*.6,.35+t*.4,age,q.life,0,.8);
      } else if(q.kind==='beam')line(p,q.x,q.y,q.x1,q.y1,age,q.life,alpha);
      else if(['burst','cone','drop','field'].includes(q.kind)) {
        const radius=q.r||2.3,phase=reduced?.7:t;
        // Texture fronts follow the real area geometry. They do not imply a hit.
        const n=reduced?8:18,half=q.kind==='cone'?Math.acos(Math.max(-1,Math.min(1,q.arc))):Math.PI;
        const facing=Math.atan2(q.fy??0,q.fx??1);
        for(let i=0;i<n;i++) {
          const spiral=p.motion==='spiral'&&q.kind!=='cone';
          const a=q.kind==='cone'?facing-half+(2*half*i/(n-1)):i*Math.PI*2/n+(spiral?phase*Math.PI*2:0);
          const dist=radius*(spiral?.2+.8*i/n:q.kind==='drop'?.45:.25+phase*.75);
          const falling=p.motion==='rain'&&!reduced&&q.kind!=='cone'?(1-t)*1.8*(.4+i/n):0;
          stamp(p.area,q.x+Math.cos(a)*dist,q.y+Math.sin(a)*dist-falling,Math.min(1.7,.7+radius*.17),age+i*.012,q.life,spiral?a:0,alpha,q.kind==='field');
        }
        if(q.kind==='drop')stamp(p.impact,q.x,q.y-(reduced?0:(1-t)*2.5),2,age,q.life,0,alpha);
      } else if(q.kind==='contact'||q.kind==='dash') {
        const u=q.s!==undefined?(view.sides?.[q.s]?.units?.[q.u]||view.sides?.[q.s]):null;
        const x=(u?.x??q.x)+q.fx*(.6+t*.8),y=(u?.y??q.y)+q.fy*(.6+t*.8);
        stamp(p.contact,x,y,1.35,age,q.life,p.contact_kind==='slash'?Math.atan2(q.fy,q.fx):0,alpha);
        if(p.type!=='Normal'&&p.type!=='Fighting')stamp(p.impact,x,y,1.05,age,q.life,0,alpha*.85);
      } else if(q.kind==='self') {
        if(p.motion==='orbit') {
          for(let i=0;i<3;i++){const a=i*Math.PI*2/3+(reduced?0:t*Math.PI*2);stamp(p.area,q.x+Math.cos(a)*.8,q.y+Math.sin(a)*.4,.9,age,q.life,0,alpha);}
        } else {
          stamp(p.area,q.x,q.y,2,age,q.life,0,alpha,true);
          if(!reduced)for(let i=0;i<4;i++){const a=i*Math.PI/2;stamp(p.area,q.x+Math.cos(a)*.7,q.y+Math.sin(a)*.4-t, .5,age,q.life,0,alpha);}
        }
      } else stamp(q.kind==='impact'?p.impact:p.travel,q.x,q.y,q.kind==='impact'?1.8:.8,age,q.life,0,alpha);
    }
  }
}
