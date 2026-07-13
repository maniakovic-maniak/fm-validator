# Financial Model Validation — Methodology

## Step 1: Build model understanding before validating anything

Before checking any rule, read every sheet and build a complete
picture of how the model works.

Identify:
- Model purpose (project finance, corporate planning, M&A, fundraising)
- Key value drivers (what assumptions drive the largest outputs)
- Sheet dependencies (which sheets feed which)
- Timeline and periodicity (monthly, quarterly, annual)
- Currency and sign convention
- Whether this is a project finance, corporate, or deal model

Map the dependency chain:
```
Inputs → Operational schedules → Financial statements → Outputs
```

Never validate outputs before understanding what drives them.

---

## Step 2: Validate upstream before downstream

Always work from source assumptions toward outputs.

Order of validation:
1. Structural integrity (can I trust the file?)
2. Input assumptions (are the drivers reasonable?)
3. Calculation logic (do formulas work correctly?)
4. Financial statement integration (do the three statements reconcile?)
5. Outputs and returns (are the results plausible?)

If upstream validation fails, downstream results are unreliable.
Do not report downstream findings as confirmed until upstream is clean.

---

## Step 3: Cross-sheet reasoning

Do not evaluate sheets independently.
Every sheet connects to others. Trace the full chain.

Standard dependency chain:
```
Inputs → Timing → Ops → Revenue
Revenue → EBITDA → Tax → NPAT
NPAT → Retained Earnings → Balance Sheet
EBITDA → CFADS → Debt Service → DSCR
Capex → PP&E → Depreciation → Balance Sheet
Debt → Interest → P&L → Cash Flow
Cash Flow → Closing Cash → Balance Sheet
Cash Flow → Waterfall → DSRA → Distributions
```

When you find an issue on one sheet, check whether it propagates
to connected sheets before reporting it.

A single broken link can cause cascading errors across five sheets.
Identify the root cause — not the symptoms.

---

## Step 4: Contradiction detection

Actively look for internal contradictions.

Common contradictions to check:
- Revenue growth inconsistent with production volume growth
- EBITDA improving while cash flow deteriorates
- Debt increasing despite strongly positive free cash flow
- Capex continuing at full rate after project completion
- Working capital improving while receivables days are rising
- IRR improving while NPV is declining
- Tax rate changing without a documented reason
- Margins expanding without a corresponding assumption change
- DSCR improving while cash available for debt service is declining
- Distributions paid while DSRA is underfunded

When a contradiction is found, report both sides and their
financial impact. Do not flag only one side.

---

## Step 5: Evidence gathering

Every finding must include four elements:

1. Observation — what you found
2. Evidence — where specifically (sheet, cell, period)
3. Impact — financial consequence in dollar or percentage terms
4. Recommendation — what should be done to fix it

Do not report a finding without all four elements.
Do not report unsupported concerns.

Example of a correctly evidenced finding:
- Observation: Segment revenues do not sum to total revenue
- Evidence: Cons sheet row 42, columns D through P, Q3 2027 onwards
- Impact: Total revenue understated by approximately $4.2M in year 3
- Recommendation: Review Cons sheet revenue aggregation formula in row 42

---

## Step 6: Materiality assessment

Classify every finding by priority level.

| Priority | Definition |
|---|---|
| P1 | Needs to be addressed before the model is relied on for key decisions. Examples: balance sheet does not balance, formula error in key output, debt roll-forward fails |
| P2 | Should be addressed as part of the current review or before external circulation. Examples: assumption materially outside benchmark, missing required schedule, hard-coded business assumption |
| P3 | Lower-priority clean-up, presentation, documentation or good-practice improvement. Examples: formatting issue, missing label, non-material assumption gap |

Prioritise P1 findings first.
Do not bury P1 items in a long list of P3 observations.

---

## Test methodology — how to perform each test

### test: balance_sheet_balances
Look for a check row in AFS or IFS labelled Balance sheet check,
BS check, or Assets minus L&E.
- If visible and showing zero for all periods → pass, confidence 95+
- If non-zero → fail, state the dollar amount and period
- If no check row visible → uncertain, state what is missing

### test: cashflow_reconciliation
Look for a cash reconciliation check row in AFS, IFS, or Cons.
Change in balance sheet cash must equal operating + investing + financing CF.
- If check row shows zero residual → pass, confidence 95+
- If non-zero residual → fail, state the dollar amount and period
- If no check row visible → uncertain

### test: debt_rollforward
For each facility visible in the Debt sheet:
Opening + draws + capitalised interest + FX effects
- scheduled amortisation - voluntary prepayments - fee amortisation
= closing balance

Check the arithmetic for visible periods.
Also check: no negative debt balances, no amortisation beyond maturity.
- If identity holds → pass
- If closing does not equal opening plus net movements → fail with
  facility name, period, and estimated dollar discrepancy

### test: retained_earnings_rollforward
Opening retained earnings + net income - dividends = closing retained earnings.
Look for this roll-forward in AFS or Equity sheet.
- If arithmetic correct for visible periods → pass
- If clear discrepancy → fail with estimated dollar variance
- If roll-forward not visible → uncertain

### test: equity_reconciliation
Share issues, buybacks, and other equity movements must appear in
both the balance sheet equity section and financing activities.
- If movements match across both locations → pass
- If movement appears in one but not the other → fail, identify item
  and estimated dollar amount

### test: working_capital_reconciliation
Changes in receivables, payables, inventory on the balance sheet
must equal corresponding movements in operating cash flow.
No unexplained residual or catch-all other line.
- If consistent across both locations → pass
- If mismatch or large unexplained adjustment → fail with dollar estimate

### test: no_impossible_balances
Scan for: negative inventory, negative gross PP&E (not net),
negative trade receivables, negative trade payables where not
explicitly modelled as credit balances.
- If none found → pass
- If found → fail, identify specific line item, period, and dollar amount

### test: tax_reconciliation
Calculate effective tax rate from visible NPBT, tax expense, and NPAT rows.
Compare against statutory rate for the jurisdiction.
- If rate is reasonable and connected to taxable profits → pass
- If rate is zero with positive taxable profits → fail
- If rate appears disconnected from P&L → fail, state calculated rate

### test: margin_plausibility
Do NOT apply fixed percentage thresholds. Instead:
1. Look for historical periods in the model — compare current margins
   to historical averages
2. If no historical data, assess whether margins are internally consistent
   (variable costs move with volume, fixed costs are stable)
