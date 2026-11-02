// Linear algebra on screen: row operations, determinants, Cramer's rule and matrix times vector. Every number shown
// comes from engine/truth/linalg.ts in exact fractions; this file only decides where things sit and when they change.
import type { Kit, NodeSpec } from "../core/types.ts";
import { Frac, toMatrix, toVector, type Mat } from "../truth/fraction.ts";
import { cramer, determinant, eliminate, matVec, parseOp, rowOps, sub, type DetEvent } from "../truth/linalg.ts";
import { bracket, frame, playSteps, Story, STEPS_DOC, text, textWidth, truthKind, type Board } from "./steps.ts";

const SIZE = 64;
const ROW = SIZE * 1.55;
const GAP = SIZE * 0.85;
const LINE = SIZE * 0.78; // size of worked lines under a matrix
const STROKE = 6;

// Part names, so scenes and tests never spell them by hand. Rows and columns count from 1.
export const linalgPart = {
  cell: (m: string, r: number, c: number) => `${m}.cell.${r}.${c}`,
  row: (m: string, r: number) => `${m}.row.${r}`,
  op: (m: string) => `${m}.op`,
  line: (m: string, k: number) => `${m}.line.${k}`,
  total: (m: string) => `${m}.total`,
  diag: (m: string, k: number) => `${m}.diag.${k}`,
  copy: (m: string, r: number, c: number) => `${m}.copy.${r}.${c}`,
};

type Grid = { nodes: NodeSpec[]; at: (r: number, c: number) => { x: number; y: number }; left: number; right: number; top: number; bottom: number; colX: number[] };

// A block of cells in rows. `texts` holds every state the cells will ever show, so columns never change width.
function grid(prefix: string, parent: string, x0: number, y0: number, texts: string[][][], look: { edge: "bracket" | "bars" | "none"; aug?: boolean; extra?: number; hidden?: boolean; size?: number }): Grid {
  const size = look.size ?? SIZE;
  const rowH = size * 1.55;
  const rows = texts[0]!.length;
  const cols = texts[0]![0]!.length; // columns of room, of which the last `extra` hold no cells
  const cellCols = cols - (look.extra ?? 0);
  const width = Array.from({ length: cols }, (_, c) => Math.max(size * 0.9, ...texts.flatMap((s) => s.map((r) => textWidth(r[c] ?? "", size)))) + GAP * (size / SIZE));
  const colX: number[] = [];
  let x = x0 + size * 0.35;
  for (const w of width) {
    colX.push(x + w / 2);
    x += w;
  }
  const right = x + size * 0.35;
  const at = (r: number, c: number) => ({ x: colX[c - 1]!, y: y0 + rowH * (r - 0.5) });
  const nodes: NodeSpec[] = [];
  for (let r = 1; r <= rows; r++) {
    nodes.push({ id: `${prefix}.row.${r}`, kind: "group", parent, props: { x: 0, y: 0 } });
    for (let c = 1; c <= cellCols; c++) {
      const p = at(r, c);
      nodes.push(text(`${prefix}.cell.${r}.${c}`, `${prefix}.row.${r}`, p.x, p.y, texts[0]![r - 1]![c - 1]!, size, look.hidden ? { opacity: 0 } : {}));
    }
  }
  const [top, bottom] = [y0 - size * 0.12, y0 + rowH * rows + size * 0.12];
  const line = { stroke: "ink", strokeWidth: STROKE, fill: "none", lineCap: "round", lineJoin: "round", ...(look.hidden ? { opacity: 0 } : {}) };
  const realRight = x0 + size * 0.35 + width.slice(0, cellCols).reduce((a, b) => a + b, 0) + size * 0.35;
  if (look.edge === "bracket") {
    nodes.push({ id: `${prefix}.left`, kind: "path", parent, props: { points: bracket(x0, top, bottom, -1), ...line } });
    nodes.push({ id: `${prefix}.right`, kind: "path", parent, props: { points: bracket(realRight, top, bottom, 1), ...line } });
  } else if (look.edge === "bars") {
    nodes.push({ id: `${prefix}.left`, kind: "path", parent, props: { points: [x0, top, x0, bottom], ...line } });
    nodes.push({ id: `${prefix}.right`, kind: "path", parent, props: { points: [realRight, top, realRight, bottom], ...line } });
  }
  if (look.aug) {
    const bx = colX[cellCols - 2]! + width[cellCols - 2]! / 2;
    nodes.push({ id: `${prefix}.bar`, kind: "path", parent, props: { points: [bx, top + size * 0.2, bx, bottom - size * 0.2], ...line, strokeWidth: STROKE * 0.7 } });
  }
  return { nodes, at, left: x0 - 20, right: Math.max(right, realRight) + 20, top, bottom, colX };
}

