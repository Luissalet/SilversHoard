import test from 'node:test';
import assert from 'node:assert/strict';
import {Dex} from '@pkmn/sim';
import {rtMove} from '../src/realtime/moves.mjs';
import {SuppliedEffects} from '../../client/src/battle/rt/supplied-fx.js';
import {effectProfile} from '../../client/src/battle/rt/supplied-moves.js';
import {Vfx,particleStyle} from '../../client/src/battle/rt/vfx.js';
import art from '../../silvers_hoard/presets/supplied_sprites.json' with {type:'json'};
import catalog from '../../silvers_hoard/presets/rt_move_effects.json' with {type:'json'};
import {RtBattle} from '../src/realtime/sim.mjs';

function harness(run) {
  const old=globalThis.Image;
  globalThis.Image=class {complete=true;naturalWidth=128;};
  const r={canvas:{width:840,height:510},scale:30,time:0,px:x=>x*30,py:y=>y*30};
  const calls=[],materials=[];
  const ctx={globalAlpha:1,save(){},restore(){this.globalAlpha=1;},translate(...a){calls.push(['at',...a]);},rotate(...a){calls.push(['angle',...a]);},drawImage(...a){materials.push(a[0].src);calls.push(['image',...a.slice(1)]);}};
  const view={sides:[{x:2,y:3,fx:1,fy:0,active:0},{x:6,y:3,fx:-1,fy:0,active:0}],projectiles:[]};
  try {run({r,ctx,calls,materials,view,fx:new SuppliedEffects(r)});} finally {globalThis.Image=old;}
}

test('every native move profile matches actual RT shape and valid nonempty sprite material',()=>{
  const shapes=new Set();
  assert.equal(Object.keys(catalog.profiles).length,new Set(Dex.moves.all().filter(m=>m.exists).map(m=>m.id)).size);
  for(const [id,p] of Object.entries(catalog.profiles)) {
    assert.deepEqual(p,effectProfile(rtMove(id)));shapes.add(p.shape);
    for(const phase of ['prepare','travel','impact','area','contact'])assert.ok(art.sprites[p[phase]],`${id}:${phase}`);
  }
  assert.deepEqual([...shapes].sort(),['beam','burst','cone','dash','drop','field','self','shot','strike','wave']);
  assert.equal(catalog.profiles.firepunch.contact,'fx-bw-fist');
  assert.equal(catalog.profiles.bite.contact,'fx-bw-teeth');
  assert.equal(catalog.profiles.surf.area,'fx-bw-wave');
  assert.equal(catalog.profiles.splash.available,false);
  harness(({fx})=>{
    assert.equal(fx.material('weatherball','Water','shot').type,'Water');
    assert.equal(fx.material('hiddenpowerfire','Fire','shot').travel,'fx-rt-fire-jet');
  });
});

test('default RT Vfx draws supplied impacts without selecting pixel particles',()=>harness(({r,ctx,calls,view})=>{
  assert.notEqual(particleStyle(),'pixel');
  const vfx=new Vfx(r);vfx.supplied.impact('waterpulse','Water',6,3);
  vfx.update(.1,view);vfx.drawOver(ctx,view,{sides:view.sides});
  assert.ok(calls.some(c=>c[0]==='image'));
}));

test('remaining supplied motifs reach real move phases rather than unused metadata',()=>harness(({fx,ctx,materials,view})=>{
  const examples={payday:'coins',bonemerang:'bone-spin',swordsdance:'sword',geargrind:'gears',
    petalblizzard:'petals',sludgebomb:'sludge',dracometeor:'meteor',icepunch:'ice-fist',
    calmmind:'psychic-rings',moonblast:'moon',steameruption:'smoke',triattack:'tri-colors'};
  for(const [move,material] of Object.entries(examples)) {
    materials.length=0;fx.queue=[];
    const p=catalog.profiles[move],id='fx-rt-'+material;
    assert.equal(p.selection,'move');
    if(p.shape==='self') fx.event({k:'use',s:0,move},{sides:view.sides});
    else if(['strike','dash'].includes(p.shape))fx.contact(move,p.type,2,3);
    else if(['burst','cone','drop','field'].includes(p.shape))fx.area(move,p.type,2,3,2);
    else view.projectiles=[{id:move,move,type:p.type,shape:p.shape,x:3,y:3}];
    fx.update(0);fx.draw(ctx,view);
    assert.ok(materials.includes(art.sprites[id].image),move);
    view.projectiles=[];
  }
  assert.ok(Object.values(catalog.profiles).filter(p=>p.available&&p.selection==='move').length>350);
}));

