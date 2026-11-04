// What the engine can show, for the stages that plan before any scene is written (the writer choosing its examples, the
// direction planning demonstrations). Read from the kits the scene step uses, so a new kit reaches them by itself.
import { STEPS_DOC } from "../../engine/kits/steps.ts";
import { truthKinds } from "../../engine/language/author.ts";
import { loadLibrary } from "../../engine/language/library.ts";
import { SCENE_KITS } from "../stages/scene.ts";

const GENERAL =
  "Anything can be drawn live, in the video's own style, with real readable words: text, shapes, boxes, rows, tables, " +
  "arrows, rings, labels, formulas set as real math, maps and diagrams. Pictures (real archival ones found for it, or " +
  "generated) can fill the frame, be cropped and panned, have their subject cut out, and be marked, ringed and labeled. " +
  "Every part stays the same object as it moves, so a thing can travel from one place to another, split, join, light up, " +
  "dim, pulse or fade, and the camera can hold still, drift, push in or cut. Anything can start on a spoken word or a " +
  "number of frames after it, so things can happen in silence. A program can simulate or compute what no kit covers " +
  "(motion, growth, chance, physics, a chart from real numbers) and draw it.";

export function abilities(): string {
  const truth = new Set(truthKinds(SCENE_KITS));
  const kinds = SCENE_KITS.flatMap((k) => Object.keys(k.kinds ?? {}).map((name) => ({ name, doc: k.docs?.[name] })));
  const lines = kinds.filter((k) => k.doc).map((k) => `- \`${k.name}\`${truth.has(k.name) ? " (computes it for real, step by step)" : ""}: ${k.doc}`);
  const programs = loadLibrary().map((p) => `- \`${p.name}\`: ${p.doc}`);
  return [
    GENERAL,
    `Things the engine computes or draws for you, by kind:\n${lines.join("\n")}`,
    `Playing computed steps: ${STEPS_DOC}`,
    programs.length ? `Ready-made programs:\n${programs.join("\n")}` : "",
  ].filter(Boolean).join("\n\n");
}

/** The computing kits alone, one line each, for a step that must name the script's examples by kit. */
export function truthDocs(): string {
  const truth = new Set(truthKinds(SCENE_KITS));
  return SCENE_KITS.flatMap((k) => Object.keys(k.kinds ?? {}).filter((n) => truth.has(n)).map((n) => `- \`${n}\`: ${k.docs?.[n] ?? ""}`)).join("\n");
}

// The kinds whose steps are computed, for checking a plan that names one.
export const truthKindNames = () => truthKinds(SCENE_KITS);
