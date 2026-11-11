import { applyLevelRules, buildFormatId, formatInfo, importTeam, validateTeam } from "../../../engine/src/core.mjs";
import { Match } from "../../../engine/src/match.mjs";

const LEVEL_KEYS = ["level", "level_min", "level_cap"];

export function duelRules(input) {
  const { name, format, rules, level_rules } = input || {};
  if (typeof name !== "string" || !name.trim() || name.length > 80
      || typeof format !== "string" || !format.trim() || format.length > 120
      || !Array.isArray(rules) || rules.length > 20
      || rules.some((rule) => typeof rule !== "string" || !rule.trim() || rule.length > 80)
      || !level_rules || typeof level_rules !== "object" || Array.isArray(level_rules)
      || Object.entries(level_rules).some(([key, value]) => !LEVEL_KEYS.includes(key) || !Number.isInteger(value) || value < 1 || value > 100)
      || (level_rules.level_min ?? 1) > (level_rules.level_cap ?? 100)) throw new Error("ruleset");
  const fid = buildFormatId(format, rules);
  const info = formatInfo(fid);
  if (info.random || !["singles", "doubles"].includes(info.game_type)) throw new Error("ruleset");
  return { name: name.trim(), format: info.id, rules, level_rules };
}

export function duelTeam(settings, name, paste) {
  if (typeof name !== "string" || !name.trim() || name.length > 40
      || typeof paste !== "string" || !paste.trim() || paste.length > 16000) throw new Error("team");
  const sets = importTeam(paste);
  const fid = buildFormatId(settings.format, settings.rules);
  const result = validateTeam(fid, applyLevelRules(sets, settings.level_rules));
  if (!result.ok) throw new Error(result.problems.join(" · "));
  return { name: name.trim(), sets };
}

export class HostedDuel {
  constructor(settings, p1, p2) {
    this.names = { p1: p1.name, p2: p2.name };
    this.match = new Match({ format: settings.format, rules: settings.rules, level_rules: settings.level_rules, p1, p2 });
    this.match.advance();
    this.revisions = { p1: 0, p2: 0 };
    this.offsets = { p1: 0, p2: 0 };
  }

  state(side) {
    const view = this.match.state(side, this.offsets[side]);
    this.offsets[side] = view.log_length;
    return {
      names: this.names, revision: this.revisions[side], request: view.requests[side] || null,
      lines: view.lines, ended: view.ended, winner: this.names[view.winner_side] || "", turn: view.turn,
    };
  }

  play(side, { choice, revision }) {
    if (revision !== this.revisions[side]) throw new Error("stale");
    if (choice === "forfeit") this.match.forfeit(side);
    else {
      if (typeof choice !== "string" || choice.length > 160 || !/^(team |move |switch |pass)/.test(choice)) throw new Error("choice");
      const request = this.match.state(side, this.match.battle.log.length).requests[side];
      if (!request || request.done) throw new Error("choice");
      this.match.choose(side, choice);
    }
    this.revisions[side]++;
  }
}
