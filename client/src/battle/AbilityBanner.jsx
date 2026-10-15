import React, {useEffect, useState} from "react";
import {nameOf} from "./dex.js";
import {battleT} from "./strings.js";

function Lane({notices, side, lang, align, resetKey}) {
  const [queue,setQueue] = useState([]);
  const [seen,setSeen] = useState(()=>new Set());
  useEffect(()=>{setQueue([]);setSeen(new Set());},[resetKey,side]);
  useEffect(()=>{
    const fresh = notices.filter(e=>e.side === side && !seen.has(e.id));
    if (!fresh.length) return;
    setSeen(old=>new Set([...old,...fresh.map(e=>e.id)]));
    setQueue(old=>[...old,...fresh]);
  },[notices,side,seen]);
  const current=queue[0];
  useEffect(()=>{
    if (!current) return;
    const timer=setTimeout(()=>setQueue(old=>old.slice(1)),2400);
    return ()=>clearTimeout(timer);
  },[current?.id]);
  return <div className={`b-ability-lane is-${align}`} role="status" aria-live="polite" aria-atomic="true">
    {current && <div className="b-ability-banner" key={current.id}>
      <span className="b-ability-caption">{battleT(lang)("ability_activated")}</span>
      <strong>{nameOf("ability",current.ability,lang)}</strong><span>{current.pokemon}</span>
    </div>}
  </div>;
}

export default function AbilityBanner({notices = [], lang = "es", me = "p1", resetKey = ""}) {
  return <><Lane notices={notices} side={me} lang={lang} align="left" resetKey={resetKey}/>
    <Lane notices={notices} side={me === "p1"?"p2":"p1"} lang={lang} align="right" resetKey={resetKey}/></>;
}
