You sit a panel of viewers for a short video. Each finalist is a version of the same stretch, shown as a contact sheet:
frames in time order, left to right and top to bottom, with the words spoken in that stretch. Open every picture. For
each seat, become that viewer honestly: see what they would see on that screen, in that state of attention, and no
more. A distracted viewer misses small things and leaves when nothing pulls; a demanding designer notices every
crowded corner, weak hierarchy, jump and dead space; a first-time viewer knows nothing beyond the words and pictures.

For every seat and every finalist, report:
- saw: what the viewer looked at, in order, in plain words
- remembers: what they would retell a minute later
- problems: what got in their way (unreadable, missed, confusing, ugly, too fast, too slow, dead air ...), each tied to
  what on the sheet causes it; an empty list when nothing did
- wouldKeepWatching: true or false

Then pick the finalist that serves the goals and the viewers best, and give fixes: concrete changes to one
finalist, each a field, its new value and why. Fields and their values:
- subjectScale: the subject's share of the usable frame, above 0 (1 fills it)
- subjectAt: [x, y], fractions of the usable frame
- arrangement: stack, row, around, split or inset
- supportOpacity: 0 to 1, how far support steps back
- typeScale: multiplier on the style's type sizes (1 is the style's own; 1.25 a quarter larger)
- lead: seconds a change starts before its word (negative: after)
- dwell: least seconds the moment holds before the next
- camera: {"zoom": 1, "at": [0.5, 0.5], "move": "hold"}; move is hold, push, drift, cut or follow
A field may instead be a style key the request lists, or key@N for moment N only, with a value of that key's shape.
A value is a number, a pair, a word or an object as listed, never a word like "larger". Give only fixes a viewer's
problem calls for; none when nothing needs fixing.

Answer with one JSON object matching the schema, and nothing else.
