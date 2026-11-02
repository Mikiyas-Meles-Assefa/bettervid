// Draws one frame. Renders only the four primitives, so anything a kit makes appears here without new drawing code.
// Every property it reads is a plain number, color or list, so the track system animates all of them. docs/ENGINE-CONTRACT.md
// lists them. Effects cost nothing until they are used: a node at rest is one <g> plus its shape.
import React, { useId } from "react";
import { evaluate, parseGradient } from "../core/evaluate.ts";
import type { Props, Resolved, Scene, Theme, Value } from "../core/types.ts";
import { blendOf, bounds, filterOf, gradientGeometry, IDENTITY, inverse, line, list, matrixOf, n, safeId, themed, times, tintMatrix, transformOf, type Box, type Matrix } from "./effects.ts";
import { ShaderLayer } from "./ShaderLayer.tsx";
import { StyleDefs, StyledPath, StyledText, Surface } from "../style/draw.tsx";

// Masks and tints cover everything their part could touch. Browsers trim these to what is on screen.
const WIDE = { x: -20000, y: -20000, width: 40000, height: 40000 };

type Place = { r: Resolved; parent?: Place };
type Ctx = { surface: string; theme: Theme; time: number; prefix: string; places: Map<string, Place>; away: Set<string>; depth: number };

const inOrder = (list: Resolved[]) => (list.some((r) => n(r.props.z) !== 0) ? [...list].sort((a, b) => n(a.props.z) - n(b.props.z)) : list);

const worldOf = (p: Place | undefined): Matrix => (p ? times(worldOf(p.parent), matrixOf(p.r.props)) : IDENTITY);
const matrixAttr = (m: Matrix) => `matrix(${m.join(" ")})`;

// A paint is a color or a gradient. Returns what to put in fill or stroke, and the gradient to define if there is one.
function paintOf(value: Value | undefined, fallback: string, id: string, box?: Box): { paint: string; def?: React.ReactNode } {
  const g = parseGradient(value);
  if (!g) return { paint: String(value ?? fallback) };
  const stops = g.stops.map((s, i) => <stop key={i} offset={s.at} stopColor={s.color} />);
  const Tag = g.type === "linear" ? "linearGradient" : "radialGradient";
  return { paint: `url(#${id})`, def: <Tag key={id} id={id} {...gradientGeometry(g, box)}>{stops}</Tag> };
}

// Fades, cuts and lines shared by every primitive's body.
function strokeOf(a: Props, d: string, width: number, paint: string, id: string, defs: React.ReactNode[]) {
  const drawn = n(a.drawn, 1);
  const [from, to] = [n(a.trimStart), Math.min(n(a.trimEnd, 1), drawn)];
  const dash = list(a.dash);
  const trimmed = from > 0 || to < 1;
  const base = { strokeWidth: width, strokeLinecap: String(a.lineCap ?? "round") as "round", strokeLinejoin: String(a.lineJoin ?? "round") as "round", strokeOpacity: n(a.strokeOpacity, 1) };
  if (trimmed && to <= from) return { stroke: "none" }; // a round cap would otherwise leave a dot behind
  const cut = { pathLength: 1, strokeDasharray: `${to - from} 2`, strokeDashoffset: -from };
  if (trimmed && !dash) return { ...base, stroke: paint, ...cut };
  const dashes = dash ? { strokeDasharray: dash.join(" "), strokeDashoffset: n(a.dashOffset) } : {};
  if (!trimmed) return { ...base, stroke: paint, ...dashes };
  // Dashes and a partial draw both need the dash pattern, so the draw becomes a matte over the dashes.
  defs.push(
    <mask key={id} id={id} maskUnits="userSpaceOnUse" {...WIDE}>
      <path d={d} fill="none" stroke="#fff" strokeWidth={width + 2} strokeLinecap="butt" strokeLinejoin="round" {...cut} />
    </mask>,
  );
  return { ...base, stroke: paint, ...dashes, mask: `url(#${id})` };
}

