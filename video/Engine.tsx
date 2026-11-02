// The engine in the video: one compiled scene for the whole story, and the end card drawn on the same surface.
import React, { useEffect, useMemo, useState } from "react";
import { AbsoluteFill, cancelRender, continueRender, delayRender, interpolate, staticFile, useCurrentFrame } from "remotion";
import type { Scene, Theme, Value } from "../engine/core/types.ts";
import { SceneView } from "../engine/render/SceneView.tsx";
import { Surface } from "../engine/style/draw.tsx";
import type { Clip } from "../schemas/project.ts";

// Image sources in a scene are files in the project folder, which is Remotion's public dir.
const served = (v: Value): Value => (typeof v === "string" && v && !/^(https?:|data:|blob:|\/)/.test(v) ? staticFile(v) : v);

export function serveImages(scene: Scene): Scene {
  const images = scene.nodes.some((n) => n.kind === "image" && typeof n.props.src === "string");
  const tracks = scene.tracks.some((t) => t.prop === "src");
  if (!images && !tracks) return scene;
  return {
    ...scene,
    nodes: scene.nodes.map((n) => (n.kind === "image" && typeof n.props.src === "string" ? { ...n, props: { ...n.props, src: served(n.props.src) } } : n)),
    tracks: scene.tracks.map((t) => (t.prop === "src" ? { ...t, keys: t.keys.map((k) => ({ ...k, value: served(k.value) })) } : t)),
  };
}

export function imageSources(scene: Scene): string[] {
  const sources = new Set<string>();
  for (const n of scene.nodes) if (n.kind === "image" && typeof n.props.src === "string" && n.props.src) sources.add(n.props.src);
  for (const t of scene.tracks) if (t.prop === "src") for (const k of t.keys) if (typeof k.value === "string" && k.value) sources.add(k.value);
  return [...sources];
}

// An SVG image paints whenever it arrives, which could be after a frame is captured. Every image is decoded before the
// first frame, and the browser then paints it from memory.
const decoded = (sources: string[]) =>
  Promise.all(
    sources.map((src) => {
      const img = new Image();
      img.src = src;
      return img.decode().catch(() => {
        throw new Error(`scene image ${src} did not load`);
      });
    }),
  );

// The scene comes in the clip, or from a JSON file in the project folder (large scenes are kept out of the props, see
// pipeline/stages/render.ts). Frames wait until it and its images are in.
function useScene(clip: Clip, file?: string): Scene | null {
  const inline = useMemo(() => (clip.scene ? serveImages(clip.scene) : null), [clip.scene]);
  const [loaded, setLoaded] = useState<Scene | null>(null);
  const [handle] = useState(() => (inline && !imageSources(inline).length ? null : delayRender(file ? `loading scene ${file}` : "loading scene images")));
  useEffect(() => {
    if (handle === null) return;
    const scene: Promise<Scene> = inline
      ? Promise.resolve(inline)
      : !file
        ? Promise.reject(new Error(`engine clip ${clip.shotId} has no scene and no scene file`))
        : fetch(staticFile(file))
            .then((r) => {
              if (!r.ok) throw new Error(`scene file ${file}: ${r.status}`);
              return r.json() as Promise<Scene>;
            })
            .then(serveImages);
    scene
      .then((s) => decoded(imageSources(s)).then(() => s))
      .then((s) => {
        setLoaded(s);
        continueRender(handle);
      })
      .catch(cancelRender);
  }, [inline, file, handle, clip.shotId]);
  return inline ?? loaded;
}

export const EngineShot: React.FC<{ clip: Clip; sceneFile?: string }> = ({ clip, sceneFile }) => {
  const frame = useCurrentFrame();
  const scene = useScene(clip, sceneFile);
  if (!scene) return <AbsoluteFill style={{ backgroundColor: clip.theme!.colors.paper }} />;
  return <SceneView scene={scene} theme={clip.theme!} frame={frame} />;
};

// The end card in the scene's style: its surface, title font and colors.
export const EngineCredits: React.FC<{ clip: Clip }> = ({ clip }) => {
  const frame = useCurrentFrame();
  const theme: Theme = clip.theme!;
  const { sources, images } = clip.credits!;
  const c = theme.colors;
  const size = Math.max(24, Math.min(38, 760 / (sources.length + images.length + 4)));
  const fade = interpolate(frame, [0, 12], [0, 1], { extrapolateRight: "clamp" });
  const list = (title: string, items: string[]) => (
    <div style={{ marginBottom: 64 }}>
      <div style={{ fontFamily: theme.fonts.title, fontWeight: theme.style?.type.bold ?? 700, fontSize: 60, color: c.accent, marginBottom: 22 }}>{title}</div>
      {items.map((t, i) => (
        <div key={i} style={{ fontFamily: theme.fonts.body, fontSize: size, lineHeight: 1.4, color: c.ink }}>
          {t}
        </div>
      ))}
    </div>
  );
  return (
    <AbsoluteFill style={{ backgroundColor: c.paper }}>
      {theme.style && <Surface style={theme.style} color={c.paper!} theme={theme} width={1080} height={1920} />}
      <AbsoluteFill style={{ padding: "220px 100px", opacity: fade }}>
        {!!sources.length && list("Sources", sources)}
        {!!images.length && list("Images", images)}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
