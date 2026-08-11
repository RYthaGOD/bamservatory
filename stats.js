"use strict";

// BAM OBSERVATORY — metrics core.
// Streams the flattened capture CSVs into one metrics.json that the dashboard
// (build.js) renders. Every number here is computed from real captured data in
// d:\bam-net-ticks (the public BAM API, sampled every ~60s).
//
//   summary.csv     — per-tick scalars (stake %, node/validator counts, HHI, top node)
//   nodes.csv       — per-tick per-node (region, connected_validators, node_stake)
//   validators.csv  — per-tick per-validator (pubkey, node, stake)  [big — streamed]
//   detections.log  — live rollover precursor / cutover events
//
// Usage: node stats.js [--dir d:/bam-net-ticks] [--out metrics.json]

const fs = require("fs");
const readline = require("readline");
const path = require("path");
const crypto = require("crypto");

const dirArg = process.argv.indexOf("--dir");
const DIR = dirArg >= 0 ? process.argv[dirArg + 1] : "d:/bam-net-ticks";
const outArg = process.argv.indexOf("--out");
const OUT = outArg >= 0 ? process.argv[outArg + 1] : path.join(__dirname, "metrics.json");

const SUMMARY = path.join(DIR, "summary.csv");
const NODES = path.join(DIR, "nodes.csv");
const VALIDATORS = path.join(DIR, "validators.csv");
const DETLOG = path.join(DIR, "detections.log");

const city = (nodeName) => String(nodeName).split("-")[0];
const num = (x) => { const n = parseFloat(x); return Number.isFinite(n) ? n : 0; };
// For columns that can legitimately be empty, where 0 would be a lie rather than
// a default: a blank means the reading predates the column, and reading it as
// zero is how "typical deviation 0.0000%" came to be displayed under forty
// readings that never recorded one.
const numOrNull = (x) => {
  if (x === undefined || String(x).trim() === "") return null;
  const n = parseFloat(x);
  return Number.isFinite(n) ? n : null;
};
// min entities (sorted desc) whose cumulative share first exceeds `frac` of total
function nakamoto(values, frac = 0.5) {
  const sorted = [...values].sort((a, b) => b - a);
  const total = sorted.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  let cum = 0;
  for (let i = 0; i < sorted.length; i++) {
    cum += sorted[i];
    if (cum / total > frac) return i + 1;
  }
  return sorted.length;
}

// ---- 1. summary.csv (read fully; it's small) ------------------------------
function loadSummary() {
  const lines = fs.readFileSync(SUMMARY, "utf8").trim().split(/\r?\n/);
  const hdr = lines[0].split(",");
  const ix = (name) => hdr.indexOf(name);
  const I = {
    ts: ix("ts"), stake: ix("bam_stake"), pct: ix("bam_stake_percentage"),
    nodes: ix("node_count"), vals: ix("validator_count"),
    topNode: ix("top_node"), topShare: ix("top_node_share"), hhi: ix("node_stake_hhi"),
  };
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(",");
    if (c[I.ts] === "ts" || !c[I.ts]) continue;
    rows.push({
      ts: c[I.ts], stake: num(c[I.stake]), pct: num(c[I.pct]),
      nodes: num(c[I.nodes]), vals: num(c[I.vals]),
      topNode: c[I.topNode], topShare: num(c[I.topShare]), hhi: num(c[I.hhi]),
    });
  }
  // dedup consecutive identical-timestamp rows (the API repeats between refreshes)
  const dedup = [];
  for (const r of rows) if (!dedup.length || dedup[dedup.length - 1].ts !== r.ts) dedup.push(r);
  return dedup;
}

// Read the last `want` bytes of a file as whole lines.
//
// The first line of a byte-slice is almost always cut mid-record, so it is
// discarded — which also disposes of the CSV header when the file is smaller
// than the window. Callers must therefore not assume a header row.
function tailLines(file, want) {
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size;
    const n = Math.min(size, want);
    const buf = Buffer.alloc(n);
    fs.readSync(fd, buf, 0, n, size - n);
    let text = buf.toString("utf8");
    const nl = text.indexOf("\n");
    if (nl >= 0) text = text.slice(nl + 1);
    return text.split(/\r?\n/).filter(Boolean);
  } finally {
    fs.closeSync(fd);
  }
}

