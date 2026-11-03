// Proof of the motion vocabulary, silent. The camera travels a wall of unrelated little worlds, each using different
// motion on ordinary parts. No model is involved and no world knows it is a demo.
// Usage: node --experimental-strip-types engine/proof/motion.ts <outDir> <style> [<style> ...]
import { join, resolve } from "node:path";
import { bundled } from "../render/bundle.ts";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { compile } from "../core/compile.ts";
import type { NodeSpec, Step } from "../core/types.ts";
import { graphKit, part } from "../kits/graph.ts";
import { box, circle } from "../kits/shapes.ts";
import { themeFrom } from "../render/theme.ts";

const [W, H] = [1920, 1080];
const star = (n: number, r: number, inner: number) => {
  const out: number[] = [];
  for (let i = 0; i <= n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2;
    const s = i % 2 ? inner : r;
    out.push(Math.cos(a) * s, Math.sin(a) * s);
  }
  return out;
};
const title = (id: string, x: number, y: number, text: string): NodeSpec => ({ id, kind: "text", props: { x, y, text, size: 54, color: "ink", weight: 700 } });
const blob = (id: string, x: number, y: number, r: number, fill = "accent", more = {}): NodeSpec => ({ id, kind: "path", props: { x, y, points: circle(0, 0, r), closed: 1, fill, stroke: "ink", strokeWidth: 6, ...more } });
const panes = [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [0, 2], [1, 2]] as const;
const cx = (i: number) => W / 2 + panes[i]![0] * W;
const cy = (i: number) => H / 2 + panes[i]![1] * H;
const look = (i: number) => ({ camera: { panX: cx(i), panY: cy(i) } });

