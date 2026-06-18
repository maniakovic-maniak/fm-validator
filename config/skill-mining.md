# Mining Project Finance — Domain Context

This file provides mining-specific context to help you understand the model.
The ranges below are context for your judgment — they are NOT pass/fail
thresholds. Always assess plausibility against the model's own history and
stated assumptions, not against fixed numbers.

## Model type

A mining project finance model built to reliance-grade standards.
Used for debt financing, equity raises, or strategic planning for a
hard rock or bulk commodity mining operation.

## Project characteristics

- Commodity types: coal, iron ore, gold, copper, or base metals
- Periodicity: usually quarterly — covering construction, ramp-up, operations, closure
- Currency: AUD or USD — check the Inputs sheet to confirm
- Lifecycle: typically 15 to 30 years from construction to closure

## Sheet map — what each sheet contains

| Sheet | Contents | Key rows to find |
|---|---|---|
| Dashboard | Summary KPIs | NPV, IRR, peak debt, DSCR, EBITDA |
| Inputs | All hard-coded assumptions | Price, FX, tax rate, discount rate, debt terms, dates |
| Timing | Project timeline | Construction start/end, ramp-up, operations, closure |
| Ops | Operational schedule | Production volume, unit costs, revenue by product |
| Cons | Consolidated statements | Revenue, EBITDA, NPAT, net cash flow |
| IFS | Income and funding statement | Detailed P&L and funding waterfall |
| AFS | Balance sheet and assets | PP&E roll-forward, working capital, debt, equity |
| Reserves | Reserve and resource schedule | Mining inventory, depletion rate |
| Debt | Debt schedule | Drawdowns, repayments, interest, DSCR, LLCR |
| Equity | Equity schedule | Contributions, distributions, equity IRR |
| D&T | Depreciation and tax | Tax schedule, effective rate reconciliation |
| Leases | AASB 16 lease schedule | Right-of-use assets, lease liabilities |
| Capex Unit Costs | Capex cost build-up | Capex by category and phase |
| Model Issues | Open issues | Should be empty in a finalised model |

## Typical ranges — for context only, not thresholds

Use these only to orient your judgment. A value outside these ranges is
not automatically a fail — it may reflect a legitimate project characteristic.
Always compare against the model's own historical periods and stated
assumptions first. Flag genuine outliers as uncertain for human review,
not as automatic failures.

| Metric | Typical context range | How to assess |
|---|---|---|
| EBITDA margin | Often 20% to 60% for producing operations | Compare to model history and stated cost assumptions |
| Project IRR | Often 10% to 25% for greenfield projects | Compare to discount rate and risk profile in Inputs |
| Equity IRR | Often higher than project IRR due to leverage | Check it exceeds project IRR if debt is used |
| Effective tax rate | Near the statutory rate for the jurisdiction | Australian corporate rate is 30% |
| DSCR | Lenders typically require a minimum near 1.10x to 1.20x | Fail only if below 1.00x — that is a technical default |
| Gearing at close | Often 65% to 85% for project finance | Compare to the debt sizing assumptions |

When a value falls outside these ranges, ask: does the model contain an
assumption or characteristic that explains it? If yes, pass. If you cannot
explain it from the data, return uncertain — do not fail on the range alone.

## Common mining model failure patterns

These appear frequently in poorly built mining models. Watch for them:

1. Revenue not linked to Ops: revenue on Cons calculated independently
   from production volumes on Ops — a pricing change will not flow through

2. Capex after commissioning: sustaining capex equal to development capex
   continuing into steady-state operations — inflates costs

3. Tax shield not modelled: depreciation not reducing taxable income —
   overstates tax, understates NPAT and cash flow

4. Debt sculpting not applied: debt repayments are equal instalments
   rather than sculpted to maintain target DSCR — understates early equity returns

5. Closure costs missing: no provision for mine rehabilitation and closure —
   understates total project cost and overstates NPV

6. Royalties in wrong line: state royalties included in the tax line rather
   than operating costs — distorts EBITDA and tax calculations

7. FX applied inconsistently: revenue in USD but costs in AUD with FX
   conversion applied in some places but not others

## Dependency chain for mining models

Trace issues through this chain. A broken link at the top causes
cascading errors throughout.

```
Reserves → Production profile (Ops)
Inputs (price, FX) → Revenue (Ops → Cons)
Inputs (unit costs, inflation) → Operating costs (Ops → Cons)
Revenue - Operating costs → EBITDA (Cons)
EBITDA - Interest - Tax → NPAT (IFS)
NPAT + Depreciation - Capex - Working capital → Free cash flow (Cons)
Free cash flow - Debt service → CFADS (Debt)
CFADS / Debt service → DSCR (Debt)
Capex → PP&E (AFS)
PP&E → Depreciation (D&T → IFS)
NPAT → Retained earnings (AFS)
Debt closing balance → Balance sheet (AFS)
All flows → Cash balance reconciliation (AFS/Cons)
Cash waterfall → DSRA → Distributions (Debt/Cons)
```
