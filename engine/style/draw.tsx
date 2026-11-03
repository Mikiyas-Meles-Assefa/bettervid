// Turns the paint layer's data into SVG. `Surface`, `StyleDefs`, `StyledPath` and `StyledText` are the pieces a scene
// renderer calls; `StyledSceneView` joins them into a complete view.
import React from "react";
import { evaluate } from "../core/evaluate.ts";
import type { Props, Resolved, Scene, StyleSpec, Theme } from "../core/types.ts";
import { resolveStyle } from "./format.ts";
import { paintPath, paintSurface, paintText } from "./paint.ts";
import { TILE, toothTile } from "./texture.ts";

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).join(" ");
// Turns noise into specks of one color. `gain` sets the contrast of the specks, `cut` how much noise clears them.
const specks = (color: string, gain: number, cut: number) => `0 0 0 0 ${rgb(color).split(" ")[0]} 0 0 0 0 ${rgb(color).split(" ")[1]} 0 0 0 0 ${rgb(color).split(" ")[2]} 0 0 0 ${gain} ${-gain * cut}`;

const Noise: React.FC<{ id: string; frequency: string; octaves: number; seed: number; matrix: string }> = ({ id, frequency, octaves, seed, matrix }) => (
  <filter id={id} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency={frequency} numOctaves={octaves} seed={seed} />
    <feColorMatrix type="matrix" values={matrix} />
  </filter>
);

// The backdrop: painted below everything, in its own unchanging layer, so it costs one paint rather than one per frame.
export const Surface = React.memo<{ style: StyleSpec; color: string; theme: Theme; width: number; height: number }>(({ style, color, theme, width, height }) => {
  const s = paintSurface(style, color, theme);
  const full = { x: 0, y: 0, width, height };
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ position: "absolute", left: 0, top: 0, willChange: "transform" }}>
      <defs>
        {s.light && <radialGradient id="sg-light" cx="50%" cy="42%" r="72%"><stop offset="0" stopColor={s.light.color} /><stop offset="1" stopColor={s.light.color} stopOpacity={0} /></radialGradient>}
        {s.grain && <Noise id="sg-tooth" frequency="0.75" octaves={3} seed={3} matrix={specks(s.grain.color, 5, 0.5)} />}
        {s.smudge && <Noise id="sg-smudge" frequency="0.0022 0.0046" octaves={3} seed={8} matrix={specks(s.smudge.color, 3, 0.42)} />}
        {s.grid && (
          <pattern id="sg-grid" width={s.grid.spacing} height={s.grid.spacing} patternUnits="userSpaceOnUse">
            <path d={`M${s.grid.spacing} 0H0V${s.grid.spacing}`} fill="none" stroke={s.grid.color} strokeWidth={1.4} />
          </pattern>
        )}
        {s.grid?.major ? (
          <pattern id="sg-major" width={s.grid.spacing * s.grid.major} height={s.grid.spacing * s.grid.major} patternUnits="userSpaceOnUse">
            <path d={`M${s.grid.spacing * s.grid.major} 0H0V${s.grid.spacing * s.grid.major}`} fill="none" stroke={s.grid.color} strokeWidth={3} />
          </pattern>
        ) : null}
      </defs>
      <rect {...full} fill={s.color} />
      {s.light && <rect {...full} fill="url(#sg-light)" opacity={s.light.opacity} />}
      {s.smudge && <rect {...full} filter="url(#sg-smudge)" opacity={s.smudge.opacity} />}
      {s.grain && <rect {...full} filter="url(#sg-tooth)" opacity={s.grain.opacity} />}
      {s.grid && <rect {...full} fill="url(#sg-grid)" opacity={s.grid.opacity} />}
      {s.grid?.major ? <rect {...full} fill="url(#sg-major)" opacity={s.grid.opacity * 1.5} /> : null}
    </svg>
  );
});

// Dry-stick texture, applied only to the strokes that ask for it. The tooth only ever removes specks from a stroke.
//
// It is a mask of plain pixels (texture.ts), laid out in each stroke's own space, so the specks sit on the object and
// move, scale and turn with it. It used to be a turbulence filter on each stroke, which looked right on a still but not
// across a moment: browsers evaluate turbulence in a space they choose from the transform's kind and from whether a
// parent is composited, so the same chalk line changed its grain, and thin strokes (a tube's ticks) vanished or came
// back as dense scribble, whenever its object dimmed, brightened or turned. Pixels under a transform do not change.
const WIDE = { x: -20000, y: -20000, width: 40000, height: 40000 };
export const dryMask = (id: string) => `url(#${id})`;
const Dry: React.FC<{ id: string; amount: number }> = ({ id, amount }) => (
  <>
    <pattern id={`${id}-tile`} patternUnits="userSpaceOnUse" width={TILE} height={TILE}>
      <image href={toothTile(amount)} width={TILE} height={TILE} preserveAspectRatio="none" />
    </pattern>
    <mask id={id} maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" {...WIDE}>
      <rect {...WIDE} fill={`url(#${id}-tile)`} />
    </mask>
  </>
);

