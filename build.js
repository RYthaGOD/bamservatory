"use strict";

// BAM OBSERVATORY — dashboard renderer.
// Reads metrics.json (from stats.js) and emits a single self-contained index.html
// (inline CSS, server-rendered SVG charts, no external deps, no JS required).
//
// Usage: node build.js [--in metrics.json] [--out index.html]

const fs = require("fs");
const path = require("path");

const inArg = process.argv.indexOf("--in");
const IN = inArg >= 0 ? process.argv[inArg + 1] : path.join(__dirname, "metrics.json");
const outArg = process.argv.indexOf("--out");
const OUT = outArg >= 0 ? process.argv[outArg + 1] : path.join(__dirname, "index.html");

const M = JSON.parse(fs.readFileSync(IN, "utf8"));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = (n, d = 0) => Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const day = (ts) => ts.slice(0, 10);
const hm = (ts) => ts.slice(11, 16) + "Z";

// ---- server-rendered SVG line/area chart -----------------------------------
function chart(series, key, { w = 520, h = 120, color = "#5eead4", fill = "rgba(94,234,212,.12)" } = {}) {
  const vals = series.map((p) => p[key]);
  const min = Math.min(...vals), max = Math.max(...vals);
  const pad = (max - min) * 0.12 || 1;
  const lo = min - pad, hi = max + pad;
  const X = (i) => (i / (series.length - 1)) * (w - 2) + 1;
  const Y = (v) => h - 6 - ((v - lo) / (hi - lo)) * (h - 12);
  const pts = series.map((p, i) => `${X(i).toFixed(1)},${Y(p[key]).toFixed(1)}`);
  const line = "M" + pts.join(" L");
  const area = `M${X(0).toFixed(1)},${h} L` + pts.join(" L") + ` L${X(series.length - 1).toFixed(1)},${h} Z`;
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" class="chart" role="img">
    <path d="${area}" fill="${fill}" stroke="none"/>
    <path d="${line}" fill="none" stroke="${color}" stroke-width="1.5"/>
  </svg>
  <div class="axis"><span>${day(series[0].ts)}</span><span>${esc(key)}: ${fmt(min, 2)}–${fmt(max, 2)}</span><span>${day(series[series.length - 1].ts)}</span></div>`;
}

const d = M.decentralization, hl = M.headline, det = M.detections;

// ---- concentration severity helper ----------------------------------------
const nk = (n) => n <= 5 ? "bad" : n <= 15 ? "warn" : "ok";

const nodeRows = M.nodes.map((n) => `<tr>
  <td class="mono">${esc(n.node)}</td><td>${esc(n.region)}</td>
  <td class="r">${fmt(n.vals)}</td><td class="r">${fmt(n.stake / 1e6, 2)}M</td>
  <td class="r">${fmt(n.share, 1)}%</td>
  <td class="barcell"><span class="bar" style="width:${Math.min(100, n.share * 4)}%"></span></td></tr>`).join("");

const whaleRows = M.whales.map((v, i) => `<tr>
  <td class="r dim">${i + 1}</td><td class="mono">${esc(v.pkShort)}</td>
  <td>${esc(v.region)}</td><td class="r">${fmt(v.stake / 1e6, 2)}M</td>
  <td class="r">${fmt(v.share, 2)}%</td>
  <td class="barcell"><span class="bar amber" style="width:${Math.min(100, v.share * 8)}%"></span></td></tr>`).join("");

const feedRows = det.feed.map((e) => {
  const tag = e.kind === "CUTOVER"
    ? (e.structural ? `<span class="pill ok">structural</span>` : `<span class="pill warn">whale flip</span>`)
    : `<span class="pill dim">precursor</span>`;
  return `<tr><td class="mono dim">${esc(e.ts.slice(5, 16))}</td><td>${esc(e.kind)}</td><td>${tag}</td><td class="mono">${esc(e.detail)}</td></tr>`;
}).join("");

const validated = det.validated.map((v) => `
  <div class="ev">
    <div class="ev-lead">${v.lead_min}<span>min lead</span></div>
    <div class="ev-body">
      <b>${esc(v.region.toUpperCase())} structural rollover</b> — ${esc(v.from)} → ${esc(v.to)}<br>
      <span class="dim">Precursor <span class="mono">${esc(v.precursorNode)}</span> appeared at ${esc(v.precursorTs.slice(11, 16))}Z; cutover at ${esc(v.ts.slice(11, 16))}Z on ${day(v.ts)}. ${det.rolloverPrecursors} regional precursor signals fired across the coordinated event.</span>
    </div>
  </div>`).join("");

const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>BAMservatory — independent transparency for Jito's Block Assembly Marketplace</title>
<style>
  :root{--bg:#0a0e14;--card:#121822;--card2:#0e141d;--ln:#1f2a37;--tx:#dbe4ee;--dim:#7488a0;--teal:#5eead4;--amber:#fbbf24;--red:#f87171;--green:#34d399}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--tx);font:14px/1.5 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
  .mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}
  .wrap{max-width:1080px;margin:0 auto;padding:28px 20px 60px}
  header{border-bottom:1px solid var(--ln);padding-bottom:18px;margin-bottom:22px}
  h1{margin:0 0 4px;font-size:22px;letter-spacing:-.3px}
  h1 span{color:var(--teal)}
  .sub{color:var(--dim);font-size:13px}
  .meta{color:var(--dim);font-size:12px;margin-top:8px}
  h2{font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:var(--dim);margin:30px 0 12px;font-weight:600}
  .grid{display:grid;gap:14px}
  .g4{grid-template-columns:repeat(4,1fr)}.g3{grid-template-columns:repeat(3,1fr)}.g2{grid-template-columns:repeat(2,1fr)}
  @media(max-width:760px){.g4,.g3,.g2{grid-template-columns:repeat(2,1fr)}}
  .card{background:var(--card);border:1px solid var(--ln);border-radius:10px;padding:16px}
  .kpi .v{font-size:26px;font-weight:680;letter-spacing:-.5px}
  .kpi .l{color:var(--dim);font-size:12px;margin-top:2px}
  .kpi .n{font-size:11px;color:var(--dim);margin-top:6px}
  .big .v{font-size:34px}
  .v.bad{color:var(--red)}.v.warn{color:var(--amber)}.v.ok{color:var(--green)}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--ln)}
  th{color:var(--dim);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.05em}
  td.r,th.r{text-align:right}.dim{color:var(--dim)}
  .barcell{width:120px}.bar{display:block;height:7px;border-radius:4px;background:var(--teal)}.bar.amber{background:var(--amber)}
  .chart{width:100%;height:120px;display:block}
  .axis{display:flex;justify-content:space-between;color:var(--dim);font-size:11px;margin-top:4px}
  .pill{font-size:10px;padding:2px 7px;border-radius:20px;font-weight:600}
  .pill.ok{background:rgba(52,211,153,.15);color:var(--green)}.pill.warn{background:rgba(251,191,36,.15);color:var(--amber)}.pill.dim{background:rgba(116,136,160,.15);color:var(--dim)}
  .ev{display:flex;gap:16px;align-items:center;background:var(--card2);border:1px solid var(--ln);border-radius:10px;padding:14px 16px;margin-bottom:10px}
  .ev-lead{font-size:30px;font-weight:720;color:var(--green);line-height:1;text-align:center}
  .ev-lead span{display:block;font-size:10px;color:var(--dim);font-weight:500;text-transform:uppercase}
  .note{background:var(--card2);border:1px solid var(--ln);border-left:3px solid var(--amber);border-radius:6px;padding:12px 14px;color:var(--dim);font-size:12.5px;margin-top:10px}
  footer{margin-top:40px;padding-top:18px;border-top:1px solid var(--ln);color:var(--dim);font-size:12px}
  code{background:#0e141d;padding:1px 5px;border-radius:4px;font-size:12px}
  a{color:var(--teal)}
</style></head>
<body><div class="wrap">

<header>
  <h1><span>BAM</span>servatory</h1>
  <div class="sub">An independent transparency &amp; early-warning layer for Jito's Block Assembly Marketplace.</div>
  <div class="meta">Window ${day(M.window.from)} → ${day(M.window.to)} · ${fmt(M.window.snapshots)} snapshots @ ~60s · generated ${esc(M.generatedAt.slice(0, 16))}Z · source: public BAM API</div>
</header>

<h2>BAM at a glance</h2>
<div class="grid g4">
  <div class="card kpi big"><div class="v">${fmt(hl.bamStakePct, 1)}%</div><div class="l">of ALL Solana stake routed through BAM</div><div class="n">${fmt(hl.bamStakeSOL / 1e6, 1)}M SOL</div></div>
  <div class="card kpi"><div class="v">${fmt(hl.validatorCount)}</div><div class="l">validators connected</div><div class="n">across ${fmt(d.regionCount)} regions</div></div>
  <div class="card kpi"><div class="v">${fmt(hl.nodeCount)}</div><div class="l">BAM nodes live</div><div class="n">busiest: ${esc(hl.busiestByVals.region)} (${fmt(hl.busiestByVals.vals)} validators)</div></div>
  <div class="card kpi"><div class="v">${fmt(hl.topNodeShare, 1)}%</div><div class="l">stake on the top node</div><div class="n mono">${esc(hl.topNode)}</div></div>
</div>

<h2>Decentralization — how concentrated is BAM?</h2>
<div class="grid g4">
  <div class="card kpi"><div class="v ${nk(d.nodeNakamoto)}">${d.nodeNakamoto}</div><div class="l">Nakamoto coefficient (nodes)</div><div class="n">min nodes controlling &gt;50% of BAM stake</div></div>
  <div class="card kpi"><div class="v ${nk(d.validatorNakamoto)}">${d.validatorNakamoto}</div><div class="l">Nakamoto coefficient (validators)</div><div class="n">min validators controlling &gt;50%</div></div>
  <div class="card kpi"><div class="v ${nk(d.regionNakamoto)}">${d.regionNakamoto}</div><div class="l">Nakamoto coefficient (regions)</div><div class="n">geographic concentration</div></div>
  <div class="card kpi"><div class="v">${fmt(d.top10ValShare, 0)}%</div><div class="l">held by the top 10 validators</div><div class="n">top 1: ${fmt(d.top1ValShare, 1)}% · top 5: ${fmt(d.top5ValShare, 1)}%</div></div>
</div>
<div class="note">A Nakamoto coefficient of <b>${d.nodeNakamoto}</b> means just ${d.nodeNakamoto} BAM nodes control a majority of the stake flowing through the marketplace — and the network's single largest node by stake changed hands <b>${M.leadershipChanges.length} times</b> in this window, driven by a handful of whale validators toggling between nodes (see Whale Watch). These are exactly the concentration dynamics a transparency layer should surface.</div>

<h2>Trends</h2>
<div class="grid g2">
  <div class="card"><div class="dim" style="font-size:12px;margin-bottom:8px">BAM share of Solana stake (%)</div>${chart(M.series, "pct", { color: "#5eead4", fill: "rgba(94,234,212,.12)" })}</div>
  <div class="card"><div class="dim" style="font-size:12px;margin-bottom:8px">Node-stake concentration (HHI)</div>${chart(M.series, "hhi", { color: "#fbbf24", fill: "rgba(251,191,36,.10)" })}</div>
</div>

<h2>Early warning — structural rollover detection</h2>
${validated}
<div class="note">BAM periodically migrates validators between TEE nodes in coordinated, region-by-region rollovers. The Observatory detects these <b>before</b> they complete: when a new node appears in a region, a cutover in that region typically follows within ~30 minutes. <b>Validated on the 2026-06-24 event with ${det.validated[0] ? det.validated[0].lead_min : 0}-minute lead time (n=1 structural event; detector is live and accumulating more).</b> Live "leadership flips" below are mostly whale-driven stake toggles, not structural rollovers — the Observatory labels them as such rather than counting them as early-warning wins.</div>
<div class="card" style="margin-top:12px;padding:4px 0">
  <table><thead><tr><th>time (UTC)</th><th>event</th><th>type</th><th>detail</th></tr></thead><tbody>${feedRows}</tbody></table>
</div>

<h2>Current topology — ${fmt(hl.nodeCount)} nodes</h2>
<div class="card" style="padding:4px 0">
  <table><thead><tr><th>node</th><th>region</th><th class="r">validators</th><th class="r">stake</th><th class="r">share</th><th></th></tr></thead><tbody>${nodeRows}</tbody></table>
</div>

<h2>Whale watch — who controls BAM stake</h2>
<div class="card" style="padding:4px 0">
  <table><thead><tr><th class="r">#</th><th>validator</th><th>node region</th><th class="r">stake</th><th class="r">share</th><th></th></tr></thead><tbody>${whaleRows}</tbody></table>
</div>
<div class="note">Stake leadership of the BAM network is steered by a small set of large validators. Surfacing <i>who</i> they are and <i>where</i> they route makes BAM's power distribution legible to the Solana ecosystem — a public good no tool provides today.</div>

<footer>
  <b>Methodology.</b> All figures are computed from the public BAM API (<code>/nodes</code>, <code>/validators</code>, <code>/bam_stake</code>), sampled every ~60 seconds and flattened to CSV. Nakamoto coefficient = minimum entities whose cumulative stake exceeds 50%. HHI = Herfindahl–Hirschman index of node stake shares. Early-warning detection compares consecutive node sets and times region cutovers against precursor node appearances. No private data, no token, no chain — an independent observatory.<br><br>
  Built for review by the Jito &amp; Solana Foundations as a candidate ecosystem public good. Numbers reflect the capture window above and update as new data lands.
</footer>

</div></body></html>`;

fs.writeFileSync(OUT, html);
console.log(`→ wrote ${OUT}  (${(html.length / 1024).toFixed(1)} KB, self-contained)`);
