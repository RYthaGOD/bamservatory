# `metrics.json` — field reference

The open data export behind [BAMservatory](https://rythagod.github.io/bamservatory/).
Written for anyone consuming this as a data source rather than reading the
dashboard.

**Endpoint:** `https://rythagod.github.io/bamservatory/metrics.json`

| | |
|---|---|
| CORS | `Access-Control-Allow-Origin: *` — fetchable directly from a browser |
| Content type | `application/json; charset=utf-8` |
| Rebuilt | every ~15 minutes, from capture running at 60-second resolution |
| Cache | `Cache-Control: max-age=600` (GitHub Pages), plus `ETag` and `Last-Modified` |

Worst-case staleness is therefore about 25 minutes: up to 15 waiting for the next
rebuild, plus up to 10 of edge cache. Poll faster than that and you will mostly
be served the same bytes — `generatedAt` tells you which build you actually have,
and a conditional request against `ETag` avoids re-downloading it.

## Stability contract

Pin on `schemaVersion` (currently `2`).

- **Adding** a field keeps the version.
- **Removing** a field, or changing what an existing one means, bumps it.

So a consumer can treat an unexpected `schemaVersion` as a reason to stop and
look, rather than silently misreading a renamed number.

### History

| Version | Change |
|---|---|
| `2` | `stats.*.avg` became time-weighted rather than a mean over captures. Values shift slightly; see [`stats`](#stats). |
| `1` | Initial published contract. |

## Conventions that are easy to get wrong

Read this section before using any figure.

| | |
|---|---|
| **Stake is in SOL** | Not lamports. These come from the BAM API already denominated in SOL. |
| **`share` means share of BAM** | Every `share` on a node, region or validator is a percentage of *total stake in the BAM network at that snapshot* — **not** of all Solana stake. |
| **The one exception** | `headline.bamStakePct` is BAM's share of **all Solana stake**. It is the only figure denominated against the whole network. |
| **Percentages are 0–100** | Not fractions. `23.14` means 23.14%. |
| **HHI is 0–1** | Sum of squared stake *fractions*. Not the 0–10,000 convention used in antitrust literature. A value of `0.138` corresponds to 1,383 on that scale. |
| **Timestamps are RFC 3339 UTC** | `2026-08-08T13:35:06Z`. Always `Z`, never a local offset. |
| **`region` is derived, not reported** | See below — this one is a genuine trap. |

### Why `region` is derived

The BAM API does return a `region` field, but its value is a copy of the node
name: node `fra-mainnet-bam-1-tee` reports `"region": "fra-mainnet-bam-1-tee"`.
That makes every node its own region and any concentration measure built on it
meaningless.

BAMservatory therefore ignores that field and derives the region from the node
naming convention — the segment before the first hyphen, an IATA-style city
code. `fra-mainnet-bam-2-tee` → `fra`.

This is an inference from a naming pattern, not a documented API contract. If
BAM ever names a node without that prefix, regional figures degrade. Worth
knowing before you build on `regionNakamoto`.

## Top level

| Field | Type | Meaning |
|---|---|---|
| `generatedAt` | string | When this file was written (RFC 3339 UTC). |
| `schemaVersion` | number | See stability contract above. |
| `provenance` | object | What produced this file. See below. |
| `window` | object | Time span and sample count the file summarises. |
| `headline` | object | Current-state figures. |
| `decentralization` | object | Concentration measures at the latest snapshot. |
| `stats` | object | Min/max/avg/current across the whole window. |
| `series` | array | Downsampled time series for charting. |
| `nodes` | array | Every BAM node at the latest snapshot. |
| `regions` | array | Nodes rolled up by derived region. |
| `whales` | array | Top 12 validators by stake. |
| `leadershipChanges` | array | Every change of top node across the window. |
| `detections` | object | Rollover early-warning events. |
| `verification` | object \| null | Cross-source checks of what BAM reports. `null` where none have run. See below. |

### `provenance`

```json
{
  "collector": "0fcd020edfd9d71e7c36d971dad47ba88442a520",
  "archive": "https://github.com/RYthaGOD/bamservatory-data",
  "inputs": {
    "summary.csv": "sha256:b5524419…",
    "nodes.csv": "sha256:aa86e4cc…",
    "detections.log": "sha256:056a0f21…",
    "verification.csv": "sha256:548c9739…",
    "validators.csv": { "tailReadOnly": true, "snapshotTs": "…", "validators": 375 }
  }
}
```

`collector` is the exact commit of [bam-net](https://github.com/RYthaGOD/bam-net)
that gathered the inputs. `inputs` carries a SHA-256 of each file read in full,
so a published figure can be tied to the precise capture state behind it.

`validators.csv` is identified by snapshot rather than hashed: it is tail-read
for one snapshot, and hashing hundreds of megabytes to cover a few hundred
contributing rows would cost more than it establishes.

Either field may be `null` if the pipeline was run without them configured —
that is deliberate, and means "not known" rather than pointing at something that
does not resolve.

### `window`

| Field | Meaning |
|---|---|
| `from` / `to` | First and last capture timestamps. |
| `snapshots` | Number of captures in the window, after the exclusions below. |
| `partialResponsesExcluded` | array | Timestamps of captures left out of every figure in this file. |

**`snapshots` is not the length of `series`.** See below.

#### `partialResponsesExcluded`

The BAM API occasionally returns a coherent but incomplete view — on
2026-07-01 three consecutive captures reported 291 validators and 116.8M SOL
between captures reporting 380 and 142.0M, then recovered exactly. Nothing
inside such a record looks wrong: its own totals agree with its own contents.

Recording one as an observation put minima into this file that were never true
of BAM — a low of 10 nodes, 190 validators and a 17.72% stake share, all of them
descriptions of a read that failed halfway.

A capture is excluded when it sits below 80% of the median of the ten captures
either side of it, in node count or validator count. Being low against what
*follows* is what identifies it: a real change to BAM persists, so the series
after it stays at the new level, while a partial read is followed by a return to
where things were. The newest capture is never excluded, since nothing follows
it yet to judge it against.

The timestamps are published rather than quietly dropped — the raw records
remain in the [archive](https://github.com/RYthaGOD/bamservatory-data)
regardless, so anyone can pull them and disagree with this judgement.

### `headline`

| Field | Unit | Meaning |
|---|---|---|
| `bamStakeSOL` | SOL | Total stake running BAM. |
| `bamStakePct` | % of **all Solana stake** | The one network-wide denominator. |
| `nodeCount` | count | BAM nodes at the latest snapshot. |
| `validatorCount` | count | Validators reported by the API. |
| `topNode` | string | Node holding the most stake. |
| `topNodeShare` | % of BAM | That node's share. |
| `busiestByVals` | object | Node with the most *connected validators* — not the most stake. Usually a different node from `topNode`. |

### `decentralization`

| Field | Meaning |
|---|---|
| `nodeStakeHHI` | HHI of node stake shares, 0–1. |
| `nodeNakamoto` | Fewest **nodes** whose combined stake exceeds 50%. |
| `regionNakamoto` | Fewest **regions** exceeding 50%. Depends on the derived region — see above. |
| `validatorNakamoto` | Fewest **validators** exceeding 50%. |
| `top1ValShare` / `top5ValShare` / `top10ValShare` | Cumulative % of BAM stake held by the top 1 / 5 / 10 validators. |
| `regionCount` | Distinct derived regions. |

Nakamoto here is the minimum count whose cumulative share **strictly exceeds**
50%. Some publications use ≥ 50%; on tied distributions that can differ by one.

### `stats`

Each of `pct`, `hhi`, `vals`, `nodes` is `{ min, max, avg, cur }` computed across
**every** capture in the window — the full `snapshots` count, not the
downsampled `series`. `cur` equals the latest value.

**`avg` is time-weighted, not a mean over captures** (since `schemaVersion` 2).

A plain mean answers "what did the average capture see", which equals "what was
the average value" only when captures are evenly spaced. They have not been —
the collector ran at 1440/day, decayed to 480/day for much of July, and is back
at 1440/day — so a sample mean would weight densely-captured periods more
heavily and move with collector uptime rather than with BAM. On the current
window the two differ by about 0.16 percentage points on stake share.

Each interval is capped at 10 minutes when weighting. Beyond that the collector
was down and nothing is known about the interval, so the samples either side of
an outage must not dominate. `min` and `max` are unweighted: an extreme is an
extreme however often it was sampled.

### `series`

Array of `{ ts, pct, hhi, vals, nodes }`, **downsampled to about 240 points** for
charting: every *n*th capture, where *n* = `floor(snapshots / 240)`, with the
most recent point always included.

If you need full resolution, do not use this field — reconstruct it from the raw
archive instead. `stats` is computed over the full data, so it will not agree
with what you would get by aggregating `series`, and that is expected.

Consecutive captures sharing a timestamp are de-duplicated before anything else,
because the API sometimes repeats a value between its own refreshes.

### `nodes` / `regions`

Nodes: `{ node, region, vals, stake, share }`, sorted by stake descending.
Regions: `{ region, vals, stake, nodes, share }`, same ordering, where `nodes` is
how many nodes rolled up into that region.

`vals` is the count of validators connected to that node or region.

### `whales`

Top 12 validators by stake: `{ pk, pkShort, node, region, stake, share }`.
`pk` is the full validator pubkey; `pkShort` is an abbreviated form for display.

### `leadershipChanges`

`{ ts, from, to }` for every change of top-node-by-stake across the window.

**Most of these are not structural events.** They are whale-driven stake toggles
between two nodes, which flip leadership without anything moving. Do not read the
count as node churn — see `detections` for events that were actually validated.

### `detections`

| Field | Meaning |
|---|---|
| `validated` | Structural rollovers confirmed by backtest, with measured lead time. |
| `rolloverPrecursors` | Same-region node appearances preceding a cutover. |
| `liveCutovers` | Top-node changes seen live. Mostly whale flips. |
| `liveSignals` | New-node appearances seen live. |
| `feed` | Recent raw events. |

The separation is deliberate. A live "cutover" with `first_signal=none` is a
stake flip, not a rollover, and is not credited as an early-warning success.
As of writing there is **one** validated structural rollover (2026-06-24, 22
minutes of lead) — n=1, and it should be read that way.

### `verification`

The only block here not derived from the BAM API. It comes from
`verification.csv` in the [archive](https://github.com/RYthaGOD/bamservatory-data),
written on its own slower cycle by a collector that queries three sources: BAM's
explorer, Jito's Kobe API, and a Solana RPC `getVoteAccounts` set.

`null` on a witness vantage and before the first run, so test the field rather
than its presence.

| Field | Meaning |
|---|---|
| `latest` | The most recent reading. Its `ts` is *older* than `generatedAt` — see below. |
| `readings` | How many readings exist. |
| `since` | Timestamp of the first. |
| `series` | Downsampled readings for charting. |

Fields on `latest` (and, where charted, on `series`):

| Field | Unit | Meaning |
|---|---|---|
| `ts` | RFC 3339 | When this reading was taken. |
| `explorerValidators` | count | Validators BAM's explorer lists. |
| `kobeRunningBam` | count | Validators Kobe flags as running BAM. |
| `inBoth` / `onlyExplorer` / `onlyKobe` | count | Membership agreement between the two. |
| `disputedStakeSol` | SOL | Stake attached to the validators only one source lists. |
| `kobeTotalValidators` / `chainValidators` | count | Source-health counts; a short Kobe response is refused, not recorded. |
| `onchainMatched` | count | BAM-listed validators found in `getVoteAccounts`. |
| `stakeReportedSol` / `stakeOnchainSol` | SOL | BAM's per-validator stakes, and the same validators' stake on chain. |
| `stakeAbsDiffSol` | SOL | Absolute difference between those two. |
| `stakeMaxRelPct` / `stakeMedianRelPct` | % | Worst and typical per-validator deviation. |
| `bamHeadlineStakeSol` / `bamHeadlineSharePct` | SOL, % | BAM's own published headline, verbatim from `/bam_stake`. |
| `bamShareReportedPct` / `bamShareOnchainPct` | % | BAM's stake as a share of the `getVoteAccounts` total. |

**`null` means the reading predates the column, not zero.** Columns have been
added twice. A reading taken before a column existed carries `null` for it, and
reading that as `0` states a measurement that was never made — a median
deviation of `null` is "not recorded", where `0.0000` is "checked, and they
agreed exactly".

**The two share figures do not have the same denominator.**
`bamHeadlineSharePct` is BAM's own, over a network total BAM does not publish;
`bamShareOnchainPct` divides by the `getVoteAccounts` total. In practice the
*numerators* agree to the cent, so the difference between the two is the network
total each side uses — roughly 175,000 SOL, about 0.04%. It is not a discrepancy
in what BAM reports about its own stake.

**This block is deliberately staler than the rest of the file.** It runs every
15 minutes against three services rather than every 60 seconds against one, so
`latest.ts` normally trails `generatedAt`, and its validator counts will differ
slightly from `headline`. That is two readings at two times, not a contradiction.

## Verifying any of this

Every figure above is a pure function of published inputs:

```bash
git clone https://github.com/RYthaGOD/bamservatory-data.git
cd bamservatory-data && ./verify.sh
```

That checks each archived day against its recorded hash, record count and
boundary timestamps, and prints capture coverage per day against the expected
1440/day.

Note that coverage has not always been 1440/day — see the sampling-rate section
of the [README](README.md). The archive publishes what actually happened.

## What this data cannot tell you

It records what the public BAM API returned, as observed by one collector. It is
not an attestation from BAM, and there is no cryptographic link between these
figures and what the network actually executed. Until BAM node attestations are
publicly queryable, "verified" here means *faithfully recorded and independently
recomputable* — not *proven true at source*.
