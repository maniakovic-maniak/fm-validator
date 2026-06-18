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

Classify every finding by severity level.

| Level | Definition |
|---|---|
| critical | Balance sheet does not balance · Cash flow does not reconcile · Formula error in key output · Debt roll-forward fails |
| high | Assumption materially outside benchmark · Missing required schedule · Covenant breach · Hard-coded business assumption |
| medium | Incomplete disclosure · Minor formula inconsistency · Missing documentation |
| low | Formatting issue · Missing label · Non-material assumption gap |

Prioritise critical and high findings first.
Do not bury critical issues in a long list of low-priority observations.

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
This is a manual_only test — formula text is required.
- Return uncertain with confidence 30
- State: "Formula text inspection required. Direct cell inspection
  needed to confirm no business assumptions are hard-coded in
  calculation or output sheets."
- Do not infer from row values alone

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
Circular references cannot be detected from row data.
This is a manual_only test.
Return uncertain with confidence 30.
State: "Circular reference detection requires Excel iterative
calculation check or VBA scan."

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
