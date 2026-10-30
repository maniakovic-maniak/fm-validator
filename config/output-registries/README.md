# Output registries

One JSON file per model, listing the outputs a reader of the model relies on (headline returns, coverage ratios,
valuation, balance checks). A registry is how the audit knows which formulas matter most.

- `proposed`: drafted by `scripts/propose-output-registry.js` from sheet and row labels. Nothing is relied on.
- `approved`: a named person has reviewed the list and signed it (`approved_by`, `approved_on` filled in).
  Approval storage and the verdict ceiling it enables arrive in Patch 33.

A registry never holds a report. A missing or proposed registry changes no verdict and blocks nothing.
