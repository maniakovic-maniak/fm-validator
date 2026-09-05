# RIIO / PCFM — Domain-Specific Financial Model Review Skill

This file contains **RIIO/PCFM regulatory-domain knowledge only**: the specific mechanisms,
terminology and calculation logic of the UK's RIIO price-control framework (Ofgem-regulated gas
and electricity network companies) that a reviewer should understand when auditing a RIIO or PCFM
financial model. Generic spreadsheet review, formula engineering, audit evidence, severity, and
generic infrastructure/regulated-asset concepts already covered in skill-infrastructure.md are
intentionally not repeated here.

## Provenance and an honest limitation

This file was built by directly researching and citing Ofgem's own published price-control
documents (Final Proposals, Final Determinations, Finance Annexes, the RIIO-GT1 Regulatory
Instructions and Guidance, the GT1 Price Control Financial Handbook) and corroborating secondary
analysis (Oxera, CEPA, academic review of the RIIO framework), gathered in September 2026. It
covers specifically the ~7 concepts an independent quality review identified as under-addressed by
the existing generic checklist: Totex/TIM, fast-money/slow-money allocation, RAV and depreciation
roll-forwards, tax pools and capital allowances, MOD/Base Revenue, price-base conversions and PCFM
year selection, and RoRE/financeability.

**This file has not been reviewed by a practitioner with genuine, hands-on RIIO/PCFM regulatory
finance experience.** It is a research-grounded first pass, not a validated methodology. Findings
generated using this file should be treated as a starting point for a domain expert's review, not
as authoritative regulatory conclusions in their own right — particularly on anything involving a
specific numerical parameter (incentive rates, gearing, cost of capital), since these change
materially between price-control generations and even between companies within the same
generation.

## RIIO has had multiple, genuinely distinct generations — check which one a model belongs to first

Before applying any of the below, confirm which RIIO generation the model actually belongs to.
The mechanisms below are **not interchangeable across generations** — several changed substantively,
not just numerically.

- **RIIO-1** (the original framework, introduced 2010): gas and electricity transmission and gas
  distribution ran 2013–2021 (branded T1/GT1/GD1); electricity distribution ran 2015–2023 (ED1).
- **RIIO-2**: transmission and gas distribution ran 2021–2026 (GT2/GD2/ET2); electricity
  distribution runs 2023–2028 (ED2).
- **RIIO-3**: transmission and gas distribution runs 2026–2031.

A model's own filename or sheet content will usually name its generation directly (e.g. "GT1",
"ET2") — treat this as the single most important classification fact before applying any
generation-specific mechanism below.

## 1. Totex and the Totex Incentive Mechanism (TIM)

Totex ("total expenditure") is Ofgem's core RIIO concept: capex and opex are treated as a single,
combined pool specifically to avoid biasing companies toward capital solutions purely because capex
was historically capitalised into a growing RAV while opex was expensed immediately. The same
percentage is capitalised regardless of whether the underlying spend would traditionally have been
called capex or opex.

