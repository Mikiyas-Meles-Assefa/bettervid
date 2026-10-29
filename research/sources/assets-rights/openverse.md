# Openverse API (retrieved 2026-10-29)
URL: https://api.openverse.org/v1/ , https://docs.openverse.org/api/reference/made_with_ov.html
- Live header test (anonymous, no key): x-ratelimit-limit-anon_burst: 20/min ; x-ratelimit-limit-anon_sustained: 200/day
- Docs: "containing over 800 million images and audio tracks"; "cannot make any claims about the accuracy of license information"
- Result fields (live): license, license_version, license_url, creator, creator_url, foreign_landing_url, url, attribution (ready-made string), provider, width, height. Filter e.g. license_type=commercial.
- Media types: images and audio only (no video endpoint seen).
