# Rebuild the BAM Observatory and publish to GitHub Pages.
#   .\deploy.ps1 [-Dir d:/bam-net-ticks]
# Requires git auth configured for push.
param([string]$Dir = "d:/bam-net-ticks")
Set-Location $PSScriptRoot

node stats.js --dir $Dir
# Best-effort: a bad key or an API outage must never block a data publish.
node brief.js; if (-not $?) { Write-Host "brief.js failed - publishing with the previous briefing." }
node build.js

$changed = git status --porcelain index.html metrics.json briefing.json
if (-not $changed) { Write-Host "no change - nothing to publish."; exit 0 }

git add index.html metrics.json briefing.json
git commit -m "data refresh $(Get-Date -Format 'yyyy-MM-ddTHH:mmZ')" --quiet
git push --quiet
Write-Host "published $(Get-Date -Format 'yyyy-MM-ddTHH:mmZ')."
