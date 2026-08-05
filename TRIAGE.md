# TRIAGE.md — Localizing "why does this look wrong" before fixing it

## Why this exists

When a finding, a report, or a run looks wrong, the same visible symptom
can come from genuinely different places — and guessing wrong means
fixing the wrong thing. This document adapts the interaction-centric
failure taxonomy from ["Model or Harness? An Interaction-Centric
Taxonomy for Localizing Agent Failures"](https://arxiv.org/abs/2607.28802)
(Raj et al., 2026) to this project's own architecture.

The paper's core finding: reducing a failure to "the agent got it wrong"
obscures where the fault actually originated, and the same failure can
call for a completely different fix depending on its source. Their fix
is to localize every failure to an *interaction edge* (which two
components were involved) and a *fault side* (which one is actually
responsible) — because a model-side failure needs a different repair
than a harness-side or environment-side one, even when they look
identical from the outside.

This matters more as fm-validator grows, not less — more checks, more
`skill.md` sections, a growing harness, CI now in the loop. More moving
parts means more places a "the report looks wrong" symptom could
actually originate.

**A concrete near-miss that motivated this document:** investigating an
apparent deployment discrepancy (`T0-HARDCHECK-001` showing "3" instead
of an expected "42"), the first-pass conclusion was "stale deployment"
— a plausible-sounding environment-side explanation that turned out to
be wrong. The actual cause was one hop further back: a harness-side
design decision (the report headline surfaces only the high-confidence
subset, with the rest in a footnote) made months earlier. Tracing only
as far as the first plausible explanation, instead of one hop further,
nearly misdirected the fix. See Case 6 below for the full trace.

---

## The five components

| Component | What it is here | A symptom pointing here usually means |
|---|---|---|
| **Model** | Tier 2 (Claude, reasoning over the payload) | The model had correct guidance and correct data, and still reasoned incorrectly — genuinely hard to "fix" directly; usually surfaces as something to monitor, not patch |
| **Context** | `config/skill.md`, `config/soul.md` | The model's guidance was missing, wrong, or contradictory — fixable by editing the prompt |
| **Tool** | The payload itself — what data Tier 2 actually receives (`_formulaSamples`, `workbookStats`, row subsets) | The model reasoned correctly given what it could see, but couldn't see enough — fixable by changing what gets included in the payload |
| **Harness** | `index.js` / `server.js` / `src/build_report.py` / `src/utils/*.js` (Tier 0/1 checks) | The underlying finding or data is correct, but the code that detects, assembles, aggregates, or presents it has a bug — fixable by editing that code |
| **Environment** | Deployment, git, CI, the actual server, GitHub Actions | The code and guidance are both genuinely correct — what's deployed, committed, or running doesn't match what's in the repo — fixable by re-deploying, not by editing anything |

---

## The mandatory first step: trace one hop further back

Before proposing *any* fix, do not stop at the first plausible
explanation. Ask explicitly:

1. **What is the symptom, precisely?** (Not "the report is wrong" — the
   exact field, the exact number, the exact text.)
2. **What is the most obvious explanation?** (Write it down before
   investigating further — this is the trap to check against.)
3. **Have I verified that explanation against the actual data, or am I
   pattern-matching from a prior case?** If the honest answer is
   "pattern-matching," go one hop further before proposing a fix.
4. **Once verified, which of the five components does the true root
   cause sit in?** That answer determines what actually needs to
   change — a different component than you first assumed is a signal
   you traced correctly, not a sign of a wasted step.

A genuinely correct diagnosis is one where, if you're right, editing
*only* the identified component's own file(s) fixes the symptom with no
side effects elsewhere. If a "fix" would require touching two unrelated
components at once, the diagnosis is probably still one hop short.

---

## Worked examples from this project's own history

Every example below is a real, verified case from this project — not a
hypothetical. Each shows the symptom, the first-pass (sometimes wrong)
explanation, and the actual root cause once traced fully.

### Case 1 — Harness bug masquerading as a model/data problem
**Symptom:** `checkHardcodedCheckCells` produced a wildly different
finding count between runs on the same reference files (93 → 1,307 at
one point during development).
**Root cause:** **Harness.** The result-scanning loop's own comment
said "the first non-empty candidate result cell," but the code never
actually stopped after finding one — it pushed a separate finding for
every qualifying cell in a row. A multi-column metadata row (Formula /
Source / Method columns) produced one finding per column instead of one
per row.
**Fix:** Code change in `src/utils/hardcoded-check-cells.js` — stop at
the first result cell. No `skill.md` or payload change needed.

### Case 2 — Context gap masquerading as a model reasoning failure
**Symptom:** An independent review found Tier 2 flagging a genuinely
correct `MIN(start dates)/MAX(end dates)` schedule-bounds row as a
"broken SUM," and separately claiming formula-vs-value status "cannot
be verified from row data" when Tier 0 already knows this for every
cell.
**Root cause:** **Context.** `skill.md` gave no guidance distinguishing
this pattern from a genuine broken aggregation, and in the second case
actively told Tier 2 the information was unavailable when it wasn't.
**Fix:** Prompt edits in `config/skill.md` (I-14, I-18). No code
change — the model would have reasoned correctly with the missing
guidance in place.

### Case 3 — Tool/payload gap, not a model or context problem
**Symptom:** Tier 2 operated on extracted values, not raw formula
logic, structurally unable to catch something like "equity NPV wired to
equity value instead of discounted cash flows" (R-8, this project's
Mode A limitation).
**Root cause:** **Tool.** The payload itself never included formula
text at all — no amount of better prompting in `skill.md` could close
this gap, because the data needed to reason about it wasn't present.
**Fix:** Payload change (`_formulaSamples` in `src/parser.js` and
`validator-tier2.js`) — this is a **tool**-side fix, distinct from a
**context**-side prompt fix, even though both live in the Tier 2
pipeline.

