// Presentation-only material selection. The simulation never imports this file.
const rt = id => `fx-rt-${id}`, bw = id => `fx-bw-${id}`, gba = id => `fx-gba-${id}`;
const TYPES = {
  Normal: ['star','impact','light'], Fire: ['fire-jet','fire-blast','fire-ring'],
  Water: ['water-column','splash','water-ring'], Electric: ['electric-bolt','electric-burst','electric-blue'],
  Grass: ['leaves','seedlings','leech'], Ice: ['icicles','ice-burst','snow'],
  Rock: ['rock','ground-erupt','stones'], Ground: ['dust','ground-erupt','stones'],
  Flying: ['air-cut','tornado','tornado'], Fighting: ['impact','impact','boost'],
  Steel: ['spikes','steel-ring','steel-ring'], Poison: ['poison-cloud','poison-pool','poison-cloud'],
  Psychic: ['psychic-orb','psychic-burst','confusion'], Ghost: ['ghost-orb','ghost-flame','ghost-flame'],
  Dark: ['dark-vortex','dark-flame','dark-pool'], Dragon: ['dragon-helix','dragon-burst','dragon-helix'],
  Bug: ['leaves','bug-cloud','web'], Fairy: ['hearts','fairy-burst','hearts'],
  Stellar: ['light','sparkles','light'],
};
const SHOTS = {ember:'ember',flameburst:'fire-burst',pyroball:'flame',thundershock:'lightning',
  powergem:'gold-sparks',iceshard:'ice-shatter',iciclespear:'ice-shatter'};
const HITS = {waterpulse:'water-orbs',bubblebeam:'water-orbs',aquajet:'water-orbs',
  aurasphere:'blue-pulse',dragonpulse:'blue-pulse',drainingkiss:'hearts',playrough:'hearts',thunderpunch:'lightning'};
const NAMED = {
  surf:{area:bw('wave')},muddywater:{area:rt('dust')},earthquake:{area:rt('ground-erupt')},
  bulldoze:{area:rt('dust')},magnitude:{area:rt('stones')},precipiceblades:{area:rt('ground-erupt')},
  blizzard:{area:rt('snow')},icywind:{area:rt('snow')},discharge:{area:rt('electric-burst')},
  paraboliccharge:{area:rt('electric-burst')},rockslide:{area:rt('rock')},stoneedge:{area:rt('spikes')},
  heatwave:{area:rt('fire-jet')},lavaplume:{area:rt('fire-column')},eruption:{area:rt('fire-column')},
  explosion:{area:rt('fire-blast'),impact:rt('fire-blast')},selfdestruct:{area:rt('fire-blast')},
  mistyexplosion:{area:rt('fairy-burst')},mindblown:{area:rt('fire-blast')},
  leafstorm:{travel:rt('leaves'),area:rt('leaves')},frenzyplant:{travel:bw('roots'),impact:rt('seedlings')},
  solarbeam:{prepare:rt('light'),travel:rt('light'),impact:rt('heal')},
  hyperbeam:{prepare:rt('light'),travel:rt('light'),impact:rt('fire-blast')},
  focusblast:{travel:gba('blue-pulse')},aurasphere:{travel:gba('blue-pulse')},
  shadowball:{travel:rt('ghost-orb')},darkpulse:{travel:rt('dark-vortex')},
  thunder:{area:bw('lightning'),impact:rt('electric-burst')},
  thunderbolt:{travel:bw('lightning'),impact:rt('electric-burst')},
  hydropump:{travel:bw('wave'),impact:rt('splash')},
  flamethrower:{travel:rt('fire-jet'),impact:rt('fire-blast')},
  icebeam:{travel:rt('icicles'),impact:rt('ice-burst')},
  drainingkiss:{travel:gba('hearts')},bugbuzz:{travel:bw('note'),area:rt('sound')},
};
const idOf = move => String(move || '').toLowerCase().replace(/[^a-z0-9]/g,'');

export function effectProfile(move) {
  const id = idOf(move.id || move.move || move.name), type = move.type || 'Normal';
  const [travel,impact,area] = TYPES[type] || TYPES.Normal;
  const flags = move.flags || {};
  const contact = flags.punch || /punch|hammer|fist|knuckle/.test(id) ? 'fist'
    : /kick|stomp|step/.test(id) ? 'foot' : flags.bite || /bite|fang|crunch|jaw/.test(id) ? 'teeth'
    : flags.slicing || /slash|claw|cut|blade|scratch/.test(id) ? 'slash'
    : /horn|peck|drill|jab|spike/.test(id) ? 'spikes' : 'impact';
  const named = !!(SHOTS[id] || HITS[id] || flags.punch || flags.bite || flags.slicing || /kick|stomp/.test(id));
  let out = {id,name:move.name || id,type,shape:move.shape || 'shot',available:!move.noEffect,
    selection:named ? 'move' : 'type-family', prepare:bw('ring'),
    travel:SHOTS[id] ? gba(SHOTS[id]) : rt(travel), impact:HITS[id] ? gba(HITS[id]) : rt(impact),
    area:rt(area),contact:['fist','foot','teeth','slash'].includes(contact) ? bw(contact) : rt(contact),
    contact_kind:contact, charge:!!flags.charge, tint_contact:contact !== 'teeth'};
  if (flags.sound) out = {...out,travel:bw('note'),area:rt('sound'),impact:rt('sound')};
  if (/sleep|hypnosis|spore|sing|yawn/.test(id) || move.status === 'slp') out.travel=rt('sleep');
  if (move.shape === 'self') {
    out.area = move.heal || /recover|roost|wish|rest|synthesis|moonlight|morningsun|heal|milkdrink|softboiled|slackoff|shoreup/.test(id)
      ? rt('heal') : move.stalling ? bw('shield') : rt('boost');
  }
  if (move.shape === 'field') out.area = move.sideCondition?.includes('spikes') ? rt('spikes') : rt(area);
  if (/spiderweb|stringshot|stickyweb|electroweb/.test(id)) out.area=rt('web');
  if (id === 'swift') out.travel=rt('star');
  if (NAMED[id]) out={...out,...NAMED[id],selection:'move'};
  return out;
}

export const EFFECT_TYPES = Object.freeze(Object.keys(TYPES));
