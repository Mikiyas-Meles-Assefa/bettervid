#!/bin/sh
# Seeds the hosted gallery with finished projects: packs the given project folders (video, project file, thumbnail,
# the scene stills the studio shows) and unpacks them on the Fly machine's volume. Usage: scripts/fly-seed.sh <id> [<id>...]
set -e
[ $# -gt 0 ] || { echo "usage: scripts/fly-seed.sh <project-id> [<project-id>...]"; exit 1; }
for id in "$@"; do [ -f "projects/$id/video.mp4" ] || { echo "no video in projects/$id"; exit 1; }; done
tmp=$(mktemp -t bettervid-seed).tgz
# Everything but the heavy intermediates: the mix, the picture-only render, raw stills folders are left out.
tar -czf "$tmp" --exclude='*/picture.mp4' --exclude='*/mix.wav' --exclude='*/narration.mp3' --exclude='*/once' --exclude='*/look*' -C projects "$@"
echo "packed $(du -h "$tmp" | cut -f1) for $#"
# Streamed straight into tar on the volume: no copy on the machine's small root disk.
fly ssh console -C "sh -c 'tar -xzf - -C /srv/projects && ls /srv/projects'" < "$tmp"
rm -f "$tmp"
echo "seeded; the gallery reads the volume on the next request"
