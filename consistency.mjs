// Self-consistency: repeat each judgment N times, measure spread, and report
// the margin to the threshold in standard deviations. A verdict inside ~2σ of
// its bar is not reliable — it will flip between runs.
import { askJev, compact } from "./policykit/index.mjs";
import { readFileSync } from "node:fs";

const N = Number(process.env.N ?? 8);
const W = (f) => compact(readFileSync(`${process.env.HOME}/jev-rca/world/${f}`, "utf8"), 2600);
const EV = Object.fromEntries(["calibration.json","training.json","equipment_log.json","sop_versions.json","shift_log.txt"].map(f => [f, W(f)]));

const CASES = {
  "A correct (calibration)": {
    root_cause: "The compression force load cell on T-1590 was out of calibration. Calibration was due 2026-09-03 and the deviation occurred 2026-09-14, 11 days overdue. The force trended to 19.6 kN against NMT 18.0 kN for 18 minutes undetected.",
    capa: "Recalibrate T-1590. Revise the calibration interval to a risk-based basis. Add an interlock preventing production on equipment past its calibration due date.",
    impact: "B261270 and B261277 also ran on T-1590 after 2026-09-03 and must be assessed." },
  "A lazy (operator error)": {
    root_cause: "Operator error during compression. The operator failed to monitor the force readings.",
    capa: "Retrain the operator on SOP-PRD-014.",
    impact: "No impact to product quality." },
  "B evidenced (rev 4.0)": {
    root_cause: "OP-207 was qualified only on SOP-PRD-022 rev 4.0, which specifies a 12 minute blend. Current rev 6.0, effective 2026-05-30, requires 20 minutes. OP-207 blended for 12 minutes as trained. The failure is in training control, not operator conduct.",
    capa: "Requalify OP-207 on rev 6.0. Audit all operators against current SOP revisions. Gate assignment on current-revision qualification.",
    impact: "Every batch OP-207 blended since 2026-05-30 must be reviewed." },
};

const Q = {
  cause_supported: { type: "noul",
    instructions: "The evidence in `evidence_retrieved` supports the root cause stated in `drafted_disposition`.",
    criteria: { true: "The retrieved records state or directly imply the stated cause is correct", false: "The retrieved records do not address the stated cause at all" } },
  cause_contradicted: { type: "noul",
    instructions: "The evidence in `evidence_retrieved` shows the root cause stated in `drafted_disposition` is wrong.",
    criteria: { true: "The records contradict the stated cause", false: "The records do not contradict it" } },
};

const stats = (xs) => {
  const m = xs.reduce((a,b)=>a+b,0)/xs.length;
  const sd = Math.sqrt(xs.reduce((a,b)=>a+(b-m)**2,0)/xs.length);
  return { m, sd, lo: Math.min(...xs), hi: Math.max(...xs) };
};
const verdict = (sup, con) => con > 0.6 ? "DENY" : sup < 0.25 ? "INSTRUCT" : "ALLOW";

console.log(`self-consistency · N=${N} per case · thresholds: contradicted>0.6 deny, supported<0.25 instruct\n`);
for (const [label, d] of Object.entries(CASES)) {
  const runs = await Promise.all(Array.from({ length: N }, () =>
    askJev({ state: { evidence_retrieved: EV, drafted_disposition: d }, questions: Q, timeoutMs: 15000 })
      .then(a => ({ sup: Number(a.cause_supported), con: Number(a.cause_contradicted) }))
      .catch(() => null)));
  const ok = runs.filter(Boolean);
  if (!ok.length) { console.log(`${label}: all ${N} calls failed\n`); continue; }
  const S = stats(ok.map(r=>r.sup)), C = stats(ok.map(r=>r.con));
  const verdicts = [...new Set(ok.map(r=>verdict(r.sup, r.con)))];
  // distance from the bar that actually decides this case, in sigma
  const bar = C.m > 0.6 ? { name:"contradicted>0.6", d: Math.abs(C.m-0.6), sd: C.sd }
                        : { name:"contradicted>0.6", d: Math.abs(0.6-C.m), sd: C.sd };
  const sigma = bar.sd > 0 ? (bar.d / bar.sd) : Infinity;
  console.log(`${label}`);
  console.log(`  supported     mean ${S.m.toFixed(3)}  sd ${S.sd.toFixed(3)}  range ${S.lo.toFixed(2)}–${S.hi.toFixed(2)}`);
  console.log(`  contradicted  mean ${C.m.toFixed(3)}  sd ${C.sd.toFixed(3)}  range ${C.lo.toFixed(2)}–${C.hi.toFixed(2)}`);
  console.log(`  verdict       ${verdicts.join(" / ")}  ${verdicts.length===1 ? "— stable across all runs ✓" : "— ⚠ FLIPPED"}`);
  console.log(`  margin        ${sigma===Infinity ? "∞" : sigma.toFixed(1)}σ from ${bar.name}  ${sigma>=3?"✓ safe":sigma>=2?"~ thin":"⚠ will flip"}`);
  console.log(`  n=${ok.length}/${N}\n`);
}
