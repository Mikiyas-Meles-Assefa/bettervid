// Spike S11: one simulation as a Remotion shot. Frames can arrive out of order, so state replays from the start
// whenever a frame goes backwards; that keeps every worker's result identical.
import React, { useLayoutEffect, useMemo, useRef } from "react";
import { Composition, registerRoot, useCurrentFrame } from "remotion";
import { loadSim, makeKit, seeded, type Style } from "./kit.ts";

type Props = { code: string; cues: Record<string, number>; style: Style };

const Sim: React.FC<Props> = ({ code, cues, style }) => {
  const frame = useCurrentFrame();
  const canvas = useRef<HTMLCanvasElement>(null);
  const sim = useMemo(() => loadSim(code), [code]);
  const run = useRef<{ state: any; at: number; rng: () => number } | null>(null);
  useLayoutEffect(() => {
    const ctx = canvas.current!.getContext("2d")!;
    const kit = makeKit(ctx, style);
    if (!run.current || frame < run.current.at) {
      const rng = seeded(7);
      run.current = { state: sim.setup({ width: 1080, height: 1920, rng, kit }), at: 0, rng };
    }
    const r = run.current;
    for (; r.at < frame; r.at++) sim.step(r.state, { t: r.at / 30, dt: 1 / 30, rng: r.rng, cues });
    sim.draw(r.state, kit, { t: frame / 30, cues });
  }, [frame, sim, style, cues]);
  return <canvas ref={canvas} width={1080} height={1920} />;
};

const Root: React.FC = () => (
  <Composition id="Sim" component={Sim} durationInFrames={300} fps={30} width={1080} height={1920} defaultProps={{ code: "", cues: {}, style: { name: "", palette: {}, fonts: { body: "Arial" } } }} />
);
registerRoot(Root);
