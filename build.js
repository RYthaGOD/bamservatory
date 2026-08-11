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
// Absolute origin — needed for social-card (og:/twitter:) URLs, which cannot be relative.
const siteArg = process.argv.indexOf("--site");
const SITE = (siteArg >= 0 ? process.argv[siteArg + 1] : "https://rythagod.github.io/bamservatory").replace(/\/$/, "");

const M = JSON.parse(fs.readFileSync(IN, "utf8"));
// Optional — the dashboard builds fine without it (fresh clone, or brief.js unrun).
const BRIEF = path.join(path.dirname(IN), "briefing.json");
const B = fs.existsSync(BRIEF) ? JSON.parse(fs.readFileSync(BRIEF, "utf8")) : null;
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

  // Position by timestamp, not by array index.
  //
  // The series is downsampled by sample count, and capture rate has not been
  // constant — it ran at 1440/day, decayed to 480/day for much of July, and is
  // back at 1440/day. Spacing points evenly therefore drew a horizontal axis of
  // "sample number" underneath labels showing dates, so densely captured periods
  // occupied more width than their duration and sparse ones less. The shape of
  // every trend was distorted by how often the collector happened to be running,
  // which is exactly the sort of quiet misreading this dashboard exists to avoid.
  const t0 = Date.parse(series[0].ts);
  const t1 = Date.parse(series[series.length - 1].ts);
  const span = t1 - t0;
  const X = (p, i) => (span > 0
    ? ((Date.parse(p.ts) - t0) / span) * (w - 2) + 1
    : (i / Math.max(1, series.length - 1)) * (w - 2) + 1);
  const Y = (v) => h - 6 - ((v - lo) / (hi - lo)) * (h - 12);
  const pts = series.map((p, i) => `${X(p, i).toFixed(1)},${Y(p[key]).toFixed(1)}`);
  const line = "M" + pts.join(" L");
  const area = `M${X(series[0], 0).toFixed(1)},${h} L` + pts.join(" L") +
    ` L${X(series[series.length - 1], series.length - 1).toFixed(1)},${h} Z`;
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

// ---- brand: social blurb + BAMsey sentinel state ---------------------------
// The sentinel badge is driven by live data, not decoration: it goes amber the
// moment node concentration crosses the alert threshold (Nakamoto <= 3).
const social = `BAM routes ${fmt(hl.bamStakePct, 1)}% of all Solana stake (${fmt(hl.bamStakeSOL / 1e6, 1)}M SOL) through ${fmt(hl.nodeCount)} nodes for ${fmt(hl.validatorCount)} validators. Node Nakamoto coefficient: ${d.nodeNakamoto}. Independent, open telemetry — concentration, whale watch and structural-rollover early warning.`;
const alerting = d.nodeNakamoto <= 3;
const concentrationNote = `Just ${d.nodeNakamoto} of the ${fmt(hl.nodeCount)} live BAM nodes hold a majority of marketplace stake, the largest holding ${fmt(hl.topNodeShare, 1)}% on its own — and the top node by stake changed hands <b>${M.leadershipChanges.length} times</b> in this window, driven by a handful of whale validators toggling between nodes (see Whale Watch). These are exactly the concentration dynamics a transparency layer should surface.`;
const sentinel = alerting
  ? { cls: "alert", label: `Alert · Nakamoto ${d.nodeNakamoto}`, title: `Node Nakamoto coefficient is ${d.nodeNakamoto} — ${d.nodeNakamoto} BAM nodes control a majority of marketplace stake.` }
  : { cls: "", label: "Sentinel active", title: `Node Nakamoto coefficient is ${d.nodeNakamoto}. Concentration within normal range.` };

