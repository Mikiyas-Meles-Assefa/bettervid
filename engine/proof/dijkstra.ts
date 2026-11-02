// Proof of the foundation: a scene built only from what the real algorithm did, with no model involved. It shows that
// a kit's parts animate one by one, that truth drives motion, and that one scene renders in any style.
// Usage: node --experimental-strip-types engine/proof/dijkstra.ts <outDir> <style> [<style> ...]
import { join, resolve } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { compile } from "../core/compile.ts";
import type { NodeSpec, Step } from "../core/types.ts";
import { graphKit, part } from "../kits/graph.ts";
import { themeFrom } from "../render/theme.ts";
import { dijkstra, type Edge } from "../truth/dijkstra.ts";

const NODES = [
  { id: "A", x: 170, y: 560 }, { id: "B", x: 540, y: 330 }, { id: "C", x: 540, y: 800 },
  { id: "D", x: 910, y: 360 }, { id: "E", x: 910, y: 800 }, { id: "F", x: 540, y: 1220 },
];
const EDGES: Edge[] = [
  { id: "AB", from: "A", to: "B", weight: 4 }, { id: "AC", from: "A", to: "C", weight: 2 }, { id: "BC", from: "B", to: "C", weight: 1 },
  { id: "BD", from: "B", to: "D", weight: 5 }, { id: "CE", from: "C", to: "E", weight: 8 }, { id: "CF", from: "C", to: "F", weight: 10 },
  { id: "DE", from: "D", to: "E", weight: 2 }, { id: "EF", from: "E", to: "F", weight: 3 },
];
const G = "g";
const log = dijkstra(NODES.map((n) => n.id), EDGES, "A", "F");
const distId = (n: string) => `dist.${n}`;
const distAt = (n: (typeof NODES)[number]) => ({ x: n.x, y: n.y - 96 });

function scene(): { steps: Step[]; frames: number } {
  const steps: Step[] = [];
  let t = 10;
  steps.push({ at: t, enter: "draw", move: { frames: 30 }, add: [{ id: G, kind: "graph", data: { nodes: NODES, edges: EDGES } }] });
  const marks: NodeSpec[] = NODES.map((n) => ({ id: distId(n.id), kind: "text", props: { ...distAt(n), text: "?", size: 54, color: "accent", weight: 700 } }));
  steps.push({ at: (t += 40), add: marks });
  t += 22;
  for (const e of log) {
    if (e.type === "start") {
      steps.push({ at: t, set: { [distId(e.node!)]: { text: "0" } }, play: [{ behavior: "pulse", target: part.node(G, e.node!) }] });
      t += 22;
    } else if (e.type === "visit") {
      steps.push({ at: t, set: { [part.node(G, e.node!)]: { fill: "accent" }, [part.label(G, e.node!)]: { color: "paper" } }, play: [{ behavior: "pulse", target: part.node(G, e.node!) }], emit: [{ name: "visit" }] });
      t += 22;
    } else if (e.type === "relax") {
      const edge = part.edge(G, e.edge!);
      steps.push({ at: t, play: [{ behavior: "flow", target: edge, args: { color: e.better ? "accent" : "ink", frames: 20 } }] });
      t += 20;
      steps.push({ at: t, ...(e.better ? { set: { [distId(e.node!)]: { text: String(e.dist) } }, play: [{ behavior: "pulse", target: distId(e.node!) }] } : { play: [{ behavior: "shake", target: distId(e.node!), args: { size: 10 } }] }) });
      t += 14;
    } else if (e.type === "done") {
      t += 14;
      const dim = Object.fromEntries(EDGES.filter((x) => !e.edges!.includes(x.id)).map((x) => [part.edge(G, x.id), { opacity: 0.18 }]));
      steps.push({ at: t, set: dim });
      t += 20;
      for (const id of e.edges!) {
        steps.push({ at: t, set: { [part.edge(G, id)]: { stroke: "accent", strokeWidth: 16 } } });
        t += 16;
      }
      steps.push({ at: t + 8, add: [{ id: "total", kind: "text", props: { x: 540, y: 1520, size: 130, weight: 700, text: `Shortest: ${e.total}`, color: "ink" } }], enter: "pop" });
      t += 80;
    }
  }
  return { steps, frames: t };
}

const [out, ...styles] = process.argv.slice(2);
const { steps, frames } = scene();
const serveUrl = await bundle({ entryPoint: resolve("engine/render/preview.tsx") });
for (const name of styles) {
  const theme = themeFrom(name);
  const built = compile({ steps }, { fps: 30, width: 1080, height: 1920, frames, theme, kits: [graphKit] });
  const inputProps = { scene: built, theme };
  const composition = await selectComposition({ serveUrl, id: "Scene", inputProps });
  const t0 = Date.now();
  await renderMedia({ serveUrl, composition, inputProps, codec: "h264", imageFormat: "jpeg", concurrency: 2, crf: 23, outputLocation: join(out!, `${name}.mp4`) });
  console.log(`${name}: ${(frames / 30).toFixed(1)} s, ${built.nodes.length} parts, ${built.tracks.length} tracks, rendered in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
console.log(JSON.stringify(log.at(-1)));