const strs = (m: Mat) => m.map((r) => r.map(String));
const cells = (rows: number, cols: number) => Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => [r + 1, c + 1] as const)).flat();

// ---------- matrix: row operations ----------

function matrixBoard(id: string, d: Record<string, unknown>): Board {
  if (d.data === undefined) throw new Error(`matrix needs data, as in matrix m data=[[2,1],[4,3]]`);
  const m = toMatrix(d.data);
  const [rows, cols] = [m.length, m[0]!.length];
  const aug = d.aug === 1 || d.aug === true || d.aug === "1";
  if (aug && cols < 2) throw new Error(`aug=1 needs at least two columns`);
  let ops = [] as ReturnType<typeof parseOp>[];
  if (d.ops !== undefined && d.solve !== undefined) throw new Error(`give ops or solve, not both`);
  if (d.ops !== undefined) {
    const list = Array.isArray(d.ops) ? d.ops.map(String) : String(d.ops).split(",").map((s) => s.trim()).filter(Boolean);
    if (!list.length) throw new Error(`ops is empty`);
    ops = list.map((o) => parseOp(o, rows));
  } else if (d.solve !== undefined) {
    if (d.solve !== "echelon" && d.solve !== "rref") throw new Error(`solve must be echelon or rref, not ${d.solve}`);
    ops = eliminate(m, d.solve, aug ? cols - 1 : cols);
    if (!ops.length) throw new Error(`this matrix is already in ${d.solve} form, so there are no steps`);
  }
  const log = rowOps(m, ops);
  const states = [strs(m), ...log.map((e) => strs(e.after))];
  const parts: NodeSpec[] = [{ id, kind: "group", props: {} }];
  const g = grid(id, id, 0, 0, states, { edge: "bracket", aug });
  parts.push(...g.nodes);
  // The operation is written under the matrix; the rows it touches light up, so the eye finds them.
  const opY = g.bottom + LINE * 1.1;
  const opW = Math.max(0, ...log.map((e) => textWidth(e.label, LINE)));
  const mid = (g.left + g.right) / 2;
  parts.push(text(linalgPart.op(id), id, mid, opY, "", LINE, { color: "accent", opacity: 0, weight: 700 }));
  parts.push(frame(`${id}.frame`, id, Math.min(g.left, mid - opW / 2), g.top, Math.max(g.right, mid + opW / 2), opY + LINE * 0.7));
  const s = new Story(parts);
  const rowY = (r: number) => g.at(r, 1).y;
  for (const e of log) {
    s.step(e.label);
    const op = e.op;
    const involved = op.type === "add" ? [op.row, op.src] : e.rows;
    s.set(linalgPart.op(id), "text", e.label, 0, 0).set(linalgPart.op(id), "opacity", 1, 0, 0.25);
    for (let r = 1; r <= rows; r++) if (!involved.includes(r)) s.flash(linalgPart.row(id, r), "opacity", 0.3);
    for (const r of e.rows) for (let c = 1; c <= cols; c++) s.flash(linalgPart.cell(id, r, c), "color", "accent");
    if (op.type === "swap") {
      s.set(linalgPart.row(id, op.a), "y", rowY(op.b) - rowY(op.a), 0.05, 0.6).set(linalgPart.row(id, op.b), "y", rowY(op.a) - rowY(op.b), 0.05, 0.6);
      // Once they have crossed, each row is back in its own place holding the other's numbers, so ids keep naming places.
      s.set(linalgPart.row(id, op.a), "y", 0, 0.7, 0).set(linalgPart.row(id, op.b), "y", 0, 0.7, 0);
      for (let c = 1; c <= cols; c++) {
        s.set(linalgPart.cell(id, op.a, c), "text", String(e.after[op.a - 1]![c - 1]), 0.7, 0);
        s.set(linalgPart.cell(id, op.b, c), "text", String(e.after[op.b - 1]![c - 1]), 0.7, 0);
      }
    } else {
      for (let c = 1; c <= cols; c++) {
        const [before, after] = [e.before[op.row - 1]![c - 1]!, e.after[op.row - 1]![c - 1]!];
        if (before.eq(after)) continue;
        s.set(linalgPart.cell(id, op.row, c), "text", String(after), 0.45, 0);
        s.play(linalgPart.cell(id, op.row, c), "pulse", 0.45);
      }
    }
  }
  return { parts, steps: s.finish() };
}

