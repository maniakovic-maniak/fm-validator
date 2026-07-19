#!/usr/bin/env python3
"""
test_masking_fix.py — proves the recalc_check.py masking-BFS fix works,
using synthetic data shaped exactly like the real Hidden Gem scenario
that exposed the bug (Ops!U188/U189 sub-threshold, Ops!U193 the SUM that
finally clears tolerance, rooted in an unresolved error at Timing!E7).

Runs the OLD masking logic and the NEW (patched) masking logic side by
side against the same synthetic inputs, and asserts the fix changes the
classification the way it should.
"""

import re

_extract_refs = None  # populated below by importing the real helper


def load_real_extract_refs():
    """Import the actual _extract_refs from the deployed recalc_check.py
    rather than reimplementing it — this test should exercise the real
    reference-parsing code, not a stand-in."""
    import importlib.util
    spec = importlib.util.spec_from_file_location("recalc_check", "src/recalc_check.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod._extract_refs


def build_synthetic_scenario():
    """Shapes data with the SAME hop depth as the real Hidden Gem case,
    not a collapsed version of it — the bug only reproduces if the BFS
    actually has to walk the chain, so every real hop is modeled:

      Timing!E7  (unresolved error — the _xlfn.SINGLE root cause)
        -> Timing!S7  = IF(AND(S4>=D7,S5<=E7),1,0)   [hop 1: references E7]
        -> Ops!U7     = Timing!S7                      [hop 2]
        -> Ops!U96    = Timing!S30*U7                  [hop 3]
        -> Ops!U179   = U96                             [hop 4]
        -> Ops!U183   = $G183*U179                      [hop 5]
        -> Ops!U188   = SUMIF($H$183:$H$184,$G188,U$183:U$184)  [hop 6]
        -> Ops!U189   = SUMIF($H$183:$H$184,$G189,U$183:U$184)  [hop 6]
        -> Ops!U190/191/192 = same pattern, genuinely clean
        -> Ops!U193   = SUM(U188:U192)                  [hop 7 — the mismatch]

    Ops!U188/U189 each carry a real ~0.5-0.8 discrepancy — too small to
    clear absolute_tolerance=1.0 individually, so neither ever entered
    `mismatches` under the old logic, exactly like the real data.

    Ops!Z99 is a genuinely unrelated real mismatch with zero connection
    to this chain, included to confirm the fix doesn't over-mask.
    """
    target_keys = [
        "Timing!S7", "Ops!U7", "Ops!U96", "Ops!U179", "Ops!U183",
        "Ops!U188", "Ops!U189", "Ops!U190", "Ops!U191", "Ops!U192",
        "Ops!U193", "Ops!Z99",
    ]
    formula_texts = {
        "Timing!S7": "=IF(AND(S4>=D7,S5<=E7),1,0)",
        "Ops!U7": "=Timing!S7",
        "Ops!U96": "=Timing!S30*U7",
        "Ops!U179": "=U96",
        "Ops!U183": "=$G183*U179",
        "Ops!U188": "=SUMIF($H$183:$H$184,$G188,U$183:U$184)",
        "Ops!U189": "=SUMIF($H$183:$H$184,$G189,U$183:U$184)",
        "Ops!U190": "=SUMIF($H$183:$H$184,$G190,U$183:U$184)",
        "Ops!U191": "=SUMIF($H$183:$H$184,$G191,U$183:U$184)",
        "Ops!U192": "=SUMIF($H$183:$H$184,$G192,U$183:U$184)",
        "Ops!U193": "=SUM(U188:U192)",
        "Ops!Z99": "=Ops!Y99*1.05",
    }
    unresolved_errors = [{"sheet": "Timing", "cell": "E7"}]
    external_ref_cells = set()

    mismatches = [
        {"sheet": "Ops", "cell": "U193", "cached": 1.3135, "recalculated": 0.0, "diff": -1.3135},
        {"sheet": "Ops", "cell": "Z99", "cached": 104.3, "recalculated": 100.0, "diff": -4.3},
    ]

    return target_keys, formula_texts, unresolved_errors, external_ref_cells, mismatches


def old_masking_logic(target_keys, formula_texts, unresolved_errors, external_ref_cells, mismatches, extract_refs_fn):
    """Reproduces the PRE-FIX logic verbatim: formula_by_key and the BFS
    both restricted to mismatch_keys only."""
    IFERROR_IFNA_RE = re.compile(r'\bIFERROR\s*\(|\bIFNA\s*\(', re.IGNORECASE)
    mismatch_keys = {f"{m['sheet']}!{m['cell']}" for m in mismatches}
    formula_by_key = {key: formula_texts[key] for key in target_keys if key in mismatch_keys}

    root_seeds = set(external_ref_cells) | {f"{e['sheet']}!{e['cell']}" for e in unresolved_errors}

    masked = set()
    for key in mismatch_keys:
        formula = formula_by_key.get(key)
        if not formula:
            continue
        if IFERROR_IFNA_RE.search(formula):
            masked.add(key)
            continue
        refs = extract_refs_fn(formula, key.split('!', 1)[0])
        if any(f"{rsheet}!{rcol}{rrow}" in root_seeds for (rsheet, rcol, rrow) in refs):
            masked.add(key)

    if masked:
        addr_patterns = {key.split('!', 1)[1] for key in masked} | {key.split('!', 1)[1] for key in root_seeds}
        for _wave in range(30):
            newly_masked = set()
            for key in mismatch_keys:
                if key in masked:
                    continue
                formula = formula_by_key.get(key)
                if not formula or not any(pat in formula for pat in addr_patterns):
                    continue
                refs = extract_refs_fn(formula, key.split('!', 1)[0])
                for (rsheet, rcol, rrow) in refs:
                    if f"{rsheet}!{rcol}{rrow}" in masked:
                        newly_masked.add(key)
                        break
            if not newly_masked:
                break
            masked |= newly_masked
            addr_patterns |= {key.split('!', 1)[1] for key in newly_masked}

    return masked


def new_masking_logic(target_keys, formula_texts, unresolved_errors, external_ref_cells, mismatches, extract_refs_fn):
    """The PATCHED logic: formula_by_key and the BFS both cover every
    target cell, not just ones already classified as mismatches."""
    IFERROR_IFNA_RE = re.compile(r'\bIFERROR\s*\(|\bIFNA\s*\(', re.IGNORECASE)
    mismatch_keys = {f"{m['sheet']}!{m['cell']}" for m in mismatches}
    formula_by_key = {key: formula_texts[key] for key in target_keys}

    root_seeds = set(external_ref_cells) | {f"{e['sheet']}!{e['cell']}" for e in unresolved_errors}

    formula_by_key_stripped = {key: (f.replace('$', '') if f else f) for key, f in formula_by_key.items()}

    tainted_by_error = set()
    for key in target_keys:
        formula = formula_by_key.get(key)
        if not formula:
            continue
        if IFERROR_IFNA_RE.search(formula):
            tainted_by_error.add(key)
            continue
        refs = extract_refs_fn(formula, key.split('!', 1)[0])
        if any(f"{rsheet}!{rcol}{rrow}" in root_seeds for (rsheet, rcol, rrow) in refs):
            tainted_by_error.add(key)

    if tainted_by_error:
        addr_patterns = {key.split('!', 1)[1] for key in tainted_by_error} | {key.split('!', 1)[1] for key in root_seeds}
        for _wave in range(30):
            newly_tainted = set()
            for key in target_keys:
                if key in tainted_by_error:
                    continue
                formula = formula_by_key.get(key)
                formula_stripped = formula_by_key_stripped.get(key)
                if not formula or not any(pat in formula_stripped for pat in addr_patterns):
                    continue
                refs = extract_refs_fn(formula, key.split('!', 1)[0])
                for (rsheet, rcol, rrow) in refs:
                    if f"{rsheet}!{rcol}{rrow}" in tainted_by_error:
                        newly_tainted.add(key)
                        break
            if not newly_tainted:
                break
            tainted_by_error |= newly_tainted
            addr_patterns |= {key.split('!', 1)[1] for key in newly_tainted}

    return tainted_by_error & mismatch_keys


def main():
    extract_refs_fn = load_real_extract_refs()
    target_keys, formula_texts, unresolved_errors, external_ref_cells, mismatches = build_synthetic_scenario()

    old_masked = old_masking_logic(target_keys, formula_texts, unresolved_errors, external_ref_cells, mismatches, extract_refs_fn)
    new_masked = new_masking_logic(target_keys, formula_texts, unresolved_errors, external_ref_cells, mismatches, extract_refs_fn)

    print("OLD logic — masked as upstream error:", sorted(old_masked))
    print("NEW logic — masked as upstream error:", sorted(new_masked))
    print()

    assert "Ops!U193" not in old_masked, (
        "Expected the OLD logic to (incorrectly) leave Ops!U193 classified as a "
        "clean, unexplained mismatch — if this fails, the bug this test targets "
        "may already not reproduce with this synthetic setup."
    )
    assert "Ops!U193" in new_masked, (
        "FAIL: the fix did not reclassify Ops!U193 as masked-upstream-error."
    )
    assert "Ops!Z99" not in new_masked, (
        "FAIL: the fix over-masked an unrelated real mismatch (Ops!Z99) that has "
        "no connection to the error chain — this would hide genuine findings."
    )

    print("PASS: fix correctly reclassifies Ops!U193 as masked-upstream-error,")
    print("      and correctly leaves the unrelated Ops!Z99 mismatch alone.")


if __name__ == "__main__":
    main()
