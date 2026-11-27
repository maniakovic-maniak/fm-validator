# UK Energy Network Price Control (RIIO) — Domain-Specific Financial Model Review Skill

This file contains **UK energy price-control regulatory knowledge only**: the
regulatory-accounting, incentive-mechanism and regulatory-finance relationships that a
reviewer needs to interpret a RIIO-style price control model correctly. Generic
spreadsheet review, audit evidence, severity, reporting, governance, formula
engineering, and generic financial-statement mechanics (balance sheet reconciliation,
cash flow reconciliation, debt rollforward, tax reconciliation) are handled by the core
review methodology (skill.md/soul.md) and are not repeated here. This file covers only
what is genuinely different because the entity's revenue, asset base and financing
capacity are set by a regulator through a periodic price control rather than by a
market.

## Model type

Apply to GB (or similarly structured) energy network/system-operator price-control
financial models — RIIO-1/RIIO-2-style licence models (LiMo/PCFM), financeability and
RoRE (Return on Regulatory Equity) models, cost-assessment and totex-scenario models,
and regulatory-asset-value (RAV) rollforward models. The triggering model is Ofgem's
RIIO-2 Licence Model for National Grid Electricity System Operator (NGESO) — a system
operator price control, which differs structurally from a transmission/distribution
owner (ETO/GDN/GT) price control because it is far less capex/RAV-driven and far more
totex/incentive-driven. Treat the ESO case as one sub-variant, not the template for
every GB energy price-control model.

## Project / model characteristics

These models translate a regulator's price-control determination (company proposal,
draft determination, final determination) into a financial forecast: allowed revenue,
RAV rollforward, financeability ratios and shareholder return (RoRE) under one or more
cost/financing scenarios. They are built around a specific regulatory price-control
period (RIIO-2 for this model, roughly April 2021/March 2022 through March 2026) and
typically carry forward historic data from the prior price-control period (RIIO-1) as a
bridge. Figures are frequently expressed in a mix of nominal (£m nominal) and a
regulatory base-price-year real terms (e.g. "£m 18/19 prices"), and scenario selection
(which totex/cost case is "live") is usually driven by an index or dropdown feeding
multiple downstream sheets.

## Must-have / Optional / Skip

**Must-have — apply regardless of which GB energy price-control sub-variant is being
reviewed:**
- RAV (or equivalent regulatory asset/capital base) rollforward consistency between
  opening balance, additions (capex/totex), depreciation, disposals and closing balance.
- Reconciliation of allowed/calculated revenue building blocks back to total allowed
  revenue for the period.
- Consistency of cost of capital inputs (cost of debt, cost of equity, notional gearing)
  across every sheet that uses them (revenue build, financeability ratios, RoRE).
- Consistency of real vs nominal price basis across cost, revenue and discounting/
  indexation calculations.
- Traceability of the active cost/totex scenario selection through to every downstream
  output (revenue, ratios, RoRE), so the headline scenario label matches what is
  actually calculated.

**Optional — apply only when the specific mechanism or sheet is present:**
- Credit rating scorecard mechanics (`RatingSimulator`-type sheet) — only where the
  model implements a named rating agency methodology; otherwise skip the scorecard-
  specific checks.
- Totex Incentive Mechanism (TIM) / cost-sharing-factor mechanics — only where the
  model carries more than one cost-assessment scenario (company proposal vs regulator
  determination) and calculates an incentive reward/penalty from the gap between them.
- Output Delivery Incentives (ODIs) / uncertainty mechanisms / re-opener mechanics —
  only where such a sheet or calculation block exists; this model's sheet list does not
  show a dedicated ODI sheet, so do not assume one exists.
- Pension deficit charge / business rates pass-through — only where a dedicated
  pass-through cost line exists (as in `SystemOperator` here); treat these as
  true-up/pass-through items, not totex-incentivised costs, if the model treats them
  that way.
- Historic price-control bridge (e.g. `RIIO-1 revenue and charges`) — only where prior
  price-control data is carried into the current model as a continuity check or
  opening-position input.

