# Live Entertainment Venue Development — Domain Context

This file provides live-entertainment-venue and hospitality-development
context to help you understand the model. The ranges below are context for
your judgment — they are NOT pass/fail thresholds. Always assess plausibility
against the model's own history and stated assumptions, not against fixed
numbers.

## Model type

A development-and-operating corporate model for a live music/entertainment
venue. Used to size construction funding, model the transition from
construction/fit-out into stabilised operations, service bank debt, and
forecast investor (equity/PE) returns through to an assumed exit.

## Project / model characteristics

- Industry: live music venue / hospitality development (not a pure
  operating hospitality model — it spans construction, ramp-up, and
  stabilised operations in one model)
- Currency: AUD
- Periodicity: annual
- Timeline: typically ~12 years — a short pre-construction period, a single
  construction/fit-out year, then stabilised operations, with an exit
  assumed near the end of the horizon (e.g. around a 20-year lease term)
- Revenue is event-driven: built up from event days per year by event type
  (e.g. Music GA, EDM, Comedy), capacity, sell-through %, and a per-event
  pricing/VHA (venue hire agreement) rate — not a simple occupancy-based
  hospitality model
- Additional revenue streams: premium ticketing/sales, premium F&B,
  sponsorship/partnership value-in-kind
- Capital structure is typically mixed: bank debt, PE/private equity,
  founder equity, industry partner contributions, and partnership deposits
  — some of these classifications can be ambiguous (see failure patterns)
- Debt is typically a single term facility (fixed rate, ~10-year term)
  monitored via DSCR/ICR covenants
- Valuation is DCF-based with an exit EBITDA multiple and WACC, feeding an
  equity IRR/MOIC dashboard
- These models are commonly built with heavy presentation/governance
  scaffolding (teaser decks, Gantt charts, audit registers) layered around
  a comparatively thin operating core — the presentation layer should not
  be mistaken for validated calculation

## Sheet map — what each sheet likely contains

| Sheet | Contents | Key things to check |
|---|---|---|
| Readme / General Information / Disclaimer | Navigation and narrative only | Confirm genuinely non-calculating |
| Equity Dashboard | Investor-facing IRR, MOIC, NPV sensitivity table, valuation bridge | Sensitivity table date/year formulas often break |
| Debt Dashboard | Lender-facing revenue, EBITDA, closing cash, total debt, DSCR, ICR | Compare to Financial Summary for same FY |
| Dashboard (backup) / Financial Summary (backup) | Archived values-only snapshots | Should reconcile to live tabs — often don't |
| Cashflow | Equity inflows, debt drawdowals, capex draws, closing cash waterfall | Trace closing cash to Balance Sheet cash |
| P&L | Revenue (VHA, Premium Sales, Premium F&B), costs, construction/ops flags | Check flag logic at the construction→ops transition |
| Balance Sheet | Cash, restricted cash/reserves, receivables, inventory, lease deposits | Working capital items should tie to P&L drivers |
| Valuation | WACC, cost of equity/debt, tax rate, exit multiple, IRR, NPV | Confirm exit multiple and WACC sourced from Inputs |
| Inputs | Master timing, lease, and core driver assumptions | Central source of truth — confirm nothing overrides it downstream |
| Revenue Assumptions | Event-type pricing and capacity | Feeds VHA revenue build |
| Calendar Assumptions | Event days per year by type, capacity, sell-through % | Should directly drive P&L revenue, not be decorative |
| Expense Assumptions | Staffing roles, salaries, on-costs, mobilisation/pre-op costs | Check pre-operational costs are timed to construction phase |
| Construction Timeline | Capex by category (Consultants, Structure, Civil, ICT, FF&E, Services, Finance) | Should stop/step-down at completion |
| Original Capex | Funding sources (Founder, Industry Partners, PE, Bank, Partnership Deposits) | Classification of each tranche as debt vs equity matters |
| Debt | Opening/closing balances, term, rate, start/end flags | Confirm PE Tranche treatment (see failure pattern) |
| GST Calculation | GST on revenue/costs by period | Confirm feeds Cashflow correctly, not double-counted |
| Partnership Assumptions | Sponsorship tiers, value-in-kind, ownership/distribution waterfall | Check waterfall logic matches Original Capex funding splits |
| Scenarios | Base/Optimistic/Pessimistic and delay/capex multipliers | Confirm multipliers apply to revenue, cost, capex AND timing consistently |
| Financial Summary | Consolidated P&L and balance sheet by FY | Primary reconciliation point vs Debt Dashboard |
| Timing / Legend | Referenced elsewhere as sources but may be empty | If empty, find where the real timing values actually live |
| Inputs for Dashboard / For Deck / For Teaser Deck | Linked/reformatted summary metrics for presentation | Non-authoritative — trace back to source calc |
| GANTT - MASTER OPTION | Presentation-only programme chart | Explicitly not authoritative |
| Audit QA / Assumption Register / Model Checks / Validation Closure / Change Log | Self-documented remediation and governance trail | PASS claims must be independently retested, not taken at face value |
| Accounting & COA Map | Forecast-to-accounting mapping notes | Confirm it is described as a mapping only, not a formal COA |

