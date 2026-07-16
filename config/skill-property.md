# Real Estate and Property Development — Domain Context

This file provides property development context for Tier 2 validation.
The ranges below are context for your judgment — they are NOT pass/fail
thresholds. Always assess plausibility against the model's own history and
stated assumptions first.

## Model type

A real estate or property development financial model. Used for residential
and commercial development, built-to-rent, land subdivision, mixed-use
projects, and property trusts.

A less common but real variant: a single model that both develops the asset
AND continues to operate it afterwards (rather than selling at completion),
common in hospitality, entertainment venue, and mixed-use projects. This
variant resolves value through TWO lenses rather than one — the usual
development margin (cost vs. value on completion) AND an ongoing operating
business valued on an EBITDA multiple or DCF basis at eventual exit. Where
you identify this variant, apply the core checks below AND the additional
operating-phase guidance flagged throughout this file — both apply, not
one instead of the other.

Some models explicitly compare a hold case against a sell case as a
decision the model itself is testing (rather than assuming one path) —
where you see both a completed-asset sale value AND a hold/operate
valuation modelled side by side, check both cases individually rather
than assuming only one is relevant. Confirm which lifecycle phases the
model actually flags (planning/design, construction, completion,
operations, exit) — a model missing an explicit phase flag for one of
these is a structural gap, not just a documentation one.

## Must-have / Optional / Skip

Not every check below applies to every model of this type — which of the
three sub-cases you're looking at (build-to-sell, income-producing asset,
or the combined develop-and-operate variant) determines which tier a
given check falls into. Use this to prioritise your review time, not as a
substitute for judgment: if the model's own structure suggests a "Skip"
item is actually relevant here, check it anyway.

**Must-have — check on every property model of this type, regardless of sub-case:**
- Development cost reconciliation (total cost genuinely accounted for, no unexplained residual)
- GDV/value reconciliation (cost vs. value comparison exists in some form — GDV-style for a sale, terminal value for a hold)
- GST/VAT treatment consistency (inclusive vs. exclusive, applied the same way throughout)
- Live vs. backup sheet divergence (any archived/backup tab reconciles to the live version)
- Development margin arithmetic (profit ÷ total development cost, correctly and consistently calculated)

**Optional — check if the relevant sheet/mechanism is present; its absence is not itself a failure:**
- Settlement risk / drawdown timing — only meaningful if the model has a defined settlement event or a construction drawdown schedule; a pure income-producing asset with no development phase won't have this
- Contingency adequacy — only meaningful while genuinely in a development/construction phase; a fully stabilised asset with no further construction has nothing left to hold contingency against
- DSRA / debt reserve mechanism — only relevant if the model has debt financing with a reserve account; many smaller or unlevered models won't have one
- Working capital linked to operating drivers — only relevant once the model reaches an operating phase (the combined variant, or a pure income-producing asset)
- Scenario propagation across phases — only relevant if the model actually has a Scenarios sheet or toggle
- Sensitivity-table date-arithmetic check — only relevant if the model has a sensitivity grid to check in the first place

**Skip by default — not native to this domain, but don't force this if the model's own structure says otherwise:**
- SaaS-specific metrics (ARR waterfall, churn, CAC/LTV) — a property model is not a subscription business, but if a mixed-use project genuinely includes a SaaS-style tenant/subscription revenue line, check that specific line item against `skill-saas.md`'s guidance instead of skipping it
- Mining-specific patterns (royalties, rehabilitation provisions, strip ratio) — not applicable unless the property happens to sit on or include a mining lease or extractive right, which does occasionally happen for large rural/regional sites
- Fund/PE waterfall mechanics (carried interest, GP/LP splits, hurdle rates) — property capital structures are usually simpler than this, but check the funding sheet first: a Partnership Assumptions-style sheet with sponsorship tiers and a distribution waterfall may genuinely need this lens applied on top, not instead of, the property-specific checks above

## Project characteristics

- Two distinct model types: development feasibility (land and development
  costs weighed against sale or rental value) and income-producing asset
  — plus a third, combined variant where a single model develops the
  asset and then operates it in the same vehicle rather than divesting at
  completion (see Model type above). Confirm which of the three you are
  looking at before applying the checks below.
- Periodicity: usually monthly — covering pre-development, construction, and
  sales/operations. In the combined variant, construction phase is often
  tracked monthly for drawdown accuracy while the operating phase reverts to
  annual (FY) reporting once the asset is trading.
- Currency: AUD typically — check the Inputs sheet to confirm
- Lifecycle: typically 2 to 7 years for development, ongoing for
  income-producing. In the combined variant, expect explicit lifecycle
  phase flags (planning/design → construction → practical completion →
  stabilised operations → exit) rather than a single completion date.

## Sheet map — what each sheet contains

