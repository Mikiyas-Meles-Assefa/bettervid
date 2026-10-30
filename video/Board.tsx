// One-take video for styles with `motion: "board"`: every shot lands on one big board and stays there. The camera moves
// from shot to shot, and at the end pulls back so the whole story is visible, connected. Shots are the same components
// the cut-based videos use, so marks, zooms and source cards all work here.
import React from "react";
import { AbsoluteFill, Easing, Freeze, interpolate, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import type { Clip, StyleFile } from "../schemas/project.ts";
import { SHOTS } from "./shots.tsx";

const TILE = { w: 1080, h: 1440 };
const STEP = { x: 1420, y: 1820 };
const FIT = 0.82; // how much of the frame's width a tile fills
const MOVE = 18; // frames of camera move into each shot
const FINALE = 4.5; // seconds of the final pull-back, including a hold on the whole board

type Place = { x: number; y: number };

// A snake across the board, shaped roughly like the phone screen so the final view fills it.
function layout(n: number): { places: Place[]; cols: number; rows: number } {
  const cols = Math.max(1, Math.round(Math.sqrt(n * 0.7)));
  const rows = Math.ceil(n / cols);
  const places = Array.from({ length: n }, (_, i) => {
    const row = Math.floor(i / cols);
    const col = row % 2 ? cols - 1 - (i % cols) : i % cols;
    return { x: col * STEP.x, y: row * STEP.y };
  });
  return { places, cols, rows };
}

const ease = { easing: Easing.inOut(Easing.cubic), extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

export const Board: React.FC<{ clips: Clip[]; style: StyleFile }> = ({ clips, style }) => {
  const frame = useCurrentFrame();
  const { fps, width: W, height: H } = useVideoConfig();
  const { places, cols, rows } = layout(clips.length);
  const center = (p: Place) => ({ x: p.x + TILE.w / 2, y: p.y + TILE.h / 2 });

  // The camera: where it is between the two shots either side of this frame.
  let at = center(places[0]!);
  clips.forEach((c, i) => {
    if (!i) return;
    const t = interpolate(frame, [c.from - MOVE / 2, c.from + MOVE / 2], [0, 1], ease);
    const a = center(places[i - 1]!);
    const b = center(places[i]!);
    if (t > 0) at = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  });
  const last = clips.at(-1)!;
  const end = last.from + last.frames;
  const whole = { w: cols * STEP.x, h: rows * STEP.y };
  const overview = Math.min(W / whole.w, H / whole.h);
  const out = interpolate(frame, [end - FINALE * fps, end - 1.6 * fps], [0, 1], ease);
  const near = (W * FIT) / TILE.w;
  // Dip back a little on each move, so the viewer senses the board around the shot.
  const dip = Math.max(0, ...clips.slice(1).map((c) => 1 - Math.abs(frame - c.from) / MOVE));
  const scale = (near * (1 - 0.14 * dip)) * (1 - out) + overview * out;
  const cam = { x: at.x * (1 - out) + (whole.w - STEP.x + TILE.w) / 2 * out, y: at.y * (1 - out) + (whole.h - STEP.y + TILE.h) / 2 * out };
  const tx = W / 2 - cam.x * scale;
  const ty = H * (0.37 + 0.13 * out) - cam.y * scale;

  return (
    <AbsoluteFill style={{ backgroundColor: style.palette.paper, overflow: "hidden" }}>
      <div style={{ position: "absolute", left: 0, top: 0, transformOrigin: "0 0", transform: `translate(${tx}px, ${ty}px) scale(${scale})` }}>
        <svg width={whole.w + 2000} height={whole.h + 2000} style={{ position: "absolute", left: -1000, top: -1000, overflow: "visible" }}>
          {clips.slice(1).map((c, i) => {
            // A hand-drawn connector from each shot to the next, drawn as the camera moves along it.
            const a = center(places[i]!);
            const b = center(places[i + 1]!);
            const t = interpolate(frame, [c.from - MOVE, c.from + MOVE / 2], [0, 1], ease);
            const dir = Math.abs(b.x - a.x) > Math.abs(b.y - a.y);
            const from = dir ? { x: a.x + Math.sign(b.x - a.x) * (TILE.w / 2 + 40), y: a.y } : { x: a.x, y: a.y + Math.sign(b.y - a.y) * (TILE.h / 2 + 40) };
            const to = dir ? { x: b.x - Math.sign(b.x - a.x) * (TILE.w / 2 + 50), y: b.y } : { x: b.x, y: b.y - Math.sign(b.y - a.y) * (TILE.h / 2 + 50) };
            return (
              <path key={i} d={`M${from.x + 1000} ${from.y + 1000} L${to.x + 1000} ${to.y + 1000}`} fill="none" stroke={style.palette.accent} strokeWidth={14} strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - t} />
            );
          })}
        </svg>
        {clips.map((c, i) => {
          const Shot = SHOTS[c.type];
          const p = places[i]!;
          const show = interpolate(frame, [c.from - MOVE / 2, c.from + 6], [0, 1], ease);
          if (show <= 0) return null;
          return (
            <div key={c.shotId} style={{ position: "absolute", left: p.x, top: p.y, width: TILE.w, height: TILE.h, overflow: "hidden", clipPath: `inset(0 ${(1 - show) * 100}% 0 0)`, mixBlendMode: "multiply", filter: "brightness(1.07) contrast(1.1)" }}>
              <Sequence from={c.from} layout="none">
                <Freeze frame={c.frames - 1} active={(f) => f >= c.frames}>
                  <Shot clip={c} style={style} index={i} />
                </Freeze>
              </Sequence>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