## Typical ranges — for context only, not thresholds

Use these only to orient your judgment. A value outside these ranges is not
automatically a fail — it may reflect legitimate project-specific
characteristics (venue size, event mix, lease terms). Always compare
against the model's own stated assumptions first, and flag genuine
outliers as uncertain for human review rather than automatic failures.

| Metric | Typical context range | How to assess |
|---|---|---|
| Sell-through % by event type | Often varies materially by genre (e.g. higher for popular music, lower for niche comedy) | Compare across event types in Calendar Assumptions for internal consistency, not against one fixed number |
| EBITDA margin (stabilised ops) | Venue/hospitality operations commonly run leaner than pure real estate but better than food-only venues | Compare year-on-year once stabilised (FY28+) — a margin that keeps expanding indefinitely without a driver is suspect |
| DSCR / ICR covenant | Lenders on hospitality/venue debt commonly want comfortable headroom above 1.0x | Check the model's own stated covenant threshold in Debt/Inputs before judging a level |
| Bank debt terms | Stated in this model as 8% rate, 10-year term | Use the model's own stated terms as the anchor, not an external market rate |
| Exit EBITDA multiple | Stated in this model as 7.0x | Sense-check consistency between Valuation and dashboards, not against an external multiple |
| WACC | Development/hospitality projects often carry a risk premium above pure operating businesses given construction and ramp-up risk | Confirm cost of equity/debt build-up on Valuation sheet is internally consistent, not just check the output number |

## Common failure patterns specific to this domain

1. **Live vs backup sheet divergence (three-statement integration).**
   "Dashboard (backup)" and "Financial Summary (backup)" carrying
   materially different EBITDA and closing cash figures than the live
   Debt Dashboard/Financial Summary for the *same FY* is a direct signal
   that either the backups are stale or the live tabs have since been
   changed without the backups being refreshed — either way, it means the
   three statements are not currently reconciled to a single source of
   truth. Confirm which tab is authoritative before relying on any output.

2. **Broken date/period arithmetic in sensitivity tables.** Equity
   Dashboard sensitivity tables (IRR/NPV by scenario) showing
   nonsensical year values (e.g. year 57503) indicate a date-serial
   arithmetic error, likely from a drag-filled date formula referencing
   the wrong anchor cell. This corrupts the entire sensitivity grid, not
   just the display — trace what else keys off that date cell.

3. **Scenario multipliers applied inconsistently across the model
   (scenario engine).** The Scenarios sheet toggles revenue, cost, capex,
   inflation and delay multipliers — but each of these needs to actually
   propagate through Revenue Assumptions, Expense Assumptions,
   Construction Timeline, and Calendar Assumptions independently. A common
   failure is a scenario that visibly changes revenue in the P&L but
   leaves capex or opex at base-case levels, silently overstating
   downside-case profitability or understating downside-case leverage.

