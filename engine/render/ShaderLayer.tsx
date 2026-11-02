// Draws a shader onto a canvas inside the picture. One hidden WebGL context does all of them, because a page may only
// hold a few, and each result is copied to its part's own canvas. Nothing carries between frames.
import React, { useLayoutEffect, useRef } from "react";
import { shaderSource, wrapShader } from "./shaders.ts";

type Job = { source: string; time: number; params: number[]; colors: [string, string, string] };
type Gl = { gl: WebGLRenderingContext; programs: Map<string, WebGLProgram> };
let shared: Gl | undefined;

function context(): Gl {
  if (shared) return shared;
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false });
  if (!gl) throw new Error("shaders need WebGL, and this browser has none. Render with chromiumOptions gl set to angle.");
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  shared = { gl, programs: new Map() };
  return shared;
}

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, source);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`shader failed: ${gl.getShaderInfoLog(s)}`);
  return s;
}

function program(ctx: Gl, source: string): WebGLProgram {
  const hit = ctx.programs.get(source);
  if (hit) return hit;
  const { gl } = ctx;
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, "attribute vec2 a; varying vec2 v_uv; void main() { v_uv = vec2(a.x * 0.5 + 0.5, 0.5 - a.y * 0.5); gl_Position = vec4(a, 0.0, 1.0); }"));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, wrapShader(shaderSource(source))));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`shader failed: ${gl.getProgramInfoLog(p)}`);
  ctx.programs.set(source, p);
  return p;
}

const rgb = (c: string) => [1, 3, 5].map((i) => (parseInt(c.slice(i, i + 2), 16) || 0) / 255) as [number, number, number];

function draw(target: HTMLCanvasElement, job: Job) {
  const ctx = context();
  const { gl } = ctx;
  const p = program(ctx, job.source);
  const [w, h] = [target.width, target.height];
  gl.canvas.width = w;
  gl.canvas.height = h;
  gl.viewport(0, 0, w, h);
  gl.useProgram(p);
  const a = gl.getAttribLocation(p, "a");
  gl.enableVertexAttribArray(a);
  gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
  gl.uniform1f(gl.getUniformLocation(p, "u_time"), job.time);
  gl.uniform2f(gl.getUniformLocation(p, "u_size"), w, h);
  gl.uniform1fv(gl.getUniformLocation(p, "u_params"), new Float32Array(Array.from({ length: 8 }, (_, i) => job.params[i] ?? 0)));
  (["u_a", "u_b", "u_c"] as const).forEach((name, i) => gl.uniform3fv(gl.getUniformLocation(p, name), rgb(job.colors[i])));
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  const out = target.getContext("2d")!;
  out.clearRect(0, 0, w, h);
  out.drawImage(gl.canvas as HTMLCanvasElement, 0, 0);
}

export const ShaderLayer: React.FC<Job & { w: number; h: number; density: number }> = ({ w, h, density, ...job }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const [pw, ph] = [Math.max(1, Math.round(w * density)), Math.max(1, Math.round(h * density))];
  useLayoutEffect(() => draw(ref.current!, job));
  return (
    <foreignObject x={-w / 2} y={-h / 2} width={w} height={h}>
      <canvas ref={ref} width={pw} height={ph} style={{ display: "block", width: w, height: h }} />
    </foreignObject>
  );
};
