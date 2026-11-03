// Screens and devices: a phone, tablet, laptop, monitor or watch, with a screen region that can hold words or a picture
// (the `screen` part's box is where the caller puts anything else). Its screen lights and goes dark, scrolls, shows a
// notification, buzzes.
import type { NodeSpec, Props } from "../../../core/types.ts";
import type { KindDef } from "../make.ts";
import { clamp, ellipse, flat, isHex, luminance, mixHex, roundRect } from "../geom.ts";
import { sizeCm } from "../spec.ts";
import type { Part, StateDef, StateMap, VerbDef } from "../types.ts";

const SIZES: Record<string, { w: number; h: number }> = { phone: { w: 7.2, h: 15 }, tablet: { w: 18, h: 25 }, laptop: { w: 31, h: 22 }, monitor: { w: 54, h: 42 }, watch: { w: 4, h: 4.8 } };

export const device: KindDef = {
  name: "device",
  about: "screens and gadgets: phones, tablets, laptops, monitors, TVs, smart watches; the screen can show words, rows of an interface, or a picture",
  forms: { phone: "a phone held upright", tablet: "a tablet", laptop: "an open laptop", monitor: "a monitor or TV on a stand", watch: "a watch face on a strap" },
  params: {
    lines: "words shown on the screen, top to bottom (rows of an interface, a message, a headline)",
    image: "a picture on the screen: a path or URL",
    rows: "for an interface without words: how many rows of placeholder content",
  },
  colors: { body: "the case (a fact: space grey, silver, white)", screen: "the lit screen's background", off: "the screen when dark", ui: "the interface's accent (a button, the brand color)" },
  build(c) {
    const { id, L } = c;
    const form = c.spec.form ?? "phone";
    const real = sizeCm(c.spec) ?? SIZES[form] ?? SIZES.phone!;
    const W = real.w >= real.h ? 1000 : (1000 * real.w) / real.h;
    const H = real.h >= real.w ? 1000 : (1000 * real.h) / real.w;
    const bodyCol = c.col("body") ?? "ink";
    const screenCol = c.col("screen") ?? "paper";
    const off = c.col("off") ?? (isHex(bodyCol) ? mixHex(bodyCol, "#000000", 0.55) : "#111318");
    const ui = c.col("ui") ?? "accent";
    const nodes: NodeSpec[] = [];
    const add = (nid: string, kind: "group" | "path" | "text" | "image", props: Props, parent = `${id}.body`) => nodes.push({ id: nid, kind, parent, props });
    const line = { stroke: "ink", strokeWidth: L, lineJoin: "round" };
    // The screen's box, by form.
    let sx0 = -W / 2, sx1 = W / 2, sy0 = -H, sy1 = 0;
    if (form === "phone" || form === "tablet") {
      const bez = W * (form === "phone" ? 0.05 : 0.06);
      add(`${id}.case`, "path", { ...line, points: flat(roundRect(-W / 2, -H, W / 2, 0, W * 0.14)), closed: 1, fill: bodyCol });
      [sx0, sx1, sy0, sy1] = [-W / 2 + bez, W / 2 - bez, -H + bez, -bez];
    } else if (form === "watch") {
      add(`${id}.strap`, "path", { ...line, points: flat(roundRect(-W * 0.3, -H, W * 0.3, 0, W * 0.08)), closed: 1, fill: isHex(bodyCol) ? mixHex(bodyCol, "#000000", 0.3) : "ink" });
      add(`${id}.case`, "path", { ...line, points: flat(roundRect(-W / 2, -H * 0.8, W / 2, -H * 0.2, W * 0.24)), closed: 1, fill: bodyCol });
      [sx0, sx1, sy0, sy1] = [-W / 2 + W * 0.09, W / 2 - W * 0.09, -H * 0.8 + W * 0.09, -H * 0.2 - W * 0.09];
    } else if (form === "laptop") {
      const baseH = H * 0.07;
      add(`${id}.lid`, "path", { ...line, points: flat(roundRect(-W * 0.43, -H, W * 0.43, -baseH, W * 0.025)), closed: 1, fill: bodyCol });
      add(`${id}.base`, "path", { ...line, points: flat([[-W / 2, -baseH], [W / 2, -baseH], [W / 2 - W * 0.02, 0], [-W / 2 + W * 0.02, 0]]), closed: 1, fill: isHex(bodyCol) ? mixHex(bodyCol, "#ffffff", 0.15) : bodyCol });
      add(`${id}.notch`, "path", { points: flat(roundRect(-W * 0.07, -baseH, W * 0.07, -baseH * 0.55, baseH * 0.2)), closed: 1, fill: "ink", opacity: 0.25, stroke: "none" });
      [sx0, sx1, sy0, sy1] = [-W * 0.4, W * 0.4, -H + W * 0.03, -baseH - W * 0.03];
    } else {
      const standH = H * 0.16;
      add(`${id}.stand`, "path", { ...line, points: flat([[-W * 0.05, -standH - 4], [W * 0.05, -standH - 4], [W * 0.06, -H * 0.03], [W * 0.18, -H * 0.03], [W * 0.18, 0], [-W * 0.18, 0], [-W * 0.18, -H * 0.03], [-W * 0.06, -H * 0.03]]), closed: 1, fill: bodyCol });
      add(`${id}.case`, "path", { ...line, points: flat(roundRect(-W / 2, -H, W / 2, -standH, W * 0.015)), closed: 1, fill: bodyCol });
      [sx0, sx1, sy0, sy1] = [-W / 2 + W * 0.025, W / 2 - W * 0.025, -H + W * 0.025, -standH - W * 0.025];
    }
    const sr = form === "phone" ? W * 0.09 : form === "watch" ? W * 0.16 : W * 0.01;
    const screen = roundRect(sx0, sy0, sx1, sy1, sr);
    add(`${id}.screen`, "path", { points: flat(screen), closed: 1, stroke: "none" });
    add(`${id}.ui`, "group", { clip: flat(screen) });
    const sw = sx1 - sx0;
    const sh = sy1 - sy0;
    const pad = sw * 0.08;
    const lines = c.param<string[]>("lines") ?? [];
    const image = c.param<string>("image");
    const T = c.text ?? 0;
    // Words on the screen take whichever of near black or near white reads on it.
    const textCol = isHex(screenCol) ? (luminance(screenCol) > 0.35 ? "#16181d" : "#f3f4f6") : "ink";
    add(`${id}.content`, "group", {}, `${id}.ui`);
    if (image) add(`${id}.picture`, "image", { src: image, x: (sx0 + sx1) / 2, y: (sy0 + sy1) / 2, w: sw, h: sh, fit: "cover" }, `${id}.content`);
    else if (lines.length && T) lines.forEach((t, i) => add(`${id}.text.${i}`, "text", { x: sx0 + pad, y: sy0 + pad * 1.6 + i * T * 1.5, text: t, size: T, anchor: "start", color: i === 0 ? ui : textCol, weight: i === 0 ? 700 : 400 }, `${id}.content`));
    else {
      const n = Math.max(2, Math.round(c.param<number>("rows") ?? (form === "watch" ? 2 : 5)));
      const rh = Math.min(sh * 0.11, (sh - pad * 2) / (n + 1.5));
      add(`${id}.bar`, "path", { points: flat(roundRect(sx0 + pad, sy0 + pad, sx0 + pad + sw * 0.45, sy0 + pad + rh * 0.6, rh * 0.3)), closed: 1, fill: ui, stroke: "none" }, `${id}.content`);
      for (let i = 0; i < n; i++) {
        const y0 = sy0 + pad + rh * 1.4 + i * rh * 1.25;
        add(`${id}.row.${i}`, "path", { points: flat(roundRect(sx0 + pad, y0, sx1 - pad, y0 + rh, rh * 0.22)), closed: 1, fill: textCol, opacity: 0.1, stroke: "none" }, `${id}.content`);
        add(`${id}.dot.${i}`, "path", { points: flat(ellipse(sx0 + pad + rh * 0.55, y0 + rh / 2, rh * 0.3, undefined, 14)), closed: 1, fill: ui, opacity: 0.85, stroke: "none" }, `${id}.content`);
        add(`${id}.txt.${i}`, "path", { points: flat(roundRect(sx0 + pad + rh * 1.15, y0 + rh * 0.38, sx0 + pad + rh * 1.15 + (sw - pad * 2 - rh * 1.5) * (0.5 + 0.3 * Math.sin(i * 2.3)), y0 + rh * 0.62, rh * 0.12)), closed: 1, fill: textCol, opacity: 0.55, stroke: "none" }, `${id}.content`);
      }
    }
    // A notification banner and a badge.
    const bh = Math.max(sh * 0.11, T * 2.2);
    add(`${id}.banner`, "group", { y: 0 }, `${id}.ui`);
    add(`${id}.bannerback`, "path", { points: flat(roundRect(sx0 + pad * 0.6, sy0 + pad * 0.6, sx1 - pad * 0.6, sy0 + pad * 0.6 + bh, bh * 0.25)), closed: 1, fill: isHex(screenCol) ? mixHex(screenCol, "#808080", 0.25) : "paper", stroke: "ink", strokeWidth: L * 0.4, shadowY: L, shadowBlur: L * 3, shadowOpacity: 0.25, shadowColor: "#000000" }, `${id}.banner`);
    add(`${id}.bannerdot`, "path", { points: flat(ellipse(sx0 + pad * 0.6 + bh * 0.5, sy0 + pad * 0.6 + bh / 2, bh * 0.26, undefined, 16)), closed: 1, fill: ui, stroke: "none" }, `${id}.banner`);
    add(`${id}.bannertext`, "text", { x: sx0 + pad * 0.6 + bh, y: sy0 + pad * 0.6 + bh / 2, text: "", size: T || 1, anchor: "start", color: textCol, opacity: T ? 1 : 0 }, `${id}.banner`);
    add(`${id}.glare`, "path", { points: flat([[sx0 + sw * 0.55, sy0], [sx1, sy0], [sx1, sy0 + sh * 0.35]]), closed: 1, fill: "#ffffff", opacity: 0.07 * c.look.shine.value, stroke: "none" }, `${id}.ui`);
    add(`${id}.badge`, "path", { points: flat(ellipse(sx1 - pad * 0.2, sy0 + pad * 0.2, Math.max(L * 2, sw * 0.06), undefined, 16)), closed: 1, fill: c.col("badge") ?? "accent", stroke: "ink", strokeWidth: L * 0.5 });
    const parts: Record<string, Part> = {
      screen: { node: `${id}.ui`, anchor: [(sx0 + sx1) / 2, (sy0 + sy1) / 2], box: [sx0, sy0, sx1, sy1], about: "the screen: words or a picture go in this box" },
      case: { node: form === "laptop" ? `${id}.lid` : `${id}.case`, anchor: [0, -H / 2], box: [-W / 2, -H, W / 2, 0], about: "the device" },
      banner: { node: `${id}.banner`, anchor: [(sx0 + sx1) / 2, sy0 + pad * 0.6 + bh / 2], about: "a notification" },
    };
    const states: Record<string, StateDef> = {
      on: { type: "number", about: "how lit the screen is, 0 dark to 1 on", min: 0, max: 1, initial: 1 },
      scroll: { type: "number", about: "how far the content has scrolled, in screen heights", initial: 0 },
      notice: { type: "text", about: "the words of a notification (empty for none)", initial: "" },
      badge: { type: "number", about: "0 no badge, 1 a badge shows", min: 0, max: 1, initial: 0 },
    };
    const draw = (s: StateMap): Record<string, Props> => {
      const on = clamp(Number(s.on));
      const notice = String(s.notice ?? "");
      return {
        [`${id}.screen`]: { fill: on > 0.5 ? screenCol : off },
        [`${id}.ui`]: { opacity: on },
        [`${id}.content`]: { y: -Number(s.scroll) * sh },
        [`${id}.banner`]: { y: notice ? 0 : -(bh + pad * 1.5), opacity: notice ? 1 : 0 },
        [`${id}.bannertext`]: { text: notice },
        [`${id}.badge`]: { opacity: Number(s.badge), scaleX: Number(s.badge) || 0.01, scaleY: Number(s.badge) || 0.01 },
      };
    };
    const verbs: Record<string, VerbDef> = {
      lights: { about: "its screen comes on", sets: [{ state: "on", value: 1 }] },
      wakes: { about: "its screen comes on", sets: [{ state: "on", value: 1 }] },
      "turns on": { about: "its screen comes on", sets: [{ state: "on", value: 1 }] },
      "turns off": { about: "its screen goes dark", sets: [{ state: "on", value: 0 }] },
      sleeps: { about: "its screen goes dark", sets: [{ state: "on", value: 0 }] },
      scrolls: { about: "its content scrolls by a share of the screen (one screen when none is given)", sets: [{ state: "scroll", arg: true, by: 1 }], arg: "number" },
      notifies: { about: "a notification slides in with these words", sets: [{ state: "notice", arg: true, value: " " }, { state: "badge", value: 1 }], arg: "text", ease: "out" },
      shows: { about: "a notification with these words", sets: [{ state: "notice", arg: true }], arg: "text" },
      buzzes: { about: "it buzzes", sets: [{ state: "x", value: W * 0.03 }], motion: "shake" },
      rings: { about: "it rings", sets: [{ state: "angle", value: 8 }], motion: "shake" },
      vibrates: { about: "it buzzes", sets: [{ state: "x", value: W * 0.03 }], motion: "shake" },
    };
    return { box: { w: W, h: H }, pivot: [0, -H / 2], nodes, parts, states, verbs, draw };
  },
};