test('PMD overlays follow real status, confusion, cure, switch, faint and replay state without events',()=>harness(({fx,ctx,calls,materials})=>{
  const sets=[{species:'Mew',moves:['Tackle']},{species:'Pikachu',moves:['Tackle']}];
  const b=new RtBattle({seed:'pmd-status',format:'gen9customgame',p1:{sets},p2:{sets}});
  const side=b.sides[0],mon=b.mon(side);
  const draw=()=>{calls.length=0;materials.length=0;const v=b.view();fx.update(0,v);fx.draw(ctx,v);return materials.slice();};
  for(const status of ['brn','psn','tox','par','slp','frz']) {
    b.setStatus(side,status,undefined,{force:true});
    assert.equal(mon.status,status);
    const before=JSON.stringify({view:b.view(),events:b.events});
    assert.ok(draw().includes(art.sprites[catalog.statuses[status].sprite].image));
    assert.equal(JSON.stringify({view:b.view(),events:b.events}),before);
    const first=structuredClone(calls);draw();assert.deepEqual(calls,first,'paused');
    b.cure(side);assert.equal(draw().length,0,'cured immediately');
  }
  b.confuse(side);assert.ok(draw().includes(art.sprites['fx-status-confusion'].image));
  b.t=side.vol.confusedUntil;assert.equal(draw().length,0,'confusion deadline');
  mon.status='brn';side.active=1;side.vol={};assert.equal(draw().length,0,'bench status stays on bench');
  side.active=0;mon.fainted=true;assert.equal(draw().length,0,'faint');
  mon.fainted=false;b.ended=true;assert.equal(draw().length,0,'end');
}));

test('PMD overlays cover both doubles slots and visible mass units; reduced motion freezes source frame',()=>harness(({fx,ctx,calls,materials,r})=>{
  const sides=[{mons:[{status:'brn'},{status:'frz'}],units:[{active:0,x:2,y:3},{active:1,x:5,y:3,confused:true}]}];
  const view={sides,doubles:true,projectiles:[],seconds:1};
  fx.update(0,view);fx.draw(ctx,view,true);
  assert.equal(materials.length,3);const first=structuredClone(calls);
  calls.length=0;fx.update(0,{...view,seconds:3});fx.draw(ctx,view,true);assert.deepEqual(calls,first);
  materials.length=0;fx.draw(ctx,{sides:[],projectiles:[],statusUnits:[{x:4,y:4,status:'psn',size:1},{x:5,y:5,status:'frz',fainted:true}]});
  assert.deepEqual(materials,[art.sprites['fx-status-poison'].image]);
  materials.length=0;fx.draw(ctx,{...view,sides:[{...sides[0],units:[{active:0,x:2,y:3,vacant:true}]}]});assert.equal(materials.length,0);
  r.portrait=true;calls.length=0;fx.draw(ctx,view,true);
  assert.equal(calls.filter(c=>c[0]==='angle'&&c[1]===Math.PI/2).length,2,'indicators stay upright around each portrait fighter');
}));

test('beams follow their real endpoints, while contact, cones, bursts, drops and status render',()=>harness(({ctx,calls,view,fx})=>{
  const battle={sides:view.sides};const before=JSON.stringify(battle);
  fx.event({k:'shot',s:0,id:'ray',move:'flamethrower',type:'Fire',shape:'beam',x:2,y:3},battle);
  view.projectiles=[Object.freeze({id:'ray',move:'flamethrower',type:'Fire',shape:'beam',x:6,y:3,r:.55})];
  Object.freeze(view.projectiles);
  fx.update(.12);fx.draw(ctx,view);
  assert.ok(calls.filter(c=>c[0]==='image').length>3);
  assert.ok(calls.filter(c=>c[0]==='at').every(c=>c[1]>=60&&c[1]<=180));
  for(const [move,kind] of [['firepunch','contact'],['surf','burst'],['heatwave','cone'],['thunder','drop'],['recover','self'],['spikes','field']]) {
    const effect=new SuppliedEffects(fx.r);calls.length=0;
    if(kind==='contact')effect.contact(move,'Fire',2,3,1,0);
    else if(['self','field'].includes(kind))effect.event({k:'use',s:0,move},battle);
    else effect.area(move,catalog.profiles[move].type,2,3,3,kind==='cone'?.5:-1,1,0,kind==='drop');
    effect.update(.1);effect.draw(ctx,{sides:view.sides,projectiles:[]});
    assert.ok(calls.some(c=>c[0]==='image'),move);
    for(const c of calls)assert.ok(c.slice(1).every(Number.isFinite));
  }
  assert.equal(JSON.stringify(battle),before);
}));