**Skip by default — these belong to a different domain but name the override:**
- Construction-phase project-finance checks (completion risk, drawdown schedules,
  contingency drawdown) are not native to a steady-state totex/RAV price-control model
  and should be skipped by default. Override this if the entity being modelled is a
  transmission/distribution owner (ETO/GDN/GT) with a genuine large physical
  construction programme embedded in the RAV additions — in that case, apply
  construction-finance-style checks to the capex programme on top of this file.
- Generic subscription/SaaS revenue-recognition checks do not apply; override only if
  the model contains a genuine non-regulated commercial revenue stream alongside the
  price-controlled business (e.g. a competitive/commercial services arm) that behaves
  like a subscription or contract-revenue business.
- Generic real-estate/development valuation checks do not apply and there is no
  plausible override scenario in this domain.

## Sheet-identification approach

Do not assume a fixed universal RIIO sheet template — identify structure from this
model's own evidence. In the triggering model, the real sheet set resolves into
functional groups:

- **Navigation/control:** `Cover`, `UserInterface`, `Model Map` — identify these first
  to understand how the model expects a reviewer or user to select a year/scenario and
  navigate between input, calculation and output areas.
- **Core regulatory-financial calculation:** `FinancialStatements` (RAV/net debt/equity
  rollforward with a balancing check row), `AR` (allowed/calculated revenue build with
  AIP adjustment), `FinRatios RoRE decomposition`, `FinancialRatios`.
- **Scenario/cost-assessment inputs:** `NGESO (Scenarios)`, `CA active scenario`, `ESO
  Company Proposal`, `Ofgem FD Forecast`, `Ofgem DD Forecast`, `SystemOperator` — these
  define which totex/cost case is live and what it contains.
- **Output/reporting:** `OutputSummary`, `RoRE ranges`, `Tables`, `LiveResults`,
  `SavedResults`, `ScenarioRun_AllOutputData` — these summarise or archive calculation
  output across scenario runs.
- **Supplementary/risk tooling:** `RatingSimulator` (credit scorecard).
- **Historic bridge:** `RIIO-1 revenue and charges`.

A different RIIO price-control model (e.g. a gas distribution network, an electricity
transmission owner, or a later price-control period such as RIIO-3) can legitimately use
different sheet names, a different number of cost-assessment scenarios, additional
ODI/uncertainty-mechanism sheets, or a different incentive structure entirely. Do not
pattern-match sheet names from this model onto another; instead, read each sheet's
actual content and labels to establish what role it plays, and state explicitly in the
review which functional group each sheet was assigned to and why.

## Typical ranges — context only, not pass/fail thresholds

The following are disclosed as background context to help a reviewer sanity-check
magnitude. They are never a pass/fail test, and several are time-bound regulatory facts
that should be confirmed as still current before being relied on:

- Notional gearing for GB energy network price controls has typically been set in the
  region of 55–65% in recent price controls, but the specific figure is set per price
  control and per company and must be read from the model's own input sheet, not
  assumed. **Confirm the current RIIO-2 notional gearing for this specific entity.**
- Cost of debt is commonly indexed to a trailing average of market benchmark yields
  rather than fixed; a reported negative *real* cost of debt is plausible in a
  structurally low/negative-real-rate period but should never be accepted without
  checking whether it is real or nominal.
- Interest cover ratios (e.g. FFO/interest, adjusted/post-maintenance interest cover)
  are commonly benchmarked by rating agencies against investment-grade thresholds (for
  example, figures in the region of 1.5x–3x depending on the specific agency,
  methodology and rating notch). **Confirm the specific threshold and methodology
  version currently used, since these are periodically revised by rating agencies and
  differ between agencies.**
- RIIO-2 price controls have generally used a real price base linked to a specific
  historic price year (e.g. "18/19 prices" in the triggering model) with CPIH-linked
  indexation replacing RPI used in RIIO-1. **Confirm the indexation basis (CPIH vs RPI
  vs a transitional blend) actually used in this specific model**, since the RPI→CPIH
  transition is a named, time-bound regulatory change rather than a permanent fact.

## Common failure patterns specific to this domain

1. **Scenario-selection leakage.** The active cost scenario (company proposal / Ofgem
   FD / Ofgem DD) is selected by an index/dropdown feeding `CA active scenario`, but one
   or more downstream sheets (`FinancialStatements`, `AR`, `OutputSummary`, `RoRE
   ranges`) is linked to a hardcoded scenario column instead of the live selection —
   producing an internally inconsistent set of outputs that look coherent in isolation
   but do not represent the labelled scenario.
