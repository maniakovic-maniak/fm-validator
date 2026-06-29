# Generic Financial Model — Domain Context

This file provides generic context for models where the type
could not be determined or does not match a specific domain.
Apply universal financial modelling standards. Do not assume
any industry-specific sheet names, benchmarks, or failure patterns.

## How to identify the model type

Before applying any rules, look for signals in the sheet names
and data extract:

- Subscription or ARR/MRR rows → likely SaaS
- Production volumes, reserves, ore grades → likely mining or resources
- GDV, construction cost, development margin → likely property development
- DSCR, LLCR, concession, traffic volumes → likely infrastructure
- Revenue by store or location → likely retail or hospitality
- Patient volumes or bed days → likely healthcare

If you identify the model type from the data, state it clearly:
"This appears to be a [type] model based on [specific evidence]."

## Universal sheet map

For an unknown model, look for these common sheet patterns:

| Common name | Likely contents |
|---|---|
| Dashboard / Summary | Key KPIs and output metrics |
| Inputs / Assumptions | All hardcoded business assumptions |
| P&L / Income Statement | Revenue, costs, EBITDA, NPAT |
| Balance Sheet / AFS | Assets, liabilities, equity |
| Cash Flow / Cons | Operating, investing, financing flows |
| Debt / Facilities | Debt schedule and covenant tests |
| Equity / Returns | Investor returns and distributions |
| Headcount / Payroll | Staff costs build by role and start date |
| Capex / Development | Capital expenditure schedule and timing |
| Checks / Audit | Model integrity tests |
| Timing / Flags | Actuals vs forecast period switches |

## Universal benchmark ranges — for context only

These are wide ranges applicable across most industries.
Do not use as pass/fail thresholds. Always compare against
the model's own history and stated assumptions first.

| Metric | Typical range | How to assess |
|---|---|---|
| Gross margin | 20% to 80% | Varies significantly by industry |
| EBITDA margin | -20% to 60% | Negative acceptable for early-stage |
| Revenue growth YoY | 0% to 100% | Above 100% requires verification |
| Effective tax rate | 15% to 35% | Compare to statutory rate for jurisdiction |
| Debt to equity | 0.5x to 3.0x | Above 3.0x is high leverage |
| Payroll as % of revenue | 10% to 60% | Varies by industry — labour intensity |
| Capex as % of revenue | 2% to 30% | Asset-heavy businesses at upper end |

When a value falls outside these ranges, ask: does the model
contain an assumption or characteristic that explains it?
If yes, pass. If not explainable, return uncertain.

## Universal dependency chain

Trace issues through this chain regardless of industry:

```
Inputs → Revenue drivers → Revenue
Revenue - Cost of sales → Gross profit
Gross profit - Opex (incl. payroll) → EBITDA
EBITDA - Interest - Tax → NPAT
NPAT + Non-cash - Capex - Working capital → Free cash flow
Free cash flow - Debt service → Distributable cash
Distributable cash - Reserves → Distributions to equity
All flows → Balance sheet reconciliation
Opening + movements = Closing for every roll-forward
PP&E: opening + additions - disposals - depreciation = closing
Debt: opening + drawdowns - repayments +/- capitalised interest = closing
Retained earnings: opening + NPAT - distributions = closing
Tax payable: opening + current charge - payments = closing
```

## Universal revenue checks

Regardless of model type, verify these revenue principles:

- Revenue = price × volume, with each driver sourced from Inputs
- Revenue deductions are applied where commercially relevant:
  bad debts, rebates, discounts, vacancy, churn, downtime, or ramp-up
- Revenue recognition timing is separated from cash receipt timing
- No revenue is recognised before the product or service is delivered
- Revenue cannot exceed physical or contractual capacity

## Universal cost checks

Regardless of model type, verify these cost principles:

- Payroll is built from headcount × salary, not a single flat line
- Superannuation, payroll tax, and leave entitlements are included
- Capex is separated from opex — capex flows to investing, not P&L
- Fixed costs are genuinely fixed; variable costs move with volume
- Cost escalation is applied consistently and sourced from Inputs

## Universal financing checks

Regardless of model type, verify these financing principles:

- Debt balances cannot go negative
- Interest is calculated from referenced rates, not hardcoded
- Capitalised interest during construction does not appear in P&L
- Ownership percentages sum to 100% in every period
- Distributions occur only after debt service, tax, and reserves are satisfied
- Downside scenarios surface funding gaps — they are never suppressed

## Common failure patterns across all model types

1. Revenue not linked to operational drivers — revenue calculated
   independently from volume and price assumptions

2. Revenue deductions missing — bad debts, rebates, vacancy,
   churn, or ramp-up omitted, overstating net revenue

3. Payroll not built from headcount — a single flat cost line
   with no supporting build for staff numbers, start dates, or rates

4. Hard-coded values in calculation sheets — business assumptions
   embedded in formulas rather than referenced from Inputs

5. Balance sheet plug — a line item used only to force the
   balance sheet to zero rather than calculated from first principles

6. Tax not connected to profits — tax expense does not derive
   from taxable income with a reasonable effective rate

7. Distributions before obligations — cash paid to equity holders
   before debt service, tax, and reserves are satisfied

