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

Pin on `schemaVersion` (currently `3`).

- **Adding** a field keeps the version.
- **Removing** a field, or changing what an existing one means, bumps it.

So a consumer can treat an unexpected `schemaVersion` as a reason to stop and
look, rather than silently misreading a renamed number.

### History

| Version | Change |
|---|---|
| `3` | Captures missing more than an eighth of the network are excluded from the series, and captures where the whole fleet changes identity at once no longer count as events. `stats.*.min` rises, `leadershipChanges` and `detections.live*` fall. See [`stats`](#stats) and [`detections`](#detections). |
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

So the inference checks itself. `decentralization.unconventionalNodeNames` lists
any node at the latest snapshot whose name does not fit
`{city}-mainnet-bam-{n}-tee`. Normally empty. Non-empty means a region is being
inferred from a shape that does not have one, and every regional figure should
be read with that in mind.

The convention has already been broken twice: `ams-mainnet-bam-dev` and
`tyo-mainnet-bam-dev-tee` both ran with real stake into August 2026. Both kept a
valid city prefix, so the regions stayed correct — by luck rather than by
design, which is the reason this is now checked rather than assumed.

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
| `attestations` | object \| null | Whether BAM serves attestations yet, and when that was last checked. `null` before the first probe. |

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
| `partialResponsesWithheld` | object | `{ count, latest }` — captures the collector refused at source, so they never entered the series at all. |

**`snapshots` is not the length of `series`.** See below.

#### `partialResponsesExcluded`

The BAM API occasionally returns a coherent but incomplete view — on
2026-07-01 three consecutive captures reported 291 validators and 116.8M SOL
between captures reporting 380 and 142.0M, then recovered exactly. Nothing
inside such a record looks wrong: its own totals agree with its own contents.

Recording one as an observation put minima into this file that were never true
of BAM — a low of 10 nodes, 190 validators and a 17.72% stake share, all of them
descriptions of a read that failed halfway.

A capture is excluded when it sits below 88% of the median of the sixty captures
either side of it, in node count or validator count. Being low against what
*follows* is what identifies it: a real change to BAM persists, so the series
after it stays at the new level, while a partial read is followed by a return to
where things were. The newest capture is never excluded, since nothing follows
it yet to judge it against.

Both numbers were widened in `schemaVersion` 3, after an outage on 2026-08-12
walked straight through the previous ones. The API degraded for about seven
minutes and recovered in steps — 9 nodes, then 11, 11, 12, 14 — which defeated
each half of the old test in turn. Ten captures either side is shorter than the
outage, so by 04:21 the "before" median was itself degraded; and that capture
held 12 of 15 nodes and 306 of 377 validators, or exactly 0.80 of the network,
which the old threshold therefore let through. It set `stats.pct.min` to 26.78%
and `stats.vals.min` to 306.

88% is where the evidence puts the line rather than a round number: ranked by how
far each capture falls below its two-sided median, every read known to be broken
sits at or under 0.88, and the next tier up is 0.9286 — one node absent from a
fourteen-node network with every validator still reported, which is a real
observation and is kept.

The timestamps are published rather than quietly dropped — the raw records
remain in the [archive](https://github.com/RYthaGOD/bamservatory-data)
regardless, so anyone can pull them and disagree with this judgement.

`partialResponsesWithheld` counts the same fault caught one step earlier. The
collector now recognises a collapsed capture as it arrives and never writes it
to the series, releasing it only if the smaller network is still there two
captures later. Those never appear in `partialResponsesExcluded`, because they
were never in the series to exclude — without this count the two cases would be
indistinguishable from outside, and a capture that was never taken would look
identical to one that was taken and set aside.

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
| `unconventionalNodeNames` | Nodes not matching `{city}-mainnet-bam-{n}-tee`. Empty normally; non-empty means the two regional figures above are inferring a region from a name that has none. |

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

`vals` is the count of validators connected to that node or region, **as the node
itself reports it**. That distinction is worth one paragraph, because BAM's two
endpoints do not always agree with each other.

Each capture holds both a node list, where every node states its own
`connected_validators`, and a validator list, where every validator names the
node it is connected to. Counting the second gives a number that should equal the
first. In **2.43% of captures** (1,096 of 45,163 examined to 2026-08-13) at least one node
disagrees with the validators claiming it — almost always by exactly one
(1,150 of 1,185 cases are ±1), and concentrated in the busiest nodes: `sin`,
`fra` and `sqq` account for most of them.

The likely cause is mundane: the two lists are not read at the same instant, so a
validator connecting or disconnecting between them shows up in one and not the
other. It is a reason to treat a single per-node `vals` as ±1 rather than exact,
not a reason to distrust either endpoint. Aggregate figures are unaffected —
`headline.validatorCount` comes from the validator list as a whole, and every
stake figure agrees to the cent.

It matters where a small margin decides a label. `headline.busiestByVals` names
the node with the most connected validators, so a one-validator lead over the
runner-up is inside the noise. Compare the top two in `nodes` before treating a
narrow result as meaningful; the current margin is wide.

The one large exception on record is not this effect at all: at
2026-08-12T04:18:03Z a node self-reported 41 validators while none claimed it,
during a torn read whose own header stake disagreed with the sum of its nodes.
That capture is excluded from every figure and appears in
`window.partialResponsesExcluded`.

### `whales`

Top 12 validators by stake: `{ pk, pkShort, node, region, stake, share }`.
`pk` is the full validator pubkey; `pkShort` is an abbreviated form for display.

### `leadershipChanges`

`{ ts, from, to }` for every change of top-node-by-stake across the window.

**Most of these are not structural events.** They are whale-driven stake toggles
between two nodes, which flip leadership without anything moving. Do not read the
count as node churn — see `detections` for events that were actually validated.

Since `schemaVersion` 3, a change at a capture listed in
`detections.identityArtifacts` is not recorded here. When every node swapped its
`-1`/`-2` suffix on 2026-08-11, the top node's name changed from
`ams-mainnet-bam-1-tee` to `ams-mainnet-bam-2-tee` while holding the same stake
on the same machine, and that was previously counted as leadership moving.

### `detections`

| Field | Meaning |
|---|---|
| `validated` | Structural rollovers confirmed by backtest, with measured lead time. |
| `rolloverPrecursors` | Same-region node appearances preceding a cutover. |
| `liveCutovers` | Top-node changes seen live. Mostly whale flips. |
| `liveSignals` | New-node appearances seen live. |
| `excludedFromPartialResponses` | Live events dropped because the capture behind them was incomplete. |
| `identityArtifacts` | `{ ts, regions }` for captures where the whole fleet changed identity at once. |
| `excludedFromIdentityArtifacts` | Live events dropped because they fell at one of those captures. |
| `feed` | Recent raw events. |

`excludedFromPartialResponses` counts the detector reading its own blind spot.
When the API returned an incomplete node set, the absent nodes were read as
having left, and their return one capture later as several new nodes appearing
at once — firing region signals and cutovers that describe nothing that happened
to BAM. Both sides of each comparison are dropped, since the healthy capture
following a degraded one produces the "everything came back" half of the
artifact. Around one live event in ten came from those minutes.

`identityArtifacts` counts a second way the detector can be fooled, added in
`schemaVersion` 3. It treats a node as new when its name was not in the previous
capture, which assumes a name identifies a machine. Twice that has been false:
the explorer periodically swaps every node's `-1`/`-2` suffix across the whole
fleet in a single minute (2026-07-08, 2026-07-31, and 2026-08-11T21:18:33Z, when
fourteen regions changed name between captures fifty-nine seconds apart), and a
capture that returned nothing at all is withheld at source, so the recovery after
it is compared against the last good capture and every node reads as new
(2026-07-30, 2026-08-04).

The 2026-08-11 case is demonstrably a relabelling rather than a migration:
twelve of fifteen regions carried their validator count and node stake across the
boundary unchanged to the cent, and the network totals either side were
identical. Both cases tell the same false story — a dozen regions provisioning at
once — so the rule does not try to separate them. Four or more regions presenting
a new node in one capture is a change in how the network was described, not four
independent things happening at once.

The threshold is safe against the one event this project rests on: the 2026-06-24
structural rollover was genuinely coordinated and still never exceeded two
regions in a single capture, because it moved region by region over twenty-five
minutes. That is what a real reconfiguration looks like from outside.

`detections.log` is append-only history and is not rewritten; this is a rule
applied when it is read, and the count is published so the difference between
the log and these figures is visible rather than implied.

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
| `typical` | Median of the last 24 hours of readings, for judging whether `latest` is ordinary. |
| `readings` | How many readings exist. |
| `since` | Timestamp of the first. |
| `series` | Downsampled readings for charting. |

`typical` carries `{ readings, hours, onlyExplorer, disputedStakeSol,
kobeRunningBam }` and exists because a single reading is exactly what a
source-side fault moves.

Kobe's `running_bam` flag collapses and recovers on a rough two-day cycle:

| Episode | Duration | Flag low | Peak "disputed" |
|---|---|---|---|
| 2026-08-13 00:44–01:31Z | ~46 min | 206 of 379 | 115.7M SOL |
| 2026-08-15 02:27–03:13Z | ~47 min | 265 of 379 | 100.9M SOL |
| 2026-08-17 04:28–04:59Z | ~31 min | 262 of 380 | 96.3M SOL |
| 2026-08-19 06:13–06:29Z | ~16 min | 245 of 380 | 107.3M SOL |
| 2026-08-21 08:06Z | one reading | 261 of 377 | 98.5M SOL |

Each episode begins about an hour and fifty minutes later in the day than the
one before — 00:44, 02:27, 04:28, 06:13, 08:06 — so this is a cycle of roughly
fifty hours drifting through the clock rather than anything anchored to a time
of day. They are also getting shorter. Throughout, BAM's own explorer
and the on-chain stake do not move at all. That is the shape of a scheduled job
somewhere upstream, not of validators leaving — a hundred validators cannot leave
BAM in half an hour and take no stake with them.

Kobe's *full* validator list stays healthy throughout: in all eleven affected
readings it carried its usual ~667 of ~688 on-chain validators. The truncation
guard in `verify-sources.mjs` therefore correctly does not fire — it tests
whether the list is short, and the list is not short. Only the flag moves, which
is why this needed a different answer.

Nothing is smoothed or withheld: Kobe did report that, the list it arrived in was
complete rather than truncated, and which of two disagreeing sources is wrong is
not something this project can settle from outside — that is the standing limit
attestations exist to close. `typical` is context, added so that a spike is
legible as a spike, not a correction applied to one.

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

### `attestations`

| Field | Meaning |
|---|---|
| `checkedAt` | When the collector last probed for an attestation endpoint. |
| `reachable` | Whether BAM's API answered at all. `false` makes the result inconclusive rather than negative. |
| `available` | Whether any probed path served attestations. |
| `endpointsFound` | The paths that did, if any. |

This exists so the project's largest stated limit carries a date maintained by a
machine. Membership originates with Jito and only published attestations can
change that; a hand-written "re-checked on…" would go on asserting no endpoint
exists after one appeared, which is the one direction the error actually costs
something. `reachable` is separate from `available` because "we looked and found
nothing" and "we could not look" are different results and only the first is
evidence.

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
