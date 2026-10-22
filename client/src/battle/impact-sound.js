// Dry contact, low-mid body and a short debris tail. No pitched reward notes or external samples.
// PCM is shared by live WebAudio, portable pages and recordings; synthesis never touches battle RNG.
export const IMPACT_VARIANTS = 4;
const PROFILES = {
  hit:      {life:.23, low:108, body:.63, decay:.045, grit:.75, crack:.16, tail:.38, peak:.80},
  super:    {life:.27, low:94,  body:.76, decay:.055, grit:.91, crack:.22, tail:.44, peak:.83},
  crit:     {life:.31, low:86,  body:.83, decay:.061, grit:1.1, crack:.32, tail:.49, peak:.86},
  resisted: {life:.18, low:120, body:.55, decay:.032, grit:.40, crack:.05, tail:.24, peak:.65},
  block:    {life:.19, low:142, body:.35, decay:.027, grit:.64, crack:.29, tail:.16, peak:.74},
};

export function makeImpact(kind, sampleRate = 48000, variant = 0) {
  const p = PROFILES[kind] || PROFILES.hit;
  const v = ((variant % IMPACT_VARIANTS) + IMPACT_VARIANTS) % IMPACT_VARIANTS;
  let seed = (0x51f15e + v * 1009 + Object.keys(PROFILES).indexOf(kind) * 7919) >>> 0;
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 2147483648 - 1; };
  const data = new Float32Array(Math.ceil(p.life * sampleRate));
  const detune = 1 + (v - 1.5) * .018;
  const pole = hz => 1 - Math.exp(-2 * Math.PI * hz / sampleRate);
  const bassPole = pole(180), bodyPole = pole(850), edgePole = pole(2600);
  const dcPole = Math.exp(-2 * Math.PI * 28 / sampleRate);
  let bass = 0, body = 0, edge = 0, phase = 0, previous = 0, dc = 0, peak = 0;
  for (let i = 0; i < data.length; i++) {
    const t = i / sampleRate, n = random();
    bass += bassPole * (n - bass);
    body += bodyPole * (n - body);
    edge += edgePole * (n - edge);
    // Small settling drift, rather than the old octave-spanning laser/kick sweep.
    phase += 2 * Math.PI * p.low * detune * (1 + .12 * Math.exp(-t / .012)) / sampleRate;
    const core = (Math.sin(phase) + .31 * Math.sin(phase * 1.71)) * p.body * Math.exp(-t / p.decay);
    const contact = (n - edge) * p.crack * Math.exp(-t / .006);
    const texture = (body - bass) * p.grit * Math.exp(-t / .025);
    const debris = bass * p.tail * Math.exp(-t / .057);
    const brace = kind === 'block' ? (Math.sin(2 * Math.PI * 431 * t) + .45 * Math.sin(2 * Math.PI * 733 * t)) * .19 * Math.exp(-t / .018) : 0;
    const fracture = kind === 'crit' && t >= .007 ? (body - bass) * .5 * Math.exp(-(t - .007) / .014) : 0;
    const raw = Math.tanh((core + contact + texture + debris + brace + fracture) * 1.65);
    dc = raw - previous + dcPole * dc; previous = raw;
    const fade = Math.min(1, (p.life - t) / .012);
    data[i] = dc * (1 - Math.exp(-t / .0007)) * fade;
    peak = Math.max(peak, Math.abs(data[i]));
  }
  // Comparable peaks make weight come from the transient/body, not a large volume jump.
  if (peak > 0) for (let i = 0; i < data.length; i++) data[i] *= p.peak / peak;
  data[data.length - 1] = 0;
  return data;
}
