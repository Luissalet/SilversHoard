// The battle log's official wording (client/src/battle/text): the simulator's own messages in Spanish (Spain) and English, filled in
// by its client's text parser with our names; protocol.js keeps its own sentence where there is no translation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyLine, stateAt } from "../../client/src/battle/protocol.js";
import { officialText, tidy } from "../../client/src/battle/text/logtext.js";
import { BattleText } from "../../client/src/battle/text/battle-text.gen.js";
import { nameOf } from "../../client/src/battle/dex.js";

const LOG = [
  "|player|p1|Luis|", "|player|p2|Lance|", "|gametype|singles", "|gen|9", "|start",
  "|switch|p1a: Venusaur|Venusaur, L50, M|100/100", "|switch|p2a: Dragonite|Dragonite, L50, M|100/100", "|turn|1",
  "|move|p1a: Venusaur|Leech Seed|p2a: Dragonite", "|-start|p2a: Dragonite|move: Leech Seed",
  "|-weather|Sandstorm|[from] ability: Sand Stream|[of] p2a: Dragonite",
  "|-sidestart|p2: Lance|move: Stealth Rock",
  "|-activate|p2a: Dragonite|move: Protect",
  "|-damage|p1a: Venusaur|80/100|[from] Stealth Rock",
  "|-damage|p1a: Venusaur|70/100",
  "|-heal|p1a: Venusaur|76/100|[from] item: Leftovers",
  "|cant|p1a: Venusaur|slp",
  "|-enditem|p1a: Venusaur|Sitrus Berry|[eat]",
  "|-supereffective|p2a: Dragonite",
];

function texts(lang, me = "p1") {
  const st = stateAt([], 0);
  return LOG.map((l) => applyLine(st, l, { lang, me })?.text || "");
}

test("the tables have the Spanish and English messages, without descriptions", () => {
  assert.ok(Object.keys(BattleText.es.Moves).length > 900 && Object.keys(BattleText.en.Moves).length > 900);
  assert.equal(BattleText.es.Moves.leechseed.start, "  ¡{POKEMON} ha sido infectado!");
  assert.equal(BattleText.en.Moves.leechseed.start, "  {POKEMON} was seeded!");
  assert.equal(JSON.stringify(BattleText).includes('"desc"'), false);
  assert.equal(JSON.stringify(BattleText).includes('"shortDesc"'), false);
});

test("Spanish log: the official sentences, with the foe called «rival» and contractions", () => {
  const t = texts("es");
  assert.equal(t[8], "¡Venusaur ha usado Drenadoras!".replace("Drenadoras", nameOf("move", "Leech Seed", "es")));
  assert.equal(t[9], "¡El Dragonite rival ha sido infectado!");
  assert.equal(t[10], `[${nameOf("ability", "Sand Stream", "es")} del Dragonite rival] ¡Se ha desatado una tormenta de arena!`);
  assert.equal(t[11], "¡El lado rival está rodeado de piedras puntiagudas!");
  assert.equal(t[12], "¡El Dragonite rival se ha protegido!");
  assert.match(t[13], /^¡Unas piedras puntiagudas han dañado a Venusaur! \(−20%\)$/);
  assert.equal(t[14], "Venusaur ha perdido el 10% de su salud.");           // plain damage keeps our sentence (in the same tense)
  assert.match(t[15], /^¡Venusaur ha recuperado unos pocos PS gracias a (los|las|el|la) .+! \(\+6%\)$/);
  assert.equal(t[16], "¡Venusaur está dormido como un tronco!");
  assert.match(t[17], /Venusaur/);                                         // no Spanish message for eating a berry: ours stays
  assert.doesNotMatch(t[17], /\bate\b/);
  assert.equal(t[18], "¡Es supereficaz!");
});

test("English log and the other side's point of view", () => {
  const t = texts("en");
  assert.equal(t[9], "The opposing Dragonite was seeded!");
  assert.match(t[17], /Venusaur ate its Sitrus Berry/);
  const other = texts("es", "p2");
  assert.equal(other[9], "¡Dragonite ha sido infectado!");
  assert.equal(other[11], "¡Tu lado está rodeado de piedras puntiagudas!");
});

test("odd lines never break the log", () => {
  const st = stateAt([], 0);
  assert.equal(officialText(st, "|-activate|", { lang: "es" }), "");
  assert.equal(officialText(st, "not a protocol line", { lang: "es" }), "");
  assert.equal(officialText(st, "|-start|p9z: ???|move: Nothing At All", { lang: "es" }), "");
  assert.equal(tidy("  ¡el X rival de el lado!\n  (a el Y)", "es"), "¡El X rival del lado! (Al Y)");
});

test("names PokeAPI lacks come from the simulator's Spanish texts", () => {
  const z = BattleText.es.Moves.infernooverdrive?.name;
  assert.ok(z && z !== "Inferno Overdrive", "the table names it");
  assert.equal(nameOf("move", "Inferno Overdrive", "es"), z);
  assert.equal(nameOf("move", "Inferno Overdrive", "en"), "Inferno Overdrive");
});

test("Hidden Power reads with its type in Spanish", () => {
  assert.equal(nameOf("move", "Hidden Power Fighting", "es"), `${nameOf("move", "Hidden Power", "es")} ${nameOf("type", "Fighting", "es")}`);
  assert.equal(nameOf("move", "Hidden Power Fighting", "en"), "Hidden Power Fighting");
});