2. **Real/nominal mixing.** Figures carried at a historic real price base (e.g. "18/19
   prices") are combined with nominal figures (e.g. nominal cost of debt, nominal RAV
   additions) without a disclosed, consistently-applied indexation step — this silently
   misstates allowed revenue and RoRE, and is especially easy to miss given the model
   mixes both bases across different sheets.
3. **RAV rollforward break.** Closing RAV does not equal opening RAV plus totex
   additions less depreciation (and disposals, where relevant), or the return on RAV is
   calculated on a base (opening vs average vs closing RAV) that is inconsistent with
   the one the regulator's methodology actually specifies.
4. **Revenue building-block reconciliation failure.** The RoRE decomposition (fast
   money, pass-through, depreciation, financing return, incentives) does not sum back to
   the total allowed/calculated revenue shown in `AR` — a sign error or omitted
   component here silently misstates reported RoRE without breaking any balance-sheet
   check.
5. **AIP (annual iteration / true-up) adjustment not flowing through.** Prior-year
   correction/true-up terms calculated in `AR` are not correctly carried into the
   current year's allowed revenue, double-counting or dropping a true-up amount.
6. **Cost of debt sign/convention ambiguity.** A negative cost of debt value (plausible
   in real terms in a low-rate period) is used inconsistently — e.g. treated as nominal
   in one calculation and real in another — without the model disclosing which
   convention applies where.
7. **Totex-incentive / cost-assessment inconsistency.** The gap between the company's
   proposed totex and the regulator's determined totex is meant to drive an incentive
   reward/penalty (shared via an agreed sharing factor) into RoRE, but the model's
   active scenario and the incentive calculation reference different totex vintages,
   producing an incentive outcome inconsistent with the scenario actually "selected."
8. **Financeability ratio base mismatch.** `FinancialRatios`/`OutputSummary` ratios
   (FFO interest cover, net debt/RAV, net debt/EBITDA) are computed from a net debt or
   RAV figure that does not match the corresponding balance in `FinancialStatements` for
   the same period — commonly because one sheet uses opening balances and another uses
   closing or average balances without reconciling the choice.

## Dependency chain

```
Totex scenario inputs (ESO Company Proposal / Ofgem FD Forecast / Ofgem DD Forecast)
        → Scenario selection index (NGESO (Scenarios) / CA active scenario)
        → Selected capex/opex, business rates, pension deficit, NIA (SystemOperator)
        → RAV rollforward: opening RAV + additions − depreciation (± disposals) (FinancialStatements)
        → Return on RAV = RAV base × (notional gearing-weighted cost of debt + cost of equity)
        → Revenue building blocks: fast money + pass-through + depreciation + financing return + incentives (AR, FinRatios RoRE decomposition)
        → AIP true-up/adjustment applied → Total allowed revenue (AR)
        → Net debt and equity rollforward consistent with RAV and revenue (FinancialStatements)
        → Financeability ratios: FFO interest cover, net debt/RAV, net debt/EBITDA, debt/capitalisation (FinancialRatios, OutputSummary)
        → Credit rating scorecard inputs where present (RatingSimulator)
        → RoRE performance vs allowed RoRE range (RoRE ranges)
        → Scenario comparison / archived runs (ScenarioRun_AllOutputData, SavedResults, LiveResults)
```

A break anywhere in the totex-scenario → RAV → revenue chain propagates into every
downstream ratio and RoRE output, so scenario-selection and RAV-rollforward integrity
should be checked before trusting any headline ratio or RoRE figure.

## Domain-specific graded tests

### T2-S10-799 — test: scenario_selection_propagation
Trace the scenario index/selector (e.g. in `NGESO (Scenarios)` / `CA active scenario`) through to `FinancialStatements`, `AR`, `OutputSummary` and `RoRE ranges`. Confirm every downstream sheet references the live selection rather than a hardcoded scenario column — a mismatch here produces outputs that do not represent the scenario the model claims to be showing.

