<img src="assets/logo.png" width="88" align="left" alt="BAMservatory emblem">

# BAMservatory

**An independent transparency & early-warning layer for Jito's Block Assembly
Marketplace (BAM).** No token, no chain — a public-good dashboard built entirely
from the public BAM API.

🔗 **Live:** https://rythagod.github.io/bamservatory/ &nbsp;·&nbsp; _custom domain (bamservatory.xyz) coming_

<br clear="left">

[![verify](https://github.com/RYthaGOD/bamservatory-data/actions/workflows/verify.yml/badge.svg)](https://github.com/RYthaGOD/bamservatory-data/actions/workflows/verify.yml)

| | |
|---|---|
| **Open data** | [`metrics.json`](https://rythagod.github.io/bamservatory/metrics.json) — static, CORS-enabled, refreshed every ~15 min |
| **Field reference** | [SCHEMA.md](SCHEMA.md) — units, denominators, and a `schemaVersion` stability contract |
| **Raw archive** | [bamservatory-data](https://github.com/RYthaGOD/bamservatory-data) — every capture, hashed, day by day |
| **Collector** | [bam-net](https://github.com/RYthaGOD/bam-net) — the Rust client doing the capturing |

That badge is the shortest version of this project's claim. It runs on GitHub's
infrastructure rather than ours, and checks three things nobody here can quietly
influence: every archived day still hashes to what its manifest recorded, three
independent collectors still agree, and this dashboard has not gone stale.

Every figure below is a pure function of published inputs. You can recompute the
lot without asking us for anything — see [Verifying these numbers](#verifying-these-numbers).

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

Everything on the dashboard except the verification panel derives from the public
BAM API (`/nodes`, `/validators`, `/bam_stake`), sampled every 60 seconds.
**Nakamoto coefficient** = minimum entities whose cumulative stake exceeds 50%.
**HHI** = Herfindahl–Hirschman index of node stake shares. **Early-warning**
compares consecutive node sets and times region cutovers against precursor node
appearances.

That makes the bulk of this an *index of what BAM says about itself*. The
verification panel is the part that checks it, and it reads two sources BAM does
not control:

| Source | Used for |
|---|---|
| Solana RPC `getVoteAccounts` | Every BAM-listed validator's stake, looked up on chain. The chain is the authority; BAM's figures either match it or they do not. |
| [Jito's Kobe API](https://kobe.mainnet.jito.network) | Who is running BAM, published independently of the BAM explorer. |

It runs every 15 minutes rather than every 60 seconds — it pulls a full
vote-account set and Jito's whole validator table, and running that every minute
would be rude to three services to restate a figure that moves over hours. The
panel states its own read time for that reason.

Two honest limits on it. Membership still originates with Jito either way: a
BAM-produced block is indistinguishable from any other on chain, so the
cross-check is between two of Jito's own systems, not an independent derivation.
And BAM's published share and the chain-derived one use different network
totals, so the small gap between them is a denominator difference, not a
misstatement of BAM's stake — the numerators agree to the cent.

### When a capture comes back incomplete

The API sometimes returns a coherent but incomplete view: on 2026-07-01, three
consecutive captures reported 291 validators and 116.8M SOL between captures
reporting 380 and 142.0M, then recovered exactly. A quarter of BAM's stake did
not leave and return within three minutes.

Nothing inside such a record looks wrong — its totals agree with its own
contents — so these were recorded as observations, and they set published minima
that were never true of BAM. The collector now withholds a capture that collapses
against the one before it, releasing it if the smaller network is still there two
captures later, so a genuine change is recorded and a failed read is not. Figures
computed from history already recorded exclude them too, and `metrics.json` lists
every excluded timestamp in `window.partialResponsesExcluded`.

The raw captures stay in the archive either way. What is withheld is the
interpretation, never the record.

### Sampling rate, honestly

The 60-second figure was accurate at launch and again from 2026-08-08, but not
in between. Capture ran at a full 1440/day in late June, then decayed to roughly
480/day — one sample every three minutes — for most of July and early August.
The collector scans its own capture log to reach the last two records, so as
that log passed a gigabyte each run outran its 60-second slot and the
single-instance guard dropped the overlapping minutes. Moving capture to a
hosted node with log rotation restored the full rate.

Nothing here is asserted on trust: per-day capture counts are published in
[bamservatory-data](https://github.com/RYthaGOD/bamservatory-data), and its
`verify.sh` prints coverage against the expected 1440/day for every day on
record — including the bad ones.

### Verifying these numbers

Every figure on this page is a pure function of published inputs. The raw
captures are public, so the whole chain can be recomputed independently:

```bash
git clone https://github.com/RYthaGOD/bamservatory-data.git
cd bamservatory-data && ./verify.sh      # hashes, record counts, coverage
```

`metrics.json` carries a `provenance` block naming the collector build and a
SHA-256 of each input it was computed from, `verification.csv` included.

One caveat worth stating plainly: the verification series is a *recording*, not
something a third party can re-derive. It captures what three services returned
at a moment that has passed, so you can check that the published panel matches
the recorded series, and that the series has not been revised — but not that the
readings were taken faithfully. The captures themselves have the same property,
which is why three collectors record them independently. The verification
collector runs on the primary only, because duplicating it would triple the load
on other people's APIs to compute the same answer from the same public data.

## How the data is gathered

Three collectors run continuously in **US-East, Singapore and Amsterdam**, each
recording the public BAM API independently and publishing its own separate
archive to
[bamservatory-data](https://github.com/RYthaGOD/bamservatory-data). Nothing runs
on a personal machine.

Three rather than one is the point. A single collector cannot tell "the API said
X" apart from "the API said X *to us*"; three make a view served to only one of
them detectable, and `compare.mjs` checks that minute by minute. Three rather
than two means a disagreement can be resolved rather than merely flagged.

## Honest scope

- **n = 1** validated structural rollover so far; the detector is live and
  accumulating more events to establish the precursor statistically.
- Frequent stake "leadership flips" are whale-driven toggles, **not** structural
  rollovers — the Observatory labels them as such and does not count them as
  early-warning wins.
- Data is reverse-engineered from the public API; BAM operators have richer
  internal telemetry. This project's value is **independence and indexing**, not
  privileged access.
- **Agreement across vantages is corroboration, not proof.** All three
  collectors could in principle be shown the same false view, and no number of
  vantages fixes that. BAM describes its ordering attestations as a public audit
  trail, but no endpoint currently serves them (re-checked 2026-08-09); until
  one does, "verified" here means *faithfully recorded and independently
  recomputable*, not *proven true at source*.

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
