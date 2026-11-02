// S14: can Spark see what is wrong in a frame? Each labelled frame goes to Spark under one condition (image size, one
// frame or a short run of frames, prompt framing) and the problems it names are graded against the labels.
// node --env-file=.env --experimental-strip-types scripts/spikes/s14-can-spark-see.ts <condition...> [--only id,id] [--cap 2]
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { json } from "../../pipeline/lib/meta.ts";
import { FRAMES, PROJECTS, type Frame, type Kind } from "./s14-frames.ts";

const KINDS: Kind[] = ["faint_text", "text_overlap", "cut_off", "too_small", "empty_space", "washed_out", "blank_or_broken", "subject_missing", "wrong_picture", "says_other_than_words", "unsourced_or_wrong_fact", "ugly"];
const MEDIA = join(process.cwd(), "media/spikes/s14");
const OUT = join(MEDIA, "runs");
mkdirSync(OUT, { recursive: true });

// batch: several frames of one video in one call, as the look step sends them. source: the scene text is shown too, as
// the look step shows Spark the scene it wrote.
type Condition = { width: number; seq: boolean; framing: "plain" | "demanding" | "checklist"; batch?: boolean; source?: boolean };
const CONDITIONS: Record<string, Condition> = {
  batchSmallSource: { width: 432, seq: false, framing: "plain", batch: true, source: true }, // closest to the look step today
  batchSmall: { width: 432, seq: false, framing: "plain", batch: true },
  batchFullDemanding: { width: 1080, seq: false, framing: "demanding", batch: true },
  small: { width: 432, seq: false, framing: "plain" }, // what the look step does today
  full: { width: 1080, seq: false, framing: "plain" },
  smallDemanding: { width: 432, seq: false, framing: "demanding" },
  fullDemanding: { width: 1080, seq: false, framing: "demanding" },
  fullChecklist: { width: 1080, seq: false, framing: "checklist" },
  seqDemanding: { width: 720, seq: true, framing: "demanding" },
};

const FRAMING = {
  plain: `Look at this frame from a vertical explainer video as a viewer holding a phone would, with the narration in their ears. Judge whether it shows what the words say, whether every piece of writing can be read, whether anything is too small, crowded, overlapping or covered, and whether the screen is emptier or busier than the idea deserves. List the problems you see. If it works, return no problems.`,
  demanding: `You are a demanding designer and a demanding teacher signing off one frame of a vertical explainer video before it is published. A viewer sees it once on a phone, with the narration in their ears. Look at the actual pixels, region by region, top to bottom, and read every piece of writing on screen. Report every fault a top creator would fix: writing that is faint, low in contrast, written over other writing or over a busy picture, cut by the frame edge, or too small to read on a phone; cards, panels or pictures that are blank or show nothing; a picture cropped so its subject is not visible, or the wrong kind of picture; marks that point at nothing; large empty areas; a greyed or washed-out look; writing that says something other than the narration at that moment, or a fact, number or formula that is wrong or not backed by the facts given. Then judge the design: does this frame look good, deliberate and of one style? Do not invent faults you cannot point to in the frame. A frame that is fine gets no problems.`,
  checklist: `Answer for this frame of a vertical explainer video, as a demanding designer and teacher, by looking at the pixels. For each problem kind below, decide whether it is present, and if so say exactly where and what:
- faint_text: writing too faint or low in contrast against what is behind it
- text_overlap: writing over other writing, or over a busy picture, so it is hard to read
- cut_off: anything cut by the frame edge
- too_small: anything that matters too small to read on a phone
- empty_space: a large empty area while the idea needs room
- washed_out: the frame looks greyed, faded or dimmed overall
- blank_or_broken: a card, panel or picture showing nothing, or a mark pointing at nothing
- subject_missing: a picture cropped or covered so its subject is not visible
- wrong_picture: the wrong kind of picture, or one that clashes with the others in style
- says_other_than_words: writing that contradicts what is being said
- unsourced_or_wrong_fact: a fact, number or formula that is wrong or not backed by the facts given
- ugly: does not look designed or does not fit its style
Report only the kinds that are present.`,
};

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["problems", "looks", "lookNote"],
  properties: {
    problems: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["kind", "where", "what"], properties: { kind: { type: "string", enum: KINDS }, where: { type: "string" }, what: { type: "string" } } },
    },
    looks: { type: "integer", description: "1 ugly to 5 beautiful, as design" },
    lookNote: { type: "string" },
  },
} as const;

type Reply = { problems: { kind: Kind; where: string; what: string }[]; looks: number; lookNote: string };

const projects = new Map<string, any>();
function project(key: string) {
  if (!projects.has(key)) projects.set(key, JSON.parse(readFileSync(join(process.cwd(), "projects", PROJECTS[key as keyof typeof PROJECTS], "project.json"), "utf8")));
  return projects.get(key);
}

