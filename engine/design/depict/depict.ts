// Tier 1 entry: a PropSpec and the style's theme to a Depiction, the check a repair round reads, the look a style
// suggests, and helpers that move contents between two things and turn changes into scene steps.
import { legibility as legibilityInstrument } from "../instruments/legibility.ts";
import type { Viewing } from "../types.ts";
import type { Ease, Step, Theme, Value } from "../../core/types.ts";
import { KINDS } from "./kinds/index.ts";
import { makeDepiction, findVerb } from "./make.ts";
import type { PropSpec } from "./spec.ts";
import { isHex } from "./geom.ts";
import type { Change, DepictLook, Depiction, Pt, Timing } from "./types.ts";

export type DepictOptions = { id: string; look: DepictLook; /** label and scale text size in local units, when decided */ text?: number };

/** The look a style suggests for a depiction drawn at `pxPerUnit` screen pixels per local unit. Every value overridable. */
export function suggestLook(theme: Theme, pxPerUnit: number): DepictLook {
  const px = theme.design?.elements?.pointer?.width ?? 6;
  const glassy = theme.style?.line.pen === "vector" || !theme.style ? 1 : 0.6;
  return {
    line: { value: px / pxPerUnit, from: "style", why: `the style's line width (${px} px) at this size on screen` },
    shine: { value: glassy, from: "style", why: glassy === 1 ? "a clean vector style shows highlights in full" : "a drawn style keeps highlights quieter so the pen leads" },
    shade: { value: theme.style?.fill.kind === "solid" || !theme.style ? 1 : 0.4, from: "style", why: "volume shading suits solid fills; textured fills carry their own" },
    glow: { value: (px * 3) / pxPerUnit, from: "style", why: "light reaches about three line widths" },
  };
}

export function depictionFrom(spec: PropSpec, theme: Theme, opts: DepictOptions): Depiction {
  const tier = spec.tier ?? 1;
  if (tier !== 1) throw new Error(`${opts.id}: tier ${tier} depictions are made from their picture: spriteDepiction or pictureDepiction`);
  const def = KINDS[spec.kind];
  if (!def) throw new Error(`${opts.id}: no kind "${spec.kind}" (kinds: ${Object.keys(KINDS).join(", ")})`);
  return makeDepiction(def, spec, theme, opts.look, { id: opts.id, text: opts.text });
}

export type SpecProblem = { path: string; problem: string };

/**
 * Problems with a spec, for the depicter's repair round: an unknown kind or form, a missing parameter, impossible
 * sizes, colors that are not colors, layers out of order, and verbs the plan needs that the thing cannot do.
 */
