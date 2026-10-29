# S10: critic video token cost

Date: 2026-10-29. Scripts: `scripts/spikes/s10-video-tokens.ts` (free count endpoint), `scripts/spikes/s10b-video-cost.ts` (paid probe). Clips and raw responses: `media/spikes/s10/`, `media/spikes/s10b/` (gitignored), logs `media/spikes/logs/s10*.log`.

**Verdict: PASS on cost, with a warning on long clips.** Spark 1.3 video input costs about **261 input tokens per second**, linear, no cap seen up to 60 s. A 30 s render is about 7.9k tokens, about $0.01 of input. It samples at **2 fps**. Accuracy is perfect on a 10 s clip but drops on a 60 s one, and reasoning eats the output budget, so the critic should watch the video in short chunks.

## Part 1: the free count endpoint can't price video
- `POST /v1/responses/input_tokens` returns +1 token per video (+2 with audio) for any length, sent as an inline data URL or as a Files API `file_id`, as `input_video` or `input_file`. It counts a placeholder, not frames. Don't use it for video budgeting.
- Files API upload (`purpose=user_data`) works: 4 s for 1.3 MB, 20 s for 15.7 MB.

## Part 2: paid probe
Clips: 1080x1920, 30 fps, a new frame every 0.1 s showing a big "T <seconds>" and "F <frame number>". Model asked to list every pair it can read. `muse-spark-1.3`, `max_output_tokens: 4000`, video by `file_id`.

| Clip | Effort | Input tokens | Per second | Output (reasoning) | Latency | Pairs read | Correct | Cost |
|---|---|---|---|---|---|---|---|---|
| 10 s | low | 2,673 | 267 | 1,047 (853) | 7.8 s | 20 | 20 | $0.008 |
| 30 s | low | 7,873 | 262 | 4,000 (3,998) | 35.4 s | 0, ran out | n/a | $0.027 |
| 60 s | low | 15,673 | 261 | 4,000 (3,998) | 27.1 s | 0, ran out | n/a | $0.037 |
| 60 s | minimal | 15,673 | 261 | 4,000 (3,529) | 24.6 s | 51, stopped at 38 s | 32 of 51 | $0.037 |

The text prompt is about 80 tokens, so video is ~260 tokens per second, or ~130 tokens per sampled frame.

## What we learned
- **Sampling is 2 fps** (pairs every 0.5 s on the 10 s clip). Anything shorter than 0.5 s, like a one-frame glitch or a fast kinetic word, can be missed. Keep the planned backups: per-shot keyframes and automatic checks.
- **Reasoning eats the output budget.** Even `minimal` spent 3.5k tokens thinking. With a 4k cap the 30 s and 60 s runs returned nothing (`status: incomplete`, `max_output_tokens`). The critic must set `max_output_tokens` to 16k or more and ask for compact JSON tickets, not long lists.
- **Accuracy drops with length.** 10 s: 20 of 20 right. 60 s: only 32 of 51 right, with invented frame numbers early on. Critique in chunks of about 10 s (one or two shots each, with the shot list for context), not the whole video in one call. Cost is the same either way since it's per second.
- 30 s video, critiqued in 3 chunks at ~2.7k input plus ~2k output tokens each, comes to about $0.035 per critic pass.

## Network gotcha
- Three early runs died with `ETIMEDOUT` at TCP connect to api.meta.ai (IPv6 unreachable, IPv4 slow from Doha). Fixed two ways: `setDefaultAutoSelectFamilyAttemptTimeout(2000)` in `scripts/lib/util.ts` (root cause) and network-error retries in `scripts/lib/meta.ts`. The pipeline's Meta client needs both.

## Cost
- Paid probe: 4 calls, about $0.11. Ten test clips are stored on the Meta Files API (no expiry set).