function imageBody(a: Props, ctx: Ctx, id: string) {
  const [w, h] = [n(a.w), n(a.h)];
  if (typeof a.shader === "string") {
    const colors = [a.colorA, a.colorB, a.colorC].map((c, i) => String(c ?? [ctx.theme.colors.ink, ctx.theme.colors.accent, ctx.theme.colors.paper][i])) as [string, string, string];
    return <ShaderLayer source={a.shader} time={n(a.time, ctx.time)} params={list(a.params) ?? []} colors={colors} w={w} h={h} density={n(a.density, 1)} />;
  }
  if (typeof a.src !== "string") throw new Error(`image ${id} needs a src or a shader`);
  const crop = list(a.crop);
  const aspect = a.fit === "cover" ? "xMidYMid slice" : a.fit === "fill" ? "none" : "xMidYMid meet";
  if (!crop) return <image href={a.src} x={-w / 2} y={-h / 2} width={w} height={h} preserveAspectRatio={aspect} />;
  if (crop.length !== 4) throw new Error(`crop on ${id} needs [x, y, w, h] as fractions of the image`);
  // The crop is a window onto the whole image, so moving or shrinking it pans and zooms. srcW and srcH keep the
  // image's true shape; without them the image is taken to have the shape of its box.
  const [W, H] = [n(a.srcW, w), n(a.srcH, h)];
  return (
    <svg x={-w / 2} y={-h / 2} width={w} height={h} viewBox={`${crop[0]! * W} ${crop[1]! * H} ${Math.max(crop[2]!, 1e-4) * W} ${Math.max(crop[3]!, 1e-4) * H}`} preserveAspectRatio={aspect}>
      <image href={a.src} width={W} height={H} preserveAspectRatio="none" />
    </svg>
  );
}

function pathBody(r: Resolved, ctx: Ctx, id: string, defs: React.ReactNode[]) {
  const a = r.props;
  const points = list(a.points);
  const d = typeof a.d === "string" ? a.d : points ? line(points, !!n(a.smooth), !!n(a.closed)) : undefined;
  if (d === undefined) throw new Error(`path ${r.id} needs points or d`);
  const box = points ? bounds(points) : undefined;
  const width = n(a.strokeWidth, 6);
  const pen = ctx.theme.style;
  // The style draws plain lines and fills. A part with its own gradient or dash pattern keeps exactly what it asked for.
  if (pen && points && !a.glyph && !parseGradient(a.fill) && !parseGradient(a.stroke) && a.dash === undefined && a.trimStart === undefined && a.trimEnd === undefined) {
    const p = n(a.pulse, -1);
    return (
      <>
        <StyledPath id={r.id} a={a} style={pen} surface={ctx.surface} accent={ctx.theme.colors.accent ?? "#000000"} />
        {p >= 0 && p <= 1 && <path d={d} fill="none" stroke={String(a.pulseColor ?? ctx.theme.colors.accent)} strokeWidth={width * 2.2} strokeLinecap="round" pathLength={1} strokeDasharray="0.14 1" strokeDashoffset={-p * 0.86} />}
      </>
    );
  }
  const fill = paintOf(a.fill, "none", `${id}-f`, box);
  const stroke = paintOf(a.stroke, "none", `${id}-s`, box);
  defs.push(fill.def, stroke.def);
  const pulse = n(a.pulse, -1);
  const shape = <path d={d} fill={fill.paint} fillOpacity={n(a.drawn, 1) * n(a.fillOpacity, 1)} fillRule={a.fillRule === "evenodd" ? "evenodd" : undefined} {...strokeOf(a, d, width, stroke.paint, `${id}-t`, defs)} />;
  if (pulse < 0 || pulse > 1) return shape;
  return (
    <>
      {shape}
      {<path d={d} fill="none" stroke={String(a.pulseColor ?? ctx.theme.colors.accent)} strokeWidth={width * 2.2} strokeLinecap="round" pathLength={1} strokeDasharray="0.14 1" strokeDashoffset={-pulse * 0.86} />}
    </>
  );
}

function textBody(a: Props, ctx: Ctx, id: string, defs: React.ReactNode[]) {
  if (ctx.theme.style && !parseGradient(a.color) && a.stroke === undefined) return <StyledText id={id} a={a} theme={ctx.theme} style={ctx.theme.style} surface={ctx.surface} />;
  const fill = paintOf(a.color, ctx.theme.colors.ink!, `${id}-f`);
  const stroke = paintOf(a.stroke, "none", `${id}-s`);
  defs.push(fill.def, stroke.def);
  const outline = a.stroke !== undefined ? { stroke: stroke.paint, strokeWidth: n(a.strokeWidth, 2), strokeLinejoin: "round" as const, paintOrder: "stroke" } : {};
  return <text textAnchor={String(a.anchor ?? "middle") as "start" | "middle" | "end"} dominantBaseline="central" fontFamily={String(a.font ?? ctx.theme.fonts.body)} fontSize={n(a.size, 60)} fontWeight={n(a.weight, 400)} letterSpacing={n(a.tracking) || undefined} fill={fill.paint} {...outline}>{String(a.text ?? "")}</text>;
}