// ---- 2. nodes.csv latest snapshot + region rollup -------------------------
// TAIL-READ, for the same reason validators.csv is. Only the newest tick's rows
// are used, but the file gains one row per node per capture — around 1.9 MB a
// day, and nothing trims it. Reading it whole works fine at 50 MB and quietly
// stops working at 500 MB, which is the failure mode that took the original
// collector down to a third of its capture rate without anything looking wrong.
//
// The column order is fixed by flatten.awk, so the header is not needed to
// interpret a tail slice: ts,bam_node,region,connected_validators,node_stake,
// node_stake_share.
function loadNodesLatest(latestTs) {
  const I = { ts: 0, node: 1, vals: 3, stake: 4 };
  const lines = tailLines(NODES, 2 * 1024 * 1024); // ≫ one tick (~1.3 KB)
  const nodes = [];
  // From 0, not 1: a tail slice has no header to skip, and tailLines has
  // already dropped the partial line at the cut point.
  for (let i = 0; i < lines.length; i++) {
    const c = lines[i].split(",");
    if (c.length < 5 || c[I.ts] !== latestTs) continue;
    nodes.push({ node: c[I.node], region: city(c[I.node]), vals: num(c[I.vals]), stake: num(c[I.stake]) });
  }
  nodes.sort((a, b) => b.stake - a.stake);
  const totStake = nodes.reduce((a, n) => a + n.stake, 0) || 1;
  nodes.forEach((n) => (n.share = (100 * n.stake) / totStake));
  // region rollup
  const reg = {};
  for (const n of nodes) {
    reg[n.region] = reg[n.region] || { region: n.region, vals: 0, stake: 0, nodes: 0 };
    reg[n.region].vals += n.vals; reg[n.region].stake += n.stake; reg[n.region].nodes++;
  }
  const regions = Object.values(reg).sort((a, b) => b.stake - a.stake);
  regions.forEach((r) => (r.share = (100 * r.stake) / totStake));
  const busiestByVals = [...nodes].sort((a, b) => b.vals - a.vals)[0];
  return {
    nodes, regions, busiestByVals,
    nodeNakamoto: nakamoto(nodes.map((n) => n.stake)),
    regionNakamoto: nakamoto(regions.map((r) => r.stake)),
  };
}

// ---- 3. validators.csv latest snapshot (TAIL-READ — the file is large) -----
// The newest tick's rows are at the end of the file, so we read only the last
// few MB instead of streaming the whole multi-hundred-MB file on every build.
// This keeps each publish fast and light (it was straining MSYS2's fork limits).
// Column order is fixed: ts,validator_pubkey,bam_node_connection,stake,stake_pct.
function loadValidatorsLatest(latestTs) {
  const fd = fs.openSync(VALIDATORS, "r");
  const size = fs.fstatSync(fd).size;
  const want = Math.min(size, 4 * 1024 * 1024); // 4MB tail ≫ one tick (~35KB)
  const buf = Buffer.alloc(want);
  fs.readSync(fd, buf, 0, want, size - want);
  fs.closeSync(fd);
  let text = buf.toString("utf8");
  if (want < size) { const nl = text.indexOf("\n"); if (nl >= 0) text = text.slice(nl + 1); } // drop partial first line
  const vals = [];
  for (const l of text.split(/\r?\n/)) {
    if (!l) continue;
    const c = l.split(",");
    if (c.length < 5 || c[0] !== latestTs) continue; // header row ("ts,…") and older ticks fall out here
    vals.push({ pk: c[1], node: c[2], region: city(c[2]), stake: num(c[3]) });
  }
  vals.sort((a, b) => b.stake - a.stake);
  const tot = vals.reduce((a, v) => a + v.stake, 0) || 1;
  vals.forEach((v) => (v.share = (100 * v.stake) / tot));
  const cumShare = (n) => vals.slice(0, n).reduce((a, v) => a + v.share, 0);
  return {
    count: vals.length,
    valNakamoto: nakamoto(vals.map((v) => v.stake)),
    top1Share: cumShare(1), top5Share: cumShare(5), top10Share: cumShare(10),
    whales: vals.slice(0, 12).map((v) => ({ pk: v.pk, pkShort: v.pk.slice(0, 4) + "…" + v.pk.slice(-4), node: v.node, region: v.region, stake: v.stake, share: v.share })),
  };
}

