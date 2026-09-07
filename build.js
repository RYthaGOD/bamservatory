"use strict";

// BAM OBSERVATORY — dashboard renderer.
// Reads metrics.json (from stats.js) and emits a single self-contained index.html
// (inline CSS, server-rendered SVG charts, no external deps, no JS required).
//
// Usage: node build.js [--in metrics.json] [--out index.html]
//
// ---- on the visual language -------------------------------------------------
// The layout is the telemetry-console design: fixed header, ruled sections,
// metric tiles with a footed strip, mono figures against a sans body.
//
// It is hand-written CSS rather than the utility framework the design was drafted
// in, and it names system fonts ahead of the webfonts it was drawn with. That is
// deliberate, not a shortcut. This page is a transparency artifact: it has to
// render the same for a reader behind a corporate proxy, in a web archive, or
// with scripting off, and it must not report who reads it to a third party. A
// CDN-compiled stylesheet makes the whole dashboard contingent on a network fetch
// and a JIT compiler; a webfont request leaks every visit. Neither is a trade
// this page can make, so the design was ported rather than embedded.

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

// Material-style glyphs, inlined. The design asks for icons and an icon font
// would be a network dependency for a few hundred bytes of path data.
const ICON = {
  info: "M11 7h2v2h-2V7zm0 4h2v6h-2v-6zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z",
  clock: "M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z",
};
const icon = (n, size = 18) =>
  `<svg class="ic" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" focusable="false"><path d="${ICON[n]}"/></svg>`;

// ---- server-rendered SVG line/area chart -----------------------------------
let gradSeq = 0;
function chartCard(title, series, key, color, curFmt, { small = false } = {}) {
  const id = `grad${++gradSeq}`;
  const w = 500, h = small ? 90 : 150;
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
  const guides = [0.2, 0.53, 0.87]
    .map((f) => `<line x1="0" y1="${(h * f).toFixed(1)}" x2="${w}" y2="${(h * f).toFixed(1)}" stroke="#1c2028" stroke-dasharray="3 3"/>`)
    .join("");

  // The plot is stretched to the card (preserveAspectRatio="none"), so anything
  // round in user space renders as an ellipse and a 2px stroke thins or fattens
  // with the viewport. The stroke is pinned with vector-effect; the terminal dot
  // is placed in CSS at the same fraction of the height the last point sits at,
  // rather than drawn in the SVG, so it stays a circle at every width.
  const last = series[series.length - 1];
  const tip = (Y(last[key]) / h) * 100;

  return `<div class="card">
  <div class="card-h"><div class="card-t">${title}</div><span class="chip" style="color:${color}">${esc(key)}: ${curFmt(min)} – ${curFmt(max)}</span></div>
  <div class="chartwrap${small ? " sm" : ""}">
    <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" class="chart" role="img" aria-label="${esc(title)}, ranging ${fmt(min, 2)} to ${fmt(max, 2)}">
      ${guides}
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${color}" stop-opacity=".32"/><stop offset="100%" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
      <path d="${area}" fill="url(#${id})" stroke="none"/>
      <path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
    </svg>
    <span class="tip" style="top:${tip.toFixed(2)}%;background:${color}"></span>
  </div>
  <div class="axis"><span>${day(series[0].ts)}</span><span style="color:${color}">Cur: ${curFmt(last[key])}</span><span>${day(last.ts)}</span></div>
</div>`;
}

const d = M.decentralization, hl = M.headline, det = M.detections;

// ---- concentration severity helper ----------------------------------------
// One mapping, used wherever a coefficient is shown. The same number must not
// read CRITICAL on one tile and something softer on the next because the design
// had room for a gentler word there.
const nk = (n) => n <= 5 ? "bad" : n <= 15 ? "warn" : "ok";
const NK_LABEL = { bad: "Critical", warn: "Elevated", ok: "Nominal" };

// ---- change over the capture window ----------------------------------------
// The headline tile carries a delta. The series is downsampled (median gap runs
// into hours), so a point exactly seven days old rarely exists. Same method as
// brief.js: seek the nearest reading, and report the interval actually measured
// instead of claiming a round week that was never sampled.
function seriesAt(S, hoursAgo) {
  if (!S || S.length < 2) return null;
  const gaps = [];
  for (let i = 1; i < S.length; i++) gaps.push(Date.parse(S[i].ts) - Date.parse(S[i - 1].ts));
  gaps.sort((a, b) => a - b);
  const tol = Math.max(3 * 3600e3, (gaps[Math.floor(gaps.length / 2)] || 0) * 2);
  const now = Date.parse(S[S.length - 1].ts);
  const target = now - hoursAgo * 3600e3;
  let best = null, bestGap = Infinity;
  for (const p of S) {
    const g = Math.abs(Date.parse(p.ts) - target);
    if (g < bestGap) { bestGap = g; best = p; }
  }
  if (bestGap > tol) return null;
  const hours = (now - Date.parse(best.ts)) / 3600e3;
  if (hours < 1) return null;
  return { p: best, hours: Math.round(hours), days: Math.round(hours / 24) };
}
// Drawn in the series colour, not green-up/red-down. A rise in BAM's share of
// Solana is neither good news nor bad news, it is the measurement — colouring it
// as a verdict would be the page editorialising in CSS.
const weekAgo = seriesAt(M.series, 168);
const deltaChip = !weekAgo ? "" : (() => {
  const dv = hl.bamStakePct - weekAgo.p.pct;
  const span = weekAgo.days >= 2 ? `${weekAgo.days}d` : `${weekAgo.hours}h`;
  return `<span class="delta">${Math.abs(dv) < 0.005 ? `unchanged ${span}` : `${dv > 0 ? "+" : "−"}${fmt(Math.abs(dv), 2)}pp ${span}`}</span>`;
})();

