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
