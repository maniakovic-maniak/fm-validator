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

The system prompt (SOUL + skill + domain skill) is about 270k tokens for the infrastructure domain and is sent with every
call on every route, so the first-call-alone stagger applies to the curated route too, not only full-parse (Fm-00041,
curated route: three parallel calls wrote it three times, 801k tokens, and read none).

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

## Large models: chunked full-parse

A model whose formulas and wording do not fit one request next to the system prompt used to fall back to the curated route
(extracted values, no text index, no absence policy). GT1 scored 50% there against 77% for models that fit (Fm-00041).
Such a model is now reviewed in **data chunks** (`src/utils/data-chunker.js`, `config/chunking.json`):

- **Room for a chunk** = context window - reserved output - request overhead - the system prompt, less a safety margin.
  About 500k tokens for the infrastructure prompt (267k tokens), about 700k for corporate (60k). The same check catches a
  model the router sent to the single-request route that would overflow the window next to a large system prompt.
- **A chunk holds whole sheets**, grouped so sheets that reference each other travel together. A sheet too big for a chunk is
  cut at row boundaries (formula lines and their labels together); one row of thousands of cells is cut by cells.
- **Chunks run one after another**, the batches of one chunk in parallel. The system prompt is cached for 1h and written once;
  each chunk's data is written once by that chunk's first call and read by its other calls.
- **Every chunk is asked every rule**, except rules an earlier chunk already raised (`skipRulesAlreadyRaised`). Answers merge per
  rule: an issue beats a pass, a pass beats uncertain (`reconcile-sub-batch-results.js`). The reviewer is told to pass only when
  its own chunk holds all the evidence, and to say "not visible in this chunk", never "not present in the workbook".
- **The absence policy stays off** for a chunked review (no chunk sees the whole workbook), so "No ... exists" answers stay Uncertain.
- **Cost is multiplied by the number of chunks** (output above all). The plan prints an estimate before the run
  (`Chunked full-parse plan: N data chunks ...; estimated cost about $X (limit $Y)`) and a plan above `maxEstimatedCostUsd`, or
  needing more than `maxChunks`, is not used: the model is reviewed on the curated route as before.
- To switch it off set `enabled` to false. To exercise it on a cheap model set `capacityOverrideTokens` (for example 100000 on
  Carlsberg gives two chunks) and put it back to null afterwards.

`test-data-chunker.js` covers the chunker; `test-chunked-fullparse.js` runs the whole path against a stand-in SDK.

## Deterministic false-positive fixes from the ESO independent review (2026-10-19)

An independent reviewer checked the ESO licence-model report line by line. These deterministic checks were changed because the review showed they raised findings that the model itself contradicts. All are free to run; none lowers the depth of the Tier 2 review.

