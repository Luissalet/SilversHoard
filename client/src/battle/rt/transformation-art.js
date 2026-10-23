// Event-clock choreography, shared by the app, replays and the portable HTML.
const TAU = Math.PI * 2;
const clamp = n => Math.max(0, Math.min(1, n));
const ease = n => 1 - (1 - clamp(n)) ** 3;

export function transformationBody(n, reduced = false) {
  if (!n || reduced || (!n.ultra && !n.mega && !n.giant)) return {base:false, alpha:1, flash:0};
  const seal = n.giant ? .30 : n.ultra ? .28 : .24;
  const reveal = n.giant ? .52 : .60;
  return {base:n.age < reveal, alpha:n.age < seal || n.age >= reveal ? 1 : 0,
    flash:n.age < seal ? clamp(n.age / seal) * .65 : n.age < reveal ? 0 : 1 - ease((n.age - reveal) / .28)};
}

function path(ctx, points, fill = false) {
  ctx.beginPath();
  points.forEach(([x,y],i)=>i ? ctx.lineTo(x,y) : ctx.moveTo(x,y));
  if(fill){ctx.closePath();ctx.fill();}else ctx.stroke();
}

// An opaque envelope hides the form switch; shards belong to the shell, never to the Pokémon's anatomy.
export function paintTransformation(ctx, n, x, y, height, s, reduced) {
  const giant = n.giant, ultra = n.ultra;
  const reveal = giant ? .52 : .60, seal = giant ? .30 : ultra ? .28 : .24;
  const cy = y - (giant ? Math.min(height, s*4) : height)*.52;
  const radius = Math.max(s*1.45, Math.min(height*.65, s*2.3));
  const ink = ultra ? '#ffe8a1' : giant ? '#ff79a9' : '#e4adff';
  ctx.save();ctx.strokeStyle=ink;ctx.fillStyle=ink;ctx.lineWidth=Math.max(1.5,s*.065);
  if(reduced) {
    ctx.globalAlpha=.6;ctx.beginPath();ctx.ellipse(x,cy,radius*.8,radius,0,0,TAU);ctx.stroke();
    ctx.restore();return;
  }
  if(n.age < reveal) {
    const gathering=clamp(n.age/seal), sealed=n.age>=seal;
    // Ultra gathers spectral light; Mega winds a double helix; Dynamax coils a storm.
    if(ultra) {
      const colors=['#ffe8a1','#a3efff','#e3b5ff','#ffb9cf'];
      for(let i=0;i<16;i++) {
        const a=i*TAU/16+.13, d=radius*(3.4-2.3*gathering),dx=Math.cos(a),dy=Math.sin(a);
        ctx.strokeStyle=colors[i%4];ctx.globalAlpha=.8;
        path(ctx,[[x+dx*d,cy+dy*d],[x+dx*d*.45,cy+dy*d*.45]]);
      }
    } else {
      for(let strand=0;strand<2;strand++) {
        const points=[];
        for(let j=0;j<=28;j++) {
          const f=j/28,a=f*TAU*1.5+n.age*7+strand*Math.PI;
          points.push([x+Math.sin(a)*radius*(giant?1.15:.8),cy+radius*(f*2-1)*1.4]);
        }
        ctx.globalAlpha=.85;ctx.strokeStyle=strand ? '#fff4ff' : ink;path(ctx,points);
      }
    }
    ctx.globalAlpha=sealed?1:gathering*.65;
    ctx.fillStyle=ultra?'#fff0b7':giant?'#581337':'#f5dbff';ctx.strokeStyle=ink;
    if(ultra) {
      path(ctx,[[x,cy-radius*1.35],[x+radius*.85,cy-radius*.25],[x+radius*.6,cy+radius],
        [x,cy+radius*1.3],[x-radius*.6,cy+radius],[x-radius*.85,cy-radius*.25]],true);ctx.stroke();
      ctx.strokeStyle='#d5a458';path(ctx,[[x,cy-radius*1.35],[x-radius*.3,cy],[x,cy+radius*1.3],[x+radius*.3,cy],[x,cy-radius*1.35]]);
    } else {
      ctx.beginPath();ctx.ellipse(x,cy,radius*(giant?.8:1),radius*1.3,0,0,TAU);ctx.fill();ctx.stroke();
    }
    if(sealed) {
      const crack=clamp((n.age-seal)/(reveal-seal));
      ctx.globalAlpha=crack;ctx.strokeStyle=ultra?'#fffdf0':giant?'#ffd6e6':'#8f46b9';ctx.lineWidth=s*.1;
      for(let i=0;i<5;i++) {
        const a=i*TAU/5;
        path(ctx,[[x,cy],[x+Math.cos(a+.2)*radius*.45,cy+Math.sin(a+.2)*radius*.45],
          [x+Math.cos(a)*radius*crack,cy+Math.sin(a)*radius*crack]]);
      }
    }
  } else {
    const p=clamp((n.age-reveal)/(n.life-reveal)),burst=ease(p);
    // One rupture, then an outward wake. No alternating flashes or repeated screen pulses.
    ctx.globalAlpha=(1-p)*.9;
    for(let i=0;i<(ultra?12:16);i++) {
      const a=i*TAU/(ultra?12:16),d=radius*(1+burst*(giant?3.6:2.4));
      const cx=x+Math.cos(a)*d,cy2=cy+Math.sin(a)*d*(giant?.55:.8),r=s*(.18+(1-p)*.25);
      ctx.fillStyle=i%3===0?'#fff9ed':ink;
      path(ctx,[[cx,cy2-r],[cx+r*.6,cy2+r*.7],[cx-r*.8,cy2+r*.4]],true);
    }
    ctx.strokeStyle=ink;ctx.lineWidth=s*.12*(1-p)+1;
    ctx.beginPath();ctx.ellipse(x,y,s*(1+burst*5),s*(.35+burst*1.5),0,0,TAU);ctx.stroke();
    if(ultra) {
      ctx.globalAlpha=(1-p)*.55;
      for(let i=0;i<4;i++) {
        const a=Math.PI/4+i*Math.PI/2,dx=Math.cos(a),dy=Math.sin(a);
        path(ctx,[[x+dx*radius*.4,cy+dy*radius*.4],[x+dx*radius*4,cy+dy*radius*4],
          [x+dx*radius*.8-dy*s*.2,cy+dy*radius*.8+dx*s*.2]],true);
      }
    }
  }
  ctx.restore();
}

