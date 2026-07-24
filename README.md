<img src="https://raw.githubusercontent.com/maniakovic-maniak/fm-validator/main/assets/readme/hero.svg" alt="fm-validator: financial model audit pipeline" width="100%" />

# fm-validator

An automated audit pipeline for financial models (Excel workbooks). It runs deterministic structural checks, a Claude-based semantic review, and a formula recalculation pass, then produces a 16-tab audit report with a clear reliance-readiness verdict — not just a list of anomalies.

## Why this exists

Automated spreadsheet tools can flag hundreds of formula exceptions, hard-codes, and hidden cells. Most of that noise doesn't tell you whether the model is actually safe to rely on for a real decision. fm-validator is built around a different question: **is this specific finding a confirmed defect capable of invalidating a key output, or is it a query, an observation, or noise?**

That distinction drives everything downstream — priority, whether it blocks reliance, and how it's presented.

## How it works

```
Tier 0  →  Tier 1  →  Tier 2  →  Report
```

- **Tier 0** — deterministic pattern/structural checks over formula text (26+ checks: daisy-chained links, numbers stored as text, DSCR lock-up violations, balance-sheet plugs, revenue double-counting, and more). IDs like `T0-XXXXX-NNN`.
- **Tier 1** — deterministic, checklist-driven structural checks (18 rules, `T1-NNN`).
- **Tier 2** — Claude-based semantic review across three batches (Structure, Accounting & Debt, Scenarios & Governance — 141 rules, `T2-SXX-NNN`), informed by a domain-specific skill file per model type.
- **A1 (Formualizer recalculation)** — actually recalculates the workbook. This is the one component that closes the real gap in Tier 2's Mode A review (which reasons over extracted values, not raw formula logic) — it's what catches something like "equity NPV wired to equity value instead of discounted cash flows."

## The P1 / P2 / P3 framework

Every finding is classified along two independent dimensions before it gets a priority:

**`record_type`** — is this actually confirmed? `Confirmed Finding`, `Query`, `Critical Query`, `Observation`, `Scope Limitation`, `Not Applicable`, or `False Positive`. Only a Confirmed Finding is eligible for a P1/P2/P3 priority at all. A Critical Query — a low-confidence result that touches a key-output area like debt, valuation, or tax — blocks reliance with the same force as a P1, without pretending to be a confirmed defect.

**Priority** — P1/P2/P3, assigned from severity, but only once `record_type` has already gated eligibility. A fatal/critical-severity finding still needs confidence 80+ to become a P1; below that, it stays a Critical Query until the evidence is stronger.

Findings are also:
- **Root-cause consolidated** — one master finding with `occurrence_count` and a real `affected_cells` list, not 100 duplicate rows for the same underlying issue.
- **Tracked across runs** — Closed / New / Regressed / Still Open, at individual-cell granularity, so a partial fix shows up as a partial fix.
- **Risk-scored** — four dimensions (Decision Consequence, Exposure, Propagation, Control Weakness) rank findings within their tier. A numerical score never creates a P1 by itself.

The model's overall readiness verdict (`Not Ready` → `Internal Review Only` → `Management Discussion` → `Lender/Investor Review` → `Transaction Execution`) is gated on: no open P1s, no unresolved Critical Queries, no incomplete mandatory-critical procedures, no unaudited critical modules, no unreconciled key outputs, and — for the top tier specifically — recorded reviewer approval.

## Getting started

```bash
npm install
cp .env.example .env   # set ANTHROPIC_API_KEY and your Google Drive credentials
```

Run the pipeline against a workbook already in Google Drive:

```bash
node index.js <google-drive-file-id>
```

Run the test suite:

```bash
npm test
```

## The report

The output is a 16-tab `_VALIDATED.xlsx`:

`Audit Output` (dashboard) · `Read Me` · `Scope and Reliance` · `Issue Log` · `Remediation` · `Validation Matrix` · `Assumption Register` · `Formula Risk Review` · `Error Matrix` · `Redundant Inputs` · `Sheet Linkage` · `Named Range Audit` · `Reasonableness Review` · `Sheet Dependency` · `F-Score Rules` · `Pipeline Audit Trail`

The dashboard leads with the verdict, the reason, the required action, and — since a recent run — the same KPI-card treatment for what's changed since the last run as for what's currently open.

## Project structure

```
index.js / server.js       pipeline entry points (CLI and server)
src/validator-tier0.js     Tier 0 orchestration
src/validator-tier1.js     Tier 1 orchestration
src/validator-tier2.js     Tier 2 orchestration (Claude API)
src/recalc_check.py        Formualizer-based recalculation (A1)
src/build_report.py        report builder (16-tab .xlsx output)
src/utils/                 individual Tier 0 checks + shared utilities
config/checklist.json      the Tier 1/2 rule definitions (159 rules)
config/soul.md              Tier 2's system prompt / classification guide
scripts/bug-scan-agent.js  post-commit code-review agent for this repo itself
test-*.js / test_*.py      per-module test suites
```

## Maintaining this project

A `post-commit` hook (`.githooks/post-commit`, opt in with `git config core.hooksPath .githooks`) runs a lightweight Claude-based code review on whatever a commit just changed, and lists any genuine bugs found — it never fixes anything automatically. Run `node scripts/bug-scan-agent.js --all` for a full-repo pass instead of the routine per-commit one.
