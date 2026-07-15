# Property Development & Operations — Domain Context

This file provides property development and operations-specific context to help
you understand the model. The ranges below are context for your judgment —
they are NOT pass/fail thresholds. Always assess plausibility against the
model's own history and stated assumptions, not against fixed numbers.

## Model type

A property development and operations model — used where a physical asset is
built (development/construction phase) and then held and operated (rather than
sold on completion) to generate ongoing cashflow, with returns measured through
both a construction-phase funding lens (debt/equity sources and uses) and an
operating-phase lens (P&L, debt serviceability, terminal valuation).

This differs from a pure "build-to-sell" property model (which resolves to a
single GDV/settlement event) in that value realisation here comes from two
places: (1) an implied development margin — the gap between total project
cost and the value the completed asset supports — and (2) an ongoing
operating business valued on an EBITDA multiple / DCF basis at exit. Both
lenses must be checked; a model that only shows one is incomplete.

Sector variants seen in this model type include hospitality, entertainment
venues, mixed-use and commercial developments where the asset is developed
and then operated by the same vehicle rather than divested at completion.

## Project / model characteristics

- Currency: check the Inputs / master assumptions sheet — do not assume AUD,
  but GST at 10% (if present) is a strong signal of an Australian project
- Periodicity: construction phase is often tracked at monthly/period level
  for capex drawdown accuracy; operating phase typically reverts to annual
  (FY) reporting once the asset is trading
