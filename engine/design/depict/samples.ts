// Sample specs for the proof sheet and the tests: one or more per kind, as a depicter would write them. They prove the
// kinds; nothing in the engine reads them.
import type { Theme } from "../../core/types.ts";
import type { PropSpec } from "./spec.ts";
import type { DepictLook, Depiction, StateValue } from "./types.ts";

export type Sample = { name: string; spec: PropSpec; acts: [string, StateValue?][]; frames?: number; make?: (theme: Theme, look: DepictLook, id: string) => Depiction };

const known = (names: string[]) => Object.fromEntries(names.map((n) => [n, "known: sample"]));

export const SAMPLES: Sample[] = [
  {
    name: "tumbler of water",
    spec: { kind: "container", label: "glass of water", size: { w: 7.5, h: 11, unit: "cm" }, params: { profile: [[0.4, 0], [0.5, 1]], contents: [{ name: "water", level: 0.55, color: "water" }] }, colors: { water: "#bfe3f2cc", juice: "#f4a03acc" }, colorSources: known(["water", "juice"]), why: "sample" },
    acts: [["fills", 0.9], ["turns", "juice"]],
  },
  {
    name: "flask",
    spec: { kind: "container", label: "conical flask", size: { w: 10, h: 14, unit: "cm" }, params: { profile: [[0.5, 0], [0.5, 0.05], [0.14, 0.66], [0.14, 1]], lip: 0.03, contents: [{ name: "solution", level: 0.32, color: "clear" }] }, colors: { clear: "#d9eef5bb", rose: "#f7b6cfdd" }, colorSources: known(["clear", "rose"]), why: "sample" },
    acts: [["turns", "rose"], ["swirls"]],
  },
  {
    name: "burette",
    spec: { kind: "container", label: "burette", size: { w: 1.6, h: 60, unit: "cm" }, params: { profile: [[0.5, 0], [0.5, 1]], outlet: { length: 0.14, width: 0.32, tap: true }, scale: { top: 0, bottom: 50, from: 0.04, to: 0.96, major: 10, minor: 1, unit: "mL" }, contents: [{ name: "titrant", level: 0.97, color: "clear" }] }, colors: { clear: "#d9eef5dd" }, colorSources: known(["clear"]), why: "sample" },
    acts: [["opens"], ["drains", 0.6]],
  },
  {
    name: "jar with sediment",
    spec: { kind: "container", label: "jar of muddy water", size: { w: 9, h: 12, unit: "cm" }, params: { profile: [[0.46, 0], [0.5, 0.08], [0.5, 0.86], [0.42, 0.92], [0.42, 1]], lip: 0.04, contents: [{ name: "water", level: 0.78, color: "water" }], solid: { color: "silt", count: 36 }, bubbles: 0 }, colors: { water: "#c9b48fbb", silt: "#7a5a35" }, colorSources: known(["water", "silt"]), why: "sample" },
    acts: [["settles"]],
  },
  {
    name: "layers and bubbles",
    spec: { kind: "container", label: "beaker with oil on water", size: { w: 8, h: 10, unit: "cm" }, params: { profile: [[0.5, 0], [0.5, 1]], spout: "right", contents: [{ name: "water", level: 0.4, color: "water" }, { name: "oil", level: 0.62, color: "oil" }], bubbles: 8 }, colors: { water: "#9fd0ecbb", oil: "#f2cf5acc" }, colorSources: known(["water", "oil"]), why: "sample" },
    acts: [["bubbles"], ["pours"]],
  },
  {
    name: "felt ball",
    spec: { kind: "body", form: "sphere", label: "tennis ball", size: { w: 6.7, h: 6.7, unit: "cm" }, params: { marks: [{ kind: "seam", color: "seam", width: 0.035 }] }, colors: { body: "#d7e84a", seam: "#f7f7f2" }, colorSources: known(["body", "seam"]), why: "sample" },
    acts: [["rolls", 400]],
  },
  {
    name: "planet",
    spec: { kind: "body", form: "sphere", label: "banded planet", size: { w: 1, h: 1, unit: "m" }, params: { marks: [{ kind: "band", color: "band", width: 0.16 }, { kind: "spots", color: "spot", n: 1, size: 0.16 }] }, colors: { body: "#e3b77c", band: "#b8703f", spot: "#c2563a", ice: "#cfe6f5" }, colorSources: known(["body", "band", "spot", "ice"]), why: "sample" },
    acts: [["turns", "ice"], ["cracks"]],
  },
  {
    name: "crate",
    spec: { kind: "body", form: "block", label: "wooden crate", size: { w: 50, h: 40, unit: "cm" }, params: { depth: 0.28, corner: 0.02, marks: [{ kind: "lines", color: "plank", width: 0.02, lines: [[[0, 0.45], [1, 0.45]], [[0, 0.72], [1, 0.72]]] }] }, colors: { body: "#c99a5b", plank: "#8a6232" }, colorSources: known(["body", "plank"]), why: "sample" },
    acts: [["falls", 300]],
  },
  {
    name: "ice cube",
    spec: { kind: "body", form: "block", label: "ice cube", size: { w: 3, h: 3, unit: "cm" }, params: { depth: 0.3, corner: 0.1 }, colors: { body: "#d8eef8" }, colorSources: known(["body"]), why: "sample" },
    acts: [["melts"]],
  },
  {
    name: "thermometer",
    spec: { kind: "gauge", form: "thermometer", label: "thermometer", size: { w: 2, h: 22, unit: "cm" }, params: { scale: { from: -10, to: 50, major: 10, minor: 2, unit: "°C" } }, colors: { column: "#d8342c" }, colorSources: known(["column"]), state: { value: 12 }, why: "sample" },
    acts: [["rises", 38]],
  },
  {
    name: "dial",
    spec: { kind: "gauge", form: "dial", label: "pressure gauge", size: { w: 8, h: 8, unit: "cm" }, params: { scale: { from: 0, to: 10, major: 2, minor: 0.5, unit: "bar" }, sweep: 270 }, colors: { column: "#d8342c", face: "#fbfaf5" }, colorSources: known(["column", "face"]), state: { value: 2 }, why: "sample" },
    acts: [["goes to", 7.5]],
  },
  {
    name: "ruler",
    spec: { kind: "gauge", form: "ruler", label: "slider", size: { w: 30, h: 4, unit: "cm" }, params: { scale: { from: 0, to: 100, major: 25, minor: 5, unit: "%" } }, colors: { column: "#2f7bd9" }, colorSources: known(["column"]), state: { value: 20 }, why: "sample" },
    acts: [["goes to", 80]],
  },
  {
    name: "wall clock",
    spec: { kind: "clock", form: "analog", label: "wall clock", size: { w: 30, h: 30, unit: "cm" }, params: { seconds: true, numerals: true }, colors: { face: "#fbfaf5", hand: "#d8342c" }, colorSources: known(["face", "hand"]), state: { time: 36000 }, why: "sample" },
    acts: [["runs", 5400]],
  },
  {
    name: "stopwatch",
    spec: { kind: "clock", form: "stopwatch", label: "stopwatch", params: { duration: 60 }, colors: { face: "#fbfaf5", hand: "#e8833a" }, colorSources: known(["face", "hand"]), why: "sample" },
    acts: [["runs", 40]],
  },
  {
    name: "hourglass",
    spec: { kind: "clock", form: "hourglass", label: "hourglass", params: { duration: 60 }, colors: { sand: "#e2b866", case: "#7a4d2a" }, colorSources: known(["sand", "case"]), state: { time: 5 }, why: "sample" },
    acts: [["runs", 35]],
  },
  {
    name: "countdown",
    spec: { kind: "clock", form: "timer", label: "countdown ring", params: { duration: 60 }, colors: { hand: "#2f7bd9" }, colorSources: known(["hand"]), why: "sample" },
    acts: [["runs", 45]],
  },
  {
    name: "drops",
    spec: { kind: "flow", form: "drops", label: "falling drops", size: { w: 4, h: 20, unit: "cm" }, params: { path: [[0, -1000], [0, 0]], rate: 3, width: 0.8 }, colors: { stuff: "#7cc3e8" }, colorSources: known(["stuff"]), why: "sample" },
    acts: [["drips"]],
    frames: 90,
  },
  {
    name: "smoke",
    spec: { kind: "flow", form: "gas", label: "smoke", size: { w: 10, h: 30, unit: "cm" }, params: { path: [[0, 0], [60, -400], [-40, -700], [30, -1000]], rate: 4, speed: 30, width: 3 }, colors: { stuff: "#9aa0a6" }, colorSources: known(["stuff"]), why: "sample" },
    acts: [["rises"]],
    frames: 90,
  },
  {
    name: "gears",
    spec: { kind: "mechanism", form: "gear", label: "gear pair", params: { teeth: 18, mate: 10 }, colors: { metal: "#a7b0ba", accent: "#e8833a" }, colorSources: known(["metal", "accent"]), why: "sample" },
    acts: [["turns", 40]],
  },
  {
    name: "seesaw",
    spec: { kind: "mechanism", form: "lever", label: "lever", params: { fulcrum: 0.4, loads: [{ at: 0.08, size: 0.14 }, { at: 0.88, size: 0.08 }] }, colors: { metal: "#c99a5b", accent: "#53637a" }, colorSources: known(["metal", "accent"]), why: "sample" },
    acts: [["tips"]],
  },
  {
    name: "spring",
    spec: { kind: "mechanism", form: "spring", label: "spring", params: { coils: 9 }, colors: { metal: "#53637a", accent: "#a7b0ba" }, colorSources: known(["metal", "accent"]), why: "sample" },
    acts: [["compresses", 0.5]],
  },
  {
    name: "pulley",
    spec: { kind: "mechanism", form: "pulley", label: "pulley", params: { travel: 0.4 }, colors: { metal: "#a7b0ba", accent: "#8a6232" }, colorSources: known(["metal", "accent"]), why: "sample" },
    acts: [["lifts"]],
  },
  {
    name: "piston",
    spec: { kind: "mechanism", form: "piston", label: "piston", colors: { metal: "#a7b0ba", accent: "#53637a", gas: "#f2cf5a" }, colorSources: known(["metal", "accent", "gas"]), why: "sample" },
    acts: [["pushes", 0.7]],
  },
  {
    name: "contract",
    spec: { kind: "sheet", label: "contract", size: { w: 21, h: 29.7, unit: "cm" }, params: { lines: 7, heading: true, signature: true, stamp: "approved", seal: true, fold: true }, colors: { paper: "#fbfaf5", stamp: "#c0392b", seal: "#b02a2a", ink: "#22252b" }, colorSources: known(["paper", "stamp", "seal", "ink"]), why: "sample" },
    acts: [["signs"], ["stamps"], ["seals"]],
  },
  {
    name: "phone",
    spec: { kind: "device", form: "phone", label: "phone", params: { rows: 5 }, colors: { body: "#23262d", screen: "#fbfbfd", ui: "#2f7bd9", off: "#0c0d10" }, colorSources: known(["body", "screen", "ui", "off"]), state: { on: 0 }, why: "sample" },
    acts: [["wakes"], ["notifies", "New message"]],
  },
  {
    name: "laptop",
    spec: { kind: "device", form: "laptop", label: "laptop", params: { rows: 4 }, colors: { body: "#b9bec6", screen: "#16181d", ui: "#3fb27f" }, colorSources: known(["body", "screen", "ui"]), why: "sample" },
    acts: [["scrolls", 0.5]],
  },
  {
    name: "potted plant",
    spec: { kind: "plant", label: "flower in a pot", params: { leaves: 4, flower: true, petals: 7, pot: true }, colors: { stem: "#4f8a3a", leaf: "#5fa04a", flower: "#f2a23a", center: "#7a4d2a", pot: "#c06a3e", wilted: "#9a8a4a" }, colorSources: known(["stem", "leaf", "flower", "center", "pot", "wilted"]), state: { grow: 0.35, bloom: 0 }, why: "sample" },
    acts: [["grows"], ["blooms"]],
  },
  {
    name: "cell",
    spec: { kind: "cell", label: "cell", params: { bodies: 8, nucleus: true }, colors: { membrane: "#8fc7a8", nucleus: "#5a6fae" }, colorSources: known(["membrane", "nucleus"]), why: "sample" },
    acts: [["divides"]],
  },
  {
    name: "kettle (outline)",
    spec: {
      kind: "outline", label: "kettle", size: { w: 26, h: 22, unit: "cm" }, colors: { body: "#e4573d", lid: "#c9442d", handle: "#2b2b2b" }, colorSources: known(["body", "lid", "handle"]),
      params: {
        smooth: true,
        outline: [[0.2, 0.98], [0.15, 0.6], [0.24, 0.32], [0.5, 0.24], [0.74, 0.32], [0.84, 0.48], [0.98, 0.3], [0.95, 0.36], [0.86, 0.62], [0.82, 0.98]],
        regions: [{ name: "lid", points: [[0.32, 0.27], [0.5, 0.13], [0.68, 0.27]], color: "lid", hinge: [0.32, 0.27], opens: -60 }, { name: "handle", points: [[0.3, 0.2], [0.33, 0.02], [0.67, 0.02], [0.7, 0.2], [0.64, 0.2], [0.62, 0.08], [0.38, 0.08], [0.36, 0.2]], color: "handle" }],
        details: [{ points: [[0.17, 0.86], [0.84, 0.86]], width: 0.008 }],
      },
      why: "sample",
    },
    acts: [["opens"]],
  },
];
