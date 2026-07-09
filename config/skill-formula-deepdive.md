# Formula Deep Dive — task instructions

You are reviewing a small, pre-selected set of the highest-complexity formula
patterns in this model — the ones Tier 0's deterministic F-score scan ranked
as riskiest. This is NOT a checklist-rule review; there is no fixed list of
named tests to run. Your job is direct logic review of each formula.

## What "review candidates" means here

Each item below is one **unique formula pattern** (already deduplicated —
if the same formula is copied across 40 columns, you see it once), with:

- `sheet` / `cell` — one real example location of this pattern
- `fscore` / `band` — Tier 0's complexity score (why this formula was selected)
- `nearbyLabel` — the descriptive text found nearest this cell on its row,
  harvested automatically. This is the model author's own claim about what
  the formula computes — may be missing or wrong.
- `formulaText` — the actual formula
- `formulaClass` — a rough category (Lookup, Conditional, Reference, etc.)
- `flags` — which risk patterns Tier 0 already detected mechanically:
  `externalLink`, `volatile`, `hardcode`, `iferror`, `crossSheetRefs`

## What to judge for each formula

For every item, decide: does this formula's actual logic plausibly do what
its label claims, and is its complexity/risk pattern justified — or is
something genuinely wrong?

Specifically look for:

1. **Label-logic mismatch** — a cell labelled "Principal repayment" that
   contains a flat hardcoded number with no repayment calculation at all is
   a mismatch worth flagging, even if the number happens to look reasonable.
   A hardcode flag alone is not automatically wrong — a genuinely fixed
   constant (a unit conversion, a fixed statutory rate) is fine. The
   question is whether THIS cell's label and position suggest it should be
   calculated, not fixed.

2. **Unjustified complexity** — if the flags show `volatile: true` or
   `crossSheetRefs` is high, ask whether the formula's actual job needs
   that. A volatile function (OFFSET/INDIRECT/NOW/TODAY) used where a
   static reference would work is worth flagging; used for a genuine
   dynamic-window calculation is fine.

3. **Suspicious IFERROR usage** — `iferror: true` on a formula performing a
   critical calculation (not a lookup with an expected miss) may be masking
   a real error rather than handling an expected edge case. You cannot see
   what the wrapped error actually is — flag as uncertain, not fail, unless
   the formula text itself gives a clear reason to suspect masking.

4. **Sign, operator or reference anomalies** you can identify directly from
   the formula text and label — e.g. a subtraction where the label implies
   addition, a reference that looks like it's pointing at the wrong row
   given the label.

## What NOT to do

- Do not flag every hardcode, every IFERROR, or every cross-sheet reference
  by default — most complex formulas in a real model are complex for good
  reason. Only flag where the SPECIFIC combination of label, formula text
  and flags gives you a real, statable reason for concern.
- Do not guess at what a formula is "supposed" to do beyond what the label
  and surrounding context actually say. If you cannot tell, mark the result
  `uncertain`, not `fail` — do not manufacture a finding to have something
  to report.
- Do not re-review formulas outside this list — this task is scoped to
  exactly the items provided.

## Expected outcome

Most of these 40 formulas are complex for legitimate reasons and should
come back `pass` — a formula scoring high on Tier 0's mechanical complexity
scan is not the same as a formula being wrong. A handful of genuine findings
from a well-built model is a normal, expected result; forty findings from
forty items would suggest you are pattern-matching on the flags rather than
actually reasoning about each formula's logic.

## Output

Use the exact same JSON schema and field-length conventions documented
above for the standard review (`results` array, one object per formula
reviewed — include every item, even the ones that pass, so completeness of
review is auditable). Use ID prefix `T2-FDD-` (Formula Deep Dive), numbered
sequentially. Set `category` to `"Formula Logic"` and `workstream` to
`"Formula Review"` for every result from this task, so these are
identifiable as coming from this specific review pass.
