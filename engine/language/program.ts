// What a program returns is untrusted data. This checks every part, property and keyframe before any of it joins a scene.
// Programs cannot name images, fonts or free-form colors, so nothing they return can reach outside the video: a picture
// or paint value could otherwise make the renderer fetch a URL.
import type { Ease, Key, Props, Track, Value } from "../core/types.ts";
import { EASES } from "../core/ease.ts";
import type { RawOutput } from "./sandbox.ts";

const ID = /^[A-Za-z0-9][\w-]*(\.[\w-]+)*$/;
const PROP = /^[a-z][A-Za-z0-9]*$/;
const COLOR = new Set(["fill", "stroke", "color", "pulseColor"]);
const WORDS: Record<string, RegExp> = { text: /^[\s\S]{0,400}$/, anchor: /^(start|middle|end)$/ };
const REFUSED = new Set(["src", "href", "font", "style", "constructor", "prototype", "toString", "valueOf"]);
const MAX_POINTS = 40_000;

export type Checked = { parts: { id: string; kind: "group" | "path" | "text"; parent: string; props: Props }[]; tracks: Track[]; events: { name: string; at: number; data?: Record<string, unknown> }[] };
type Scope = { mount: string; on: string[]; offset: { x: number; y: number }; frames: number; colors: Set<string> };

function checkValue(prop: string, v: unknown, colors: Set<string>): { value: Value } | { error: string } {
  if (!PROP.test(prop) || REFUSED.has(prop)) return { error: `the property "${prop}" is not allowed` };
  if (COLOR.has(prop)) {
    if (typeof v === "string" && (colors.has(v) || v === "none")) return { value: v };
    return { error: `${prop} must be one of the color names ${[...colors].join(", ")}, or none, not ${JSON.stringify(v)}` };
  }
  if (prop === "points") {
    if (!Array.isArray(v) || v.length % 2 || v.length < 2 || v.length > MAX_POINTS) return { error: `points must be a flat list of x, y pairs with at most ${MAX_POINTS} numbers` };
    for (const x of v) if (typeof x !== "number" || !Number.isFinite(x)) return { error: `points holds ${String(x)}, which is not a finite number` };
    return { value: (v as number[]).map((x) => Math.round(x * 100) / 100) };
  }
  if (typeof v === "number") return Number.isFinite(v) ? { value: v } : { error: `${prop} is ${v}` };
  const rule = WORDS[prop];
  if (rule) return typeof v === "string" && rule.test(v) ? { value: v } : { error: `${prop} has a bad value ${JSON.stringify(v)?.slice(0, 60)}` };
  return { error: `${prop} must be a finite number, not ${JSON.stringify(v)?.slice(0, 60)}` };
}

// Turns a program's raw output into scene parts under `mount`. Returns a list of errors, or the checked data.
export function checkOutput(raw: RawOutput, scope: Scope): { errors: string[]; checked?: Checked } {
  const errors: string[] = [];
  const fail = (m: string) => errors.length < 12 && errors.push(m);
  if (!Array.isArray(raw?.nodes) || !Array.isArray(raw?.tracks) || !Array.isArray(raw?.events)) return { errors: ["it did not return parts, tracks and events"] };
  const name = (id: string) => `${scope.mount}.${id}`;
  const made = new Set<string>();
  const parts: Checked["parts"] = [];
  for (const n of raw.nodes) {
    if (typeof n?.id !== "string" || !ID.test(n.id)) {
      fail(`a part has the bad id ${JSON.stringify(n?.id)?.slice(0, 60)}`);
      continue;
    }
    if (made.has(n.id)) fail(`the id ${n.id} is used twice`);
    if (n.kind !== "group" && n.kind !== "path" && n.kind !== "text") {
      fail(`${n.id} has the kind ${String(n.kind)}, and programs may only make group, path and text`);
      continue;
    }
    if (n.parent !== undefined && !made.has(n.parent)) fail(`${n.id} has the parent ${String(n.parent)}, which was not made before it`);
    const props: Props = {};
    for (const [k, v] of Object.entries(n.props ?? {})) {
      const c = checkValue(k, v, scope.colors);
      if ("error" in c) fail(`on ${n.id}: ${c.error}`);
      else props[k] = c.value;
    }
    if (n.kind === "path" && !props.points) fail(`the path ${n.id} has no points`);
    if (n.kind === "text" && props.text === undefined) fail(`the text ${n.id} has no text`);
    made.add(n.id);
    parts.push({ id: name(n.id), kind: n.kind, parent: n.parent ? name(n.parent) : scope.mount, props });
  }
  const tracks: Track[] = [];
  for (const t of raw.tracks) {
    const onBoard = scope.on.includes(t?.target);
    if (!made.has(t?.target) && !onBoard) {
      fail(`key() names ${String(t?.target)}, which this program did not make and was not given with on=`);
      continue;
    }
    const keys: Key[] = [];
    for (const k of t.keys ?? []) {
      const c = checkValue(t.prop, k.value, scope.colors);
      if ("error" in c) {
        fail(`on ${t.target}: ${c.error}`);
        break;
      }
      if (typeof k.at !== "number" || !Number.isInteger(k.at) || k.at < 0 || k.at > scope.frames) {
        fail(`on ${t.target}: the frame ${String(k.at)} is outside the video, which has ${scope.frames} frames`);
        break;
      }
      if (k.ease !== undefined && !(k.ease in EASES)) {
        fail(`on ${t.target}: the ease ${String(k.ease)} is not one of ${Object.keys(EASES).join(", ")}`);
        break;
      }
      const shift = onBoard && typeof c.value === "number" ? (t.prop === "x" ? scope.offset.x : t.prop === "y" ? scope.offset.y : 0) : 0;
      keys.push({ at: k.at, value: typeof c.value === "number" ? c.value + shift : c.value, ...(k.ease ? { ease: k.ease as Ease } : {}) });
    }
    keys.sort((a, b) => a.at - b.at);
    const unique = keys.filter((k, i) => k.at !== keys[i + 1]?.at);
    if (unique.length) tracks.push({ target: onBoard ? t.target : name(t.target), prop: t.prop, keys: unique });
  }
  const events: Checked["events"] = [];
  for (const e of raw.events) {
    if (!/^[\w.-]{1,60}$/.test(String(e?.name)) || !Number.isInteger(e?.at) || e.at < 0 || e.at > scope.frames) fail(`the event ${String(e?.name)} at frame ${String(e?.at)} is not valid`);
    else events.push({ name: e.name, at: e.at, ...(e.data && typeof e.data === "object" ? { data: JSON.parse(JSON.stringify(e.data)) as Record<string, unknown> } : {}) });
  }
  return errors.length ? { errors } : { errors, checked: { parts, tracks, events } };
}