// ---------- det: determinants with every product shown ----------

function detBoard(id: string, d: Record<string, unknown>): Board {
  if (d.data === undefined) throw new Error(`det needs data, as in det d data=[[2,1],[1,3]]`);
  const m = toMatrix(d.data);
  const n = m.length;
  const method = String(d.method ?? "auto") as "auto" | "diagonal" | "sarrus" | "cofactor";
  if (!["auto", "diagonal", "sarrus", "cofactor"].includes(method)) throw new Error(`method must be diagonal, sarrus or cofactor, not ${method}`);
  const along = d.row === undefined ? 1 : Number(d.row);
  const log = determinant(m, method, along);
  const sarrus = log[0]!.type === "copy";
  const parts: NodeSpec[] = [{ id, kind: "group", props: {} }];
  const texts = strs(m);
  // With Sarrus the first two columns are written again on the right, outside the bars.
  const g = grid(id, id, 0, 0, [sarrus ? texts.map((r) => [...r, r[0]!, r[1]!]) : texts], { edge: "bars", extra: sarrus ? 2 : 0 });
  parts.push(...g.nodes);
  if (sarrus) for (let r = 1; r <= 3; r++) for (const c of [1, 2]) parts.push(text(linalgPart.copy(id, r, c), linalgPart.row(id, r), g.colX[2 + c]!, g.at(r, 1).y, texts[r - 1]![c - 1]!, SIZE, { opacity: 0, color: "soft" }));
  const cellPos = (r: number, c: number) => ({ x: g.colX[c - 1]!, y: g.at(r, 1).y });
  // Each product's diagonal, as a line through its cells, in the extended columns for Sarrus.
  const products = log.filter((e): e is Extract<DetEvent, { type: "product" }> => e.type === "product");
  const diagCols: number[][] = products.map((p, k) => {
    if (!sarrus) return p.cells.map(([, c]) => c);
    const s = k % 3;
    return k < 3 ? [s + 1, s + 2, s + 3] : [s + 3, s + 2, s + 1];
  });
  products.forEach((p, k) => {
    const pts = p.cells.map(([r], i) => cellPos(r, diagCols[k]![i]!));
    const [a, b] = [pts[0]!, pts.at(-1)!];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const [ux, uy] = [(b.x - a.x) / len, (b.y - a.y) / len];
    const ext = SIZE * 0.55;
    parts.push({ id: linalgPart.diag(id, k + 1), kind: "path", parent: id, props: { points: [a.x - ux * ext, a.y - uy * ext, b.x + ux * ext, b.y + uy * ext], stroke: "accent", strokeWidth: STROKE * 1.4, lineCap: "round", fill: "none", opacity: 0, drawn: 0, z: -1 } });
  });
  const workLines = log.filter((e) => e.type === "product" || e.type === "cofactor");
  const total = log.at(-1) as Extract<DetEvent, { type: "total" }>;
  const mid = (g.left + g.right) / 2;
  let y = g.bottom + LINE * 1.2;
  const lineIds: string[] = [];
  workLines.forEach((e, k) => {
    lineIds.push(linalgPart.line(id, k + 1));
    parts.push(text(linalgPart.line(id, k + 1), id, mid, y, (e as { text: string }).text, LINE, { opacity: 0 }));
    y += LINE * 1.35;
  });
  const totalText = `det = ${total.text}`;
  parts.push(text(linalgPart.total(id), id, mid, y + LINE * 0.2, totalText, LINE * 1.1, { opacity: 0, weight: 700 }));
  const widest = Math.max(g.right - g.left, ...workLines.map((e) => textWidth((e as { text: string }).text, LINE)), textWidth(totalText, LINE * 1.1));
  parts.push(frame(`${id}.frame`, id, Math.min(g.left, mid - widest / 2), g.top, Math.max(g.right, mid + widest / 2), y + LINE));
  const s = new Story(parts);
  let line = 0;
  let prod = 0;
  for (const e of log) {
    if (e.type === "copy") {
      s.step("copy the first two columns to the right");
      for (let r = 1; r <= 3; r++) for (const c of [1, 2]) s.set(linalgPart.copy(id, r, c), "opacity", 1, 0.1 * r, 0.5);
    } else if (e.type === "product") {
      s.step(e.text);
      prod++;
      s.flash(linalgPart.diag(id, prod), "opacity", 1, 0, 0.15).set(linalgPart.diag(id, prod), "drawn", 1, 0, 0.5);
      e.cells.forEach(([r, c], i) => {
        const col = diagCols[prod - 1]![i]!;
        s.flash(col > 3 ? linalgPart.copy(id, r, col - 3) : linalgPart.cell(id, r, col), "color", "accent", 0.1);
      });
      s.set(lineIds[line++]!, "opacity", 1, 0.45, 0.4);
    } else if (e.type === "cofactor") {
      s.step(e.text);
      for (let c = 1; c <= n; c++) if (c !== e.col) s.flash(linalgPart.cell(id, e.row, c), "opacity", 0.2);
      for (let r = 1; r <= n; r++) if (r !== e.row) s.flash(linalgPart.cell(id, r, e.col), "opacity", 0.2);
      s.flash(linalgPart.cell(id, e.row, e.col), "color", "accent").play(linalgPart.cell(id, e.row, e.col), "pulse", 0.1);
      s.set(lineIds[line++]!, "opacity", 1, 0.4, 0.4);
    } else {
      s.step(`det = ${e.text}`);
      s.set(linalgPart.total(id), "opacity", 1, 0, 0.5).play(linalgPart.total(id), "pulse", 0.5);
    }
  }
  return { parts, steps: s.finish() };
}

