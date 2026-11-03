# Measures voice sync from the video itself, not from what the scene claims: for each cue, when do the pixels start to change?
# Run with Manim's Python: measure.py clip.mp4 report.json
import json, sys
import av
import numpy as np

video, report = sys.argv[1], json.load(open(sys.argv[2]))
frames = []
c = av.open(video)
for f in c.decode(video=0):
    frames.append(np.asarray(f.reformat(width=270, height=480, format="gray").to_ndarray(), dtype=np.int16))
fps = float(c.streams.video[0].average_rate)
# Share of pixels that changed between frames. Ignores encoder noise.
diff = np.array([0.0] + [float((np.abs(frames[i] - frames[i - 1]) > 18).mean()) for i in range(1, len(frames))])
active = diff > 0.00004
rows = []
for cue in report["cues"]:
    a, b = int((cue["want"] - 0.25) * fps), int((cue["want"] + 0.75) * fps)
    hit = next((i for i in range(max(a, 1), min(b, len(active))) if active[i]), None)
    # A change already running before the cue is the previous animation overrunning; look for the cue's own frame.
    rows.append({"word": cue["text"], "want": cue["want"], "onset": None if hit is None else round(hit / fps, 3), "error": None if hit is None else round(hit / fps - cue["want"], 3), "late_reported": cue["late"]})
err = [abs(r["error"]) for r in rows if r["error"] is not None]
print(json.dumps({
    "cues": len(rows), "no_change_near_cue": sum(r["error"] is None for r in rows),
    "mean_abs_s": round(float(np.mean(err)), 3) if err else None, "max_abs_s": round(float(np.max(err)), 3) if err else None,
    "within_1_frame": sum(e <= 1.01 / fps for e in err), "within_100ms": sum(e <= 0.1 for e in err),
    "rows": rows,
}))