8. Formula errors masked — IFERROR used to hide broken calculations
   rather than fix the underlying issue

9. Scenario not driving all assumptions — scenario selector changes
   some but not all scenario-sensitive inputs

10. Downside suppressed — negative cash, covenant breaches, and
    funding gaps are floored or masked rather than surfaced explicitly

11. Annual-to-period conversion wrong — annual rates applied
    directly to monthly or quarterly formulas without conversion

12. Actuals and forecast not separated by flags — forecast logic
    overwrites actual periods when the cut-off date changes

## Model type weighting rules

Different model types carry different risk profiles and require different
emphasis. Apply these weightings when assessing overall_assessment and
audit_completion_percent:

**Project finance / infrastructure models**
Higher weight on: debt roll-forward, DSCR, cash waterfall, covenant compliance,
DSRA, period flags, actuals cut-over. A single gate failure here typically
blocks a P1 finding that needs attention before the model is relied on.

**Corporate / operating company models**
Higher weight on: three-statement integration, working capital, tax
reconciliation, margin plausibility, scenario engine. Gate failures are
a P1 or P2 finding depending on the scope of impact.

**Valuation / DCF models**
Higher weight on: discount rate documentation, terminal value assumptions,
IRR/NPV formula integrity, sensitivity analysis, shadow IRR check.
Terminal value dominance (>70% of value) always warrants a flag.

**Lending / credit models**
Higher weight on: covenant definitions, DSCR floor breach testing,
downside not suppressed, debt roll-forward, no plugs.
Any covenant breach in the base case is an immediate escalation.

**Fund / equity waterfall models**
Higher weight on: ownership percentages, preferred return accrual,
distributions after obligations, IRR from live cash flows, no plugs.

**Real estate / development models**
Higher weight on: GDV reconciliation, development margin calculation,
GST treatment, settlement timing, contingency adequacy, lifecycle phases.

**SaaS / technology models**
Higher weight on: ARR waterfall integrity, revenue recognition timing,
churn deductions, payroll build from headcount, CAC/LTV plausibility.

When the model type is unknown (skill-generic loaded):
Apply equal weight across all sections. Flag any section where no
evidence is available as uncertain rather than pass.

---

## Intake requirements by model tier

**Tier 1 model — minimum evidence expected:**
- Latest audited financial statements or management accounts
- Term sheet or facility agreement (for debt models)
- Board-approved business plan or investment memo
- Source data for all material assumptions
- Prior version of the model with change log

When Tier 1 evidence is absent:
- Cap all evidence-dependent test confidence at 45
- Return uncertain for all tests requiring source document verification
- Note in overall_assessment: "Evidence pack incomplete for Tier 1 reliance"

**Tier 2 model — minimum evidence expected:**
- Management accounts for the last 2 reporting periods
- Key assumption documentation (email or memo acceptable)
- Sensitivity analysis confirming downside case

When Tier 2 evidence is absent:
- Cap evidence-dependent test confidence at 60
- Return uncertain for historical reconciliation tests

**Tier 3 model — minimum evidence expected:**
- Any documentation of key assumptions
- Confirmation of model purpose and intended use

When Tier 3 evidence is absent:
- Note limitation in overall_assessment
- Proceed with available data — do not block testing

---

## Audit gate escalation for unknown model types

When skill-generic is loaded (model type unknown or unmatched),
apply these escalation rules conservatively:

**If balance sheet gate fails:**
- raise all gate failures as P1 findings
- Do not attempt to assess return metrics or covenant compliance
- Focus findings on structural integrity first

**If cash flow gate fails:**
- raise as P1 and note affected metrics are provisional
- Flag all operating performance metrics as provisional

**If no Checks sheet exists:**
- Add a medium finding regardless of other results
- Note that without a checks sheet, integrity cannot be continuously monitored

**If model type cannot be identified:**
- State this explicitly in audit_completion_commentary
- Apply universal benchmarks with wider tolerance bands
- Increase uncertain count threshold — more findings will be uncertain
  without domain-specific benchmarks
- Do not penalise audit_completion_percent for tests that
  genuinely cannot be applied without knowing the model type

---

## Evidence pack assessment

Before testing, assess the evidence pack completeness:

**What constitutes evidence in Mode A (cell values only):**
- Visible check rows with zero residuals
- Assumption labels with source notes visible in row data
- Version or date information visible in cell data
- Structure that is consistent with stated model purpose

**What is NOT evidence in Mode A:**
- The existence of a sheet with a relevant name
- A number that "looks right" without a visible check
- A formula structure you cannot see
- Management assertions not corroborated by model data

**Evidence sufficiency thresholds:**
- 3+ corroborating data points for a pass conclusion: confidence 80-95
- 2 corroborating data points: confidence 60-79
- 1 data point: confidence 45-59 (return uncertain)
- 0 data points: confidence 0-30 (return uncertain, state what is needed)

**When evidence pack is thin across the board:**
Set review_mode to llm_only and add to audit_completion_commentary:
"This review was conducted from extracted cell values only. Formula
inspection, source document review, and a Tier [X] evidence pack are
required before further review procedures can be completed."