// ---------- cramer: Cramer's rule ----------

function cramerBoard(id: string, d: Record<string, unknown>): Board {
  if (d.a === undefined || d.b === undefined) throw new Error(`cramer needs a and b, as in cramer c a=[[2,1],[1,3]] b=[3,5]`);
  const a = toMatrix(d.a, "a");
  const b = toVector(d.b, "b");
  const n = a.length;
  const names = d.names === undefined ? (n <= 3 ? ["x", "y", "z"].slice(0, n) : Array.from({ length: n }, (_, i) => `x${sub(i + 1)}`)) : Array.isArray(d.names) ? d.names.map(String) : String(d.names).split(",");
  const log = cramer(a, b, names);
  const parts: NodeSpec[] = [{ id, kind: "group", props: {} }];
  // Top: A and b side by side. Middle: the matrix whose determinant is being taken. Bottom: the answers.
  const top = SIZE * 1.1;
  const A = grid(`${id}.a`, id, 0, top, [strs(a)], { edge: "bracket" });
  const B = grid(`${id}.b`, id, A.right + SIZE * 0.9, top, [b.map((x) => [String(x)])], { edge: "bracket" });
  parts.push(...A.nodes, ...B.nodes);
  parts.push(text(`${id}.a.name`, id, (A.left + A.right) / 2, SIZE * 0.35, "A", SIZE * 0.8, { weight: 700 }));
  parts.push(text(`${id}.b.name`, id, (B.left + B.right) / 2, SIZE * 0.35, "b", SIZE * 0.8, { weight: 700 }));
  const wTexts = [strs(a), ...log.filter((e) => e.type === "replace").map((e) => strs(e.matrix))];
  const wTop = A.bottom + SIZE * 1.9;
  const wWidth = (() => {
    const probe = grid("probe", id, 0, 0, wTexts, { edge: "bars" });
    return probe.right - probe.left;
  })();
  const wx = (B.right + A.left) / 2 - wWidth / 2 + 20;
  const W = grid(`${id}.w`, id, wx, wTop, wTexts, { edge: "bars", hidden: true });
  parts.push(...W.nodes);
  const wName = `${id}.w.name`;
  const wValue = `${id}.w.value`;
  parts.push(text(wName, id, (W.left + W.right) / 2, wTop - SIZE * 0.75, "|A|", SIZE * 0.8, { opacity: 0, weight: 700 }));
  const dets = log.filter((e) => e.type === "det");
  const valueTexts = dets.map((e) => `= ${e.text}`);
  parts.push(text(wValue, id, (W.left + W.right) / 2, W.bottom + LINE * 0.9, valueTexts[0]!, LINE, { opacity: 0 }));
  const flyIds = b.map((x, r) => {
    const p = B.at(r + 1, 1);
    const fid = `${id}.fly.${r + 1}`;
    parts.push(text(fid, id, p.x, p.y, String(x), SIZE, { opacity: 0, color: "accent" }));
    return fid;
  });
  const divides = log.filter((e) => e.type === "divide");
  let y = W.bottom + LINE * 2.5;
  const resultIds = divides.map((e, i) => {
    const rid = `${id}.result.${i + 1}`;
    parts.push(text(rid, id, (A.left + B.right) / 2, y, e.text, LINE, { opacity: 0, weight: 700 }));
    y += LINE * 1.4;
    return rid;
  });
  const widest = Math.max(B.right - A.left, W.right - W.left, ...valueTexts.map((t) => textWidth(t, LINE)), ...divides.map((e) => textWidth(e.text, LINE)));
  const cx = (A.left + B.right) / 2;
  parts.push(frame(`${id}.frame`, id, cx - widest / 2, 0, cx + widest / 2, y));
  const s = new Story(parts);
  const wCells = cells(n, n);
  let current = 0;
  for (const e of log) {
    if (e.type === "det" && e.col === 0) {
      s.step(`|A| = ${e.text}`);
      for (const p of W.nodes) s.set(p.id, "opacity", 1, 0, 0.4);
      s.set(wName, "opacity", 1, 0, 0.4);
      for (const [r, c] of wCells) s.flash(`${id}.a.cell.${r}.${c}`, "color", "accent");
      s.set(wValue, "opacity", 1, 0.45, 0.4);
    } else if (e.type === "replace") {
      current = e.col;
      s.step(`replace column ${e.col} of A with b`);
      s.set(wName, "text", `|A${sub(e.col)}|`, 0, 0).set(wValue, "opacity", 0, 0, 0.2);
      for (const [r, c] of wCells) {
        if (c === e.col) continue;
        s.set(`${id}.w.cell.${r}.${c}`, "text", String(a[r - 1]![c - 1]), 0, 0).set(`${id}.w.cell.${r}.${c}`, "color", "ink", 0, 0.2);
      }
      flyIds.forEach((fid, r) => {
        const from = B.at(r + 1, 1);
        const to = W.at(r + 1, e.col);
        s.flash(`${id}.b.cell.${r + 1}.1`, "color", "accent");
        s.set(fid, "opacity", 1, 0, 0.1).set(fid, "x", to.x, 0.05, 0.55).set(fid, "y", to.y, 0.05, 0.55);
        s.set(fid, "opacity", 0, 0.62, 0).set(fid, "x", from.x, 0.62, 0).set(fid, "y", from.y, 0.62, 0);
        s.set(`${id}.w.cell.${r + 1}.${e.col}`, "text", String(b[r]), 0.62, 0).set(`${id}.w.cell.${r + 1}.${e.col}`, "color", "accent", 0.62, 0);
      });
    } else if (e.type === "det") {
      s.step(`|A${sub(e.col)}| = ${e.text}`);
      s.set(wValue, "text", `= ${e.text}`, 0, 0).set(wValue, "opacity", 1, 0, 0.4);
    } else {
      s.step(e.text);
      s.set(resultIds[current - 1]!, "opacity", 1, 0, 0.4).play(resultIds[current - 1]!, "pulse", 0.3);
    }
  }
  return { parts, steps: s.finish() };
}

