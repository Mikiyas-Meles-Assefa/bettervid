// Remotion entry for a bench clip: the built scene with the video's own captions on top, and a small clock in the
// corner so a watcher reading frames in order always knows the time. No audio: bench narration is timed from text.
import React, { useEffect, useState } from "react";
import { AbsoluteFill, cancelRender, Composition, continueRender, delayRender, registerRoot, Sequence, useCurrentFrame } from "remotion";
import type { Scene, Theme } from "../engine/core/types.ts";
import { SceneView } from "../engine/render/SceneView.tsx";
import type { Timeline } from "../schemas/project.ts";
import { Caption, sceneLook } from "../video/Video.tsx";

type Props = { scene: Scene; theme: Theme; captions: Timeline["captions"] };

function useImagesReady(scene: Scene) {
  const [handle] = useState(() => delayRender("loading scene images"));
  useEffect(() => {
    const sources = new Set<string>();
    for (const n of scene.nodes) if (n.kind === "image" && typeof n.props.src === "string") sources.add(n.props.src);
    Promise.all([...sources].map((src) => {
      const img = new Image();
      img.src = src;
      return img.decode();
    })).then(() => continueRender(handle), cancelRender);
  }, [scene, handle]);
}

const Clip: React.FC<Props> = ({ scene, theme, captions }) => {
  useImagesReady(scene);
  const frame = useCurrentFrame();
  const look = sceneLook(theme);
  return (
    <AbsoluteFill>
      <SceneView scene={scene} theme={theme} frame={frame} />
      {captions.map((c, i) => (
        <Sequence key={i} from={c.startFrame} durationInFrames={Math.max(1, c.endFrame - c.startFrame)} layout="none">
          <Caption words={c.words} look={look} />
        </Sequence>
      ))}
      <div style={{ position: "absolute", top: 24, left: 28, fontFamily: "monospace", fontSize: 44, color: "white", background: "rgba(0,0,0,0.55)", padding: "2px 12px", borderRadius: 8 }}>
        {(frame / scene.fps).toFixed(2)} s
      </div>
    </AbsoluteFill>
  );
};

const empty = { fps: 30, width: 1080, height: 1920, frames: 30, background: "#fff", nodes: [], tracks: [], events: [] } satisfies Scene;
const Root: React.FC = () => (
  <Composition
    id="BenchClip"
    component={Clip}
    defaultProps={{ scene: empty, theme: { colors: {}, fonts: { title: "Georgia", body: "Georgia" }, moveFrames: 16, ease: "smooth" }, captions: [] } as Props}
    calculateMetadata={({ props }) => ({ durationInFrames: props.scene.frames, fps: props.scene.fps, width: props.scene.width, height: props.scene.height })}
    durationInFrames={30}
    fps={30}
    width={1080}
    height={1920}
  />
);
registerRoot(Root);
