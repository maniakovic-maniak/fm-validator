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

## Mining-specific accounting logic

Mining models have unique accounting treatments that require specific checks:

**Royalties**
Royalties are typically calculated as a percentage of revenue or
production volume. Check:
- Royalty rate sourced from Inputs sheet (not hardcoded)
- Royalty base matches the correct revenue stream (e.g. net back price,
  free-on-board price, or gross revenue depending on the royalty type)
- State royalties and federal royalties calculated separately where applicable
- Royalties flow to operating costs on the IFS and operating cash flows on Cons

**Rehabilitation provision**
Mine closure and rehabilitation is a material liability. Check:
- Rehabilitation provision exists on the AFS balance sheet
- Provision accrues over the mine life and is fully funded at mine closure
- Cash rehabilitation contributions appear in investing or operating cash flows
- Provision is not simply a lump sum in the final year with no build-up

**Resource depletion / amortisation of mining rights**
Check:
- Mining rights or resource asset is amortised on a units-of-production basis
- Amortisation rate = net book value of mining rights ÷ remaining reserves
- Amortisation increases as reserves deplete (not flat-line)
- Depletion flows through the D&A line on the IFS

**Stripping costs**
Waste stripping costs may be capitalised in some models:
- If capitalised: stripping costs flow to a deferred stripping asset on AFS
- If expensed: stripping costs flow to operating costs on IFS
- The chosen treatment must be consistent throughout the model
- Mixed treatment (partly capitalised, partly expensed) is a flag

**Revenue streams — coal specific**
PCI coal and thermal coal typically command different prices. Check:
- Revenue is split by product type (PCI, thermal, middlings) where relevant
- Each product has its own price assumption on the Inputs sheet
- Wash recovery rates applied to run-of-mine tonnage to get saleable product
- Moisture content adjustments applied to gross tonnage where relevant

---

## Mining contradiction patterns

Apply these specific patterns in addition to the universal 12 patterns:

**Mining Pattern 1 — Strip ratio-cost disconnect**
Strip ratio increases year-on-year but mining costs per tonne are flat.
Strip ratio drives waste movement volumes — higher strip ratio must increase
total mining costs unless mining rate also increases.

**Mining Pattern 2 — Reserve-life disconnect**
Model extends beyond the stated reserve life without a resource conversion
or reserve extension assumption on the Inputs sheet.

**Mining Pattern 3 — Yield-quality disconnect**
Saleable coal tonnage exceeds run-of-mine tonnage × wash recovery rate.
Check: wash yield × ROM tonnage = clean coal tonnage.

**Mining Pattern 4 — Price-cost squeeze not modelled**
Coal price declines in downside case but mining costs remain at base case
levels. Variable costs should partially follow volume changes.

**Mining Pattern 5 — Royalty-revenue disconnect**
Revenue increases significantly between periods but royalty expense is flat.
If royalties are revenue-linked, they must move proportionally.

**Mining Pattern 6 — Rehabilitation not funded**
Model runs for 10+ years but rehabilitation provision remains immaterial
or zero. A mine with material assets must accrue rehabilitation costs.

---

## Shadow modelling reference values — coal mining

Use these reference values for shadow checks on coal mining models.
These are indicative ranges only — always compare against the model's
own stated assumptions first.

| Metric | Typical range | Shadow check method |
|---|---|---|
| Mining cost per BCM | AUD 3–8 per BCM | Total mining cost ÷ total BCMs moved |
| Processing cost per tonne | AUD 8–20 per ROM tonne | Processing cost ÷ ROM throughput |
| G&A cost per saleable tonne | AUD 5–15 per tonne | G&A ÷ saleable coal tonnes |
| Wash plant recovery | 55–75% for thermal, 65–80% for PCI | Clean coal ÷ ROM feed |
| EBITDA margin | 30–60% for low-cost operations | EBITDA ÷ revenue |
| Royalty rate | 7–12.5% (QLD state royalty on value) | Royalty ÷ revenue |
| Rehabilitation cost per tonne | AUD 5–20 per tonne mined over life | Total provision ÷ life-of-mine tonnes |

When shadow checking revenue:
Revenue = saleable tonnes × realised price per tonne (net of freight and moisture)

When shadow checking EBITDA:
EBITDA = revenue - mining costs - processing costs - royalties - G&A

When shadow checking IRR:
Apply XIRR to visible equity contribution and distribution cash flows.
Compare to stated project or equity IRR. Flag if difference > 2%.

---

## Accounting checks specific to mining — v6 checklist alignment

For Section 10 (Accounting logic) rules applied to mining models:

**T2-S10-004 — Balance sheet roll-forwards**
Priority roll-forwards to check in mining models:
- PP&E (mining equipment, plant, infrastructure)
- Rehabilitation provision (must accrue over mine life)
- Deferred stripping asset (if applicable)
- Mining rights / resource asset (depletion basis)
- Inventory (ROM stockpile, clean coal stockpile)

**T2-S10-013 — D&A reconciliation**
In mining models, D&A has two components:
- Straight-line depreciation of plant and equipment
- Units-of-production amortisation of mining rights
Both must appear on the IFS and reconcile to the AFS roll-forward.

**T2-S10-014 — Tax reconciliation**
Mining models often have:
- Accelerated depreciation for tax (section 40 deductions in Australia)
- Resource rent tax (MRRT or state equivalent) in addition to income tax
- Tax losses carried forward from construction / ramp-up phase
Each must be separately modelled and reconciled.

---

## Governance checks specific to mining — v6 checklist alignment

For Section 13 (Governance) rules applied to mining models:

**T2-S13-004 — Macros documented**
Mining models often use VBA macros for:
- Reserve depletion calculations
- Wash plant circuit simulations
- Price escalation tables
All macros must be listed on the cover sheet with their purpose.

**T2-S13-007 — Instructions complete**
Mining model instructions must specifically cover:
- How to update reserve estimates
- How to change the strip ratio assumption
- How to roll the model forward after each quarter of actuals
- How to run the downside / stress case

**T2-S13-010 — Handover ready**
Mining models are typically large and complex. Specific checks:
- No personal file paths to geological data or resource estimates
- Wash plant circuit assumptions documented (not locked in a black-box macro)
- Reserve schedule tab present and linked to production plan
