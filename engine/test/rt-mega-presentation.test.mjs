import test from 'node:test';
import assert from 'node:assert/strict';
import {MegaPresentation} from '../../client/src/battle/rt/mega-presentation.js';

const event=(s=0)=>({t:574,k:'mega',s,slot:3,from:'Swampert',species:'Swampert-Mega'});
test('simultaneous transformations keep both announcements and pause keeps the current one',()=>{
  const presentation=new MegaPresentation();
  presentation.add(event(),null,'¡Megaevolución!');
  presentation.add(event(1),null,'¡Megaevolución!');
  presentation.update(.5);
  assert.equal(presentation.current.side,0);
  const age=presentation.current.age;
  presentation.update(0);
  assert.equal(presentation.current.age,age);
  presentation.update(2);
  assert.equal(presentation.current.side,1,'the other side cannot overwrite the first announcement');
  presentation.update(2.4);
  assert.equal(presentation.current,null);
});

test('the caption and the actual Mega picture remain visible with reduced motion',()=>{
  const presentation=new MegaPresentation(),text=[],images=[];
  const ctx=new Proxy({globalAlpha:1,measureText:s=>({width:s.length*5}),
    fillText:s=>text.push(s),drawImage:img=>images.push(img)}, {get:(o,k)=>o[k]??(()=>{})});
  const img={width:96,height:96,src:'Swampert-Mega-shiny'};
  presentation.add(event(),{ready:true,img},'Mega Evolution!');
  presentation.update(.2);
  presentation.draw(ctx,390,220,true);
  assert.deepEqual(text,['Mega Evolution!','Swampert → Swampert-Mega']);
  assert.deepEqual(images,[img]);
  assert.equal(ctx.globalAlpha,1);
  text.length=0;
  presentation.draw(ctx,390,220,true,'¡Megaevolución!');
  assert.equal(text[0],'¡Megaevolución!','the current language is applied without restarting or consuming the queue');
  assert.equal(presentation.current.age,.2);
});

test('the transformation burst belongs to its doubles unit and party slot',()=>{
  const presentation=new MegaPresentation();
  let rings=0;
  const ctx=new Proxy({globalAlpha:1,ellipse:()=>rings++},{get:(o,k)=>o[k]??(()=>{})});
  presentation.add({...event(1),u:1},null,'¡Megaevolución!');
  presentation.update(.2);
  for(const [side,unit,slot] of [[1,0,3],[0,1,3],[1,1,2]])presentation.drawBurst(ctx,10,20,20,side,unit,slot,false);
  assert.equal(rings,0);
  presentation.drawBurst(ctx,10,20,20,1,1,3,false);
  assert.equal(rings,1);
  presentation.update(1);
  presentation.drawBurst(ctx,10,20,20,1,1,3,false);
  assert.equal(rings,1,'the burst expires independently of the readable caption');
});
