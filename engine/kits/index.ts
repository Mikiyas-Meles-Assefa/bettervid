// Every kit the pipeline gives the scene language. A new kit is one import and one entry here; the language guide
// picks up its kinds, behaviors and docs by itself.
import type { Kit } from "../core/types.ts";
import { graphKit } from "./graph.ts";

export const KITS: Kit[] = [graphKit];
