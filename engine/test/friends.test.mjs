import test from "node:test";
import assert from "node:assert/strict";
import { decodeSignal, encodeSignal } from "../../client/src/friends/peer.js";
import { duelRules, duelTeam, HostedDuel } from "../../client/src/friends/duel.js";

const settings = duelRules({
  name: "Copa de nivel 50",
  format: "gen9customgame",
  rules: ["-Pikachu"],
  level_rules: { level: 50 },
});

test("friends invite transports rules and accepts the matching response only", () => {
  const id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const offer = { type: "offer", sdp: "example" };
  const invite = encodeSignal(id, offer, settings);
  assert.deepEqual(decodeSignal("https://example.test/friends/#" + invite, "offer"), { id, description: offer, settings });
  assert.throws(() => decodeSignal(invite, "answer"));
  const answer = encodeSignal(id, { type: "answer", sdp: "another example" });
  assert.throws(() => decodeSignal(answer, "answer", "bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee"));
  assert.equal(decodeSignal(answer, "answer", id).id, id);
});

test("friends duel applies imported rules, sends separate player views and accepts concurrent choices", () => {
  assert.throws(() => duelTeam(settings, "A", "Pikachu\n- Thunderbolt"), /Pikachu/);
  const a = duelTeam(settings, "A", "Charmander @ Charcoal\n- Scratch");
  const b = duelTeam(settings, "B", "Squirtle @ Mystic Water\n- Tackle");
  const duel = new HostedDuel(settings, a, b);
  let left = duel.state("p1");
  let right = duel.state("p2");
  assert.doesNotMatch(JSON.stringify(right), /charcoal|scratch/i);
  assert.doesNotMatch(JSON.stringify(left), /mystic water|tackle/i);
  if (left.request.teamPreview) {
    duel.play("p1", { revision: left.revision, choice: "team 1" });
    duel.play("p2", { revision: right.revision, choice: "team 1" });
    left = duel.state("p1");
    right = duel.state("p2");
    assert.ok(right.lines.some((line) => line.includes(", L50")));
  }
  duel.play("p1", { revision: left.revision, choice: "move 1" });
  assert.throws(() => duel.play("p1", { revision: left.revision, choice: "move 1" }), /stale/);
  duel.play("p2", { revision: right.revision, choice: "move 1" });
  assert.ok(duel.state("p2").lines.some((line) => line.includes("|move|")));
  left = duel.state("p1");
  duel.play("p1", { revision: left.revision, choice: "forfeit" });
  assert.equal(duel.state("p2").winner, "B");
});
