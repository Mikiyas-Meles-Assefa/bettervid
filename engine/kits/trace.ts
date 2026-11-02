// Code that really runs: the program is executed by engine/truth/tracer.ts, and each step lights the line about to run
// while the variables, the call stack and the output show what is really true at that moment.
import type { Kit, NodeSpec } from "../core/types.ts";
import { trace, type TraceEvent } from "../truth/tracer.ts";
import { frame, playSteps, Story, STEPS_DOC, text, textWidth, truthKind, type Board } from "./steps.ts";

const SIZE = 46;
const LH = SIZE * 1.5;
const PANEL = SIZE * 0.62; // panel titles
const GAP = SIZE * 1.1;

export const tracePart = {
  line: (t: string, k: number) => `${t}.line.${k}`,
  cursor: (t: string) => `${t}.cursor`,
  variable: (t: string, name: string) => `${t}.var.${name}`,
  frame: (t: string, k: number) => `${t}.frame.${k}`,
  out: (t: string, k: number) => `${t}.out.${k}`,
  ret: (t: string) => `${t}.ret`,
};

// The code arrives as a JSON list of lines, or one string with \n between lines.
function linesOf(d: Record<string, unknown>): string[] {
  const raw = d.code ?? d.lines;
  if (raw === undefined) throw new Error(`trace needs code, as in trace t code=["let total = 0","for (const n of [3,5,2]) {","  total += n","}"]`);
  const lines = Array.isArray(raw) ? raw.map(String) : String(raw).replace(/\\n/g, "\n").split("\n");
  while (lines.length && !lines.at(-1)!.trim()) lines.pop();
  if (!lines.length) throw new Error(`trace code is empty`);
  if (lines.length === 1 && /;\s*\S/.test(lines[0]!)) throw new Error(`write one statement per line, as a list code=["...","..."], so each line can light up on its own`);
  if (lines.length > 30) throw new Error(`trace shows at most 30 lines of code, not ${lines.length}`);
  return lines.map((l) => l.replace(/\t/g, "  "));
}

