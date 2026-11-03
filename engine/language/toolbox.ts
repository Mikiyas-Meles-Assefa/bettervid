// The design brain's abilities offered to the scene writer as words of the scene language (path A). The writer decides
// what is on screen, where and when; this carries it out and says what it could not do.
//
// - `depict ID "what it is"`: a thing drawn as itself, with parts that carry state (a burette with its scale, valve and
//   level; a flask whose contents turn pink). The depicter (an agent) reads the writer's words, the verbs the scene has
//   it do and the relations it stands in, and answers with a PropSpec; the engine draws it (engine/design/depict). A
//   generated sprite in the video's style (tier=sprite) and a real picture with parts (asset=NAME, or tier=picture for
//   one the picture hunter finds) are the same thing to the writer.
// - `do change ID STATE=VALUE` and `do act ID verb="drips into" to=OTHER amount=5`: the thing's own states and verbs.
//
// Depictions come from agents, so they are prepared before a build (`prepareToolbox`) and kept in a Toolbox the kit
// reads; every build of the same scene draws the same things. Nothing here is about a topic.
import type { Behavior, CompileContext, Kit, NodeSpec, Theme, Track, Value } from "../core/types.ts";
import { depict, depictionFrom, pictureDepiction, sizeCm, spriteDepiction, suggestLook, transfer, type DepictRequest, type Depiction, type PropSpec, type SpriteMaker, type StateMap, type StateValue } from "../design/depict/index.ts";
import { getSprite, loadSprite, spriteRequest, SPRITE_CACHE } from "../design/depict/sprite.ts";
import { POSE_STATES, POSE_VERBS } from "../design/depict/make.ts";
import { pointOf } from "../design/depict/points.ts";
import type { PartCard, Reasoner } from "../design/types.ts";
import { parse, type Item } from "./syntax.ts";
import { existsSync, readFileSync } from "node:fs";
import { extname, isAbsolute } from "node:path";

// Pictures on disk (a sprite, its masks, a picture with parts) go into the scene as data the renderer can load anywhere.
const DATA = new Map<string, string>();
const loadable = (src: unknown): unknown => {
  if (typeof src !== "string" || !isAbsolute(src) || !existsSync(src)) return src;
  const type = extname(src).toLowerCase() === ".png" ? "image/png" : "image/jpeg";
  return DATA.get(src) ?? DATA.set(src, `data:${type};base64,${readFileSync(src).toString("base64")}`).get(src)!;
};

export type ToolboxEntry = {
  id: string;
  desc: string;
  /** The verbs and states the scene asked of it when it was prepared, so a scene that asks for more prepares it again. */
  verbs: string[];
  relations: string[];
  spec: PropSpec;
  /** What the depicter's answer still has wrong after its rounds, said to the writer. */
  problems: string[];
  /** Tier 2: the cached sprite's description and style. */
  sprite?: { desc: string; style: string; root?: string };
  /** Tiers 3 and 4: the picture with its parts. */
  picture?: { card: PartCard; src: string; masks?: Record<string, string>; tier: 3 | 4 };
};
export type Toolbox = { depictions: Record<string, ToolboxEntry> };
export const emptyToolbox = (): Toolbox => ({ depictions: {} });
export const entryKey = (id: string, desc: string) => `${id}\u0000${desc.trim().replace(/\s+/g, " ").toLowerCase()}`;

/** What makes the things a depiction can be: the depicter always; a sprite maker and a picture reader when the pipeline has them. */
export type ToolboxMakers = {
  depicter: Reasoner;
  sprite?: SpriteMaker;
  /** A picture with named parts: the user's own asset by name, or (without one) a picture found for the description. */
  picture?: (req: { desc: string; asset?: string; parts: string[] }) => Promise<{ card: PartCard; src: string; masks?: Record<string, string>; tier: 3 | 4 }>;
  style: { name: string; art: string };
  purpose?: string;
  /** Whether making a new sprite is allowed (it costs money); a cached one is always used. */
  sprites?: boolean;
  spriteRoot?: string;
  rounds?: number;
};

// The depictions one build is drawing, by id: made fresh each time the kit expands a thing, then moved by behaviors in
// the order the scene plays them.
type Live = Map<string, Depiction>;

const DEPICT_OWN = new Set(["text", "tier", "asset", "parts", "cm", "w", "h", "role", "enter", "at", "into", "before", "after", "follow", "id"]);