export function checkSpec(spec: PropSpec, needs: { verbs?: string[] } = {}, theme?: Theme): SpecProblem[] {
  const out: SpecProblem[] = [];
  const tier = spec.tier ?? 1;
  if (!spec.label?.trim()) out.push({ path: "label", problem: "give the thing's plain name" });
  if (tier === 2) {
    if (!spec.sprite?.parts?.length) out.push({ path: "sprite.parts", problem: "a sprite needs the parts to cut, each with a phrase and how it changes" });
    return out;
  }
  if (tier === 3 || tier === 4) {
    if (!spec.picture?.card) out.push({ path: "picture.card", problem: "a picture depiction names its part card" });
    return out;
  }
  const def = KINDS[spec.kind];
  if (!def) return [{ path: "kind", problem: `"${spec.kind}" is not a kind of thing; use one of ${Object.keys(KINDS).join(", ")}, or an outline for an everyday object` }];
  if (def.forms && !spec.form) out.push({ path: "form", problem: `${def.name} needs a form: ${Object.keys(def.forms).join(", ")}` });
  if (def.forms && spec.form && !def.forms[spec.form]) out.push({ path: "form", problem: `${def.name} has no form "${spec.form}" (forms: ${Object.keys(def.forms).join(", ")})` });
  for (const r of def.required ?? []) {
    const [form, p] = r.includes(":") ? r.split(":") : [undefined, r];
    if (form && form !== spec.form) continue;
    if (spec.params?.[p!] === undefined) out.push({ path: `params.${p}`, problem: `${def.name}${form ? ` (${form})` : ""} needs ${p}: ${def.params[p!] ?? ""}` });
  }
  if (spec.size) {
    const { w, h } = spec.size;
    if (!(w > 0) || !(h > 0)) out.push({ path: "size", problem: "width and height must be above zero" });
    else if (Math.max(w / h, h / w) > 400) out.push({ path: "size", problem: `a ${w} by ${h} thing is too thin to draw; check the units` });
  }
  for (const [name, c] of Object.entries(spec.colors ?? {})) if (!isHex(c)) out.push({ path: `colors.${name}`, problem: `"${c}" is not #rrggbb or #rrggbbaa` });
  for (const name of Object.keys(spec.colors ?? {})) if (!spec.colorSources?.[name]) out.push({ path: `colorSources.${name}`, problem: `say where the color "${name}" comes from (a quote from the material, or known: ...)` });
  // Kind specific: a profile that rises, layers in order, scales with a span.
  const prof = spec.params?.profile as Pt[] | undefined;
  if (spec.kind === "container" && Array.isArray(prof)) {
    if (prof.length < 2) out.push({ path: "params.profile", problem: "a profile needs at least two points, base and rim" });
    for (let i = 1; i < prof.length; i++) if (!(prof[i]![1] >= prof[i - 1]![1])) out.push({ path: `params.profile.${i}`, problem: "heights must rise from the base to the rim" });
    for (const [hw] of prof) if (!(hw >= 0 && hw <= 0.5)) out.push({ path: "params.profile", problem: `half-width ${hw} is outside 0 to 0.5 of the width` });
    const layers = (spec.params?.contents as { level: number; color: string; name: string }[] | undefined) ?? [];
    for (let i = 0; i < layers.length; i++) {
      const l = layers[i]!;
      if (!(l.level >= 0 && l.level <= 1)) out.push({ path: `params.contents.${i}.level`, problem: "a level is 0 to 1 of the inside height" });
      if (i && !(l.level >= layers[i - 1]!.level)) out.push({ path: `params.contents.${i}`, problem: "layers go from the bottom up, each level above the last" });
      if (!spec.colors?.[l.color] && !isHex(l.color)) out.push({ path: `params.contents.${i}.color`, problem: `"${l.color}" is not a color named in colors` });
    }
  }
  const sc0 = spec.params?.scale as { top?: number; bottom?: number; from?: number; to?: number; minor: number; major: number } | undefined;
  const sc = sc0 && { ...sc0, top: sc0.top ?? sc0.to, bottom: sc0.bottom ?? sc0.from };
  if (sc && (sc.top === sc.bottom || !(sc.minor > 0) || !(sc.major > 0))) out.push({ path: "params.scale", problem: "a scale needs different top and bottom values and steps above zero" });
  if (sc && sc.minor > 0 && Math.abs(Number(sc.top) - Number(sc.bottom)) / sc.minor > 400) out.push({ path: "params.scale.minor", problem: "more than 400 ticks: use a larger minor step" });
  if (out.length) return out;
  // Build it: anything the builder refuses is a problem too, and the plan's verbs must be doable.
  try {
    const d = depictionFrom(spec, theme ?? CHECK_THEME, { id: "check", look: CHECK_LOOK });
    for (const v of needs.verbs ?? []) {
      const key = findVerb(d.verbs, v);
      if (!key) {
        out.push({ path: `verbs.${v}`, problem: `the plan says it "${v}", which a ${spec.kind} cannot do; map it in verbs (like: one of ${Object.keys(d.verbs).join(", ")}, or sets: state changes)` });
        continue;
      }
      for (const need of d.verbs[key]!.needs ?? []) if (!d.parts[need]) out.push({ path: `verbs.${v}`, problem: `"${v}" needs a ${need}, which this ${spec.kind} does not have; add it in params` });
    }
  } catch (e) {
    out.push({ path: "spec", problem: (e as Error).message.replace(/^check: /, "") });
  }
  return out;
}
const CHECK_THEME: Theme = { colors: { ink: "#000000", paper: "#ffffff", accent: "#ff0000" }, fonts: { title: "sans-serif", body: "sans-serif" }, moveFrames: 12, ease: "smooth" };
const CHECK_LOOK: DepictLook = { line: { value: 8, from: "style" }, shine: { value: 1, from: "style" }, shade: { value: 1, from: "style" }, glow: { value: 20, from: "style" } };

