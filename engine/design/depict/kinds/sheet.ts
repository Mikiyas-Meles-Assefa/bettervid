// Sheets and documents: a page with lines of writing (or the material's own words), a heading, a signature line that
// gets signed, a stamp that lands, a wax seal, a folded corner. Letters, contracts, forms, receipts, notes.
import type { NodeSpec, Props } from "../../../core/types.ts";
import type { KindDef } from "../make.ts";
import { clamp, ellipse, flat, isHex, lerp, mixHex, roundRect, spline } from "../geom.ts";
import { sizeCm } from "../spec.ts";
import type { Part, Pt, StateDef, StateMap, VerbDef } from "../types.ts";

export const sheet: KindDef = {
  name: "sheet",
  about: "paper things: letters, contracts, forms, receipts, certificates, notes, pages of a book, a card",
  params: {
    lines: "how many lines of writing",
    words: "the actual lines of text from the material (shown when a text size is given; otherwise lines are drawn as strokes)",
    heading: "true for a heading bar at the top",
    signature: "true for a signature line that can be signed",
    stamp: "the words on a stamp that can land on it (empty for none)",
    seal: "true for a round seal that can be pressed",
    fold: "true for a folded top right corner",
    ruled: "true for ruled lines across the page",
  },
  colors: { paper: "the paper (a fact: white, cream, yellow legal pad)", ink: "the writing", stamp: "the stamp's ink", seal: "the seal (wax red, gold foil)", mark: "a highlighter" },
  build(c) {
    const { id, L } = c;
    const real = sizeCm(c.spec) ?? { w: 21, h: 29.7 };
    const W = real.w >= real.h ? 1000 : (1000 * real.w) / real.h;
    const H = real.h >= real.w ? 1000 : (1000 * real.h) / real.w;
    const paper = c.col("paper") ?? "paper";
    const ink = c.col("ink") ?? "ink";
    const m = W * 0.11;
    const nLines = Math.max(0, Math.round(c.param<number>("lines") ?? 6));
    const words = c.param<string[]>("words") ?? [];
    const fold = !!c.param<boolean>("fold");
    const fs = W * 0.16;
    const nodes: NodeSpec[] = [];
    const add = (nid: string, kind: "group" | "path" | "text", props: Props, parent = `${id}.body`) => nodes.push({ id: nid, kind, parent, props });
    const outline: Pt[] = fold ? [[-W / 2, -H], [W / 2 - fs, -H], [W / 2, -H + fs], [W / 2, 0], [-W / 2, 0]] : roundRect(-W / 2, -H, W / 2, 0, L * 0.8);
    add(`${id}.page`, "path", { points: flat(outline), closed: 1, fill: paper, stroke: "ink", strokeWidth: L, lineJoin: "round", shadowY: L * 1.5, shadowBlur: L * 3, shadowOpacity: 0.18 * c.look.shade.value, shadowColor: "#000000" });
    if (fold) add(`${id}.fold`, "path", { points: flat([[W / 2 - fs, -H], [W / 2 - fs, -H + fs], [W / 2, -H + fs]]), closed: 1, fill: isHex(paper) ? mixHex(paper, "#000000", 0.12) : "ink", stroke: "ink", strokeWidth: L, lineJoin: "round", fillOpacity: 1 });
    const parts: Record<string, Part> = { page: { node: `${id}.page`, anchor: [0, -H / 2], box: [-W / 2, -H, W / 2, 0], about: "the page" } };
    let y = -H + m;
    if (c.param<boolean>("heading")) {
      add(`${id}.heading`, "path", { points: flat(roundRect(-W / 2 + m, y, W * 0.15, y + H * 0.05, H * 0.012)), closed: 1, fill: ink, stroke: "none" });
      parts.heading = { node: `${id}.heading`, anchor: [-W * 0.1, y + H * 0.025], about: "the heading" };
      y += H * 0.1;
    }
    const gap = Math.min(H * 0.07, (H * (c.param<boolean>("signature") ? 0.62 : 0.78) - (y + H)) / Math.max(1, nLines));
    const T = c.text;
    add(`${id}.marks`, "group", {});
    const lineIds: string[] = [];
    for (let i = 0; i < nLines; i++) {
      const ly = y + i * gap;
      const w = i === nLines - 1 ? 0.55 : 0.85 + 0.15 * Math.sin(i * 1.7);
      add(`${id}.hl.${i}`, "path", { points: flat(roundRect(-W / 2 + m - L, ly - gap * 0.38, -W / 2 + m + (W - 2 * m) * w + L, ly + gap * 0.38, L)), closed: 1, fill: c.col("mark") ?? "highlight", stroke: "none", opacity: 0 }, `${id}.marks`);
      if (words[i] && T) add(`${id}.line.${i}`, "text", { x: -W / 2 + m, y: ly, text: words[i]!, size: T, anchor: "start", color: ink, role: "body" }, `${id}.marks`);
      else add(`${id}.line.${i}`, "path", { points: flat([[-W / 2 + m, ly], [-W / 2 + m + (W - 2 * m) * w, ly]]), stroke: ink, strokeWidth: Math.max(L * 0.6, gap * 0.16), lineCap: "round", fill: "none", opacity: 0.55 }, `${id}.marks`);
      lineIds.push(`${id}.line.${i}`);
      if (c.param<boolean>("ruled")) add(`${id}.rule.${i}`, "path", { points: flat([[-W / 2, ly + gap * 0.42], [W / 2, ly + gap * 0.42]]), stroke: "ink", strokeWidth: L * 0.25, opacity: 0.25, fill: "none" }, `${id}.marks`);
    }
    if (nLines) parts.writing = { node: `${id}.marks`, anchor: [0, y + (nLines * gap) / 2], about: "the writing" };
    const sigY = -H * 0.14;
    if (c.param<boolean>("signature")) {
      add(`${id}.sigline`, "path", { points: flat([[-W / 2 + m, sigY], [W * 0.05, sigY]]), stroke: "ink", strokeWidth: L * 0.5, fill: "none", opacity: 0.6 });
      const sig = spline([[0.0, 0.5], [0.08, -0.6], [0.14, 0.7], [0.22, -0.2], [0.3, 0.6], [0.36, -0.9], [0.42, 0.4], [0.5, 0.1], [0.62, -0.3], [0.7, 0.3]].map(([x, yy]) => [-W / 2 + m + x * W * 0.62, sigY - H * 0.035 + yy! * H * 0.03] as Pt), false, 6);
      add(`${id}.sig`, "path", { points: flat(sig), stroke: ink, strokeWidth: L * 0.8, fill: "none", lineCap: "round", lineJoin: "round", trimEnd: 0 });
      parts.signature = { node: `${id}.sig`, anchor: [-W * 0.2, sigY - H * 0.03], about: "the signature" };
    }
    const stampText = c.param<string>("stamp");
    if (stampText) {
      const sw = W * 0.5;
      const sh = H * 0.1;
      add(`${id}.stamp`, "group", { x: W * 0.12, y: -H * 0.3, rotate: -12 });
      const sc = c.col("stamp") ?? "accent";
      add(`${id}.stampbox`, "path", { points: flat(roundRect(-sw / 2, -sh / 2, sw / 2, sh / 2, L)), closed: 1, fill: "none", stroke: sc, strokeWidth: L * 1.2 }, `${id}.stamp`);
      add(`${id}.stampword`, "text", { text: stampText.toUpperCase(), size: sh * 0.55, color: sc, weight: 800, tracking: sh * 0.05 }, `${id}.stamp`);
      parts.stamp = { node: `${id}.stamp`, anchor: [W * 0.12, -H * 0.3], about: "the stamp" };
    }
    if (c.param<boolean>("seal")) {
      const r = W * 0.1;
      const sc = c.col("seal") ?? "accent";
      add(`${id}.seal`, "group", { x: W / 2 - m - r * 0.6, y: -m - r * 0.4 });
      add(`${id}.sealdisc`, "path", { points: flat(Array.from({ length: 40 }, (_, i) => { const a = (i / 40) * Math.PI * 2; const rr = r * (1 + 0.06 * Math.sin(i * 2.7)); return [rr * Math.sin(a), -rr * Math.cos(a)] as Pt; })), closed: 1, fill: sc, stroke: "ink", strokeWidth: L * 0.6 }, `${id}.seal`);
      add(`${id}.sealring`, "path", { points: flat(ellipse(0, 0, r * 0.62, undefined, 32)), closed: 1, fill: "none", stroke: isHex(sc) ? mixHex(sc, "#ffffff", 0.35) : "paper", strokeWidth: L * 0.5 }, `${id}.seal`);
      parts.seal = { node: `${id}.seal`, anchor: [W / 2 - m - r * 0.6, -m - r * 0.4], about: "the seal" };
    }
    const states: Record<string, StateDef> = {
      written: { type: "number", about: "how much of the writing is there, 0 blank to 1", min: 0, max: 1, initial: 1 },
      signed: { type: "number", about: "how much of the signature is written, 0 to 1", min: 0, max: 1, initial: 0 },
      stamped: { type: "number", about: "0 no stamp, 1 stamped", min: 0, max: 1, initial: 0 },
      sealed: { type: "number", about: "0 no seal, 1 sealed", min: 0, max: 1, initial: 0 },
      highlight: { type: "number", about: "the line marked with a highlighter (0 for none, 1 the first line)", min: 0, initial: 0 },
    };
    const draw = (s: StateMap): Record<string, Props> => {
      const out: Record<string, Props> = {};
      const w = clamp(Number(s.written));
      lineIds.forEach((lid, i) => (out[lid] = { opacity: clamp(w * nLines - i) * (lid.includes(".line.") && words[i] && T ? 1 : 0.55) }));
      for (let i = 0; i < nLines; i++) out[`${id}.hl.${i}`] = { opacity: Number(s.highlight) === i + 1 ? 0.55 : 0 };
      if (parts.signature) out[`${id}.sig`] = { trimEnd: Number(s.signed), opacity: Number(s.signed) > 0 ? 1 : 0 };
      if (parts.stamp) out[`${id}.stamp`] = { opacity: Number(s.stamped), scaleX: lerp(1.6, 1, Number(s.stamped)), scaleY: lerp(1.6, 1, Number(s.stamped)) };
      if (parts.seal) out[`${id}.seal`] = { opacity: Number(s.sealed), scaleX: lerp(0.4, 1, Number(s.sealed)), scaleY: lerp(0.4, 1, Number(s.sealed)) };
      return out;
    };
    const verbs: Record<string, VerbDef> = {
      writes: { about: "its writing appears line by line", sets: [{ state: "written", value: 1 }], ease: "linear" },
      "fills in": { about: "its writing appears line by line", sets: [{ state: "written", value: 1 }], ease: "linear" },
      clears: { about: "its writing goes", sets: [{ state: "written", value: 0 }] },
      signs: { about: "the signature is written", sets: [{ state: "signed", value: 1 }], needs: ["signature"], ease: "linear" },
      stamps: { about: "the stamp lands", sets: [{ state: "stamped", value: 1 }], needs: ["stamp"], ease: "in" },
      seals: { about: "the seal is pressed", sets: [{ state: "sealed", value: 1 }], needs: ["seal"], ease: "out" },
      highlights: { about: "a line is marked (the first when none is given)", sets: [{ state: "highlight", arg: true, value: 1 }], arg: "number", needs: ["writing"] },
    };
    return { box: { w: W, h: H }, pivot: [0, -H / 2], nodes, parts, states, verbs, draw, notes: words.length && !T ? [`${c.spec.label}: its words show as strokes until a text size is given`] : [] };
  },
};
