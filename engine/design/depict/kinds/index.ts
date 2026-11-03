// Kinds of things, never topics. One kind covers many real things through its parameters.
import type { KindDef } from "../make.ts";
import { body } from "./body.ts";
import { clock } from "./clock.ts";
import { container } from "./container.ts";
import { device } from "./device.ts";
import { flow } from "./flow.ts";
import { gauge } from "./gauge.ts";
import { cell, plant } from "./living.ts";
import { mechanism } from "./mechanism.ts";
import { outline } from "./outline.ts";
import { sheet } from "./sheet.ts";

export const KINDS: Record<string, KindDef> = Object.fromEntries([container, body, gauge, clock, flow, mechanism, sheet, device, plant, cell, outline].map((k) => [k.name, k]));
