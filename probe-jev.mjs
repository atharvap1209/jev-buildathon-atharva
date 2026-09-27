import { askJev, compact } from "./policykit/index.mjs";
import { readFileSync } from "node:fs";
const W = (f) => compact(readFileSync(`${process.env.HOME}/jev-rca/world/${f}`, "utf8"), 2600);

const evidence = {
  "calibration.json": W("calibration.json"),
  "training.json": W("training.json"),
  "equipment_log.json": W("equipment_log.json"),
  "shift_log.txt": W("shift_log.txt"),
};

const GOOD = {
  root_cause: "The compression force load cell on T-1590 was out of calibration. Its calibration was due 2026-09-03 and the deviation occurred 2026-09-14, 11 days overdue. An uncalibrated load cell allowed the force to trend to 19.6 kN against a limit of NMT 18.0 kN for 18 minutes without detection.",
  capa: "Recalibrate T-1590 load cell. Revise the calibration interval to a risk-based basis. Add an interlock preventing production on equipment past its calibration due date.",
  impact: "Batches B261270 and B261277 also ran on T-1590 after 2026-09-03 and must be assessed. B261277 already carries DEV-26-0298.",
};

const LAZY = {
  root_cause: "Operator error during compression. The operator failed to monitor the force readings.",
  capa: "Retrain the operator on SOP-PRD-014.",
  impact: "No impact to product quality.",
};

const Q = {
  cause_supported: { type: "noul",
    instructions: "The evidence in `evidence_retrieved` supports the root cause stated in `drafted_disposition`.",
    criteria: { true: "The retrieved records state or directly imply the stated cause is correct", false: "The retrieved records do not address the stated cause at all" } },
  cause_contradicted: { type: "noul",
    instructions: "The evidence in `evidence_retrieved` shows the root cause stated in `drafted_disposition` is wrong.",
    criteria: { true: "The records contradict the stated cause", false: "The records do not contradict it" } },
};

for (const [label, d] of [["GOOD (calibration)", GOOD], ["LAZY (operator error)", LAZY]]) {
  try {
    const a = await askJev({ state: { evidence_retrieved: evidence, drafted_disposition: d }, questions: Q, timeoutMs: 12000 });
    console.log(`${label.padEnd(24)} supported=${Number(a.cause_supported).toFixed(3)}  contradicted=${Number(a.cause_contradicted).toFixed(3)}  (${a._ms}ms)`);
  } catch (e) { console.log(`${label.padEnd(24)} ERROR: ${e.message}`); }
}