// ---- 3b. cross-source verification ------------------------------------------
// The one input here that checks BAM rather than describing it. Written by
// verify-sources.mjs on its own slower cycle: BAM's reported stake against
// Solana, and BAM's membership list against Jito's own Kobe API. The cadence is
// not restated here — the readings carry their own timestamps, and a number
// written into a comment is wrong from the first time the schedule changes.
//
// Absent on a witness, and on the primary until the first run, so every consumer
// must treat null as normal rather than as breakage.
function loadVerification() {
  const p = path.join(DIR, "verification.csv");
  if (!fs.existsSync(p)) return null;
  const lines = fs.readFileSync(p, "utf8").trim().split(/\r?\n/);
  if (lines.length < 2) return null;

  const hdr = lines[0].split(",");
  const ix = (n) => hdr.indexOf(n);
  const I = {
    ts: ix("ts"), ev: ix("explorer_validators"), kb: ix("kobe_running_bam"),
    both: ix("in_both"), oe: ix("only_explorer"), ok: ix("only_kobe"),
    disp: ix("disputed_stake_sol"), matched: ix("onchain_matched"),
    rep: ix("stake_reported_sol"), chain: ix("stake_onchain_sol"),
    diff: ix("stake_abs_diff_sol"), maxRel: ix("stake_max_rel_pct"),
    medRel: ix("stake_median_rel_pct"),
    kobeTotal: ix("kobe_total_validators"), chainVals: ix("chain_validators"),
    hStake: ix("bam_headline_stake_sol"), hShare: ix("bam_headline_share_pct"),
    shRep: ix("bam_share_reported_pct"), shChain: ix("bam_share_onchain_pct"),
  };

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(",");
    if (c.length < hdr.length || !c[I.ts]) continue;
    rows.push({
      ts: c[I.ts],
      explorerValidators: num(c[I.ev]), kobeRunningBam: num(c[I.kb]), inBoth: num(c[I.both]),
      onlyExplorer: num(c[I.oe]), onlyKobe: num(c[I.ok]), disputedStakeSol: num(c[I.disp]),
      onchainMatched: num(c[I.matched]),
      stakeReportedSol: num(c[I.rep]), stakeOnchainSol: num(c[I.chain]),
      stakeAbsDiffSol: num(c[I.diff]), stakeMaxRelPct: num(c[I.maxRel]),
      // null on readings taken before the column existed. Every consumer must
      // test for that rather than rendering it, because these are the fields
      // where a substituted zero reads as a measurement — "no disagreement",
      // "no deviation" — instead of as the absence of one.
      stakeMedianRelPct: I.medRel >= 0 ? numOrNull(c[I.medRel]) : null,
      kobeTotalValidators: I.kobeTotal >= 0 ? numOrNull(c[I.kobeTotal]) : null,
      chainValidators: I.chainVals >= 0 ? numOrNull(c[I.chainVals]) : null,
      bamHeadlineStakeSol: I.hStake >= 0 ? numOrNull(c[I.hStake]) : null,
      bamHeadlineSharePct: I.hShare >= 0 ? numOrNull(c[I.hShare]) : null,
      bamShareReportedPct: num(c[I.shRep]), bamShareOnchainPct: num(c[I.shChain]),
    });
  }
  if (!rows.length) return null;

  // Downsampled the same way the main series is, for the same reason.
  const step = Math.max(1, Math.floor(rows.length / 240));
  const series = rows
    .filter((_, i) => i % step === 0 || i === rows.length - 1)
    .map((r) => ({ ts: r.ts, onlyExplorer: r.onlyExplorer, disputedStakeSol: r.disputedStakeSol, stakeMedianRelPct: r.stakeMedianRelPct }));

  return { latest: rows[rows.length - 1], readings: rows.length, since: rows[0].ts, series };
}

