import test from 'node:test';
import assert from 'node:assert/strict';
import {ArenaRenderer} from '../../client/src/battle/rt/render.js';

test('Dynamax scales the selected PMD animation uniformly at the same feet, including reduced motion and return',()=>{
  const old={window:globalThis.window,document:globalThis.document,Image:globalThis.Image};
  const ctx=new Proxy({globalAlpha:1,measureText:()=>({width:20})},{get(o,k){return k in o?o[k]:()=>{};}});
  globalThis.window={devicePixelRatio:1,innerHeight:800};globalThis.document={createElement:()=>({getContext:()=>ctx})};
  globalThis.Image=class {set src(s){this.url=s;this.width=this.height=96;this.onload?.();}};
  try {
    for(const shiny of [false,true]) {
      const m={species:'Pikachu',num:25,forme:'',sprite_id:'pikachu',shiny,hp:100,maxhp:100};
      const r=new ArenaRenderer({style:{},clientWidth:640,getContext:()=>ctx},{sides:[{mons:[m]}],sprites:{fallback:()=>''}});
      r.show={hides:()=>false};const calls=[];
      const anim=label=>({start(){},loop(){},busy:()=>false,update(){},height:k=>24*k,draw(c,x,y,row,k){calls.push({label,x,y,k});return true;}});
      r.anims[0][0]=anim('base');r.dynamaxAnims[0][0]=anim('gmax');
      const side={active:0,mons:[m],x:8,y:8,r:1,fx:1,fy:0,name:'Pika'};
      r.drawMon({version:13},side,0,0);const normal=calls.at(-1);
      Object.assign(m,{is_dynamax:true,dynamax_left:17,display_scale:2.2});
      r.drawMon({version:13},side,0,0);const giant=calls.at(-1);
      assert.equal(giant.label,'gmax');assert.equal(giant.x,normal.x);assert.equal(giant.y,normal.y);assert.equal(giant.k,normal.k*2.2);
      r.reducedMotion={matches:true};m.dynamax_left=18;r.drawMon({version:13},side,0,0);assert.equal(calls.at(-1).k,giant.k);
      m.is_dynamax=false;r.drawMon({version:13},side,0,0);assert.deepEqual(calls.at(-1),normal);
    }
  } finally {Object.assign(globalThis,old);}
});
