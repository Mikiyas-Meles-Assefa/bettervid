// Shot types 1, 2, 4 and 9 from docs/PLAN.md section 5. Each fills the frame for its clip's duration.
import React from "react";
import { AbsoluteFill, Easing, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { Clip, StyleFile } from "../schemas/project.ts";
import { Marks } from "./marks.tsx";

type ShotProps = { clip: Clip; style: StyleFile; index: number };

const Paper: React.FC<{ style: StyleFile; children?: React.ReactNode }> = ({ style, children }) => (
  <AbsoluteFill style={{ backgroundColor: style.palette.paper }}>
    <AbsoluteFill style={{ background: `radial-gradient(ellipse at 30% 20%, rgba(255,255,255,0.35), transparent 60%)` }} />
    {children}
  </AbsoluteFill>
);

// 1. photo_kenburns: full-bleed still with a slow push-in and drift, direction alternating per shot.
// With a focus, it becomes a guided zoom: from the whole image into the part the narration is talking about, then circles it.
export const PhotoKenBurns: React.FC<ShotProps> = (props) => (props.clip.focus && props.clip.size ? <GuidedZoom {...props} /> : <PushIn {...props} />);

const PushIn: React.FC<ShotProps> = ({ clip, index }) => {
  const frame = useCurrentFrame();
  const t = frame / clip.frames;
  const scale = clip.punch ? interpolate(t, [0, 1], [1.45, 1.6]) : interpolate(t, [0, 1], [1.04, 1.16]);
  const dx = interpolate(t, [0, 1], [0, index % 2 ? -30 : 30]);
  return (
    <AbsoluteFill style={{ backgroundColor: "#111" }}>
      <Img src={staticFile(clip.image!)} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${scale}) translateX(${dx}px)` }} />
    </AbsoluteFill>
  );
};

const GuidedZoom: React.FC<ShotProps> = ({ clip, style }) => {
  const frame = useCurrentFrame();
  const { fps, width: W, height: H } = useVideoConfig();
  const [iw, ih] = clip.size!;
  const f = clip.focus!;
  const box = { x: f.x * iw, y: f.y * ih, w: f.w * iw, h: f.h * ih };
  // Start covering the frame. With a zoom, end with the focus plus some context filling it (archival scans hold up to
  // about 2.6x the cover scale before they look soft); without one, only pan so the focus is in view.
  const cover = Math.max(W / iw, H / ih);
  const region = { w: Math.max(box.w * 2.4, iw * 0.3), h: Math.max(box.h * 2.4, ih * 0.2) };
  const end = clip.zoom ? Math.min(Math.max(Math.min(W / region.w, H / region.h), cover * 1.2), cover * 2.6) : cover * 1.06;
  // The move takes up to 2.2 s and lands before the clip is half over, then keeps drifting in slowly.
  const land = Math.min(clip.frames * 0.5, 2.2 * fps);
  const e = interpolate(frame, [0, land], [0, 1], { extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) });
  const after = Math.max(0, frame - land) / fps;
  const s = (cover * 1.02 + (end - cover * 1.02) * e) * (1 + 0.012 * after);
  const cx = interpolate(e, [0, 1], [iw / 2, box.x + box.w / 2]);
  const cy = interpolate(e, [0, 1], [ih / 2, box.y + box.h / 2]);
  // Aim the focus a little above center, clear of the captions, without showing past the image's edges.
  const tx = Math.min(0, Math.max(W - iw * s, W / 2 - cx * s));
  const ty = Math.min(0, Math.max(H - ih * s, H * 0.4 - cy * s));
  return (
    <AbsoluteFill style={{ backgroundColor: "#111", overflow: "hidden" }}>
      <Img src={staticFile(clip.image!)} style={{ position: "absolute", left: 0, top: 0, width: iw, height: ih, maxWidth: "none", transformOrigin: "0 0", transform: `translate(${tx}px, ${ty}px) scale(${s})` }} />
      {!!clip.marks?.length && <Marks marks={clip.marks} view={{ tx, ty, s, iw, ih }} style={style} />}
    </AbsoluteFill>
  );
};

// 2. cutout_on_paper: a SAM cutout (outline and shadow baked in) springs onto paper, with the source image faint behind it.
export const CutoutOnPaper: React.FC<ShotProps> = ({ clip, style, index }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 13, stiffness: 120 } });
  const side = index % 2 ? 1 : -1;
  const drift = interpolate(frame, [0, clip.frames], [0, 18]);
  return (
    <Paper style={style}>
      {clip.image && (
        <Img src={staticFile(clip.image)} style={{ position: "absolute", width: "100%", height: "100%", objectFit: "cover", opacity: 0.18, filter: "grayscale(1) blur(2px)" }} />
      )}
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <Img
          src={staticFile(clip.cutout!)}
          style={{
            maxWidth: "88%",
            maxHeight: "58%",
            marginBottom: 260,
            transform: `translateX(${side * interpolate(enter, [0, 1], [800, 0])}px) translateY(${-drift}px) rotate(${side * -2.5}deg) scale(${interpolate(enter, [0, 1], [0.9, 1])})`,
          }}
        />
      </AbsoluteFill>
    </Paper>
  );
};

// 4. receipt: a re-typeset source card; the quoted line gets a highlighter sweep.
export const Receipt: React.FC<ShotProps> = ({ clip, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const r = clip.receipt!;
  const enter = spring({ frame, fps, config: { damping: 15 } });
  const sweep = interpolate(frame, [12, 12 + fps * 0.8], [0, 100], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <Paper style={style}>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div
          style={{
            width: 900,
            marginBottom: 320,
            padding: "56px 60px",
            backgroundColor: "#fdfcf7",
            boxShadow: "0 18px 40px rgba(0,0,0,0.35)",
            transform: `translateY(${interpolate(enter, [0, 1], [300, 0])}px) rotate(-1.5deg)`,
            fontFamily: style.fonts.body,
            color: style.palette.ink,
          }}
        >
          <div style={{ fontSize: 34, letterSpacing: 4, textTransform: "uppercase", opacity: 0.7 }}>{r.outlet}{r.date ? ` · ${r.date}` : ""}</div>
          <div style={{ height: 3, background: style.palette.ink, opacity: 0.6, margin: "22px 0 30px" }} />
          <div style={{ fontSize: 54, lineHeight: 1.3 }}>
            <span style={{ backgroundImage: `linear-gradient(${style.palette.highlight}, ${style.palette.highlight})`, backgroundRepeat: "no-repeat", backgroundSize: `${sweep}% 100%`, boxDecorationBreak: "clone", WebkitBoxDecorationBreak: "clone" }}>
              “{r.quote}”
            </span>
          </div>
          <div style={{ fontSize: 26, marginTop: 34, opacity: 0.55, wordBreak: "break-all" }}>{r.url.replace(/^https?:\/\//, "")}</div>
        </div>
      </AbsoluteFill>
    </Paper>
  );
};

// 9. kinetic_title / keyword_slam: big words slam in one after another with a short shake.
export const KineticTitle: React.FC<ShotProps> = ({ clip, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const words = (clip.text ?? "").split(/\s+/).filter(Boolean);
  const per = Math.max(4, Math.floor(Math.min(clip.frames * 0.6, fps * 1.2) / Math.max(1, words.length)));
  // The longest word must fit the width; on a board the title is written on the board itself, not on a dark card.
  const board = style.motion === "board";
  const longest = Math.max(1, ...words.map((w) => w.length));
  const size = Math.min(words.length > 4 ? 120 : 160, 1480 / longest);
  return (
    <AbsoluteFill style={{ backgroundColor: board ? style.palette.paper : style.palette.ink, alignItems: "center", justifyContent: "center" }}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "10px 28px", padding: "0 70px", marginBottom: board ? 0 : 300 }}>
        {words.map((w, i) => {
          const f = frame - i * per;
          const s = spring({ frame: f, fps, config: { damping: 9, stiffness: 220 } });
          const shake = f >= 0 && f < 6 ? Math.sin(f * 2.4) * (6 - f) * 2 : 0;
          return (
            <span
              key={i}
              style={{
                fontFamily: style.fonts.title,
                fontWeight: 900,
                fontSize: size,
                lineHeight: 1.05,
                textTransform: "uppercase",
                color: i === words.length - 1 ? (board ? style.palette.accent : style.palette.highlight) : board ? style.palette.ink : style.palette.paper,
                opacity: f >= 0 ? 1 : 0,
                transform: `scale(${interpolate(s, [0, 1], [2.2, 1])}) translateX(${shake}px)`,
                display: "inline-block",
              }}
            >
              {w}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// The end card: where the facts came from and who made the images. Long lists use smaller type, so all of it fits.
export const CreditsCard: React.FC<ShotProps> = ({ clip, style }) => {
  const frame = useCurrentFrame();
  const { sources, images } = clip.credits!;
  const size = Math.max(22, Math.min(36, 760 / (sources.length + images.length + 4)));
  const fade = interpolate(frame, [0, 12], [0, 1], { extrapolateRight: "clamp" });
  const list = (title: string, items: string[]) => (
    <div style={{ marginBottom: 56 }}>
      <div style={{ fontFamily: style.fonts.title, fontWeight: 700, fontSize: 52, color: style.palette.accent, marginBottom: 18 }}>{title}</div>
      {items.map((t, i) => (
        <div key={i} style={{ fontFamily: style.fonts.body, fontSize: size, lineHeight: 1.35, color: style.palette.ink }}>
          {t}
        </div>
      ))}
    </div>
  );
  return (
    <Paper style={style}>
      <AbsoluteFill style={{ padding: "200px 90px", opacity: fade }}>
        {!!sources.length && list("Sources", sources)}
        {!!images.length && list("Images", images)}
      </AbsoluteFill>
    </Paper>
  );
};

export const SHOTS = { photo_kenburns: PhotoKenBurns, cutout_on_paper: CutoutOnPaper, receipt: Receipt, kinetic_title: KineticTitle, credits: CreditsCard };
