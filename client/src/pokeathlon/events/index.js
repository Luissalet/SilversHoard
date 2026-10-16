// All ten events of the Pokéathlon, by id (the ids of the game, in its order: 0 Hurdle Dash ... 9 Goal Roll). A module that still starts
// with "// PLACEHOLDER" is a stand-in for an event that is not written yet; writing the real one at the same path replaces it.
import hurdle_dash from "./hurdle_dash.js";
import pennant_capture from "./pennant_capture.js";
import circle_push from "./circle_push.js";
import block_smash from "./block_smash.js";
import disc_catch from "./disc_catch.js";
import lamp_jump from "./lamp_jump.js";
import relay_run from "./relay_run.js";
import ring_drop from "./ring_drop.js";
import snow_throw from "./snow_throw.js";
import goal_roll from "./goal_roll.js";

export const EVENT_IDS = ["hurdle_dash", "pennant_capture", "circle_push", "block_smash", "disc_catch", "lamp_jump", "relay_run", "ring_drop", "snow_throw", "goal_roll"];

export const EVENTS = { hurdle_dash, pennant_capture, circle_push, block_smash, disc_catch, lamp_jump, relay_run, ring_drop, snow_throw, goal_roll };
