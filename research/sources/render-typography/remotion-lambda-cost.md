# Remotion Lambda cost and runtime
URLs: https://www.remotion.dev/docs/lambda/cost-example , /docs/lambda/runtime , /docs/gpu , /docs/gl-options , /docs/cloudrun , /docs/performance
Retrieved: 2026-10-29
- Test: 2048 MB, us-east-1, Remotion 4.0.381. 1-minute video (1440 frames): warm $0.017 / 18.91s, cold $0.021 / 15.52s. 10-min remote HD: $0.103 / 56.09s warm. 10s 4K: $0.013 / 45.28s.
- "Embedding a video in a composition increases the cost significantly." Excludes S3 egress, storage, CloudWatch, licensing.
- Lambda landing page (via search summary): 80s video in 15s, up to 200x concurrency, from $0.01/min with frames-per-lambda=12, ARM64, 2048MB.
- vCPU by memory: 128-3008MB 2 vCPU; 3009-5307 3; 5308-7076 4; 7077-8845 5; 8846+ 6. Disk 512MB-10GB.
- "AWS Lambda instances have no GPU". gl default on Lambda/Cloud Run: swangle. Three.js needs angle (desktop) / angle-egl (GPU cloud) / swangle (Lambda).
- Cloud Run: "Alpha status and not actively being developed". Limits 32GB, 8 vCPU, 60 min. Automators plan needed.
- GPU server guide: g4dn.xlarge ~$375/month, --gl=vulkan with chrome-for-testing. No benchmark numbers.
- Slow in headless: box-shadow, text-shadow, gradients, filter blur/drop-shadow (swap for precomputed image). PNG slower than JPEG frames. vp8/vp9 slow. Use <Video> from @remotion/media.
