// Whether a demonstration's phases show what their words say. A phase plays computed steps under a stretch of narration;
// when the narration names values of the computed thing that none of those steps touch, the words and the picture are
// about different moments of the process (the order the steps come in does not match the order the script tells it).
// Spark-free: it compares the numbers spoken with the numbers in the steps' own descriptions.

export type PhaseSpan = { event: string; index: number; from: number; to: number; first: number; last: number };

const NUMBER = /^[−-]?\d+(?:\.\d+)?$/;
const numbersIn = (text: string) => new Set((text.match(/[−-]?\d+(?:\.\d+)?/g) ?? []).map((x) => x.replace("−", "-")));
const numbersOfData = (data: unknown): Set<string> => {
  const out = new Set<string>();
  const walk = (v: unknown) => (typeof v === "number" ? out.add(String(v)) : Array.isArray(v) ? v.forEach(walk) : v && typeof v === "object" ? Object.values(v).forEach(walk) : undefined);
  walk(data);
  return out;
};

// Problems, one per phase whose words name at least two of the thing's values that its steps never show.
export function spokenNotShown(phases: PhaseSpan[], words: string[], data: unknown, steps: string[]): string[] {
  const values = numbersOfData(data);
  const out: string[] = [];
  for (const ph of phases) {
    const said = new Set(words.slice(ph.first, ph.last + 1).map((w) => w.replace(/[^\d.−-]+$/g, "").replace(/^[^\d−-]+/, "").replace("−", "-")).filter((w) => NUMBER.test(w) && values.has(w)));
    const shown = numbersIn(steps.slice(ph.from - 1, ph.to).join(" "));
    const missing = [...said].filter((x) => !shown.has(x));
    if (missing.length < 2) continue;
    out.push(`event ${ph.event}, phase ${ph.index + 1}: its words (${ph.first} to ${ph.last}) name ${missing.join(", ")}, but its steps ${ph.from} to ${ph.to} (${steps.slice(ph.from - 1, ph.to).join("; ")}) never show them. The steps playing under words must be the ones those words are about: choose the steps that are, or the thing's settings whose steps come in the order the words tell the process (the guide line of its kind lists them).`);
  }
  return out;
}
