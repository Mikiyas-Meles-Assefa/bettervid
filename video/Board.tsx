// The live whiteboard: one continuous board that starts empty. Words are written and shapes are drawn as the narrator
// speaks, images drop in, and a camera moves across it, ending on the whole board.
import React from "react";
import { AbsoluteFill, Easing, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { BoardCamera, Clip, MathToken, StyleFile, TimedElement, TimedMark } from "../schemas/project.ts";
import { Marks } from "./marks.tsx";

const MOVE = 0.9; // seconds for the camera to move between stops
const WRITE = 26; // characters written per second
const WORLD = { tx: 0, ty: 0, s: 1, iw: 1, ih: 1 }; // marks on the board use board pixels directly

const Text: React.FC<{ e: TimedElement; style: StyleFile }> = ({ e, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const text = e.text ?? "";
  const n = Math.min(text.length, Math.floor(((frame - e.frame) / fps) * WRITE));
  return (
    <div style={{ position: "absolute", left: e.x, top: e.y, width: e.w, fontFamily: style.fonts.body, fontSize: e.size ?? 60, lineHeight: 1.18, color: style.palette[e.color ?? "ink"] }}>
      {text.slice(0, n)}
      <span style={{ visibility: "hidden" }}>{text.slice(n)}</span>
    </div>
  );
};

// Real notation: fractions and matrices, swept in like the rest of the board. Highlighted columns show what the voice means.
const Matrix: React.FC<{ t: MathToken; style: StyleFile; size: number; start: number }> = ({ t, style, size, start }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  // A highlighted column slides in from above and lands, so the viewer sees it replace what was there.
  const drop = spring({ frame: frame - start - 0.5 * fps, fps, config: { damping: 14, stiffness: 120 } });
  const line = `${Math.max(4, size * 0.07)}px solid ${style.palette.ink}`;
  const bracket = t.bars ? { borderLeft: line, borderRight: line } : { borderLeft: line, borderRight: line, borderRadius: size * 0.22 };
  return (
    <div style={{ display: "inline-grid", gridTemplateColumns: `repeat(${t.rows[0]?.length ?? 1}, auto)`, ...bracket, margin: `0 ${size * 0.15}px`, padding: `${size * 0.1}px 0` }}>
      {t.rows.flatMap((row, r) =>
        row.map((cell, c) => {
          const hit = t.highlight.includes(c);
          return (
            <span key={`${r}-${c}`} style={{ padding: `0 ${size * 0.32}px`, textAlign: "center", color: hit ? style.palette.accent : style.palette.ink, fontWeight: hit ? 700 : 400, background: hit ? `${style.palette.accent}1f` : undefined, display: "inline-block", transform: hit ? `translateY(${(1 - drop) * -size * 2.4}px)` : undefined, opacity: hit ? drop : 1 }}>
              {cell}
            </span>
          );
        }),
      )}
    </div>
  );
};

const Fraction: React.FC<{ t: MathToken; size: number; ink: string }> = ({ t, size, ink }) => (
  <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", margin: `0 ${size * 0.15}px`, lineHeight: 1.1 }}>
    <span style={{ padding: `0 ${size * 0.15}px` }}>{t.num}</span>
    <span style={{ alignSelf: "stretch", borderTop: `${Math.max(4, size * 0.06)}px solid ${ink}` }} />
    <span style={{ padding: `0 ${size * 0.15}px` }}>{t.den}</span>
  </span>
);

const Mathematics: React.FC<{ e: TimedElement; style: StyleFile }> = ({ e, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const size = e.size ?? 76;
  const t = interpolate(frame, [e.frame, e.frame + 0.8 * fps], [-15, 120], { extrapolateRight: "clamp" });
  const mask = `linear-gradient(90deg, black ${t}%, transparent ${t + 15}%)`;
  return (
    <div style={{ position: "absolute", left: e.x, top: e.y, width: e.w, height: e.h, display: "flex", alignItems: "center", flexWrap: "wrap", gap: size * 0.2, fontFamily: style.fonts.body, fontSize: size, color: style.palette.ink, WebkitMaskImage: mask, maskImage: mask }}>
      {e.math!.map((m, i) => (m.type === "matrix" ? <Matrix key={i} t={m} style={style} size={size} start={e.frame} /> : m.type === "frac" ? <Fraction key={i} t={m} size={size} ink={style.palette.ink} /> : <span key={i}>{m.text}</span>))}
    </div>
  );
};

const Picture: React.FC<{ e: TimedElement }> = ({ e }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  // Sketched in: a soft edge sweeps across the drawing, so it appears the way a hand would lay it down.
  const t = interpolate(frame, [e.frame, e.frame + 1.1 * fps], [-20, 125], { extrapolateRight: "clamp", easing: Easing.inOut(Easing.quad) });
  const mask = `linear-gradient(115deg, black ${t}%, transparent ${t + 20}%)`;
  return <Img src={staticFile(e.image!)} style={{ position: "absolute", left: e.x, top: e.y, width: e.w, height: e.h, objectFit: "contain", mixBlendMode: "multiply", filter: "brightness(1.12) contrast(1.15)", WebkitMaskImage: mask, maskImage: mask }} />;
};

function view(frame: number, fps: number, stops: BoardCamera[]) {
  let at = stops[0]!;
  for (let i = 1; i < stops.length; i++) {
    const a = at;
    const b = stops[i]!;
    const t = interpolate(frame, [b.frame, b.frame + (b.hold ?? MOVE) * fps], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) });
    if (t <= 0) break;
    at = { ...b, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, w: a.w + (b.w - a.w) * t };
  }
  return at;
}

export const BoardShot: React.FC<{ clip: Clip; style: StyleFile; index: number }> = ({ clip, style }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const { elements, camera } = clip.board!;
  const cam = view(frame, fps, camera);
  const s = width / cam.w;
  const shown = elements.filter((e) => frame >= e.frame);
  const marks = shown.filter((e) => e.points?.length).map((e) => ({ tool: e.kind, points: e.points!, word: 0, color: e.color, frame: e.frame }) as TimedMark);
  return (
    <AbsoluteFill style={{ backgroundColor: style.palette.paper, overflow: "hidden" }}>
      <div style={{ position: "absolute", left: 0, top: 0, transformOrigin: "0 0", transform: `scale(${s}) translate(${-cam.x}px, ${-cam.y}px)` }}>
        {shown.filter((e) => e.kind === "image").map((e, i) => <Picture key={i} e={e} />)}
        {shown.filter((e) => e.kind === "text").map((e, i) => <Text key={i} e={e} style={style} />)}
        {shown.filter((e) => e.kind === "math").map((e, i) => <Mathematics key={i} e={e} style={style} />)}
        <Marks marks={marks} view={WORLD} style={style} />
      </div>
    </AbsoluteFill>
  );
};
