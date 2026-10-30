// The main composition: renders a Timeline (schemas/project.ts). Shots are hard cuts on word times;
// captions, grain and vignette sit on top; the narration is the only audio for now.
import React from "react";
import { AbsoluteFill, Audio, Img, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { Timeline } from "../schemas/project.ts";
import { Board } from "./Board.tsx";
import { SHOTS } from "./shots.tsx";

const Caption: React.FC<{ words: { text: string; highlight: boolean }[]; color: string; font: string }> = ({ words, color, font }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 12, stiffness: 240 } });
  return (
    // Safe zone (docs/PLAN.md section 3): centered, y about 1150 to 1300, never the bottom 25% or the right 15%.
    <AbsoluteFill style={{ top: 1130, height: 260, alignItems: "center", justifyContent: "center", padding: "0 160px 0 90px" }}>
      <div
        style={{
          fontFamily: font,
          fontWeight: 900,
          fontSize: 92,
          lineHeight: 1.1,
          textAlign: "center",
          textTransform: "uppercase",
          color: "white",
          WebkitTextStroke: "16px black",
          paintOrder: "stroke fill",
          transform: `scale(${0.7 + 0.3 * pop})`,
        }}
      >
        {words.map((w, i) => (
          <span key={i} style={{ color: w.highlight ? color : "white" }}>
            {i ? " " : ""}
            {w.text}
          </span>
        ))}
      </div>
    </AbsoluteFill>
  );
};

export const Video: React.FC<{ timeline: Timeline }> = ({ timeline: t }) => {
  const frame = useCurrentFrame();
  const board = t.style.motion === "board";
  const story = t.clips.filter((c) => c.type !== "credits");
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <AbsoluteFill style={{ filter: t.style.surface?.filter }}>
        {board && <Board clips={story} style={t.style} />}
        {(board ? t.clips.filter((c) => c.type === "credits") : t.clips).map((c, i) => {
          const Shot = SHOTS[c.type];
          return (
            <Sequence key={c.shotId} from={c.from} durationInFrames={c.frames} layout="none">
              <AbsoluteFill>
                <Shot clip={c} style={t.style} index={i} />
                {c.credit && !board && <div style={{ position: "absolute", top: 72, right: 60, maxWidth: 760, textAlign: "right", fontFamily: t.style.fonts.body, fontSize: 24, color: "white", opacity: 0.8, textShadow: "0 1px 4px rgba(0,0,0,0.85)" }}>{c.credit}</div>}
              </AbsoluteFill>
            </Sequence>
          );
        })}
      </AbsoluteFill>
      {!!t.style.surface?.paper && <Img src={staticFile("paper.png")} style={{ position: "absolute", width: "100%", height: "100%", mixBlendMode: "multiply", opacity: t.style.surface.paper }} />}
      {t.captions.map((c, i) => (
        <Sequence key={i} from={c.startFrame} durationInFrames={Math.max(1, c.endFrame - c.startFrame)} layout="none">
          <Caption words={c.words} color={t.style.palette.highlight} font={t.style.fonts.caption} />
        </Sequence>
      ))}
      <AbsoluteFill style={{ background: `radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,${t.style.vignette}) 100%)` }} />
      {t.style.grain > 0 && (
        <Img
          src={staticFile("grain.png")}
          style={{ position: "absolute", width: "100%", height: "100%", mixBlendMode: "overlay", opacity: t.style.grain, transform: `translate(${(frame * 37) % 9}px, ${(frame * 53) % 7}px)` }}
        />
      )}
      <Audio src={staticFile(t.audio)} />
    </AbsoluteFill>
  );
};