3. Flag extreme values (negative EBITDA in operations phase, or margins
   that imply the business generates cash with no costs) as uncertain
4. Never fail a model solely because a margin falls outside a generic range
- Assign confidence based on how much supporting data you can see

### test: return_metrics_plausible
Check Dashboard for IRR, NPV, DSCR, LLCR values.
- Assess whether returns are consistent with the risk profile described
  in the model purpose and inputs
- Flag as uncertain if returns appear implausibly high without a
  corresponding high-risk assumption set
- Fail only if returns are clearly mathematically impossible
  (negative NPV at zero discount rate, negative IRR with positive cash flows)
- Always state the specific values found in the reason

### test: cash_waterfall
For project finance models, the cash waterfall must follow the sequence:
Revenue → O&M costs → Taxes → Debt service → Reserve accounts → Distributions

Check in the Cons or IFS sheet whether:
1. Post-debt-service cash is correctly calculated
2. Distributions only occur after all senior obligations are met
3. Cash sweep logic directs excess cash to debt pay-down under defined conditions
- If sequence is visible and correct → pass
- If distributions appear before debt service → fail
- If waterfall not visible in extract → uncertain

### test: cash_sweep
Look for cash sweep and lock-up logic in the Debt or Cons sheet.
Under covenant breach, distributions should be blocked and excess
cash directed to debt pay-down or trapped in reserves per term sheet.
- If sweep logic is visible and appears correctly structured → pass
- If distributions continue under apparent covenant breach → fail
- If insufficient data → uncertain

### test: dsra_reconciliation
Check that Debt Service Reserve Account (DSRA) correctly:
1. Sizes to required coverage (typically 6 months debt service)
2. Funds from project cash flow before distributions
3. Releases when no longer required
4. Ties to both cash flow statement and balance sheet
- If visible and reconciling → pass
- If DSRA balance on balance sheet does not tie to cash flow → fail
- If DSRA not modelled → uncertain, note this is a significant omission
  for project finance

### test: capacity_constraints
Check Ops sheet production volume assumptions.
Volumes must not exceed modelled capacity in any period.
- Look for capacity constraint rows or utilisation percentages
- If production is within installed capacity for all visible periods → pass
- If production clearly exceeds stated capacity without a corresponding
  capacity expansion event → fail with the period and excess amount
- If capacity is not disclosed → uncertain

### test: revenue_price_volume
Revenue lines must be traceable to price and volume drivers.
- Check whether Ops sheet contains production volume rows
- Check whether Inputs sheet contains price assumptions
- Verify that revenue on Cons or IFS appears to be volume × price
- If clear price × volume calculation is driving revenue → pass
- If revenue appears as a standalone block not connected to drivers → fail
- If data does not include both Ops and Cons → uncertain

### test: cost_classification
Fixed versus variable cost classification must be sensible.
- Variable costs should increase proportionally with volume
- Fixed costs should be stable unless a driver event is documented
- If visible cost rows behave as expected → pass
- If variable costs are flat while production changes significantly → uncertain
- If fixed costs spike without a documented driver → fail

### test: inputs_centralised
All business assumptions must be on Input or Assumption sheets only.
- Check the Inputs sheet extract for labelled rows with values
- If Inputs sheet shows clearly labelled rows with values → pass
- If numeric constants appear in calculation sheets that never change
  across periods → flag as potential hard-codes, return uncertain
- If no Inputs sheet exists → fail

### test: no_hardcodes
Business assumptions must not be hard-coded in formula areas.

Check `workbookStats.totalHardcodes` in the payload — a workbook-wide
count of formula cells containing hardcoded numeric literals, computed
directly from formula text (Tier 0). This is a real, aggregate signal,
not an estimate — use it.

- If `totalHardcodes` is 0 or very low relative to `totalFormulaCells`:
  pass, confidence 70-85. State the ratio as evidence.