**RIIO-1 mechanism — the Information Quality Incentive (IQI).** Totex allowances were set using an
interpolation formula combining Ofgem's own assessed efficient cost view with the company's own
submitted forecast — RIIO-GT1's real, confirmed formula was **75% Ofgem's view, 25% the company's
own submitted view** (Source: Ofgem, RIIO-T1 Final Proposals Overview, Dec 2012). Over/underspend
against this settled allowance was then shared between the company and consumers via a
company-specific incentive rate (RIIO-T1's NGET rate, once calculated, was 47%). A genuinely
low or high sharing rate is the direct, mechanical result of this same interpolation formula, not
an arbitrary Ofgem choice.

**RIIO-2/3 mechanism.** Ofgem replaced the IQI with a totex incentive rate set directly from
Ofgem's own confidence in its ability to independently assess a given cost category — a higher
"high-confidence" proportion of totex carries a higher incentive rate (RIIO-2 ranges were roughly
33–50%, narrower than RIIO-1's 44–64%). RIIO-3 introduced a further, "Stepped" version for
electricity transmission specifically, where the sharing percentage itself varies by the size of
the over/underspend band (25% up to 5% of totex, 5% between 5–15%, then 100% to consumers beyond
15%).

**Reviewer implication.** A model correctly built for its own generation should show a real,
internally-consistent link between (a) the totex variance being modelled and (b) the specific
incentive-rate mechanism of that generation — an IQI-style 75/25 interpolation formula appearing
in a RIIO-2-era model, or vice versa, would itself be a genuine, real finding worth flagging.

## 2. Fast money and slow money

This is the mechanical split within totex that determines how each pound of spend is actually
recovered:

- **Fast money** is recovered in the same year it's incurred — mechanically equivalent to opex.
- **Slow money** is added to the RAV and recovered over time through depreciation allowances plus
  a return on capital — mechanically equivalent to capex.

(Source: Ofgem, "A Guide to the RIIO-ED1 Electricity Distribution Price Control", 2017 — the same
underlying totex/fast/slow-money mechanic applies across all RIIO sectors, not just electricity
distribution.)

The **capitalisation rate** is the percentage of a given year's totex spend that becomes slow
money (added to RAV) rather than fast money (expensed immediately). This rate is set per company,
per generation, and can differ materially between TO/SO roles within the same company — RIIO-GT1's
Final Proposals set NGGT's baseline totex capitalisation at 64.4%, with a separate 90% rate applying
specifically to uncertainty-mechanism spend (Source: Ofgem, RIIO-T1 Final Proposals Overview, Dec
2012). Real, official Regulatory Instructions and Guidance for GT1 confirm the mechanical link
directly: "additions to the RAV are calculated as a set percentage of totex" (Source: Ofgem,
RIIO-T1 Gas Transmission RIGs v8.2).

**Reviewer implication.** If a model's capitalisation rate assumption doesn't match the rate
actually set for that specific company/generation/role, or if the RAV roll-forward doesn't
genuinely tie back to (capitalisation rate × totex) for each year, this is a real, traceable
formula-integrity issue, not a generic modelling preference.

## 3. RAV roll-forward and depreciation

The Regulatory Asset Value (RAV) is the cumulative, ongoing base against which a network company
earns its return — it is **not reset between price-control generations**; Ofgem's own Finance
Annex confirms directly that "RAVs roll forward seamlessly from one control period to the next"
(Source: Ofgem, RIIO-2 Final Determinations Finance Annex, revised 2021). A model's opening RAV for
any given generation should therefore tie directly to the prior generation's genuinely closed-out
RAV, not to an independently-assumed or reset starting figure.

Each year's RAV roll-forward is mechanically:

```
Closing RAV = Opening RAV + (slow money added this year) − (depreciation this year) [+/- any RAV indexation]
```

**Depreciation profile — this is a real point of generational and sector divergence, not a fixed
constant.** RIIO-1 and the RAV outstanding at the end of RIIO-2 use a sum-of-digits method on a
45-year asset life. For RIIO-3, Ofgem has decided to *accelerate* depreciation specifically for new
assets added to the RAV in the gas distribution (GD) sector, targeting full depreciation by the
government's 2050 net-zero date — a genuinely different profile from the standing 45-year approach,
and one Ofgem is still finalising for the gas transmission (GT) sector specifically (Source: Ofgem,
RIIO-3 Sector Specific Methodology Decision Finance Annex, 2024; Oxera analysis of RIIO-3 Draft/Final
Determinations, 2025).

**Reviewer implication.** A depreciation schedule using a flat, unaccelerated 45-year sum-of-digits
profile across the entire RAV in a genuine RIIO-3 GD or GT model would not match Ofgem's own stated
approach for new RAV additions — this is a real, checkable divergence, not stylistic.

## 4. Tax pools and capital allowances

RIIO/PCFM tax modelling is built on real UK capital-allowances mechanics, not a simplified
placeholder tax rate. Real network-company regulatory reporting confirms the genuine structure:
assets are held in distinct capital-allowance pools with materially different writing-down rates —
"most of our assets are Special Rate Pool items and have attracted a rate of 6% from 1st April
2019", with temporary enhancements (e.g. the Super Deduction, 50% for special-rate-pool first-year
additions in 2021/22–2022/23) further affecting the pool balance in specific years (Source: SP
Transmission, Regulatory Financial Performance Report commentary, 2022/23). The PCFM's own
"deadband" mechanism can also produce a small tax-allowance uplift independent of the underlying
pool movement itself.

**Reviewer implication.** A genuinely correct tax-pool roll-forward should show separate, distinct
pool balances (at minimum: main rate vs special rate) rather than a single, blended pool — and any
year showing an unusual, one-off allowance rate should be checked against known real reliefs (Super
Deduction, full expensing) that were only ever available in specific tax years, not applied
generally.

## 5. MOD, Base Revenue, and the Annual Iteration Process

**MOD is a real, specifically-named term in Ofgem's own PCFM documentation**, not an arbitrary
model label. Ofgem's own definition: "The RIIO-GT1 Price Control Financial Model ('PCFM') is used
to calculate values for the Base Revenue (the MOD value) that appears in the formula for each
licensee's Base NTS System Operation Revenue or Base NTS Transportation Owner Revenue" (Source:
Ofgem, "RIIO-T1 Financial Model (Gas)", ofgem.gov.uk). MOD is recalculated each year through the
**Annual Iteration Process (AIP)** — a formal, licence-governed process (part of Special Condition
4A of the Gas Transporter Licence for GT1) that updates a defined table of PCFM variable values
(e.g. RPEt for real price effects, cost-of-debt terms) and republishes a new, official PCFM
spreadsheet.

