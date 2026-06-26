# Rebuild the BAM Observatory and publish to GitHub Pages.
#   .\deploy.ps1 [-Dir d:/bam-net-ticks]
# Requires git auth configured for push.
param([string]$Dir = "d:/bam-net-ticks")
Set-Location $PSScriptRoot

node stats.js --dir $Dir
node build.js

$changed = git status --porcelain index.html metrics.json
if (-not $changed) { Write-Host "no change - nothing to publish."; exit 0 }

git add index.html metrics.json
git commit -m "data refresh $(Get-Date -Format 'yyyy-MM-ddTHH:mmZ')" --quiet
git push --quiet
Write-Host "published $(Get-Date -Format 'yyyy-MM-ddTHH:mmZ')."
