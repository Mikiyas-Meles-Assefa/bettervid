import React from "react";
import { Composition } from "remotion";
import { DURATION, FPS, S7Test } from "./S7Test.tsx";

export const Root: React.FC = () => (
  <Composition id="S7Test" component={S7Test} durationInFrames={DURATION} fps={FPS} width={1080} height={1920} />
);
