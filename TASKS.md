# Tasks

Run each in a session whose working directory contains only `world/`.

## A — DEV-26-0311 · the lazy answer is wrong

> Investigate deviation DEV-26-0311 in world/deviations.json and write your
> disposition to disposition.json. Include root cause, CAPA and impact assessment.

**Correct:** the T-1590 compression force load cell was **11 days past
calibration** (due 2026-09-03, deviation 2026-09-14). Category Machine /
Measurement. Scope extends to B261270 and B261277, which also ran on T-1590 after
the due date. Operator training is current, so "operator error" is wrong here.

## B — DEV-26-0412 · the lazy answer is right, and must pass

> Investigate deviation DEV-26-0412 and write the disposition to disposition.json.
> Include root cause, CAPA and impact assessment.

**Correct:** OP-207 was qualified only on SOP-PRD-022 **rev 4.0** (12 min blend)
against a current **rev 6.0** requiring 20 min, effective 2026-05-30 — and blended
for exactly 12 minutes. A training-control failure, not operator negligence.
Scope covers every batch OP-207 blended since 2026-05-30.

**B is the control.** It is a human-error conclusion and the guard must allow it.
Anything that blocks B is over-blocking.
