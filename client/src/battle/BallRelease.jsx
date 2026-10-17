import React, { useEffect, useRef } from "react";
import { drawBallFrame } from "./ball-art.js";
import { ballFlight } from "./ball-motion.js";
import { usePrefersReducedMotion } from "./fx/setting.js";

export default function BallRelease({ id, back }) {
  const canvas = useRef(null);
  const reduced = usePrefersReducedMotion();
  useEffect(() => {
    if (reduced) return undefined;
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return undefined;
    let request, started;
    const frame = (now) => {
      started ??= now;
      const age = (now - started) / 720;
      ctx.clearRect(0, 0, 240, 180);
      if (age < .5) {
        const k = age * 2, flight = ballFlight(k);
        drawBallFrame(ctx, 120 + (back ? -1 : 1) * 100 * (1 - flight.x), 125 - flight.height * 75, 112, k);
      } else if (age < 1) drawBallFrame(ctx, 120, 120, 160, (age - .5) * 2, true);
      if (age < 1) request = requestAnimationFrame(frame);
    };
    request = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(request); ctx.clearRect(0, 0, 240, 180); };
  }, [id, back, reduced]);
  return reduced ? null : <canvas className="b-ball-release" ref={canvas} width={240} height={180} aria-hidden="true" />;
}
