// Settings written after the colon of a line of atoms belong to the line (bench note: `role=key` drew the word "key").
import assert from "node:assert/strict";
import { test } from "node:test";
import { parse } from "./syntax.ts";

const atomsOf = (src: string) => {
  const r = parse(src);
  assert.deepEqual(r.problems, []);
  const item = r.doc.states[0]!.items[0]!;
  const texts = item.parts!.flatMap((p) => (p.type === "text" ? [p.atom.text] : p.type === "frac" ? [...p.num, ...p.den].map((a) => a.text) : p.rows.flat().map((a) => a.text)));
  return { attrs: item.attrs, texts };
};

test("a trailing role after the colon is the line's role, not a piece", () => {
  const { attrs, texts } = atomsOf("@0\nhuge eq: six=6 div=÷ half=½ eq== ask=? role=key");
  assert.equal(attrs.role, "key");
  assert.deepEqual(texts, ["6", "÷", "½", "=", "?"]);
});

test("trailing settings after a fraction, and several at once", () => {
  const { attrs, texts } = atomsOf("@0\nbig sh: { a=1 / b=3 } role=answer enter=pop");
  assert.equal(attrs.role, "answer");
  assert.equal(attrs.enter, "pop");
  assert.deepEqual(texts, ["1", "3"]);
});

test("a piece that only shares a setting's name stays a piece", () => {
  // Not a value the setting accepts.
  assert.deepEqual(atomsOf("@0\nbig: m=mass weight=70kg").texts, ["mass", "70kg"]);
  // Followed by pieces: it is a piece in the middle of the line.
  assert.deepEqual(atomsOf("@0\nbig: role=key b=2").texts, ["key", "2"]);
  // The only piece on the line stays a piece.
  assert.deepEqual(atomsOf("@0\nbig: role=key").texts, ["key"]);
});

test("settings before the colon still work", () => {
  assert.equal(atomsOf("@0\nbig eq role=key: a=1 b=2").attrs.role, "key");
});
