#!/usr/bin/env bash
# Rebuild the BAM Observatory from the latest capture and publish to GitHub Pages.
# Run manually, or append to the capture cron (tick-once.sh) for auto-refresh.
#
#   ./deploy.sh [capture_dir]      # default: d:/bam-net-ticks
#
# Requires: git auth configured for push (gh auth / credential manager / SSH).
set -euo pipefail
# The ambient GITHUB_TOKEN env var is invalid and masks the working gh keyring
# credentials; clear it so `git push` (via the gh credential helper) authenticates.
unset GITHUB_TOKEN GH_TOKEN
cd "$(dirname "$0")"
DIR="${1:-d:/bam-net-ticks}"

node stats.js --dir "$DIR"
# BAMsey's briefing is best-effort: it self-throttles, and a bad key or an API
# outage must never block a data publish. It always leaves a usable briefing.json.
node brief.js || echo "brief.js failed — publishing with the previous briefing."
node build.js

if git diff --quiet -- index.html metrics.json briefing.json; then
  echo "no change — nothing to publish."
  exit 0
fi
git add index.html metrics.json briefing.json
git commit -m "data refresh $(date -u +%Y-%m-%dT%H:%MZ)" --quiet
git push --quiet
echo "published $(date -u +%Y-%m-%dT%H:%MZ)."
