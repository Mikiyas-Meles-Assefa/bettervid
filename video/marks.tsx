// The drawing layer: marks that draw themselves on an image in time with the spoken words. Points are fractions of the
// image, so marks stay on their target while the camera moves. How a line looks (wobble, weight) comes from the style.
import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { StyleFile, TimedMark } from "../schemas/project.ts";

type View = { tx: number; ty: number; s: number; iw: number; ih: number };
type Pt = [number, number];

const hash = (x: number, y: number) => Math.sin(x * 12.9898 + y * 78.233) * 43758.5453 % 1;

// A hand-drawn line through the points: small stable offsets, so a mark does not shimmer from frame to frame.
function rough(points: Pt[], wobble: number): string {
  if (!wobble) return points.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" ");
  const out: Pt[] = [];
  points.forEach((p, i) => {
    const next = points[i + 1];
    out.push([p[0] + hash(p[0], p[1]) * wobble, p[1] + hash(p[1], p[0]) * wobble]);
    if (next) {
      const d = Math.hypot(next[0] - p[0], next[1] - p[1]);
      for (let k = 1, n = Math.floor(d / 60); k < n; k++) {
        const x = p[0] + ((next[0] - p[0]) * k) / n;
        const y = p[1] + ((next[1] - p[1]) * k) / n;
        out.push([x + hash(x, y) * wobble, y + hash(y, x) * wobble]);
      }
    }
  });
  return curve(out);
}

// A smooth line through the points, so a hand-drawn shape reads as a curve and not a polygon.
function curve(p: Pt[]): string {
  if (p.length < 3) return p.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  let d = `M${p[0]![0].toFixed(1)} ${p[0]![1].toFixed(1)}`;
  for (let i = 1; i < p.length - 1; i++) {
    const [x, y] = p[i]!;
    const [nx, ny] = p[i + 1]!;
    d += ` Q${x.toFixed(1)} ${y.toFixed(1)} ${((x + nx) / 2).toFixed(1)} ${((y + ny) / 2).toFixed(1)}`;
  }
  const [lx, ly] = p.at(-1)!;
  return `${d} L${lx.toFixed(1)} ${ly.toFixed(1)}`;
}

function ellipse(a: Pt, b: Pt, pad: number): Pt[] {
  const cx = (a[0] + b[0]) / 2;
  const cy = (a[1] + b[1]) / 2;
  const rx = Math.abs(b[0] - a[0]) / 2 + pad;
  const ry = Math.abs(b[1] - a[1]) / 2 + pad;
  // A little past a full turn, the way a hand closes a circle.
  return Array.from({ length: 46 }, (_, i) => {
    const t = -2 + (i / 40) * Math.PI * 2;
    return [cx + Math.cos(t) * rx * (1 + i * 0.001), cy + Math.sin(t) * ry] as Pt;
  });
}

const Stroke: React.FC<{ d: string; color: string; width: number; t: number }> = ({ d, color, width, t }) => (
  <path d={d} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - t} style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.4))" }} />
);

const Mark: React.FC<{ m: TimedMark; view: View; style: StyleFile }> = ({ m, view, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const hand = style.hand ?? { wobble: 2, weight: 1 };
  const color = style.palette[m.color ?? "accent"];
  const width = 9 * hand.weight;
  const t = interpolate(frame, [m.frame, m.frame + 0.45 * fps], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  if (frame < m.frame) return null;
  const pts = m.points.map(([x, y]): Pt => [view.tx + x * view.iw * view.s, view.ty + y * view.ih * view.s]);
  const [a, b] = pts as [Pt, Pt];
  if (m.tool === "ring") return <Stroke d={rough(ellipse(a, b, 26), hand.wobble)} color={color} width={width} t={t} />;
  if (m.tool === "box") {
    const box: Pt[] = [a, [b[0], a[1]], b, [a[0], b[1]], a];
    return <Stroke d={rough(box, hand.wobble)} color={color} width={width} t={t} />;
  }
  if (m.tool === "underline" || m.tool === "line" || m.tool === "path") return <Stroke d={rough(pts, hand.wobble)} color={color} width={width} t={t} />;
  if (m.tool === "arrow") {
    const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const head = (turn: number): Pt => [b[0] - Math.cos(angle + turn) * 46, b[1] - Math.sin(angle + turn) * 46];
    const headT = interpolate(frame, [m.frame + 0.35 * fps, m.frame + 0.55 * fps], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    return (
      <>
        <Stroke d={rough([a, b], hand.wobble)} color={color} width={width} t={t} />
        <Stroke d={`M${head(0.5).join(" ")} L${b.join(" ")} L${head(-0.5).join(" ")}`} color={color} width={width} t={headT} />
      </>
    );
  }
  if (m.tool === "dots")
    return (
      <>
        {pts.map(([x, y], i) => {
          const pop = spring({ frame: frame - m.frame - i * 0.09 * fps, fps, config: { damping: 11, stiffness: 220 } });
          return <circle key={i} cx={x} cy={y} r={14 * pop} fill={color} stroke={style.palette.paper} strokeWidth={3} />;
        })}
      </>
    );
  // label: a short word on a small paper tag.
  const pop = spring({ frame: frame - m.frame, fps, config: { damping: 13, stiffness: 200 } });
  return (
    <foreignObject x={a[0] - 300} y={a[1] - 60} width={600} height={120} style={{ overflow: "visible" }}>
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: 120 }}>
        <span style={{ transform: `scale(${pop}) rotate(-1.5deg)`, background: style.palette.paper, color: style.palette.ink, fontFamily: style.fonts.body, fontWeight: 700, fontSize: 46, padding: "8px 22px", boxShadow: "0 3px 10px rgba(0,0,0,0.35)" }}>{m.text}</span>
      </div>
    </foreignObject>
  );
};

export const Marks: React.FC<{ marks: TimedMark[]; view: View; style: StyleFile }> = ({ marks, view, style }) => {
  const { width, height } = useVideoConfig();
  return (
    <svg width={width} height={height} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
      {marks.map((m, i) => (
        <Mark key={i} m={m} view={view} style={style} />
      ))}
    </svg>
  );
};