export const StyleDefs: React.FC<{ style: StyleSpec }> = ({ style }) => (
  <defs>
    {(style.line.grain > 0 || style.fill.kind === "scribble") && <Dry id="sg-dry" amount={style.line.grain} />}
    {style.type.grain > 0 && <Dry id="sg-dry-text" amount={style.type.grain} />}
  </defs>
);

// One path primitive, with no transform: wrap it in the node's own group.
export const StyledPath: React.FC<{ id: string; a: Props; style: StyleSpec; surface: string; accent: string }> = ({ id, a, style, surface, accent }) => (
  <>
    {paintPath(a, id, style, surface, accent).map((l, i) => (
      <path key={i} d={l.d} fill={l.fill ?? "none"} stroke={l.stroke ?? "none"} strokeWidth={l.width} opacity={l.opacity} strokeLinecap="round" strokeLinejoin="round" mask={l.dry ? dryMask("sg-dry") : undefined} />
    ))}
  </>
);

export const StyledText: React.FC<{ id: string; a: Props; theme: Theme; style: StyleSpec; surface: string }> = ({ id, a, theme, style, surface }) => {
  const t = paintText(a, id, theme, style, surface);
  const common = { textAnchor: String(a.anchor ?? "middle") as "start" | "middle" | "end", dominantBaseline: "central" as const, fontFamily: t.family, fontSize: t.size, fontWeight: t.weight, letterSpacing: t.spacing || undefined, rotate: t.rotate, dy: t.dy };
  return (
    <>
      {t.glow.map((g, i) => <text key={i} {...common} fill="none" stroke={t.color} strokeWidth={g.width} strokeLinejoin="round" opacity={g.opacity}>{t.text}</text>)}
      <text {...common} fill={t.color} mask={t.dry ? dryMask("sg-dry-text") : undefined}>{t.text}</text>
    </>
  );
};

const n = (v: unknown, d = 0) => (typeof v === "number" ? v : d);

const Item: React.FC<{ r: Resolved; theme: Theme; style: StyleSpec; surface: string }> = ({ r, theme, style, surface }) => {
  const a = r.props;
  const transform = `translate(${n(a.x)} ${n(a.y)}) rotate(${n(a.rotate)}) skewX(${n(a.skew)}) scale(${n(a.scaleX, 1)} ${n(a.scaleY, 1)})`;
  const kids = r.children.map((c) => <Item key={c.id} r={c} theme={theme} style={style} surface={surface} />);
  return (
    <g transform={transform} opacity={n(a.opacity, 1)}>
      {r.kind === "path" && <StyledPath id={r.id} a={a} style={style} surface={surface} accent={theme.colors.accent ?? "#000000"} />}
      {r.kind === "text" && <StyledText id={r.id} a={a} theme={theme} style={style} surface={surface} />}
      {r.kind === "image" && <image href={String(a.src)} x={-n(a.w) / 2} y={-n(a.h) / 2} width={n(a.w)} height={n(a.h)} />}
      {kids}
    </g>
  );
};

const PLAIN = resolveStyle({ palette: { paper: "#ffffff", ink: "#000000", accent: "#333333", highlight: "#ffff00" } });

export const StyledSceneView: React.FC<{ scene: Scene; theme: Theme; frame: number }> = ({ scene, theme, frame }) => {
  const style = theme.style ?? PLAIN;
  return (
    <div style={{ position: "relative", width: scene.width, height: scene.height, overflow: "hidden" }}>
      <Surface style={style} color={scene.background} theme={theme} width={scene.width} height={scene.height} />
      <svg width={scene.width} height={scene.height} viewBox={`0 0 ${scene.width} ${scene.height}`} style={{ position: "absolute", left: 0, top: 0 }}>
        <StyleDefs style={style} />
        {evaluate(scene, frame).map((r) => <Item key={r.id} r={r} theme={theme} style={style} surface={scene.background} />)}
      </svg>
    </div>
  );
};