// Another part's picture used as this part's matte, placed where that part really is on screen.
function Matte({ r, ctx, id }: { r: Resolved; ctx: Ctx; id: string }) {
  const a = r.props;
  const source = ctx.places.get(String(a.mask));
  if (!source) throw new Error(`nothing called ${a.mask}, the mask of ${r.id}`);
  if (ctx.depth > 8) throw new Error(`mask loop at ${r.id}`);
  const at = times(inverse(worldOf(ctx.places.get(r.id)?.parent)), worldOf(source.parent));
  const luminance = a.maskMode === "luminance";
  if (a.maskMode !== undefined && !luminance && a.maskMode !== "alpha") throw new Error(`unknown maskMode ${a.maskMode}`);
  const invert = !!n(a.maskInvert);
  const picture = <g transform={matrixAttr(at)}><Item r={source.r} ctx={{ ...ctx, depth: ctx.depth + 1 }} direct /></g>;
  const back = (fill: string) => <rect {...WIDE} fill={fill} />;
  return (
    <mask id={id} maskUnits="userSpaceOnUse" {...WIDE} style={{ maskType: luminance || invert ? "luminance" : "alpha" }}>
      {!invert ? picture : luminance ? <g style={{ filter: "invert(1)" }}>{back("#000")}{picture}</g> : <>{back("#fff")}<g style={{ filter: "brightness(0)" }}>{picture}</g></>}
    </mask>
  );
}

// A local clip travels with the part. With `feather` its edge goes soft, which takes a matte rather than a hard clip.
function Clip({ a, id, children }: { a: Props; id: string; children: React.ReactNode }) {
  const shape = list(a.clip);
  if (!shape) return <>{children}</>;
  const d = line(shape, !!n(a.clipSmooth), true);
  const soft = n(a.feather);
  if (soft <= 0) {
    return (
      <>
        <clipPath id={id}><path d={d} /></clipPath>
        <g clipPath={`url(#${id})`}>{children}</g>
      </>
    );
  }
  const b = bounds(shape);
  const m = soft * 3;
  return (
    <>
      <mask id={id} maskUnits="userSpaceOnUse" x={b.x - m} y={b.y - m} width={b.w + m * 2} height={b.h + m * 2}><path d={d} fill="#fff" style={{ filter: `blur(${soft}px)` }} /></mask>
      <g mask={`url(#${id})`}>{children}</g>
    </>
  );
}

const Item: React.FC<{ r: Resolved; ctx: Ctx; direct?: boolean }> = ({ r, ctx, direct }) => {
  if (!direct && ctx.away.has(r.id)) return null;
  const a = r.props;
  const opacity = n(a.opacity, 1);
  // Hidden parts are not drawn. Players keep every picture decoded for the life of the tab, so a picture that comes
  // back draws at once; keeping hidden pictures mounted made picture-heavy scenes render several times slower.
  if (opacity <= 0) return null;
  const id = `${ctx.prefix}${safeId(r.id)}${ctx.depth ? `-m${ctx.depth}` : ""}`;
  const defs: React.ReactNode[] = [];
  // Called directly, not as elements, because they add to defs and that has to be full before it is read below.
  const body = r.kind === "path" ? pathBody(r, ctx, id, defs) : r.kind === "text" ? textBody(a, ctx, id, defs) : r.kind === "image" ? imageBody(a, ctx, r.id) : null;
  const kids = inOrder(r.children).map((c) => <Item key={c.id} r={c} ctx={ctx} />);
  const content = <Clip a={a} id={`${id}-c`}>{body}{kids}</Clip>;
  const transform = transformOf(a);

  const tint = tintMatrix(a.tint === undefined ? undefined : String(a.tint), n(a.tintAmount, 1));
  const filter = filterOf(a, ctx.theme, tint && `${id}-k`);
  const blend = blendOf(a);
  const masked = typeof a.mask === "string";
  const defined = defs.some(Boolean) ? <defs>{defs}</defs> : null;
  // Effects sit outside the transform so a shadow keeps its direction as a part turns.
  if (!filter && !blend && !masked && !n(a.isolate)) {
    // A plain leaf is one element, which is what keeps scenes of thousands of parts quick to paint.
    if (!r.children.length && !defined && !a.clip && (r.kind === "path" || r.kind === "text") && React.isValidElement(body) && typeof body.type === "string") return React.cloneElement(body as React.ReactElement<React.SVGProps<SVGElement>>, { transform, opacity });
    return <g transform={transform} opacity={opacity}>{defined}{content}</g>;
  }
  return (
    <g opacity={opacity} mask={masked ? `url(#${id}-m)` : undefined} style={{ filter, mixBlendMode: blend as React.CSSProperties["mixBlendMode"], isolation: n(a.isolate) ? "isolate" : undefined }}>
      {tint && <filter id={`${id}-k`} filterUnits="userSpaceOnUse" {...WIDE} colorInterpolationFilters="sRGB"><feColorMatrix type="matrix" values={tint} /></filter>}
      {masked && <Matte r={r} ctx={ctx} id={`${id}-m`} />}
      <g transform={transform}>{defined}{content}</g>
    </g>
  );
};