function scene(): { steps: Step[]; frames: number } {
  const steps: Step[] = [];
  const SPAN = 150; // frames on each world
  const open = (i: number) => 20 + i * SPAN;

  // 0. Cell division: a blob morphs, then splits into two real parts.
  {
    const [x, y, t] = [cx(0), cy(0), open(0)];
    steps.push({ at: 0, enter: "none", add: [title("a.title", x, y - 400, "Morph, then split"), blob("a.cell", x - 200, y, 130), { id: "a.kid.left", kind: "path", props: { x: x - 340, y: y + 60, points: circle(0, 0, 95), closed: 1, fill: "accent", stroke: "ink", strokeWidth: 6, opacity: 0 } }, { id: "a.kid.right", kind: "path", props: { x: x + 60, y: y + 60, points: box(-85, -85, 170, 170), closed: 1, fill: "highlight", stroke: "ink", strokeWidth: 6, opacity: 0 } }] });
    steps.push({ at: t, play: [{ behavior: "morph", target: "a.cell", args: { to: star(6, 180, 80), frames: 40, ease: "swing" } }] });
    steps.push({ at: t + 44, play: [{ behavior: "morph", target: "a.cell", args: { to: box(-150, -150, 300, 300), frames: 30 } }] });
    steps.push({ at: t + 80, play: [{ behavior: "split", target: "a.cell", args: { into: "a.kid.*", frames: 40 } }] });
  }

  // 1. A bouncing weight: gravity, squash on impact, and a label that follows with lag.
  {
    const [x, y, t] = [cx(1), cy(1), open(1)];
    steps.push({ at: 0, enter: "none", add: [title("b.title", x, y - 400, "Gravity, squash, attached label"), { id: "b.floor", kind: "path", props: { points: [x - 520, y + 330, x + 520, y + 330], stroke: "ink", strokeWidth: 8 } }, blob("b.ball", x - 400, y - 170, 70), { id: "b.tag", kind: "text", props: { x: x - 400, y: y - 290, text: "9.8 m/s", size: 44, color: "ink" } }] });
    steps.push({ at: t, play: [{ behavior: "fall", target: "b.ball", args: { floor: y + 256, bounce: 0.72, vx: 180, squash: 0.42 } }, { behavior: "attach", target: "b.tag", args: { to: "b.ball", lag: 5, x: 0, y: -120 } }, { behavior: "trail", target: "b.ball", args: { count: 5, gap: 3, frames: 120, fade: 0.4 } }] });
  }

  // 2. A hopping character with anticipation, and arcs.
  {
    const [x, y, t] = [cx(2), cy(2), open(2)];
    steps.push({ at: 0, enter: "none", add: [title("c.title", x, y - 400, "Anticipation, stretch, follow-through"), { id: "c.floor", kind: "path", props: { points: [x - 560, y + 300, x + 560, y + 300], stroke: "ink", strokeWidth: 8 } }, { id: "c.body", kind: "path", props: { x: x - 420, y: y + 220, points: box(-80, -80, 160, 160), closed: 1, fill: "highlight", stroke: "ink", strokeWidth: 6 } }, { id: "c.hat", kind: "path", props: { x: x - 420, y: y + 118, points: [-50, 18, 0, -50, 50, 18, -50, 18], closed: 1, fill: "accent", stroke: "ink", strokeWidth: 6 } }, blob("c.coin", x + 360, y + 200, 44, "accent")] });
    steps.push({ at: t, play: [{ behavior: "attach", target: "c.hat", args: { to: "c.body", lag: 4 } }, { behavior: "hop", target: "c.body", args: { x: x - 100, height: 260, frames: 44 } }] });
    steps.push({ at: t + 50, play: [{ behavior: "hop", target: "c.body", args: { x: x + 180, height: 200, frames: 40 } }] });
    steps.push({ at: t + 70, play: [{ behavior: "arc", target: "c.coin", args: { x: x - 500, y: y - 120, bend: 0.45, frames: 50, ease: "smooth" } }] });
  }

  // 3. A planet system: a moon orbits something that is itself moving, along a curved path.
  {
    const [x, y, t] = [cx(3), cy(3), open(3)];
    const route = [x - 560, y + 200, x - 240, y - 280, x + 80, y + 280, x + 560, y - 120];
    steps.push({ at: 0, enter: "none", add: [title("d.title", x, y - 400, "Path, orbit, line trail"), { id: "d.route", kind: "path", props: { points: route, smooth: 1, stroke: "ink", strokeWidth: 4, opacity: 0.3 } }, blob("d.planet", x - 560, y + 200, 62, "highlight"), blob("d.moon", x - 450, y + 200, 22, "accent")] });
    steps.push({ at: t, play: [{ behavior: "follow", target: "d.planet", args: { path: "d.route", frames: 130, ease: "smooth" } }, { behavior: "orbit", target: "d.moon", args: { around: "d.planet", turns: 3, frames: 130 } }, { behavior: "trail", target: "d.moon", args: { mode: "line", length: 22, frames: 130, color: "accent", width: 6 } }] });
  }

  // 4. Water and rope: ripples, a wave through a crowd of parts, a bump along a line.
  {
    const [x, y, t] = [cx(4), cy(4), open(4)];
    const dots: NodeSpec[] = [];
    for (let row = 0; row < 5; row++) for (let col = 0; col < 13; col++) dots.push(blob(`e.dot.${row}x${col}`, x - 540 + col * 90, y - 200 + row * 75, 20, "highlight", { strokeWidth: 4 }));
    steps.push({ at: 0, enter: "none", add: [title("e.title", x, y - 400, "Stagger, ripple, wave"), ...dots, { id: "e.rope", kind: "path", props: { points: [x - 560, y + 300, x + 560, y + 300], stroke: "accent", strokeWidth: 10 } }, blob("e.src", x, y + 40, 12, "accent")] });
    steps.push({ at: t, play: [{ behavior: "stagger", target: "e.dot.*", args: { use: "pulse", order: "x", gap: 1.2, size: 1.5, frames: 22 } }] });
    steps.push({ at: t + 45, play: [{ behavior: "ripple", target: "e.src", args: { count: 3, size: 420, frames: 60, width: 8 } }, { behavior: "wave", target: "e.dot.*", args: { from: "e.src", speed: 9, size: 34, cycles: 1.5, period: 22 } }, { behavior: "wave", target: "e.rope", args: { size: 70, frames: 70, ease: "smooth" } }] });
  }

  // 5. A network: color spreads by real distance while numbers count.
  {
    const [x, y, t] = [cx(5), cy(5), open(5)];
    const nodes = [{ id: "A", x: -560, y: -60 }, { id: "B", x: -240, y: -250 }, { id: "C", x: -240, y: 170 }, { id: "D", x: 110, y: -60 }, { id: "E", x: 110, y: 290 }, { id: "F", x: 470, y: -230 }, { id: "G", x: 470, y: 170 }];
    const edges = [["A", "B"], ["A", "C"], ["B", "D"], ["C", "D"], ["C", "E"], ["D", "F"], ["D", "G"], ["E", "G"]].map(([from, to]) => ({ id: `${from}${to}`, from: from!, to: to! }));
    steps.push({ at: 0, enter: "none", add: [title("f.title", x, y - 400, "Color spreading, counting"), { id: "f.g", kind: "graph", props: { x, y }, data: { nodes, edges, radius: 52 } }, { id: "f.n", kind: "text", props: { x: x + 640, y: y + 400, text: "0", size: 76, color: "accent", weight: 700 } }] });
    steps.push({ at: t, play: [{ behavior: "spread", target: part.node("f.g", "A"), args: { through: "f.g.**", color: "accent", speed: 14 } }, { behavior: "count", target: "f.n", args: { to: 1280000, frames: 120, sep: 1 } }] });
  }

  // 6. Coins gathering into one bar, then a hard wipe across a poster.
  {
    const [x, y, t] = [cx(6), cy(6), open(6)];
    const coins = [[-400, -160], [-160, 200], [120, -220], [380, 160], [-420, 180], [400, -200]].map(([dx, dy], i) => blob(`g.coin.${i}`, x + dx!, y + dy!, 56 + i * 8, i % 2 ? "accent" : "highlight"));
    steps.push({ at: 0, enter: "none", add: [title("g.title", x, y - 420, "Many merge into one"), ...coins, { id: "g.bar", kind: "path", props: { x, y, points: box(-260, -130, 520, 260), closed: 1, fill: "highlight", stroke: "ink", strokeWidth: 8, opacity: 0 } }] });
    steps.push({ at: t + 6, play: [{ behavior: "merge", target: "g.coin.*", args: { into: "g.bar", frames: 56 } }] });
    steps.push({ at: t + 72, play: [{ behavior: "squash", target: "g.bar", args: { amount: 0.25, frames: 26 } }] });
  }

  // 7. A wipe reveals a drawing and an overlapped move ends the film: all changes on one part at once.
  {
    const [x, y, t] = [cx(7), cy(7), open(7)];
    steps.push({ at: 0, enter: "none", add: [title("h.title", x, y - 420, "Wipe, overlapping moves"), { id: "h.sign", kind: "group", props: { x: x - 380, y: y - 60 } }, { id: "h.sign.plate", kind: "path", parent: "h.sign", props: { points: box(-300, -180, 600, 360), closed: 1, fill: "highlight", stroke: "ink", strokeWidth: 8 } }, { id: "h.sign.mark", kind: "path", parent: "h.sign", props: { points: star(5, 130, 55), closed: 1, fill: "accent", stroke: "ink", strokeWidth: 6 } }, blob("h.a", x + 300, y + 280, 80), blob("h.b", x + 300, y - 240, 60, "highlight")] });
    steps.push({ at: t + 4, play: [{ behavior: "wipe", target: "h.sign", args: { angle: 20, frames: 44 } }] });
    steps.push({ at: t + 20, move: { frames: 60, blend: "add", ease: "smooth" }, set: { "h.a": { x: x + 620 } } });
    steps.push({ at: t + 40, move: { frames: 60, blend: "add", ease: "smooth" }, set: { "h.a": { y: y - 40 } } });
    steps.push({ at: t + 50, play: [{ behavior: "shake", target: "h.a", args: { prop: "y", size: 24 } }, { behavior: "spring", target: "h.b", args: { y: y + 100, damping: 7, stiffness: 120 } }] });
  }

  // The camera: one move per world, with a slow push-in on each, a tilt and a pull-back to see the whole wall.
  panes.forEach((_, i) => {
    if (i) steps.push({ at: open(i) - 18, move: { frames: 24, ease: "smooth" }, set: look(i) });
    steps.push({ at: open(i) + 10, move: { frames: 90, ease: "smooth" }, set: { camera: { zoom: 1.06 } } });
    steps.push({ at: open(i) + 110, move: { frames: 24, ease: "smooth" }, set: { camera: { zoom: 1 } } });
  });
  steps.push({ at: open(4) + 40, move: { frames: 40, ease: "smooth" }, set: { camera: { tilt: -2.5 } } });
  steps.push({ at: open(4) + 100, move: { frames: 30, ease: "smooth" }, set: { camera: { tilt: 0 } } });
  const end = open(panes.length);
  steps.push({ at: end, move: { frames: 50, ease: "smooth" }, set: { camera: { panX: W * 1.5, panY: H * 1.5, zoom: 0.33 } } });
  return { steps, frames: end + 90 };
}

const [out, ...styles] = process.argv.slice(2);
if (!out || !styles.length) throw new Error("usage: motion.ts <outDir> <style> [<style> ...]");
const { steps, frames } = scene();
const serveUrl = await bundled(resolve("engine/render/preview.tsx"));
for (const name of styles) {
  const theme = themeFrom(name);
  const t = Date.now();
  const built = compile({ steps }, { fps: 30, width: W, height: H, frames, theme, kits: [graphKit] });
  const compiled = Date.now() - t;
  const inputProps = { scene: built, theme };
  const composition = await selectComposition({ serveUrl, id: "Scene", inputProps });
  const t0 = Date.now();
  await renderMedia({ serveUrl, composition, inputProps, codec: "h264", imageFormat: "jpeg", concurrency: 2, crf: 23, outputLocation: join(out, `motion-${name}.mp4`) });
  const keys = built.tracks.reduce((s, x) => s + x.keys.length, 0);
  console.log(`${name}: ${(frames / 30).toFixed(1)} s, ${built.nodes.length} parts, ${built.tracks.length} tracks, ${keys} keys, ${(JSON.stringify(built).length / 1e6).toFixed(1)} MB, compiled in ${compiled} ms, rendered in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
