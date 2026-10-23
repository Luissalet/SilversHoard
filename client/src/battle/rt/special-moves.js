// Authored move identities, inspired by the games' choreography. Positions/outcomes always come from RT events.
import {drawSuppliedStamp} from './supplied-fx.js';

const TYPE = {
  Normal:['rupture','impact'],Fire:['eruption','fire-column'],Water:['geyser','water-column'],
  Electric:['thunder','electric-bolt'],Grass:['roots','seedlings'],Ice:['icicles','icicles'],
  Fighting:['fists','red-fist'],Poison:['miasma','poison-cloud'],Ground:['fault','ground-erupt'],
  Flying:['cyclone','tornado'],Psychic:['prism','psychic-burst'],Bug:['swarm','bug-cloud'],
  Rock:['boulders','rock'],Ghost:['haunt','spirit'],Dragon:['helix','dragon-helix'],
  Dark:['eclipse','dark-vortex'],Steel:['spikes','spikes'],Fairy:['constellation','fairy-burst'],
};
const Z = {
  breakneckblitz:['rush','star-trail'],bloomdoom:['bloom','petals'],infernooverdrive:['inferno','fire-blast'],
  hydrovortex:['vortex','water-vortex'],gigavolthavoc:['circuit','electric-blue'],subzeroslammer:['glacier','ice-crystal'],
  alloutpummeling:['barrage','red-fist'],aciddownpour:['rain','poison-splash'],tectonicrage:['rift','ground-erupt'],
  supersonicskystrike:['dive','air-cut'],shatteredpsyche:['shatter','psy-burst'],savagespinout:['cocoon','web'],
  continentalcrush:['crush','rock-tomb'],neverendingnightmare:['grasp','hand'],devastatingdrake:['dragon','dragon-helix'],
  blackholeeclipse:['singularity','black-hole'],corkscrewcrash:['drill','steel-ring'],twinkletackle:['fairy','hearts'],
  catastropika:['pounce','electric-burst'],'10000000voltthunderbolt':['rainbow-thunder','electric-bolt'],
  stokedsparksurfer:['surf','electric-blue'],extremeevoboost:['evolution','boost'],pulverizingpancake:['body-slam','impact'],
  genesissupernova:['nova','psychic-orb'],sinisterarrowraid:['arrows','purple-scythe'],maliciousmoonsault:['ring-slam','dark-hit'],
  oceanicoperetta:['opera','water-orb'],splinteredstormshards:['stone-volley','rock'],letssnuggleforever:['blanket','ghost-flame'],
  clangoroussoulblaze:['scales','dragon-burst'],guardianofalola:['guardian','hand'],
  searingsunrazesmash:['sun-dive','sun-orb'],menacingmoonrazemaelstrom:['moon-gate','moon'],
  lightthatburnsthesky:['skyburn','sparkles'],soulstealing7starstrike:['seven-stars','spirit'],
};
const GMAX = {
  gmaxbefuddle:['spore-storm','bug-cloud'],gmaxcannonade:['cannons','water-lance'],gmaxcentiferno:['fire-coil','fire-spin'],
  gmaxchistrike:['chi-fist','red-fist'],gmaxcuddle:['cuddle','hearts'],gmaxdepletion:['siege','dragon-burst'],
  gmaxdrumsolo:['drums','leaves'],gmaxfinale:['celebration','hearts'],gmaxfireball:['sun-kick','fire-orb'],
  gmaxfoamburst:['foam','bubbles'],gmaxgoldrush:['gold-rain','coins'],gmaxgravitas:['gravity','gravity'],
  gmaxhydrosnipe:['snipe','water-lance'],gmaxmalodor:['toxic-fountain','sludge'],gmaxmeltdown:['liquid-metal','steel-ring'],
  gmaxoneblow:['one-blow','dark-hit'],gmaxrapidflow:['three-strikes','water-lance'],gmaxreplenish:['harvest','seedlings'],
  gmaxresonance:['aurora','snow'],gmaxsandblast:['sand-coil','sand'],gmaxsmite:['smite','fairy-burst'],
  gmaxsnooze:['sleep-cloud','dark-pool'],gmaxsteelsurge:['steel-field','spikes'],gmaxstonesurge:['stone-tide','water-column'],
  gmaxstunshock:['toxic-thunder','electric-blue'],gmaxsweetness:['nectar','petals'],gmaxtartness:['acid-fruit','leaves'],
  gmaxterror:['terror-gate','ghost-flame'],gmaxvinelash:['vine-lash','leech'],gmaxvolcalith:['volcanic-rock','rock'],
  gmaxvoltcrash:['storm-bolt','electric-bolt'],gmaxwildfire:['wildfire','fire-column'],gmaxwindrage:['feather-storm','air-cut'],
};
export function specialMoveRecipe(move,type,z=false) {
  const [motif,texture]=Z[move] || GMAX[move] || (move==='maxguard'?['barrier','shell']:TYPE[type] || TYPE.Normal);
  return {move,type,z,motif,texture:`fx-rt-${texture}`};
}

