// Picture choice: what the director asks for, how a missing picture is handled, the moment a picture is judged
// against, and which archive records are safe to use. No network and no model calls.
// Run: node --experimental-strip-types --test pipeline/stages/pictures.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Project, Shot } from "../../schemas/project.ts";
import { iaLicense, internetArchiveCandidate, smithsonianCandidates } from "../lib/archives.ts";
import { drawn, gapBrief, moment, realPerson } from "./assets.ts";
import { request, type Planned } from "./director.ts";

const planned = (over: Partial<Planned>): Planned => ({
  beatId: "b1", type: "photo_kenburns", startWord: 0, kind: "real", query: "", broadQuery: "", prompt: "", idea: "", draw: "",
  imageType: "scene", subject: "", focus: "", mustBeReal: false, text: "", claimId: "", ...over,
});
const shot = (over: Partial<Shot> = {}): Shot => ({ id: "shot1", beatId: "b1", type: "photo_kenburns", start: 0, end: 2, ...over });

test("a drawn shot asks for no image and is always full frame", () => {
  const s = shot({ type: "cutout_on_paper" });
  const a = request(planned({ type: "cutout_on_paper", kind: "drawn", draw: "a map of the valley with the two villages marked", query: "valley map" }), s);
  assert.equal(a.kind, "drawn");
  assert.equal(a.draw, "a map of the valley with the two villages marked");
  assert.equal(a.query, "");
  assert.equal(s.type, "photo_kenburns");
});

test("a real shot keeps its drawing as the honest fallback", () => {
  const a = request(planned({ kind: "real", query: "harbor 1850", mustBeReal: true, idea: "a quiet harbor at dusk", draw: "a timeline of the harbor's three expansions" }), shot());
  assert.equal(a.kind, "real");
  assert.equal(a.mustBeReal, true);
  assert.equal(a.idea, "a quiet harbor at dusk");
  assert.equal(a.draw, "a timeline of the harbor's three expansions");
});

test("only a real shot can be must-be-real, and an idea belongs to a must-be-real shot", () => {
  const a = request(planned({ kind: "generated", prompt: "waves on a beach", mustBeReal: true, idea: "x" }), shot());
  assert.equal(a.kind, "generated");
  assert.equal(a.mustBeReal, undefined);
  assert.equal(a.idea, undefined);
});

test("a drawn shot is marked missing too, so a path that cannot draw holds the previous picture", () => {
  const s = shot({ asset: { kind: "drawn", query: "", prompt: "", draw: "a bar chart of the three harvests" } });
  const a = drawn(s, "chosen by the director");
  assert.equal(a.missing, true);
  assert.equal(a.draw, "a bar chart of the three harvests");
  assert.equal(a.kind, "none");
  assert.equal(a.path, undefined);
});

test("a person shot with a name in the query counts as a real person, a generic one does not", () => {
  assert.equal(realPerson(shot({ asset: { kind: "real", query: "Ada Lovelace", prompt: "", subject: "woman" } })), true);
  assert.equal(realPerson(shot({ asset: { kind: "real", query: "farmer in a field", prompt: "", subject: "man" } })), false);
  assert.equal(realPerson(shot({ asset: { kind: "real", query: "Ada Lovelace", prompt: "", subject: "notebook" } })), false);
});

test("a picture is judged against the words said while it is on screen", () => {
  const text = "one two three four five six seven eight nine ten";
  const words = text.split(" ").map((t, i) => ({ text: t, start: i, end: i + 0.8, beatId: "b1" }));
  const p = { narration: { words } } as unknown as Project;
  const m = moment(p, { start: 3, end: 6 });
  assert.equal(m.now, "four five six");
  assert.equal(m.before, "one two three");
  assert.equal(m.after, "seven eight nine ten");
});

test("Smithsonian records are kept only with CC0 images large enough for a full frame", () => {
  const row = (title: string, access: string, width: number) => ({
    title,
    content: { descriptiveNonRepeating: { data_source: "Museum", record_link: `https://example.org/${title}`, online_media: { media: [{ type: "Images", idsId: `ID-${title}`, usage: { access }, resources: [{ label: "High-resolution JPEG", width, height: width }] }] } } },
  });
  const out = smithsonianCandidates({ response: { rows: [row("open", "CC0", 3000), row("closed", "Usage conditions apply", 3000), row("small", "CC0", 600), { title: "no media", content: {} }] } });
  assert.deepEqual(out.map((c) => c.title), ["open"]);
  assert.equal(out[0]!.license, "CC0");
  assert.match(out[0]!.full, /deliveryService\?id=ID-open&max=2048/);
});

test("Internet Archive items need a safe license and a large original image", () => {
  const meta = { files: [{ name: "a_thumb.jpg", format: "JPEG", size: "9000" }, { name: "a.jpg", format: "JPEG", size: "900000" }] };
  const ok = internetArchiveCandidate({ identifier: "a", title: "A", licenseurl: "https://creativecommons.org/publicdomain/zero/1.0/" }, meta);
  assert.equal(ok?.license, "CC0");
  assert.match(ok!.full, /download\/a\/a\.jpg$/);
  assert.equal(internetArchiveCandidate({ identifier: "b", licenseurl: "https://creativecommons.org/licenses/by-nc/4.0/" }, meta), null);
  assert.equal(internetArchiveCandidate({ identifier: "c", licenseurl: "https://creativecommons.org/licenses/by/4.0/" }, { files: [{ name: "c.jpg", format: "JPEG", size: "40000" }] }), null);
});

test("a gap with nothing honest to show asks the scene to draw what the words say", () => {
  const words = "the river flooded the lower town twice".split(" ").map((t, i) => ({ text: t, start: i, end: i + 0.8, beatId: "b1" }));
  const p = { narration: { words } } as unknown as Project;
  const brief = gapBrief(p, shot({ start: 1, end: 4, asset: { kind: "real", query: "lower town flood 1850", prompt: "" } }));
  assert.match(brief, /"river flooded the"/);
  assert.match(brief, /lower town flood 1850/);
  assert.match(brief, /No invented facts/);
});

test("only public domain, CC0, CC BY and CC BY-SA licenses are read as safe", () => {
  assert.equal(iaLicense("http://creativecommons.org/publicdomain/mark/1.0/"), "Public domain");
  assert.equal(iaLicense("https://creativecommons.org/licenses/by-sa/3.0/"), "CC BY-SA 3.0");
  assert.equal(iaLicense("https://creativecommons.org/licenses/by/2.0/"), "CC BY 2.0");
  assert.equal(iaLicense("https://creativecommons.org/licenses/by-nd/4.0/"), null);
  assert.equal(iaLicense(""), null);
});