// ---- tables -----------------------------------------------------------------
// Bars are scaled against the largest row rather than against a fixed constant,
// so the top of each table reads as full and every other row is legible as its
// fraction of that — the comparison a reader is actually making.
const topNodeShare = Math.max(...M.nodes.map((n) => n.share)) || 1;
const nodeRows = M.nodes.map((n, i) => `<tr>
  <td class="${i === 0 ? "hi" : "nm"}">${esc(n.node)}</td>
  <td><span class="rgn">${esc(n.region)}</span></td>
  <td class="r">${fmt(n.vals)}</td><td class="r">${fmt(n.stake / 1e6, 2)}M</td>
  <td class="barcell"><span class="barwrap"><span class="track"><span class="fill${n.share >= 10 ? "" : " alt"}" style="width:${Math.min(100, (n.share / topNodeShare) * 100).toFixed(1)}%"></span></span><span class="pct ${i === 0 ? "pctlead" : ""}">${fmt(n.share, 1)}%</span></span></td></tr>`).join("");

const topWhaleShare = M.whales.length ? M.whales[0].share : 1;
const whaleRows = M.whales.map((v, i) => `<tr>
  <td class="r dim">${i + 1}</td><td class="nm">${esc(v.pkShort)}</td>
  <td><span class="rgn">${esc(v.region)}</span></td><td class="r">${fmt(v.stake / 1e6, 2)}M</td>
  <td class="barcell"><span class="barwrap"><span class="track"><span class="fill amber" style="width:${Math.min(100, (v.share / topWhaleShare) * 100).toFixed(1)}%"></span></span><span class="pct">${fmt(v.share, 2)}%</span></span></td></tr>`).join("");

const feedRows = det.feed.map((e) => {
  const tag = e.kind === "CUTOVER"
    ? (e.structural ? `<span class="pill ok">structural</span>` : `<span class="pill warn">whale flip</span>`)
    : `<span class="pill dim">precursor</span>`;
  return `<tr><td class="dim">${esc(e.ts.slice(5, 16))}</td>
  <td class="${e.kind === "CUTOVER" ? "kind cut" : "kind"}">${esc(e.kind)}</td>
  <td>${tag}</td><td class="nm">${esc(e.detail)}</td></tr>`;
}).join("");

