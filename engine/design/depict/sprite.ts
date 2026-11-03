// Tier 2: a picture generated in the video's style, cut into parts with SAM, with state as overlays (a tint on a part's
// mask, a part that moves, turns or hides). Generating costs money, so it is allowed only when the designer decides the
// thing carries the moment, and every sprite is cached by description and style and reused. This file builds the
// request and reads the cache; the maker that calls the image and segmentation models is plugged in by the caller.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { NodeSpec, Props, Theme } from "../../core/types.ts";
import type { Decided } from "../types.ts";
import { makeDepiction, type KindDef } from "./make.ts";
import { flat, roundRect } from "./geom.ts";
import type { PropSpec } from "./spec.ts";
import type { DepictLook, Depiction, Part, StateDef, VerbDef } from "./types.ts";

export type SpriteChange = "tint" | "move" | "turn" | "hide";
export type SpriteRequest = {
  key: string;
  desc: string;
  style: string;
  /** The image prompt (for Muse Image in production), written from the style's own art description. */
  prompt: string;
  /** Parts to cut, each with the phrase SAM is given. */
  parts: { name: string; phrase: string; changes: SpriteChange[] }[];
};
/** What the cache holds for a sprite: the picture, a mask per part (white where the part is), boxes as fractions. */
export type SpriteMeta = {
  key: string;
  desc: string;
  style: string;
  src: string;
  size: [number, number];
  parts: Record<string, { mask: string; box: [number, number, number, number]; anchor?: [number, number]; changes: SpriteChange[] }>;
  made: { by: string; prompt: string };
};
export type LoadedSprite = SpriteMeta & { dir: string };

/** Makes a sprite and its masks. Production plugs in the image and segmentation models; tests plug in fixtures. */
export interface SpriteMaker {
  make(req: SpriteRequest): Promise<{ png: Buffer; size: [number, number]; masks: Record<string, { png: Buffer; box: [number, number, number, number]; anchor?: [number, number] }> }>;
}

export const SPRITE_CACHE = "projects/cache/sprites";
export const spriteKey = (desc: string, style: string) => createHash("sha1").update(`${style}\n${desc.trim().toLowerCase()}`).digest("hex").slice(0, 16);

/** The request for a thing in a style. `art` is the style's description of how its pictures look. */
export function spriteRequest(spec: PropSpec, desc: string, style: { name: string; art: string }): SpriteRequest {
  const parts = spec.sprite?.parts ?? [];
  const prompt = [
    `${spec.label}: ${desc}.`,
    `One object alone, whole and centered, seen ${spec.params?.view ?? "from the front"}, on a plain flat background with nothing else in the picture.`,
    `Drawn as: ${style.art}.`,
    parts.length ? `Its ${parts.map((p) => p.phrase).join(", ")} must be clearly separate and fully visible.` : "",
    "No text, no labels, no shadow on the background.",
  ].filter(Boolean).join(" ");
  return { key: spriteKey(desc, style.name), desc, style: style.name, prompt, parts };
}

export function loadSprite(desc: string, style: string, root = SPRITE_CACHE): LoadedSprite | undefined {
  const dir = resolve(root, spriteKey(desc, style));
  const meta = join(dir, "meta.json");
  if (!existsSync(meta)) return undefined;
  return { ...(JSON.parse(readFileSync(meta, "utf8")) as SpriteMeta), dir };
}

export function saveSprite(req: SpriteRequest, made: Awaited<ReturnType<SpriteMaker["make"]>>, by: string, root = SPRITE_CACHE): LoadedSprite {
  const dir = resolve(root, req.key);
  mkdirSync(join(dir, "masks"), { recursive: true });
  writeFileSync(join(dir, "sprite.png"), made.png);
  const parts: SpriteMeta["parts"] = {};
  for (const p of req.parts) {
    const m = made.masks[p.name];
    if (!m) throw new Error(`sprite ${req.key}: no mask for ${p.name} ("${p.phrase}")`);
    writeFileSync(join(dir, "masks", `${p.name}.png`), m.png);
    parts[p.name] = { mask: `masks/${p.name}.png`, box: m.box, anchor: m.anchor, changes: p.changes };
  }
  const meta: SpriteMeta = { key: req.key, desc: req.desc, style: req.style, src: "sprite.png", size: made.size, parts, made: { by, prompt: req.prompt } };
  writeFileSync(join(dir, "meta.json"), JSON.stringify(meta, null, 2));
  return { ...meta, dir };
}

/**
 * The cached sprite, or a new one when the designer allowed it. Never makes one silently: without permission a missing
 * sprite is an error the caller reports (and the depicter is asked for a drawn kind instead).
 */
export async function getSprite(req: SpriteRequest, maker: SpriteMaker | undefined, allowed: Decided<boolean>, root = SPRITE_CACHE): Promise<LoadedSprite> {
  const hit = loadSprite(req.desc, req.style, root);
  if (hit) return hit;
  if (!allowed.value) throw new Error(`no cached sprite for "${req.desc}" in ${req.style}, and making one was not allowed (${allowed.why ?? allowed.from})`);
  if (!maker) throw new Error(`no sprite maker to make "${req.desc}"`);
  return saveSprite(req, await maker.make(req), "maker", root);
}

