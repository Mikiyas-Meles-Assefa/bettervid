import React from "react";
import { Composition } from "remotion";
import type { Timeline } from "../schemas/project.ts";
import { Video } from "./Video.tsx";

const empty: Timeline = {
  fps: 30,
  width: 1080,
  height: 1920,
  frames: 30,
  audio: "narration.mp3",
  style: { name: "", label: "", palette: { paper: "#eee", ink: "#111", accent: "#c33", highlight: "#ffd93d" }, fonts: { caption: "Arial Black", title: "Arial Black", body: "Georgia" }, artPrefix: "", grain: 0, vignette: 0, voice: { id: "", model: "" } },
  clips: [],
  captions: [],
};

// Size and length come from the timeline passed as input props at render time.
export const Root: React.FC = () => (
  <Composition
    id="Bettervid"
    component={Video}
    defaultProps={{ timeline: empty }}
    calculateMetadata={({ props }) => ({ durationInFrames: props.timeline.frames, fps: props.timeline.fps, width: props.timeline.width, height: props.timeline.height })}
    durationInFrames={30}
    fps={30}
    width={1080}
    height={1920}
  />
);