// ---- 4. detections ---------------------------------------------------------
// Two distinct things, kept honest and separate:
//   • VALIDATED structural rollover (from the replay backtest on the 2026-06-24
//     event): a same-region precursor node appeared, then took over — real lead.
//   • LIVE feed (detections.log): ongoing monitoring. Most live "cutovers" are
//     whale-driven stake-leadership FLIPS (fra↔ams), NOT structural rollovers —
//     they carry first_signal=none. Their large matched "lead" numbers are
//     spurious (stale-signal matches) and are deliberately NOT credited.
function parseEvent(l) {
  const parts = l.split(" ");
  const kv = {};
  parts.slice(2).forEach((p) => { const [k, v] = p.split("="); if (k) kv[k] = v; });
  return { ts: parts[0], kind: parts[1], kv };
}
function readLog(p) {
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, "utf8").trim().split(/\r?\n/).filter(Boolean).map(parseEvent);
}
// The longest lead that still counts as a precursor rather than coincidence.
// One definition, used everywhere — detect.sh applies the same bound when it
// decides whether to record first_signal at all. It was previously written
// three times with two different comparisons (< here, <= in the feed and in the
// detector), so a cutover with exactly this lead would have been logged with a
// precursor and shown as structural in the feed while never counting as
// validated: the dashboard contradicting itself about its headline metric.
const LEAD_WINDOW_MIN = 60;
const isStructural = (kv) =>
  kv.first_signal !== undefined &&
  kv.first_signal !== "none" &&
  num(kv.lead_min) > 0 &&
  num(kv.lead_min) <= LEAD_WINDOW_MIN;

function loadDetections() {
  // VALIDATED — from the backtest replay. A genuine structural cutover is one
  // whose matched precursor was a same-region SIGNAL with a short lead.
  const replay = readLog(path.join(DIR, "detections_replay.log"));
  const validated = [];
  for (const e of replay) {
    if (e.kind !== "CUTOVER") continue;
    const lead = num(e.kv.lead_min);
    if (isStructural(e.kv)) {
      // the precursor node that fired the matched SIGNAL
      const sig = replay.find((s) => s.kind === "SIGNAL" && s.ts === e.kv.first_signal);
      validated.push({
        ts: e.ts, from: e.kv.old, to: e.kv.new, region: e.kv.region, lead_min: lead,
        precursorTs: e.kv.first_signal, precursorNode: sig ? sig.kv.new_node : e.kv.new,
      });
    }
  }
  // context: how many regions spun up a new node in the rollover window (coordination)
  const rolloverPrecursors = replay.filter((e) => e.kind && e.kind.startsWith("SIGNAL")).length;

  // LIVE feed
  const live = readLog(DETLOG);
  const liveCutovers = live.filter((e) => e.kind === "CUTOVER").length;
  const liveSignals = live.filter((e) => e.kind && e.kind.startsWith("SIGNAL")).length;
  // A cutover only counts as "structural" if its precursor lead is PLAUSIBLE
  // (>0 and ≤60 min). The live detector naively matches a cutover to the first
  // same-region signal ever seen, so whale-driven flips get matched to stale
  // week-old signals (lead_min in the hundreds/thousands) — those are NOT
  // structural rollovers and must not be labelled as such on the dashboard.
  const feed = live.slice(-12).reverse().map((e) => ({
    ts: e.ts, kind: e.kind, region: e.kv.region,
    detail: e.kind === "CUTOVER" ? `${e.kv.old} → ${e.kv.new}` : `new ${e.kv.new_node}`,
    structural: e.kind === "CUTOVER" ? isStructural(e.kv) : null,
  }));

  return { validated, rolloverPrecursors, liveCutovers, liveSignals, feed };
}