/** A cached sprite as a Depiction: the picture, each part as a mask with its overlays and moves. */
export function spriteDepiction(id: string, sprite: LoadedSprite, spec: PropSpec, theme: Theme, look: DepictLook): Depiction {
  const [iw, ih] = sprite.size;
  const W = iw >= ih ? 1000 : (1000 * iw) / ih;
  const H = ih >= iw ? 1000 : (1000 * ih) / iw;
  const file = (p: string) => join(sprite.dir, p);
  const P = ([fx, fy]: [number, number]): [number, number] => [(fx - 0.5) * W, (fy - 1) * H];
  const img = (src: string, cx: number, cy: number): Props => ({ src, x: cx, y: cy, w: W, h: H, fit: "fill" });
  const def: KindDef = {
    name: "sprite",
    about: "a generated picture cut into parts",
    params: {},
    colors: {},
    build: () => {
      const nodes: NodeSpec[] = [];
      const add = (nid: string, kind: NodeSpec["kind"], props: Props, parent = `${id}.body`) => nodes.push({ id: nid, kind, parent, props });
      const moving = Object.entries(sprite.parts).filter(([, p]) => p.changes.some((c) => c !== "tint"));
      if (moving.length) {
        // The base picture with holes where moving parts were, so a part that moves leaves no copy behind.
        add(`${id}.holes`, "group", {});
        for (const [name, p] of moving) add(`${id}.hole.${name}`, "image", img(file(p.mask), 0, -H / 2), `${id}.holes`);
        add(`${id}.img`, "image", { ...img(file(sprite.src), 0, -H / 2), mask: `${id}.holes`, maskMode: "luminance", maskInvert: 1 });
      } else add(`${id}.img`, "image", img(file(sprite.src), 0, -H / 2));
      const parts: Record<string, Part> = { whole: { node: `${id}.img`, anchor: [0, -H / 2], box: [-W / 2, -H, W / 2, 0], about: spec.label } };
      const states: Record<string, StateDef> = {};
      const verbs: Record<string, VerbDef> = {};
      for (const [name, p] of Object.entries(sprite.parts)) {
        const anchor = P(p.anchor ?? [(p.box[0] + p.box[2]) / 2, (p.box[1] + p.box[3]) / 2]);
        const moves = p.changes.some((c) => c !== "tint");
        const g = moves ? `${id}.part.${name}` : `${id}.body`;
        if (moves) {
          add(g, "group", { x: anchor[0], y: anchor[1] });
          add(`${g}.m`, "image", img(file(p.mask), -anchor[0], -H / 2 - anchor[1]), g);
          add(`${g}.img`, "image", { ...img(file(sprite.src), -anchor[0], -H / 2 - anchor[1]), mask: `${g}.m`, maskMode: "luminance" }, g);
        } else add(`${id}.m.${name}`, "image", img(file(p.mask), 0, -H / 2));
        const maskId = moves ? `${g}.m` : `${id}.m.${name}`;
        const [x0, y0] = P([p.box[0], p.box[1]]);
        const [x1, y1] = P([p.box[2], p.box[3]]);
        if (p.changes.includes("tint")) {
          const off = moves ? [-anchor[0], -anchor[1]] : [0, 0];
          add(`${id}.tint.${name}`, "path", { points: flat(roundRect(x0 + off[0]!, y0 + off[1]!, x1 + off[0]!, y1 + off[1]!, 0)), closed: 1, stroke: "none", mask: maskId, maskMode: "luminance", blend: "color" }, g);
          states[`tint.${name}`] = { type: "color", about: `the color laid over the ${name}`, initial: "#ffffff" };
          states[`tintAmount.${name}`] = { type: "number", about: `how strongly the ${name} takes the tint, 0 to 1`, min: 0, max: 1, initial: 0 };
        }
        if (p.changes.includes("move")) (states[`x.${name}`] = { type: "number", about: `the ${name}'s sideways offset`, initial: 0 }, (states[`y.${name}`] = { type: "number", about: `the ${name}'s offset down`, initial: 0 }));
        if (p.changes.includes("turn")) states[`angle.${name}`] = { type: "angle", about: `the ${name}'s turn about its anchor`, initial: 0 };
        if (p.changes.includes("hide")) states[`shown.${name}`] = { type: "number", about: `how visible the ${name} is`, min: 0, max: 1, initial: 1 };
        parts[name] = { node: moves ? g : maskId, anchor, box: [x0, y0, x1, y1], about: name };
      }
      if (Object.keys(states).some((s) => s.startsWith("tint."))) {
        verbs.turns = { about: "a part takes a color (the first tinted part, unless the spec maps the verb)", sets: [{ state: `tint.${Object.keys(sprite.parts).find((n) => sprite.parts[n]!.changes.includes("tint"))}`, arg: true }, { state: `tintAmount.${Object.keys(sprite.parts).find((n) => sprite.parts[n]!.changes.includes("tint"))}`, value: 1 }], arg: "color" };
      }
      const draw = (s: Record<string, unknown>) => {
        const out: Record<string, Props> = {};
        for (const [name, p] of Object.entries(sprite.parts)) {
          if (p.changes.includes("tint")) out[`${id}.tint.${name}`] = { fill: String(s[`tint.${name}`]), opacity: Number(s[`tintAmount.${name}`]) };
          if (p.changes.some((c) => c !== "tint")) {
            const anchor = parts[name]!.anchor;
            out[`${id}.part.${name}`] = { x: anchor[0] + Number(s[`x.${name}`] ?? 0), y: anchor[1] + Number(s[`y.${name}`] ?? 0), rotate: Number(s[`angle.${name}`] ?? 0), opacity: Number(s[`shown.${name}`] ?? 1) };
          }
        }
        return out;
      };
      return { box: { w: W, h: H }, pivot: [0, -H / 2], nodes, parts, states, verbs, draw: draw as (s: Record<string, unknown>) => Record<string, Props> };
    },
  };
  const d = makeDepiction(def, spec, theme, look, { id });
  d.tier = 2;
  d.notes.push(`${spec.label}: a ${sprite.style} sprite (${sprite.key}), parts ${Object.keys(sprite.parts).join(", ")}`);
  return d;
}