// ---------- matvec: a matrix times a vector ----------

function matvecBoard(id: string, d: Record<string, unknown>): Board {
  if (d.m === undefined || d.v === undefined) throw new Error(`matvec needs m and v, as in matvec p m=[[1,2],[3,4]] v=[5,6]`);
  const m = toMatrix(d.m, "m");
  const v = toVector(d.v, "v");
  const log = matVec(m, v);
  const parts: NodeSpec[] = [{ id, kind: "group", props: {} }];
  const rows = m.length;
  const vTop = (rows - v.length) * ROW / 2;
  const M = grid(`${id}.m`, id, 0, 0, [strs(m)], { edge: "bracket" });
  const V = grid(`${id}.v`, id, M.right + SIZE * 0.5, vTop, [v.map((x) => [String(x)])], { edge: "bracket" });
  const eqX = V.right + SIZE * 0.7;
  const O = grid(`${id}.out`, id, eqX + SIZE * 0.7, 0, [log.map((e) => [String(e.value)])], { edge: "bracket", hidden: true });
  parts.push(...M.nodes, ...V.nodes, ...O.nodes);
  for (const p of O.nodes) if (p.kind === "path") p.props!.opacity = 1;
  parts.push(text(`${id}.eq`, id, eqX, M.at(1, 1).y + (ROW * (rows - 1)) / 2, "=", SIZE));
  const mid = (M.left + O.right) / 2;
  const lineY = Math.max(M.bottom, V.bottom) + LINE * 1.4;
  parts.push(text(linalgPart.line(id, 1), id, mid, lineY, "", LINE, { opacity: 0 }));
  const widest = Math.max(O.right - M.left, ...log.map((e) => textWidth(e.text, LINE)));
  parts.push(frame(`${id}.frame`, id, mid - widest / 2, Math.min(M.top, V.top), mid + widest / 2, lineY + LINE));
  const s = new Story(parts);
  for (const e of log) {
    s.step(`row ${e.row}: ${e.text}`);
    for (let c = 1; c <= m[0]!.length; c++) s.flash(`${id}.m.cell.${e.row}.${c}`, "color", "accent");
    for (let r = 1; r <= v.length; r++) s.flash(`${id}.v.cell.${r}.1`, "color", "accent");
    s.set(linalgPart.line(id, 1), "text", e.text, 0, 0).set(linalgPart.line(id, 1), "opacity", 1, 0, 0.3);
    s.set(`${id}.out.cell.${e.row}.1`, "opacity", 1, 0.5, 0.35).play(`${id}.out.cell.${e.row}.1`, "pulse", 0.5);
  }
  return { parts, steps: s.finish() };
}