/**
 * Moves an amount (in the source's capacity unit, such as mL) from one thing to another: both levels change over the
 * timing. The caller draws the flow between `from.anchor("outlet")` (or "mouth") and `to.anchor("surface")`.
 */
export function transfer(from: Depiction, to: Depiction, amount: number, timing: Timing): { changes: Change[]; moved: number; notes: string[] } {
  if (!from.capacity || !to.capacity) throw new Error(`${from.id} to ${to.id}: both need contents with a level`);
  const have = from.capacity.at(Number(from.state.level));
  const moved = Math.min(amount, have);
  const fromLevel = from.capacity.levelOf(have - moved);
  const toLevel = to.capacity.levelOf(to.capacity.at(Number(to.state.level)) + moved);
  const changes = [...from.apply({ level: fromLevel }, { ...timing, ease: timing.ease ?? "linear" }), ...to.apply({ level: toLevel }, { ...timing, ease: timing.ease ?? "linear" })];
  const notes = [`${from.label} to ${to.label}: ${moved.toFixed(2)} ${from.capacity.unit}${from.read ? `; ${from.label} now reads ${from.read()}` : ""}${toLevel >= 1 ? `; ${to.label} is full` : ""}`];
  return { changes, moved, notes };
}

/** Changes, started at frame `at`, as SceneDoc steps (one per start, length and ease). */
export function changesToSteps(changes: Change[], at: number): Step[] {
  const groups = new Map<string, { at: number; frames: number; ease: Ease; set: Record<string, Record<string, Value>> }>();
  for (const c of changes) {
    const start = Math.round(at + c.at);
    const k = `${start}|${c.frames}|${c.ease}`;
    const g = groups.get(k) ?? groups.set(k, { at: start, frames: c.frames, ease: c.ease, set: {} }).get(k)!;
    (g.set[c.id] ??= {})[c.prop] = c.value;
  }
  return [...groups.values()].sort((a, b) => a.at - b.at).map((g) => ({ at: g.at, set: g.set, move: { frames: g.frames, ease: g.ease } }));
}

/**
 * How many times its true size a moving part (a drop, a particle, a stream's width) should be drawn so this viewing
 * sees it: until it subtends `need` arcminutes on the viewer's eye. `need` is the designer's; its suggestion is the
 * viewing's readable size for words (the legibility instrument's `readable`), as a moving speck smaller than a letter a
 * viewer can read in passing is not seen. Returns 1 when the true size is already enough. A suggestion, with its reason.
 */
export function suggestMagnify(truePx: number, viewing: Viewing, need = suggestLegibility(viewing).readable): { value: number; why: string } {
  const mm = (truePx / Math.max(1, viewing.width)) * viewing.frameWidthMm;
  const angle = ((2 * Math.atan(mm / 2 / Math.max(1, viewing.distanceMm)) * 180) / Math.PI) * 60;
  const value = angle > 0 ? Math.max(1, Math.round((need / angle) * 10) / 10) : 1;
  return { value, why: `at true size it is ${angle.toFixed(1)} arcmin on ${viewing.screen} at ${viewing.distanceMm} mm; seen in passing needs about ${need.toFixed(0)} arcmin (the viewing's readable size), so ${value === 1 ? "true size is enough" : `drawn ${value} times its size`}` };
}
const suggestLegibility = (v: Viewing) => legibilityInstrument.suggest(v) as { readable: number };
