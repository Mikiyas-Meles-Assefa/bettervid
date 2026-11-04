import type { Project } from "../../schemas/project.ts";
import { KIT } from "./kit.ts";
import { json } from "./meta.ts";

export type Moment = { id: string; frame: number; what: string; feel: string; sound: string };
export type SoundPlan = {
  effects: { moment: string; name: string; level: number; why: string }[];
  music: { moment: string; name: string; level: number; why: string }[];
  additions: { name: string; text: string; seconds: number }[];
};
export type Hit = { name: string; at: number; level: number; why: string };

export function collectMoments(p: Project): Moment[] {
  const moments: Moment[] = [];
  const words = p.narration!.words;
  const fps = p.timeline!.fps;
  const at = (word: number) => Math.round((words[word]?.start ?? 0) * fps);
  const add = (frame: number, what: string) => {
    const event = p.direction?.events.find((e) => frame >= at(e.firstWord) && frame <= Math.round((words[e.lastWord]?.end ?? 0) * fps));
    moments.push({ id: `m${moments.length}`, frame, what, feel: event?.feel ?? "", sound: event?.sound ?? "" });
  };
  add(0, "Video begins");
  for (const clip of p.timeline!.clips) {
    const scene = clip.scene;
    if (!scene) { add(clip.from, `Clip begins: ${clip.shotId}`); continue; }
    for (const e of scene.events) add(clip.from + (e.at ?? 0), `Emit ${e.name}: ${JSON.stringify(e.data ?? {})}`);
    const truth = scene.nodes.filter((n) => typeof n.props.truth === "string");
    const changes = new Map<number, string[]>();
    for (const track of scene.tracks) {
      const computed = truth.some((n) => track.target === n.id || track.target.startsWith(`${n.id}.`));
      const entrance = ["opacity", "trimEnd"].includes(track.prop);
      if (!computed && !entrance) continue;
      for (let i = 1; i < track.keys.length; i++) {
        const key = track.keys[i]!;
        const prev = track.keys[i - 1]!;
        if (JSON.stringify(key.value) === JSON.stringify(prev.value)) continue;
        if (!computed && !(Number(key.value) > Number(prev.value))) continue;
        const frame = clip.from + prev.at;
        const list = changes.get(frame) ?? [];
        list.push(`${computed ? "Computed" : "Entrance/reveal"} ${track.target}.${track.prop}: ${JSON.stringify(prev.value)} to ${JSON.stringify(key.value)} (lands at ${clip.from + key.at})`);
        changes.set(frame, list);
        if (computed) {
          const landing = clip.from + key.at;
          const landed = changes.get(landing) ?? [];
          landed.push(`Computed land ${track.target}.${track.prop}: ${JSON.stringify(key.value)}`);
          changes.set(landing, landed);
        }
      }
    }
    for (const [frame, descriptions] of changes) add(frame, descriptions.join("; "));
  }
  for (const e of p.direction?.events ?? []) {
    add(at(e.firstWord), `Event ${e.id}: ${e.job}. Look: ${e.look}. Feel: ${e.feel}`);
    add(Math.round((words[e.lastWord]?.end ?? 0) * fps), `Event ${e.id} ends`);
    if (e.reveal) add(at(e.reveal.word), `Directed reveal: ${e.reveal.what}`);
  }
  for (const h of p.narration!.holds ?? []) {
    add(Math.round(h.start * fps), `Hold ${h.id} begins (${h.seconds}s)`);
    add(Math.round((h.start + h.seconds) * fps), `Hold ${h.id} ends`);
  }
  return moments.sort((a, b) => a.frame - b.frame);
}

export function placements(plan: SoundPlan, moments: Moment[], fps: number, seconds: number) {
  const time = (id: string) => {
    const moment = moments.find((m) => m.id === id);
    if (!moment) throw new Error(`sound plan names unknown moment ${id}`);
    return moment.frame / fps;
  };
  const hits: Hit[] = [];
  for (const e of plan.effects.map((e) => ({ ...e, at: time(e.moment) })).sort((a, b) => a.at - b.at)) {
    const def = KIT.sfx[e.name];
    if (!def) throw new Error(`unknown sound ${e.name}`);
    if (!Number.isFinite(e.level)) throw new Error("invalid effect level");
    const last = hits.at(-1);
    if (e.at < 0 || e.at >= seconds || (last && e.at < last.at + Math.max(1.5, KIT.sfx[last.name]!.seconds))) continue;
    hits.push({ name: e.name, at: e.at, level: Math.min(-18, Math.max(-40, e.level)), why: e.why });
  }
  const music = plan.music.map((e) => {
    if (!KIT.music[e.name] || !Number.isFinite(e.level)) throw new Error(`invalid music cue ${e.name}`);
    return { ...e, at: time(e.moment), level: Math.min(0, Math.max(-80, e.level)) };
  }).filter((e) => e.at >= 0 && e.at < seconds).sort((a, b) => a.at - b.at);
  if (!music.length || music[0]!.at !== 0) throw new Error("music plan must start at the video beginning; use -80 dB for silence");
  if (new Set(music.map((e) => e.at)).size !== music.length) throw new Error("music cues must have distinct times");
  return { hits, music };
}

const str = { type: "string" };
const num = { type: "number" };
const object = (properties: Record<string, object>) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
const array = (items: object) => ({ type: "array", items });
export async function reasonSound(p: Project, moments: Moment[]) {
  return json<SoundPlan>({
    system: "You direct sound for a narrated video of any purpose. Reason from intent and actual compiled visual moments, never a table mapping event types to sounds. Most moments should be silent. Choose sparse effects quieter than voice (level -18 to -40 dB). At most one effect at a time and at least 1.5 seconds apart. Choose music cues only at supplied moments, especially event boundaries, changing feel, holds and reveals. Music levels are offsets from a -26 LUFS bed, -80 means silence, 0 is the maximum. Start with a cue at frame 0. Avoid swells over an important event. A music cue changes the bed with a short crossfade; use silence when it helps. Only existing music names. Prefer the existing effects, but request a reusable new effect if needed, max 20, each 0.5 to 2 seconds. New names must be lowercase letters, digits and hyphens. Explain each choice. Return a compact plan.",
    user: JSON.stringify({ intent: p.plan ?? p.input, direction: p.direction, style: p.timeline!.style, kit: KIT, moments }),
    schema: object({ effects: array(object({ moment: str, name: str, level: num, why: str })), music: array(object({ moment: str, name: str, level: num, why: str })), additions: array(object({ name: str, text: str, seconds: num })) }),
    schemaName: "sound_plan", maxOutput: 6000, effort: "low",
  });
}
