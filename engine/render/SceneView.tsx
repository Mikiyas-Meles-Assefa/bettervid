// Draws one frame. Renders only the four primitives, so anything a kit makes appears here without new drawing code.
import React from "react";
import { evaluate } from "../core/evaluate.ts";
import type { Resolved, Scene, Theme } from "../core/types.ts";

const n = (v: unknown, d = 0) => (typeof v === "number" ? v : d);

function line(points: number[], smooth: boolean, closed: boolean): string {
  const p: [number, number][] = [];
  for (let i = 0; i + 1 < points.length; i += 2) p.push([points[i]!, points[i + 1]!]);
  if (!p.length) return "";
  if (!smooth || p.length < 3) return `${p.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" ")}${closed ? " Z" : ""}`;
  let d = `M${p[0]![0]} ${p[0]![1]}`;
  for (let i = 1; i < p.length - 1; i++) d += ` Q${p[i]![0]} ${p[i]![1]} ${(p[i]![0] + p[i + 1]![0]) / 2} ${(p[i]![1] + p[i + 1]![1]) / 2}`;
  return `${d} L${p.at(-1)![0]} ${p.at(-1)![1]}${closed ? " Z" : ""}`;
}

const Item: React.FC<{ r: Resolved; theme: Theme }> = ({ r, theme }) => {
  const a = r.props;
  const transform = `translate(${n(a.x)} ${n(a.y)}) rotate(${n(a.rotate)}) skewX(${n(a.skew)}) scale(${n(a.scaleX, 1)} ${n(a.scaleY, 1)})`;
  const kids = r.children.map((c) => <Item key={c.id} r={c} theme={theme} />);
  const opacity = n(a.opacity, 1);
  if (r.kind === "group") return <g transform={transform} opacity={opacity}>{kids}</g>;
  if (r.kind === "text") {
    return (
      <g transform={transform} opacity={opacity}>
        <text textAnchor={String(a.anchor ?? "middle") as "start" | "middle" | "end"} dominantBaseline="central" fontFamily={String(a.font ?? theme.fonts.body)} fontSize={n(a.size, 60)} fontWeight={n(a.weight, 400)} fill={String(a.color ?? theme.colors.ink)}>{String(a.text ?? "")}</text>
        {kids}
      </g>
    );
  }
  if (r.kind === "image") {
    return <g transform={transform} opacity={opacity}><image href={String(a.src)} x={-n(a.w) / 2} y={-n(a.h) / 2} width={n(a.w)} height={n(a.h)} />{kids}</g>;
  }
  const d = line(a.points as number[], !!n(a.smooth), !!n(a.closed));
  const drawn = n(a.drawn, 1);
  const pulse = n(a.pulse, -1);
  const stroke = String(a.stroke ?? "none");
  const width = n(a.strokeWidth, 6);
  return (
    <g transform={transform} opacity={opacity}>
      <path d={d} fill={String(a.fill ?? "none")} fillOpacity={drawn} stroke={stroke} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray={drawn < 1 ? `${drawn} 1` : undefined} />
      {pulse >= 0 && pulse <= 1 && <path d={d} fill="none" stroke={String(a.pulseColor ?? theme.colors.accent)} strokeWidth={width * 2.2} strokeLinecap="round" pathLength={1} strokeDasharray="0.14 1" strokeDashoffset={-pulse * 0.86} />}
      {kids}
    </g>
  );
};

export const SceneView: React.FC<{ scene: Scene; theme: Theme; frame: number }> = ({ scene, theme, frame }) => (
  <svg width={scene.width} height={scene.height} viewBox={`0 0 ${scene.width} ${scene.height}`} style={{ display: "block", background: scene.background }}>
    {evaluate(scene, frame).map((r) => <Item key={r.id} r={r} theme={theme} />)}
  </svg>
);