const TAU=Math.PI*2;
const sat=n=>Math.max(0,Math.min(1,n));
const rgba=(hex,a)=>{const n=parseInt(hex.slice(1),16);return `rgba(${n>>16},${(n>>8)&255},${n&255},${a})`;};
const ring=(c,x,y,r,flat=.55)=>{c.beginPath();c.ellipse(x,y,r,r*flat,0,0,TAU);c.stroke();};
const path=(c,points,fill=false)=>{c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));if(fill)c.closePath();fill?c.fill():c.stroke();};
function prism(ctx,x,y,r,color) {
  ctx.fillStyle=color;
  path(ctx,[[x,y-r],[x+r*.42,y],[x,y+r],[x-r*.42,y]],true);
  ctx.strokeStyle='#fff9dc';ctx.lineWidth=Math.max(1,r*.06);
  path(ctx,[[x,y-r],[x,y+r]]);
}

/** One bounded actor: a charge, actual projectile head, or confirmed target. No guessed target or damage. */
export function paintSpecialMove(ctx,recipe,{x,y,scale,age=0,progress=0,stage='impact',reduced=false,color='#f3cd69'}) {
  const charge=stage==='charge',travel=stage==='travel';
  const t=reduced?.65:sat(progress),s=scale;
  const r=s*(charge?1.25:travel?1.45:3.1)*(reduced?1:.5+.5*Math.sin(Math.PI*t/2));
  const phase=reduced?0:age;
  const stamp=(id,dx,dy,size=1,alpha=1,angle=0)=>drawSuppliedStamp(ctx,id,x+dx,y+dy,size*s,age,reduced,alpha,angle,recipe.motif==='gold-rain'?'sepia(1) saturate(4)':'');
  const texture=(dx,dy,size=1,alpha=1,angle=0)=>stamp(recipe.texture,dx,dy,size,alpha,angle);
  ctx.save();ctx.strokeStyle=color;ctx.fillStyle=rgba(color,.25);ctx.lineWidth=Math.max(2,s*.09);
  // Source power gathers in the move's own material; attack and target tell different parts of the same story.
  if(charge && recipe.motif!=='skyburn') {
    for(let i=0;i<(reduced?3:6);i++) {
      const a=i*TAU/6+phase*1.7,d=r*(1.5-t*.8);
      texture(Math.cos(a)*d,Math.sin(a)*d*.55,.55,.75,a);
    }
    ctx.restore();return;
  }
  const kind=recipe.motif;
  if(kind==='skyburn') {
    // Ultra Necrozma: stolen starlight converges through a prism, then splits into a column of spectral light.
    const spectrum=['#9cecff','#baa2ff','#ffd878','#ff95cc','#a9ffd3'];
    if(charge) {
      for(let i=0;i<8;i++) {
        const a=i*TAU/8+phase*.3,d=s*(3.2-t*2);
        ctx.strokeStyle=spectrum[i%5];ctx.lineWidth=s*.045;
        path(ctx,[[x+Math.cos(a)*d,y+Math.sin(a)*d*.7],[x,y]]);
        stamp('fx-rt-sparkles',Math.cos(a)*d,Math.sin(a)*d*.7,.5);
      }
      prism(ctx,x,y,s*(.6+t*.6),'#ffe7a0');
    } else {
      const tall=(travel?2.5:8)*s,wide=(travel?.7:1.4)*s;
      for(let i=0;i<5;i++) {
        ctx.strokeStyle=rgba(spectrum[i],.75);ctx.lineWidth=wide*(1-i*.15);
        path(ctx,[[x+Math.sin(i)*s*.35,y-tall],[x,y+s*.35]]);
      }
      ctx.strokeStyle='#fff9dc';ctx.lineWidth=s*.18;path(ctx,[[x,y-tall],[x,y+s*.5]]);
      for(let i=0;i<8;i++) {
        const a=i*TAU/8,dx=Math.cos(a)*r,dy=Math.sin(a)*r*.55;
        ctx.strokeStyle=spectrum[i%5];path(ctx,[[x,y],[x+dx*.6-dy*.2,y+dy*.6],[x+dx,y+dy]]);
        prism(ctx,x+dx,y+dy,s*(travel?.16:.24),spectrum[i%5]);
      }
      if(!travel){ctx.strokeStyle='#fff5ce';ring(ctx,x,y,r);ring(ctx,x,y,r*1.35,.35);}
    }
  } else if(['vortex','cyclone','sand-coil','fire-coil','singularity','eclipse','moon-gate','gravity','terror-gate','drill','liquid-metal'].includes(kind)) {
    const dark=['singularity','eclipse','moon-gate','terror-gate'].includes(kind),coil=['sand-coil','fire-coil','cyclone'].includes(kind);
    if(dark){ctx.fillStyle=rgba('#101922',.92);ctx.beginPath();ctx.ellipse(x,y,r*.8,r*.55,0,0,TAU);ctx.fill();}
    for(let j=0;j<5;j++) {
      const radius=r*(.45+j*.13),cy=y-(coil?j*s*.5:0);
      ctx.strokeStyle=j%2?'#f0f4ed':color;ctx.lineWidth=s*(j%2?.055:.14);
      ctx.beginPath();ctx.ellipse(x,cy,radius,radius*.42,phase+j*.35,0,TAU*.83);ctx.stroke();
      const a=phase*4+j*TAU/5;
      texture(Math.cos(a)*radius,cy-y+Math.sin(a)*radius*.42,1,.9,a);
    }
  } else if(['fault','rift','spikes','steel-field','roots','vine-lash','glacier','icicles','crush','boulders','volcanic-rock','stone-volley','stone-tide'].includes(kind)) {
    const falling=['crush','boulders','volcanic-rock','stone-volley'].includes(kind);
    const grow=reduced?1:sat(t*3),count=kind==='crush'?1:7;
    for(let i=0;i<count;i++) {
      const a=i*2.4,dx=count===1?0:Math.cos(a)*r*(.45+i*.07),dy=Math.sin(a)*r*.35;
      const lift=falling?(1-t)*s*5:s*grow*(1+i%3*.5);
      texture(dx,dy-lift,count===1?5:1.5+i%3*.35,1,falling?phase*.6:0);
      if(!falling)path(ctx,[[x+dx-s*.2,y+dy],[x+dx,y+dy-lift],[x+dx+s*.25,y+dy]],true);
    }
    ctx.strokeStyle=color;
    for(let i=0;i<8;i++) {
      const a=i*TAU/8,dx=Math.cos(a)*r,dy=Math.sin(a)*r*.4;
      path(ctx,[[x,y],[x+dx*.5,y+dy*.5],[x+dx*.7-dy*.2,y+dy*.8],[x+dx,y+dy]]);
    }
  } else if(kind==='rain') {
    // Acid falls into a spreading pool; it must not read as another upward geyser.
    for(let i=0;i<9;i++) {
      const fall=reduced?.72:(phase*1.5+i*.17)%1,dx=(i-4)*s*.5;
      const dy=-s*5*(1-fall);
      texture(dx,dy,.8,.85);
      path(ctx,[[x+dx,y+dy-s*.7],[x+dx,y+dy]]);
    }
    ctx.fillStyle=rgba(color,.28);ctx.beginPath();ctx.ellipse(x,y,r,r*.35,0,0,TAU);ctx.fill();
    ring(ctx,x,y,r,.35);texture(0,0,2.5,.75);
  } else if(['dive','sun-dive','pounce','body-slam','ring-slam','rush'].includes(kind)) {
    // A launch trail on the actual projectile, followed by a compressed landing at the confirmed hit.
    const rush=kind==='rush',heavy=['body-slam','ring-slam'].includes(kind);
    if(travel) {
      for(let i=0;i<5;i++) {
        const d=(i+.3)*s*.65;
        texture(rush?-d:d*.55,rush?Math.sin(i)*s*.12:-d,1.7-i*.2,1-i*.15,rush?0:-Math.PI*.35);
      }
    } else {
      const land=reduced?1:sat(t*4),height=(1-land)*s*(heavy?5:3);
      texture(0,-height,heavy?4.8:3,1,kind==='ring-slam'?phase*.7:0);
      ctx.lineWidth=s*(heavy?.2:.1);
      for(let i=0;i<3;i++)ring(ctx,x,y,r*(.45+i*.3)*land,heavy?.24:.45);
      for(let i=0;i<7;i++) {
        const a=Math.PI+i*Math.PI/6,d=r*land;
        path(ctx,[[x,y],[x+Math.cos(a)*d*.6,y+Math.sin(a)*d*.5],[x+Math.cos(a)*d,y+Math.sin(a)*d*.35]]);
      }
    }
  } else if(kind==='shatter') {
    // A prism closes around the point of contact, then breaks into outward shards.
    const burst=reduced?.7:sat((t-.18)*1.8),radius=s*(travel?1.5:2.2)*(1+burst);
    for(let i=0;i<8;i++) {
      const a=i*TAU/8,dx=Math.cos(a)*radius,dy=Math.sin(a)*radius*.7;
      ctx.fillStyle=rgba(color,.3);ctx.strokeStyle=i%2?'#f2d8ff':color;
      path(ctx,[[x+dx,y+dy-s*.7],[x+dx+s*.4,y+dy],[x+dx,y+dy+s*.7],[x+dx-s*.4,y+dy]],true);
      texture(dx,dy,.65,.8,a+burst);
      if(!travel)path(ctx,[[x+dx*.35,y+dy*.35],[x+dx,y+dy]]);
    }
  } else if(kind==='cuddle'||kind==='celebration') {
    const embrace=kind==='cuddle';
    for(let i=0;i<10;i++) {
      const a=i*TAU/10+phase*.6;
      const rise=reduced?.5:(phase*.65+i*.13)%1;
      const dx=embrace?Math.cos(a)*r*(1-t*.35):(i-4.5)*s*.48;
      const dy=embrace?Math.sin(a)*r*.7:-rise*s*4;
      texture(dx,dy,embrace?1:.65,.85,embrace?a:0);
    }
    if(embrace){ring(ctx,x,y,r*(1-t*.35),.8);ring(ctx,x,y,r*.6,.8);}
    else for(let i=0;i<3;i++){ctx.strokeStyle=['#ffedcc','#ffc3df',color][i];ring(ctx,x,y-s*i*.35,r*(1-i*.2),.25);}
  } else if(['geyser','cannons','snipe','surf','foam','opera','toxic-fountain','miasma','sleep-cloud'].includes(kind)) {
    const height=s*(travel?2.2:4.5),count=kind==='snipe'?1:5;
    for(let i=0;i<count;i++) {
      const dx=(i-(count-1)/2)*s*.6,offset=reduced?.5:(phase*.9+i*.2)%1;
      texture(dx,-height*(.25+offset*.7),kind==='snipe'?2:1.8,.9);
      if(!travel)texture(dx*2,height*.1,s/Math.max(1,s)*1.4,.7);
    }
    ctx.strokeStyle=color;ring(ctx,x,y,r);if(!reduced)ring(ctx,x,y,r*(.4+t*.8));
  } else if(['thunder','circuit','storm-bolt','toxic-thunder','rainbow-thunder','smite'].includes(kind)) {
    const spectrum=kind==='rainbow-thunder'?['#7ef0e3','#f399ff','#ffdf58','#91baff','#ff947c']:[color,'#fff8c6'];
    const count=travel?3:6;
    for(let i=0;i<count;i++) {
      const dx=Math.cos(i*2.4)*r*.6,top=y-s*(travel?2.2:5+i%2);
      ctx.strokeStyle=spectrum[i%spectrum.length];ctx.lineWidth=s*(i%2?.1:.18);
      path(ctx,[[x+dx,top],[x+dx-s*.35,y-s*2],[x+dx+s*.3,y-s*1.3],[x,y]]);
    }
    texture(0,0,travel?2.1:4);ctx.strokeStyle='#fff5bf';ring(ctx,x,y,r);
    if(kind==='toxic-thunder')stamp('fx-rt-poison-cloud',0,0,3,.55);
  } else if(['barrage','fists','chi-fist','one-blow','three-strikes','guardian','grasp','haunt','seven-stars'].includes(kind)) {
    const count=['one-blow','body-slam','guardian','pounce'].includes(kind)?1:kind==='three-strikes'?3:7;
    for(let i=0;i<count;i++) {
      const a=i*TAU/count,beat=reduced?1:sat(t*4-i*.13),dx=count===1?0:Math.cos(a)*r*.65;
      const dy=count===1?0:Math.sin(a)*r*.35;
      texture(dx,dy-(1-beat)*s*2,count===1?4:1.7,beat,-Math.PI*.25);
    }
    ctx.strokeStyle='#fff0ce';path(ctx,[[x-r,y+r*.3],[x+r,y-r*.3]]);
    if(['ring-slam','body-slam'].includes(kind)) {ctx.strokeStyle=color;ring(ctx,x,y,r);ring(ctx,x,y,r*.7);}
  } else if(['bloom','fairy','constellation','evolution','nectar','harvest','acid-fruit','spore-storm','swarm','blanket','cocoon','gold-rain','aurora'].includes(kind)) {
    const gold=kind==='gold-rain',cocoon=['cocoon','blanket'].includes(kind);
    if(cocoon)for(let i=0;i<7;i++){ctx.strokeStyle=i%2?'#f0f4ed':color;ring(ctx,x,y-s*.1*i,r*(1-i*.08),.8);}
    for(let i=0;i<12;i++) {
      const a=i*2.4+phase*.4,d=r*(.35+(i%4)*.2),fall=reduced?.5:(phase+i*.15)%1;
      const dx=Math.cos(a)*d,dy=gold?(fall-.8)*s*5:Math.sin(a)*d*.6;
      texture(dx,dy,gold?1.1:.9,.9,a);
      if(gold){ctx.strokeStyle='#ffda73';path(ctx,[[x+dx,y+dy-s*.7],[x+dx,y+dy-s*.25]]);}
    }
    if(kind==='aurora')for(let i=0;i<4;i++){ctx.strokeStyle=['#77efdf','#c7acff','#ffa9df','#c7f49c'][i];ring(ctx,x,y-s*i*.5,r,.7);}
  } else if(['eruption','inferno','sun-kick','wildfire','helix','dragon','scales','feather-storm','drums','siege','arrows','nova','prism','rupture'].includes(kind)) {
    const spiral=['helix','dragon','wildfire','scales'].includes(kind);
    for(let i=0;i<9;i++) {
      const a=i*TAU/9+(spiral?phase*2:0),d=r*(travel?.6:.6+t*.35);
      const dx=Math.cos(a)*d,dy=Math.sin(a)*d*.55;
      texture(dx,dy-s*(spiral?i*.25:0),travel?1.1:1.7,.9,a);
      if(kind==='arrows'||kind==='feather-storm')path(ctx,[[x+dx-s*.5,y+dy-s*2],[x+dx,y+dy]]);
    }
    texture(0,0,travel?1.8:3.8);
    if(kind==='shatter'||kind==='prism')for(let i=0;i<6;i++) {
      const a=i*TAU/6;path(ctx,[[x,y],[x+Math.cos(a)*r,y+Math.sin(a)*r*.65]]);
    }
  } else if(kind==='barrier') {ctx.strokeStyle='#c6e6ff';ring(ctx,x,y,r,.9);texture(0,0,3);}
  ctx.restore();
}
