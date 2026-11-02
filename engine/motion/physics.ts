// Real physics, solved in closed form. Position is a function of time alone, with no stepping and no stored state, so
// any frame can be asked for in any order and always gets the same answer.

export type Spring = { stiffness: number; damping: number; mass: number };

// Where a spring is `t` seconds after release, `delta` from rest and moving at `velocity`. Returns distance from rest.
export function springAt(t: number, delta: number, velocity: number, s: Spring): number {
  const w0 = Math.sqrt(s.stiffness / s.mass);
  const zeta = s.damping / (2 * Math.sqrt(s.stiffness * s.mass));
  if (zeta < 1 - 1e-6) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    return Math.exp(-zeta * w0 * t) * (delta * Math.cos(wd * t) + ((velocity + zeta * w0 * delta) / wd) * Math.sin(wd * t));
  }
  if (zeta > 1 + 1e-6) {
    const r = w0 * Math.sqrt(zeta * zeta - 1);
    const [r1, r2] = [-zeta * w0 + r, -zeta * w0 - r];
    const a = (velocity - r2 * delta) / (r1 - r2);
    return a * Math.exp(r1 * t) + (delta - a) * Math.exp(r2 * t);
  }
  return Math.exp(-w0 * t) * (delta + (velocity + w0 * delta) * t);
}

// How long until a spring has come to rest, to within `tolerance` of distance.
export function springSettles(delta: number, velocity: number, s: Spring, tolerance: number, limit = 20): number {
  let quiet = 0;
  for (let t = limit; t >= 0; t -= 1 / 60) {
    if (Math.abs(springAt(t, delta, velocity, s)) > tolerance) break;
    quiet = t;
  }
  return quiet;
}

export type Fall = { y: number; vy: number; floor: number; gravity: number; bounce: number; minHop: number };
export type Flight = { start: number; y: number; vy: number };

// Each flight between bounces, worked out once. Time is in seconds. y grows downward, as on screen.
export function flights(f: Fall): { list: Flight[]; rest: number } {
  const list: Flight[] = [];
  let [t, y, vy] = [0, f.y, f.vy];
  for (let i = 0; i < 64; i++) {
    list.push({ start: t, y, vy });
    const drop = f.floor - y;
    const hit = (-vy + Math.sqrt(Math.max(0, vy * vy + 2 * f.gravity * drop))) / f.gravity;
    t += hit;
    const land = vy + f.gravity * hit;
    vy = -land * f.bounce;
    y = f.floor;
    if ((vy * vy) / (2 * f.gravity) < f.minHop) return { list, rest: t };
  }
  return { list, rest: t };
}

export function fallAt(t: number, f: Fall, path: { list: Flight[]; rest: number }): number {
  if (t >= path.rest) return f.floor;
  let now = path.list[0]!;
  for (const leg of path.list) if (leg.start <= t) now = leg;
  const s = t - now.start;
  return Math.min(f.floor, now.y + now.vy * s + 0.5 * f.gravity * s * s);
}
