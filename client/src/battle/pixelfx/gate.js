// Entry point for the painter (rt/vfx.js): the style check is tiny and always loaded, the effects (about 0.3 MB) load the first time the
// "pixelfx" animation style is on.
import { pixelfxStyleOn } from "./mapping.js";

let loading = null;
/** The layer module (./layer.js), imported once. */
export const loadPixelfx = () => (loading ||= import("./layer.js"));
export { pixelfxStyleOn };