function stateValue(d: Depiction, name: string, v: Value, spec?: PropSpec, theme?: Theme): StateValue {
  const def = d.states[name]!;
  // A color is one the depicter named for the real thing, a #hex, or one of the style's colors.
  if (def.type === "color") {
    const c = String(v);
    const named = spec?.colors?.[c] ?? Object.entries(spec?.colors ?? {}).find(([k]) => k.toLowerCase() === c.toLowerCase())?.[1];
    if (named) return named;
    if (/^#([0-9a-f]{6}|[0-9a-f]{8})$/i.test(c) || theme?.colors[c]) return c;
    throw new Error(`${d.id}'s ${name} cannot be "${c}": its colors are ${Object.keys(spec?.colors ?? {}).join(", ") || "none named"}, or a #hex`);
  }
  if (def.type === "number" || def.type === "angle") return Number(v);
  if (def.type === "bool") return v === "1" || v === 1 || v === "true" || v === "yes";
  if (def.type === "point") return Array.isArray(v) ? [Number(v[0]), Number(v[1])] as [number, number] : (String(v).split(",").map(Number) as [number, number]);
  return String(v);
}

function makeOne(e: ToolboxEntry, id: string, theme: Theme, state: StateMap): Depiction {
  const spec: PropSpec = { ...e.spec, state: { ...e.spec.state, ...state } };
  const draft = (pxPerUnit: number) => {
    const look = suggestLook(theme, pxPerUnit);
    if (e.picture) return pictureDepiction(id, e.picture.card, e.picture.src, theme, look, { tier: e.picture.tier, ...(e.picture.masks ? { masks: e.picture.masks } : {}), spec });
    if (e.sprite) {
      const s = loadSprite(e.sprite.desc, e.sprite.style, e.sprite.root ?? SPRITE_CACHE);
      if (!s) throw new Error(`the sprite for "${e.desc}" in ${e.sprite.style} is not in the cache`);
      return spriteDepiction(id, s, spec, theme, look);
    }
    return depictionFrom(spec, theme, { id, look });
  };
  // Lines are drawn at the style's width for the size the thing usually takes on a phone frame (about half its height).
  const first = draft(1);
  return draft((0.45 * 1920) / Math.max(1, first.box.w, first.box.h));
}

// Named points in the depiction's local units; the build turns them into shares of the box it really draws.
const localPoints = (d: Depiction): Record<string, [number, number]> => {
  const out: Record<string, [number, number]> = {};
  const to01 = (p: [number, number]): [number, number] => p;
  for (const [k, p] of Object.entries(d.points ?? {})) out[k.toLowerCase()] = to01(p);
  for (const name of ["outlet", "mouth", "surface", "tip", "top", "bottom", "left", "right", "center"]) {
    const p = name in out ? undefined : d.anchor(name);
    if (p) out[name] = to01(p);
  }
  for (const [k, part] of Object.entries(d.parts)) if (!(k.toLowerCase() in out)) out[k.toLowerCase()] = to01(part.anchor);
  return out;
};

/** What a prepared thing can do, for the writer: its states, verbs and points. */
export function describeDepiction(d: Depiction): string {
  // Its own states first (a level, a color, a reading), then the ones every thing has (place, turn, size).
  const pose = new Set(Object.keys(POSE_STATES));
  const range = (s: { min?: number; max?: number }) => (s.min !== undefined && s.max !== undefined ? ` ${s.min} to ${s.max}` : s.min !== undefined ? ` from ${s.min}` : s.max !== undefined ? ` up to ${s.max}` : "");
  const states = Object.entries(d.states).sort(([a], [b]) => Number(pose.has(a)) - Number(pose.has(b))).map(([k, s]) => `${k} (${s.type}${range(s)}${s.unit ? ` ${s.unit}` : ""}, now ${JSON.stringify(d.state[k])}): ${s.about}`);
  const verbs = Object.keys(d.verbs).filter((v) => !(v in POSE_VERBS));
  const points = Object.keys(d.points ?? {});
  return `${d.id}, drawn as ${d.label} (${d.kind}${d.form ? ` ${d.form}` : ""}${d.size ? `, ${d.size.w} by ${d.size.h} ${d.size.unit}` : ""}). States for \`do change ${d.id} STATE=VALUE\`: ${states.join("; ") || "none"}. Verbs for \`do act ${d.id} verb="..."\`: ${verbs.join(", ") || "none"} (and moves to, moves, turns, falls, ... as any thing). Parts: ${Object.keys(d.parts).map((p) => `${d.id}.${d.parts[p]!.node.slice(d.id.length + 1) || p}`).slice(0, 12).join(", ")}${points.length ? `. Points it meets other things by: ${points.join(", ")}` : ""}.${d.read?.() ? ` It reads ${d.read()}.` : ""}`;
}

/** The toolbox as a kit: the `depict` kind and the `change` and `act` behaviors. */
export function toolboxKit(box: Toolbox): Kit {
  // One build's depictions, by the kit list of that build's context (one list per build), so builds never share state.
  const builds = new WeakMap<object, Live>();
  const specs = new Map<string, PropSpec>();
  const liveOf = (ctx: CompileContext): Live => {
    const key = (ctx.kits ?? ctx) as object;
    return builds.get(key) ?? builds.set(key, new Map()).get(key)!;
  };
  const entryFor = (node: NodeSpec) => {
    const desc = typeof node.data?.text === "string" ? node.data.text : "";
    if (!desc.trim()) throw new Error(`depict needs quoted words saying what the thing is, as in depict ${node.id} "a glass flask half full of clear water"`);
    const e = box.depictions[entryKey(node.id, desc)];
    if (!e) throw new Error(`no depiction of "${desc}" is prepared for ${node.id}; the scene stage prepares each depict line before it builds`);
    return e;
  };
  const depictKind = (node: NodeSpec, ctx: CompileContext): NodeSpec[] => {
    const e = entryFor(node);
    const data = node.data ?? {};
    const probe = makeOne(e, node.id, ctx.theme, {});
    const state: StateMap = {};
    for (const [k, v] of Object.entries(data)) {
      if (DEPICT_OWN.has(k)) continue;
      if (!probe.states[k]) throw new Error(`${node.id} has no state ${k}. ${describeDepiction(probe)}`);
      state[k] = stateValue(probe, k, v as Value, e.spec, ctx.theme);
    }
    const d = Object.keys(state).length ? makeOne(e, node.id, ctx.theme, state) : probe;
    liveOf(ctx).set(node.id, d);
    specs.set(node.id, e.spec);
    const real = sizeCm(e.spec);
    const root = d.nodes.find((n) => n.id === d.id);
    const props = { ...root?.props, ...(real ? { realW: real.w, realH: real.h } : {}), pointsLocal: JSON.stringify(localPoints(d)) };
    const rest = d.nodes.filter((n) => n.id !== d.id).map((n) => (n.props?.src !== undefined ? { ...n, props: { ...n.props, src: loadable(n.props.src) as string } } : n));
    return [{ ...(root ?? { id: d.id, kind: "group" }), props }, ...rest];
  };
  const tracksOf = (changes: { id: string; prop: string; value: Value; at: number; frames: number; ease: string }[], start: number, tools: Parameters<Behavior>[0]["tools"]): Track[] =>
    changes.map((c) => {
      const at = Math.round(start + c.at);
      const was = tools.value(c.id, c.prop, at) ?? tools.props(c.id)[c.prop] ?? c.value;
      return { target: c.id, prop: c.prop, keys: [{ at, value: was }, { at: at + Math.max(0, Math.round(c.frames)), value: c.value, ease: c.ease as Track["keys"][0]["ease"] }] };
    });
  const need = (target: string, ctx: CompileContext) => {
    const d = liveOf(ctx).get(target);
    if (!d) throw new Error(`${target} is not a depicted thing on screen; do change and do act work on things made with depict`);
    return d;
  };
  const timing = (args: Record<string, Value>, ctx: CompileContext) => ({ frames: Number(args.frames ?? ctx.theme.moveFrames * 2), ...(typeof args.ease === "string" ? { ease: args.ease as never } : {}), fps: ctx.fps });
  const change: Behavior = ({ target, start, args, ctx, tools }) => {
    const d = need(target, ctx);
    const spec = specs.get(target);
    const next: StateMap = { ...d.state };
    for (const [k, v] of Object.entries(args)) {
      if (k === "frames" || k === "ease") continue;
      if (!d.states[k]) throw new Error(`${target} has no state ${k}. ${describeDepiction(d)}`);
      next[k] = stateValue(d, k, v, spec, ctx.theme);
    }
    return tracksOf(d.apply(next, timing(args, ctx)), start, tools);
  };
  const act: Behavior = ({ target, start, args, ctx, tools }) => {
    const d = need(target, ctx);
    const verb = typeof args.verb === "string" ? args.verb : "";
    if (!verb) throw new Error(`do act needs verb="..." in quotes, one of ${target}'s verbs. ${describeDepiction(d)}`);
    const t = timing(args, ctx);
    const r = d.act(verb, args.arg as StateValue | undefined, t);
    if (!r.known) throw new Error(`${r.notes.join(" ")}. ${describeDepiction(d)}`);
    const out = [...r.changes];
    // Contents moving into another thing: both levels change together, by the amount the writer gives.
    if (typeof args.to === "string" && args.amount !== undefined) {
      const other = need(args.to, ctx);
      out.push(...transfer(d, other, Number(args.amount), t).changes.filter((c) => !c.id.startsWith(`${d.id}.`) || !r.changes.some((x) => x.id === c.id && x.prop === c.prop)));
    }
    return tracksOf(out, start, tools);
  };
  return {
    name: "toolbox",
    kinds: { depict: depictKind },
    behaviors: { change, act },
    docs: {
      depict: '`depict ID "what it is, in plain words"`: the thing drawn as itself, with parts that carry state (see Depicted things)',
      change: "`do change ID STATE=VALUE frames=20 ease=smooth`: a depicted thing's state changes (its level, its color, a reading)",
      act: '`do act ID verb="drips into" to=OTHER amount=5 frames=60`: a depicted thing does one of its verbs; with to= and amount=, contents move into OTHER',
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Preparing: every depict line of a scene gets its depiction before the scene is built.

export type Wanted = { id: string; desc: string; verbs: string[]; states: string[]; relations: string[]; company: string[]; tier?: string; asset?: string; parts: string[] };

/** The depicted things a scene asks for, with the verbs, states and relations it uses them in. */
export function wantedIn(source: string, kitKinds: Iterable<string>): Wanted[] {
  const { doc } = parse(source, kitKinds);
  const found = new Map<string, Wanted>();
  const relations: { a: string; b: string; line: string }[] = [];
  const visit = (items: Item[]) => items.forEach((i) => {
    if (i.kind === "depict" && i.text?.trim()) {
      const k = entryKey(i.id, i.text);
      if (!found.has(k)) found.set(k, { id: i.id, desc: i.text.trim(), verbs: [], states: [], relations: [], company: [], ...(i.attrs.tier ? { tier: i.attrs.tier } : {}), ...(i.attrs.asset ? { asset: i.attrs.asset } : {}), parts: (i.attrs.parts ?? "").split(",").map((x) => x.trim()).filter(Boolean) });
    }
    for (const r of i.relations ?? []) relations.push({ a: r.a, b: r.b, line: `${r.a} ${r.words} ${r.b}${r.at ? ` "${r.at}"` : r.gapCm !== undefined ? ` "${r.gapCm} cm"` : ""}` });
    visit(i.children);
  });
  doc.states.forEach((s) => visit(s.items));
  const all = [...found.values()];
  for (const s of doc.states) for (const c of s.commands) {
    if (c.do !== "play" || (c.behavior !== "act" && c.behavior !== "change")) continue;
    for (const t of c.targets) for (const w of all.filter((x) => x.id === t)) {
      if (c.behavior === "act" && c.attrs.verb && !w.verbs.includes(c.attrs.verb)) w.verbs.push(c.attrs.verb);
      if (c.behavior === "change") for (const k of Object.keys(c.attrs)) if (k !== "frames" && k !== "ease" && !w.states.includes(k)) w.states.push(k);
    }
  }
  for (const w of all) {
    w.relations = [...new Set(relations.filter((r) => r.a === w.id || r.b === w.id).map((r) => r.line))];
    w.company = all.filter((x) => x !== w).map((x) => `${x.id}: ${x.desc}`).slice(0, 8);
  }
  return all;
}

const covers = (e: ToolboxEntry, w: Wanted) => [...w.verbs, ...w.states.map((s) => `state ${s}`)].every((v) => e.verbs.includes(v)) && w.relations.every((r) => e.relations.includes(r));

/**
 * Prepares every depiction a scene asks for that the toolbox does not have yet (or has without the verbs, states or
 * relations the scene now uses). Returns what it spent in calls and what could not be prepared, in words for the writer.
 */
export async function prepareToolbox(source: string, kitKinds: Iterable<string>, box: Toolbox, makers: ToolboxMakers, inflight = new Map<string, Promise<void>>()): Promise<{ made: string[]; problems: string[] }> {
  const made: string[] = [];
  const problems: string[] = [];
  await Promise.all(wantedIn(source, kitKinds).map(async (w) => {
    const key = entryKey(w.id, w.desc);
    const known = box.depictions[key];
    if (known && covers(known, w)) return;
    const asked = [...new Set([...(known?.verbs ?? []), ...w.verbs, ...w.states.map((s) => `state ${s}`)])];
    const rel = [...new Set([...(known?.relations ?? []), ...w.relations])];
    const flight = `${key}\u0000${asked.join("|")}\u0000${rel.join("|")}`;
    if (!inflight.has(flight)) inflight.set(flight, (async () => {
      const req: DepictRequest = {
        id: `depict.${w.id}`,
        name: w.id,
        desc: w.desc,
        acts: [...asked.filter((v) => !v.startsWith("state ")).map((verb) => ({ verb })), ...asked.filter((v) => v.startsWith("state ")).map((v) => ({ verb: `changes its ${v.slice(6)}` }))],
        ...(w.company.length ? { company: w.company } : {}),
        ...(makers.purpose ? { purpose: makers.purpose } : {}),
        ...(rel.length ? { relations: rel } : {}),
      };
      const a = await depict(makers.depicter, req, makers.rounds ?? 2);
      if (a.status !== "answered") throw new Error(`the depicter has not answered for ${w.id}`);
      let spec = a.spec;
      const entry: ToolboxEntry = { id: w.id, desc: w.desc, verbs: asked, relations: rel, spec, problems: a.problems.map((p) => `${p.path}: ${p.problem}`) };
      const picture = w.asset !== undefined || w.tier === "picture" || spec.tier === 3 || spec.tier === 4;
      const sprite = !picture && (w.tier === "sprite" || spec.tier === 2);
      if (picture) {
        if (!makers.picture) throw new Error(`${w.id} asks for a picture with parts, and this run has no picture reader`);
        const parts = w.parts.length ? w.parts : Object.keys(spec.verbs ?? {}).length ? [] : [];
        entry.picture = await makers.picture({ desc: w.desc, ...(w.asset ? { asset: w.asset } : {}), parts });
        spec = { ...spec, tier: entry.picture.tier };
      } else if (sprite) {
        if (!spec.sprite?.parts?.length) spec = { ...spec, sprite: { parts: w.parts.map((name) => ({ name, phrase: name, changes: ["tint" as const] })) } };
        const req = spriteRequest(spec, w.desc, makers.style);
        const got = await getSprite(req, makers.sprite, { value: makers.sprites !== false, from: "designer", why: "the writer asked for a sprite" }, makers.spriteRoot ?? SPRITE_CACHE);
        entry.sprite = { desc: w.desc, style: makers.style.name, ...(makers.spriteRoot ? { root: makers.spriteRoot } : {}) };
        spec = { ...spec, tier: 2 };
        void got;
      } else if (spec.tier && spec.tier !== 1) spec = { ...spec, tier: 1 };
      entry.spec = spec;
      box.depictions[key] = entry;
      made.push(w.id);
    })());
    try {
      await inflight.get(flight);
    } catch (e) {
      problems.push(`${w.id} ("${w.desc}") could not be depicted: ${(e as Error).message}`);
    }
  }));
  return { made, problems };
}

/** What each depicted thing in a scene can do, for the writer's notes after a build. */
export function toolboxNotes(source: string, kitKinds: Iterable<string>, box: Toolbox, theme: Theme): string[] {
  return wantedIn(source, kitKinds).flatMap((w) => {
    const e = box.depictions[entryKey(w.id, w.desc)];
    if (!e) return [];
    try {
      const d = makeOne(e, w.id, theme, {});
      return [`${describeDepiction(d)}${e.problems.length ? ` The depicter could not settle: ${e.problems.join("; ")}.` : ""}`];
    } catch (err) {
      return [`${w.id}: ${(err as Error).message}`];
    }
  });
}

export { pointOf };
