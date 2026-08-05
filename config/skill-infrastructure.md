# Railway / Rail Transport Infrastructure — Domain Context

This file provides rail-infrastructure-specific context to help you understand
the model. The ranges below are context for your judgment — they are NOT
pass/fail thresholds. Always assess plausibility against the model's own
history and stated assumptions, not against fixed numbers.

## Model type

A multi-entity infrastructure operating and financial model for a national or
regional railway system. Covers freight rail, passenger rail, and track/
network infrastructure operations — either as separate legal entities or as a
single integrated operator — projecting traffic, revenue, opex, financing and
consolidated financial statements over a long horizon.

## Project / model characteristics

- Entities: typically three functionally distinct businesses — Freight,
  Passenger, and Infrastructure (the network owner/manager) — which may be
  modelled as separate companies or collapsed into one integrated entity via
  a structure toggle
- Periodicity: usually annual; horizons are long (20–30+ years), spanning
  what is effectively an operating-company model rather than a single-asset
  project finance SPV
- Currency: often multi-currency debt (local currency plus USD/EUR
  multilateral or international lender tranches) even where revenue is
  single-currency
- Revenue drivers: traffic volume (net ton-km for freight, passenger-km for
  passenger), tariffs/fares, and track access charges paid by
  operating entities to the infrastructure entity
- Cost drivers: staff headcount and cost escalation, energy/traction costs
  (often split electric vs diesel traction), maintenance, and track access
  charges (as a cost to freight/passenger, a revenue to infrastructure)
- Financing: often a mix of state-owned-enterprise-style debt — local
  commercial banks, international commercial banks, multilateral development
  banks (concessional, long-tenor), and regional banks — rather than a single
  project-finance facility with one lender group
- Government/subsidy interaction: passenger rail in particular often carries
  an operating subsidy line, reflecting non-commercial fare policy
- Structural toggle: a general assumptions sheet frequently lets the user
  choose "integrated" vs "separated" entity structure, which changes what the
  consolidated statements should and shouldn't include

## Must-have / Optional / Skip

**Must-have — apply regardless of sub-variant:**
- Traffic volume and growth-rate consistency for each entity across every
  sheet that states it (Assumptions, Results, Scenarios, Charts) — the same
  entity's growth rate must agree, or the discrepancy must be explained by a
  clearly labelled scenario override
- Debt schedule integrity per lender/currency: interest expense in each
  period must tie to the opening (or average) balance × the stated rate for
  that lender/currency tranche, and must decline only in step with actual
  amortisation of that tranche
- FX treatment consistency: where debt (or any material line item) is
  denominated in a foreign currency, realized and/or unrealized FX gains/
  losses must actually move when exchange rates or balances move — a
  permanently zero FX line despite multi-currency debt is a red flag, not a
  simplifying assumption to accept at face value
- Cash distribution / dividend mechanism: check whether cash on the balance
  sheet is swept out via dividends, debt paydown, or another use — a cash
  balance that grows for the full projection horizon with no distribution,
  buyback, or sweep line is almost never a deliberate treasury policy and
  should be flagged
- Consolidation logic under the integrated/separated toggle: verify that
  whichever structure is selected, the consolidated Balance Sheet / Income
  Statement / Cash Flow Statement include each entity exactly once — no
  double-counting of revenue/costs and no omission when entities are merged
  or split
- Intercompany elimination of track access charges: track access charges
  are simultaneously a cost to Freight/Passenger and a revenue to
  Infrastructure — in an integrated/consolidated view these must net to zero,
  not be included as both a cost and a revenue at the consolidated level
- Period/phasing flags: where a calculations sheet flags which periods are
  "active" for each entity under each structure selection, confirm these
  flags actually drive inclusion/exclusion in the financial statements rather
  than being decorative

