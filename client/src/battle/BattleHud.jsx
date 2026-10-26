import React, {useEffect, useRef, useState} from 'react';
import {healthFraction, PortraitReaction} from './portrait-reaction.js';
import {toID, nameOf} from './dex.js';
import BALLS from './ball-icons.gen.js';
import './hud.css';

export function HealthBar({mon, label = '', compact = false}) {
  const fraction = healthFraction(mon);
  return <div className={`hud-health ${compact ? 'is-compact' : ''}`} role="meter" aria-label={[mon?.name || mon?.species,label].filter(Boolean).join(' · ')}
    aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fraction*100)}
    style={{'--health':fraction,'--health-color':fraction > .5 ? 'var(--hp-ok)' : fraction > .2 ? 'var(--hp-mid)' : 'var(--hp-low)'}}>
    <div className="hud-health-track"><i className="hud-health-lag"/><span className="hud-health-fill"/></div>
  </div>;
}

export function BallIcon({ball = 'pokeball', state = '', title = '', lang = 'es'}) {
  const id = toID(ball || 'pokeball'), source = BALLS[id];
  const label = title || nameOf('item',ball || 'Poké Ball',lang);
  return <span className={`hud-ball ${state}`} title={label} aria-label={label}>
    {source ? <img src={source} alt="" draggable={false}/> : <span className="hud-ball-unknown">?</span>}
  </span>;
}

function FaceImage({mon, sprites, emotion}) {
  const [step,setStep] = useState(0);
  const source = step < 2 ? sprites?.portrait?.(mon.species,step ? 'Normal' : emotion,{num:mon.num || 0,shiny:!!mon.shiny}) : '';
  const src = source || sprites?.fallback?.(mon.species,{shiny:!!mon.shiny});
  return step > 2 || !src ? <span className="hud-face-missing" aria-label={mon.species}>{mon.species.slice(0,2)}</span>
    : <img className="hud-face" src={src} alt="" draggable={false} onError={()=>setStep(s=>s+1)}/>;
}

export default function BattleHud({mon, sprites, identity, epoch = 0, time, action, confused, outcome, event, eventId, corner = 'left', lang = 'es',
  levelLabel = 'Nv.', healthLabel = 'PS', exact = true, party = null, children = null}) {
  const reaction = useRef(null);
  reaction.current ||= new PortraitReaction();
  useEffect(()=>{
    if (!mon || !sprites?.portrait) return;
    for (const emotion of ['Normal','Happy','Pain','Angry','Worried','Sad','Crying','Shouting','Teary-Eyed','Determined','Joyous','Inspired','Surprised','Dizzy','Sigh','Stunned']) {
      const image = new Image();
      image.src = sprites.portrait(mon.species,emotion,{num:mon.num || 0,shiny:!!mon.shiny});
    }
  },[mon?.species,mon?.num,mon?.shiny,sprites]);
  if (!mon) return null;
  const emotion = reaction.current.sample(mon,{identity,epoch,time,action,confused,outcome,event,eventId});
  const fraction = healthFraction(mon);
  return <div className={`battle-hud corner-${corner} ${mon.fainted || mon.hp <= 0 ? 'is-fainted' : ''}`} data-emotion={emotion}>
    <div className="hud-portrait">
      <FaceImage key={`${identity}:${mon.species}:${!!mon.shiny}:${emotion}`} {...{mon,sprites,emotion}}/>
    </div>
    <div className="hud-data">
      <div className="hud-name-row"><b title={mon.name || mon.species}>{mon.name || mon.species}</b>
        {mon.gender && <span className={`b-gender g-${mon.gender}`}>{mon.gender === 'M' ? '♂' : '♀'}</span>}
        <span className="hud-level">{levelLabel}{mon.level}</span></div>
      <div className="hud-party-row">{party || <BallIcon ball={mon.pokeball} lang={lang}/>}</div>
      <HealthBar mon={mon} label={healthLabel}/>
      <div className="hud-health-numbers"><span>{healthLabel}</span><b>{exact ? `${Math.max(0,mon.hp)}/${mon.maxhp}` : `${Math.round(fraction*100)}%`}</b></div>
      <div className="hud-states">{children}</div>
    </div>
  </div>;
}