export const linalgKit: Kit = {
  name: "linalg",
  kinds: {
    matrix: truthKind("matrix", matrixBoard, ["data", "ops", "solve", "aug"]),
    det: truthKind("det", detBoard, ["data", "method", "row"]),
    cramer: truthKind("cramer", cramerBoard, ["a", "b", "names"]),
    matvec: truthKind("matvec", matvecBoard, ["m", "v"]),
  },
  behaviors: { steps: playSteps },
  docs: {
    matrix: "`matrix m data=[[2,1,5],[4,3,6]] ops=[\"R1<->R2\",\"R2-2R1\",\"R1*1/2\"]` row operations in exact fractions, one step per op (swap R1<->R2, scale R2*3 or R2/3, add R3+1/2R1). Or `solve=echelon` or `solve=rref` and the engine works out the ops itself. `aug=1` draws the bar before the last column. Parts: m.cell.ROW.COL and m.row.ROW (from 1), m.op (the op label). No spaces inside values",
    det: "`det d data=[[2,1],[1,3]] method=diagonal|sarrus|cofactor` a determinant worked out product by product, each its own step: 2 by 2 is 3 steps (two diagonals, then the total); sarrus (3 by 3) is 8 (copy two columns, three down, three up, total); cofactor (default for 3 by 3 and 4 by 4, `row=1`) is one step per entry of the row, then the total. Parts: d.cell.ROW.COL, d.diag.K, d.line.K (the Kth worked line), d.total",
    cramer: "`cramer c a=[[2,1],[1,3]] b=[3,5] names=[\"x\",\"y\"]` solves a system by Cramer's rule: step 1 shows |A|, then 3 steps per unknown (b replaces that column, its determinant, the division). 2 unknowns is 7 steps, 3 is 10. Parts: c.a.cell.R.C, c.b.cell.R.1, c.w.cell.R.C (the matrix being worked), c.w.value, c.result.K",
    matvec: "`matvec p m=[[1,2],[3,4]] v=[5,6]` a matrix times a vector, one step per row of the matrix (the row and the vector light up, the sum of products is written, the answer appears). Parts: p.m.cell.R.C, p.v.cell.R.1, p.out.cell.R.1, p.line.1",
    steps: STEPS_DOC,
  },
};