**Optional — apply only if the specific mechanism/sheet is present:**
- Debt Service Reserve Account (DSRA) / minimum cash reserve checks — only if
  a specific reserve-account line appears on the Balance Sheet or a Results/
  Debt sheet (multilateral lender agreements sometimes require this; a
  state-owned rail company's general corporate debt often does not)
- Cash waterfall sequencing (opex → debt service → capex → distribution) —
  only if the model actually presents a stepped cash allocation waterfall;
  if cash flow is a simple statement (as in this model's "Cash flow
  statement" sheet) without an explicit waterfall, assess the cash flow
  statement's completeness instead of forcing a waterfall test onto it
- Covenant compliance testing (DSCR, leverage, minimum liquidity) — only if
  covenant thresholds are stated somewhere in Assumptions, Results, or a
  Debt sheet; do not assume standard project-finance covenants exist just
  because multilateral lenders are involved
- Interest During Construction (IDC) capitalisation — only if the
  Infrastructure entity (or Freight/Passenger) has a genuine construction
  phase (new track, new rolling stock build-out) with capex predating
  revenue-generation; a legacy operating network with only maintenance capex
  has no IDC to check
- Debt sizing / sculpting to a target DSCR — only if the debt schedule shows
  variable (non-level) repayments tied to a stated target ratio; multilateral
  and sovereign-style debt is frequently modelled instead as fixed
  amortisation schedules per loan agreement, in which case sculpting is not
  expected
- Actuals-vs-forecast cutover mechanics — only if the model contains a
  distinguishable actuals period or a live/forecast switch; a from-scratch
  30-year forecast model (as here, starting Jan 2010) may have no actuals
  cutover at all

**Skip by default — but override if the stated circumstance applies:**
- SaaS/subscription revenue mechanics (MRR, churn, cohort retention) — skip
  unless the model discloses a genuine subscription-style ancillary revenue
  line (e.g. a freight logistics platform fee); rail traffic revenue is
  volume × tariff, not subscription-based
- PPP availability-payment / toll-escalation checks — skip unless the model
  explicitly structures Infrastructure or Passenger revenue as a fixed
  government availability payment rather than usage-based track access
  charges/fares; if an "operating subsidy" line is present, check whether it
  behaves like a top-up to usage-based revenue (apply this domain's checks)
  or like a availability-style fixed payment (in which case apply PPP-style
  escalation and payment-mechanism checks on top)
- Real estate leasing/occupancy checks — skip unless station retail, freight
  yard leasing, or other property income is a disclosed and material revenue
  line
- Natural-resource depletion/reserve checks (mining-style) — skip; rail
  infrastructure has no depletable reserve base
- Toll-road traffic elasticity/ramp-up curve checks — skip unless the model
  explicitly models a toll-road-style ramp-up curve for a newly opened rail
  line (new lines can have a genuine ramp-up phase; established networks
  should show mature, low-single-digit growth, not a ramp-up curve)

## Sheet map

| Sheet | Likely contents |
|---|---|
| Cover | Title/branding only — check for macro disclosure and stated model purpose |
| Assumptions - General | Structure toggle: integrated vs separated entities — governs consolidation logic downstream |
| Assumptions - Freight | Freight entity inputs: network length, staff, traffic volume, electric traction share, tariff |
| Assumptions - Passenger | Passenger entity inputs: network length, staff, traffic volume, electric traction share, fare |
| Assumptions - Infrastructure | Infrastructure entity inputs: network length, staff, external freight traffic, access charge rate, electric traction share |
| Assumptions - Consolidated | Shared/HQ-level staffing assumptions applied across entities at consolidation |
| Calculations | Intermediate logic — active-period flags per entity/structure selection; check this actually drives inclusion downstream |
| Balance sheet | Cash, receivables, inventory, debt balances, equity — consolidated or per-structure view |
| Income statement | Revenue build by entity (freight, passenger, track access charge, operating subsidy), opex, interest, tax, net income |
| Cash flow statement | Net income reconciled to cash via D&A, interest add-back, FX, working capital movements |
| Charts - Consolidated / Freight / Passenger / Infrastructure | Chart source data with CAGR calcs — useful cross-check for growth-rate consistency |
| Results - Consolidated / Freight / Passenger / Infrastructure | Summary KPIs: average track-km, staff, traffic, growth, working capital days, debt terms by lender |
| Scenarios - Consolidated / Freight / Passenger / Infra | Scenario toggle and override inputs for tariff/fare, traffic growth, access charge rate, staff — compare against base Assumptions values |

## Typical ranges — for context only, not thresholds

Use these only to orient judgment. A value outside these ranges is not
automatically a fail — always compare first against the model's own stated
assumptions and historical trend. Flag genuine unexplained outliers as
uncertain, not as automatic failures.

| Metric | Typical context range | How to assess |
|---|---|---|
| Freight/passenger traffic growth | Often low single digits (roughly 1%–5% p.a.) for a mature network | Compare across Assumptions, Results, Scenarios, Charts sheets for the same entity — they should agree |
| Electric traction share | 0%–100%, often rising gradually over the projection if electrification is planned | Check the cost lines (energy/fuel) respond to changes in this share |
| Track access charge as a % of freight/passenger revenue | Varies widely by regulatory regime — no fixed norm | Check it is applied consistently as a cost to the paying entity and a matching revenue to Infrastructure |
| Multilateral/development bank loan tenor | Often long — 15–25+ years, concessional rate | Compare rate and tenor to local/commercial bank tranches in the same debt stack |
| Working capital days (receivables) | Rail freight/passenger operators often show moderate receivable days (weeks, not months) given regulated/contracted billing | Compare against the model's own Results sheet working-capital-day disclosures over time |

## Common failure patterns

1. **Cash accumulates with no distribution/sweep mechanism** — the Balance
   Sheet cash balance grows continuously (e.g. from a few hundred to
   hundreds of thousands or more over 30 years) with no dividend, buyback,
   or debt-paydown-driven sweep. Check the Cash Flow Statement for any
   financing outflow beyond interest and scheduled amortisation.

2. **Interest declines toward zero while the balance sheet keeps growing** —
   check whether this is explained by actual debt amortisation in the debt/
   Results sheets (fully repaid tranches), or whether it is a formula that
   has silently decoupled from the outstanding balance.

3. **Growth-rate inconsistency across sheets for the same entity** — the
   same traffic growth figure appears differently in Assumptions, Results,
   and Scenarios for one entity (e.g. base-case Assumptions shows one rate,
   Scenarios shows a materially different "current" value with no override
   flag set). This indicates broken links between the assumption input and
   its downstream reporting.

4. **Zero realized/unrealized FX gains or losses despite multi-currency
   debt** — if debt is drawn in USD/EUR/local currency from different
   lender categories, FX revaluation should appear whenever exchange rates
   move or balances change; a flat zero across all periods suggests the FX
   mechanic exists nominally in the labels but is not actually wired into
   the interest/balance calculation.

5. **Integrated vs separated structure toggle mis-flows to consolidation** —
   switching the Assumptions - General toggle should change what the
   consolidated statements sum; check for either double-counting (same
   entity counted twice) or omission (an entity dropped) when the toggle is
   changed, and check whether the Calculations sheet's period-activity flags
   are actually referenced by the statements.

6. **Track access charge not eliminated at consolidation** — the charge
   Freight/Passenger pay to Infrastructure should net to zero in a fully
   consolidated (integrated) view; if it appears as a cost in one entity and
   a revenue in another without elimination, consolidated revenue/costs are
   overstated by the same amount.

7. **Electric traction share input has no cost consequence** — traction mix
   is disclosed as an input per entity, but energy/fuel cost lines don't
   change when the electric share assumption changes — the input is
   decorative rather than a real driver.

8. **Generic/template artifacts masking real formula breaks** — inconsistent
   or blank column headers (col3, col19, etc.), a fictional/placeholder
   country, and other template hallmarks are not themselves errors, but they
   increase the likelihood that formulas were copied without being
   re-tested for each entity — treat this as a reason to check more sheets
   more carefully, not as a finding in itself.

## Dependency chain

```
Assumptions - General (structure toggle: integrated vs separated)
   → Calculations (active-period flags per entity/structure)
      → determines which entities feed the consolidated statements

Assumptions - Freight/Passenger/Infrastructure
   (network length, staff, traffic volume, electric traction share, tariff/fare/access charge)
      → Entity revenue and opex build (Income statement)
      → Track access charge: cost to Freight/Passenger, revenue to Infrastructure
         → must net to zero at consolidated level

Assumptions - Consolidated (HQ staffing) → shared cost allocation → Income statement

Debt assumptions (lender, currency, rate, tenor) → Results - [Entity] (debt terms by lender)
   → Interest expense (Income statement)
   → Debt closing balance (Balance sheet)

Income statement (net income)
   → Cash flow statement (+ D&A, + interest add-back, +/- FX, +/- working capital)
      → Balance sheet cash balance
         → (missing link, per failure pattern 1) → Distributions / cash sweep

Balance sheet + Income statement + Cash flow statement, per structure toggle
   → Consolidated statements
      → Results - Consolidated / Charts - Consolidated (summary KPIs, CAGR)

Scenarios - [Entity] (override tariff/fare/access charge, traffic growth, staff)
   → overrides Assumptions inputs
      → recalculates through the entire chain above
         → must reconcile back to Results/Charts once scenario is applied
```