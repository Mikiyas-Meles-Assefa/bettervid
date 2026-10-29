# S9: Muse Image `n=4` vs 150 RPM

Date: 2026-10-29. Script: `scripts/spikes/s9-image-n4-rpm.ts`. Raw output: `media/spikes/s9/` (gitignored), log `media/spikes/logs/s9.log`.

**Verdict: PASS.** One `n=4` call returns 4 images in about the time of one, and the rate-limit header shows it as at most one request. Best-of-4 costs 4x the money but not 4x the rate limit or the wait.

## Inputs
- `muse-image-1.0`, `size: 1024x1792`, `reasoning_strength: low`, flat illustrated poster of a water pump on a cobbled street.
- One call with `n: 1`, then one with `n: 4`, reading `x-ratelimit-remaining-requests` after each.

## Outputs

| Call | Images | Latency | remaining-requests after | usage tokens (in / out) |
|---|---|---|---|---|
| n=1 | 1 | 25.6 s | 148 of 150 | 4,021 / 1,083 |
| n=4 | 4 | 28.3 s | 149 of 150 | 16,084 / 3,952 |

- The window is rolling: S1's three calls a minute earlier showed 149, 148, 149. The `n=4` call left 149, so it cost at most one request. If it counted as 4 the header would have dropped.
- Token usage scales exactly 4x, so billing is per image ($0.04 for the `n=4` call).
- The 4 images are clearly different compositions (layout, palette, framing), so `n=4` is a real choice for a picker, not 4 near copies.
- All came back 1152x2016 (see S1: use 1152x2048).

## What this means for the plan
- With 150 RPM per call, a 30 s video with ~12 shots at `n=4` is 12 requests and 48 images ($0.48). Rate limit is not the constraint; money and the picker's judgment are.
- `x-ratelimit-remaining-requests` is the signal to throttle on, plus Retry-After on 429s.

## Cost
- 5 images, $0.05.
