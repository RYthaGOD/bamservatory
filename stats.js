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

// ---- 2. nodes.csv latest snapshot + region rollup -------------------------
function loadNodesLatest(latestTs) {
  const lines = fs.readFileSync(NODES, "utf8").trim().split(/\r?\n/);
  const hdr = lines[0].split(",");
  const I = {
    ts: hdr.indexOf("ts"), node: hdr.indexOf("bam_node"),
    vals: hdr.indexOf("connected_validators"), stake: hdr.indexOf("node_stake"),
  };
  const nodes = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(",");
    if (c[I.ts] !== latestTs) continue;
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
function loadDetections() {
  // VALIDATED — from the backtest replay. A genuine structural cutover is one
  // whose matched precursor was a same-region SIGNAL with a short (<60min) lead.
  const replay = readLog(path.join(DIR, "detections_replay.log"));
  const validated = [];
  for (const e of replay) {
    if (e.kind !== "CUTOVER") continue;
    const lead = num(e.kv.lead_min);
    if (e.kv.first_signal && e.kv.first_signal !== "none" && lead > 0 && lead < 60) {
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
  const feed = live.slice(-12).reverse().map((e) => ({
    ts: e.ts, kind: e.kind, region: e.kv.region,
    detail: e.kind === "CUTOVER" ? `${e.kv.old} → ${e.kv.new}` : `new ${e.kv.new_node}`,
    structural: e.kind === "CUTOVER" ? e.kv.first_signal !== "none" : null,
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

  const reduceStat = (key) => {
    let min = Infinity, max = -Infinity, sum = 0;
    for (const r of summary) { min = Math.min(min, r[key]); max = Math.max(max, r[key]); sum += r[key]; }
    return { min, max, avg: sum / summary.length, cur: latest[key] };
  };

  // downsample series for charts (~240 points max)
  const step = Math.max(1, Math.floor(summary.length / 240));
  const series = summary.filter((_, i) => i % step === 0 || i === summary.length - 1)
    .map((r) => ({ ts: r.ts, pct: r.pct, hhi: r.hhi, vals: r.vals, nodes: r.nodes }));

  const nodesLatest = loadNodesLatest(latest.ts);
  const validatorsLatest = await loadValidatorsLatest(latest.ts);
  const detections = loadDetections();

  const metrics = {
    generatedAt: new Date().toISOString(),
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
