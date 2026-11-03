// The picture reader: an agent (role "reader") looks at one of the user's pictures (a slide, a chart, a photo, a
// screenshot, a sketch, a diagram, a map, a page) and returns what it is, its named parts with boxes, the words in it
// and, for a chart, its data. Code then checks the reading against the picture where it can (check.ts), and any
// problem goes back to the reader to repair.
import type { AgentTask, Box, ChartData, PartCard } from "../types.ts";
import type { MaterialFile } from "./files.ts";

const box = { type: "array", items: { type: "number" }, minItems: 4, description: "x0, y0, x1, y1 as fractions of the picture's width and height (0 top left, 1 bottom right)" };

export const pictureSchema = {
  type: "object",
  required: ["kind", "about", "parts", "words"],
  properties: {
    kind: { type: "string", description: "what the picture is, in one or two words of your own" },
    about: { type: "string", description: "what it shows and what it is for, in one or two plain sentences, with the numbers it states" },
    parts: {
      type: "object",
      description: "the parts a video could point at, show alone, move or redraw, keyed by a short lowercase name of your own (letters, digits, dashes)",
      additionalProperties: {
        type: "object",
        required: ["box", "about"],
        properties: { box, about: { type: "string" }, text: { type: "string", description: "the words or numbers written in this part, exactly as written" } },
      },
    },
    words: { type: "array", items: { type: "string" }, description: "every piece of text in the picture, exactly as written, in reading order" },
    data: {
      type: "object",
      description: "only for a chart or a table drawn in the picture: the data it shows",
      required: ["kind", "labels", "values"],
      properties: {
        kind: { type: "string", description: "bars, line, pie, table, or your own word" },
        orient: { type: "string", enum: ["v", "h"], description: "bars standing up (v) or lying along (h)" },
        title: { type: "string" },
        labels: { type: "array", items: { type: "string" } },
        values: { type: "array", items: { type: "number" } },
        unit: { type: "string" },
        ymax: { type: "number", description: "the value at the far end of the value axis (the plot's edge), not the largest value" },
        plot: { ...box, description: "the plot area: where the value axis starts and ends and where the bars or points sit" },
        barFrac: { type: "number", description: "a bar's thickness as a share of its slot (the plot's length across the bars divided by the number of bars)" },
        total: { type: "number", description: "a total the picture itself states, if it states one" },
        parts: { type: "array", items: { type: "string" }, description: "for each label, in order, the name of the part that is its bar, point or slice" },
        texts: { type: "object", additionalProperties: { type: "string" }, description: "other text the chart carries, by part name" },
      },
    },
  },
} as const;

export type PictureAnswer = { kind: string; about: string; parts: Record<string, { box: Box; about: string; text?: string }>; words: string[]; data?: ChartData };

export const READER_SYSTEM = `You read one picture a person gave for a video made from their own material. The video's planner and designer will use your reading to show the picture, point at its parts, cut parts out, zoom into them, or redraw a chart from its data so it can move. They cannot see the picture themselves, so your reading must be exact and complete.

Look at the whole picture first, then at every part. Return:
- what kind of picture it is and what it shows, with the numbers it states;
- its parts: every piece a video could point at or show alone (a title, a heading, a label, a value, a bar, a line, a legend, a region of a photo, an object, a person, a panel of a screenshot, a step of a sketch). Name each part with a short lowercase word of your own. Give each a box as fractions of the picture (x0, y0, x1, y1; 0,0 is the top left corner, 1,1 the bottom right), tight around what you see, and the exact words written in it, if any;
- every piece of text in the picture, exactly as written (spelling, numbers, capitals), in reading order;
- for a chart or a table drawn in the picture, its data: the labels and values in order, the orientation, the plot area's box, the value at the end of the value axis, a bar's thickness as a share of its slot, a total if the picture states one, and the part that is each value's bar or point.

Measure, do not guess: boxes are where the pixels are (if you can run code, measure them on the picture itself). A value you read off an axis rather than a printed number is your best reading, and you say so in the part's about. Never add what is not in the picture.`;

export function pictureTask(f: MaterialFile, id = `read.${f.name}`): AgentTask {
  const size = f.size ? `${f.size[0]} by ${f.size[1]} pixels` : "size unknown";
  return {
    role: "reader",
    id,
    system: READER_SYSTEM,
    request: `The picture: ${f.file} (${size}), called "${f.name}" in the project.${f.about ? ` The person said about it: ${f.about}` : ""}\n\nRead it as the system says.`,
    schema: pictureSchema as unknown as Record<string, unknown>,
    images: f.path ? [f.path] : [],
  };
}

/** The task again, with the last reading and what the check found wrong with it. */
export function repairTask(task: AgentTask, last: unknown, problems: string[], round: number): AgentTask {
  return {
    ...task,
    id: `${task.id.replace(/\.r\d+$/, "")}.r${round}`,
    request: `${task.request}\n\nYour last answer:\n\`\`\`json\n${JSON.stringify(last, null, 1)}\n\`\`\`\n\nA check of that answer against its source found these problems:\n${problems.map((p) => `- ${p}`).join("\n")}\n\nLook at the source again and return the whole answer, corrected. Keep what was right.`,
  };
}

export function cardFromPicture(f: MaterialFile, a: PictureAnswer): PartCard {
  return {
    name: f.name,
    file: f.file,
    ...(f.size ? { size: f.size } : {}),
    kind: a.kind,
    about: a.about,
    parts: a.parts,
    ...(a.data ? { data: a.data } : {}),
    text: (a.words ?? []).join("\n"),
    requirements: [],
    checked: { ok: false, notes: [] },
  };
}
