// STUB (to be replaced by the real event of this id)
// Stand-in for the "Block Smash" event. It only lets a course go through (it finishes after a few seconds with a score of 0 for everybody)
// until the real module is written at this same path; never overwrite this file once it no longer starts with the line above.
export default {
  id: "block_smash",
  names: { es: "Rompelosas", en: "Block Smash" },
  stats: ["power", "stamina", "skill"],
  seconds: 30,
  help: { es: "Esta prueba todavía no está lista.", en: "This event is not ready yet." },
  create(ctx) {
    let left = 3;
    return {
      update(dt) {
        left -= dt;
        if (left <= 0 && !ctx.finished) ctx.finish({ raw: [0, 0, 0, 0], detail: [{}, {}, {}, {}] });
      },
      render(g) {
        g.fillStyle = "#16202f";
        g.fillRect(0, 0, ctx.W, ctx.H);
        ctx.ui.text(g, ctx.t("Rompelosas", "Block Smash"), ctx.W / 2, ctx.H / 2 - 10, { size: 54, align: "center" });
        ctx.ui.text(g, ctx.t("Esta prueba todavía no está lista", "This event is not ready yet"), ctx.W / 2, ctx.H / 2 + 40, { size: 26, align: "center", color: "#aab6cc" });
      },
      destroy() {},
    };
  },
};
