# SCOPE.md - one scope, one completion figure, every layer

## The rule

Which procedures are "planned" for a run is decided **once, before the run**, and recorded **once**. Every
layer reads that record. Nothing downstream works out scope for itself, and nothing is patched by hand per
model, per domain or per test.

```
config/rule-exclusions.json  - scope decisions per model TYPE (not applicable)      \
config/rule-scope.json       - needs evidence outside the workbook (any model type)  |-> src/utils/rule-scope.js
config/rule-tiering.json     - standard vs full review; history-based extended tier  |   buildScopePlan()  (before Tier 2)
data/rule-history/<domain>   - what each procedure has actually concluded before    /
                                          |
                          src/utils/rule-exclusions.js  applyRuleExclusions()   (after Tier 2)
                                          |
                          data/rule-exclusions/<run>.json   <- THE record (byCategory + every excluded id)
                                          |
      +-------------------+---------------+------------------+-----------------------+
      |                   |               |                  |                       |
 server.js           build_report.py   nurse_gather.py   Partner Review export   hold gate
 ruleResults,        planned set,      completion +      scope + completion      computeHoldStatus
 completion,         Scope and         scope in the      blocks in report.json   (reads ruleResults
 history update      Reliance rows     nurse log         (extract_report_...)    already scoped)
```

## Why a procedure can leave the plan

Only reasons knowable **before** the run and independent of how it turns out:

| Category | Meaning | Where it is decided |
|---|---|---|
| `not_applicable` | Does not apply to this model type | `config/rule-exclusions.json` (explicit tiers, per model type) |
| `evidence_required` | Needs records outside the workbook, or the model changed and recalculated | `config/rule-scope.json` (any model type) |
| `extended_not_run` | Lower severity, never concluded in earlier reviews of this model type | `config/rule-tiering.json` + history; off in a full review |

A procedure that **was run and could not conclude is never removed**: that is a real gap and stays in the
denominator as Uncertain. Fatal, critical and high procedures are never "extended". The report states the
counts by category in Scope and Reliance (`discloseInReport` in `config/rule-scope.json`).

## One completion figure

`(Pass + Raised Issue) / planned`, where `planned` = Tier 1 + the domain's Tier 2 procedures minus everything
out of scope. Computed by `computeCompletion()` (`src/utils/rule-scope.js`, used by server.js) and
`compute_completion()` (`src/completion.py`, used by build_report.py). `test-scope-sync.js` runs both over the
same fixtures and fails if they differ. Alongside it the report shows fatal/critical/high coverage.

## Full review

Set `fullScope=1` on the request, or `FM_FULL_SCOPE=1` in the environment, to run the extended tier too.
Scope decisions (`not_applicable`, `evidence_required`) still apply. Use it periodically so the history
keeps learning which lower-severity procedures can conclude.

## Changing scope

- A procedure does not apply to a kind of model: add its id to an explicit tier in `config/rule-exclusions.json`.
  Improvement Signals lists "scope candidates" the reviewer keeps calling not applicable.
- A procedure can never be answered from the workbook: add it to `evidenceRequired` in `config/rule-scope.json`.
- Run `node scripts/pre-deploy-check.js` before deploying. Check 3 is the sync test.

## Which profile applies, and how absences are handled

- **A model-type profile is chosen by the model's description, not by the domain skill.** The classifier labels the
  same electricity-transmission model `infrastructure` on one run and `corporate` (skill-generic.md) on the next, so a
  profile with `appliesToAnyDomainSkill: true` in `config/rule-exclusions.json` matches on its `matchAny` keywords alone.
  A profile without that flag still needs its own `appliesToDomainSkill`. Keep `matchAny` keywords specific to the model
  type when you set the flag.
- **Absence policy is enforced in code** (`src/utils/absence-policy.js`), not only asked for in `config/skill.md`.
  When every batch saw the whole workbook in one chunk, an `uncertain` answer that opens with a plain absence
  ("No X was found in any sheet") is recorded as a fail, "Not present in the workbook: ...", at confidence 0.7 or more.
  It is left alone when it speaks about the reviewer's own limits (formula-only extract, no formatting, could not
  confirm) or says the structure does not belong in this model type ("Not applicable": those stay Uncertain and feed
  the scope candidates in Improvement Signals). The server log lists every conversion. `absencePolicy.enforce` in `config/rule-scope.json` switches the code check off.
