// Remotion entry for the style proof: the same as engine/render/preview.tsx, drawn by the style renderer.
import React from "react";
import { Composition, registerRoot, useCurrentFrame } from "remotion";
import type { Scene, Theme } from "../core/types.ts";
import { StyledSceneView } from "../style/draw.tsx";

type Props = { scene: Scene; theme: Theme };
const Shot: React.FC<Props> = ({ scene, theme }) => <StyledSceneView scene={scene} theme={theme} frame={useCurrentFrame()} />;
const empty = { fps: 30, width: 1080, height: 1920, frames: 30, background: "#ffffff", nodes: [], tracks: [], events: [] } satisfies Scene;
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
