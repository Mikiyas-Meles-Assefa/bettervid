// S14 frame set: moments from the three reviewed engine videos, each labelled by hand with the problems a demanding
// viewer sees (from docs/reviews/2026-11-02-three-videos.md and a frame-by-frame look). Clean frames are controls.
export type Kind =
  | "faint_text" // text too faint, low contrast or dimmed against what is behind it
  | "text_overlap" // text over text, or text over a busy picture so it cannot be read
  | "cut_off" // something cut by the frame edge
  | "too_small" // something that matters is too small to read on a phone
  | "empty_space" // a large part of the frame is empty while the idea needs room
  | "washed_out" // the frame looks greyed or faded overall
  | "blank_or_broken" // a card, picture or panel that shows nothing, or a mark pointing at nothing
  | "subject_missing" // a picture cropped so its subject is not visible
  | "wrong_picture" // the picture is the wrong kind of thing or clashes in style
  | "says_other_than_words" // on-screen text contradicts what is spoken
  | "unsourced_or_wrong_fact" // a claim, number or formula that is wrong or has no source
  | "ugly"; // does not look designed or does not fit its style

export type Frame = { id: string; project: string; t: number; problems: Kind[]; note: string };

export const PROJECTS = {
  stats: "my-stats-exam-is-on-friday-and-i-still-d-3a89a8",
  merge: "how-does-merge-sort-actually-work-im-lea-81a3c3",
  wright: "how-did-the-wright-brothers-get-the-firs-d6a311",
} as const;

export const FRAMES: Frame[] = [
  // Wright brothers (collage)
  { id: "w-sand", project: "wright", t: 12, problems: ["subject_missing", "ugly"], note: "first-flight photo cropped to sand and a bench; the card names a pilot who is not in view" },
  { id: "w-engine", project: "wright", t: 43.8, problems: ["text_overlap", "ugly"], note: "red serif text written straight across a busy engine photo" },
  { id: "w-clipart", project: "wright", t: 72, problems: ["wrong_picture", "empty_space", "ugly"], note: "clip-art icon on a beige page beside archival photos, small items on a big empty page" },
  { id: "w-kittyhawk", project: "wright", t: 106.2, problems: ["text_overlap"], note: "an old label shows through under a new one; stray red lines cross the photo" },
  { id: "w-stalled", project: "wright", t: 135, problems: ["text_overlap"], note: "serif text written straight onto a busy photo" },
  { id: "w-bullet", project: "wright", t: 150, problems: ["wrong_picture", "empty_space"], note: "a bullet shape stands for going home to Dayton" },
  { id: "w-table", project: "wright", t: 165, problems: ["unsourced_or_wrong_fact"], note: "a table of lift numbers with no source" },
  { id: "w-cutoff", project: "wright", t: 171, problems: ["cut_off"], note: "title runs off the right edge" },
  { id: "w-blank", project: "wright", t: 214.2, problems: ["blank_or_broken", "says_other_than_words"], note: "a blank cream card labelled 1902 glider while the 1903 Flyer is spoken" },
  { id: "w-ring", project: "wright", t: 216, problems: ["blank_or_broken", "says_other_than_words"], note: "a ring circles empty sky; blank card stays" },
  { id: "w-clean", project: "wright", t: 192, problems: [], note: "control: steering diagram with three arrows" },
  // Standard deviation (chalkboard)
  { id: "s-cream", project: "stats", t: 96, problems: ["faint_text", "ugly"], note: "cream card on the blackboard with near-invisible text" },
  { id: "s-yellow", project: "stats", t: 12, problems: ["faint_text", "washed_out"], note: "yellow card fill with invisible text, the other card greyed" },
  { id: "s-tiny", project: "stats", t: 126, problems: ["too_small", "empty_space"], note: "the table shrinks to a small block in the upper half" },
  { id: "s-overlap", project: "stats", t: 150, problems: ["text_overlap", "faint_text"], note: "labels written over each other under a faded table" },
  { id: "s-strike", project: "stats", t: 192, problems: ["text_overlap"], note: "a ring is drawn through the caption under the answer" },
  { id: "s-xbar", project: "stats", t: 30, problems: ["unsourced_or_wrong_fact"], note: "sample formula shows x where it should be x-bar" },
  { id: "s-clean1", project: "stats", t: 48, problems: [], note: "control: data list and title" },
  { id: "s-clean2", project: "stats", t: 111, problems: [], note: "control: step 4 table with total" },
  // Merge sort (neon)
  { id: "m-dim", project: "merge", t: 93, problems: ["faint_text", "too_small", "washed_out"], note: "title and notes dimmed to near nothing, pointer icons tiny" },
  { id: "m-faded", project: "merge", t: 127.8, problems: ["faint_text", "too_small", "washed_out"], note: "caption and the waiting boxes dimmed, pointer icons tiny" },
  { id: "m-tradeoff", project: "merge", t: 165, problems: ["text_overlap"], note: "two captions written over each other" },
  { id: "m-grey", project: "merge", t: 43.2, problems: ["washed_out", "faint_text"], note: "everything dimmed to grey-blue" },
  { id: "m-clean3", project: "merge", t: 87, problems: [], note: "control: four sorted boxes with a caption" },
  { id: "m-clean1", project: "merge", t: 141, problems: [], note: "control: final merge mid-way" },
  { id: "m-clean2", project: "merge", t: 21, problems: [], note: "control: three ideas list" },
];