function context(f: Frame): string {
  const p = project(f.project);
  const words = p.narration.words as { text: string; start: number }[];
  const before = words.filter((w) => w.start > f.t - 8 && w.start <= f.t - 1.5).map((w) => w.text).join(" ");
  const now = words.filter((w) => w.start > f.t - 1.5 && w.start <= f.t + 0.5).map((w) => w.text).join(" ");
  const claims = (p.factSheet?.claims ?? []).map((c: { text: string }) => `- ${c.text}`).join("\n");
  return `Video: ${p.plan?.topic ?? p.input.prompt}. Visual style: ${p.input.style}.\nResearch facts the video is built on:\n${claims}\n\nNarration just before: "${before}"\nBeing said at this moment: "${now}"`;
}

function image(f: Frame, tag: string, width: number): string {
  const src = join(MEDIA, `${f.id}-${tag}.jpg`);
  const out = join(MEDIA, `w${width}`, `${f.id}-${tag}.jpg`);
  mkdirSync(join(MEDIA, `w${width}`), { recursive: true });
  if (!existsSync(out)) execFileSync("ffmpeg", ["-y", "-v", "error", "-i", src, "-vf", `scale=${width}:-2`, "-q:v", "3", out]);
  return `data:image/jpeg;base64,${readFileSync(out).toString("base64")}`;
}

const SAME: Partial<Record<Kind, Kind[]>> = {
  faint_text: ["washed_out"],
  washed_out: ["faint_text"],
  subject_missing: ["wrong_picture", "blank_or_broken"],
  says_other_than_words: ["unsourced_or_wrong_fact"],
  unsourced_or_wrong_fact: ["says_other_than_words"],
};

// A labelled problem is caught when Spark names its kind or a close one; "ugly" is also caught by a looks score of 2 or less.
export function grade(f: Frame, r: Reply) {
  const named = new Set(r.problems.map((x) => x.kind));
  const caught = f.problems.filter((k) => named.has(k) || (SAME[k] ?? []).some((s) => named.has(s)) || (k === "ugly" && r.looks <= 2));
  const allowed = new Set([...f.problems, ...f.problems.flatMap((k) => SAME[k] ?? []), "empty_space" as Kind]);
  const extra = r.problems.filter((x) => !allowed.has(x.kind));
  return { caught, missed: f.problems.filter((k) => !caught.includes(k)), extra };
}

async function main() {
  const args = process.argv.slice(2);
  const cap = Number(args[args.indexOf("--cap") + 1] || 2);
  const only = args.includes("--only") ? args[args.indexOf("--only") + 1]!.split(",") : undefined;
  const names = args.filter((a, i) => CONDITIONS[a] && args[i - 1] !== "--cap");
  const ledger = join(OUT, "spend.jsonl");
  let spent = existsSync(ledger) ? readFileSync(ledger, "utf8").trim().split("\n").filter(Boolean).reduce((a, l) => a + JSON.parse(l).usd, 0) : 0;
  for (const name of names) {
    const c = CONDITIONS[name]!;
    const file = join(OUT, `${name}.json`);
    const done: Record<string, Reply & { usd: number; tokens: number }> = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
    if (c.batch) {
      spent += await batched(name, c, done, file, ledger, cap - spent);
      console.log(`spent so far $${spent.toFixed(3)}`);
      continue;
    }
    const todo = FRAMES.filter((f) => !done[f.id] && (!only || only.includes(f.id)));
    await Promise.all(Array.from({ length: 4 }, async () => {
      for (let f = todo.shift(); f; f = todo.shift()) {
        if (spent > cap) return;
        const images = c.seq
          ? [{ type: "input_text", text: "Three frames, 1.2 s apart, in order. Judge the middle one, using the others to see what is arriving or leaving." }, ...["a", "b", "c"].map((t) => ({ type: "input_image", image_url: image(f!, t, c.width) }))]
          : [{ type: "input_image", image_url: image(f, "b", c.width) }];
        try {
          const r = await json<Reply>({ system: FRAMING[c.framing], user: [{ type: "input_text", text: context(f) }, ...images], schema, schemaName: "frame_check", effort: "medium" });
          spent += r.usd;
          appendFileSync(ledger, JSON.stringify({ at: new Date().toISOString(), condition: name, frame: f.id, usd: r.usd, input: r.raw.usage?.input_tokens }) + "\n");
          done[f.id] = { ...r.value, usd: r.usd, tokens: r.raw.usage?.input_tokens ?? 0 };
          writeFileSync(file, JSON.stringify(done, null, 1));
          const g = grade(f, r.value);
          console.log(`${name} ${f.id}: caught ${g.caught.join(",") || "-"} | missed ${g.missed.join(",") || "-"} | extra ${g.extra.map((x) => x.kind).join(",") || "-"} | looks ${r.value.looks} | $${r.usd.toFixed(4)} ${r.raw.usage?.input_tokens} in`);
        } catch (e) {
          console.log(`${name} ${f.id}: FAILED ${(e as Error).message.slice(0, 200)}`);
        }
      }
    }));
    console.log(`spent so far $${spent.toFixed(3)}`);
  }
  summary();
}