- Lifecycle phases: planning/design → construction → practical completion /
  commissioning → stabilised operations → exit (sale or refinance). Each
  phase has a distinct cost and revenue profile and the model should
  explicitly flag which phase each period belongs to (a "construction/ops
  flag" on the P&L or Cashflow is a common mechanism)
- Funding stack: typically a mix of senior bank debt, sponsor/founder
  equity, and other equity-like tranches (private equity, partnership
  deposits, naming rights/sponsorship prepayments) — the classification of
  each tranche as debt vs equity materially affects gearing, DSCR and
  equity IRR, and is a frequent source of inconsistency
- Exit mechanism: either a GDV/settlement-style sale of the completed asset,
  or (as in an operating venue) a terminal value calculated as trading
  EBITDA × an exit multiple, discounted back via WACC — confirm which
  mechanism the model actually uses before applying sale-based checks

## Sheet map — what each sheet contains

| Sheet | Contents | Key items to find |
|---|---|---|
| Equity Dashboard | Investor-facing outputs | IRR, MOIC, NPV sensitivity to WACC/exit multiple, funding deployment |
| Debt Dashboard | Lender-facing metrics | Revenue, EBITDA, closing cash, total debt, DSCR, ICR by year |
| Dashboard (backup) | Archived snapshot of dashboard values | Compare against live dashboard for drift/discrepancy |
| Cashflow | Consolidated cash waterfall | Equity/debt drawdowns, opening/closing cash reconciliation |
| P&L | Profit and loss | Revenue by category, construction/ops phase flags |
| Balance Sheet | Balance sheet | Cash, restricted reserve accounts, receivables, inventory, lease deposits |
| Valuation | DCF / terminal value | WACC, cost of equity/debt, tax rate, exit multiple, project IRR/NPV |
| Inputs / Inputs for Dashboard | Master assumptions | Project timing, lease terms, rates feeding dashboards |
| Revenue Assumptions | Pricing build-up | Rate cards by revenue category/tier, capacity assumptions |
| Expense Assumptions | Cost build-up | Staffing, on-costs, mobilisation/pre-opening costs |
| Construction Timeline | Capex by category | Design/consultants, structure, civil, fit-out, services, finance costs |
| Scenarios | Scenario toggles | Revenue/cost/capex/inflation multipliers, delay assumptions |
| Financial Summary (+ backup) | Consolidated P&L/BS summary | Compare live vs backup for reconciliation |
| Debt | Debt schedule | Facility terms, drawdown/repayment, start/end flags, any tranche reclassification notes |
| GST Calculation | Tax on revenue/costs | GST rate, timing of GST cash flows into/out of Cashflow |
| Calendar Assumptions | Activity/utilisation calendar | Operating days/events per year by category, capacity, sell-through % |
| Partnership Assumptions | Non-standard funding/revenue | Sponsorship, naming rights, value-in-kind, equity waterfall terms |
| Timing | Should be the authoritative master timeline | Check it is actually populated — if empty, other sheets referencing it are unverifiable |
| Original Capex | Sources of pre-operational funding | Founder/sponsor, third-party equity, bank debt, deposits, by period |
| For Deck / For Teaser Deck | Presentation extracts | Headline IRR, MOIC, DSCR, LTV/LTC, stress tests — reconcile to live sheets |
| GANTT | Construction programme | Explicitly presentation-only in some models — confirm authoritative source elsewhere |
| Assumption Register | Unsupported/external-reliance items | DSRA sizing, exit multiple support, statutory items — check status, not just presence |
| Model Checks | Live validation gates | Formula error checks, key switch/rate tracking |
| Audit QA / Validation Closure / Change Log | Governance/remediation history | Confirm items marked "closed" are genuinely resolved, not just logged |

## Typical ranges — for context only, not thresholds

Use these only to orient your judgment. A value outside these ranges is not
automatically a fail — always compare first against the model's own stated
assumptions and history. Flag genuine outliers as uncertain for human
review, not as automatic failures.

| Metric | Typical context range | How to assess |
|---|---|---|
| Development margin (value on completion vs. total cost) | Often around 15%–25% for a viable development | Compare against the model's own contingency and cost assumptions, not a fixed hurdle |
| Contingency as % of construction capex | Often 5%–10% depending on project maturity/complexity | A design-stage project with near-zero contingency is a flag worth raising |
| GST rate (Australia) | 10% on taxable supplies | Check GST is applied consistently to both revenue and cost lines, not just one side |
| Senior debt interest rate | Compare to the facility terms actually stated in the Debt sheet | Do not assume a "market" rate — use the model's own disclosed terms as the baseline |
| DSCR (debt service coverage) | Lenders often look for a minimum in the 1.20x–1.50x range | A DSCR below 1.00x in any period is a technical default and should not be waved through as a range issue |
| LTC / LTV at financial close | Often 60%–75% for development financing | Compare against the debt sizing and equity contribution actually modelled |
| Exit EBITDA multiple (operating venue/hospitality assets) | Wide range, commonly single-digit multiples (roughly 5x–9x) | Check whether the multiple used is supported by comparable transaction evidence, or simply asserted — this is frequently an unsupported assumption |
| WACC / discount rate | Often 8%–14% depending on risk profile and gearing | Cross-check against the cost of debt and cost of equity actually built up in the Valuation sheet, not just an asserted headline number |

When a value falls outside these ranges, ask: does the model contain an
assumption or characteristic that explains it? If yes, treat as pass. If you
cannot explain it from the data, return uncertain — do not fail on the range
alone.

## Common failure patterns specific to this domain

1. **Debt/equity tranche reclassification not carried through consistently.**
   A funding tranche (e.g. a PE tranche) relabelled from debt to equity on
   the Debt sheet, but the Cashflow, Balance Sheet and DSCR/gearing
   calculations still treat it under its original classification — check
   that interest, repayment obligations, and equity return waterfalls are
   consistent with the *stated* classification, not the legacy formula
   references.

2. **Lender-facing coverage metrics presented without the reserve mechanism
   that supports them.** A Debt Service Reserve Account (DSRA) toggled off
   in the assumptions while DSCR/ICR are still shown on lender-facing
   dashboards/teaser materials as if a reserve buffer exists — check whether
   the coverage ratios or their narrative framing implicitly assume reserve
   support that isn't actually funded.

3. **Live vs backup sheet divergence.** "Backup" or archived snapshot tabs
   (dashboard backups, financial summary backups) showing materially
   different EBITDA, cash, or debt figures than the live/authoritative
   version for the same periods — this points to either a broken link, a
   stale snapshot, or an unreconciled manual override, and should be traced
   to find which version (if either) is correct.

4. **Activity/utilisation assumptions not driving revenue.** Calendar or
   scheduling assumptions (event days, occupancy days, capacity,
   sell-through %) that exist on their own sheet but don't visibly flow
   into the pricing/revenue build — check that a change in operating days
   or capacity actually moves the revenue line, not just that both exist
   in the workbook.

5. **Construction timing inconsistency across sheets that all claim
   authority.** Multiple sheets (Timing, Construction Timeline, GANTT,
   P&L construction/ops flags) each implying a construction start/completion
   date, with no single sheet clearly driving the others — worse if one of
   the "authoritative" sources (e.g. Timing) is actually empty, meaning
   downstream formulas referencing it are unverifiable or silently broken.

6. **GST treatment applied inconsistently to cash timing.** GST calculated
   on revenue and/or costs but not consistently reflected in the cashflow
   timing (e.g. GST collected/paid in the period of accrual vs. the period
   of actual BAS remittance) — check whether GST cash timing assumptions
   (lodgement frequency) are actually specified anywhere, or simply assumed
   to net to zero.

7. **Contingency and cost escalation not reconciled to the funding stack.**
   Construction capex broken out by category (consultants, structure,
   civil, fit-out, services) with a contingency line that doesn't scale
   with project delay/cost-escalation scenario toggles — check whether a
   "pessimistic" scenario multiplier actually increases contingency draw,
   or leaves it static while other cost lines inflate.

8. **Exit valuation asserted rather than derived.** An exit EBITDA multiple
   (or capitalisation rate, for a sale-based exit) entered as a hard input
   with no supporting comparable transaction evidence anywhere in the model
   — if the Assumption Register or equivalent flags this as unconfirmed,
   treat the resulting IRR/NPV as sensitive to an unsupported number, not as
   validated output.

## Dependency chain

```
Calendar Assumptions (operating days/capacity/sell-through)
        → Revenue Assumptions (rate card by category)
        → P&L revenue lines
        → EBITDA (P&L / Financial Summary)

Construction Timeline (capex by category)
        → Original Capex (funding sources: sponsor equity, PE tranche, bank debt, deposits)
        → Cashflow (drawdowns, opening/closing cash)
        → Balance Sheet (PP&E, cash, reserves)

Debt sheet (facility terms, drawdown/repayment schedule)
        → Cashflow (debt service)
        → Debt Dashboard (DSCR, ICR)
        → Equity Dashboard (residual cash to equity, IRR, MOIC)

GST Calculation (10% on revenue/costs)
        → Cashflow (GST cash timing)

EBITDA + Valuation assumptions (WACC, cost of debt/equity, tax rate, exit multiple)
        → Terminal value (Valuation)
        → Project IRR / NPV
        → Equity IRR / MOIC (Equity Dashboard)

Scenarios (revenue/cost/capex/delay/inflation multipliers)
        → re-runs the entire chain above under Base/Optimistic/Pessimistic cases
        → Financial Summary / Dashboards reflect active scenario only

Financial Summary & Dashboard sheets
        → For Deck / For Teaser Deck (presentation extracts — must reconcile back to source)
```

## Property/venue-specific accounting and governance checks

**Development margin reconciliation**
Check that total project cost (all capex categories + contingency + finance
costs during construction) is explicitly compared somewhere in the model to
the value the completed asset supports (either an appraised/GDV-style value
for a sale exit, or the discounted terminal EBITDA value for a hold/operate
exit). A model with no visible cost-vs-value reconciliation is missing a
core viability check, regardless of exit mechanism.

**GST treatment**
Confirm GST is applied consistently: to both revenue and cost lines, at the
same rate, with an explicit assumption on remittance timing (BAS frequency)
feeding the cashflow — not just a net GST line that nets to zero by
construction without ever modelling the timing mismatch.

**Settlement / drawdown timing**
For a sale-exit model, check settlement timing assumptions (deposit vs.
final settlement, and any settlement risk/delay allowance) flow into the
cashflow in the correct period. For a hold/operate model, check the
equivalent — equity/debt drawdown timing against the construction
programme — is driven by one clearly authoritative timing source, not
several partially-populated ones.

**Contingency adequacy**
Confirm a contingency line exists, is sized as a percentage of a defined
cost base (not a fixed dollar amount unrelated to scope), and responds to
scenario-driven cost escalation or delay assumptions rather than remaining
static across Base/Optimistic/Pessimistic cases.

**Lifecycle phase integrity**
Confirm every period in the model is unambiguously flagged as
construction-phase or operating-phase (or transition), and that revenue,
opex, and capex line items behave consistently with that flag — e.g. no
operating revenue appearing during a period flagged as construction, and no
construction-scale capex continuing indefinitely into stabilised operations.