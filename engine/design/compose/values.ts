// Where the composer reads a value of taste: Design.overrides for this moment ("key@N", N the plan's moment index), then
// for the video ("key"), then the style's suggestion (engine/design/suggest.ts). It remembers what it read, so a review
// can see which values a composition used.
import type { Theme } from "../../core/types.ts";
import { styleValues, type StyleValue } from "../suggest.ts";
import type { Design } from "../types.ts";

export class Values {
  readonly style: Record<string, StyleValue>;
  readonly over = new Map<string, unknown>();
  readonly used = new Set<string>();
  readonly short: number;
  readonly fps: number;
  constructor(design: Design, theme: Theme) {
    this.style = styleValues(theme, design.viewing);
    for (const o of design.overrides) this.over.set(o.key, o.value);
    this.short = Math.min(design.viewing.width, design.viewing.height);
    this.fps = design.viewing.fps;
  }
  get<T>(key: string, k?: number): T {
    this.used.add(key);
    if (k !== undefined && this.over.has(`${key}@${k}`)) return this.over.get(`${key}@${k}`) as T;
    if (this.over.has(key)) return this.over.get(key) as T;
    const s = this.style[key];
    if (!s) throw new Error(`no style value "${key}"`);
    return s.value as T;
  }
  n(key: string, k?: number): number {
    return Number(this.get<number>(key, k));
  }
  /** A size: a share of the frame's shorter side, in pixels. */
  px(key: string, k?: number): number {
    return this.n(key, k) * this.short;
  }
  /** A time: seconds, in frames. */
  f(key: string, k?: number): number {
    return Math.round(this.n(key, k) * this.fps);
  }
  arr(key: string, k?: number): number[] {
    return (this.get<number[]>(key, k) ?? []).map(Number);
  }
}
