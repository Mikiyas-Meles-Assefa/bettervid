// The truth check. Claims read off the screen are compared with the script, sources and truth engine logs. Anything flagged
// wrong is looked at again at full size around that moment, so a misread frame or a half-finished change is not called false.
import type { RepairTicket } from "../core/types.ts";
import type { Ask, Part } from "./model.ts";
import { text } from "./model.ts";
import { sentences, wordMoment } from "./moments.ts";
import type { ClaimCheck, Cut, ScreenClaim, TruthResult } from "./types.ts";

const CHECK = `You check claims shown on screen in an explainer video. You get the claims, the narration, the sources, and any logs from real computations. Logs are the highest authority, then sources, then the narration. Work out anything that can be worked out, such as arithmetic.

For each claim give a verdict:
- ok: it agrees with the material, or is a harmless label or heading.
- contradicted: it disagrees with the material or is simply wrong.
- unsupported: it asserts a fact that nothing here backs up and you cannot work out.
Text with obvious reading glitches, such as letters run together, may be a misread: give the verdict for what it most likely says.`;

const checkSchema = {
  type: "object",
  additionalProperties: false,
  required: ["checks"],
  properties: {
    checks: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["n", "verdict", "why"], properties: { n: { type: "integer" }, verdict: { type: "string", enum: ["ok", "contradicted", "unsupported"] }, why: { type: "string" } } },
    },
  },
};

const CONFIRM = `A checker read a claim off the screen and believes it is wrong. The checker's reasoning is not yours to judge. You see frames from around that moment at full size. Read what is actually there once it has settled, ignoring frames caught part way through a change. Set wrong to true if the settled screen really says what the claim says, and false if the claim was a misread or only appears mid-change.`;

const confirmSchema = { type: "object", additionalProperties: false, required: ["reads", "wrong"], properties: { reads: { type: "string" }, wrong: { type: "boolean" } } };

export type TruthDeps = { ask: Ask; bigFrame: (at: number) => Part };

export async function truthReview(cut: Cut, claims: ScreenClaim[], d: TruthDeps): Promise<TruthResult> {
  const unique = [...new Map(claims.map((c) => [c.text.trim().toLowerCase(), c])).values()];
  if (!unique.length) return { checks: [], falseClaims: 0, unsupported: 0, tickets: [] };
  const logs = cut.truth?.length ? `\n\nLogs:\n${JSON.stringify(cut.truth).slice(0, 20000)}` : "";
  const r = await d.ask<{ checks: { n: number; verdict: ClaimCheck["verdict"]; why: string }[] }>({
    name: "truth",
    effort: "medium",
    system: CHECK,
    user: `Claims:\n${unique.map((c, i) => `${i}: ${c.text}`).join("\n")}\n\nNarration:\n${cut.script}\n\nSources:\n${cut.sources.join("\n")}${logs}`,
    schema: checkSchema,
  });
  const list = sentences(cut.words);
  const checks: ClaimCheck[] = r.checks.filter((c) => unique[c.n]).map((c) => ({ claim: unique[c.n], verdict: c.verdict, why: c.why }));
  for (const c of checks) {
    if (c.verdict !== "contradicted") continue;
    const s = list.find((x) => x.id === c.claim.sentence);
    if (!s) continue;
    const times = [s.from, (s.from + s.to) / 2, s.to, s.to + 1];
    const parts: Part[] = [text(`Claim: "${c.claim.text}"\nWhy it was flagged: ${c.why}`), ...times.flatMap((t) => [text(`${t.toFixed(1)}s`), d.bigFrame(t)])];
    const v = await d.ask<{ reads: string; wrong: boolean }>({ name: "truth-confirm", effort: "low", system: CONFIRM, user: parts, schema: confirmSchema });
    c.confirmed = v.wrong;
    c.why = `${c.why} Settled screen reads: ${v.reads}`;
  }
  const tickets: RepairTicket[] = checks.flatMap((c) => {
    const bad = c.verdict === "contradicted" && c.confirmed !== false;
    if (!bad && c.verdict !== "unsupported") return [];
    const s = list.find((x) => x.id === c.claim.sentence) ?? list[0];
    return [
      {
        reviewer: "truth" as const,
        problem: bad ? ("false_claim" as const) : ("unsupported_claim" as const),
        at: wordMoment(s.first),
        until: wordMoment(s.last),
        from: s.from,
        to: s.to,
        said: s.text,
        seen: c.claim.text,
        wrong: c.why,
        severity: bad ? (3 as const) : (1 as const),
      },
    ];
  });
  return {
    checks,
    falseClaims: checks.filter((c) => c.verdict === "contradicted" && c.confirmed !== false).length,
    unsupported: checks.filter((c) => c.verdict === "unsupported").length,
    tickets,
  };
}