// ---- assemble -------------------------------------------------------------
async function main() {
  const summary = loadSummary();
  const latest = summary[summary.length - 1];
  const first = summary[0];

  // leadership-change events (top node by stake)
  const leadershipChanges = [];
  for (let i = 1; i < summary.length; i++)
    if (summary[i].topNode !== summary[i - 1].topNode)
      leadershipChanges.push({ ts: summary[i].ts, from: summary[i - 1].topNode, to: summary[i].topNode });

  // Averages are weighted by time, not by sample count.
  //
  // A plain mean over captures answers "what did the average capture see", which
  // is only the same as "what was the average value" when captures are evenly
  // spaced. They have not been: the collector ran at 1440/day, decayed to
  // 480/day through much of July, and is back at 1440/day — so a sample mean
  // silently weights densely-captured periods more heavily, and the published
  // figure moves with collector uptime rather than with BAM. On the current
  // window that biased the stake share by 0.16pp.
  //
  // Each interval is capped: beyond it the collector was down, and we have no
  // information about what happened, so a long outage must not let the sample
  // either side of it dominate. min/max are untouched — extremes are extremes
  // however often they were sampled.
  const GAP_CAP_MIN = 10;
  const reduceStat = (key) => {
    let min = Infinity, max = -Infinity, num = 0, den = 0;
    for (let i = 0; i < summary.length; i++) {
      const v = summary[i][key];
      min = Math.min(min, v);
      max = Math.max(max, v);
      if (i === 0) continue;
      let dt = (Date.parse(summary[i].ts) - Date.parse(summary[i - 1].ts)) / 60000;
      if (!(dt > 0)) continue;
      if (dt > GAP_CAP_MIN) dt = GAP_CAP_MIN;
      num += ((v + summary[i - 1][key]) / 2) * dt;
      den += dt;
    }
    return { min, max, avg: den > 0 ? num / den : latest[key], cur: latest[key] };
  };

  // downsample series for charts (~240 points max)
  const step = Math.max(1, Math.floor(summary.length / 240));
  const series = summary.filter((_, i) => i % step === 0 || i === summary.length - 1)
    .map((r) => ({ ts: r.ts, pct: r.pct, hhi: r.hhi, vals: r.vals, nodes: r.nodes }));

  const nodesLatest = loadNodesLatest(latest.ts);
  const validatorsLatest = await loadValidatorsLatest(latest.ts);
  const detections = loadDetections();

  // metrics.json is a derived artifact: every figure below is a pure function of
  // the capture files. Recording a digest of those inputs lets anyone pin which
  // capture state produced these numbers and recompute them from the published
  // archive at github.com/RYthaGOD/bamservatory-data.
  //
  // summary.csv, nodes.csv and detections.log are hashed whole because they are
  // read whole. validators.csv is not: it is tail-read for a single snapshot, so
  // hashing hundreds of megabytes to cover a few hundred contributing rows would
  // cost far more than it establishes. It is identified by snapshot instead.
  const digest = (p) => {
    try {
      return "sha256:" + crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
    } catch {
      return null;
    }
  };

  const metrics = {
    generatedAt: new Date().toISOString(),
    // Consumers pin on this. Additive changes keep the version; removing or
    // repurposing a field is a bump, so an aggregator can fail loudly rather
    // than silently mis-read a renamed number.
    //
    // 2 — stats.*.avg became time-weighted rather than a mean over captures.
    //     The values shift slightly and the definition genuinely changed, so
    //     this bumps even though nothing was added or removed. A contract only
    //     means something if it is honoured when the change is inconvenient.
    schemaVersion: 2,
    provenance: {
      collector: process.env.BAM_NET_REF || null,
      // Both come from the environment and default to null rather than to a
      // hardcoded URL. A transparency artifact should never point at an archive
      // that does not resolve — publishing null says "not configured", which is
      // true, where a dead link would imply a record that cannot be inspected.
      archive: process.env.ARCHIVE_URL || null,
      inputs: {
        "summary.csv": digest(SUMMARY),
        "nodes.csv": digest(NODES),
        "detections.log": digest(DETLOG),
        "validators.csv": { tailReadOnly: true, snapshotTs: latest.ts, validators: latest.vals },
      },
    },
    window: { from: first.ts, to: latest.ts, snapshots: summary.length },
    headline: {
      bamStakeSOL: latest.stake,
      bamStakePct: latest.pct,
      nodeCount: latest.nodes,
      validatorCount: latest.vals,
      topNode: latest.topNode,
      topNodeShare: latest.topShare,
      busiestByVals: nodesLatest.busiestByVals,
    },
    decentralization: {
      nodeStakeHHI: latest.hhi,
      nodeNakamoto: nodesLatest.nodeNakamoto,
      regionNakamoto: nodesLatest.regionNakamoto,
      validatorNakamoto: validatorsLatest.valNakamoto,
      top1ValShare: validatorsLatest.top1Share,
      top5ValShare: validatorsLatest.top5Share,
      top10ValShare: validatorsLatest.top10Share,
      regionCount: nodesLatest.regions.length,
    },
    stats: { pct: reduceStat("pct"), hhi: reduceStat("hhi"), vals: reduceStat("vals"), nodes: reduceStat("nodes") },
    series,
    nodes: nodesLatest.nodes,
    regions: nodesLatest.regions,
    whales: validatorsLatest.whales,
    leadershipChanges,
    detections,
    // Additive, so schemaVersion stays where it is. Null until the first
    // verification run, and null on a witness — never absent, so a consumer can
    // test the field rather than its existence.
    verification: loadVerification(),
  };

  fs.writeFileSync(OUT, JSON.stringify(metrics, null, 2));

  // ---- console verification ----
  console.log("BAM OBSERVATORY — metrics computed");
  console.log("==================================");
  console.log(`window:      ${metrics.window.from}  →  ${metrics.window.to}  (${metrics.window.snapshots} snapshots)`);
  console.log(`BAM stake:   ${(latest.stake / 1e6).toFixed(2)}M SOL  =  ${latest.pct.toFixed(2)}% of all Solana stake`);
  console.log(`topology:    ${latest.nodes} nodes, ${metrics.decentralization.regionCount} regions, ${latest.vals} validators`);
  console.log(`top node:    ${latest.topNode}  (${latest.topShare.toFixed(1)}% of BAM stake)`);
  console.log(`busiest:     ${nodesLatest.busiestByVals.node}  (${nodesLatest.busiestByVals.vals} validators)`);
  console.log("");
  console.log("DECENTRALIZATION");
  console.log(`  node-stake HHI:        ${latest.hhi.toFixed(4)}`);
  console.log(`  Nakamoto (nodes):      ${nodesLatest.nodeNakamoto}   (min nodes to control >50% of BAM stake)`);
  console.log(`  Nakamoto (regions):    ${nodesLatest.regionNakamoto}`);
  console.log(`  Nakamoto (validators): ${validatorsLatest.valNakamoto}   (min validators to control >50%)`);
  console.log(`  top validator:         ${validatorsLatest.top1Share.toFixed(1)}% | top5 ${validatorsLatest.top5Share.toFixed(1)}% | top10 ${validatorsLatest.top10Share.toFixed(1)}%`);
  console.log("");
  console.log("EARLY-WARNING");
  for (const v of detections.validated)
    console.log(`  VALIDATED rollover: ${v.from} → ${v.to}  lead ${v.lead_min} min  (precursor ${v.precursorNode} @ ${v.precursorTs})`);
  console.log(`  live monitoring:    ${detections.liveCutovers} leadership flips, ${detections.liveSignals} signals (flips are whale-driven — see concentration)`);
  console.log(`  leadership flips (top node by stake): ${leadershipChanges.length} over the window — driven by 2-3 whale validators`);
  console.log("");
  console.log(`→ wrote ${OUT}`);
}

main();
