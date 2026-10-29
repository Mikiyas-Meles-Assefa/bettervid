// S7 render-speed test: 60 s, 12 shots. Each shot has a slow-zoom background, a pre-outlined cutout that
// springs in, word-pop captions, and a slide or fade into the next shot. Grain and vignette sit on top.
import React from "react";
import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";

export const FPS = 30;
const SHOT = 5 * FPS;
const TRANSITION = 12;
const SHOTS = 12;
// Shots overlap during transitions, so the total is shorter than SHOTS * SHOT; pad shots to reach 60 s.
const SHOT_LEN = SHOT + Math.ceil((TRANSITION * (SHOTS - 1)) / SHOTS);
export const DURATION = SHOTS * SHOT_LEN - TRANSITION * (SHOTS - 1);

const LINES = [
  "In 1854 cholera tore through London",
  "Nobody knew how it spread",
  "One doctor started counting the dead",
  "He marked every death on a map",
  "The dots kept piling up",
  "All around one water pump",
  "Officials said it was bad air",
  "He asked them to remove the handle",
  "They did and the deaths stopped",
  "It changed how we fight disease",
  "And it started with a map",
  "Follow for more stories like this",
];
const WORDS_PER_SEC = 2.6;

const Caption: React.FC<{ text: string }> = ({ text }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const words = text.split(" ");
  const active = Math.floor((frame / fps) * WORDS_PER_SEC);
  const page = Math.floor(Math.min(active, words.length - 1) / 3);
  return (
    <div style={{ position: "absolute", top: 1240, width: "100%", display: "flex", justifyContent: "center", gap: 22, flexWrap: "wrap", padding: "0 90px" }}>
      {words.slice(page * 3, page * 3 + 3).map((w, i) => {
        const idx = page * 3 + i;
        const start = (idx / WORDS_PER_SEC) * fps;
        const pop = spring({ frame: frame - start, fps, config: { damping: 12, stiffness: 200 } });
        const on = idx === Math.min(active, words.length - 1);
        return (
          <span key={idx} style={{
            fontFamily: "Arial Black, Arial, sans-serif", fontWeight: 900, fontSize: 96, textTransform: "uppercase",
            color: on ? "#ffd400" : "white", WebkitTextStroke: "6px black", paintOrder: "stroke",
            transform: `scale(${interpolate(pop, [0, 1], [0.6, 1])})`, opacity: frame >= start ? 1 : 0, display: "inline-block",
          }}>{w}</span>
        );
      })}
    </div>
  );
};

const Shot: React.FC<{ i: number }> = ({ i }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const zoom = interpolate(frame, [0, SHOT_LEN], [1, 1.12]);
  const enter = spring({ frame: frame - 8, fps, config: { damping: 14 } });
  const side = i % 2 === 0 ? -1 : 1;
  return (
    <AbsoluteFill style={{ backgroundColor: "#111" }}>
      <Img src={staticFile(`bg${i}.jpg`)} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${zoom})` }} />
      <Img src={staticFile(`cut${i % 6}.png`)} style={{
        position: "absolute", bottom: 560, left: "50%", width: 620,
        transform: `translateX(-50%) translateX(${side * interpolate(enter, [0, 1], [700, 0])}px) rotate(${side * -3}deg)`,
      }} />
      <Caption text={LINES[i]!} />
    </AbsoluteFill>
  );
};

export const S7Test: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill>
      <TransitionSeries>
        {Array.from({ length: SHOTS }, (_, i) => (
          <React.Fragment key={i}>
            <TransitionSeries.Sequence durationInFrames={SHOT_LEN}>
              <Shot i={i} />
            </TransitionSeries.Sequence>
            {i < SHOTS - 1 && (
              <TransitionSeries.Transition
                presentation={i % 2 === 0 ? slide({ direction: "from-right" }) : fade()}
                timing={linearTiming({ durationInFrames: TRANSITION })}
              />
            )}
          </React.Fragment>
        ))}
      </TransitionSeries>
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.55) 100%)" }} />
      <Img src={staticFile("grain.png")} style={{ position: "absolute", width: "100%", height: "100%", mixBlendMode: "overlay", opacity: 0.5, transform: `translate(${(frame * 37) % 9}px, ${(frame * 53) % 7}px)` }} />
    </AbsoluteFill>
  );
};