function traceBoard(id: string, d: Record<string, unknown>, ctx: Parameters<NonNullable<Kit["kinds"]>[string]>[1]): Board {
  const lines = linesOf(d);
  const log: TraceEvent[] = trace(lines.join("\n"));
  const font = ctx.theme.fonts.mono ?? "Menlo, monospace";
  const mono = { font, anchor: "start" };
  const parts: NodeSpec[] = [{ id, kind: "group", props: {} }];
  const numW = textWidth(String(lines.length), SIZE * 0.7, true) + SIZE * 0.6;
  const codeW = Math.max(...lines.map((l) => textWidth(l, SIZE, true)), SIZE * 6);
  const lineY = (k: number) => LH * (k - 0.5);
  // The bar that marks the line about to run sits behind the code.
  const pad = SIZE * 0.3;
  parts.push({ id: tracePart.cursor(id), kind: "path", parent: id, props: { x: 0, y: lineY(1), points: [-pad, -LH / 2, codeW + pad, -LH / 2, codeW + pad, LH / 2, -pad, LH / 2, -pad, -LH / 2], closed: 1, fill: "highlight", stroke: "none", opacity: 0, z: -1 } });
  lines.forEach((l, i) => {
    parts.push(text(`${id}.num.${i + 1}`, id, -numW, lineY(i + 1), String(i + 1), SIZE * 0.7, { ...mono, color: "soft", opacity: 0.45 }));
    parts.push(text(tracePart.line(id, i + 1), id, 0, lineY(i + 1), l, SIZE, mono));
  });
  const rets = log.filter((e) => e.type === "return").map((e) => `→ ${e.returned}`);
  const retW = Math.max(0, ...rets.map((r) => textWidth(r, SIZE * 0.85, true)));
  if (rets.length) parts.push(text(tracePart.ret(id), id, codeW + pad * 2 + SIZE * 0.3, lineY(1), "", SIZE * 0.85, { ...mono, color: "accent", weight: 700, opacity: 0 }));
  let y = LH * lines.length + GAP;
  let right = codeW + pad + (rets.length ? pad + SIZE * 0.3 + retW : 0);

  // Variables: one row per name, in the order names first appear.
  const names: string[] = [];
  for (const e of log) for (const v of e.vars) if (!names.includes(v.name)) names.push(v.name);
  const varY = new Map<string, number>();
  if (names.length) {
    parts.push(text(`${id}.vars`, id, 0, y, "variables", PANEL, { anchor: "start", color: "soft", opacity: 0.6 }));
    y += PANEL * 1.2;
    for (const n of names) {
      varY.set(n, y + LH / 2);
      const widest = Math.max(...log.flatMap((e) => e.vars.filter((v) => v.name === n).map((v) => textWidth(`${n} = ${v.value}`, SIZE, true))));
      right = Math.max(right, widest);
      parts.push(text(tracePart.variable(id, n), id, 0, y + LH / 2, `${n} = `, SIZE, { ...mono, opacity: 0 }));
      y += LH;
    }
    y += GAP * 0.6;
  }
  // The call stack, shown once any function is called: the program at the top, each call below the one that made it.
  const depth = Math.max(...log.map((e) => e.stack.length));
  const frameText = (f: TraceEvent["stack"][number]) => (f.name === "program" ? "program" : `${f.name}(${f.args})`);
  if (depth > 1) {
    parts.push(text(`${id}.stack`, id, 0, y, "call stack", PANEL, { anchor: "start", color: "soft", opacity: 0.6 }));
    y += PANEL * 1.2;
    for (let k = 1; k <= depth; k++) {
      const widest = Math.max(...log.filter((e) => e.stack.length >= k).map((e) => textWidth(frameText(e.stack[k - 1]!), SIZE * 0.85, true)));
      right = Math.max(right, widest + SIZE * 0.6 * (k - 1));
      parts.push(text(tracePart.frame(id, k), id, SIZE * 0.6 * (k - 1), y + LH / 2, k === 1 ? "program" : "", SIZE * 0.85, { ...mono, opacity: 0 }));
      y += LH * 0.92;
    }
    y += GAP * 0.6;
  }
  const outputs = log.at(-1)!.output;
  if (outputs.length) {
    parts.push(text(`${id}.output`, id, 0, y, "output", PANEL, { anchor: "start", color: "soft", opacity: 0.6 }));
    y += PANEL * 1.2;
    outputs.forEach((o, k) => {
      right = Math.max(right, textWidth(o, SIZE, true));
      parts.push(text(tracePart.out(id, k + 1), id, 0, y + LH / 2, o, SIZE, { ...mono, opacity: 0, weight: 700 }));
      y += LH;
    });
  }
  parts.push(frame(`${id}.frame`, id, -numW - SIZE * 0.6, -pad, right + pad, y));

  const s = new Story(parts);
  let prev: TraceEvent | undefined;
  for (const e of log) {
    const code = lines[e.line - 1]?.trim() ?? "";
    s.step(e.type === "line" ? `line ${e.line}: ${code}` : e.type === "return" ? `${prev?.stack.at(-1)?.name ?? "it"} returns ${e.returned}` : "the program ends");
    if (e.type === "end") s.set(tracePart.cursor(id), "opacity", 0, 0, 0.4);
    else {
      s.set(tracePart.cursor(id), "y", lineY(e.line), 0, 0.35).set(tracePart.cursor(id), "opacity", 0.45, 0, 0.25);
      s.flash(tracePart.line(id, e.line), "weight", 700);
    }
    if (e.type === "return") {
      s.set(tracePart.ret(id), "y", lineY(e.line), 0, 0).set(tracePart.ret(id), "text", `→ ${e.returned}`, 0, 0).flash(tracePart.ret(id), "opacity", 1, 0.2);
    }
    const before = new Map(prev?.vars.map((v) => [v.name, v.value]));
    const now = new Map(e.vars.map((v) => [v.name, v.value]));
    for (const n of names) {
      const v = now.get(n);
      const vid = tracePart.variable(id, n);
      if (v === undefined) {
        if (before.has(n)) s.set(vid, "opacity", 0, 0.3, 0.3);
        continue;
      }
      if (before.get(n) !== v || !before.has(n)) {
        s.set(vid, "text", `${n} = ${v}`, 0.3, 0).set(vid, "opacity", 1, 0.3, 0.3);
        if (before.has(n)) s.flash(vid, "color", "accent", 0.3);
      }
    }
    for (let k = 2; k <= depth; k++) {
      const f = e.stack[k - 1];
      const fid = tracePart.frame(id, k);
      if (f) s.set(fid, "text", frameText(f), 0.2, 0).set(fid, "opacity", 1, 0.2, 0.3).set(fid, "color", k === e.stack.length ? "accent" : "ink", 0.2, 0.2);
      else if (prev && prev.stack.length >= k) s.set(fid, "opacity", 0, 0.2, 0.3);
    }
    if (depth > 1) {
      if (!prev) s.set(tracePart.frame(id, 1), "opacity", 1, 0, 0.3);
      s.set(tracePart.frame(id, 1), "color", e.stack.length === 1 ? "accent" : "ink", 0.2, 0.2);
    }
    for (let k = (prev?.output.length ?? 0) + 1; k <= e.output.length; k++) s.set(tracePart.out(id, k), "opacity", 1, 0.3, 0.4).play(tracePart.out(id, k), "pulse", 0.3);
    prev = e;
  }
  return { parts, steps: s.finish() };
}

export const traceKit: Kit = {
  name: "trace",
  kinds: { trace: truthKind("trace", traceBoard, ["code", "lines"]) },
  behaviors: { steps: playSteps },
  docs: {
    trace: "`trace t code=[\"function sum(xs) {\",\"  let total = 0\",\"  for (const n of xs) {\",\"    total += n\",\"  }\",\"  return total\",\"}\",\"console.log(sum([3,5,2]))\"]` really runs a small JavaScript program (one list item per line; single quotes inside code) and shows the code with the line about to run lit, a variables panel, the call stack and the output. Each line run is a step, a function returning is a step, and the end is a step; loops repeat lines, so prefer `do steps t until=@N`. Parts: t.line.K (from 1), t.cursor, t.var.NAME, t.frame.K, t.out.K",
    steps: STEPS_DOC,
  },
};