const maskOf = (p: Place | undefined) => (typeof p?.r.props.mask === "string" ? p.r.props.mask : undefined);

// Finds where everything lives, what is drawn elsewhere (lifted to a layer, or used as a matte), and in what order.
function survey(roots: Resolved[]) {
  const places = new Map<string, Place>();
  const away = new Set<string>();
  const lifted: Place[] = [];
  const masks: string[] = [];
  const walk = (r: Resolved, parent?: Place) => {
    const place = { r, parent };
    places.set(r.id, place);
    if (n(r.props.layer) !== 0) {
      lifted.push(place);
      away.add(r.id);
    }
    if (typeof r.props.mask === "string") masks.push(r.props.mask);
    for (const c of r.children) walk(c, place);
  };
  for (const r of roots) walk(r);
  for (const m of masks) away.add(m);
  for (const m of masks) {
    const seen = new Set<string>();
    for (let at: string | undefined = m; at !== undefined; at = maskOf(places.get(at))) {
      if (seen.has(at)) throw new Error(`mask loop at ${at}`);
      seen.add(at);
    }
  }
  lifted.sort((a, b) => n(a.r.props.layer) - n(b.r.props.layer));
  return { places, away, lifted };
}

// A lifted part leaves its group's stacking, its filters and its clip, but keeps its position and fade.
const Lifted: React.FC<{ place: Place; ctx: Ctx }> = ({ place, ctx }) => {
  let out = <Item r={place.r} ctx={ctx} direct />;
  for (let p = place.parent; p; p = p.parent) out = <g transform={transformOf(p.r.props)} opacity={n(p.r.props.opacity, 1)}>{out}</g>;
  return out;
};

export const SceneView: React.FC<{ scene: Scene; theme: Theme; frame: number }> = ({ scene, theme, frame }) => {
  const prefix = `s${useId().replace(/[^a-zA-Z0-9]/g, "")}-`;
  const painted = themed(scene, theme);
  const roots = evaluate(painted, frame);
  const { places, away, lifted } = survey(roots);
  const ctx: Ctx = { theme, time: frame / scene.fps, prefix, places, away, depth: 0, surface: String(painted.background) };
  const box = { x: 0, y: 0, w: scene.width, h: scene.height };
  const back = paintOf(painted.background, painted.background, `${prefix}background`, box);
  const show = (p: Place) => <Lifted key={p.r.id} place={p} ctx={ctx} />;
  const pen = theme.style;
  if (pen) {
    return (
      <div style={{ position: "relative", width: scene.width, height: scene.height, overflow: "hidden" }}>
        <Surface style={pen} color={String(painted.background)} theme={theme} width={scene.width} height={scene.height} />
        <svg width={scene.width} height={scene.height} viewBox={`0 0 ${scene.width} ${scene.height}`} style={{ position: "absolute", left: 0, top: 0 }}>
          <StyleDefs style={pen} />
          {lifted.filter((p) => n(p.r.props.layer) < 0).map(show)}
          {inOrder(roots).map((r) => <Item key={r.id} r={r} ctx={ctx} />)}
          {lifted.filter((p) => n(p.r.props.layer) > 0).map(show)}
        </svg>
      </div>
    );
  }
  return (
    <svg width={scene.width} height={scene.height} viewBox={`0 0 ${scene.width} ${scene.height}`} style={{ display: "block", background: back.def ? undefined : back.paint }}>
      {back.def && <defs>{back.def}</defs>}
      <rect width={scene.width} height={scene.height} fill={back.paint} />
      {lifted.filter((p) => n(p.r.props.layer) < 0).map(show)}
      {inOrder(roots).map((r) => <Item key={r.id} r={r} ctx={ctx} />)}
      {lifted.filter((p) => n(p.r.props.layer) > 0).map(show)}
    </svg>
  );
};