const batchSchema = {
  type: "object",
  additionalProperties: false,
  required: ["frames"],
  properties: { frames: { type: "array", items: { type: "object", additionalProperties: false, required: ["frame", ...schema.required], properties: { frame: { type: "integer" }, ...schema.properties } } } },
} as const;

// Frames of one video in groups of up to 5, in time order, in one call each.
async function batched(name: string, c: Condition, done: Record<string, Reply & { usd: number; tokens: number }>, file: string, ledger: string, left: number): Promise<number> {
  let usd = 0;
  for (const key of Object.keys(PROJECTS)) {
    const list = FRAMES.filter((f) => f.project === key && !done[f.id]).sort((a, b) => a.t - b.t);
    for (let i = 0; i < list.length; i += 5) {
      if (usd > left) return usd;
      const group = list.slice(i, i + 5);
      const p = project(key);
      const words = p.narration.words as { text: string; start: number }[];
      const claims = (p.factSheet?.claims ?? []).map((x: { text: string }) => `- ${x.text}`).join("\n");
      const sections = (p.scene?.sections ?? []).filter((s: any) => group.some((f) => { const k = words.findLastIndex((w) => w.start <= f.t); return k >= s.firstWord && k <= s.lastWord; }));
      const head = `Video: ${p.plan?.topic ?? p.input.prompt}. Visual style: ${p.input.style}.\nResearch facts the video is built on:\n${claims}${c.source ? `\n\nThe scene written for these moments:\n${sections.map((s: any) => s.source).join("\n")}` : ""}`;
      const content: unknown[] = [{ type: "input_text", text: head }];
      group.forEach((f, k) => {
        const now = words.filter((w) => w.start > f.t - 4 && w.start <= f.t + 0.5).map((w) => w.text).join(" ");
        content.push({ type: "input_text", text: `Frame ${k + 1}, at ${f.t.toFixed(1)} s. Words just said: "${now}"` });
        content.push({ type: "input_image", image_url: image(f, "b", c.width) });
      });
      content.push({ type: "input_text", text: "Answer once per frame, with its number." });
      try {
        const r = await json<{ frames: (Reply & { frame: number })[] }>({ system: FRAMING[c.framing], user: content, schema: batchSchema, schemaName: "frames_check", effort: "medium" });
        usd += r.usd;
        appendFileSync(ledger, JSON.stringify({ at: new Date().toISOString(), condition: name, frame: group.map((f) => f.id).join(","), usd: r.usd, input: r.raw.usage?.input_tokens }) + "\n");
        for (const x of r.value.frames) {
          const f = group[x.frame - 1];
          if (!f) continue;
          done[f.id] = { ...x, usd: r.usd / group.length, tokens: (r.raw.usage?.input_tokens ?? 0) / group.length };
          const g = grade(f, x);
          console.log(`${name} ${f.id}: caught ${g.caught.join(",") || "-"} | missed ${g.missed.join(",") || "-"} | extra ${g.extra.map((y) => y.kind).join(",") || "-"} | looks ${x.looks}`);
        }
        writeFileSync(file, JSON.stringify(done, null, 1));
      } catch (e) {
        console.log(`${name} ${key} group ${i / 5 + 1}: FAILED ${(e as Error).message.slice(0, 200)}`);
      }
    }
  }
  return usd;
}

export function summary() {
  const rows: string[] = ["| Condition | Recall | Caught / labelled | Extra kinds named (all frames) | Extra on clean frames | Clean frames passed | Looks: wright / stats / merge | Cost |", "|---|---|---|---|---|---|---|---|"];
  for (const name of Object.keys(CONDITIONS)) {
    const file = join(OUT, `${name}.json`);
    if (!existsSync(file)) continue;
    const done = JSON.parse(readFileSync(file, "utf8")) as Record<string, Reply & { usd: number }>;
    let caught = 0, labelled = 0, extra = 0, cleanExtra = 0, cleanOk = 0, clean = 0, usd = 0;
    const looks: Record<string, number[]> = { wright: [], stats: [], merge: [] };
    for (const f of FRAMES) {
      const r = done[f.id];
      if (!r) continue;
      const g = grade(f, r);
      caught += g.caught.length;
      labelled += f.problems.length;
      extra += g.extra.length;
      usd += r.usd;
      looks[f.project]!.push(r.looks);
      if (!f.problems.length) {
        clean++;
        cleanExtra += g.extra.length;
        if (!g.extra.length) cleanOk++;
      }
    }
    const avg = (xs: number[]) => (xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) : "-");
    rows.push(`| ${name} | ${labelled ? (caught / labelled).toFixed(2) : "-"} | ${caught} / ${labelled} | ${extra} | ${cleanExtra} | ${cleanOk} / ${clean} | ${avg(looks.wright!)} / ${avg(looks.stats!)} / ${avg(looks.merge!)} | $${usd.toFixed(3)} |`);
  }
  console.log(rows.join("\n"));
}

if (process.argv[1]?.endsWith("s14-can-spark-see.ts")) main();
