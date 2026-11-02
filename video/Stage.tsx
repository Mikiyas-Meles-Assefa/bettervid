// The teaching stage: one still board where things persist. Each state lists what is on the board; anything with the
// same id travels from where it was to where it is now, new things appear, and finished things fade. No camera moves.
import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Clip, StageState, StyleFile } from "../schemas/project.ts";

const LEFT = 70;
const TOP = 90;
const WIDTH = 940;
const HEIGHT = 1470;
const SIZE = { big: 104, normal: 80, note: 50 };
const MOVE = 0.75; // seconds a change takes
const CHAR = 0.56; // average character width, in em

type Placed = { id: string; text: string; x: number; y: number; size: number; note: boolean };
type Rule = { id: string; x1: number; y1: number; x2: number; y2: number };
type Layout = { atoms: Map<string, Placed>; rules: Map<string, Rule> };

const wide = (text: string, size: number) => Math.max(0.6, text.length) * size * CHAR;

// Pure layout, so positions are known for every state and things can travel between them.
function place(state: StageState): Layout {
  const measure = (s: number) => {
    const lines = state.lines.map((l) => {
      const size = SIZE[l.size] * s;
      const gap = size * 0.28;
      let w = 0;
      let h = size * 1.2;
      for (const p of l.parts) {
        if (p.type === "text") w += wide(p.text, size);
        if (p.type === "frac") {
          w += Math.max(sum(p.num, size), sum(p.den, size)) + size * 0.3;
          h = Math.max(h, size * 2.5);
        }
        if (p.type === "matrix") {
          const cols = columns(p, size);
          w += cols.reduce((a, b) => a + b, 0) + size * 0.4;
          h = Math.max(h, p.rows.length * size * 1.3 + size * 0.3);
        }
        w += gap;
      }
      return { w, h, size, gap };
    });
    return lines;
  };
  // The board fills the screen: everything grows until it reaches the edges, and shrinks only when it is truly full.
  const need = (x: ReturnType<typeof measure>) => x.reduce((a, l) => a + l.h + 40, 0);
  const fits = (x: ReturnType<typeof measure>) => need(x) <= HEIGHT && x.every((l) => l.w <= WIDTH);
  let s = 1.9;
  let m = measure(s);
  while (!fits(m) && s > 0.45) m = measure((s -= 0.05));
  const out: Layout = { atoms: new Map(), rules: new Map() };
  let y = TOP + Math.max(0, (HEIGHT - need(m)) / 2.4);
  state.lines.forEach((l, i) => {
    const { size, gap, h, w } = m[i]!;
    let x = LEFT + Math.max(0, (WIDTH - w) / 2);
    const mid = y + h / 2;
    const put = (a: { id: string; text: string }, px: number, py: number, sz = size) =>
      out.atoms.set(a.id, { id: a.id, text: a.text, x: px, y: py, size: sz, note: l.size === "note" });
    for (const p of l.parts) {
      if (p.type === "text") {
        put(p, x, mid - size * 0.6);
        x += wide(p.text, size);
      }
      if (p.type === "frac") {
        const fw = Math.max(sum(p.num, size), sum(p.den, size)) + size * 0.3;
        row(p.num, x + (fw - sum(p.num, size)) / 2, mid - size * 1.22, size, put);
        row(p.den, x + (fw - sum(p.den, size)) / 2, mid + size * 0.08, size, put);
        out.rules.set(`${p.num[0]?.id ?? i}-bar`, { id: "bar", x1: x, y1: mid, x2: x + fw, y2: mid });
        x += fw;
      }
      if (p.type === "matrix") {
        const cols = columns(p, size);
        const tw = cols.reduce((a, b) => a + b, 0) + size * 0.4;
        const th = p.rows.length * size * 1.3;
        const top = mid - th / 2;
        const key = p.rows[0]?.[0]?.id ?? String(i);
        out.rules.set(`${key}-l`, { id: "l", x1: x, y1: top, x2: x, y2: top + th });
        out.rules.set(`${key}-r`, { id: "r", x1: x + tw, y1: top, x2: x + tw, y2: top + th });
        p.rows.forEach((r, ri) => {
          let cx = x + size * 0.2;
          r.forEach((a, ci) => {
            put(a, cx + (cols[ci]! - wide(a.text, size)) / 2, top + ri * size * 1.3 + size * 0.05);
            cx += cols[ci]!;
          });
        });
        x += tw;
      }
      x += gap;
    }
    y += h + 40;
  });
  return out;
}

const sum = (list: { text: string }[], size: number) => list.reduce((a, b) => a + wide(b.text, size), 0);
const columns = (p: { rows: { text: string }[][] }, size: number) =>
  (p.rows[0] ?? []).map((_, c) => Math.max(...p.rows.map((r) => wide(r[c]?.text ?? "", size))) + size * 0.5);
function row(list: { id: string; text: string }[], x: number, y: number, size: number, put: (a: { id: string; text: string }, x: number, y: number) => void) {
  for (const a of list) {
    put(a, x, y);
    x += wide(a.text, size);
  }
}

export const StageShot: React.FC<{ clip: Clip; style: StyleFile; index: number }> = ({ clip, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const states = clip.stage!;
  const layouts = React.useMemo(() => states.map(place), [states]);
  let i = 0;
  while (i + 1 < states.length && states[i + 1]!.frame <= frame) i++;
  const now = layouts[i]!;
  const was = layouts[i - 1];
  const t = interpolate(frame, [states[i]!.frame, states[i]!.frame + MOVE * fps], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) });
  const light = new Set(states[i]!.light);
  const lit = (id: string) => light.has(id);
  const seen = [...now.atoms.values()].map((a) => {
    const from = was?.atoms.get(a.id);
    const x = from ? from.x + (a.x - from.x) * t : a.x;
    const y = from ? from.y + (a.y - from.y) * t : a.y;
    const size = from ? from.size + (a.size - from.size) * t : a.size;
    return { ...a, x, y, size, opacity: from ? 1 : t };
  });
  const gone = was ? [...was.atoms.values()].filter((a) => !now.atoms.has(a.id)).map((a) => ({ ...a, opacity: 1 - t })) : [];
  const rules = [...now.rules.entries()].map(([k, r]) => {
    const from = was?.rules.get(k);
    const m = (a: number, b?: number) => (b === undefined ? a : b + (a - b) * t);
    return { k, x1: m(r.x1, from?.x1), y1: m(r.y1, from?.y1), x2: m(r.x2, from?.x2), y2: m(r.y2, from?.y2), o: from ? 1 : t };
  });
  return (
    <AbsoluteFill style={{ backgroundColor: style.palette.paper }}>
      <svg width={1080} height={1920} style={{ position: "absolute", left: 0, top: 0 }}>
        {rules.map((r) => <line key={r.k} x1={r.x1} y1={r.y1} x2={r.x2} y2={r.y2} stroke={style.palette.ink} strokeWidth={7} strokeLinecap="round" opacity={r.o} />)}
      </svg>
      {[...seen, ...gone].map((a) => {
        const on = lit(a.id);
        return (
          <div key={a.id} style={{ position: "absolute", left: a.x, top: a.y, fontFamily: style.fonts.body, fontSize: a.size, lineHeight: 1.2, whiteSpace: "pre", opacity: a.opacity, color: on ? style.palette.accent : a.note ? `${style.palette.ink}aa` : style.palette.ink, fontWeight: on ? 700 : 400, transform: on ? "scale(1.14)" : undefined, transformOrigin: "center" }}>
            {a.text}
          </div>
        );
      })}
    </AbsoluteFill>
  );
};