const validated = det.validated.map((v) => `
  <div class="lead">
    <div class="lead-n"><b>${v.lead_min}<span>min</span></b><i>lead time</i></div>
    <div class="lead-b">
      <div class="lead-t">${esc(v.region.toUpperCase())} structural rollover <span class="dim">―</span> ${esc(v.from)} <span class="arrow">→</span> ${esc(v.to)}</div>
      <p>Precursor <span class="nm">${esc(v.precursorNode)}</span> appeared at ${esc(v.precursorTs.slice(11, 16))}Z; cutover at ${esc(v.ts.slice(11, 16))}Z on ${day(v.ts)}. ${det.rolloverPrecursors} regional precursor signals fired across the coordinated event.</p>
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
  : { cls: "", label: `Sentinel live · Nakamoto ${d.nodeNakamoto}`, title: `Node Nakamoto coefficient is ${d.nodeNakamoto}. Concentration within normal range.` };

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
  // Median, not max: one validator moving stake between BAM's snapshot and ours
  // decides a max over hundreds and says nothing about the reporting.
  //
  // null on a reading taken before the median was recorded, where the max is
  // genuinely all there is. The fallback has to be reached through a value that
  // can actually be absent — when the reader substituted 0 for a missing median
  // this test read "0 < 0.01" for every historical reading and the tile said
  // "Matches" without consulting anything.
  const med = v.stakeMedianRelPct;
  const stakeHolds = (med ?? v.stakeMaxRelPct) < 0.01;

  // What the share comparison is actually comparing.
  //
  // BAM's published stake figure and our own sum over the chain have agreed to
  // the cent in almost every reading taken. The two *shares* still differ,
  // because a share needs a network total and BAM does not divide by
  // getVoteAccounts'. So the difference is in the denominator, and a tile
  // labelled "gap between BAM's claim and the chain" invited the one reading the
  // data does not support: that BAM misreports its own stake. It does not.
  //
  // Both denominators are recoverable from the row — stake over share — so the
  // panel can state the real disagreement instead of implying a different one.
  const hs = v.bamHeadlineStakeSol, hp = v.bamHeadlineSharePct;
  const haveHeadline = hs != null && hp != null && hp > 0 && v.bamShareOnchainPct > 0;
  const bamTotal = haveHeadline ? hs / (hp / 100) : null;
  const chainTotal = haveHeadline ? v.stakeOnchainSol / (v.bamShareOnchainPct / 100) : null;
  // "The same stake" has to mean the same to the reader as it does here: equal
  // once both are rounded to the SOL, which is the precision either side states.
  const sameStake = haveHeadline && Math.abs(hs - v.stakeOnchainSol) < 1;
  const agree = v.onlyExplorer === 0 && v.onlyKobe === 0;
  const disputed = v.onlyExplorer + v.onlyKobe;

  // A reading far from the last day's median is reported with that median beside
  // it. Kobe's running_bam flag fell from 377 to 206 and recovered inside eighty
  // minutes on 2026-08-13, and for those eighty minutes this panel said 172
  // validators were in dispute with no other indication that the figure was
  // extraordinary. The reading is not adjusted — one of the two sources really
  // did say that, and which one is wrong is not ours to decide — but a reader
  // seeing it is now told what it has otherwise been.
  //
  // Absent from metrics.json written before this existed, so it must be optional
  // rather than assumed, like every other field added after the fact.
  // Both notes are gated on the validator count, not on the stake. The stake in
  // dispute is derived from which validators are in dispute, so it cannot be
  // anomalous on its own — and judging it separately misfires, because a handful
  // of disputed validators is a few hundred thousand SOL whose ordinary
  // variation is easily a factor of two while remaining a rounding error against
  // BAM's 142M. The question worth answering is whether an unusual *number* of
  // validators is in dispute; the stake is then reported in the same breath.
  //
  // Five validators, or half the usual count, whichever is larger: the floor
  // stops a normal one or two from reading as a deviation.
  const T = V.typical;
  const anomalous = T && T.onlyExplorer !== null &&
    Math.abs(disputed - T.onlyExplorer) > Math.max(5, T.onlyExplorer * 0.5);
  const typicalVals = anomalous ? ` · typically ${fmt(T.onlyExplorer)} over the last ${T.hours}h` : "";
  const typicalStake = anomalous && T.disputedStakeSol !== null
    ? ` · typically ${fmt(T.disputedStakeSol / 1e3, 0)}k SOL over the last ${T.hours}h`
    : "";

  // Enough to draw a line: half a day of coverage and enough readings to shape
  // it. Measured, because a bare count meant different things as the cadence
  // changed — 24 readings was twelve hours at one every thirty minutes and six
  // at one every fifteen, and the constant went on claiming twelve.
  const HOURS = 12, POINTS = 12;
  const covers = (s) => s.length >= POINTS &&
    Date.parse(s[s.length - 1].ts) - Date.parse(s[0].ts) >= HOURS * 3600e3;

  // The median arrived later than the columns beside it, so it is charted from
  // the readings that actually carry one and gated on their span, not the
  // panel's. Charting it against the full series would draw the years before it
  // existed as a flat line at zero — a period of perfect agreement that was
  // never observed.
  const medSeries = V.series.filter((r) => r.stakeMedianRelPct !== null);

  // Cadence from the readings themselves rather than the configured interval,
  // which drifts the moment the schedule changes.
  const ts = V.series.map((r) => Date.parse(r.ts)).sort((a, b) => a - b);
  const gaps = ts.slice(1).map((t, i) => (t - ts[i]) / 60000).sort((a, b) => a - b);
  const cadence = gaps.length ? Math.round(gaps[Math.floor(gaps.length / 2)]) : null;

  const plural = (n) => `${n} reading${n === 1 ? "" : "s"}`;

  const cards = [
    covers(V.series)
      ? chartCard("Validators the two sources disagree on", V.series, "onlyExplorer", "#f59e0b", (n) => fmt(n), { small: true })
      : "",
    covers(medSeries)
      ? chartCard("Typical per-validator stake deviation (%)", medSeries, "stakeMedianRelPct", "#4edea3", (n) => fmt(n, 4) + "%", { small: true })
      : "",
  ].filter(Boolean);

  const waiting = [
    covers(V.series) ? "" : `the disagreement count (${plural(V.readings)} since ${day(V.since)}${cadence ? `, roughly one every ${cadence} minutes` : ""})`,
    covers(medSeries) ? "" : `typical deviation (${plural(medSeries.length)}, recorded only since the collector began measuring it)`,
  ].filter(Boolean);

  const trend =
    (cards.length ? `<div class="grid g2 mt">${cards.join("")}</div>` : "") +
    (waiting.length ? `<div class="note sm mt"><p>Still accumulating: ${waiting.join("; and ")}. Each is charted once it covers ${HOURS} hours — long enough to tell a persistent disagreement from a transient one.</p></div>` : "");

  // The date on the attestation claim comes from the last time the collector
  // actually looked, not from whenever someone last edited this sentence. A
  // hand-written date drifts in the one direction that matters: it would go on
  // saying no endpoint exists after one appeared.
  const A = M.attestations;
  const attestationNote = !A ? "" : A.available
    ? ` <b>BAM began serving attestations as of ${esc(day(A.checkedAt))}</b> (${A.endpointsFound.map(esc).join(", ")}) — this section has not yet been rewritten to use them.`
    : A.reachable
      ? ` Re-checked automatically; still no attestation endpoint as of ${esc(day(A.checkedAt))}.`
      : ` The last automatic re-check (${esc(day(A.checkedAt))}) could not reach BAM's API, so it establishes nothing either way.`;

  return `
<section class="sec" id="verification">
  <div class="sec-h">
    <div class="sec-t"><i style="background:var(--green)"></i><h2>Verification — checking what BAM reports</h2></div>
    <span class="bl" style="color:var(--green)">Independent oracle match</span>
  </div>
  <div class="note">
    <p>Everything above is gathered from BAM's own API, which makes it an index of what BAM says. This section checks it. Stake is verified against Solana itself, where the chain is the authority and BAM's figures either match or they do not. Membership is cross-checked against Jito's separate Kobe API, which publishes the same fact independently.</p>
    <div class="strip">${icon("clock", 18)}<span><b>Read at ${esc(v.ts.replace("T", " ").replace("Z", " UTC"))}</b>, on its own slower cycle than the figures above — it queries three services and a full Solana vote-account set, so it runs less often than the 60-second capture. Counts here will therefore differ slightly from the headline, which is the more recent reading, not a contradiction of it.</span></div>
  </div>
  <div class="grid g4 mt">
    <div class="kpi">
      <div><div class="kpi-l">State cross-check</div>
      <div class="kpi-v ${stakeHolds ? "ok" : "bad"}">${stakeHolds ? "Matches" : "Differs"}</div>
      <div class="kpi-t">BAM's reported stake vs Solana</div></div>
      <div class="kpi-n">${fmt(v.onchainMatched)} validators checked · ${med === null ? `deviation ${fmt(v.stakeMaxRelPct, 4)}% at the worst validator; typical not recorded for this reading` : `typical deviation ${fmt(med, 4)}% · worst ${fmt(v.stakeMaxRelPct, 4)}%`}</div>
    </div>
    <div class="kpi">
      <div><div class="kpi-l">Deviation margin</div>
      <div class="kpi-v cy">${!haveHeadline ? "—" : fmt(Math.abs(hp - v.bamShareOnchainPct), 4) + "pp"}</div>
      <div class="kpi-t">${sameStake ? "share gap, and it is the network total" : "gap between BAM's published stake and the chain"}</div></div>
      <div class="kpi-n">${!haveHeadline ? "awaiting a reading" : `BAM publishes ${fmt(hp, 4)}% · chain gives ${fmt(v.bamShareOnchainPct, 4)}%${sameStake ? ` · the same ${fmt(hs, 0)} SOL divided by network totals ${fmt(Math.abs(chainTotal - bamTotal), 0)} SOL apart` : ` · from stakes ${fmt(Math.abs(hs - v.stakeOnchainSol), 2)} SOL apart`}`}</div>
    </div>
    <div class="kpi">
      <div><div class="kpi-l">Kobe dual-source</div>
      <div class="kpi-v ${agree ? "ok" : "warn"}">${agree ? "Agree" : fmt(disputed)}</div>
      <div class="kpi-t">${agree ? "Jito's two sources agree" : "validators the two sources disagree on"}</div></div>
      <div class="kpi-n">BAM explorer lists ${fmt(v.explorerValidators)} · Kobe flags ${fmt(v.kobeRunningBam)}${typicalVals}</div>
    </div>
    <div class="kpi">
      <div><div class="kpi-l">Dispute resolution</div>
      <div class="kpi-v ${agree ? "" : "warn"}">${agree ? "0" : fmt(v.disputedStakeSol / 1e3, 0) + "k"}</div>
      <div class="kpi-t">SOL under disagreement</div></div>
      <div class="kpi-n">stake attached to the validators in dispute${typicalStake}</div>
    </div>
  </div>
  ${trend}
  <div class="callout mt">
    <div class="callout-h">${icon("info", 18)}<span>What this does not establish</span></div>
    <p>Which validators run BAM still comes from Jito — a BAM-produced block is indistinguishable from any other on chain, because BAM changes how a block is assembled, not what ends up in it. That membership claim is now cross-checked between two of Jito's own systems rather than taken on faith, and the stake attached to it is verified outright against Solana — but it is not independently derived, and no amount of cross-checking makes it so. That gap closes with published attestations, not with more sources.${attestationNote}</p>
  </div>
</section>`;
})();