// ---- cross-source verification ----------------------------------------------
// The only panel here that checks BAM rather than reporting it, so it says
// plainly what was checked, what held, and what is still taken on trust.
//
// Status colours, not series colours: each figure is a state (holds / disagrees),
// and every one is paired with words. A reader who cannot distinguish the hues
// loses nothing, which is the whole point of keeping the status palette reserved.
//
// No chart until there are enough readings to mean something. A line through
// three points implies a trend that has not been observed, and this panel is the
// last place on the page that should overstate its evidence.
const V = M.verification;
const verificationPanel = !V ? "" : (() => {
  const v = V.latest;
  const stakeHolds = v.stakeMaxRelPct < 0.01;
  const agree = v.onlyExplorer === 0 && v.onlyKobe === 0;
  const disputed = v.onlyExplorer + v.onlyKobe;
  const ENOUGH = 24;   // ~12 hours at one reading per half hour

  const trend = V.series.length >= ENOUGH
    ? `<div class="grid g2" style="margin-top:12px">
        <div class="card"><div class="dim" style="font-size:12px;margin-bottom:8px">Validators the two sources disagree on</div>${chart(V.series, "onlyExplorer", { color: "#fbbf24", fill: "rgba(251,191,36,.10)" })}</div>
        <div class="card"><div class="dim" style="font-size:12px;margin-bottom:8px">Largest per-validator stake deviation (%)</div>${chart(V.series, "stakeMaxRelPct", { color: "#5eead4", fill: "rgba(94,234,212,.12)" })}</div>
       </div>`
    : (() => {
        // Measured from the readings themselves rather than restating the
        // configured interval, which drifts the moment the schedule changes —
        // the same way this sentence already said "30 minutes" after the
        // collector had moved to 15.
        const ts = V.series.map((r) => Date.parse(r.ts)).sort((a, b) => a - b);
        const gaps = ts.slice(1).map((t, i) => (t - ts[i]) / 60000).sort((a, b) => a - b);
        const cadence = gaps.length ? Math.round(gaps[Math.floor(gaps.length / 2)]) : null;
        return `<div class="note" style="margin-top:12px">Readings are still accumulating — ${V.readings} so far since ${day(V.since)}${cadence ? `, roughly one every ${cadence} minutes` : ""}. Trends appear once there are enough to distinguish a persistent disagreement from a transient one.</div>`;
      })();

  return `
<h2>Verification — checking what BAM reports</h2>
<div class="note">Everything above is gathered from BAM's own API, which makes it an index of what BAM says. This section checks it. Stake is verified against Solana itself, where the chain is the authority and BAM's figures either match or they do not. Membership is cross-checked against Jito's separate Kobe API, which publishes the same fact independently.
<br><br><b>Read at ${esc(v.ts.replace("T", " ").replace("Z", " UTC"))}</b>, on its own slower cycle than the figures above — it queries three services and a full Solana vote-account set, so it runs less often than the 60-second capture. Counts here will therefore differ slightly from the headline, which is the more recent reading, not a contradiction of it.</div>
<div class="grid g4" style="margin-top:12px">
  <div class="card kpi"><div class="v ${stakeHolds ? "ok" : "bad"}">${stakeHolds ? "Matches" : "Differs"}</div><div class="l">BAM's reported stake vs Solana</div><div class="n">${fmt(v.onchainMatched)} validators checked · largest deviation ${fmt(v.stakeMaxRelPct, 4)}%</div></div>
  <div class="card kpi"><div class="v">${v.bamHeadlineSharePct ? fmt(Math.abs(v.bamHeadlineSharePct - v.bamShareOnchainPct), 3) + "pp" : "—"}</div><div class="l">gap between BAM's claim and the chain</div><div class="n">${v.bamHeadlineSharePct ? `BAM publishes ${fmt(v.bamHeadlineSharePct, 4)}% · chain gives ${fmt(v.bamShareOnchainPct, 4)}%` : "awaiting a reading"}</div></div>
  <div class="card kpi"><div class="v ${agree ? "ok" : "warn"}">${agree ? "Agree" : fmt(disputed)}</div><div class="l">${agree ? "Jito's two sources agree" : "validators the two sources disagree on"}</div><div class="n">BAM explorer lists ${fmt(v.explorerValidators)} · Kobe flags ${fmt(v.kobeRunningBam)}</div></div>
  <div class="card kpi"><div class="v ${agree ? "ok" : "warn"}">${agree ? "0" : fmt(v.disputedStakeSol / 1e3, 0) + "k"}</div><div class="l">SOL under disagreement</div><div class="n">stake attached to the validators in dispute</div></div>
</div>
${trend}
<div class="note" style="margin-top:12px"><b>What this does not establish.</b> Which validators run BAM still comes from Jito — a BAM-produced block is indistinguishable from any other on chain, because BAM changes how a block is assembled, not what ends up in it. That membership claim is now cross-checked between two of Jito's own systems rather than taken on faith, and the stake attached to it is verified outright against Solana — but it is not independently derived, and no amount of cross-checking makes it so. That gap closes with published attestations, not with more sources.</div>`;
})();

