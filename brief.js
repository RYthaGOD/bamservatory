"use strict";

// BAMSEY — situational briefing generator.
//
// Reads metrics.json, asks an LLM for a short analyst note in BAMsey's voice,
// and writes briefing.json for build.js to render.
//
// The dashboard's entire value is that its numbers are verifiable, so a language
// model is never trusted with arithmetic here. It receives a closed set of FACTS
// computed by stats.js and may cite nothing else — and every number it writes back
// is checked against that set before publication. Output that cites an unknown
// figure is rejected, retried once, and then replaced by a deterministic template.
// The page therefore always has a briefing, and never an invented number.
//
// Usage:
//   node brief.js                 # regenerate if state changed / briefing is stale
//   node brief.js --force         # regenerate unconditionally
//   node brief.js --dry-run       # print what would be sent + the template fallback
//   node brief.js --list-models   # show model ids this key can reach
//
// Key: OPENAI_API_KEY from the environment, or a gitignored .env beside this file.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const arg = (flag, def) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : def;
};
const has = (flag) => process.argv.includes(flag);

const IN = arg("--in", path.join(__dirname, "metrics.json"));
const OUT = arg("--out", path.join(__dirname, "briefing.json"));
const FORCE = has("--force");
const DRY = has("--dry-run");

// Cost/rate policy: never call more than once an hour even when the network is
// churning, but refresh at least every 6h so the note cannot read as stale.
const MIN_INTERVAL_MIN = Number(process.env.BAMSEY_MIN_INTERVAL_MIN || 60);
const MAX_AGE_HOURS = Number(process.env.BAMSEY_MAX_AGE_HOURS || 6);
// gpt-5.5 was chosen by comparison, not by default: on this prompt the mini tier
// padded to 95 words and enumerated metrics the tables already show, while 5.5
// led with the change in ~55 words. At <=1 call/hour the price difference is noise.
const MODEL = process.env.OPENAI_MODEL || "gpt-5.5";
const API = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";

// ---- key loading ------------------------------------------------------------
function loadKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY.trim();
  // Task Scheduler does not reliably inherit user env vars; a local .env is the
  // dependable path for the cron. It is gitignored.
  const envFile = path.join(__dirname, ".env");
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?OPENAI_API_KEY\s*=\s*(.+?)\s*$/.exec(line);
      if (m) return m[1].replace(/^["']|["']$/g, "").trim();
    }
  }
  return null;
}

