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
| Checks / Audit | Model integrity tests |

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

When a value falls outside these ranges, ask: does the model
contain an assumption or characteristic that explains it?
If yes, pass. If not explainable, return uncertain.

## Universal dependency chain

Trace issues through this chain regardless of industry:

```
Inputs → Revenue drivers → Revenue
Revenue - Costs → EBITDA
EBITDA - Interest - Tax → NPAT
NPAT + Non-cash - Capex - Working capital → Free cash flow
Free cash flow - Debt service → Distributable cash
All flows → Balance sheet reconciliation
Opening + movements = Closing for every roll-forward
```

## Common failure patterns across all model types

1. Revenue not linked to operational drivers — revenue calculated
   independently from volume and price assumptions

2. Hard-coded values in calculation sheets — business assumptions
   embedded in formulas rather than referenced from Inputs

3. Balance sheet plug — a line item used only to force the
   balance sheet to zero rather than calculated from first principles

4. Tax not connected to profits — tax expense does not derive
   from taxable income with a reasonable effective rate

5. Distributions before obligations — cash paid to equity holders
   before debt service, tax, and reserves are satisfied

6. Formula errors masked — IFERROR used to hide broken calculations
   rather than fix the underlying issue

7. Scenario not driving all assumptions — scenario selector changes
   some but not all scenario-sensitive inputs