### Case 4 — Environment issue that looked like a code bug
**Symptom:** `regression-snapshot.js` reported two files as "no longer
present," with real prior values in the baseline (`Financial Model_The
Bend 8 7 2026.xlsx: 5 -> n/a`).
**First-pass hypothesis (wrong):** File re-saved in Excel, silently
changing its content hash.
**Root cause:** **Environment.** `git status --short` showed both files
as genuinely untracked (`??`) — an earlier `git add` with unquoted
paths containing spaces had silently failed to stage them. The baseline
was correct; the repo just hadn't caught up to it.
**Fix:** `git add "path with spaces"` (quoted) and push. No code
change, no baseline regeneration needed — confirming the diagnosis was
right, because the fix alone resolved it.

### Case 5 — Genuine model-side non-determinism, not a "bug" to fix
**Symptom:** Running the identical model twice with no changes produced
different findings — 18 closed, 19 new.
**Root cause:** **Model**, and specifically not fixable by editing
anything. Tracing every changed finding ID confirmed zero deterministic
(Tier 0/Tier 1) findings changed at all — 100% of the churn was Tier 2
re-reasoning from scratch and not reliably reproducing the same
borderline findings.
**Fix:** Not a code fix — a **harness** change to how this is
*reported* (`finding-history.js` / `build_report.py` split into
deterministic vs. LLM lines, each with honest framing). The underlying
model behavior is expected and not something to chase further.

### Case 6 — Harness presentation bug, mistaken for environment staleness
**Symptom:** `T0-HARDCHECK-001` showed "3 check/reconciliation cell(s)"
in a report, where 42 was expected based on prior verification.
**First-pass hypothesis (wrong):** Stale deployment — the fix hadn't
made it to the server yet.
**Root cause:** **Harness.** The finding's own construction code
(`index.js`) deliberately split high-confidence findings (headlined)
from low-confidence ones (a footnote in a different field) — by design,
built earlier in this same project. 3 + 39 (footnote) = 42. The
deployed code was correct throughout; only the headline was misleading.
**Fix:** Harness change — the headline now states the true total with
an explicit confidence breakdown, so this exact misreading can't recur.

---

## Confusing case log

Append a row here whenever a finding-quality issue takes more than one
hop to actually understand — this is the raw material for catching
patterns in where fm-validator's own failures cluster as it grows, the
same way the paper's own taxonomy was built from real logged cases, not
guessed in the abstract.

| Date | Symptom | First-pass guess | Actual component | Actual root cause | Fix |
|---|---|---|---|---|---|
| 2026-08 | `checkHardcodedCheckCells` count spiked 93→1,307 | (found before shipping — no wrong guess) | Harness | Result-scan loop never stopped at first match | Stop-at-first-match fix |
| 2026-08 | `T0-HARDCHECK-001` showed 3, expected 42 | Stale deployment (Environment) | Harness | Headline showed high-confidence subset only | Show true total with breakdown |
| 2026-08 | Two fixture files showed "no longer present" | Excel re-save changed hash (Environment) | Environment | Unquoted `git add` with spaces silently failed to stage | Quote the path |
| 2026-08 | `bug-scan-agent` flagged `test-scope-formula-integrity-text.js` as calling a nonexistent module | (flag taken at face value initially) | Harness (the bug-scan tool itself) | Post-commit hook reviews only the commit's own diff — `src/report-tab.js` was untouched by this commit, so the agent couldn't see it existed and concluded it didn't | None needed — verified `src/report-tab.js` exists with the exact signature and the test genuinely passes; the finding itself was the false positive |

*(Add new rows above this line as they come up — keep the newest at the
top.)*