// ---- BAMsey's briefing ------------------------------------------------------
// Provenance is stated on the page: a machine-written note is only credible here
// if the reader can see how it was produced and that its figures were checked.
const briefing = !B ? "" : `
<div class="brief">
  <img src="assets/bamsey.png" width="44" height="44" alt="BAMsey">
  <div>
    <div class="who">BAMsey's read</div>
    <div class="say">${esc(B.text)}</div>
    <div class="prov">${B.source === "llm"
      ? `Written by <code>${esc(B.model)}</code> from the published metrics · <span class="ok">✓ every figure cross-checked against the dataset before publishing</span>`
      : `Generated deterministically from the published metrics`} · ${esc(B.generatedAt.slice(0, 16))}Z</div>
  </div>
</div>`;

const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>BAMservatory — independent transparency for Jito's Block Assembly Marketplace</title>
<meta name="description" content="${esc(social)}">
<link rel="icon" type="image/png" href="assets/favicon.png">
<link rel="apple-touch-icon" href="assets/favicon.png">
<meta property="og:type" content="website">
<meta property="og:site_name" content="BAMservatory">
<meta property="og:title" content="BAMservatory — independent transparency for Jito's Block Assembly Marketplace">
<meta property="og:description" content="${esc(social)}">
<meta property="og:url" content="${SITE}/">
<meta property="og:image" content="${SITE}/assets/og.jpg">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="BAMservatory — independent transparency for BAM">
<meta name="twitter:description" content="${esc(social)}">
<meta name="twitter:image" content="${SITE}/assets/og.jpg">
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
  .meta{color:var(--dim);font-size:12px;margin-top:12px}
  .brand{display:flex;align-items:center;gap:15px;flex-wrap:wrap}
  .mark{width:48px;height:48px;flex:none;border-radius:11px;border:1px solid var(--ln);background:var(--card2);display:block}
  .sentinel{display:flex;align-items:center;gap:10px;margin-left:auto;background:var(--card2);border:1px solid var(--ln);border-radius:30px;padding:7px 15px 7px 7px}
  .sentinel img{width:34px;height:34px;flex:none;border-radius:50%;object-fit:cover;border:1px solid var(--teal);background:#000}
  .sentinel .s1{display:block;font-size:11px;font-weight:600;line-height:1.3;color:var(--teal)}
  .sentinel .s2{display:block;font-size:10px;color:var(--dim);line-height:1.3}
  .sentinel.alert{border-color:rgba(251,191,36,.35)}
  .sentinel.alert img{border-color:var(--amber)}
  .sentinel.alert .s1{color:var(--amber)}
  .alertcard{display:flex;gap:16px;align-items:center;background:var(--card2);border:1px solid var(--ln);border-left:3px solid var(--amber);border-radius:8px;padding:14px 16px;margin-top:10px}
  .alertcard img{width:84px;height:84px;flex:none;border-radius:8px;object-fit:cover;border:1px solid var(--ln)}
  .alertcard .t{font-size:12.5px;color:var(--dim)}
  .alertcard .t b{color:var(--tx)}
  .brief{display:flex;gap:16px;background:linear-gradient(180deg,rgba(94,234,212,.05),transparent);border:1px solid var(--ln);border-radius:10px;padding:16px 18px;margin-top:14px}
  .brief>img{width:44px;height:44px;flex:none;border-radius:50%;object-fit:cover;border:1px solid var(--teal);background:#000}
  .brief .who{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--teal);margin-bottom:5px}
  .brief .say{font-size:14.5px;line-height:1.62}
  .brief .prov{margin-top:9px;font-size:11px;color:var(--dim)}
  .brief .prov .ok{color:var(--green)}
  .fbrand{display:flex;gap:14px;align-items:center;margin-bottom:14px}
  .fbrand img{width:56px;height:56px;flex:none;border-radius:50%;object-fit:cover;object-position:52% 26%;border:1px solid var(--ln)}
  @media(max-width:640px){.sentinel{margin-left:0}.alertcard img{width:64px;height:64px}}
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
  .tblcard{padding:4px 0;overflow-x:auto}
  .tblcard table{min-width:560px}
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
  <div class="brand">
    <img class="mark" src="assets/logo.png" width="48" height="48" alt="BAMservatory emblem">
    <div>
      <h1><span>BAM</span>servatory</h1>
      <div class="sub">An independent transparency &amp; early-warning layer for Jito's Block Assembly Marketplace.</div>
    </div>
    <div class="sentinel ${sentinel.cls}" title="${esc(sentinel.title)}">
      <img src="assets/bamsey.png" width="34" height="34" alt="BAMsey, the Observatory sentinel">
      <div>
        <span class="s1 mono">BAMsey · ${esc(sentinel.label)}</span>
        <span class="s2">observatory telemetry sentinel</span>
      </div>
    </div>
  </div>
  <div class="meta">Window ${day(M.window.from)} → ${day(M.window.to)} · ${fmt(M.window.snapshots)} snapshots @ ~60s · generated ${esc(M.generatedAt.slice(0, 16))}Z · source: public BAM API</div>
</header>

<h2>BAM at a glance</h2>
<div class="grid g4">
  <div class="card kpi big"><div class="v">${fmt(hl.bamStakePct, 1)}%</div><div class="l">of ALL Solana stake routed through BAM</div><div class="n">${fmt(hl.bamStakeSOL / 1e6, 1)}M SOL</div></div>
  <div class="card kpi"><div class="v">${fmt(hl.validatorCount)}</div><div class="l">validators connected</div><div class="n">across ${fmt(d.regionCount)} regions</div></div>
  <div class="card kpi"><div class="v">${fmt(hl.nodeCount)}</div><div class="l">BAM nodes live</div><div class="n">busiest: ${esc(hl.busiestByVals.region)} (${fmt(hl.busiestByVals.vals)} validators)</div></div>
  <div class="card kpi"><div class="v">${fmt(hl.topNodeShare, 1)}%</div><div class="l">stake on the top node</div><div class="n mono">${esc(hl.topNode)}</div></div>
</div>
${briefing}

<h2>Decentralization — how concentrated is BAM?</h2>
<div class="grid g4">
  <div class="card kpi"><div class="v ${nk(d.nodeNakamoto)}">${d.nodeNakamoto}</div><div class="l">Nakamoto coefficient (nodes)</div><div class="n">min nodes controlling &gt;50% of BAM stake</div></div>
  <div class="card kpi"><div class="v ${nk(d.validatorNakamoto)}">${d.validatorNakamoto}</div><div class="l">Nakamoto coefficient (validators)</div><div class="n">min validators controlling &gt;50%</div></div>
  <div class="card kpi"><div class="v ${nk(d.regionNakamoto)}">${d.regionNakamoto}</div><div class="l">Nakamoto coefficient (regions)</div><div class="n">geographic concentration</div></div>
  <div class="card kpi"><div class="v">${fmt(d.top10ValShare, 0)}%</div><div class="l">held by the top 10 validators</div><div class="n">top 1: ${fmt(d.top1ValShare, 1)}% · top 5: ${fmt(d.top5ValShare, 1)}%</div></div>
</div>
${alerting
  ? `<div class="alertcard">
      <img src="assets/bamsey-alert.jpg" width="84" height="84" alt="BAMsey in alert state">
      <div class="t"><b>Concentration alert — node Nakamoto coefficient is ${d.nodeNakamoto}.</b> ${concentrationNote}</div>
     </div>`
  : `<div class="note">A Nakamoto coefficient of <b>${d.nodeNakamoto}</b> means just ${d.nodeNakamoto} BAM nodes control a majority of the stake flowing through the marketplace. ${concentrationNote}</div>`}

<h2>Trends</h2>
<div class="grid g2">
  <div class="card"><div class="dim" style="font-size:12px;margin-bottom:8px">BAM share of Solana stake (%)</div>${chart(M.series, "pct", { color: "#5eead4", fill: "rgba(94,234,212,.12)" })}</div>
  <div class="card"><div class="dim" style="font-size:12px;margin-bottom:8px">Node-stake concentration (HHI)</div>${chart(M.series, "hhi", { color: "#fbbf24", fill: "rgba(251,191,36,.10)" })}</div>
</div>

${verificationPanel}

<h2>Early warning — structural rollover detection</h2>
${validated}
<div class="note">BAM periodically migrates validators between TEE nodes in coordinated, region-by-region rollovers. The Observatory detects these <b>before</b> they complete: when a new node appears in a region, a cutover in that region typically follows within ~30 minutes. <b>Validated on the 2026-06-24 event with ${det.validated[0] ? det.validated[0].lead_min : 0}-minute lead time (n=1 structural event; detector is live and accumulating more).</b> Live "leadership flips" below are mostly whale-driven stake toggles, not structural rollovers — the Observatory labels them as such rather than counting them as early-warning wins.</div>
<div class="card tblcard" style="margin-top:12px">
  <table><thead><tr><th>time (UTC)</th><th>event</th><th>type</th><th>detail</th></tr></thead><tbody>${feedRows}</tbody></table>
</div>

<h2>Current topology — ${fmt(hl.nodeCount)} nodes</h2>
<div class="card tblcard">
  <table><thead><tr><th>node</th><th>region</th><th class="r">validators</th><th class="r">stake</th><th class="r">share</th><th></th></tr></thead><tbody>${nodeRows}</tbody></table>
</div>

<h2>Whale watch — who controls BAM stake</h2>
<div class="card tblcard">
  <table><thead><tr><th class="r">#</th><th>validator</th><th>node region</th><th class="r">stake</th><th class="r">share</th><th></th></tr></thead><tbody>${whaleRows}</tbody></table>
</div>
<div class="note">Stake leadership of the BAM network is steered by a small set of large validators. Surfacing <i>who</i> they are and <i>where</i> they route makes BAM's power distribution legible to the Solana ecosystem — a public good no tool provides today.</div>

<footer>
  <div class="fbrand">
    <img src="assets/bamsey-hero.jpg" width="56" height="56" alt="BAMsey, the BAMservatory sentinel">
    <div><b style="color:var(--tx)">BAMsey</b> — the Observatory's sentinel. Every 60 seconds he re-reads the public BAM API, recomputes concentration, and flags a structural rollover the moment its precursor appears. ${fmt(M.window.snapshots)} snapshots so far, no gaps, no paywall.</div>
  </div>
  <b>Methodology.</b> All figures are computed from the public BAM API (<code>/nodes</code>, <code>/validators</code>, <code>/bam_stake</code>), sampled every ~60 seconds and flattened to CSV. Nakamoto coefficient = minimum entities whose cumulative stake exceeds 50%. HHI = Herfindahl–Hirschman index of node stake shares. Early-warning detection compares consecutive node sets and times region cutovers against precursor node appearances. No private data, no token, no chain — an independent observatory.<br><br>
  ${B && B.source === "llm" ? `<b>On BAMsey's read.</b> The briefing at the top of this page is written by a language model, and it is constrained so that it cannot affect the integrity of anything else here. The model never touches raw data and performs no arithmetic: it receives only the figures already computed above and may cite nothing else. Every numeral it returns is checked against that set before publishing; a note citing an unverifiable figure is rejected and regenerated, and on repeated failure a deterministic template is published in its place. It is editorial judgement about which numbers matter — never a source of numbers.<br><br>` : ""}
  Built for review by the Jito &amp; Solana Foundations as a candidate ecosystem public good. Numbers reflect the capture window above and update as new data lands.
</footer>

</div></body></html>`;

fs.writeFileSync(OUT, html);
console.log(`→ wrote ${OUT}  (${(html.length / 1024).toFixed(1)} KB, self-contained)`);