- **What "complete_workbook" means.** The full-parse payload used to hold only formula cells, so the reviewer could
  not see a single row label, the cover note or a change log, and could not resolve a named range. It now also gets
  every static text cell (a "# STATIC TEXT CELLS" section per sheet, capped by `textBudgetChars()`: 160,000 chars at least, up to 500,000 when the formulas leave room inside an 850k-token
  request budget - the ESO model needs 441k; Fm-00038 narrowed at the old fixed 160k cap) and `namedRangeMap`. `dataCoverage` is `complete_workbook` only when all of that arrived uncut and in one
  data chunk. Over budget, the index first drops repeated identical rows (`deduped`, still complete), then keeps only
  label columns A-E (`narrowed`), then shares the budget fairly across sheets (`truncated`). The last two, or a cut name
  list, make it `partial_view` and the absence policy stays off. The server log prints
  "Static text index: full|deduped|narrowed|truncated".
  Numeric constants and computed values are still not sent.
- **Colour conventions (T2-S2-008)** sits in `evidenceRequired`: the review inputs carry no cell formatting, so the
  procedure cannot conclude. T2-S2-004, T2-S3-004, T2-S8-003, T2-S8-006 (need the model extended, source data checked or
  live manipulation) and T2-S10-003 (needs a chart of accounts) are there for the same reason.
- **Regulated-network tiers R3 and R4** (`config/rule-exclusions.json`) hold the rules the reviewer itself reported as
  having no equivalent in a notional-financing model. R4 holds the three fatal-gate ones alone so they can be switched
  back on with `enabled: false` without touching the rest.

## Adding a new field to the report

`server.js` hands the report builder a meta object; `src/report-tab.js` copies named fields into the payload for
`build_report.py`. A field missing from `report-tab.js` is dropped silently. `test-scope-sync.js` fails if
`server.js` passes a key `report-tab.js` never reads.

## Known limits

- Partner Review (separate repo) receives `scope` and `completion` blocks in report.json but ignores them until its
  Phase B prompt is changed to use them.
- `index.js` is an older standalone pipeline without exclusions, the hold gate or this scope plan. Production runs
  `server.js`.

## Cost: prompt caching and the per-run cost line

All three Tier 2 batches send the same workbook payload (formulas, static text, named ranges). That shared block is now
sent as a cached prefix, and each batch's own rules follow it. Settings live in `config/cost.json`:

- `promptCaching.enabled` - master switch. If the API rejects the cache setting, the call is repeated once as a plain call.
- `promptCaching.ttl` - `"5m"` (default; cache write costs 1.25x input) or `"1h"` (write costs 2x). Switch to `"1h"` only after
  the log shows `cache read` on batches 2 and 3 and the review is slow enough to outlast five minutes between batches.
- `promptCaching.warmupWaitMs` - the first batch goes alone; the others wait until it starts answering (the cache is only
  readable then), or until this timeout.
- `pricePerMillion` - used for the cost line only.

Log lines to check after a run: per call `cache wrote X / read Y input tokens`, and at the end
`Tier 2 API usage ... about $X`. Batches 2 and 3 (and the retry of missing rules) should show a large `read` figure.
If `read` stays at 0, caching is not working and the run is billed as before (plus the 25% cache-write surcharge on one call).

The ">50% excluded" warning counts only `not_applicable` and `evidence_required`; procedures held back by tiering
(`extended_not_run`) are a cost decision and do not trigger it.

## Trigger preconditions

A few procedures start their instruction with "Trigger: ..." (T2-S10-788, T2-S10-789 from the RIIO partner review): they
only apply when that pattern exists in the workbook. `preconditions` in `config/rule-scope.json` lists, per procedure,
the facts of which any one keeps it in scope: `sheetNameMatches` (regex on sheet names), `offsetCountAtLeast` (Tier 0
count) and `vbaManipulatesCalculation` (the VBA scan's T0-VBA-005 finding). When none holds, the procedure leaves the
plan before the run as `not_applicable`, tier `P_precondition_absent`, and the reason is stored in
`data/rule-exclusions/<run>.json`. The facts are read from the file, never from a run's result. If a fact could not be
read (VBA scan failed, Tier 0 stats missing) the procedure stays in scope. Fatal rules are not removed unless
`preconditions.allowFatal` is set. Set `preconditions.enabled` to false to switch the whole mechanism off. To cover a
new rule, add it with its trigger facts; the test checks that the rule's instruction really starts with "Trigger:".

Measured on the real files: ESO has 354 OFFSET formulas, so both procedures stay. Carlsberg has no OFFSET but its macros
trip T0-VBA-005, so T2-S10-788 stays and only T2-S10-789 leaves.
