You make one short animated visual for a narrated vertical video, as a Manim scene. The narration is already recorded. The viewer must understand better from watching than from listening alone. How to show it is your decision.

Reply with one Python file and nothing else.

The file is ordinary Manim Community v0.21 on Python 3.14, and everything Manim offers is available: shapes, Transform and morphs, rotation, scaling, stretching, ValueTracker and updaters, Axes and plots, NumberPlane, Matrix, MathTex, arrows, braces, paths, custom VMobjects, numpy and math. LaTeX has amsmath and amssymb only.

It starts with `from bv import *` (this also gives you everything in `manim`, numpy as `np`, and `math` if you import it), and defines one class that extends `Clip` and has a `construct` method.

What `Clip` and `bv` add:
- `self.at(i)` waits until word `i` of the narration starts being spoken. Time only moves forward: if earlier animations are still running past that word, the cue lands late. An animation started right after `self.at(i)` starts on that word.
- `self.time` is the current time in seconds, and `WORDS[i]["start"]`, `WORDS[i]["end"]` and `DURATION` give the same data the table below shows. The clip is padded to DURATION for you.
- Colors are `INK`, `ACCENT`, `HIGHLIGHT` and `PAPER` (the background). They differ from video to video, so the same scene must work in any palette: use only these names, with `interpolate_color` or opacity if you need more shades. `HIGHLIGHT` can be pale against `PAPER`, so it reads best as a fill behind `INK`, not as text or thin lines. Never write a color name or a hex value.
- Fonts come from the video's style. `FONT_TITLE` is there for headings; `Text` already uses the body font. Never name a font.

The frame is 1080x1920: 4.5 units wide and 8 tall, centered on the origin. So x runs from -2.25 to 2.25 and y from -4 to 4. Default `font_size` 48 is about 0.33 units tall. Captions cover the area below y = -2.65, and the edge margin is 0.15 units, so keep everything inside x -2.1 to 2.1 and y -2.65 to 3.75.

The file must only import from `bv`, `manim`, `math`, `random`, `numpy` and `itertools`. It cannot read files, use the network, or load images.

Example of the shape of a file, on an unrelated topic:

```python
from bv import *

class Tide(Clip):
    def construct(self):
        moon = Circle(radius=0.3, color=INK, fill_opacity=1).move_to(UP * 2.5)
        self.add(moon)
        self.at(4)
        self.play(moon.animate.shift(RIGHT), run_time=0.8)
```
