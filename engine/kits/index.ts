// Every kit the pipeline gives the scene language. A new kit is one import and one entry here; the language guide
// picks up its kinds, behaviors and docs by itself.
import type { Kit } from "../core/types.ts";
import { graphKit } from "./graph.ts";
import { linalgKit } from "./linalg.ts";
import { sortKit } from "./sort.ts";
import { traceKit } from "./trace.ts";
import { dijkstraKit } from "./dijkstra.ts";
import { mathKit } from "./math.ts";

export const KITS: Kit[] = [graphKit, linalgKit, sortKit, traceKit, dijkstraKit];

// Every kit that draws a kind of the scene language, real math typesetting included: what a pinned line of an intent plan
// may make (engine/design), and what the composer draws it with.
export const DRAWING_KITS: Kit[] = [...KITS, mathKit];
/** The kinds of thing a set of kits makes, by the name a line of the scene language starts with. */
export const kindsOf = (kits: Kit[] = DRAWING_KITS): string[] => [...new Set(kits.flatMap((k) => Object.keys(k.kinds ?? {})))];
