// What stats.js decides to leave out of a published figure.
//
// Two rules here change numbers the dashboard and metrics.json report, and both
// are wrong in an expensive way in either direction. Drop too much and the
// series stops describing BAM; drop too little and it describes things that
// never happened — which is exactly what both of these were written after.
// They had been calibrated once, against whatever the archive held that day.
// That is not a standing guarantee.
//
// So each rule is asserted in both directions, against the real captures from
// the incident that prompted it and against the real captures it must not touch:
//
//   partial responses      outage-2026-08-12.csv         must be excluded
//                          single-node-absent-2026-06-23 must be kept
//   identity artifacts     relabel-2026-08-11            must be recognised
//                          rollover-2026-06-24           must NOT be
//
// The second pair is the one that matters most. The 2026-06-24 rollover is the
// single validated early-warning event this project has, and a rule that
// suppressed it while cleaning up relabellings would quietly delete the finding
// the whole dashboard rests on.
//
//   node test/read-rules.mjs

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const FIX = path.join(HERE, "fixtures");
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), "read-rules-"));
process.on("exit", () => fs.rmSync(WORK, { recursive: true, force: true }));

let fails = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) console.log(`  ok    ${label}`);
  else {
    console.log(`  FAIL  ${label}\n          expected ${JSON.stringify(expected)}\n          got      ${JSON.stringify(actual)}`);
    fails++;
  }
};

// stats.js reads a capture directory. Only summary.csv drives the rules under
// test; the rest has to exist for it to run at all, and is stubbed at the latest
// timestamp so the topology block is well-formed rather than meaningful.
function runStats(summaryFixture, detectionsFixture) {
  const dir = fs.mkdtempSync(path.join(WORK, "dir-"));
  const summary = fs.readFileSync(path.join(FIX, summaryFixture), "utf8");
  fs.writeFileSync(path.join(dir, "summary.csv"), summary);

  const rows = summary.trim().split(/\r?\n/);
  const last = rows[rows.length - 1].split(",")[0];
  fs.writeFileSync(path.join(dir, "nodes.csv"),
    "ts,bam_node,region,connected_validators,node_stake,node_stake_share\n" +
    `${last},ams-mainnet-bam-2-tee,ams-mainnet-bam-2-tee,68,32000000.00,22.500000\n` +
    `${last},fra-mainnet-bam-1-tee,fra-mainnet-bam-1-tee,95,26000000.00,18.300000\n`);
  fs.writeFileSync(path.join(dir, "validators.csv"),
    "ts,validator_pubkey,bam_node_connection,stake,stake_percentage\n" +
    `${last},DRpbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy,ams-mainnet-bam-2-tee,12000000.00,2.7000\n`);
  fs.writeFileSync(path.join(dir, "detections.log"),
    detectionsFixture ? fs.readFileSync(path.join(FIX, detectionsFixture), "utf8") : "");
  fs.writeFileSync(path.join(dir, "detections_replay.log"), "");

  const out = path.join(dir, "metrics.json");
  execFileSync(process.execPath, [path.join(ROOT, "stats.js"), "--dir", dir, "--out", out], { stdio: "pipe" });
  return JSON.parse(fs.readFileSync(out, "utf8"));
}

// ── partial responses ────────────────────────────────────────────────────────
// The API degraded from about 04:16 to 04:23 on 2026-08-12 and recovered in
// steps. 04:21 is the specific capture that used to pass: 12 of 15 nodes and 306
// of 377 validators is exactly 0.80 of the network, and the rule tested for
// less than 0.80. It set the published minimum stake share to 26.78%.
console.log("── an outage that recovers in steps is excluded ──");
{
  const m = runStats("outage-2026-08-12.csv", null);
  const ex = m.window.partialResponsesExcluded;
  check("the whole degraded run is excluded, not just its worst captures", ex.length, 7);
  check("04:21 — the 0.80 boundary capture — is excluded", ex.includes("2026-08-12T04:21:03Z"), true);
  check("04:23 — the tail of the recovery — is excluded", ex.includes("2026-08-12T04:23:03Z"), true);
  check("no capture outside the outage is excluded",
    ex.every((t) => t >= "2026-08-12T04:16" && t <= "2026-08-12T04:24"), true);
  check("the published minimum is not an outage artifact", m.stats.pct.min > 30, true);
}

// The other direction. One node absent from a fourteen-node network with every
// validator still reported is 0.9286 of the network — a real observation, and
// the nearest real case above the threshold. If this is ever excluded, the rule
// has started deleting the network's actual behaviour.
console.log("── a single absent node is a real observation and is kept ──");
{
  const m = runStats("single-node-absent-2026-06-23.csv", null);
  check("nothing is excluded", m.window.partialResponsesExcluded, []);
  check("the 13-node captures survive into the minimum", m.stats.nodes.min, 13);
}

// ── identity artifacts ───────────────────────────────────────────────────────
// Every node swapped its -1/-2 suffix in a single 59-second gap, fourteen
// regions at once, with validator counts and node stake carried across the
// boundary unchanged. The top node's name changed while holding the same stake
// on the same machine, and that was being published as leadership moving.
console.log("── a fleet-wide relabelling is not fourteen events ──");
{
  const m = runStats("relabel-2026-08-11.csv", "relabel-2026-08-11.log");
  const ids = m.detections.identityArtifacts;
  check("the relabelling is recognised", ids.length, 1);
  check("at the right capture", ids[0]?.ts, "2026-08-11T21:18:33Z");
  check("with every region that moved", ids[0]?.regions, 14);
  check("its cutover does not count as live monitoring", m.detections.liveCutovers, 0);
  check("and the rename is not a leadership change", m.leadershipChanges, []);
  // Deliberately not zero, and this is the rule's boundary rather than a leak.
  // One capture earlier, at 21:17:34, fra-1 appeared alongside fra-2 — a single
  // region gaining a single node, which is the first visible step of the
  // relabelling but is also exactly the shape of a genuine precursor. That is
  // how the 2026-06-24 rollover was caught 22 minutes ahead. A rule that
  // suppressed one-region appearances to tidy up the remaining fourteen would
  // buy a cleaner count at the price of the detector's only real success, so it
  // stops at four regions and this one is left standing.
  check("but a lone new node is still a signal, as a precursor would be",
    m.detections.liveSignals, 1);
}

// The direction that matters. A genuine coordinated rollover moves region by
// region over tens of minutes, so it never presents four regions at once — and
// must survive a rule aimed at things that do.
console.log("── the validated 2026-06-24 rollover is untouched ──");
{
  const m = runStats("rollover-2026-06-24.csv", "rollover-2026-06-24.log");
  check("it is NOT called an identity artifact", m.detections.identityArtifacts, []);
  check("its precursor signals are still counted", m.detections.liveSignals > 0, true);
  check("its cutover is still counted", m.detections.liveCutovers, 1);
  check("and the real leadership change is still recorded",
    m.leadershipChanges.some((c) => c.to === "fra-mainnet-bam-2-tee"), true);
}

console.log(fails ? `\nread rules: ${fails} check(s) FAILED` : "\nread rules: all checks passed");
process.exit(fails ? 1 : 0);
