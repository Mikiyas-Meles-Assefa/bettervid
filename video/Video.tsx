// The main composition: renders a Timeline (schemas/project.ts). Shots are hard cuts on word times;
// captions, grain and vignette sit on top; the narration is the only audio for now.
import React, { useMemo } from "react";
import { AbsoluteFill, Audio, Img, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "../engine/core/types.ts";
import type { Timeline } from "../schemas/project.ts";
import { SHOTS } from "./shots.tsx";

// How captions look. Over photos: white with a black outline. Over an engine scene: the style's own ink and font, with
// an outline in the surface color, so a caption reads like part of the board and never like a sticker on it.
type Look = { font: string; weight: number; size: number; upper: boolean; color: string; highlight: string; outline: string; stroke: number };

const photoLook = (t: Timeline): Look => ({ font: t.style.fonts.caption, weight: 900, size: 58, upper: true, color: "white", highlight: t.style.palette.highlight, outline: "black", stroke: 10 });

function sceneLook(theme: Theme): Look {
  const c = theme.colors;
  return { font: theme.fonts.body, weight: theme.style?.type.bold ?? 700, size: 50, upper: theme.style?.type.case === "upper", color: c.ink!, highlight: c.accent!, outline: c.paper!, stroke: 9 };
}

const Caption: React.FC<{ words: { text: string; highlight: boolean }[]; look: Look }> = ({ words, look }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 12, stiffness: 240 } });
  return (
    // Low and small, so the picture stays the subject. The user preferred this to big mid-screen captions. Engine
    // scenes keep the bottom fifth clear (engine/language/build.ts), and this band sits inside it.
    <AbsoluteFill style={{ top: 1640, height: 170, alignItems: "center", justifyContent: "center", padding: "0 160px 0 90px" }}>
      <div
        style={{
          fontFamily: look.font,
          fontWeight: look.weight,
          fontSize: look.size,
          lineHeight: 1.12,
          textAlign: "center",
          textTransform: look.upper ? "uppercase" : "none",
          color: look.color,
          WebkitTextStroke: `${look.stroke}px ${look.outline}`,
          paintOrder: "stroke fill",
          transform: `scale(${0.8 + 0.2 * pop})`,
        }}
      >
        {words.map((w, i) => (
          <span key={i} style={{ color: w.highlight ? look.highlight : look.color }}>
            {i ? " " : ""}
            {w.text}
          </span>
        ))}
      </div>
    </AbsoluteFill>
  );
};

// `scenes`: engine scenes kept out of the props, by clip, as files in the project folder (pipeline/stages/render.ts).
export const Video: React.FC<{ timeline: Timeline; scenes?: Record<string, string> }> = ({ timeline: t, scenes }) => {
  const frame = useCurrentFrame();
  const engine = t.clips.find((c) => c.type === "engine" && c.theme);
  const look = useMemo(() => (engine ? sceneLook(engine.theme!) : photoLook(t)), [engine, t]);
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <AbsoluteFill style={{ filter: t.style.surface?.filter }}>
        {t.clips.map((c, i) => {
          const Shot = SHOTS[c.type];
          return (
            <Sequence key={c.shotId} from={c.from} durationInFrames={c.frames} layout="none">
              <AbsoluteFill>
                <Shot clip={c} style={t.style} index={i} sceneFile={scenes?.[c.shotId]} />
                {c.credit && <div style={{ position: "absolute", top: 72, right: 60, maxWidth: 760, textAlign: "right", fontFamily: t.style.fonts.body, fontSize: 24, color: "white", opacity: 0.8, textShadow: "0 1px 4px rgba(0,0,0,0.85)" }}>{c.credit}</div>}
              </AbsoluteFill>
            </Sequence>
          );
        })}
      </AbsoluteFill>
      {!!t.style.surface?.paper && <Img src={staticFile("paper.png")} style={{ position: "absolute", width: "100%", height: "100%", mixBlendMode: "multiply", opacity: t.style.surface.paper }} />}
      {t.captions.map((c, i) => (
        <Sequence key={i} from={c.startFrame} durationInFrames={Math.max(1, c.endFrame - c.startFrame)} layout="none">
          <Caption words={c.words} look={look} />
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