| Check | Was | Now |
|---|---|---|
| T0-LINK-001 (orphan sheets) | A sheet that reads the model but feeds nothing, or a values-only store, counted as an orphan (P1) | Only a sheet with formulas and no link to or from the model is an orphan. Sheets that read the model are terminal consumers; those not named like an output or store get a low-severity T0-LINK-002 review item |
| T0-NR-001 (broken names) | A print area pointing into another workbook was a critical broken name | Print/filter names and names that point into another workbook are T0-NR-003 (low). Only a name whose internal sheet is gone stays T0-NR-001 |
| T0-NR-002 (unused names) | Only formula text was searched | Names used in macro source are live. Severity high to medium |
| T0-LOOKUPMATCH-001 | `MATCH(...,1)` and `VLOOKUP(...,TRUE)` were flagged as missing an exact-match argument | A written-out approximate match is deliberate and counted, not flagged. An omitted argument is still flagged |
| T0-CONSTFORMULA-001 | `CELL("filename")` text extraction and `COLUMN(name)` counted as literal-only formulas | Metadata, coordinate and defined-name formulas are skipped |
| T0-OVERFLOW-001 | A number format that spells words, e.g. `[=1]"Company proposal"`, made the integer code look like a 1900 date | Only a format with a date/time code outside quotes and brackets is a date format |
| T0-RI-001 | Section numbers 1, 2, 3, 4 beside headings were unused assumptions; the locator named the wrong sheet | Integer chains counting 1, 2, 3 ... (gaps allowed) are excluded; the locator uses the first flagged cell's own sheet |
| T0-CIRC-002 | `ROW(E368)` in E368 was a cycle | ROW() and COLUMN() read position, not value, and add no edge |
| T0-VBA-002/003/005 | ActiveX handlers with empty bodies were "auto-run"; `Run`, `Open`, `Output` in code, comments and messages, and base64 heuristics were "system calls"; any calculation-mode change was high severity | Only real open-time triggers with a body; keywords must occur in code, file words need an `Open ... For` statement, `Run` needs Shell/CreateObject; calculation findings are high only for an iterative solver |
| T1-009 | Only a row of the words Actual/Forecast near the top of a sheet passed | A labelled 0/1 historical/forecast period-flag row anywhere in the first 5000 rows also passes |
| T1-015 | A hyphen in "RIIO-1 revenue and charges" failed | A hyphen in a name that already has a space is accepted |
| T0-RSN-004 | Raised a critical query on any model with no per-unit revenue metric | Does not apply when there is no volume driver (regulated or tariff revenue) |
| T0-FMLPATTERN / COLPATTERN / NESTEDIF / HIDDEN-001 | Severity medium / medium / medium / high | Screening items are low; hidden live logic is medium |

Scope: tier R5 in `config/rule-exclusions.json` takes ten conditional project-finance procedures out of the plan for a regulated network model before the run, and T2-S6-003 (DSCR structure) joins the statutory-gates tier R4. Procedures the reviewer judged useful (for example T2-S5-008, T2-S6-002, T2-S10-336) stay in scope. Regression tests: `test-eso-review-fixes.js`.

## Patch 2 from the ESO independent review (2026-10-19)

| Addition | What it does |
|---|---|
| T0-NESTEDSUM-001 | Plain SUM total whose range contains another SUM cell and the cells that SUM adds up (double count); reports value with and without the repeat |
| T0-PLACEHOLDER-001 | "To be provided / TBC / TBD" text sitting in a numeric row of a calculation sheet |
| Screening record types | Deterministic and screening findings classed before P-ranking, so they do not claim P1-P3 |
| Related findings | Findings sharing cells get a common RC- group id and a note: one repair and one retest cover them |
| Tier 2 prompt (Step 5c) | Fixes tested on a stored value, signs read from values, no stale "no computed values" claims, "deliberate" needs evidence, function semantics, label before description; new sum_range_integrity and iferror_not_masking tests; ABS() no longer recommended on signed balances |

Hidden Gem (38,798 sums): 12 s, 0 findings from the new checks.

## Patch 6 from the second ESO run (2026-10-19)

| Change | Detail |
|---|---|
| Finding class (regulated-network profile only) | `config/finding-class.json`: governance absences (T2-S9-001, S9-002, S13-001, S13-002, S13-009) rated P3; design-preference stress cases (T2-S8-010, S8-012) recorded as Observations. Other profiles unchanged. Completion unchanged. |
| Same-remedy group (all models) | T2-S9-002, S13-001 and S13-002 share group RC-VERSION-CONTROL |
| Stored values digest | Full-parse payload now ends each sheet with first/last/min/max/negatives for every labelled formula row (about 17,600 tokens on ESO). Switch off with FM_VALUES_DIGEST=off |
| Validation Matrix evidence | Full-parse runs now say what the reviewer saw instead of "Standard data subset" |
| Tier 2 prompt | First-forecast-column initialisation is a pass; check for spare scenario columns and selectors before reporting a missing stress case; no_impossible_balances reads the digest |

## Patch 7 from the third ESO run, Fm-00045 (2026-10-19)

