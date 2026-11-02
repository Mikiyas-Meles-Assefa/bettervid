// Every kit the pipeline gives the scene language. A new kit is one import and one entry here; the language guide
// picks up its kinds, behaviors and docs by itself.
import type { Kit } from "../core/types.ts";
import { graphKit } from "./graph.ts";
import { linalgKit } from "./linalg.ts";
import { sortKit } from "./sort.ts";
import { traceKit } from "./trace.ts";
import { dijkstraKit } from "./dijkstra.ts";

export const KITS: Kit[] = [graphKit, linalgKit, sortKit, traceKit, dijkstraKit];