// ---- fact extraction --------------------------------------------------------
// Every figure BAMsey is allowed to cite, and nothing else. `n` values feed the
// numeric allowlist; `t` values are text (node names, regions, dates).
function buildFacts(M) {
  const d = M.decentralization, hl = M.headline, det = M.detections;
  const S = M.series || [];
  const last = S[S.length - 1];

  // Deltas are what make a briefing worth reading — otherwise it just restates
  // the KPI cards. The chart series is DOWNSAMPLED (median gap runs into hours),
  // so an exact 24h/7d point rarely exists. Rather than force a fixed window and
  // silently drop the delta when nothing lands close enough, seek the nearest
  // point and report the interval actually measured, so the note can say "over
  // the past 23 hours" truthfully instead of claiming a round 24.
  const gaps = [];
  for (let i = 1; i < S.length; i++) gaps.push(new Date(S[i].ts) - new Date(S[i - 1].ts));
  gaps.sort((a, b) => a - b);
  const medianGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;
  const tol = Math.max(3 * 3600e3, medianGap * 2);

  const at = (hoursAgo) => {
    if (!last || S.length < 2) return null;
    const now = new Date(last.ts).getTime();
    const target = now - hoursAgo * 3600e3;
    let best = null, bestGap = Infinity;
    for (const p of S) {
      const gap = Math.abs(new Date(p.ts).getTime() - target);
      if (gap < bestGap) { bestGap = gap; best = p; }
    }
    if (bestGap > tol) return null;
    const hours = (now - new Date(best.ts).getTime()) / 3600e3;
    if (hours < 1) return null;
    return { p: best, hours: Math.round(hours), days: Math.round(hours / 24) };
  };
  const p24 = at(24), p168 = at(168);

  const f = {
    // 1dp to match the KPI card exactly — the briefing sits directly above it, and
    // "32.01%" beside a card reading "32.0%" reads as two different measurements.
    // `display` pins the trailing zero that Number() would otherwise drop.
    bamSharePct: { n: round(hl.bamStakePct, 1), display: hl.bamStakePct.toFixed(1) + "%", unit: "% of all Solana stake routed through BAM" },
    bamStakeM: { n: round(hl.bamStakeSOL / 1e6, 1), unit: "million SOL routed through BAM" },
    nodeCount: { n: hl.nodeCount, unit: "live BAM nodes" },
    validatorCount: { n: hl.validatorCount, unit: "validators connected" },
    regionCount: { n: d.regionCount, unit: "regions" },
    topNodeSharePct: { n: round(hl.topNodeShare, 1), unit: "% of BAM stake on the single largest node" },
    topNode: { t: hl.topNode },
    busiestRegion: { t: hl.busiestByVals.region },
    busiestNodeValidators: { n: hl.busiestByVals.vals, unit: "validators on the busiest node" },
    nodeNakamoto: { n: d.nodeNakamoto, unit: "min nodes controlling >50% of BAM stake" },
    validatorNakamoto: { n: d.validatorNakamoto, unit: "min validators controlling >50%" },
    regionNakamoto: { n: d.regionNakamoto, unit: "min regions controlling >50%" },
    top1ValSharePct: { n: round(d.top1ValShare, 1), unit: "% held by the largest single validator" },
    top10ValSharePct: { n: round(d.top10ValShare, 0), unit: "% held by the top 10 validators" },
    leadershipChanges: { n: M.leadershipChanges.length, unit: "times the top node by stake changed hands this window" },
    snapshots: { n: M.window.snapshots, unit: "snapshots captured" },
    windowFrom: { t: M.window.from.slice(0, 10) },
    windowTo: { t: M.window.to.slice(0, 10) },
  };

  if (p24) {
    f.bamShareChangePts = { n: round(hl.bamStakePct - p24.p.pct, 2), unit: `percentage-point change in BAM share over the last ${p24.hours} hours (negative = down)` };
    f.bamShareChangeHours = { n: p24.hours, unit: "hours covered by the change figure above — cite this interval, not a rounded 24" };
    f.bamSharePctThen = { n: round(p24.p.pct, 2), unit: `% BAM share ${p24.hours} hours ago` };
  }
  if (p168 && p168.days >= 2) {
    f.bamShareChangeLongPts = { n: round(hl.bamStakePct - p168.p.pct, 2), unit: `percentage-point change in BAM share over the last ${p168.days} days (negative = down)` };
    f.bamShareChangeLongDays = { n: p168.days, unit: "days covered by the longer change figure above" };
  }
  if (last && typeof last.hhi === "number") {
    f.nodeHHI = { n: round(last.hhi, 3), unit: "Herfindahl-Hirschman index of node stake shares (higher = more concentrated)" };
  }

  const v = det.validated && det.validated[0];
  if (v) {
    f.validatedRolloverLeadMin = { n: v.lead_min, unit: "minutes of early warning on the one validated structural rollover" };
    f.validatedRolloverDate = { t: v.ts.slice(0, 10) };
    f.validatedRolloverRegion = { t: v.region };
  }

  // Recent event feed as text context (no new numbers introduced).
  const recent = (det.feed || []).slice(0, 6).map((e) => ({
    ts: e.ts.slice(0, 16) + "Z",
    kind: e.kind,
    type: e.kind === "CUTOVER" ? (e.structural ? "structural rollover" : "whale-driven flip") : "precursor signal",
    detail: e.detail,
  }));

  const topNodes = (M.nodes || []).slice(0, 4).map((n) => ({ node: n.node, region: n.region, validators: n.vals, sharePct: round(n.share, 1) }));
  const topWhales = (M.whales || []).slice(0, 3).map((w) => ({ validator: w.pkShort, region: w.region, sharePct: round(w.share, 2) }));

  return { f, recent, topNodes, topWhales };
}

const round = (x, dp) => Number(Number(x).toFixed(dp));

