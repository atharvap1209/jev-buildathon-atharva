import { customPolicies, allow, deny, instruct } from "failproofai";
import { history, userPrompts, compact, askJev } from "./policykit/index.mjs";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// shadow = evaluate and log, never block. enforce = the gate is live.
const MODE = process.env.RCA_MODE ?? "shadow";   // shadow by default. RCA_MODE=enforce to block.

// Which sources bear on which fishbone category. Code owns this, not Jev.
const CATEGORY_SOURCES = {
  Man:         ["training.json", "shift_log.txt"],
  Machine:     ["calibration.json", "equipment_log.json", "shift_log.txt"],
  Material:    ["materials.json", "batch_history.json"],
  Method:      ["sop_versions.json", "batch_history.json"],
  Measurement: ["calibration.json", "equipment_log.json"],
  Environment: ["env_monitoring.json"],
};
const ALL_SOURCES = [...new Set(Object.values(CATEGORY_SOURCES).flat())];
const isDisposition = (p) => /disposition\.json$/.test(String(p ?? ""));
const GUARD_FILES = /rca-policies\.mjs|policykit|FAILURES\.md/;

/** Give Jev named fields with their own budget, never one truncated blob.
 *  Order and length must not decide the verdict. */
function fields(draft) {
  try {
    const d = JSON.parse(draft);
    const pick = (...k) => k.map((x) => d[x]).find((v) => v != null) ?? null;
    return {
      root_cause: compact(pick("root_cause", "rootCause", "cause"), 1500),
      capa: compact(pick("capa", "CAPA", "corrective_actions", "corrective_and_preventive_actions"), 1500),
      impact: compact(pick("impact_assessment", "impact", "scope", "scope_assessment"), 1500),
    };
  } catch {
    return { disposition_text: compact(draft, 3000) };
  }
}

function sourcesRead(ctx) {
  const blob = JSON.stringify(history(ctx) ?? []);
  return ALL_SOURCES.filter((f) => blob.includes(f));
}

/** The actual records the agent read, straight from disk. Small, named, complete —
 *  Jev judges against evidence, not against truncated tool-call metadata. */
function records(read) {
  const out = {};
  for (const f of read) {
    try { out[f] = compact(readFileSync(resolve(process.cwd(), "world", f), "utf8"), 2600); }
    catch { /* not readable from here; skip */ }
  }
  return out;
}

function coverage(read) {
  const examined = [], unexamined = [];
  for (const [cat, srcs] of Object.entries(CATEGORY_SOURCES)) {
    (srcs.some((s) => read.includes(s)) ? examined : unexamined).push(cat);
  }
  return { examined, unexamined };
}

const decide = (kind, msg) => {
  if (MODE === "shadow") { console.error(`[rca-guard:shadow] would ${kind}: ${msg}`); return allow(); }
  return kind === "deny" ? deny(msg) : instruct(msg);
};

customPolicies.add({
  name: "rca-must-be-evidenced",
  description: "A deviation may not be dispositioned on an unevidenced root cause.",
  match: { events: ["PreToolUse"] },
  fn: async (ctx) => {
    const t = ctx.toolName;
    if (t !== "Write" && t !== "Edit") return allow();
    if (!isDisposition(ctx.toolInput?.file_path)) return allow();

    const draft = String(ctx.toolInput?.content ?? ctx.toolInput?.new_string ?? "");
    if (!draft.trim()) return allow();

    const read = sourcesRead(ctx);
    const { examined, unexamined } = coverage(read);

    // ---- Tier 1: deterministic. Code knows what was looked at. ----
    if (read.length === 0) {
      return decide("deny",
        "No source records were read before dispositioning. Read calibration.json, training.json, " +
        "equipment_log.json and shift_log.txt for the equipment and operator named in the deviation, then try again.");
    }
    if (unexamined.length >= 4) {
      const want = [...new Set(unexamined.flatMap((c) => CATEGORY_SOURCES[c]))].join(", ");
      return decide("instruct",
        `Only ${examined.join(", ")} examined. ${unexamined.join(", ")} were never queried — an investigation ` +
        `limited to one category is not sufficiently broad. Read ${want} before closing.`);
    }

    // ---- Tier 2: judgment. Jev reads the draft against what was retrieved. ----
    let a;
    try {
      a = await askJev({
        state: {
          operator_said: userPrompts(ctx),
          evidence_retrieved: records(read),
          drafted_disposition: fields(draft),
        },
        questions: {
          cause_supported: { type: "noul",
            instructions: "The evidence in `evidence_retrieved` supports the root cause stated in `drafted_disposition`.",
            criteria: { true: "The retrieved records state or directly imply the stated cause is correct", false: "The retrieved records do not address the stated cause at all" } },
          cause_contradicted: { type: "noul",
            instructions: "The evidence in `evidence_retrieved` shows the root cause stated in `drafted_disposition` is wrong.",
            criteria: { true: "The records contradict the stated cause", false: "The records do not contradict it" } },
          capa_addresses_cause: { type: "noul",
            instructions: "The corrective action in `drafted_disposition` addresses the root cause it identifies, rather than only correcting the symptom.",
            criteria: { true: "It addresses the identified cause", false: "It only fixes the immediate symptom" } },
          scope_extended: { type: "noul",
            instructions: "`drafted_disposition` considers whether other batches or lots are affected by the same cause.",
            criteria: { true: "Other affected batches are assessed or named", false: "Impact on other batches is not considered" } },
        },
      });
    } catch (e) {
      // The judge being unreachable is not permission to close a deviation.
      return decide("deny", `Root-cause review is unavailable (${e.message}). A deviation may not be dispositioned unreviewed.`);
    }

    const sup = Number(a.cause_supported), con = Number(a.cause_contradicted);
    console.error(`[rca-guard] supported=${sup.toFixed(2)} contradicted=${con.toFixed(2)} capa=${Number(a.capa_addresses_cause).toFixed(2)} scope=${Number(a.scope_extended).toFixed(2)} (${a._ms}ms)`);

    if (con > 0.6) {
      return decide("deny", "The evidence you retrieved contradicts the stated root cause. Re-read it and revise the conclusion.");
    }
    if (sup < 0.25) {
      // Surface it, do not block on it: real drafts are long, structured and hedged,
      // which depresses `supported` without the cause being wrong. `contradicted` is
      // the measured discriminator (see probe-jev.mjs: 0.10 good vs 0.67 lazy).
      return decide("instruct",
        "The evidence you retrieved does not clearly carry the stated root cause. Check the calibration status " +
        "of the equipment named in the deviation, the operator's training record against the current SOP version, " +
        "and the shift log for that date — then state the cause plainly, as a claim rather than a list of candidates.");
    }
    if (Number(a.capa_addresses_cause) < 0.3) {
      return decide("instruct", "The CAPA fixes the symptom, not the cause you identified. Add an action that addresses the cause itself.");
    }
    if (Number(a.scope_extended) < 0.3) {
      return decide("instruct",
        "Impact on other batches is not assessed. Check batch_history.json for other batches that used the same " +
        "equipment or operator in the affected window, and record the assessment.");
    }
    return allow();
  },
});

customPolicies.add({
  name: "rca-guard-is-not-readable",
  description: "The agent may not read the policy that judges it.",
  match: { events: ["PreToolUse"] },
  fn: async (ctx) => {
    const probe = JSON.stringify(ctx.toolInput ?? {});
    if (!GUARD_FILES.test(probe)) return allow();
    return deny("That file is the review policy, not evidence. Investigate the deviation from the records in world/ instead.");
  },
});