| Sheet | Contents | Key rows to find |
|---|---|---|
| Summary / Dashboard | Key metrics | GDV, development margin, IRR, equity return, peak debt |
| Inputs / Assumptions | All hard-coded assumptions | Land cost, construction cost, sales price, cap rate, rates, dates |
| Development Cost | Cost schedule | Land, construction, consultants, finance costs, contingency, GST |
| Revenue / Sales | Revenue schedule | Sales programme by stage, lot type, settlement timing |
| Cash Flow | Development cash flow | Drawdowns, sales receipts, net position by period |
| Funding | Funding structure | Equity, construction finance, residual debt, LVR |
| Valuation | Asset valuation | Cap rate or DCF valuation of completed asset |
| Sensitivity | Sensitivity analysis | Price, cost, timing, interest rate sensitivities |

**Additional sheets seen in the combined develop-and-operate variant** —
these won't appear in a pure build-to-sell model, and their absence is not
itself a problem unless the model has already been identified as this variant:

| Sheet | Contents | Key rows to find |
|---|---|---|
| Equity Dashboard | Investor-facing outputs for the ongoing business | IRR, MOIC, NPV sensitivity to WACC/exit multiple |
| Debt Dashboard | Lender-facing metrics for the ongoing business | DSCR, ICR, total debt, closing cash by year |
| P&L (operating) | Ongoing profit and loss once trading | Revenue by category, construction/ops phase flag |
| Calendar / Activity Assumptions | Operating-phase revenue drivers | Event days/occupancy/activity by type, capacity, sell-through % |
| Backup / archived tabs | Snapshot copies of dashboards or summaries | Compare against the live version for drift — often diverge |

## Typical ranges — for context only, not thresholds

| Metric | Typical context range | How to assess |
|---|---|---|
| Development margin (profit on cost) | 15% to 25% residential, 20% to 30% commercial | Below 12% is unviable, compare to project risk |
| Project IRR | 15% to 35% | Varies significantly by risk and leverage |
| Equity multiple | 1.5x to 3.0x | Over a typical 2 to 5 year project |
| Cap rate | 4% to 7% Australian commercial | Varies by asset class, location, quality |
| LVR on construction finance | 65% to 75% of TDC | Check against facility documents |
| Contingency | 5% to 10% of hard construction costs | Below 5% is a concern |
| GST margin scheme | Apply where land was purchased without GST | Check tax advice reference |
| Exit EBITDA multiple *(combined variant only)* | Wide range, commonly single-digit (roughly 5x–9x) for operating venue/hospitality assets | Check whether supported by comparable transaction evidence, or simply asserted |
| DSCR *(combined variant only)* | Lenders often look for a minimum in the 1.20x–1.50x range | A DSCR below 1.00x in any period is a technical default, not a range issue |

When a value falls outside these ranges, ask: does the model contain an
assumption or characteristic that explains it? If yes, pass. If you cannot
explain it from the data, return uncertain.

## Property-specific checks

### Development cost reconciliation
Total development cost = land + construction + consultants + finance costs
+ contingency + GST. Any unaccounted residual is a critical error. Check
that development cost phasing is consistent with the construction
programme (an S-curve, not a lump sum) — see Cash flow timing below.

Finance costs specifically require two checks: that debt drawdown is
consistent with the phased cost schedule (drawing ahead of or behind the
actual spend profile is a flag), and that interest during construction is
capitalised into total development cost rather than expensed through a
P&L that shouldn't exist yet at this stage — interest capitalisation
excluded from TDC is one of the more common ways all-in cost is
understated (see failure pattern 2 below).

### GDV and development margin
GDV = sum of all sale proceeds (for a sale exit, driven by sales/rent
assumptions on the Revenue/Sales sheet) or capitalised value of rental
income (for a hold exit) — confirm which basis the model actually uses
before checking the arithmetic. GDV reconciliation means confirming this
total ties explicitly back to the sales/rent assumptions feeding it, not
just appearing as a standalone output figure.
Development margin = profit divided by total development cost.
Check the arithmetic for both. Where a model presents hold/sell cases
side by side (see Model type above), reconcile the development costs and
margin arithmetic separately for each case.

### Cash flow timing
Construction drawdowns should follow the S-curve — slow start, fast middle,
slow finish. Sales proceeds should follow the sales programme.
Finance costs must be consistent with the drawn balance and interest rate.

### GST/VAT treatment
GST on sales must be included in gross proceeds and netted out.
GST on costs must be recovered via BAS.
The model must be consistent — either all inclusive or all exclusive.
Flag any mixing of GST-inclusive and GST-exclusive amounts. For a
non-Australian project, apply the same GST/VAT treatment consistency
check to whatever the local equivalent tax is (VAT in many other
jurisdictions) — confirm which one actually applies from the Inputs
sheet rather than assuming GST.

### Settlement risk
Check that settlement assumptions are realistic — not 100% settlement
in the first month of completion. Flag if settlement timing appears
optimistic relative to market conditions.