// ---- numeric allowlist ------------------------------------------------------
// A cited number is acceptable only if it matches a fact value at some sane
// rounding, or is a structural constant ("top 10", ">50%", "~60 seconds").
const STRUCTURAL = new Set([0, 1, 2, 3, 4, 5, 10, 20, 24, 50, 60, 100]);

function buildAllowed(facts) {
  const allowed = new Set();
  const add = (x) => {
    if (!Number.isFinite(x)) return;
    const a = Math.abs(x);
    allowed.add(a);
    for (const dp of [0, 1, 2, 3]) allowed.add(Number(a.toFixed(dp)));
  };
  for (const k of Object.keys(facts.f)) if (typeof facts.f[k].n === "number") add(facts.f[k].n);
  for (const n of facts.topNodes) { add(n.validators); add(n.sharePct); }
  for (const w of facts.topWhales) add(w.sharePct);
  for (const s of STRUCTURAL) allowed.add(s);
  return allowed;
}

// Returns [] when clean, else the offending tokens.
function findUncitedNumbers(text, allowed, facts) {
  // Dates the model may legitimately repeat (window bounds, event dates).
  const okDates = new Set(Object.values(facts.f).filter((v) => v.t).map((v) => v.t)
    .concat(facts.recent.map((r) => r.ts.slice(0, 10))));
  let t = text;
  for (const dstr of okDates) t = t.split(dstr).join(" ");
  // Strip node names like "fra-mainnet-bam-2-tee" so their digits are not read as claims.
  t = t.replace(/[a-z]{2,5}-mainnet-bam-[\w-]+/gi, " ");

  const bad = [];
  for (const m of t.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const raw = m[0];
    const val = Number(raw.replace(/,/g, ""));
    if (!Number.isFinite(val)) continue;
    if (allowed.has(val)) continue;
    // Tolerate presentation rounding of an allowed value (e.g. 32.06 -> 32.1).
    let near = false;
    for (const a of allowed) {
      if (a === 0) continue;
      if (Math.abs(a - val) <= Math.max(0.051, Math.abs(a) * 0.005)) { near = true; break; }
    }
    if (!near) bad.push(raw);
  }
  return bad;
}

// ---- prompt -----------------------------------------------------------------
const SYSTEM = `You are BAMsey, the sentinel of BAMservatory — an independent transparency layer for Jito's Block Assembly Marketplace (BAM) on Solana. You write the situational briefing that validators, delegators and ecosystem-foundation reviewers read first.

ABSOLUTE RULES
- Use ONLY figures present in the FACTS object. Never invent, estimate, extrapolate, or infer a number that is not there.
- Every numeral you write must correspond to a FACTS value. If you cannot support a claim with FACTS, omit the claim.
- Where a fact carries a "display" value, write the number exactly as it appears there, trailing zeroes included. It must match the figure shown on the dashboard beneath you.
- Never discuss token price, market cap, investment merit, or make predictions about future values.
- Never claim BAM operators are acting improperly. You report structure, not motive.

ESTABLISHED CONTEXT (findings of this project — treat as ground truth, never contradict)
- Changes in which node holds the most stake are caused by a small number of very large validators moving between nodes. Describe them as "whale-driven routing" or "whale-driven leadership changes" — do not use the internal label "whale flip" verbatim. They are NOT structural rollovers and must never be described as general churn, network instability, or validator turnover.
- A STRUCTURAL ROLLOVER is different and rare: BAM migrates validators between TEE nodes region by region, and a new node appearing in a region precedes the cutover. Exactly ONE has been validated to date. Never imply there have been more.
- Validator count drifts by a few units as validators connect and disconnect. That is normal and not newsworthy on its own.

STYLE
- 2 to 4 sentences. Maximum 70 words. Plain prose — no lists, no headings, no emoji, no markdown.
- Calm, precise, technical. An analyst's read, not a mascot's catchphrase.
- LEAD WITH WHAT CHANGED. If a 24h or 7d change figure is present in FACTS, it belongs in the first sentence. A briefing that merely lists current values has failed.
- Do NOT enumerate metrics. Pick the two or three that matter now and say why they matter. The reader can see every number in the tables below you.
- If concentration is elevated, say so plainly and without alarmism.
- Write complete, grammatical sentences. Do not compress into telegraphic notation.
- Prefer words to symbols: "fell 0.67 percentage points", not "-0.67 pts".
- Name metrics in full: "the node Nakamoto coefficient is 3", not "the node Nakamoto is 3".`;

