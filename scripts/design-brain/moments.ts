// Three short moments of very different uses, none from the test topics, with invented word times (as engine/language/trial.ts).
// Usage: node --experimental-strip-types scripts/design-brain/moments.ts   (writes projects/design-brain/<name>/request.json and the baseline prompt)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const OUT = process.env.OUT ?? "projects/design-brain";
export const STYLE = process.env.STYLE ?? "flat";

export const MOMENTS: Record<string, { topic: string; script: string; material?: boolean }> = {
  interest: {
    topic: "Why money grows faster than you expect (a one-minute personal finance short)",
    script: `Put one hundred dollars away at ten percent a year. After one year you have one hundred ten. The next year you earn ten percent of one hundred ten, so you reach one hundred twenty one. How many years until it doubles? Most people guess ten. It takes about seven. The interest starts earning interest.`,
  },
  press: {
    topic: "How the printing press changed who could own a book (a history short)",
    script: `Before the printing press, one scribe needed about a year to copy a single Bible by hand. Gutenberg's workshop printed about one hundred eighty copies in roughly three years. That is sixty books a year from one shop. A book stopped being a treasure for a monastery, and became something a merchant could own.`,
  },
  charger: {
    topic: "A product ad for Pulse, a small fast phone charger (a 15 second social ad)",
    script: `Your old charger wastes almost a third of its power as heat. Pulse turns ninety four percent of it into charge. So a dead phone is full in thirty minutes, not ninety. Smaller. Cooler. Faster. Pulse.`,
  },
  // Built on the user's own material: a plain chart they exported (scripts/design-brain/material.py makes the stand-in).
  signups: {
    topic: "A founder's update for their team, made from their own signup chart (a short internal video)",
    script: `Here is our signup chart for the last twelve weeks. For eight weeks it barely moved, about forty a week. Then in week nine we added a free trial. Signups jumped to around one hundred twenty a week. Three times as many, from one change.`,
    material: true,
  },
};

export function words(script: string) {
  let t = 0.3;
  return script.trim().split(/\s+/).map((text) => {
    const w = { text, start: Math.round(t * 100) / 100 };
    t += 0.28 + text.length * 0.018 + (/[.?!]$/.test(text) ? 0.45 : /[,:;]$/.test(text) ? 0.18 : 0);
    return w;
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { languagePrompt, requestText } = await import("../../engine/language/author.ts");
  const { loadLibrary } = await import("../../engine/language/library.ts");
  const { themeFrom } = await import("../../engine/render/theme.ts");
  const { SCENE_KITS } = await import("../../pipeline/stages/scene.ts");
  const theme = themeFrom(STYLE);
  for (const [name, m] of Object.entries(MOMENTS)) {
    const w = words(m.script);
    const frames = Math.ceil((w.at(-1)!.start + 1.5) * 30);
    const dir = join(OUT, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "request.json"), JSON.stringify({ topic: m.topic, words: w, frames }, null, 1));
    const ctx = { fps: 30, width: 1080, height: 1920, frames, theme, words: w, kits: SCENE_KITS };
    // The user's material: each file is offered by name, with what an analysis found in it (its named parts).
    type Material = Record<string, { file: string; size: number[]; about: string; parts: Record<string, { box: number[]; about: string }> }>;
    const material: Material = m.material ? JSON.parse(readFileSync(join(dir, "material.json"), "utf8")) : {};
    const assets = Object.fromEntries(Object.entries(material).map(([k, v]) => [k, v.file]));
    if (m.material) writeFileSync(join(dir, "request.json"), JSON.stringify({ topic: m.topic, words: w, frames, assets }, null, 1));
    const own = (parts: (k: string, p: string, q: { box: number[]; about: string }) => string) =>
      m.material ? `The user's own material, to use: ${Object.entries(material).map(([k, v]) => `${k} (${v.about}, ${v.size[0]} by ${v.size[1]} px). Its parts: ${Object.entries(v.parts).map(([p, q]) => parts(k, p, q)).join("; ")}`).join(". ")}.` : undefined;
    const system = languagePrompt({ ctx, library: loadLibrary(), seed: 11, words: w.map((x) => x.text), assets });
    writeFileSync(join(dir, "baseline-prompt.txt"), `${system}\n\n---\n\n${requestText({ topic: m.topic, words: w, wishes: own((k, p, q) => `${p} = ${q.about}, at x0,y0,x1,y1 = ${q.box.join(",")} as fractions of the picture`) })}\n`);
    writeFileSync(join(dir, "request.txt"), `${requestText({ topic: m.topic, words: w, wishes: own((k, p, q) => `${k}.${p} (${q.about})`) })}\n`);
    console.log(`${name}: ${w.length} words, ${(frames / 30).toFixed(1)} s`);
  }
}