test('sprite phases freeze with pause, reduce motion, cancel charge and expire; reset owns no battle state',()=>harness(({ctx,calls,view,fx})=>{
  const battle={sides:view.sides};
  fx.event({k:'windup',s:0,move:'solarbeam',ticks:48},battle);fx.update(.2);
  fx.draw(ctx,view);const paused=structuredClone(calls);calls.length=0;
  fx.update(0);fx.draw(ctx,view);assert.deepEqual(calls,paused);
  calls.length=0;fx.draw(ctx,view,true);const reduced=structuredClone(calls);calls.length=0;
  fx.update(.1);fx.draw(ctx,view,true);assert.deepEqual(calls,reduced);
  fx.event({k:'flinch',s:0},battle);calls.length=0;fx.draw(ctx,view);assert.equal(calls.length,0);
  fx.impact('waterpulse','Water',5,4);fx.update(1);calls.length=0;fx.draw(ctx,view);assert.equal(calls.length,0);
  assert.equal(new SuppliedEffects(fx.r).queue.length,0);
}));

test('mass battle material hooks and draw budget remain bounded under dense attacks',()=>harness(({ctx,calls,view,r})=>{
  const vfx=new Vfx(r);
  vfx.areaAt('surf','Water',4,4,4);vfx.rayAt('a','thunderbolt','Electric',1,1,9,1);
  vfx.meleeAt('firepunch','Fire',4,4,1,0);vfx.hitAt('bite','Dark',5,4);
  assert.equal(vfx.supplied.queue.length,4);
  for(let i=0;i<200;i++)vfx.supplied.area('blizzard','Ice',4,4,4);
  assert.equal(vfx.supplied.queue.length,128);
  vfx.supplied.update(.1);vfx.supplied.draw(ctx,view);
  assert.equal(calls.filter(c=>c[0]==='image').length,256);
}));

test('replay speed uses the public battle clock and seeking never restarts old impacts',()=>harness(({ctx,calls,view,fx})=>{
  const battle={t:15,sides:view.sides};
  fx.event({k:'windup',s:0,move:'solarbeam',ticks:48,t:15},battle);
  fx.update(.5,{...view,seconds:.7});fx.draw(ctx,view);const first=structuredClone(calls);
  calls.length=0;fx.update(.5,{...view,seconds:.7});fx.draw(ctx,view);assert.deepEqual(calls,first);
  const seek=new SuppliedEffects(fx.r);
  seek.event({k:'hit',s:1,move:'firepunch',t:15},{...battle,t:300});
  seek.update(0,{...view,seconds:10});calls.length=0;seek.draw(ctx,view);assert.equal(calls.length,0);
  seek.event({k:'windup',s:0,move:'firepunch',ticks:7,t:0},{...battle,t:300});
  seek.event({k:'use',s:0,move:'firepunch',t:7},{...battle,t:300});
  seek.update(0,{...view,seconds:10});calls.length=0;seek.draw(ctx,view);assert.equal(calls.length,0);
}));

test('cardinal cones and windups keep the real facing axis, including zero horizontal direction',()=>harness(({r,ctx,calls,view})=>{
  for(const [ax,ay] of [[0,1],[0,-1],[1,0],[-1,0]]) {
    for(const reduced of [false,true]) {
      const effect=new SuppliedEffects(r);calls.length=0;
      effect.area('heatwave','Fire',5,5,4,.55,ax,ay);effect.update(.2);effect.draw(ctx,view,reduced);
      const points=calls.filter(c=>c[0]==='at').map(c=>[c[1]/r.scale-5,(c[2]+.6*r.scale)/r.scale-5]);
      assert.equal(points.length,reduced?8:18);
      assert.ok(points.every(([x,y])=>x*ax+y*ay>0),'cone stays in front of the actual facing');
      assert.ok(Math.abs(points.reduce((sum,[x,y])=>sum-x*ay+y*ax,0)/points.length)<1e-9,'cone remains centred on its real axis');
    }
    const effect=new SuppliedEffects(r);calls.length=0;
    const unit={...view.sides[0],x:5,y:5,fx:ax,fy:ay};
    effect.event({k:'windup',s:0,move:'solarbeam',ticks:48},{sides:[unit]});effect.update(.2);effect.draw(ctx,{...view,sides:[unit]});
    const points=calls.filter(c=>c[0]==='at');
    assert.equal(points.length,2);
    assert.equal(points[1][1],(5+ax*.6)*r.scale,'windup preserves horizontal facing');
    assert.equal(points[1][2],(5+ay*.6)*r.scale-.6*r.scale,'windup preserves vertical facing');
  }
}));