function userMessage(facts) {
  return `FACTS (the only figures you may cite):
${JSON.stringify(facts.f, null, 1)}

CURRENT TOP NODES:
${JSON.stringify(facts.topNodes, null, 1)}

LARGEST VALIDATORS BY BAM STAKE:
${JSON.stringify(facts.topWhales, null, 1)}

MOST RECENT DETECTOR EVENTS (newest first):
${JSON.stringify(facts.recent, null, 1)}

Write the briefing now.`;
}

// ---- OpenAI call ------------------------------------------------------------
async function callOpenAI(key, messages) {
  // Parameter support varies across model families (some reject `temperature`,
  // some renamed `max_tokens`). Start strict, then retry on the exact complaint
  // so this keeps working whichever model is configured.
  //
  // The cap is generous on purpose: reasoning models spend hidden tokens before
  // emitting a word, and a cap sized to the ~70-word answer gets consumed by
  // reasoning alone, returning empty content. Billing is on tokens produced, not
  // on the cap, so a high ceiling costs nothing and prevents that failure.
  let cap = 2000;
  let body = { model: MODEL, messages, temperature: 0.4, max_tokens: cap };

  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(`${API}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const j = await res.json();
      const choice = j.choices?.[0];
      const text = choice?.message?.content?.trim();
      if (text) return { text, usage: j.usage || null, model: j.model || MODEL };

      // Empty content: almost always reasoning exhausting the budget. Escalate once.
      if (choice?.finish_reason === "length" && cap < 16000) {
        cap *= 4;
        if ("max_completion_tokens" in body) body.max_completion_tokens = cap;
        else body.max_tokens = cap;
        console.warn(`empty completion (finish_reason=length) — raising token cap to ${cap}`);
        continue;
      }
      throw new Error(`empty completion (finish_reason=${choice?.finish_reason || "unknown"})`);
    }

    const errText = await res.text();
    const param = (() => { try { return JSON.parse(errText).error?.param; } catch { return null; } })();
    const msg = errText.slice(0, 400);

    if (res.status === 400 && (param === "max_tokens" || /max_tokens/.test(msg)) && "max_tokens" in body) {
      body = { ...body, max_completion_tokens: body.max_tokens };
      delete body.max_tokens;
      continue;
    }
    if (res.status === 400 && (param === "temperature" || /temperature/.test(msg)) && "temperature" in body) {
      delete body.temperature;
      continue;
    }
    throw new Error(`OpenAI ${res.status}: ${msg}`);
  }
  throw new Error("OpenAI: parameter negotiation failed");
}

async function listModels(key) {
  const res = await fetch(`${API}/models`, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  return (j.data || []).map((m) => m.id).sort();
}

// ---- deterministic fallback -------------------------------------------------
// Never an LLM. Used when there is no key, the API fails, or validation rejects
// the completion — so the dashboard always carries a briefing.
function templateBriefing(facts) {
  const f = facts.f;
  const bits = [];
  const share = f.bamSharePct.n.toFixed(1);
  if (f.bamShareChangePts) {
    const c = f.bamShareChangePts.n;
    const dir = Math.abs(c) < 0.05 ? "held flat at" : c > 0 ? "climbed to" : "eased to";
    bits.push(`BAM's share of Solana stake ${dir} ${share}% (${f.bamStakeM.n}M SOL) over the past ${f.bamShareChangeHours.n} hours.`);
  } else {
    bits.push(`BAM currently routes ${share}% of all Solana stake (${f.bamStakeM.n}M SOL) across ${f.validatorCount.n} validators.`);
  }
  bits.push(`Just ${f.nodeNakamoto.n} of the ${f.nodeCount.n} live nodes hold a majority of marketplace stake, with the largest at ${f.topNodeSharePct.n}% and ${f.busiestNodeValidators.n} validators concentrated on the busiest node in ${f.busiestRegion.t}.`);
  bits.push(`The top node by stake changed hands ${f.leadershipChanges.n} times in this window — whale-driven routing, not structural rollovers.`);
  return bits.join(" ");
}

