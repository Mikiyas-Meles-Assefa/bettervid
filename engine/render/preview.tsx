// Remotion entry for rendering a compiled scene on its own.
import React, { useEffect, useState } from "react";
import { cancelRender, Composition, continueRender, delayRender, registerRoot, useCurrentFrame } from "remotion";
import type { Scene, Theme } from "../core/types.ts";
import { SceneView } from "./SceneView.tsx";

type Props = { scene: Scene; theme: Theme };

// An SVG image draws whenever it arrives, which could be after a frame is captured. Hold every frame until all are in.
function useImagesReady(scene: Scene) {
  const [handle] = useState(() => delayRender("loading scene images"));
  useEffect(() => {
    const sources = new Set<string>();
    for (const n of scene.nodes) if (n.kind === "image" && typeof n.props.src === "string") sources.add(n.props.src);
    for (const t of scene.tracks) if (t.prop === "src") for (const k of t.keys) sources.add(String(k.value));
    Promise.all([...sources].map((src) => {
      const img = new Image();
      img.src = src;
      return img.decode();
    })).then(() => continueRender(handle), cancelRender);
  }, [scene, handle]);
}

const Shot: React.FC<Props> = ({ scene, theme }) => {
  useImagesReady(scene);
  return <SceneView scene={scene} theme={theme} frame={useCurrentFrame()} />;
};
const empty = { fps: 30, width: 1080, height: 1920, frames: 30, background: "#fff", nodes: [], tracks: [], events: [] } satisfies Scene;
const Root: React.FC = () => (
  <Composition
    id="Scene"
    component={Shot}
    defaultProps={{ scene: empty, theme: { colors: {}, fonts: { title: "Georgia", body: "Georgia" }, moveFrames: 16, ease: "smooth" } } as Props}
    calculateMetadata={({ props }) => ({ durationInFrames: props.scene.frames, fps: props.scene.fps, width: props.scene.width, height: props.scene.height })}
    durationInFrames={30}
    fps={30}
    width={1080}
    height={1920}
  />
);
registerRoot(Root);
