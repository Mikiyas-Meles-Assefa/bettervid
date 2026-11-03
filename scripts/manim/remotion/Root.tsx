// A Manim clip as a shot, with the same captions, vignette and grain as video/Video.tsx. In the real pipeline this is one
// new entry in SHOTS; it lives here because this spike does not change video/.
import React from "react";
import { AbsoluteFill, Audio, Composition, Img, OffthreadVideo, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

type Props = { clip: string; audio: string; frames: number; style: any; captions: { words: string[]; startFrame: number; endFrame: number }[] };

const Caption: React.FC<{ words: string[]; font: string }> = ({ words, font }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 12, stiffness: 240 } });
  return (
    <AbsoluteFill style={{ top: 1640, height: 170, alignItems: "center", justifyContent: "center", padding: "0 160px 0 90px" }}>
      <div style={{ fontFamily: font, fontWeight: 900, fontSize: 58, lineHeight: 1.1, textAlign: "center", textTransform: "uppercase", color: "white", WebkitTextStroke: "10px black", paintOrder: "stroke fill", transform: `scale(${0.7 + 0.3 * pop})` }}>{words.join(" ")}</div>
    </AbsoluteFill>
  );
};

const Shot: React.FC<Props> = ({ clip, audio, style, captions }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ backgroundColor: style.palette.paper }}>
      <OffthreadVideo src={staticFile(clip)} muted style={{ width: "100%", height: "100%" }} />
      {captions.map((c, i) => (
        <Sequence key={i} from={c.startFrame} durationInFrames={Math.max(1, c.endFrame - c.startFrame)} layout="none">
          <Caption words={c.words} font={style.fonts.caption} />
        </Sequence>
      ))}
      <AbsoluteFill style={{ background: `radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,${style.vignette}) 100%)` }} />
      {style.grain > 0 && <Img src={staticFile("grain.png")} style={{ position: "absolute", width: "100%", height: "100%", mixBlendMode: "overlay", opacity: style.grain, transform: `translate(${(frame * 37) % 9}px, ${(frame * 53) % 7}px)` }} />}
      <Audio src={staticFile(audio)} />
    </AbsoluteFill>
  );
};

export const Root: React.FC = () => (
  <Composition
    id="ManimShot"
    component={Shot as any}
    defaultProps={{ clip: "", audio: "", frames: 30, style: { palette: { paper: "#eee" }, fonts: { caption: "Arial Black" }, vignette: 0, grain: 0 }, captions: [] } as Props}
    calculateMetadata={({ props }: any) => ({ durationInFrames: props.frames })}
    durationInFrames={30}
    fps={30}
    width={1080}
    height={1920}
  />
);
