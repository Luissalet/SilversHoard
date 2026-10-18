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
// Inspected Sky sequences. A move's material is applied to its actual RT shape,
// including self/field and contact, rather than just cataloguing an unused shot.
const MATERIALS = [
  ['coins','payday makeitrain'], ['coin-bag','happyhour'],
  ['bones','boneclub bonerush shadowbone'], ['bone-spin','bonemerang'],
  ['sword','swordsdance secretsword sacredsword behemothblade'],
  ['gears','geargrind shiftgear'], ['metal-ball','ironhead steelroller heavyslam hardpress'],
  ['gyro','gyroball'], ['cross-slash','xscissor crosschop dualchop'],
  ['needle','pinmissile twineedle fellstinger poisonsting'],
  ['feather-cut','airslash aerialace wingattack dualwingbeat'],
  ['wing-slash','aircutter razorwind aeroblast'],
  ['crescent','slash nightslash psychocut stoneaxe ceaselessedge kowtowcleave'],
  ['leaf-blade','leafblade razorleaf bitterblade solarblade'],
  ['razor-leaf','magicalleaf leafage'], ['leaf-sphere','energyball seedbomb'],
  ['leaf-vortex','leaftornado leafstorm'], ['green-hit','vinewhip powerwhip branchpoke'],
  ['petals','petaldance petalblizzard flowertrick'],
  ['flowers','floralhealing aromatherapy flowershield'],
  ['pollen','pollenpuff ragepowder stunspore poisonpowder sleeppowder cottonspore'],
  ['seedlings','ingrain grassknot grassyglide trailblaze'],
  ['leech','leechseed gigadrain megadrain absorb strengthsap hornleech'],
  ['shell','withdraw shellsmash shellsidearm shelltrap defensecurl rollout'],
  ['sand','sandattack sandstorm sandtomb scorchingsands sandsearstorm'],
  ['dig','dig stompingtantrum fissure'], ['rock-pile','rockblast rockthrow smackdown'],
  ['rock-tomb','rocktomb rockwrecker meteorbeam'], ['stones','ancientpower rockpolish'],
  ['mud-bombs','mudbomb mudshot mudslap'], ['thorns','spikyshield banefulbunker'],
  ['fire-orb','fireblast fusionflare searingshot'], ['fire-orbs','incinerate'],
  ['fire-spin','firespin'], ['fire-wall','blastburn overheat'],
  ['fire-ring','sacredfire inferno burningjealousy'], ['flame-claw','flamewheel flamecharge blazingtorque'],
  ['fire-roll','flareblitz ragingfury'], ['fire-cross','vcreate'],
  ['burn','willowisp'], ['bubbles','bubble bubblebeam sparklingaria'],
  ['water-drops','watergun chillingwater lifedew aquaring'],
  ['water-lance','waterfall aquatail flipturn aquacutter liquidation'],
  ['water-orb','waterpulse originpulse hydrocannon snipeshot'],
  ['water-vortex','whirlpool waterspout aquastep'], ['bubble-ring','brine soak'],
  ['mist','mist haze clearsmog defog'], ['cloud','smokescreen'],
  ['smoke','steameruption scald'], ['rain','raindance chillyreception'],
  ['ice-comets','iceball iceburn freezeshock glaciallance'],
  ['ice-orbs','frostbreath powdersnow'], ['snow-cloud','snowscape hail auroraveil'],
  ['ice-crystal','freezedry sheercold iciclecrash'], ['ice-fist','icepunch'],
  ['snow','blizzard icywind'], ['electric-ring','thunderwave magneticflux charge'],
  ['electric-blue','fusionbolt boltstrike'], ['light-sparks','spark nuzzle zingzap wildcharge'],
  ['blue-ring','shockwave risingvoltage electroball'], ['electric-bolt','chargebeam zapcannon'],
  ['sludge','sludgebomb sludgewave sludge belch'],
  ['poison-splash','acid acidspray gunkshot toxicthread'],
  ['toxic-orb','toxic venoshock barbbarrage malignantchain'],
  ['purple-bubbles','poisongas corrosivegas mortalspin'],
  ['spoon','kinesis'], ['eye','meanlook glare miracleeye futuresight'],
  ['angry-eyes','leer scaryface torment taunt'], ['red-eyes','embargo quash'],
  ['psychic-rings','calmmind psychic psychicnoise storedpower'],
  ['psy-orbit','psybeam psywave esperwing'], ['psy-swirl','psyshock psychoboost psystrike'],
  ['psy-burst','expandingforce psychicfangs'], ['confusion','confusion supersonic confuseray teeterdance'],
  ['gravity','gravity magnetrise telekinesis'], ['orbit','cosmicpower'],
  ['hand','metronome helpinghand doubleslap armthrust forcepalm'],
  ['red-fist','machpunch bulletpunch dynamicpunch focuspunch hammerarm'],
  ['roar','roar growl howl nobleroar snarl'], ['bat','leechlife'],
  ['curse-seal','curse spite grudge'], ['spirit','lick astonish shadowsneak poltergeist'],
  ['night-orb','nightshade ominouswind astralbarrage'], ['dark-hit','suckerpunch brutalswing'],
  ['black-hole','darkvoid nightdaze hyperspacehole hyperspacefury'],
  ['purple-scythe','foulplay payback assurance retaliate'],
  ['crossbones','destinybond memento'], ['dark-flame','hex infernalparade bittermalice'],
  ['silver-wind','silverwind strugglebug attackorder defendorder healorder'],
  ['web','stickyweb electroweb spiderweb stringshot silktrap'],
  ['bug-cloud','infestation'], ['moon','moonblast moonlight lunarblessing lunardance'],
  ['heart-pair','sweetkiss lovelykiss attract decorate'],
  ['hearts','charm babydolleyes drainingkiss alluringvoice'],
  ['sparkles','dazzlinggleam glitzyglow magicaltorque'],
  ['sun-orb','sunnyday morningsun synthesis'], ['sun-lance','solarbeam solarblade'],
  ['white-ray','hyperbeam technoblast judgment'], ['pink-ray','flashcannon luminacrash lusterpurge'],
  ['solar-orb','weatherball terrainpulse'], ['energy-orb','aurasphere focusblast'],
  ['meteor','dracometeor cometpunch meteorassault meteormash'],
  ['star-trail','swift agility quickattack extremespeed accelerock'],
  ['energy-stars','swift lastresort'], ['lock-on','lockon mindreader'],
  ['target','laserfocus focusenergy'], ['tri-colors','triattack tripleaxel tripledive'],
  ['orange-ring','rapidspin mortalspin'], ['confetti','celebrate holdhands'],
  ['golden-cloud','sweetscent aromatherapy'], ['green-burst','junglehealing revivalblessing'],
];
const SPECIFIC = Object.fromEntries(MATERIALS.flatMap(([material,names])=>names.split(' ').map(id=>[id,material])));
// These source sequences are presentation motifs, not cartridge timing claims.
const MOTIONS = {petals:'spiral',coins:'rain',meteor:'rain','rock-tomb':'rain',
  gears:'orbit',sword:'orbit',bones:'spin','bone-spin':'spin','tri-colors':'triad',
  'psychic-rings':'orbit',bubbles:'bubble','water-drops':'bubble','purple-bubbles':'bubble',
  'leaf-vortex':'spiral','fire-spin':'spiral','water-vortex':'spiral'};
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
  if (SPECIFIC[id]) {
    const material=SPECIFIC[id],sprite=rt(material);
    out={...out,selection:'move',travel:sprite,impact:sprite,area:sprite,motion:MOTIONS[material]||'direct'};
    if (['strike','dash'].includes(out.shape)) out.contact=sprite;
    if (out.shape==='self' || out.charge) out.prepare=sprite;
  }
  return out;
}

export const EFFECT_TYPES = Object.freeze(Object.keys(TYPES));
export const STATUS_EFFECTS = Object.freeze({
  brn:{sprite:'fx-status-burn',placement:'body',size:1.1},
  par:{sprite:'fx-status-paralysis',placement:'body',size:1.2},
  frz:{sprite:'fx-status-freeze',placement:'body',size:1.9},
  psn:{sprite:'fx-status-poison',placement:'head',size:.65},
  tox:{sprite:'fx-status-poison',placement:'head',size:.65},
  slp:{sprite:'fx-status-sleep',placement:'head',size:.75},
  confused:{sprite:'fx-status-confusion',placement:'head',size:.65},
  taunt:{sprite:'fx-status-taunt',placement:'head',size:.65},
  protect:{sprite:'fx-status-protect',placement:'body',size:1.5},
});