| Change | Detail |
|---|---|
| Critical Query cap (all models) | A disclosure-type "Not present in the workbook" finding on a medium or low severity rule, below 60% confidence, is a Query. It was a Critical Query only because the word "tax" is in the key-output list (T2-S5-008, 45% confidence, the report's only Critical Query). Fatal, critical and high severity keep the escalation. |
| Scope tier R6 (regulated-network profile) | Seven procedures the reviewer answered "Not applicable to this model type" are scoped out: T2-S10-354, 381, 429, 453, 461, 503, 720. Each ended Uncertain, which does not count towards completion. Expected effect on the same answers: 98 of 118 planned, 83.1% (was 98 of 125, 78.4%). |
| Regulated return parameters | New Reasonableness Review section and Tier 0 check T0-RSN-010: vanilla WACC (0.5%-10%), cost of equity (3%-15%), notional gearing (30%-80%). Reads the first number on a labelled row up to 60 columns right. Disclosed rule-of-thumb ranges, flagged as a Query. ESO: 3.31%, 7.57%, 55.0%, all in range, 0.2 s. |
| N/A explanation | Reasonableness Review states that N/A means the model has no such figure to test; it is not a pass and not a model gap. |

## Patch 8 from the fourth ESO run, Fm-00046 (2026-10-19)

| Change | Detail |
|---|---|
| Critical Query cap, wider | The Patch 7 cap on medium and low severity absences no longer needs the A1 fallback cell. In Fm-00046 the reviewer anchored the deferred tax absence to SystemOperator!AP658 and it stayed a Critical Query. |
| Scope tier R7 (regulated-network profile) | Six more procedures whose subject matter the reviewer said does not exist: T2-S7-005 (IRR/NPV range), T2-S10-353 (construction equity bridge), T2-S10-425 (PSC), T2-S10-451 (economic cost-benefit), T2-S10-493 (tiered promote), T2-S10-709 (pumped storage). T2-S7-005 and T2-S10-353 were Critical Queries at 40% and 30% confidence. |
| Not changed | T2-S3-005 (WCF values in two places, critical rule, 50% confidence) stays a Critical Query: it is a real unresolved question. |

## Patch 9 from the independent review of Fm-00046 (2026-10-22)

| Change | Detail |
|---|---|
| Tier 2 prompt, Step 5c | Rule 6 now says to quote the row's existing label before naming a hardcoded constant (T2-S1-003 called the "RIIO-2 Wokingham adjustment to RAV" row a "DRS revenue conversion factor"). New rule 7: results a macro pastes in per scenario are deliberate snapshots, so do not recommend live links; the check is whether they can be shown to be current. New rule 8: a fix to a switch must show both flag positions. Unproven until a paid ESO run. |
| Reliance wording | With an open P1, an unresolved Critical Query or a failed gate, the tier is still internal review only, but the Audit Output status and the Scope and Reliance decision now read "Not ready for reliance - internal review only" and the decision text names the open blockers. Tier logic unchanged. |
| Completion tile | A note under the tiles says Audit Completion measures checklist coverage and is not independent verification of the model's logic or numbers. |
| Regulated outcomes | The Reasonableness Review section now also tests AICR (lowest forecast year at least 1.0x) and RoRE (lowest forecast year not negative), shown as Review when they fail and raised through T0-RSN-010 as a Query. On the real ESO model: AICR 0.40x at FinancialRatios!AQ132, RoRE -2.61% at FinancialRatios!AQ94. The 1.0x floor is a disclosed rule of thumb, not a regulatory threshold. |

## Patch 10 from the developer refinement report (2026-10-25)

Code claims 1-6 in the report were checked against the repo and are true. This patch takes the three truthfulness fixes.

| Change | Detail |
|---|---|
| Recalculation status | Only status "success" can read as a clean recalculation. Any other status (batch_evaluation_failed, error, one not seen before) is shown as Not performed with the status named. |
| "Closed" | A finding absent from a run is reported as "not found in this run". The tile and note say this is not evidence it was fixed. History bookkeeping is unchanged, so regression detection still works. |
| Failed chunk | In a multi-chunk run, a failed batch whose rules another chunk answered is no longer erased. It is kept as partial coverage and listed in Scope and Reliance. The rules keep their verdicts and are not marked Not Performed. |

Not in this patch: keeping several issues per rule through the chunk merge (Patch 11), classifier handling of missing confidence (Patch 12).

## Patch 11: more than one problem under a rule (2026-10-25)

| Change | Detail |
|---|---|
| Chunk merge | `reconcileDataSplitResults` keeps every distinct raised result for a rule. The same problem (same sheet and a real cell, or the same wording for a result with no cell) is kept once. A rule with no issue still keeps one result. |
| Mandatory gate | build_report.py built a last-wins id-to-status dict, so a later pass could hide an earlier issue on a fatal rule. A rule is now complete only when every one of its results is a pass. |
| Completion and Validation Matrix | Already filtered by rule id, so a rule with several results counts once. Tested. |

Known edge: `consolidateTier2Duplicates` keys on finding id, so a "same as T2-X" cross-reference on a rule that now has several results applies to the id, not one cell. Not changed.
Not in this patch: asking later chunks for additional problems under an already-raised rule, and the prompt line asking for one object per distinct problem (both add Tier 2 cost; measure on a paid run first).

## Patch 12: a missing confidence is unknown, not 100 (2026-10-25)

| Change | Detail |
|---|---|
| Classifier | `classifyRecordType` no longer defaults a missing confidence to 100. Tier 2 already stores a missing value as 0, so it was unaffected. The one place it bit was Tier 1, whose code checks report no confidence. |
| Tier 1 | Checks that read a fact off the file (errors, external links, circularity, hidden rows, sheet names, calc settings, white text, array formulas, data validation) are treated as exact (100). Checks that decide by matching sheet or row names (T1-002, 004, 005, 006, 008, 009, 012) are assumed 65. |
| Effect | A fatal name-matching check, such as T1-009 (a sheet called Timing or Flags) that was a P1 on the ESO model, becomes a Critical Query. It still blocks reliance. A non-fatal name-matching check is unchanged. |
| Anything else | A finding with no confidence and not Tier 1 is unknown: a Query, or a Critical Query when fatal or critical. In the 2 Oct ESO report every Tier 0 finding carried a confidence, so none were affected. |
| Record | `confidence_basis` is set on the finding when the value was assumed. An explicit `record_type` set by a check is still respected. |

Not changed: a detector that sets `record_type: Confirmed Finding` itself. That needs the detector list reviewed one by one.

## Patch 13: Uncertain with an Issue Log entry (2026-10-25)

Decision (Mik, option A): the completion figure is not changed. A Tier 2 answer of "uncertain" can still carry a priority, so it appears in the Issue Log while the Validation Matrix correctly shows the rule as Uncertain and does not count it. The report now says so in both places.

| Where | Change |
|---|---|
| Issue Log | The "What is wrong" text of such an entry starts "[Procedure not concluded: the reviewer was uncertain, so this is an open question, not a confirmed defect]". The Status dropdown is unchanged. |
| Validation Matrix | Missing Evidence reads "The reviewer could not conclude this procedure and recorded an open question in the Issue Log (ID). It is not counted as completed." A note above the table gives the count. |
| Rule | A rule is treated as unconcluded only when it has an uncertain result and no raised issue. Tier 1 is unchanged. |

Not changed: how completion is computed (Option C, counting these only when the finding is a Confirmed Finding, was considered and set aside).

## Patch 14: the reviewer is told what the macros do (2026-10-25)

Diagnosis on the real ESO model. T2-S10-788 (iteration-state integrity) is correctly in scope: SavedResults and LiveResults sheets, 341 OFFSET formulas, a 31-module VBA project that sets Application.Calculation. It had concluded in 2 of 7 runs because the reviewer saw only the module count and the labels of two scan findings, never the macro source, so it could not tell whether any macro records a refresh date. T2-S13-004 (macros documented) compared the README with a raw count of 31 modules, 24 of which are empty sheet stubs.

| Change | Detail |
|---|---|
| `src/utils/vba-digest.js` | Facts read from the macro source with comments and text strings removed: modules with real code versus empty stubs, procedure names, and flags for writes values, sets calculation, records a date or time, uses the clock, shows a message. A pause such as Application.Wait (Now + ...) uses the clock but is not a run log. |
| Reviewer payload | `vbaSummary.digest`. About 1-2k tokens. |
| skill.md | macros_documented is judged against substantive modules and may not return uncertain for "cannot judge safety". riio_iteration_state_integrity may fail on "no macro records a date or time and no sheet holds a last-refresh stamp". |
| checklist.json | T2-S13-004 manual_only set to false: its test text is decidable from the VBA scan. |

On ESO: 31 modules, 7 with real code, 24 stubs; macros set calculation and write values; none records a date or time. Unproven until a paid ESO run: whether the reviewer now concludes these two rules.

## Patch 15: model identity and a further scope tier (2026-10-25)

Findings from Fm-00047. (1) "Since last run" always said first run: the stored file name ends in the upload time in epoch milliseconds (12-13 digits), so every upload looked like a new model. (2) Exploration picked procedures the reviewer itself called not applicable to this model type; each ended Uncertain, which does not count, and completion fell to 80%.

| Change | Detail |
|---|---|
| `normalizeModelIdentity` | Strips a 12-13 digit run. Version numbers and years are shorter and unaffected. History saved before this patch is keyed by the old identity, so the first run after deploy still shows as first run. |
| Tier R8 (regulated_network_utility) | T2-S10-383, 532, 574, 665, 689, 700, 708: IFRIC 12, technology maturity and downside, managed energy service agreements, avoided capex, generation PPA tariff, hydro. All medium severity, not fatal-gate. A rule still counts whenever a run reaches a Pass or Issue verdict on it. |
| Kept in scope | T2-S10-336 (revenue control classification), 508 (covenants), 369 (technical-to-financial bridge): the reviewer said "not present", not "not applicable". |

Effect on Fm-00047: 126 planned becomes 119, completion about 85% (101 of 119) with no change to the definition.
Not changed: the Critical Query cap for uncertain results on medium rules (T2-S10-336), left for later at Mik's instruction.

## Patch 16: honest locations and honest "mandatory" wording (2026-10-25)

Findings from Fm-00047. (1) 9 of 114 Tier 2 findings had an unusable location: a sheet called "A1", a blank or "None" sheet, or "Workbook" with a View link that pointed nowhere. Most were really workbook-level (VBA calculation override, named-range counts, change-log and issue-tracker absences, sheet list). (2) The report said "9 incomplete mandatory critical procedures", but only 6 were unfinished: T1-006, T2-S1-002, S3-002, S4-003, S9-004 and S13-008 were uncertain, while S4-006, S8-005 and S9-001 had run and raised an issue.

| Change | Detail |
|---|---|
| `src/utils/location-repair.js` | Runs before the unusable-location count. Order: one `Sheet!Cell` reference in the text (only when all references point at one sheet); else exactly one real sheet named in the text (case-sensitive whole name); else the finding is recorded as workbook-level with sheet "Workbook". Never guesses between sheets. Sets `location_basis`. |
| Issue Log | "Workbook" rows show "—" in the View column instead of a link to a sheet that does not exist. |
| Location check | "Workbook" counts as workbook-level; an absence starting "Not present", "Not found" or "Not applicable" counts as an honest A1. |
| `build_report.py` | Verdict banner, Scope and Reliance, and Audit Output now say "N mandatory critical procedure(s) not concluded" and "N mandatory critical procedure(s) with a raised issue" separately. Both still block reliance. |

On the real Fm-00047 findings the repair reads one sheet from the text for two rows (T2-S12-007 SystemOperator, T2-S10-508 FinancialRatios) and records the rest as workbook-level.
Not changed: which procedures are mandatory, or how a mandatory procedure is judged complete (pass only). The six unconcluded ones are reviewer judgement calls, not a reporting fault.

## Patch 17: "the subject does not exist" is not a finding (2026-10-25)

Fm-00048 (ESO, Patches 8-16 live): 85% completion on 133 planned procedures, locations down from 9 unusable to 2, mandatory wording split as intended. It also showed a side effect of the absence policy. 16 exploration procedures about toll roads, waste, PACE finance, feedstock, ADC facilities and similar were answered "No X subject matter exists anywhere in the workbook". The absence policy recorded each as a confirmed absence (P3 "Not present in the workbook"), which (a) added 16 irrelevant P3 findings (P3 count 13 -> 24) and (b) made the scope exclusion keep them, because it never removes a rule with a verdict. In Fm-00047 the same procedures were answered "not applicable to this model type", stayed uncertain, and were not reported.

| Change | Detail |
|---|---|
| `absence-policy.js` | An answer that says the "subject matter" does not exist, or that the mechanism "exists in this ... model", is a not-applicable answer. It stays uncertain, as the policy always intended. Genuine missing controls (change log, adjustments register) are still converted. |
| Tier A2 (regulated_network_utility) | Family tier for ppp, power, construction, feedstock and energy_efficiency procedures. Like the other family tiers it only removes a rule that returned an uncertain absence; a Pass or Issue, a fatal rule or a substantive finding keeps it in scope. |

Expected on a rerun of the same model: the 15 procedures leave the plan (about 118 planned), P3 findings fall back to about 8, completion about 82%. That is lower than 85% because the 85% included procedures that should never have counted.
T2-S10-369 (technical-to-financial bridge, a Query) and T2-S10-389 (correlated downside) are not family-matched and are unchanged.

## Patch 18: documentation requests, two fatal-gate procedures, review-depth label (2026-10-25)

Fm-00049 (ESO, Patches 8-17 live): 120 planned, 85% completion, 11 P3 findings (Patch 17 worked), locations clean, "Since last run" compares against Fm-00048 (112 deterministic items still open, 27 Tier 2 not found, 13 new). It also showed three things.

| Finding | Change |
|---|---|
| Critical Queries rose from 2 to 4. Two were "no adjustments register / overlay register found" (T2-S11-004 high, T2-S12-009 critical) at 30% confidence. In Fm-00047 they were Observations; in Fm-00049 the reviewer anchored them to a SystemOperator cell, which skipped the A1 rule and let them escalate on severity. | `record-type-classifier.js`: a T2 finding in a Documentation category at under 60% confidence is a Query, whatever the severity or anchor. A request for paperwork cannot misstate an output on its own. Fatal rules and anything at 60%+ are unchanged. |
| T2-S9-004 (returns from live cash flows, fatal gate) has come back uncertain in Fm-00047, 48 and 49, each time because the reviewer could not confirm what happens to figures outside the workbook, while saying the RoRE cells are live formulas. The rule had no skill text and was marked manual_only. T2-S8-005 (downside not suppressed, fatal) also had none. | `config/skill.md`: a decision procedure for each. Live formulas passes; typed numbers on an output sheet fail; external publication is out of scope and not a reason for uncertain; macro-written snapshot sheets are deliberate; a visible equity injection is a pass for a notional-gearing model, a floor or plug that hides the shortfall is a fail. `checklist.json`: T2-S9-004 manual_only false. |
| One batch of 60 results left the review_mode label off, so the report said only 52% of Tier 2 findings were grounded in formula text, when every batch was given the complete formula text. | `utils/review-mode.js`: on the full-parse route a missing or llm_only label is recorded as llm_full_parse. Labels the reviewer chose are kept. Curated route unchanged. |

Not changed: T2-S8-005 and T2-S9-004 can still end as Critical Queries if the reviewer is genuinely unsure; the aim is that they conclude when the formulas settle the question. The Critical Query cap for T2-S10-336 is still open.
