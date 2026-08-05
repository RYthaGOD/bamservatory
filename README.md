<img src="assets/logo.png" width="88" align="left" alt="BAMservatory emblem">

# BAMservatory

**An independent transparency & early-warning layer for Jito's Block Assembly
Marketplace (BAM).** No token, no chain — a public-good dashboard built entirely
from the public BAM API.

🔗 **Live:** https://rythagod.github.io/bamservatory/ &nbsp;·&nbsp; _custom domain (bamservatory.xyz) coming_

<br clear="left">

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
| `brief.js` | Writes `briefing.json` — BAMsey's situational note (see below) |
| `build.js` | Renders `metrics.json` + `briefing.json` → a single self-contained `index.html` (inline CSS, server-rendered SVG, no JS, no deps) |
| `metrics.json` | Open data export — the numbers behind the dashboard |
| `briefing.json` | The published briefing, with its provenance |
| `index.html` | The dashboard GitHub Pages serves |

Rebuild from a capture directory (defaults to `d:/bam-net-ticks`):

```bash
node stats.js --dir /path/to/capture   # → metrics.json
node brief.js                          # → briefing.json
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

## BAMsey

<img src="assets/bamsey.png" width="72" align="left" alt="BAMsey, the Observatory sentinel">

The Observatory's sentinel. Every 60 seconds he re-reads the public BAM API,
recomputes concentration, and raises a flag the moment a structural rollover's
precursor appears. The status badge in the site header is driven by live data,
not decoration: it turns amber whenever the node Nakamoto coefficient falls to 3
or below.

<br clear="left">

### The briefing, and why you can trust its numbers

`brief.js` asks a language model for the short situational note at the top of the
dashboard. A dashboard whose whole claim is *verifiable numbers* cannot hand a
language model a microphone, so the model is deliberately boxed in:

1. **It never sees the raw data and never does arithmetic.** Every figure is
   computed by `stats.js` and handed over as a closed `FACTS` set. The model's job
   is to decide what *matters*, not what is *true*.
2. **Every numeral it writes back is checked** against that set before publication
   (with a tolerance for presentation rounding). A note citing any figure that
   isn't in the data is rejected and regenerated.
3. **If it fails twice, it is discarded** and a deterministic, template-generated
   briefing is published instead. The page can therefore never show an invented
   number — the worst case is a duller sentence.
4. **The provenance is printed on the page**: which model wrote it, when, and
   whether the figures were cross-checked.

It self-throttles to at most one call per hour and refreshes at least every six
hours, so it costs cents per month and cannot spam the API.

```bash
# Configure (never commit the key — .env is gitignored)
echo 'OPENAI_API_KEY=sk-...' > .env
node brief.js --force

node brief.js --dry-run       # show the exact prompt + allowed numbers, call nothing
node brief.js --list-models   # what this key can reach
OPENAI_MODEL=... node brief.js --force   # override the model
```

The default model is `gpt-5.5`, chosen by comparison rather than habit: on this
prompt the mini tier padded to 95 words and re-listed metrics the tables already
show, while `gpt-5.5` led with the change in ~55. At one call per hour the price
difference is immaterial. Any chat-completions model works — parameter differences
(`max_tokens` vs `max_completion_tokens`, unsupported `temperature`) and reasoning
models that exhaust their budget before emitting text are all handled by retry.

There is no browser-side API call anywhere on this site, and no key is ever
shipped to a visitor — the briefing is generated at build time and baked into the
static HTML.

## License

MIT — the metrics are meant to be independently reproducible.