- If `totalHardcodes` is high relative to `totalFormulaCells` (a rough
  guide, not a hard threshold — judge against the model's own scale):
  fail or flag, confidence 70-85, citing the aggregate count as evidence
  of widespread hardcoding. State the count.
- You still cannot identify WHICH specific cells are hardcoded, or
  whether each individual instance is a genuine assumption embedded in
  a formula (a real issue) versus a legitimate fixed constant (a unit
  conversion, a statutory rate — not an issue). Do not name a specific
  cell as the finding location unless you can see it directly in the
  row data provided; cite the sheet/cell you can see plus the aggregate
  count as corroborating context, or use "A1" with the aggregate
  reasoning in `condition` if no single cell is visible.
- If `workbookStats` is empty or `totalHardcodes` is absent: fall back
  to manual_only, uncertain, confidence 30, stating formula text
  inspection is required — the same as before.

### test: no_duplicated_logic
No calculation should appear in more than one sheet.
This is a manual_only test.
- Return uncertain with confidence 30
- State: "Duplicate calculation detection requires formula text
  inspection across all sheets. Cannot verify from summary data."

### test: no_mixed_periodicity
A single sheet should not mix monthly, quarterly, and annual
calculation logic without explicit aggregation lines.
- Look for column headers in the extract — if they show consistent
  periodicity labels across all visible sheets → pass
- If headers suggest mixing of periods on same sheet → uncertain
- This cannot be fully verified from row data alone

### test: historical_reconciliation
Historical financial statements must reconcile to source documents.
- Look for reconciliation tables in the data extract
- If reconciliation rows are visible and tie out → pass
- If historical data rows exist but no reconciliation table → uncertain
- If no historical data is visible → uncertain, note the omission

### test: historical_data_current
Check whether historical data appears current relative to the model start date.
- Look for the most recent historical period in the data extract
- If historical data appears recent (within 12-18 months of model date) → pass
- If data appears significantly outdated → uncertain, flag for verification
- If no dates are visible → uncertain

### test: single_source_assumptions
Key assumptions (company name, currency, WACC, tax rate, key dates)
should each appear once on the Inputs sheet.
- If these are visible on the Inputs sheet → pass
- You cannot confirm single-source referencing from row data alone
- If the same value appears on multiple sheets independently → uncertain

### test: master_timeline
All time-series sheets should reference a single master timeline.
- Check whether a Timing sheet exists in the sheet names list → positive signal
- If column headers appear consistent across sheets in the extract → pass
- If headers differ between sheets → uncertain

### test: no_hidden_sheets
Hidden sheets cannot be detected from summary data.
Always return uncertain with confidence 30.
State: "Cannot detect hidden or very hidden sheets from summary data.
Requires direct workbook inspection in Excel."

### test: model_extendable
Confirm model can be extended without formula rewrites.
This is a manual_only test.
Return uncertain with confidence 30.
State: "Model extensibility requires direct formula inspection.
Cannot verify from summary data whether adding periods or facilities
would require formula rewrites."

### test: no_volatile_functions
OFFSET, INDIRECT, and volatile array functions in core logic
create fragile dependencies.
This is a manual_only test.
Return uncertain with confidence 30.
State: "Volatile function detection requires formula text inspection.
Cannot verify from summary data."

### test: fast_principles
FAST principles require short, transparent formulas.
This is a manual_only test.
Return uncertain with confidence 30.
State: "FAST principle compliance requires formula text inspection.
Cannot verify from summary data."

### test: single_formula_per_row
Formula consistency per row requires formula text inspection.
This is a manual_only test.
Return uncertain with confidence 30.
State: "Formula consistency per row cannot be verified from summary
data values. Requires direct cell inspection in Excel."

### test: no_circular_references
Native Excel circular references (iterative calculation) cannot be
detected from row data alone — that part remains manual_only.

But check `vbaSummary` in the payload first. If `vbaSummary.hasVbaProject`
is true and `vbaSummary.findingSummary` contains an entry starting with
`T0-VBA-005` (calculation-integrity — VBA that manipulates Excel's
calculation engine, forces recalculation, or performs manual iterative
solving), this is direct, real evidence the model works around
circularity via a macro rather than Excel's native iterative
calculation:
- Report this as a finding (not manual_only/uncertain) — confidence
  70-85, citing the specific `T0-VBA-005` finding text as evidence.
  State that the model's calculation may depend on this macro being run
  correctly, and that its convergence logic cannot be verified from
  cell values alone.
- This does NOT mean native Excel circularity is absent — a model can
  have both. Note this distinction explicitly rather than treating the
  VBA finding as a complete answer to the test.

If `vbaSummary` shows no VBA project, or no `T0-VBA-005` finding, or
`vbaSummary` itself is absent: fall back to manual_only, uncertain,
confidence 30, stating "Circular reference detection requires Excel
iterative calculation check" — the VBA-scan half of the original
reasoning is now covered by the check above, so don't repeat it here.

### test: unit_consistency
Unit conversion errors (monthly vs annual rates, MW vs kW) require
formula text and header inspection.
This is a manual_only test.
Return uncertain with confidence 30.
State: "Unit consistency requires formula text inspection.
Look for explicit unit labels on all input rows."

### test: lookup_integrity
VLOOKUP, HLOOKUP, INDEX/MATCH function integrity requires formula inspection.
This is a manual_only test.
Return uncertain with confidence 30.
State: "Lookup function integrity requires formula text inspection."

### test: sign_convention
From the data extract, check Cons and IFS sheets.
Revenue rows should be positive.
Cost rows should be consistently negative or positive with subtraction applied.
- If convention is consistent across visible rows → pass
- If a line item sign appears inconsistent with its economic nature → fail
  with the specific row and sheet

### test: covenant_definitions
DSCR = CFADS ÷ scheduled debt service
LLCR = NPV of future CFADS ÷ outstanding debt balance
- Check Debt sheet for covenant calculation rows
- If visible and correctly structured → pass
- If numerator or denominator appears inconsistent with standard definitions → fail

### test: capex_links
Capex from the schedule must appear consistently in:
1. PP&E additions on balance sheet (AFS)
2. Investing activities in cash flow statement (Cons)
- If values appear consistent across all three for visible periods → pass
- If Capex appears in one location but not others → fail with dollar estimate

### test: scenario_central_control
Look for a scenario selector cell on the Inputs or Dashboard sheet.
- If clearly labelled scenario control is visible → pass
- If scenario assumptions appear independently set across multiple sheets → fail
- If unclear → uncertain

### test: sensitivity_directions
Check Sensitivity Analysis sheet.
Increasing price → increases revenue, EBITDA, NPV
Increasing opex → decreases EBITDA
Increasing capex → decreases IRR and NPV
- If directions are correct for visible sensitivities → pass
- If any sensitivity produces a counter-intuitive result → fail
  with the specific item and the contradiction

### test: zero_revenue_test
Setting main revenue drivers to zero should produce:
- Zero revenue
- Logical shutdown of variable costs
- No error explosions (#REF, #DIV/0 etc.)
- A structurally intact and balanced model
- If the model appears structured to handle zero revenue cleanly → pass
- If revenue rows appear to have fixed floor values that would not
  reach zero → uncertain
- If formula errors would likely cascade → fail

### test: date_edge_cases
This is a manual_only test.
Return uncertain with confidence 30.
State: "Date and period edge case testing requires direct model
manipulation. Cannot verify from summary data."

### test: checks_sheet_exists
Look for a Checks, Audit, or Controls sheet in the sheet names list.
- If present with PASS/FAIL flags visible → pass
- If present but no flags visible → uncertain
- If absent → fail

### test: change_log_exists
Look for a cover sheet, README, or Change Log tab in sheet names.
- If present with dated entries → pass
- If exists but appears empty → uncertain
- If absent → fail

### test: independent_review_documented
Look for evidence of peer or independent review on cover sheet or change log.
- If review is documented with date and scope → pass
- If cover sheet exists but no review evidence → uncertain
- If no cover sheet or change log exists → uncertain

### test: purpose_documented
Check Dashboard or cover sheet for model purpose documentation.
- If purpose, audience, and reliance level are visible → pass
- If no cover sheet in extract → uncertain

### test: dashboard_kpis
Check Dashboard for core KPIs: revenue, EBITDA, cash, leverage,
coverage, IRR, NPV, scenario comparisons.
- If core metrics are visible → pass on presence
- Pasted values vs live links cannot be verified from row data → note as uncertain
  on link integrity

### test: cover_sheet_complete
Check sheet names for cover sheet, README, Introduction, or About tab.
- If present with purpose, version, author, date, structure overview → pass
- If exists but sparse → uncertain
- If absent → fail

### test: output_readability
This is a manual_only test.
Return uncertain with confidence 30.
State: "Output readability requires visual inspection of the workbook.
Cannot verify print areas, fonts, or cut-off tables from summary data."

### test: simplifications_documented
Look for a simplifications or limitations section on the cover sheet or Inputs.
- If present and appears comprehensive → pass
- If cover sheet exists but no limitations section → uncertain
- If no cover sheet → uncertain

### test: deferred_tax_disclosed
Check AFS balance sheet extract for deferred tax line items.
- If deferred tax balance exists with reconciliation visible → pass
- If deferred tax balance exists but no reconciliation → fail
- If deferred tax is zero and a simplification note is visible → pass
- If deferred tax is zero with no disclosure → uncertain

### test: no_calcs_on_outputs
Formula origins cannot be verified from row data alone.
This is a manual_only test.
Return uncertain with confidence 30.
State: "Whether financial statement sheets contain original calculations
or only reference links requires formula text inspection."

---

## Step 7: Handling manual_only rules

When a checklist rule is marked manual_only: true:
- Do not attempt to infer results from summary row data
- Return status: uncertain
- Confidence: 30
- Reason: use the exact statement from the test methodology above
- Do not fabricate a result

---

## Step 8: Handling uncertain results

Return uncertain only when ALL of the following are true:
1. You have genuinely attempted to assess the rule
2. The specific data needed is not present in the extract
3. You can clearly state what data would be needed
4. Confidence is below 60

When returning uncertain, always include:
- What data is present and what it shows
- What specific data is missing
- What you would need to see to make a definitive assessment

Do not use uncertain as a default when data is ambiguous.
Ambiguous data with strong circumstantial evidence should be
classified as fail with a lower confidence score (60-79).

---

## Step 9: Escalation logic

If evidence is genuinely insufficient after following all steps:
- Do not fail the validation
- Mark as uncertain with confidence below 60
- State precisely what additional information is required
- Do not guess

If multiple uncertain results cluster around the same area
(e.g. all Section 5 rules returning uncertain), this is itself
a finding: the data extract does not contain sufficient financial
data to validate that section — escalate for manual review.

---

## Step 10: Shadow modelling — reconstruct key outputs independently

Shadow modelling means independently re-deriving a key output from first
principles using only the raw data visible in the extract, without relying
on the model's own calculation cells.

When to apply shadow modelling:
- IRR, NPV, equity multiple — recalculate from visible cash flow rows
- DSCR — recalculate from visible CFADS and debt service rows
- Revenue — recalculate from visible price and volume rows
- Tax — recalculate from visible taxable income at statutory rate
- Balance sheet check — re-add visible assets and liabilities independently

How to apply:
1. Identify the output cell the model claims (e.g. IRR = 18.4%)
2. Locate the underlying driver rows in the data extract
3. Apply the standard formula independently using those values
4. Compare your result to the model's stated result
5. If the difference exceeds 2%: flag as fail with both values shown
6. If the difference is within 2%: pass with note that shadow check passed
7. If insufficient data for shadow check: return uncertain

Shadow modelling confidence caps:
- Full shadow check completed: confidence up to 95
- Partial shadow check (some periods only): confidence up to 75
- Shadow check not possible (insufficient data): confidence up to 45

---

## Step 11: Contradiction pattern detection

Actively search for these 12 contradiction patterns across all findings.
A contradiction is where two observable facts cannot both be true.
Contradictions are higher-confidence findings than single-point issues.

**Pattern 1 — Revenue-volume disconnect**
Revenue grows but production volume is flat or declining.
Check: does revenue growth rate match price × volume growth?

**Pattern 2 — EBITDA-cashflow divergence**
EBITDA improves materially year-on-year but operating cash flow
deteriorates or is flat. Suspect: working capital absorbing cash,
accrual manipulation, or EBITDA plug.

**Pattern 3 — Debt-cashflow contradiction**
Debt increases despite positive free cash flow in the same period.
Suspect: distributions being paid before debt repayment, or debt
drawdown not linked to actual funding need.

**Pattern 4 — Tax-profit disconnect**
Tax expense is flat or zero despite growing taxable profit.
Or effective rate deviates more than 5% from statutory rate
without explanation.

**Pattern 5 — Margin improvement without driver**
EBITDA margin improves by more than 5 percentage points in a single
year without a documented assumption change on the Inputs sheet.

**Pattern 6 — Capex-depreciation mismatch**
Depreciation grows materially but no corresponding capex or asset
addition is visible. Or capex is large but depreciation is flat.

**Pattern 7 — Covenant-cashflow contradiction**
Model shows covenant compliance (DSCR > threshold) but cash flow
available for debt service appears insufficient from visible rows.

**Pattern 8 — Equity-distribution contradiction**
Distributions are paid in periods where retained earnings are
negative or declining.

**Pattern 9 — Working capital-revenue disconnect**
Revenue grows materially but receivables are flat or declining.
Or costs grow but payables are flat. Suspect: working capital
not modelled dynamically.

**Pattern 10 — Sensitivity-base contradiction**
Sensitivity output at base case assumption does not match base
case model output for the same metric.

**Pattern 11 — IRR-cashflow contradiction**
Stated IRR is not achievable from visible cash flow profile.
Apply shadow IRR check using visible investor cash flows.

**Pattern 12 — Terminal value dominance**
More than 70% of NPV or equity value derives from terminal value
or exit proceeds. Flag as uncertain — terminal value assumptions
are not verifiable from periodic cash flows.

When you identify a contradiction:
- Report it as a single finding with both contradicting facts stated
- Set contradiction_links field to the IDs of related findings
- Increase confidence by up to 15 points vs a single-point finding

---

## Step 12: Review gate logic

These are key review checkpoints. When a gate test identifies an issue,
apply the following logic:

**Gate 1 — Balance sheet does not balance**
- Raise as P1 with specific sheet, cell, period, and dollar amount
- Label downstream equity, leverage, and return metrics as provisional
- Add "Provisional — pending balance sheet correction" to affected findings

**Gate 2 — Cash flow does not reconcile**
- Raise as P1 with specific reconciling difference and period
- Note that operating, investing, and financing classifications need review
- Label DSCR, distributions, and return metrics as provisional

**Gate 3 — Debt roll-forward does not close**
- Raise as P1 with specific facility, period, and closing balance difference
- Note that debt metrics and covenant tests should be treated as provisional

**Gate 4 — Formula errors present**
- Raise each error cell as a separate P1 finding
- Note downstream cells affected by the error
- State what the correct formula or reference should be

**Gate 5 — Workbook does not open cleanly**
- Raise as P1 — workbook integrity cannot be confirmed
- Note that further testing may be unreliable until this is resolved

**Cascading logic:**
When a gate issue is found, add "Provisional — pending correction of [gate issue]"
to the reason field of all findings that depend on the affected output.

---

## Step 13: Tool-aware execution rules

Your behaviour changes based on what data is available.

**Mode A — Cell values only (current default)**
- Formula text is NOT available
- You can see: row labels, numeric values, sheet structure
- You cannot verify: formula logic, hardcodes, circular refs, volatile functions
- Confidence cap for formula-dependent tests: 45
- For formula-dependent tests: always return uncertain with specific data request

**Mode B — Cell values + formula text**
- Formula text IS available (future capability)
- You can verify: hardcodes, formula consistency, circular refs
- Confidence cap removed for formula tests
- Apply formula text inspection methodology for all formula tests

**Mode C — Cell values + source documents**
- Source documents available (future capability)
- You can verify: assumption support, historical reconciliation
- Apply document cross-reference methodology for evidence tests

**Always state your mode in the review_mode field:**
- `llm_only` — Mode A (current default)
- `llm_with_formulas` — Mode B
- `llm_with_documents` — Mode C
- `llm_with_formulas_and_documents` — Mode B + C

**Mode A confidence caps by test type:**

| Test type | Max confidence in Mode A |
|---|---|
| Balance sheet check (from check row) | 95 |
| Cash flow reconciliation (from check row) | 95 |
| Debt roll-forward (from visible rows) | 85 |
| Revenue = price × volume | 85 |
| Margin plausibility | 80 |
| Assumption support | 60 |
| Formula consistency | 40 |
| Hardcode detection | 35 |
| Circular reference detection | 20 |

---

## Step 14: Materiality assessment

Not every finding deserves the same urgency. Apply materiality assessment
before assigning severity and urgency.

**Quantitative materiality tests:**
- Does the issue affect a line that represents more than 5% of total revenue?
- Does the issue affect a line that represents more than 5% of total assets?
- Does the issue change NPV or IRR by more than 1 percentage point?
- Does the issue trigger or potentially trigger a covenant breach?
- Does the issue affect the funding gap or residual equity requirement?

If any quantitative test is met: severity is at minimum high.

**Qualitative materiality tests:**
- Would a lender, investor, or board member change their decision if aware?
- Is the issue in a key output line (IRR, NPV, DSCR, equity multiple)?
- Does the issue affect the stated reliance purpose of the model?
- Does the issue mask a real defect or suppress a real risk?
- Is the issue pervasive — affecting multiple sheets, periods, or outputs?

If any qualitative test is met: severity is at minimum medium.

**Covenant trigger test:**
If the issue, when corrected, would cause a covenant metric to fall
below its threshold in any period, set:
- priority: P1
- needs_retest: true
- note in consequence: "Covenant metric may be affected — needs retest after correction"

**Decision-use test:**
If the issue, when corrected, would materially change a key output
used in decision-making (IRR, NPV, DSCR, equity return), set:
- priority: P1
- needs_retest: true
- note in consequence: "Key output affected — needs retest after correction" 

---

## Step 15: Upstream-first validation protocol

Always validate in this order within each section:

1. Validate inputs and assumptions first
2. Validate calculation logic second
3. Validate outputs and summaries last

If an upstream input is wrong, do not independently validate every
downstream output that uses that input. Instead:
- Report the upstream failure as the primary finding
- Add a single downstream note: "Downstream outputs using [input] are
  provisional pending correction of [upstream finding ID]"
- Do not create separate findings for each downstream symptom of the
  same upstream cause

This prevents finding count inflation and focuses remediation on root causes.

**Dependency chain for upstream-first protocol:**

```
Inputs (price, volume, rate, date) → Revenue
Revenue → Gross profit → EBITDA
EBITDA → Operating cash flow → CFADS
CFADS → DSCR → Covenant compliance → Distribution capacity
CFADS → IRR / NPV / Equity multiple
Balance sheet items → Gearing → LVR
```

If an upstream node fails: all downstream nodes are provisional.

---

## Test methodologies for new v6 checklist rules

### test: accounting_basis_documented
Look for documentation of the accounting basis on the cover sheet or Inputs sheet.
Check for: accrual vs cash basis statement, reporting framework (IFRS, AASB, management accounts).
If present and clear: pass. If absent: flag as uncertain with recommendation to add.

### test: opening_balances_reconcile
Look for a reconciliation table showing opening balance sheet ties to latest audited accounts.
Check whether opening period balances match values that would be expected from disclosed actuals.
If a reconciliation reference exists: pass. If opening balances appear inconsistent with stated history: fail.

### test: chart_of_accounts_mapping
This test requires formula or GL access — cannot be verified from cell values alone.
Always return uncertain: "Chart of accounts mapping requires access to GL structure or formula links."

### test: balance_sheet_rollforward
Look for roll-forward rows for major balance sheet accounts: PP&E, debt, retained earnings, working capital.
Check if opening + movements = closing for visible periods.
If roll-forwards are visible and appear to close: pass. If gaps or discontinuities visible: fail.

### test: opening_equals_prior_closing
Check each balance sheet account: does the opening balance in period N equal the closing balance in period N-1?
If discontinuity visible in any material account: fail with sheet, account row, and period.
If continuous across all visible periods: pass.

### test: npat_to_retained_earnings
Check whether NPAT from the IFS flows to retained earnings on the AFS.
Look for retained earnings opening + NPAT - distributions = closing in visible rows.
If the arithmetic closes: pass. If retained earnings appears disconnected from NPAT: fail.

### test: cashflow_derived_not_hardcoded
This test requires formula access — cannot be verified from cell values alone.
Return uncertain: "Cash flow derivation from P&L requires formula inspection to verify."

### test: closing_cash_once
Look for a closing cash row on the AFS or Cons sheet.
Check whether closing cash appears to be calculated as opening + net movement.
If cash is calculated consistently: pass. If multiple independent cash figures visible: flag as uncertain.

### test: working_capital_detail
Look for separate receivables, payables, accruals, and prepayments rows on the balance sheet.
If only a single "working capital" line exists with no breakdown: flag as uncertain.
If separate components are visible: pass.

### test: revenue_recognition_accounting
Look for deferred revenue or contract liability rows on the AFS balance sheet.
If the model type typically requires revenue deferral and no deferred revenue balance exists: flag as uncertain.
If deferred revenue exists and appears linked to revenue recognition: pass.

### test: cost_accrual_basis
Look for accrued expenses and prepaid costs rows on the AFS balance sheet.
If no accruals or prepayments exist for a model with material timing differences: flag as uncertain.
If accruals are visible and appear to move with costs: pass.

### test: capex_wip_classification
Look for WIP or capital work in progress rows on the AFS balance sheet.
Check whether capex flows to PP&E or WIP during construction and transfers to completed assets at commissioning.
If classification appears correct: pass. If capex flows directly to P&L expense: fail.

### test: da_schedule_reconciliation
Look for D&A rows on both the IFS and the PP&E roll-forward on the AFS.
Check whether depreciation on the IFS matches the sum of depreciation charges in the PP&E schedule.
If they appear consistent: pass. If materially different: fail with both values.

### test: tax_full_reconciliation
Look for current tax, deferred tax, and cash tax rows.
Check whether P&L tax expense = current tax + deferred tax movement.
Check whether cash tax paid appears in operating cash flows.
If the reconciliation closes: pass. If tax appears only as a single unexplained P&L line: flag as uncertain.

### test: indirect_tax_rollforward
Look for GST payable, withholding tax, and payroll tax liability rows on the AFS.
Check whether they roll forward and settle through cash flows at appropriate frequencies.
If present and rolling: pass. If absent for a model with material indirect tax: flag as uncertain.

### test: debt_interest_classification
Look for capitalised interest rows during construction periods.
Check whether capitalised interest flows to the debt balance or PP&E, not to the P&L interest expense line.
If capitalised interest appears in P&L during construction: fail. If correctly capitalised: pass.

### test: equity_flows_correct
Look for equity contribution rows and confirm they appear in financing activities on the Cons.
Check whether distributions reduce retained earnings and appear in financing activities.
If equity flows appear correctly classified: pass. If contributions appear in operating activities: fail.

### test: no_accounting_plugs
Look for rows labelled "Adjustment", "Plug", "Balancing item", "Rounding", or "Other" with variable values.
If any such row exists with material values: fail with sheet and row label.
If no plugs visible: pass.

### test: balance_sheet_tolerance
Look for a balance sheet check row showing the residual.
If the residual is non-zero, assess whether it is within an immaterial threshold (less than 0.01% of total assets).
If residual is material: fail. If immaterial and documented: pass.

### test: sign_convention_accounting
Look for consistency of sign conventions across P&L, balance sheet, and cash flow.
Check whether costs are consistently negative or positive, whether liabilities are consistently signed.
If conventions appear mixed: flag as uncertain with specific examples.

### test: accounting_classifications
Look for whether capex appears in investing activities and operating costs appear in operating activities.
If material items appear in the wrong section: fail with the specific item and its incorrect location.

### test: rollforward_audit_checks
Look for dedicated check rows for retained earnings, cash, debt, tax payable, and PP&E roll-forwards.
If check rows exist and show zero residuals: pass. If no check rows for material roll-forwards: flag as uncertain.

### test: actuals_cutover_documented
Look for an actuals cut-off date on the Inputs or Timing sheet.
If present and used to drive the actual/forecast flag: pass. If absent: flag as uncertain.

### test: actuals_forecast_flags_drive_formulas
Look for evidence that the actual/forecast flag drives formula switching on calculation sheets.
If the flag appears to control whether actual or forecast values are used: pass.
If no such mechanism is visible: flag as uncertain.

### test: actuals_source_reconciliation
This test requires source document access — cannot be verified from cell values alone.
Return uncertain: "Actuals reconciliation requires access to trial balance or management accounts."

### test: manual_actuals_documented
This test requires access to an adjustments register — cannot be verified from cell values alone.
Return uncertain: "Manual actuals adjustments require access to source documentation."

### test: forecast_starts_after_cutover
Look for whether forecast formulas begin exactly one period after the actuals cut-off.
If the transition appears clean and no actuals period shows forecast values: pass.
If forecast logic appears to apply to actuals periods: fail.

### test: forecast_opening_equals_actual_closing
Look for whether the first forecast period opening balance equals the last actual closing balance.
If a clean transition is visible with no discontinuity: pass. If opening forecast balances reset unexpectedly: fail.

### test: imported_data_integrity
This test requires access to import logs or source data — cannot be verified from cell values alone.
Return uncertain: "Imported data integrity requires access to source system exports."

### test: source_document_references
Look for a source reference table or notes on the Inputs sheet showing data source and extract date.
If present: pass. If absent and the model uses external data: flag as uncertain.

### test: commercial_completeness
Look for any material revenue streams, cost categories, or funding sources that appear absent.
Use the domain skill context to identify what would normally be expected for this model type.
If no obvious gaps: pass. If a standard revenue or cost category for this industry appears absent: flag as uncertain.

### test: lifecycle_phases_complete
Look for whether all relevant lifecycle phases are modelled: acquisition, construction, operations, exit.
Check timing rows for phase labels or flags. If all expected phases are present: pass.
If a material phase appears absent without explanation: flag as uncertain.

### test: timing_completeness
Look for lead time assumptions, payment term rows, and commissioning period flags on the Inputs or Timing sheet.
If timing assumptions appear comprehensive: pass. If revenue appears to start immediately with no ramp-up: flag as uncertain.

### test: contractual_terms_modelled
This test requires access to legal documents — cannot be fully verified from cell values alone.
Check whether the Inputs sheet references key contractual terms. Return uncertain if no references visible.

### test: non_recurring_costs
Look for transaction cost, legal fee, stamp duty, or setup cost rows in the model.
If present: pass. If absent for a model with a clear transaction or development phase: flag as uncertain.

### test: lifecycle_capex_included
Look for maintenance capex, replacement capex, or lifecycle capex rows in long-term periods.
If present and appearing in later model years: pass. If capex drops to zero after construction: flag as uncertain.

### test: contingencies_modelled
Look for a contingency row in the cost build. Check whether it is applied as a percentage of hard costs.
If present and clearly linked to cost base: pass. If absent or below 3% of construction costs: flag as uncertain.

### test: recurring_overheads
Look for insurance, rates, utilities, and compliance cost rows in the operating cost build.
If present with escalation: pass. If absent for a model with material physical assets: flag as uncertain.

### test: off_model_adjustments
This test requires access to an adjustments register — cannot be verified from cell values alone.
Return uncertain: "Off-model adjustments require access to a management overlay register."

### test: challenger_check
Look for a reasonableness or cross-check section on the Dashboard or in a separate Checks sheet.
If a cross-check exists comparing outputs to an independent method: pass.
If no cross-check exists: flag as uncertain with recommendation to add one.

### test: version_control
Look for a version control table on the cover sheet or a dedicated change log tab.
If present with version, date, author, and summary: pass. If absent: flag as uncertain.

### test: change_log_detail
Look for a change log that identifies specific changes — not generic entries.
If entries describe specific formula, assumption, or structural changes: pass.
If entries are generic ("updated model") or absent: flag as uncertain.

### test: calculation_settings
Excel's own calculation-mode setting (manual vs automatic) itself still
requires workbook property access and cannot be verified from cell
values alone for models with no VBA.

But check `vbaSummary` first, the same way as `no_circular_references`
above. If `vbaSummary.findingSummary` contains a `T0-VBA-005` entry
(calculation-integrity), this is direct evidence the model's VBA
manipulates calculation mode, forces recalculation, or performs manual
iterative solving — report as a finding, not manual_only, confidence
70-85, citing the specific finding text. State plainly that a reader
opening this file without running the macro may see different values
than one who does.

If no such VBA finding exists (with or without a VBA project at all):
fall back to uncertain, confidence 30: "Calculation mode and iterative
settings require workbook property inspection."

### test: macros_documented
Check `vbaSummary.hasVbaProject` first — this tells you definitively
whether the workbook contains a VBA project, closing the gap the old
version of this test couldn't resolve on its own ("if model appears to
use VBA" was previously something you had no reliable way to know).

- If `hasVbaProject` is false or `vbaSummary` is absent: this test does
  not apply — pass, confidence 90, state no VBA project was detected.
- If `hasVbaProject` is true: look for a macros or VBA section on the
  cover sheet or README tab in the row data you were given.
  - If present and it names all `vbaSummary.moduleCount` modules with
    their purpose: pass, confidence 80.
  - If absent, or documents fewer modules than `moduleCount` actually
    present: fail (not uncertain — you now have a definitive fact to
    report), confidence 80. State the module count found by the VBA
    scan versus what is documented.

### test: protection_allows_review
This test requires workbook access — cannot be fully verified from cell values alone.
Return uncertain: "Sheet protection status requires direct workbook inspection."

### test: named_ranges_current
Check `namedRangeSummary` in the payload first — Wave 1's named-range
audit already computed this deterministically (broken and unused named
ranges, counted directly from the workbook's defined names), and it's
included in this same payload. Use it rather than treating this as
unanswerable.

- If `namedRangeSummary.brokenCount` is 0 and `unusedCount` is 0 (or
  low relative to `totalNamedRanges`): pass, confidence 85-95. Cite the
  counts as evidence.
- If `brokenCount` > 0: fail, confidence 90+. Name the broken ranges
  from `brokenNames`. A broken named range is a definitive, structural
  fact, not something requiring further inspection.
- If `unusedCount` is high relative to `totalNamedRanges`: flag,
  confidence 70-85, citing the ratio. Note: a named range used only by
  VBA (check `vbaSummary`) would incorrectly appear here as unused,
  since the audit only traces worksheet formula references — if
  `vbaSummary.hasVbaProject` is true, mention this as a caveat rather
  than treating the unused count as fully reliable.
- If `namedRangeSummary` is absent or shows a `note` field instead of
  counts: fall back to uncertain, confidence 30: "Named ranges require
  Name Manager inspection to verify currency" — the same as before.

### test: instructions_complete
Look for an Instructions tab or instructions section on the cover sheet.
If present and covering model purpose, scenario controls, and output interpretation: pass.
If absent: flag as uncertain with recommendation to add.

### test: output_integrity
This test requires formula access to verify outputs are live references, not pasted values.
Return uncertain: "Output integrity requires formula inspection to confirm no manual overrides."

### test: review_status_documented
Look for a model issues register or review status section on the cover sheet or a dedicated tab.
If present with severity, owner, and status: pass. If absent: flag as uncertain.

### test: handover_ready
Look for personal file paths, broken link references, or unexplained warnings in visible data.
If no such indicators visible: pass with note that full verification requires opening in Excel.
If broken references are visible: fail with specific locations.

---

## Step 16: Deep accounting logic review

Go beyond "does the formula reconcile" — assess whether the accounting
treatment itself is sensible for the transaction being modelled.

**Depreciation and asset recognition**
- Is the depreciation method (straight-line, units-of-production,
  declining balance) appropriate for the asset type shown in the model?
- Does the depreciation rate or useful life look reasonable for the
  asset class (e.g. mining plant 10-20 years, mobile equipment 5-10 years)?
- Are assets recognised at the point they become available for use, not
  before (during construction) or after (once operational)?
- Is there a distinction between capitalisable costs and expensed costs
  during construction, or does everything flow to a single asset line?

**Liability classification**
- Are provisions (rehabilitation, warranty, employee entitlements)
  separately identified, or are they buried inside "other liabilities"?
- Is the current/non-current split applied to debt and provisions, or
  does the balance sheet show undifferentiated totals?
- Do liabilities that should accrue over time (rehabilitation, leave
  provisions) actually build up, or do they appear as a single lump sum?

**Revenue recognition**
- Does revenue recognise at the point control transfers (e.g. delivery,
  shipment) consistent with the business described in the model, or
  does it recognise on invoicing/cash receipt regardless of delivery terms?
- If there are multiple revenue streams (e.g. product sales plus
  by-product sales), is each recognised on its own appropriate basis?
- Are contract liabilities (deferred revenue) modelled where advance
  payments or prepaid contracts exist?

**Accounting standards consistency**
- Note the accounting framework stated in the model (if any) and check
  whether the treatments visible are broadly consistent with it.
- If no framework is stated, note this as a finding — the accounting
  basis should be documented.
- Where a treatment appears clearly inconsistent with standard practice
  (e.g. revenue recognised before delivery, provisions not discounted
  where materially long-dated), raise as a finding with the specific
  standard-based expectation cited in Criteria.

When you identify an accounting logic issue, use this to distinguish
it from a pure formula issue:
- **Formula issue**: the calculation doesn't do what it's supposed to do
  (wrong reference, broken link, inconsistent formula across periods)
- **Accounting logic issue**: the calculation does what it's supposed to
  do, but what it's supposed to do isn't appropriate accounting treatment

Both are valid findings but should be classified differently
(issue_type: "Accounting" for logic issues, "Formula error" or
"Formula inconsistency" for calculation issues).

---

## Step 17: Deep tax logic review

Do not stop at "is there a tax formula". Assess whether the tax
treatment makes sense.

**Taxable income build**
- Does the model build taxable income from accounting profit with
  adjustments (add back depreciation, deduct tax depreciation, add back
  non-deductible items), or does it simply apply a rate to accounting
  profit directly? The latter is a simplification that should be flagged
  if the model is used for anything beyond high-level screening.
- Are tax losses carried forward and utilised against future taxable
  income, or does the model show tax payable even in loss-making periods?

**Tax depreciation vs accounting depreciation**
- If the jurisdiction context is known (from model currency, location
  references, or explicit statements), does the tax depreciation
  treatment look broadly consistent with that jurisdiction's rules
  (e.g. accelerated depreciation, immediate write-off thresholds)?
- If tax and accounting depreciation are identical, note this as a
  simplification — most jurisdictions have some difference between the two.

**Effective tax rate**
- Calculate the effective tax rate (tax expense / accounting profit)
  for a sample of periods. If it deviates materially from the statutory
  rate without an explained reason (tax losses, permanent differences),
  flag as a finding.

**Royalty treatment (where applicable)**
- Is the royalty calculated on the correct base (revenue, profit, or
  volume depending on royalty type) and at the correct rate?
- Are royalties treated as a cost (reducing taxable income) or
  incorrectly treated as a tax itself?

**Deferred tax**
- If timing differences exist between accounting and tax treatment
  (e.g. different depreciation rates), is a deferred tax balance
  recognised, or is this omitted entirely?
- Deferred tax omission is common in simplified models — note it as a
  finding but assess materiality before setting priority. If the timing
  differences are small relative to model scale, this may be P3 rather
  than P1.

**Cash tax timing**
- Does cash tax paid in the cash flow statement reflect a realistic
  payment timing (e.g. quarterly instalments, prior-year-based
  provisional tax) rather than tax expense being paid in the same
  period it is incurred?

---

## Step 18: Deep commercial and project finance logic review

Some calculations are formula-correct but commercially illogical.
Actively look for these patterns.

**Cash sweep mechanics**
- Does excess cash actually sweep to debt repayment, or does the model
  show debt balances that never reduce despite positive free cash flow?
- Is the cash sweep percentage (if less than 100%) applied consistently,
  and does the remainder correctly flow to distributions or reserves?

**Construction funding sequencing**
- Does equity fund before debt, debt fund pro-rata with equity, or debt
  fund first? Confirm the drawdown sequence matches what is stated or
  implied elsewhere in the model (e.g. facility agreement references).
- Is interest during construction capitalised (added to the debt
  balance or asset cost) rather than expensed, consistent with
  standard project finance practice?

**Working capital realism**
- Do working capital assumptions (debtor days, creditor days, inventory
  days) look realistic for the industry, or are they zero/omitted
  (implying instant cash conversion, which is rarely realistic)?
- Does working capital scale with revenue/costs, or is it a fixed
  amount that doesn't respond to changes in the scale of operations?

**Royalty and revenue-sharing logic**
- If there are multiple parties entitled to a share of revenue or
  profit (royalty holders, joint venture partners, government take),
  are all entitlements captured, and does the residual to equity holders
  make sense after all deductions?

**Distribution logic**
- Are distributions blocked when debt service, tax, or reserve
  obligations are unmet (standard project finance practice)? Or does
  the model show distributions occurring regardless of these conditions?
- Is there a minimum cash balance or reserve requirement before
  distributions are permitted, and if so, is it enforced in the formulas?

**Project vs equity returns**
- Are project-level cash flows (before financing) and equity-level cash
  flows (after financing) clearly separated? A common commercial-logic
  error is blending the two, which produces a return metric that is
  neither.

When you identify a commercial logic issue, explain in Consequence what
about the underlying business or financing structure appears
inconsistent — not just what the formula does differently to expectation.

---

## Step 19: Debt review — real-world funding mechanics

Debt modelling frequently contains commercial-logic errors that are not
formula errors. Test explicitly for:

**Drawdown mechanics**
- Do drawdowns occur when funding is needed (matched to capex or
  working capital requirements), or are they front-loaded/back-loaded
  in a way that doesn't match the funding need?
- Is there an availability period after which undrawn amounts are
  cancelled, and does the model respect this?

**Repayment mechanics**
- Is the repayment profile (bullet, amortising, sculpted to cash flow)
  consistent with what's stated elsewhere in the model?
- If repayments are sculpted to a target DSCR, does the calculation
  actually solve for that target, or is it a static schedule that
  happens to be labelled as sculpted?

**Interest timing**
- Is interest calculated on the correct balance (opening, average, or
  closing) for the period, applied consistently throughout the model?
- Does interest capitalise during construction and switch to cash
  interest at completion, with the switch happening at the correct date?

**Fees**
- Are commitment fees charged on the undrawn facility balance, and do
  they reduce to zero once fully drawn or once the availability period ends?
- Are upfront/arrangement fees amortised over the facility life
  (effective interest method) rather than expensed immediately, if
  material?

**Cash sweep and DSRA**
- Is the Debt Service Reserve Account (DSRA) funded to the required
  level before first drawdown or distribution, and does it release
  correctly at facility maturity or covenant satisfaction?
- Does the cash sweep mechanism interact correctly with the DSRA — 
  topping up the DSRA before any cash sweep to debt prepayment?

**Standard practice deviations**
- Where the model does something that deviates from standard project
  finance practice (e.g. no DSRA on a project debt structure, interest
  not capitalised during construction, distributions not gated by
  DSCR), flag this explicitly and explain what standard practice would be.

---

## Step 20: High-risk formula commentary

For every formula with F-score High or above (from Tier 0 workbook
statistics provided in your input), do not simply note the complexity
score. Provide commentary addressing:

1. **What is this formula trying to calculate?** State the business
   purpose in one sentence (e.g. "calculates the sculpted debt
   repayment to achieve minimum 1.30x DSCR each period").

2. **Does it appear to work as intended?** Based on the visible inputs
   and outputs, does the formula produce a result consistent with its
   stated purpose? If you cannot tell from available evidence, say so
   explicitly rather than assuming it works.

3. **What should be checked in more detail?** Name the specific test a
   reviewer with formula access should perform to confirm correctness
   (e.g. "verify the DSCR target cell reference points to the correct
   covenant threshold, not a hardcoded value").

Apply this commentary especially to formulas in these categories, since
errors here have outsized commercial consequences:
`Debt` `Tax` `Valuation` `Waterfall` — royalties, revenue sharing,
depreciation, working capital, distributions, and return calculations.

Do not apply this level of commentary to Low or Moderate complexity
formulas — reserve it for High and above to keep findings proportionate
and avoid diluting attention with commentary on routine calculations.
