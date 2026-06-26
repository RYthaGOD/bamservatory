# BAMservatory

**An independent transparency & early-warning layer for Jito's Block Assembly
Marketplace (BAM).** No token, no chain — a public-good dashboard built entirely
from the public BAM API.

🔗 **Live:** https://rythagod.github.io/bamservatory/ &nbsp;·&nbsp; _custom domain (bamservatory.xyz) coming_

---

## Why

BAM now intermediates roughly **a third of all Solana stake**, yet there is no
independent public view of how it is structured or how it behaves. This
Observatory surfaces:

- **Decentralization** — Nakamoto coefficients (node / validator / region), HHI,
  and top-N concentration, tracked over time.
- **Topology** — every BAM node, its region, connected validators, and stake.
- **Whale Watch** — the validators steering BAM stake leadership.
- **Early warning** — structural TEE-rollover detection. On the 2026-06-24
  rollover it flagged the cutover **~22 minutes before it completed** by spotting
  the precursor node appearing.

## How it works

| File | Role |
|---|---|
| `stats.js` | Streams the captured BAM data → `metrics.json` (all computation lives here) |
| `build.js` | Renders `metrics.json` → a single self-contained `index.html` (inline CSS, server-rendered SVG, no JS, no deps) |
| `metrics.json` | Open data export — the numbers behind the dashboard |
| `index.html` | The dashboard GitHub Pages serves |

Rebuild from a capture directory (defaults to `d:/bam-net-ticks`):

```bash
node stats.js --dir /path/to/capture   # → metrics.json
node build.js                          # → index.html
```

A capture directory holds the flattened public-API snapshots
(`summary.csv`, `nodes.csv`, `validators.csv`) plus the event logs
(`detections.log`, `detections_replay.log`).

## Methodology

All figures derive from the public BAM API (`/nodes`, `/validators`,
`/bam_stake`), sampled ~every 60 seconds. **Nakamoto coefficient** = minimum
entities whose cumulative stake exceeds 50%. **HHI** = Herfindahl–Hirschman index
of node stake shares. **Early-warning** compares consecutive node sets and times
region cutovers against precursor node appearances.

## Honest scope

- **n = 1** validated structural rollover so far; the detector is live and
  accumulating more events to establish the precursor statistically.
- Frequent stake "leadership flips" are whale-driven toggles, **not** structural
  rollovers — the Observatory labels them as such and does not count them as
  early-warning wins.
- Data is reverse-engineered from the public API; BAM operators have richer
  internal telemetry. This project's value is **independence and indexing**, not
  privileged access.

## License

MIT — the metrics are meant to be independently reproducible.