### T2-S10-800 — test: real_nominal_price_base_consistency
Identify which sheets/figures use the regulatory real price base (e.g. "18/19 prices") and which use nominal terms, and confirm indexation/deflation is applied consistently wherever real and nominal figures are combined (e.g. combining a real cost base with a nominal cost of debt or nominal RAV additions without conversion is a material error).

### T2-S10-801 — test: rav_rollforward_reconciliation
Recompute closing RAV as opening RAV plus totex/capex additions less depreciation (and disposals if applicable) and confirm it ties to the RAV figure used elsewhere (return-on-RAV calculation, financeability ratios). Confirm which RAV base (opening, average, closing) is used for the return calculation and that this is applied consistently.

### T2-S10-802 — test: revenue_building_block_reconciliation
Sum the revenue building blocks (fast money, pass-through, depreciation, financing return, incentive adjustments) in `FinRatios RoRE decomposition` / `AR` and confirm they reconcile to the total allowed/calculated revenue figure reported for the same period, for every scenario modelled.

### T2-S10-803 — test: cost_of_debt_sign_and_basis_check
Where cost of debt is shown as negative (plausible for real rates in some historic periods), confirm whether it is intended as a real or nominal figure, and confirm that same convention is applied consistently everywhere the cost of debt feeds into revenue, interest cover ratios and RoRE.

### T2-S10-804 — test: financeability_ratio_base_consistency
Confirm that net debt, RAV and EBITDA figures used in `FinancialRatios`/`OutputSummary` ratios (FFO interest cover, net debt/RAV, net debt/EBITDA, debt/capitalisation) are drawn from the same period-end convention (opening/average/closing) as used in `FinancialStatements`, rather than silently mixing conventions across ratios.

### T2-S10-805 — test: aip_true_up_adjustment_flow
Confirm that the AIP (annual iteration / true-up) adjustment term calculated in `AR` for the prior period is correctly carried into the current period's allowed revenue exactly once — neither omitted nor double-counted.

### T2-S10-806 — test: totex_scenario_incentive_alignment
Where a totex incentive/sharing-factor mechanism exists, confirm the totex figures feeding the incentive calculation (company proposal vs regulator determination) are drawn from the same scenario vintage as the "active" scenario selected elsewhere in the model, so the reported incentive outcome is internally consistent with the headline scenario.

### T2-S10-807 — test: notional_vs_actual_gearing_distinction
Confirm the model clearly distinguishes notional gearing (used to calculate allowed return/financeability) from the company's actual gearing (used for actual financial-statement net debt), and that these are not conflated anywhere cost of capital or RoRE is calculated.

### T2-S10-808 — test: rore_decomposition_reconciles_to_allowed_revenue
Independently sum the components in `FinRatios RoRE decomposition` and confirm the total return matches the RoRE figure reported in `RoRE ranges` / `OutputSummary` for the same scenario and period — a mismatch indicates either an omitted incentive term or a sign error in one of the components.

### T2-S10-809 — test: rating_scorecard_weighting_rationale
Where a rating scorecard (`RatingSimulator`) is present, confirm any zero-weighted factors (e.g. factors not applicable to a system operator with no generation/fuel-diversity exposure) are deliberate choices consistent with the entity type and the disclosed rating methodology version, not an accidental omission.

### T2-S10-810 — test: pension_and_business_rates_passthrough_treatment
Confirm pension deficit charges and business rates in `SystemOperator` are treated as pass-through/true-up items flowing directly into allowed revenue rather than being subjected to the totex incentive mechanism, unless the model explicitly documents a different treatment.

### T2-S10-811 — test: balancing_check_row_materiality
Where `FinancialStatements` contains a balancing check row, confirm any non-zero residual is floating-point rounding noise (e.g. of the order of 1e-9 or smaller relative to the balance sheet totals) rather than a genuine unreconciled imbalance, and flag it as a finding if the residual scales with input changes rather than remaining at floating-point noise level.

### T2-S10-812 — test: historic_riio1_bridge_consistency
Where a historic price-control bridge sheet (e.g. `RIIO-1 revenue and charges`) feeds opening positions or continuity checks into the current price-control model, confirm the closing RIIO-1 figures used as openers match the RIIO-1 figures reported, and that any basis change (e.g. RPI to CPIH indexation, change in price base year) between price controls is explicitly reconciled rather than silently carried forward.