4. **Capital structure misclassification (PE Tranche debt vs equity).**
   The Debt sheet describes the PE Tranche as "inactive debt classified
   as equity." If DSCR, ICR, gearing, or debt service coverage
   calculations on the Debt Dashboard include or exclude this tranche
   inconsistently with how it is classified on Original Capex or the
   Equity Dashboard, leverage and coverage metrics will be internally
   contradictory. Trace this single tranche through every sheet it
   touches.

5. **Working capital not linked to operational drivers.** Balance Sheet
   receivables, inventory, and lease deposits should move with the P&L
   revenue/cost lines they relate to (e.g. F&B inventory tied to Premium
   F&B revenue/cost of sales, receivables tied to VHA billing timing). A
   working capital balance that is flat, a fixed % assumption disconnected
   from the revenue build, or a plug to force the balance sheet to
   balance, is the failure pattern to check for.

6. **Empty sheets referenced elsewhere as authoritative.** Timing and
   Legend are empty/placeholder sheets, but other sheets reference them as
   a source. If formulas elsewhere pull from these empty ranges, they will
   silently return zero or blank rather than erroring — check every
   cross-sheet reference to Timing to see what it actually resolves to,
   and whether the "true" timing values have been hardcoded elsewhere
   instead.

7. **GST/tax treatment inconsistency (tax reconciliation).** GST
   Calculation computes GST on revenue and costs by period and feeds cash
   flow. Confirm whether P&L revenue/cost lines are presented GST-inclusive
   or exclusive, and that this treatment is consistent across Revenue
   Assumptions, Expense Assumptions, and Cashflow — a mixed treatment will
   distort both margin and cash reconciliation without being obvious from
   the totals alone.

8. **Construction-to-operations transition leakage (margin plausibility).**
   P&L construction/ops flags are meant to separate the fit-out period
   from stabilised operations. Check that capex does not continue at
   development-phase levels once the ops flag switches on, and that
   revenue/EBITDA margins in the first stabilised year (FY28) are
   plausible relative to the event-day/capacity/sell-through build in
   Calendar Assumptions — rather than jumping straight to a mature-year
   margin with no ramp-up.

## Dependency chain

Trace issues through this chain. A broken link near the top (drivers)
cascades into revenue, financing, and ultimately investor returns.

```
Calendar Assumptions (event days, capacity, sell-through %)
   → Revenue Assumptions (pricing by event type)
      → P&L revenue lines (VHA, Premium Sales, Premium F&B)

Partnership Assumptions (sponsorship, value-in-kind, ownership waterfall)
   → P&L other revenue / equity distribution waterfall

Expense Assumptions (staffing, on-costs, mobilisation costs)
   → P&L opex (phased by construction/ops flag)

Construction Timeline (capex by category)
   → Original Capex (funding source mix: Founder, Industry Partners, PE, Bank, Partnership Deposits)
      → Cashflow (capex draws, equity inflows, debt drawdowns)
         → Balance Sheet (PP&E, restricted cash/reserves)

Debt sheet (rate, term, balances)
   → P&L interest expense
   → Cashflow debt service
      → Debt Dashboard (DSCR, ICR, total debt, LTV/LTC)

GST Calculation
   → Cashflow (GST remittance/refund)

P&L (revenue - opex - interest - tax)
   → Financial Summary (consolidated P&L + balance sheet)
      → Balance Sheet (retained earnings, working capital)
         → Cashflow closing cash reconciliation

Cashflow closing cash + stabilised EBITDA
   → Valuation (DCF, WACC, exit EBITDA multiple)
      → Equity Dashboard (project/equity IRR, MOIC, NPV sensitivity)

Scenarios (revenue/cost/capex/inflation/delay multipliers)
   → applied across Revenue Assumptions, Expense Assumptions,
     Construction Timeline, Calendar Assumptions simultaneously
   → cascades through the entire chain above
```