// ---- main -------------------------------------------------------------------
(async () => {
  const key = loadKey();

  if (has("--list-models")) {
    if (!key) { console.error("no OPENAI_API_KEY found (env or .env)"); process.exit(1); }
    console.log((await listModels(key)).join("\n"));
    return;
  }

  const M = JSON.parse(fs.readFileSync(IN, "utf8"));
  const facts = buildFacts(M);
  const allowed = buildAllowed(facts);

  // State fingerprint — regenerate on a material change, not on every data tick.
  const fp = crypto.createHash("sha1").update(JSON.stringify({
    nn: facts.f.nodeNakamoto.n, rn: facts.f.regionNakamoto.n, vn: facts.f.validatorNakamoto.n,
    nodes: facts.f.nodeCount.n, top: facts.f.topNode.t,
    share: Math.round(facts.f.bamSharePct.n * 2) / 2,
    lead: facts.f.leadershipChanges.n,
    ev: facts.recent[0] ? facts.recent[0].ts : "",
  })).digest("hex").slice(0, 12);

  const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : null;
  const ageMin = prev ? (Date.now() - new Date(prev.generatedAt).getTime()) / 60e3 : Infinity;

  if (!FORCE && prev && prev.source === "llm") {
    const changed = prev.fingerprint !== fp;
    if (!changed && ageMin < MAX_AGE_HOURS * 60) { console.log(`briefing current (${Math.round(ageMin)}m old, state unchanged) — no API call.`); return; }
    if (changed && ageMin < MIN_INTERVAL_MIN) { console.log(`state changed but last briefing is only ${Math.round(ageMin)}m old — throttled.`); return; }
  }

  const fallback = templateBriefing(facts);

  if (DRY) {
    console.log("--- SYSTEM ---\n" + SYSTEM + "\n\n--- USER ---\n" + userMessage(facts));
    console.log("\n--- TEMPLATE FALLBACK ---\n" + fallback);
    console.log("\n--- ALLOWED NUMBERS ---\n" + [...allowed].sort((a, b) => a - b).join(", "));
    return;
  }

  const write = (o) => { fs.writeFileSync(OUT, JSON.stringify(o, null, 2)); console.log(`→ ${path.basename(OUT)} [${o.source}] ${o.text.length} chars`); };

  if (!key) {
    console.warn("no OPENAI_API_KEY (env or .env) — writing deterministic briefing.");
    write({ text: fallback, source: "template", model: null, generatedAt: new Date().toISOString(), fingerprint: fp, validated: true });
    return;
  }

  const messages = [{ role: "system", content: SYSTEM }, { role: "user", content: userMessage(facts) }];

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const { text, usage, model } = await callOpenAI(key, messages);
      const clean = text.replace(/\s+/g, " ").trim();
      const bad = findUncitedNumbers(clean, allowed, facts);
      const words = clean.split(/\s+/).length;

      if (bad.length === 0 && words <= 85) {
        write({ text: clean, source: "llm", model, generatedAt: new Date().toISOString(), fingerprint: fp, validated: true, words, usage });
        return;
      }

      const why = bad.length ? `cited unverifiable number(s): ${bad.join(", ")}` : `too long (${words} words)`;
      console.warn(`attempt ${attempt} rejected — ${why}`);
      if (attempt === 1) {
        messages.push({ role: "assistant", content: clean });
        messages.push({ role: "user", content: `Rejected: ${why}. Rewrite using only numerals that appear in FACTS, in 75 words or fewer. Do not apologise or explain — return the briefing only.` });
      }
    } catch (e) {
      console.error(`OpenAI call failed: ${e.message}`);
      break;
    }
  }

  console.warn("falling back to deterministic briefing.");
  write({ text: fallback, source: "template", model: null, generatedAt: new Date().toISOString(), fingerprint: fp, validated: true });
})();