Ofgem is explicit about the PCFM's own scope limitation, worth restating directly rather than
assuming the model does more than it does: "The PCFM should not, by itself, be considered a
comprehensive model of the allowed revenue position for the licensee" — it produces the MOD/Base
Revenue term specifically, not every component of the licensee's full Maximum Allowed Revenue
(Source: Ofgem, "RIIO-T1 Financial Model (Gas)").

**Reviewer implication.** If a model claims to derive a complete allowed-revenue position purely
from its own MOD/PCFM-style calculation, without separately sourcing the other real revenue
components the licence itself defines, that is a genuine scope-overreach finding, directly
supported by Ofgem's own stated caveat — not merely a stylistic preference for more detail.

## 6. Price-base conversions and PCFM year selection

RIIO models work in two, genuinely different price bases that must never be silently conflated:
a fixed historical "price-control base year" (RIIO-T1's Final Proposals figures are consistently
denominated in **2009/10 prices**), and nominal, current-year prices used for actual billing and
cash-flow figures. Converting between the two requires the same RPI/CPIH indexation mechanism the
PCFM itself applies annually.

The PCFM is also explicitly versioned by **year of Annual Iteration** — Ofgem publishes a distinct,
dated PCFM file after each AIP (e.g. "following the Annual Iteration Process 2018", "...2019"),
each containing that year's specific MOD/RPEt/cost-of-debt variable values. Using the wrong year's
published PCFM variable values (rather than the one genuinely applicable to the model's own stated
Regulatory Year) is a real, checkable version-selection error, not a rounding difference.

**Reviewer implication.** Confirm the model is internally consistent about which price base each
figure is genuinely in, and — where the model claims to use official PCFM variable values — that
these match the specific, dated AIP publication for the Regulatory Year actually being modelled.

## 7. RoRE and financeability

Return on Regulatory Equity (RoRE) is the standard Ofgem output metric showing the actual return a
notionally-geared company would earn given its real performance against allowances, built up as a
waterfall from a genuinely observable base:

```
Allowed equity return (incl. totex-incentive-mechanism baseline)
+ Operational performance — totex and cost incentives
+ Operational performance — other incentives (output delivery, etc.)
= Operational RoRE
+ Financing and tax performance
= Total RoRE
```

A real, confirmed example from Ofgem's own published performance data for RIIO-GT1 (NGGT, full
8-year period): allowed equity return including IQI 6.7%, operational performance (totex and
incentives) −1.0%, operational performance (other) +0.3%, giving operational RoRE of 6.1%; financing
and tax performance +0.6%, giving a total RoRE of 6.6% (Source: Ofgem, "Gas Transmission Network
Performance Summary 2020-21").

**Financeability** is Ofgem's separate assessment of whether the financial package as a whole
(allowed return, gearing, cash-flow timing) lets a notionally-geared company maintain a
"comfortable investment grade" credit rating — genuinely distinct from RoRE itself, since a company
can show an acceptable RoRE while still failing a financeability test if the *timing* of cash flows
(e.g. tax paid on pre-tax incentive income, or uncertainty-mechanism revenue arriving late) creates
a real liquidity strain within the period.

**Reviewer implication.** A model presenting only a single, blended RoRE figure without the
waterfall breakdown above is not necessarily wrong, but the underlying components should still be
separately traceable in the model's formulas — and a model's financeability conclusion should never
be inferred purely from its RoRE percentage; it depends on real cash-flow timing separately from the
level of return itself.

## A genuine, honestly-flagged gap: "DARTs"

One further term the independent review named specifically — "DARTs" — did not surface as a
documented, public Ofgem or industry term across direct research for this file, despite the term
appearing as a real sheet name in an actual RIIO-GT1 model. It is most likely a model-builder's own
internal naming convention (plausibly a Depreciation/Asset/RAV-tracking working sheet, given its
position alongside a "Depn" sheet in the workbook), not a formal regulatory term with an official
definition. Rather than invent a confident meaning for it, this is flagged honestly as unresolved —
worth asking a genuine RIIO/PCFM practitioner directly rather than treating as settled.
