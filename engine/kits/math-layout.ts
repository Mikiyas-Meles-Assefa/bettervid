// Typesets LaTeX with KaTeX in the browser, then reads back where every symbol, rule and stretchy shape really landed,
// along with which fraction, matrix row and column it belongs to. This is plain measurement: no drawing happens here.
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cached, runPage } from "./text-browser.ts";

export type RawGroup = { home: string[]; of: string[]; chunk?: string };
export type Raw =
  | ({ type: "char"; char: string; family: string; weight: number; italic: boolean; size: number; left: number; top: number; width: number; height: number } & RawGroup)
  | ({ type: "rule"; left: number; top: number; width: number; height: number } & RawGroup)
  | ({ type: "svg"; d: string; m: number[]; clipLeft: number; clipRight: number; name: string } & RawGroup);

const require = createRequire(import.meta.url);
const katex = require("katex") as { renderToString: (tex: string, options: object) => string };
const CSS = resolve(dirname(fileURLToPath(import.meta.url)), "../../node_modules/katex/dist/katex.min.css");
export const EM = 1000; // everything is laid out this big and divided, so the browser's rounding does not matter

export function html(tex: string): string {
  return katex.renderToString(tex, { displayMode: true, output: "html", trust: true, strict: false, throwOnError: true, macros: { "\\part": "\\htmlData{part=#1}{#2}" } });
}

// In the page. Walks the tree in reading order and tags each thing with the structure around it.
const walker = String.raw`
let fracs = 0, tables = 0;
function walk(el, g, out) {
  const cs = getComputedStyle(el);
  const c = el.classList;
  if (c && (c.contains("strut") || c.contains("pstrut") || c.contains("vlist-s"))) return;
  if (el.dataset && el.dataset.part) g = { ...g, of: [...g.of, "named." + el.dataset.part], chunk: el.dataset.part };
  const r = el.getBoundingClientRect();
  for (const [side, on] of [["Top", "top"], ["Bottom", "bottom"], ["Left", "left"], ["Right", "right"]]) {
    const w = parseFloat(cs["border" + side + "Width"]);
    if (!w || cs["border" + side + "Style"] === "none" || r.width === 0 && (on === "top" || on === "bottom")) continue;
    const box = on === "top" ? [r.left, r.top, r.width, w] : on === "bottom" ? [r.left, r.bottom - w, r.width, w] : on === "left" ? [r.left, r.top, w, r.height] : [r.right - w, r.top, w, r.height];
    out.push({ type: "rule", left: box[0], top: box[1], width: box[2], height: box[3], ...g });
  }
  if (c && c.contains("mfrac")) {
    const f = "frac." + fracs++;
    const list = el.querySelector(".vlist");
    const rows = [...list.children];
    const parts = rows.filter((x) => !x.querySelector(":scope > .frac-line"));
    for (const row of rows.slice().reverse()) {
      const part = row.querySelector(":scope > .frac-line") ? null : row === parts[parts.length - 1] ? f + ".num" : f + ".den";
      walk(row, part ? { ...g, home: [...g.home, f, part] } : { ...g, home: [...g.home, f] }, out);
    }
    return;
  }
  if (c && c.contains("mtable")) {
    const t = "matrix." + tables++;
    let col = 0;
    for (const kid of el.children) {
      if (![...kid.classList].some((k) => k.startsWith("col-align"))) { walk(kid, g, out); continue; }
      const rows = [...kid.querySelector(".vlist").children];
      rows.forEach((row, n) => walk(row, { ...g, home: [...g.home, t, t + ".row." + n, t + ".cell." + n + "." + col], of: [...g.of, t + ".col." + col] }, out));
      col++;
    }
    return;
  }
  if (el.tagName === "svg") {
    const s = el.getBoundingClientRect();
    for (const p of el.querySelectorAll("path")) {
      const m = p.getScreenCTM();
      out.push({ type: "svg", d: p.getAttribute("d"), m: [m.a, m.b, m.c, m.d, m.e, m.f], clipLeft: s.left, clipRight: s.right, name: (el.parentElement.className || "stretchy").split(" ")[0], ...g });
    }
    if (el.querySelector("line")) throw new Error("this notation draws plain lines, which are not supported yet");
    return;
  }
  for (const kid of el.childNodes) {
    if (kid.nodeType === 1) walk(kid, g, out);
    else if (kid.nodeType === 3) {
      const text = kid.textContent;
      for (let i = 0; i < text.length; ) {
        const char = String.fromCodePoint(text.codePointAt(i));
        const n = char.length;
        if (!/[\s​]/.test(char)) {
          const range = document.createRange();
          range.setStart(kid, i);
          range.setEnd(kid, i + n);
          const b = range.getBoundingClientRect();
          out.push({ type: "char", char, family: cs.fontFamily.split(",")[0].replace(/"/g, ""), weight: parseInt(cs.fontWeight), italic: cs.fontStyle === "italic", size: parseFloat(cs.fontSize), left: b.left, top: b.top, width: b.width, height: b.height, ...g });
        }
        i += n;
      }
    }
  }
}`;

const page = (list: string[]) => `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="file://${CSS}">
<style>body{margin:0;width:400000px}.f{font-size:${EM}px;position:absolute;left:1000px;top:3000px;white-space:nowrap}.katex-display{margin:0!important;text-align:left!important}.katex-display>.katex{display:inline-block;text-align:left!important}</style>
${list.map((h) => `<div class="f">${h}</div>`).join("")}
<script>${walker}
window.__result = (async () => {
  await document.fonts.ready;
  await Promise.all([...document.fonts].map((f) => f.load().catch(() => 0)));
  await document.fonts.ready;
  return [...document.querySelectorAll(".f")].map((f) => {
    fracs = 0; tables = 0;
    for (const o of document.querySelectorAll(".f")) o.style.display = o === f ? "block" : "none";
    const out = [];
    walk(f.querySelector(".katex-html"), { home: [], of: [] }, out);
    return out;
  });
})();
</script>`;

export function typeset(list: string[]): Raw[][] {
  return cached<Raw[]>(list.map((tex) => ({ key: `katex2|${tex}` })), (missing) => runPage(page(missing.map((i) => html(list[i]!)))) as Raw[][]);
}