### Operating-phase checks (combined develop-and-operate variant only)
Only apply these where the model both develops AND operates the asset —
see Model type above. They sit alongside, not instead of, the checks above.

**Dual exit-mechanism reconciliation.** Confirm the model reconciles total
development cost against BOTH value lenses where relevant: the completed-
asset value (GDV-style, for the development-margin check above) and the
terminal value of the ongoing operating business (EBITDA multiple or DCF).
A model that only shows one lens when it genuinely operates the asset
afterwards is incomplete.

**Lifecycle phase integrity.** Confirm every period is unambiguously
flagged construction-phase or operating-phase (or transition), and that
revenue, opex, and capex behave consistently with that flag — no operating
revenue during a period flagged construction, and no construction-scale
capex continuing indefinitely into stabilised operations.

**Working capital linked to operating drivers.** Once trading, balance
sheet receivables, inventory, and deposits should move with the P&L lines
they relate to, not sit as a flat balance or a fixed % disconnected from
the revenue build.

**Scenario propagation across both phases.** A scenario toggle (revenue,
cost, capex, delay) needs to propagate through both the construction-phase
assumptions and the operating-phase assumptions consistently — a common
failure is a scenario that changes operating revenue but leaves
construction capex at base case, or vice versa.

## Common property model failure patterns

1. Development margin calculated on GDV not TDC — overstates margin
   by using the wrong denominator

2. Finance costs not in TDC — construction loan interest excluded from
   total development cost, understating true all-in cost

3. GST not netted correctly — GST on sales included in profit calculation,
   overstating returns by the GST component

4. Contingency adequacy below market — 3% or less of hard costs with no
   rationale, inadequate buffer for cost overruns

5. Settlement assumed at practical completion — 100% settlement modelled
   immediately on completion with no lag for buyer settlement periods

6. Land cost timing wrong — land cost modelled as a lump sum at start
   rather than following the actual purchase, deposit, and settlement dates

7. Capex and opex mixed — construction costs and ongoing maintenance
   costs not separated, distorting both development margin and yield

**Additional patterns specific to the combined develop-and-operate variant**
(only apply where the model both develops AND operates the asset):

8. Broken date/period arithmetic in sensitivity tables — a sensitivity
   grid (IRR/NPV by scenario, typically on an Equity Dashboard) showing a
   nonsensical year value indicates a date-serial arithmetic error,
   usually a drag-filled date formula referencing the wrong anchor cell.
   This corrupts the whole grid, not just its display — trace what else
   keys off that date cell.

9. Debt/equity tranche misclassification not carried through — a funding
   tranche relabelled from debt to equity (or vice versa) on the Debt
   sheet, while downstream DSCR/gearing/equity-waterfall calculations
   still use the original classification.

10. Live vs backup sheet divergence — archived/backup dashboard or summary
    tabs showing materially different EBITDA, cash, or debt figures than
    the live version for the same period, indicating either a stale
    backup or an unreconciled manual override.

11. Activity/utilisation assumptions not driving operating revenue —
    calendar or scheduling assumptions (occupancy days, event days,
    capacity, sell-through %) that exist on their own sheet but don't
    visibly flow into the operating-phase revenue build.

12. Construction-to-operations margin implausibility — capex continuing
    at development-phase levels after the ops flag switches on, or
    stabilised-period EBITDA margins that jump straight to a mature-year
    level with no visible ramp-up from the activity/capacity build.

## Dependency chain for property models

```
Inputs (land, construction, cap rate, sales price) → Cost schedule
Construction programme → Cost timing (S-curve drawdowns)
Sales programme → Revenue timing (settlements)
Revenue - TDC → Development profit
Development profit / TDC → Development margin
Equity + Construction finance → Funding waterfall
Drawdowns - Repayments → Net debt position
Cash position → LVR tests → Covenant compliance
Completed asset value → Cap rate → Yield on cost
IRR → From investor equity cash flows (in, out)
```

**Additional chain for the combined develop-and-operate variant** — runs
alongside the chain above rather than replacing it; both apply once the
model transitions from construction into operations:

```
Calendar/Activity Assumptions (occupancy/events/capacity/sell-through)
   → Operating revenue (P&L)
   → Stabilised EBITDA

Debt sheet (facility terms, drawdown/repayment)
   → Debt service
   → Debt Dashboard (DSCR, ICR)
   → Equity Dashboard (residual cash to equity, IRR, MOIC)

Stabilised EBITDA + Valuation assumptions (WACC, exit multiple)
   → Terminal value
   → Equity IRR / MOIC (as an alternative to, or alongside, the
     completed-asset-value / cap-rate path above)

Scenarios (revenue/cost/capex/delay multipliers)
   → re-runs both chains under Base/Optimistic/Pessimistic cases
```
