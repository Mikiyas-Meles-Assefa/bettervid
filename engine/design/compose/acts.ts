// What an author's verb is, read off the depiction's own verb data (never off the verb's words): a flow (it involves
// another thing and needs an outlet or a mouth), a fall (it moves the thing down with gravity's ease), a reading (it
// needs a scale), a move to another thing (it takes a point and a target), or any other change of state. A verb the
// thing does not have is unknown: a note for the depicter or the author to repair.
import type { Theme } from "../../core/types.ts";
import { checkSpec, depictionFrom, findVerb, type DepictLook, type Depiction, type PropSpec, type VerbDef } from "../depict/index.ts";
import type { IntentPlan, Moment, PartCard } from "../types.ts";
import type { DepictRequest } from "../depict/index.ts";

export type ActKind = "flow" | "fall" | "read" | "move" | "change" | "unknown" | "none";
export type Classified = { kind: ActKind; key?: string; def?: VerbDef };

export function classify(d: Depiction | undefined, verb: string): Classified {
  if (!d) return { kind: "none" };
  const key = findVerb(d.verbs, verb);
  if (!key) return { kind: "unknown" };
  const def = d.verbs[key]!;
  const needs = def.needs ?? [];
  if (def.target && (needs.includes("outlet") || needs.includes("mouth"))) return { kind: "flow", key, def };
  if (def.ease === "in" && def.sets.some((s) => s.state === "y")) return { kind: "fall", key, def };
  if (needs.includes("scale")) return { kind: "read", key, def };
  if (def.target && def.arg === "point") return { kind: "move", key, def };
  return { kind: "change", key, def };
}

/** A look for building a depiction only to read its verbs and shape (nothing is drawn with it). */
export const PLAIN_LOOK: DepictLook = { line: { value: 8, from: "style" }, shine: { value: 1, from: "style" }, shade: { value: 1, from: "style" }, glow: { value: 20, from: "style" } };

/** Every object of the plan depicted from its spec, and the problems that stop one (each names the depicter task). */
export function depictAll(plan: IntentPlan, props: Record<string, PropSpec>, theme: Theme, look: (id: string) => DepictLook = () => PLAIN_LOOK, text?: (id: string) => number | undefined) {
  const out = new Map<string, Depiction>();
  const problems: { id: string; problem: string }[] = [];
  for (const t of plan.things) {
    if (t.kind !== "object") continue;
    const spec = props[t.id];
    if (!spec) {
      problems.push({ id: t.id, problem: `no PropSpec for ${t.id} ("${t.desc ?? t.id}"): the depicter task depict.${t.id} must be answered (scripts/design-brain/depict-tasks.ts writes it)` });
      continue;
    }
    if ((spec.tier ?? 1) !== 1) {
      problems.push({ id: t.id, problem: `${t.id} asks for a tier ${spec.tier} depiction (a sprite or a picture), which the composer cannot place yet: answer depict.${t.id} with a drawn kind, or make the picture` });
      continue;
    }
    try {
      out.set(t.id, depictionFrom(spec, theme, { id: `t.${t.id}`, look: look(t.id), text: text?.(t.id) }));
    } catch (e) {
      const issues = checkSpec(spec, {}, theme);
      problems.push({ id: t.id, problem: `depict.${t.id}: ${(e as Error).message}${issues.length ? `; ${issues.map((p) => `${p.path}: ${p.problem}`).join("; ")}` : ""}` });
    }
  }
  return { depictions: out, problems };
}

/** The kind of every act of the plan, by moment and act index, from the depictions of the things that act. */
export function actKinds(plan: IntentPlan, depictions: Map<string, Depiction>): Classified[][] {
  return plan.moments.map((m) => m.acts.map((a) => classify(depictions.get(a.ids[0]!), a.verb)));
}

/**
 * The depicter's request for each object of the plan: what it is, what the plan has it do, what else is on screen with
 * it, and the user's own words about it (`material`: lines of the request and the material, passed whole; the depicter
 * picks the facts).
 */
export function depictRequests(plan: IntentPlan, opts: { material?: string[]; purpose?: string; cards?: PartCard[] } = {}): DepictRequest[] {
  const objects = plan.things.filter((t) => t.kind === "object");
  const actsOf = (id: string) => plan.moments.flatMap((m: Moment) => m.acts.filter((a) => a.ids.includes(id)).map((a) => ({ verb: a.verb, ...(a.arg ? { arg: a.arg } : {}), ...(a.to ? { to: a.to } : {}) })));
  return objects.map((t) => ({
    id: `depict.${t.id}`,
    name: t.id,
    desc: t.desc ?? t.id,
    acts: actsOf(t.id),
    material: opts.material,
    company: objects.filter((o) => o.id !== t.id).map((o) => `${o.id}: ${o.desc ?? o.id}`),
    purpose: opts.purpose,
  }));
}