// ---- BAMsey's briefing ------------------------------------------------------
// Provenance is stated on the page: a machine-written note is only credible here
// if the reader can see how it was produced and that its figures were checked.
const briefing = !B ? "" : `
<div class="brief">
  <div class="brief-h">
    <div class="brief-who">
      <img src="assets/bamsey.png" width="28" height="28" alt="BAMsey">
      <span class="brief-name">BAMsey's read</span>
      <span class="tag cy">${B.source === "llm" ? "Synthesis" : "Deterministic"}</span>
    </div>
    <div class="brief-state"><span class="dot ok"></span><span>${B.source === "llm" ? "Figures cross-checked" : "Deterministic output"}</span></div>
  </div>
  <p class="brief-say">${esc(B.text)}</p>
  <div class="brief-f">
    <span>${B.source === "llm"
      ? `Written by <code>${esc(B.model)}</code> from the published metrics · <span class="ok">✓ every figure cross-checked against the dataset before publishing</span>`
      : `Generated deterministically from the published metrics`}</span>
    <span>${esc(B.generatedAt.slice(0, 16))}Z</span>
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
  /* Two colours depart from the source design, both for contrast. Its muted grey
     (#64748b) carries most of the small text on this page — every label, axis and
     footnote — at 3.0-4.0:1 against these surfaces, under the 4.5:1 AA floor the
     previous dashboard met. --tx3 is lightened to clear it. --red2 is the same
     correction for 10px badge text on a red tint, where the full-strength red
     lands at 4.0:1; --red is kept for the large numerals, which pass as-is. */
  :root{
    --void:#0b0f17;--bg:#0f131c;--low:#181c24;--cc:#1c2028;--chi:#262a33;--base:#111827;
    --tx:#f8fafc;--tx2:#94a3b8;--tx3:#8a99ad;--var:#b9cacb;
    --cyan:#00f2fe;--pri:#e0fdff;--green:#4edea3;--amber:#f59e0b;--red:#ef4444;--red2:#f87171;
    --ln:rgba(255,255,255,.08);
    --sans:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
    --mono:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  }
  *{box-sizing:border-box}
  html{scroll-behavior:smooth;scroll-padding-top:96px}
  body{margin:0;background:var(--bg);color:var(--var);font:400 14px/20px var(--sans);-webkit-font-smoothing:antialiased}
  a{color:var(--cyan)}
  b,strong{color:var(--tx);font-weight:600}
  code{background:var(--void);padding:1px 5px;border-radius:4px;font-family:var(--mono);font-size:12px}
  .nm{font-family:var(--mono);font-size:12px}
  .dim{color:var(--tx3)}
  .ok{color:var(--green)}.bad{color:var(--red)}.warn{color:var(--amber)}.cy{color:var(--cyan)}
  .bl{font:600 10px/14px var(--mono);letter-spacing:.06em;text-transform:uppercase;color:var(--tx3)}
  .mt{margin-top:16px}
  .dot{width:8px;height:8px;border-radius:50%;display:block;background:var(--cyan);flex:none}
  .dot.ok{background:var(--green)}.dot.warn{background:var(--amber)}.dot.dim{background:#00dce6}
  .ic{fill:currentColor;flex:none}

  /* header */
  .hdr{position:fixed;top:0;left:0;right:0;z-index:50;background:rgba(11,15,23,.9);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);box-shadow:0 1px 8px rgba(0,0,0,.4)}
  .hdr-in{max-width:1440px;margin:0 auto;padding:0 20px;height:80px;display:flex;align-items:center;justify-content:space-between;gap:24px}
  /* The header is a fixed 80px bar, so nothing inside it may wrap: a second line
     of nav or of the title grows the content past the bar and clips it against
     the top of the viewport. Everything here is nowrap and flex:none, and the
     two optional blocks drop out at widths where they would no longer fit. */
  .brand{display:flex;align-items:center;gap:28px;min-width:0}
  .mark{width:40px;height:40px;border-radius:10px;border:1px solid var(--ln);background:var(--void);flex:none;display:block}
  .btitle{display:flex;align-items:center;gap:8px;white-space:nowrap}
  .bname{margin:0;font:700 24px/32px var(--sans);letter-spacing:-.015em;color:var(--pri);white-space:nowrap}
  .tag{padding:2px 8px;border-radius:12px;background:var(--chi);color:var(--var);font:600 10px/14px var(--mono);letter-spacing:.06em;text-transform:uppercase}
  .tag.cy{background:rgba(0,242,254,.1);color:var(--cyan)}
  .hstat{display:flex;align-items:center;gap:12px;flex:none}
  .statchip{display:flex;align-items:center;gap:6px;padding:4px 10px;border-radius:12px;background:var(--low);font:500 12px/16px var(--mono);color:var(--var);white-space:nowrap}
  .statchip img{width:20px;height:20px;border-radius:50%;object-fit:cover;border:1px solid var(--green);background:#000;flex:none}
  .statchip.alert img{border-color:var(--amber)}
  .statchip.alert .s1{color:var(--amber)}
  .statchip .s1{color:var(--green);font-weight:600}
  nav{display:flex;align-items:center;gap:2px;flex:none;white-space:nowrap}
  nav a{padding:6px 9px;border-radius:4px;font:600 13px/20px var(--sans);color:var(--var);text-decoration:none;white-space:nowrap}
  nav a:hover{background:var(--chi);color:var(--tx)}

  main{padding-top:80px}
  .wrap{max-width:1440px;margin:0 auto;padding:24px 20px 60px}
  p{margin:0}
  /* The page's own statement of what it is. It sits here rather than in the
     header because it is content, not chrome, and because a fixed bar cannot
     hold a full sentence without wrapping into the page. */
  .lede{font:400 16px/24px var(--sans);color:var(--var);max-width:90ch;margin-bottom:16px}

  /* micro telemetry bar */
  .mbar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 16px;background:var(--low);border-radius:8px;padding:10px 16px;margin-bottom:24px;font:500 12px/16px var(--mono);color:var(--var)}
  .mbar .grp{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  .mbar .sep{color:var(--tx3)}
  .mbar .stamp{background:var(--void);color:var(--cyan);padding:2px 8px;border-radius:4px}

  /* sections */
  .sec{margin-bottom:32px}
  .sec-h{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px;flex-wrap:wrap}
  .sec-t{display:flex;align-items:center;gap:8px}
  .sec-t i{width:6px;height:14px;border-radius:12px;background:var(--cyan);display:block;flex:none}
  .sec-t h2{margin:0;font:600 20px/28px var(--sans);letter-spacing:.05em;text-transform:uppercase;color:var(--tx)}

  .grid{display:grid;gap:16px}
  .g4{grid-template-columns:repeat(4,1fr)}
  .g2{grid-template-columns:repeat(2,1fr)}

  /* metric tiles */
  .tile{background:var(--low);border-radius:8px;padding:24px;position:relative;overflow:hidden;display:flex;flex-direction:column;justify-content:space-between}
  .tile.glow::after{content:"";position:absolute;right:-24px;bottom:-24px;width:96px;height:96px;border-radius:50%;background:rgba(0,242,254,.06);filter:blur(18px);pointer-events:none}
  .tile-h{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;position:relative}
  .tile-v{font:700 32px/38px var(--mono);letter-spacing:-.03em;color:var(--tx)}
  .tile-v.cy{color:var(--pri)}
  .tile-l{font:400 12px/18px var(--sans);color:var(--tx2);margin-top:2px}
  .tile-f{margin:16px -24px -24px;padding:10px 24px;background:rgba(11,15,23,.4);display:flex;align-items:center;justify-content:space-between;gap:8px;font:500 12px/16px var(--mono);color:var(--tx3);position:relative}
  .tile-f .val{color:var(--pri)}
  .tile-f .trunc{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .delta{color:var(--cyan)}
  .badge{font:700 10px/14px var(--mono);letter-spacing:.06em;text-transform:uppercase;padding:2px 6px;border-radius:4px;white-space:nowrap}
  .badge.bad{background:rgba(239,68,68,.12);color:var(--red2)}
  .badge.warn{background:rgba(245,158,11,.12);color:var(--amber)}
  .badge.ok{background:rgba(78,222,163,.12);color:var(--green)}
  .badge.idx{background:var(--chi);color:var(--var)}

  /* briefing */
  .brief{background:rgba(17,24,39,.9);border-radius:8px;padding:24px;margin-top:16px;box-shadow:0 18px 30px -18px rgba(0,0,0,.6)}
  .brief-h{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px;flex-wrap:wrap}
  .brief-who{display:flex;align-items:center;gap:8px}
  .brief-who img{width:28px;height:28px;border-radius:6px;object-fit:cover;border:1px solid var(--ln);background:#000}
  .brief-name{font:600 16px/24px var(--sans);color:var(--pri)}
  .brief-state{display:flex;align-items:center;gap:6px;font:500 12px/16px var(--mono);color:var(--tx3)}
  .brief-state .dot{width:6px;height:6px}
  .brief-say{font:400 14px/23px var(--sans);color:var(--tx);max-width:100ch}
  .brief-f{margin:16px -24px -24px;padding:8px 24px;background:rgba(11,15,23,.3);display:flex;align-items:center;justify-content:space-between;gap:8px 16px;flex-wrap:wrap;font:500 12px/18px var(--mono);color:var(--tx3)}
  .brief-f code{color:var(--pri)}

  /* nakamoto tiles */
  .nkt{background:var(--low);border-radius:8px;padding:24px;display:flex;flex-direction:column;justify-content:space-between}
  .nkt-h{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px}
  .nkt-v{font:700 32px/38px var(--mono);letter-spacing:-.03em}
  .nkt-l{font:500 16px/24px var(--sans);color:var(--tx);margin-top:2px}
  .nkt-n{font:400 12px/18px var(--sans);color:var(--tx3);margin-top:16px}

  /* alert banner */
  .alertcard{display:flex;gap:16px;align-items:flex-start;background:var(--low);border-radius:8px;padding:20px 24px;box-shadow:0 18px 30px -18px rgba(0,0,0,.6)}
  .alertcard>img{width:80px;height:80px;border-radius:8px;object-fit:cover;flex:none}
  .alertcard .ibox{width:44px;height:44px;border-radius:8px;background:var(--void);color:var(--amber);display:flex;align-items:center;justify-content:center;flex:none}
  .alertcard .t{font:600 16px/24px var(--sans);color:var(--tx);display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:4px}
  .alertcard p{font:400 14px/22px var(--sans);color:var(--tx2);max-width:110ch}

  /* charts */
  .card{background:var(--low);border-radius:8px;padding:24px}
  .card-h{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
  .card-t{font:600 16px/24px var(--sans);color:var(--tx)}
  .chip{background:var(--void);padding:3px 10px;border-radius:4px;font:500 12px/16px var(--mono)}
  .chartwrap{position:relative;height:176px;margin:12px 0 4px}
  .chartwrap.sm{height:112px}
  .chart{width:100%;height:100%;display:block}
  .tip{position:absolute;right:-3px;width:7px;height:7px;border-radius:50%;transform:translateY(-50%)}
  .axis{display:flex;justify-content:space-between;gap:8px;font:500 12px/16px var(--mono);color:var(--tx3);padding-top:4px}

  /* verification kpis + notes */
  .kpi{background:var(--low);border-radius:8px;padding:24px;display:flex;flex-direction:column;justify-content:space-between}
  .kpi-l{font:600 10px/14px var(--mono);letter-spacing:.06em;text-transform:uppercase;color:var(--tx3);margin-bottom:4px}
  .kpi-v{font:700 32px/38px var(--mono);letter-spacing:-.03em;color:var(--tx)}
  .kpi-t{font:600 16px/24px var(--sans);color:var(--tx);margin-top:2px}
  .kpi-n{font:400 12px/18px var(--sans);color:var(--tx3);margin-top:16px}
  .note{background:var(--low);border-radius:8px;padding:20px 24px;color:var(--tx2);font:400 14px/22px var(--sans)}
  .note p{max-width:110ch}
  .note.sm{font-size:12px;line-height:19px}
  .strip{display:flex;gap:10px;align-items:flex-start;background:rgba(11,15,23,.5);border-radius:6px;padding:12px 14px;margin-top:12px;font:400 12px/19px var(--sans);color:var(--tx2)}
  .strip span{max-width:120ch}
  .strip .ic{color:var(--cyan);margin-top:1px}
  .callout{background:var(--base);border-radius:8px;padding:20px 24px}
  .callout-h{display:flex;align-items:center;gap:6px;color:var(--amber);font:600 16px/24px var(--sans);margin-bottom:6px}
  .callout p{font:400 12px/20px var(--sans);color:var(--tx2);max-width:120ch}

  /* early warning */
  .lead{display:flex;gap:24px;align-items:center;background:var(--low);border-radius:8px;padding:20px 24px;margin-bottom:16px;flex-wrap:wrap}
  .lead-n{background:var(--void);border-radius:8px;padding:12px 20px;text-align:center;flex:none}
  .lead-n b{display:block;font:700 32px/38px var(--mono);color:var(--green)}
  .lead-n b span{font:400 16px/16px var(--sans);color:var(--tx3);margin-left:2px}
  .lead-n i{font-style:normal;font:600 10px/14px var(--mono);letter-spacing:.06em;text-transform:uppercase;color:var(--green)}
  .lead-b{flex:1;min-width:260px}
  .lead-t{font:700 20px/28px var(--sans);color:var(--tx)}
  .lead-t .arrow{color:var(--cyan);font-family:var(--mono)}
  .lead-b p{font:400 12px/19px var(--sans);color:var(--tx2);margin-top:4px}
  .lead-b .nm{color:var(--pri);font-weight:600}

  /* tables */
  .tblcard{background:var(--low);border-radius:8px;overflow:hidden}
  .tblcard-h{background:var(--void);padding:10px 24px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
  .tblcard-h .t{font:600 16px/24px var(--sans);color:var(--tx)}
  .tblscroll{overflow-x:auto}
  table{width:100%;border-collapse:collapse;min-width:640px;font:500 12px/16px var(--mono)}
  thead tr{background:var(--base)}
  th{text-align:left;padding:9px 24px;font:600 10px/14px var(--mono);letter-spacing:.06em;text-transform:uppercase;color:var(--tx3);white-space:nowrap}
  td{padding:9px 24px;color:var(--tx);vertical-align:middle}
  tbody tr:nth-child(even){background:rgba(11,15,23,.3)}
  tbody tr:hover{background:var(--cc)}
  td.r,th.r{text-align:right}
  td.hi{color:var(--cyan);font-weight:600}
  td.kind{color:var(--pri);font-weight:600}
  td.kind.cut{color:var(--cyan)}
  .rgn{display:inline-block;padding:2px 7px;border-radius:4px;background:var(--cc);color:var(--var);font:600 10px/14px var(--mono);letter-spacing:.06em;text-transform:uppercase}
  /* Column widths are stated rather than left to the browser. A percentage table
     hands every spare pixel to the first column, which at 1440px opened a ~450px
     gap between a node's name and its region and made rows impossible to track
     across. The slack goes to the bar instead, where extra width is resolution. */
  .t-node th:nth-child(1){width:26%}.t-node th:nth-child(2){width:10%}
  .t-node th:nth-child(3){width:12%}.t-node th:nth-child(4){width:14%}
  .t-node th:nth-child(5){width:38%}
  .t-whale th:nth-child(1){width:6%}.t-whale th:nth-child(2){width:22%}
  .t-whale th:nth-child(3){width:12%}.t-whale th:nth-child(4){width:16%}
  .t-whale th:nth-child(5){width:44%}
  .t-feed th:nth-child(1){width:14%}.t-feed th:nth-child(2){width:18%}
  .t-feed th:nth-child(3){width:14%}.t-feed th:nth-child(4){width:54%}
  .barcell{min-width:180px}
  .barwrap{display:flex;align-items:center;gap:12px}
  .barwrap .pct{width:52px;text-align:right;flex:none}
  .track{flex:1;min-width:60px;max-width:480px;height:6px;border-radius:12px;background:var(--void);overflow:hidden}
  .fill{display:block;height:100%;border-radius:12px;background:var(--cyan)}
  .fill.alt{background:var(--green)}
  .fill.amber{background:var(--amber)}
  .pctlead{color:var(--pri);font-weight:700}
  .pill{display:inline-block;padding:2px 8px;border-radius:12px;font:600 10px/14px var(--mono);letter-spacing:.06em;text-transform:uppercase}
  .pill.ok{background:var(--chi);color:var(--green)}
  .pill.warn{background:var(--chi);color:var(--amber)}
  .pill.dim{background:var(--chi);color:var(--var)}

  /* footer */
  footer{margin-top:40px;padding-top:24px;border-top:1px solid var(--ln);color:var(--tx3);font:400 12px/20px var(--sans)}
  footer p{max-width:120ch;margin-bottom:12px}
  .fbrand{display:flex;gap:14px;align-items:center;margin-bottom:16px}
  .fbrand img{width:56px;height:56px;flex:none;border-radius:50%;object-fit:cover;object-position:52% 26%;border:1px solid var(--ln)}

  /* The sentinel chip goes first, then the nav — the alert state it carries is
     also stated in the telemetry bar below, so nothing is lost when it drops. */
  @media(max-width:1320px){.hstat{display:none}}
  @media(max-width:1120px){nav{display:none}.g4{grid-template-columns:repeat(2,1fr)}}
  @media(max-width:720px){
    .g4,.g2{grid-template-columns:1fr}
    .sec-t h2{font:600 18px/24px var(--sans)}
    .hdr-in{height:72px}main{padding-top:72px}
    .lede{font-size:15px}
    .alertcard>img{width:56px;height:56px}
    th,td{padding-left:16px;padding-right:16px}
  }
</style></head>
<body>

<header class="hdr">
  <div class="hdr-in">
    <div class="brand">
      <img class="mark" src="assets/logo.png" width="40" height="40" alt="BAMservatory emblem">
      <div class="btitle">
        <h1 class="bname">BAMservatory</h1>
        <span class="tag">Solana MEV</span>
      </div>
      <div class="hstat">
        <div class="statchip ${sentinel.cls}" title="${esc(sentinel.title)}">
          <img src="assets/bamsey.png" width="20" height="20" alt="BAMsey, the Observatory sentinel">
          <span class="s1">BAMsey · ${esc(sentinel.label)}</span>
        </div>
      </div>
    </div>
    <nav>
      <a href="#overview">Overview</a>
      <a href="#decentralization">Decentralization</a>
      <a href="#verification">Verification</a>
      <a href="#early-warning">Early Warning</a>
      <a href="#topology">Topology</a>
      <a href="#whale-watch">Whale Watch</a>
    </nav>
  </div>
</header>

<main><div class="wrap">

<p class="lede">An independent transparency &amp; early-warning layer for Jito's Block Assembly Marketplace.</p>

<div class="mbar">
  <div class="grp">
    <span class="dot ${alerting ? "warn" : "ok"}"></span>
    <span class="${alerting ? "warn" : "ok"}"><b class="${alerting ? "warn" : "ok"}">Sentinel: ${alerting ? "alert" : "active"}</b></span>
    <span class="sep">·</span>
    <span>Window <b>${day(M.window.from)} → ${day(M.window.to)}</b></span>
    <span class="sep">·</span>
    <span>${fmt(M.window.snapshots)} snapshots @ ~60s</span>
  </div>
  <div class="grp">
    <span class="bl">Generated</span>
    <span class="stamp">${esc(M.generatedAt.slice(0, 16))}Z</span>
    <span class="sep">·</span>
    <span>source: public BAM API</span>
  </div>
</div>

<section class="sec" id="overview">
  <div class="sec-h">
    <div class="sec-t"><i></i><h2>BAM at a glance</h2></div>
    <span class="bl">Live consensus probe</span>
  </div>
  <div class="grid g4">
    <div class="tile glow">
      <div>
        <div class="tile-h"><span class="bl">Solana stake routed</span><span class="dot"></span></div>
        <div class="tile-v cy">${fmt(hl.bamStakePct, 1)}%</div>
        <div class="tile-l">of ALL Solana stake routed through BAM</div>
      </div>
      <div class="tile-f"><span class="val">${fmt(hl.bamStakeSOL / 1e6, 1)}M SOL</span>${deltaChip}</div>
    </div>
    <div class="tile">
      <div>
        <div class="tile-h"><span class="bl">Connected validators</span><span class="dot ok"></span></div>
        <div class="tile-v">${fmt(hl.validatorCount)}</div>
        <div class="tile-l">validators connected</div>
      </div>
      <div class="tile-f"><span>Spread</span><span class="ok">across ${fmt(d.regionCount)} regions</span></div>
    </div>
    <div class="tile">
      <div>
        <div class="tile-h"><span class="bl">Active infrastructure</span><span class="dot dim"></span></div>
        <div class="tile-v">${fmt(hl.nodeCount)}</div>
        <div class="tile-l">BAM nodes live</div>
      </div>
      <div class="tile-f"><span>Peak region</span><span class="val">${esc(hl.busiestByVals.region)} (${fmt(hl.busiestByVals.vals)} vals)</span></div>
    </div>
    <div class="tile">
      <div>
        <div class="tile-h"><span class="bl">Top node density</span><span class="dot warn"></span></div>
        <div class="tile-v ${alerting ? "warn" : ""}">${fmt(hl.topNodeShare, 1)}%</div>
        <div class="tile-l">stake on the top node</div>
      </div>
      <div class="tile-f"><span class="trunc">${esc(hl.topNode)}</span>${alerting ? `<span class="badge warn">Alert</span>` : ""}</div>
    </div>
  </div>
  ${briefing}
</section>

<section class="sec" id="decentralization">
  <div class="sec-h">
    <div class="sec-t"><i style="background:var(--green)"></i><h2>Decentralization — how concentrated is BAM?</h2></div>
    <span class="bl">Entropy analysis</span>
  </div>
  <div class="grid g4">
    <div class="nkt">
      <div>
        <div class="nkt-h"><span class="bl">Nodes metric</span><span class="badge ${nk(d.nodeNakamoto)}">${NK_LABEL[nk(d.nodeNakamoto)]}</span></div>
        <div class="nkt-v ${nk(d.nodeNakamoto)}">${d.nodeNakamoto}</div>
        <div class="nkt-l">Nakamoto coefficient (nodes)</div>
      </div>
      <div class="nkt-n">min nodes controlling &gt;50% of BAM stake</div>
    </div>
    <div class="nkt">
      <div>
        <div class="nkt-h"><span class="bl">Validator entropy</span><span class="badge ${nk(d.validatorNakamoto)}">${NK_LABEL[nk(d.validatorNakamoto)]}</span></div>
        <div class="nkt-v ${nk(d.validatorNakamoto)}">${d.validatorNakamoto}</div>
        <div class="nkt-l">Nakamoto coefficient (validators)</div>
      </div>
      <div class="nkt-n">min validators controlling &gt;50%</div>
    </div>
    <div class="nkt">
      <div>
        <div class="nkt-h"><span class="bl">Geographic spread</span><span class="badge ${nk(d.regionNakamoto)}">${NK_LABEL[nk(d.regionNakamoto)]}</span></div>
        <div class="nkt-v ${nk(d.regionNakamoto)}">${d.regionNakamoto}</div>
        <div class="nkt-l">Nakamoto coefficient (regions)</div>
      </div>
      <div class="nkt-n">geographic concentration</div>
    </div>
    <div class="nkt">
      <div>
        <div class="nkt-h"><span class="bl">Validator core top 10</span><span class="badge idx">Index</span></div>
        <div class="nkt-v">${fmt(d.top10ValShare, 0)}%</div>
        <div class="nkt-l">held by the top 10 validators</div>
      </div>
      <div class="nkt-n">top 1: ${fmt(d.top1ValShare, 1)}% · top 5: ${fmt(d.top5ValShare, 1)}%</div>
    </div>
  </div>
  <div class="mt">
  ${alerting
    ? `<div class="alertcard">
        <img src="assets/bamsey-alert.jpg" width="80" height="80" alt="BAMsey in alert state">
        <div>
          <div class="t"><span>Concentration alert — node Nakamoto coefficient is ${d.nodeNakamoto}.</span><span class="badge warn">Threshold breached</span></div>
          <p>${concentrationNote}</p>
        </div>
       </div>`
    : `<div class="alertcard">
        <div class="ibox">${icon("info", 24)}</div>
        <div>
          <div class="t"><span>Node Nakamoto coefficient is ${d.nodeNakamoto}.</span><span class="badge ok">Within range</span></div>
          <p>Just ${d.nodeNakamoto} BAM nodes control a majority of the stake flowing through the marketplace. ${concentrationNote}</p>
        </div>
       </div>`}
  </div>
</section>

<section class="sec" id="trends">
  <div class="sec-h">
    <div class="sec-t"><i></i><h2>Trends</h2></div>
    <span class="bl">Time-series telemetry</span>
  </div>
  <div class="grid g2">
    ${chartCard("BAM share of Solana stake (%)", M.series, "pct", "#00f2fe", (n) => fmt(n, 2) + "%")}
    ${chartCard("Node-stake concentration (HHI)", M.series, "hhi", "#f59e0b", (n) => fmt(n, 3))}
  </div>
</section>

${verificationPanel}

<section class="sec" id="early-warning">
  <div class="sec-h">
    <div class="sec-t"><i style="background:var(--amber)"></i><h2>Early warning — structural rollover detection</h2></div>
    <span class="bl" style="color:var(--amber)">Predictive telemetry</span>
  </div>
  ${validated}
  <div class="note sm"><p>BAM periodically migrates validators between TEE nodes in coordinated, region-by-region rollovers. The Observatory detects these <b>before</b> they complete: when a new node appears in a region, a cutover in that region typically follows within ~30 minutes. <b class="ok">Validated on the 2026-06-24 event with ${det.validated[0] ? det.validated[0].lead_min : 0}-minute lead time (n=1 structural event; detector is live and accumulating more).</b> Live "leadership flips" below are mostly whale-driven stake toggles, not structural rollovers — the Observatory labels them as such rather than counting them as early-warning wins.</p></div>
  <div class="tblcard mt">
    <div class="tblcard-h"><span class="t">Precursor signal log</span><span class="bl cy">${fmt(det.feed.length)} recent ingested events</span></div>
    <div class="tblscroll">
      <table class="t-feed"><thead><tr><th>Time (UTC)</th><th>Event</th><th>Type</th><th>Detail</th></tr></thead><tbody>${feedRows}</tbody></table>
    </div>
  </div>
</section>

<section class="sec" id="topology">
  <div class="sec-h">
    <div class="sec-t"><i style="background:var(--pri)"></i><h2>Current topology — ${fmt(hl.nodeCount)} nodes</h2></div>
    <span class="bl">TEE fabric overview</span>
  </div>
  <div class="tblcard">
    <div class="tblscroll">
      <table class="t-node"><thead><tr><th>Node</th><th>Region</th><th class="r">Validators</th><th class="r">Stake</th><th>Share</th></tr></thead><tbody>${nodeRows}</tbody></table>
    </div>
  </div>
</section>

<section class="sec" id="whale-watch">
  <div class="sec-h">
    <div class="sec-t"><i style="background:var(--amber)"></i><h2>Whale watch — who controls BAM stake</h2></div>
    <span class="bl" style="color:var(--amber)">Routing power</span>
  </div>
  <div class="tblcard">
    <div class="tblscroll">
      <table class="t-whale"><thead><tr><th class="r">#</th><th>Validator</th><th>Node region</th><th class="r">Stake</th><th>Share</th></tr></thead><tbody>${whaleRows}</tbody></table>
    </div>
  </div>
  <div class="note sm mt"><p>Stake leadership of the BAM network is steered by a small set of large validators. Surfacing <i>who</i> they are and <i>where</i> they route makes BAM's power distribution legible to the Solana ecosystem — a public good no tool provides today.</p></div>
</section>

<footer>
  <div class="fbrand">
    <img src="assets/bamsey-hero.jpg" width="56" height="56" alt="BAMsey, the BAMservatory sentinel">
    <div><b>BAMsey</b> — the Observatory's sentinel. Every 60 seconds he re-reads the public BAM API, recomputes concentration, and flags a structural rollover the moment its precursor appears. ${fmt(M.window.snapshots)} snapshots so far, no gaps, no paywall.</div>
  </div>
  <p><b>Methodology.</b> All figures are computed from the public BAM API (<code>/nodes</code>, <code>/validators</code>, <code>/bam_stake</code>), sampled every ~60 seconds and flattened to CSV. Nakamoto coefficient = minimum entities whose cumulative stake exceeds 50%. HHI = Herfindahl–Hirschman index of node stake shares. Early-warning detection compares consecutive node sets and times region cutovers against precursor node appearances. No private data, no token, no chain — an independent observatory.</p>
  ${B && B.source === "llm" ? `<p><b>On BAMsey's read.</b> The briefing at the top of this page is written by a language model, and it is constrained so that it cannot affect the integrity of anything else here. The model never touches raw data and performs no arithmetic: it receives only the figures already computed above and may cite nothing else. Every numeral it returns is checked against that set before publishing; a note citing an unverifiable figure is rejected and regenerated, and on repeated failure a deterministic template is published in its place. It is editorial judgement about which numbers matter — never a source of numbers.</p>` : ""}
  <p>Built for review by the Jito &amp; Solana Foundations as a candidate ecosystem public good. Numbers reflect the capture window above and update as new data lands.</p>
</footer>

</div></main></body></html>`;

fs.writeFileSync(OUT, html);
console.log(`→ wrote ${OUT}  (${(html.length / 1024).toFixed(1)} KB, self-contained)`);