// A single, dark impact panel at the rupture/landing, behind the readable captions.
export function paintTransformationFrame(ctx,n,r,battle) {
  const at=n.giant ? .94 : .60, duration=.105;
  if(n.age<at || n.age>=at+duration)return;
  const w=battle.doubles?battle.sides[n.s]?.units[n.u]:battle.sides[n.s];
  if(!w || w.active!==n.slot)return;
  const W=r.canvas.width,H=r.canvas.height,p=(n.age-at)/duration;
  const c=r.show.toScreen(w.x,w.y,n.giant?1.8:1.1),far=Math.hypot(W,H);
  const color=n.ultra?'#ffe8a1':n.giant?'#ff79a9':'#e4adff';
  ctx.save();ctx.globalAlpha=1-p*p;ctx.fillStyle=n.ultra?'#151327':n.giant?'#290c23':'#20102e';ctx.fillRect(0,0,W,H);
  ctx.fillStyle=color;
  for(let i=0;i<28;i++) {
    const a=i*TAU/28,inner=Math.min(W,H)*(.13+(i%4)*.025),width=.008+(i%3)*.004;
    path(ctx,[[c.x+Math.cos(a)*inner,c.y+Math.sin(a)*inner],
      [c.x+Math.cos(a-width)*far,c.y+Math.sin(a-width)*far],
      [c.x+Math.cos(a+width)*far,c.y+Math.sin(a+width)*far]],true);
  }
  r.show.drawSilhouettes(ctx,battle,{a:n.s,s:n.s,u:n.u,actorOnly:true},'#fff5da',W,H);
  ctx.restore();
}
