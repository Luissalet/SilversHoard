import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToString} from 'react-dom/server';
import {useBattlePlayer} from '../../client/src/battle/player.js';
import {PortraitClock, PortraitReaction, healthFraction, realtimePortraitReleases} from '../../client/src/battle/portrait-reaction.js';

const mon = (hp=100)=>({species:'Pikachu',hp,maxhp:100,shiny:false});
test('portraits react to damage/heal with battle time and reset on slot, form, colour and seek',()=>{
  const r=new PortraitReaction(), sample=(m,time,extra={})=>r.sample(m,{identity:'p1:0',time,...extra});
  assert.equal(sample(mon(),0),'Normal');
  assert.equal(sample(mon(60),1),'Pain');
  assert.equal(sample(mon(60),1),'Pain'); // pause
  assert.equal(sample(mon(60),1.7,{event:'move'}),'Pain'); // hit owns the face
  assert.equal(sample(mon(60),2,{event:'move'}),'Shouting');
  assert.equal(sample(mon(15),3),'Pain');
  assert.equal(sample(mon(15),4),'Worried');
  assert.equal(sample(mon(70),5),'Happy');
  assert.equal(sample(mon(70),6,{action:'windup'}),'Determined');
  assert.equal(sample(mon(70),.1),'Normal'); // rewind clears future pain/joy
  assert.equal(sample(mon(30),2),'Pain');
  assert.equal(sample(mon(100),2.1,{identity:'p1:1'}),'Normal');
  assert.equal(sample({...mon(100),species:'Raichu'},2.2),'Normal');
  assert.equal(sample({...mon(100),shiny:true},2.3),'Normal');
  assert.equal(sample({...mon(0),fainted:true},3),'Dizzy');
  assert.equal(sample(mon(0),3,{outcome:'win'}),'Joyous');
});

test('retained classic cues expire, pause freezes time, and every seek epoch clears inferred damage',()=>{
  let now=0; const clock=new PortraitClock(()=>now),r=new PortraitReaction();
  clock.setRunning(true);
  const sample=(m,event='hit',eventId=1,epoch=0)=>r.sample(m,{identity:'p1:0',time:clock.time,event,eventId,epoch});
  assert.equal(sample(mon()),'Pain');
  now=500; clock.setRunning(false); now=5000;
  assert.equal(clock.time,.5); assert.equal(sample(mon()),'Pain');
  clock.setRunning(true); now=6000;
  assert.equal(sample(mon()),'Normal'); // retained anim1 must not retrigger
  assert.equal(sample(mon(),'hit',2),'Pain');
  now=7000; assert.equal(sample(mon(),'hit',2),'Normal');
  assert.equal(sample(mon(80),null,null,1),'Normal'); // forward seek, new epoch
  assert.equal(sample({...mon(160),maxhp:200},null,null,1),'Normal'); // Dynamax scaling is not healing
  clock.reset(false); assert.equal(clock.time,0);
});

test('release faces belong to the actual doubles unit/party slot and presentation clock',()=>{
  const view={doubles:true,sides:[{units:[{active:1},{active:2}]},{units:[{active:0},{active:3}]}]};
  const reactions={releases:[{slot:1,time:2},{slot:1,time:2},{slot:0,time:2},null]};
  assert.deepEqual(realtimePortraitReleases(view,reactions,2.3),[[1,-1],[0,-1]]);
  assert.deepEqual(realtimePortraitReleases(view,reactions,2.3),[[1,-1],[0,-1]]);
  assert.deepEqual(realtimePortraitReleases(view,reactions,3),[[-1,-1],[-1,-1]]);
  assert.deepEqual(realtimePortraitReleases(view,reactions,1),[[-1,-1],[-1,-1]]);
  assert.equal(healthFraction(mon(-4)),0); assert.equal(healthFraction(mon(150)),1);
});

test('initial live pushes let damage faces expire while pause and seek retain their clock contracts',(t)=>{
  let now=0,player;
  t.mock.method(performance,'now',()=>now);
  function Probe() {player=useBattlePlayer({sound:false});return null;}
  renderToString(React.createElement(Probe));
  const reaction=new PortraitReaction();
  const sample=()=>{
    const side=player.state.sides.p1,active=side.team[side.active[0]];
    return reaction.sample(active,{identity:'p1:0',epoch:player.abilityEpoch,time:player.portraitTime});
  };
  try {
    player.push(['|switch|p1a: Mew|Mew, L50|100/100']);
    assert.equal(sample(),'Normal');
    player.push(['|-damage|p1a: Mew|70/100']);
    assert.equal(sample(),'Pain');
    now=1100;
    assert.equal(sample(),'Normal','the live expression must expire after its own battle clock advances');
    player.pause();
    const paused=player.portraitTime;
    now=5100;
    assert.equal(player.portraitTime,paused);
    player.play();
    now=6100;
    assert.equal(player.portraitTime,paused+1);
    player.seek(1);
    assert.equal(player.portraitTime,0);
    now=7100;
    assert.equal(player.portraitTime,0);
    assert.equal(sample(),'Normal','a paused seek must not invent damage acting');
  } finally {player.pause();}
});
