// Puts before and after frames side by side: every JPEG in <before> with the same name in <after> becomes one image
// in <out>, before on the left. Usage: node --experimental-strip-types scripts/pair-frames.ts <before> <after> <out>
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

const [before, after, out] = process.argv.slice(2);
if (!before || !after || !out) throw new Error("usage: pair-frames.ts <before> <after> <out>");
mkdirSync(out, { recursive: true });
for (const f of readdirSync(before).filter((x) => x.endsWith(".jpg"))) {
  if (!existsSync(join(after, f))) continue;
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", join(before, f), "-i", join(after, f), "-filter_complex", "hstack=inputs=2", "-q:v", "3", join(out, f)]);
  console.log(join(out, f));
}
