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
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
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
  // the KPI cards. Series points are ~60s apart but gaps exist, so seek by time.
  const at = (hoursAgo) => {
    if (!last) return null;
    const target = new Date(last.ts).getTime() - hoursAgo * 3600e3;
    let best = null, bestGap = Infinity;
    for (const p of S) {
      const gap = Math.abs(new Date(p.ts).getTime() - target);
      if (gap < bestGap) { bestGap = gap; best = p; }
    }
    // Reject a match more than 90 min off target — better no delta than a wrong one.
    return bestGap <= 90 * 60e3 ? best : null;
  };
  const p24 = at(24), p168 = at(168);

  const f = {
    bamSharePct: { n: round(hl.bamStakePct, 2), unit: "% of all Solana stake routed through BAM" },
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
    f.bamSharePct24hAgo = { n: round(p24.pct, 2), unit: "% BAM share 24 hours ago" };
    f.bamShareChange24hPts = { n: round(hl.bamStakePct - p24.pct, 2), unit: "percentage-point change in BAM share over 24h (negative = down)" };
  }
  if (p168) {
    f.bamShareChange7dPts = { n: round(hl.bamStakePct - p168.pct, 2), unit: "percentage-point change in BAM share over 7 days (negative = down)" };
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
- Never discuss token price, market cap, investment merit, or make predictions about future values.
- Never claim BAM operators are acting improperly. You report structure, not motive.

STYLE
- 2 to 4 sentences. Maximum 75 words. Plain prose — no lists, no headings, no emoji, no markdown.
- Calm, precise, technical. An analyst's read, not a mascot's catchphrase.
- Lead with what CHANGED or what matters most right now. Do not simply restate every metric.
- If concentration is elevated, say so plainly and without alarmism.
- Distinguish whale-driven leadership flips from structural rollovers; they are not the same event.`;

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
  let body = { model: MODEL, messages, temperature: 0.4, max_tokens: 300 };

  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${API}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const j = await res.json();
      const text = j.choices?.[0]?.message?.content?.trim();
      if (!text) throw new Error("empty completion");
      return { text, usage: j.usage || null, model: j.model || MODEL };
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
  bits.push(`Just ${f.nodeNakamoto.n} of the ${f.nodeCount.n} live BAM nodes hold a majority of marketplace stake, with the largest at ${f.topNodeSharePct.n}% and ${f.busiestNodeValidators.n} validators concentrated on the busiest node in ${f.busiestRegion.t}.`);
  if (f.bamShareChange24hPts) {
    const c = f.bamShareChange24hPts.n;
    const dir = Math.abs(c) < 0.05 ? "held flat at" : c > 0 ? "rose to" : "eased to";
    bits.push(`BAM's share of Solana stake ${dir} ${share}% (${f.bamStakeM.n}M SOL) over the past 24 hours.`);
  } else {
    bits.push(`BAM currently routes ${share}% of all Solana stake (${f.bamStakeM.n}M SOL) across ${f.validatorCount.n} validators.`);
  }
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

      if (bad.length === 0 && words <= 95) {
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
