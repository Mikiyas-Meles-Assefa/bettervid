# The theme and timing layer a generated scene runs on. A scene is ordinary Manim: it never names a color or a font, and it
# refers to spoken words by index. Style and word times arrive as data, so the same scene code renders in any style.
#   BV_STYLE   path to a styles/*.json
#   BV_WORDS   path to JSON {"words": [{"text","start","end"}...], "duration": seconds}, times from the start of the clip
#   BV_REPORT  path where the scene writes what happened (cue lateness, layout problems)
import inspect, json, os
from manim import *

_style = json.load(open(os.environ["BV_STYLE"]))
_timing = json.load(open(os.environ["BV_WORDS"]))
WORDS = _timing["words"]
DURATION = _timing["duration"]

PAPER, INK, ACCENT, HIGHLIGHT = (ManimColor(_style["palette"][k]) for k in ("paper", "ink", "accent", "highlight"))
FONT_BODY, FONT_TITLE = _style["fonts"]["body"], _style["fonts"]["title"]
STROKE = 4 * _style.get("hand", {}).get("weight", 1)

# 1080x1920 on a 4.5 by 8 frame keeps Manim's own sizes sensible. Captions sit over the bottom band.
config.frame_height, config.frame_width = 8.0, 4.5
config.background_color = PAPER
TOP, BOTTOM, LEFT_EDGE, RIGHT_EDGE = 3.75, -2.65, -2.1, 2.1


def _sans(name):
    return not any(k in name.lower() for k in ("georgia", "times", "garamond", "palatino"))


# LaTeX math follows the style's font family. Family only (Computer Modern serif or sans): see S12.
config.tex_template = TexTemplate(
    documentclass=r"\documentclass{article}\pagestyle{empty}\setlength{\textwidth}{80cm}\setlength{\hoffset}{-30cm}",
    preamble=r"\usepackage{amsmath}\usepackage{amssymb}" + (r"\usepackage{sansmath}\sansmath\renewcommand{\familydefault}{\sfdefault}" if _sans(FONT_BODY) else ""),
)


def _subclasses(root):
    for c in root.__subclasses__():
        yield c
        yield from _subclasses(c)


# Any Mobject or Animation with its own color default gets a theme color instead, so nothing falls back to Manim's look.
for _c in set(_subclasses(Mobject)):
    _p = inspect.signature(_c.__init__).parameters
    _d = {n: INK for n in ("color", "stroke_color", "fill_color") if n in _p and _p[n].default is not inspect.Parameter.empty and _p[n].default is not None}
    if _d:
        try:
            _c.set_default(**_d)
        except Exception:
            pass
for _c in (Text, MarkupText, Paragraph):
    _c.set_default(font=FONT_BODY, color=INK)
VMobject.set_default(color=INK, stroke_width=STROKE)
for _c in (Dot, ParametricFunction, SurroundingRectangle, Underline):
    _c.set_default(color=ACCENT)
NumberPlane.set_default(background_line_style={"stroke_color": INK, "stroke_width": 1, "stroke_opacity": 0.2})
for _c in (Indicate, Circumscribe, Flash, ShowPassingFlash, Wiggle, FocusOn):
    if "color" in inspect.signature(_c.__init__).parameters:
        _c.__init__ = (lambda f: lambda self, *a, color=ACCENT, **k: f(self, *a, color=color, **k))(_c.__init__)


# The style's hand: every large shape gets the same small wander as the marks in video/marks.tsx. The offset depends on the
# point's place within its shape, so it holds still while the shape travels and joined points stay joined. Glyphs stay crisp.
_WOBBLE = _style.get("hand", {}).get("wobble", 0) * config.frame_width / 1080 * 2
_cairo_path = Camera.set_cairo_context_path


def _hand_path(self, ctx, vm):
    pts = vm.points
    if not _WOBBLE or len(pts) < 4 or isinstance(vm, VMobjectFromSVGPath) or max(vm.width, vm.height) < 0.6:
        return _cairo_path(self, ctx, vm)
    q = np.round((pts - vm.get_center()) / 0.05).astype(np.int64)
    angle = ((q[:, 0] * 73856093) ^ (q[:, 1] * 19349663)) % 6283 / 1000
    vm.points = pts + _WOBBLE * np.stack([np.cos(angle), np.sin(angle), 0 * angle], axis=1)
    try:
        return _cairo_path(self, ctx, vm)
    finally:
        vm.points = pts


Camera.set_cairo_context_path = _hand_path


def _leaves(m):
    if isinstance(m, (Text, MarkupText, SingleStringMathTex)):
        return [m]
    return [x for s in m.submobjects for x in _leaves(s)]


def _visible(m):
    try:
        return any(max(f.get_fill_opacity(), f.get_stroke_opacity()) > 0.05 for f in m.family_members_with_points())
    except Exception:
        return True


def _name(p):
    return str(getattr(p, "text", None) or getattr(p, "tex_string", "?"))[:24]


class Clip(Scene):
    """A Scene that knows the narration. self.at(i) waits until word i starts being spoken."""

    def setup(self):
        self.cues, self.layout = [], []

    def play(self, *args, **kwargs):
        super().play(*args, **kwargs)
        # A fade-in that leaves its target invisible passes every other check, so catch it here.
        for a in args:
            if isinstance(a, FadeIn) and not _visible(a.mobject):
                self.layout.append({"at_word": -1, "kind": "still_invisible_after_FadeIn", "what": type(a.mobject).__name__ + " (it was set to zero opacity first, so FadeIn restores zero)"})

    def at(self, i):
        t = WORDS[i]["start"]
        lag = t - self.time
        self.cues.append({"word": i, "text": WORDS[i]["text"], "want": round(t, 3), "got": round(max(t, self.time), 3), "late": round(max(0, -lag), 3)})
        if lag > 1 / config.frame_rate:
            self.wait(lag)
        self._check(i)

    def _check(self, i):
        tops = [m for m in self.mobjects if _visible(m)]
        for m in tops:
            if m.get_top()[1] > 4.02 or m.get_bottom()[1] < -4.02 or m.get_left()[0] < -2.27 or m.get_right()[0] > 2.27:
                self.layout.append({"at_word": i, "kind": "off_frame", "what": type(m).__name__})
        pieces = [p for m in tops for p in _leaves(m) if _visible(p)]
        for p in pieces:
            if p.get_bottom()[1] < BOTTOM - 0.05:
                self.layout.append({"at_word": i, "kind": "in_caption_band", "what": _name(p)})
        for a in range(len(pieces)):
            for b in range(a + 1, len(pieces)):
                p, q = pieces[a], pieces[b]
                dx = min(p.get_right()[0], q.get_right()[0]) - max(p.get_left()[0], q.get_left()[0])
                dy = min(p.get_top()[1], q.get_top()[1]) - max(p.get_bottom()[1], q.get_bottom()[1])
                if dx > 0.03 and dy > 0.03 and dx * dy > 0.25 * min(p.width * p.height, q.width * q.height):
                    self.layout.append({"at_word": i, "kind": "text_overlap", "what": f"{_name(p)} / {_name(q)}"})

    def tear_down(self):
        self._check(len(WORDS) - 1)
        over = self.time - DURATION
        if over < 0:
            self.wait(-over)
        with open(os.environ["BV_REPORT"], "w") as f:
            json.dump({"cues": self.cues, "layout": self.layout, "over": round(max(0, over), 3), "scene_seconds": round(self.time, 3)}, f, indent=0)
