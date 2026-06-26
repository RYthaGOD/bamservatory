#!/usr/bin/env bash
# Rebuild the BAM Observatory from the latest capture and publish to GitHub Pages.
# Run manually, or append to the capture cron (tick-once.sh) for auto-refresh.
#
#   ./deploy.sh [capture_dir]      # default: d:/bam-net-ticks
#
# Requires: git auth configured for push (gh auth / credential manager / SSH).
set -euo pipefail
cd "$(dirname "$0")"
DIR="${1:-d:/bam-net-ticks}"

node stats.js --dir "$DIR"
node build.js

if git diff --quiet -- index.html metrics.json; then
  echo "no change — nothing to publish."
  exit 0
fi
git add index.html metrics.json
git commit -m "data refresh $(date -u +%Y-%m-%dT%H:%MZ)" --quiet
git push --quiet
echo "published $(date -u +%Y-%m-%dT%H:%MZ)."
