"""
A properly-designed, independently-tested MATCH() implementation matching
real Excel semantics, built to replace the fragile hand-rolled version.

Real Excel MATCH(lookup_value, lookup_array, [match_type]) rules:
- match_type = 1 (default): lookup_array assumed ascending. Returns the
  largest value <= lookup_value.
- match_type = 0: exact match, any order. Text lookup_value may contain
  wildcards (* = any sequence, ? = any single char, ~* / ~? = literal).
- match_type = -1: lookup_array assumed descending. Returns the smallest
  value >= lookup_value.
- Comparisons across types follow Excel's fixed type-order for approximate
  match: numbers < text < logical (FALSE < TRUE). Different types are
  NEVER equal to each other for exact match either (5 != "5").
- Text comparison in MATCH is case-insensitive.
- No match -> #N/A.
"""
import fnmatch


def _excel_type_rank(v):
    if isinstance(v, bool):
        return 2
    if isinstance(v, (int, float)):
        return 0
    if isinstance(v, str):
        return 1
    return 3  # None / error-shaped values sort last, never match


def _excel_compare(a, b):
    """-1, 0, or 1 for a vs b under Excel's approximate-match ordering."""
    ra, rb = _excel_type_rank(a), _excel_type_rank(b)
    if ra != rb:
        return -1 if ra < rb else 1
    if ra == 1:  # both text -> case-insensitive
        la, lb = a.lower(), b.lower()
        return -1 if la < lb else (1 if la > lb else 0)
    if ra == 3:  # both non-comparable -> never orderable
        return 0
    return -1 if a < b else (1 if a > b else 0)


def _excel_equal(a, b):
    """Exact-match equality: cross-type never equal; text is case-insensitive."""
    if type(a) is bool or type(b) is bool:
        return type(a) is bool and type(b) is bool and a == b
    if isinstance(a, str) and isinstance(b, str):
        return a.lower() == b.lower()
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return a == b
    return False


def _wildcard_to_match(pattern, value):
    if not isinstance(value, str):
        return False
    # Excel escapes: ~* and ~? mean literal * and ? ; translate to fnmatch
    # by temporarily protecting escaped chars.
    ESC_STAR, ESC_Q = '\x00STAR\x00', '\x00Q\x00'
    p = pattern.replace('~*', ESC_STAR).replace('~?', ESC_Q)
    p = p.replace('*', '\uffff').replace('?', '\ufffe')  # fnmatch-safe placeholders
    p = p.replace(ESC_STAR, fnmatch.translate('*')[:-1]).replace(ESC_Q, fnmatch.translate('?')[:-1])
    # Simplify: just build a straightforward glob translation manually.
    import re
    out = []
    i = 0
    while i < len(pattern):
        c = pattern[i]
        if c == '~' and i + 1 < len(pattern) and pattern[i+1] in '*?':
            out.append(re.escape(pattern[i+1]))
            i += 2
            continue
        if c == '*':
            out.append('.*')
        elif c == '?':
            out.append('.')
        else:
            out.append(re.escape(c))
        i += 1
    regex = '^' + ''.join(out) + '$'
    return re.match(regex, value, re.IGNORECASE) is not None


def excel_match(lookup_value, flat_array, match_type=1):
    """flat_array: a plain 1D python list, already flattened correctly by caller."""
    try:
        mt = int(match_type) if match_type not in (None,) else 1
    except (TypeError, ValueError):
        mt = 1

    if mt == 0:
        has_wildcard = isinstance(lookup_value, str) and any(c in lookup_value for c in '*?')
        for i, v in enumerate(flat_array):
            if has_wildcard:
                if _wildcard_to_match(lookup_value, v):
                    return i + 1
            elif _excel_equal(v, lookup_value):
                return i + 1
        return {'type': 'Error', 'kind': 'Na'}

    if mt == 1:
        best_idx = None
        for i, v in enumerate(flat_array):
            c = _excel_compare(v, lookup_value)
            if c <= 0:
                best_idx = i
            elif best_idx is not None:
                break
        return (best_idx + 1) if best_idx is not None else {'type': 'Error', 'kind': 'Na'}

    if mt == -1:
        best_idx = None
        for i, v in enumerate(flat_array):
            c = _excel_compare(v, lookup_value)
            if c >= 0:
                best_idx = i
            elif best_idx is not None:
                break
        return (best_idx + 1) if best_idx is not None else {'type': 'Error', 'kind': 'Na'}

    return {'type': 'Error', 'kind': 'Value'}


# ---- test suite ----
if __name__ == "__main__":
    tests_passed = 0
    tests_failed = 0

    def check(desc, actual, expected):
        global tests_passed, tests_failed
        ok = actual == expected
        print(f"{'PASS' if ok else 'FAIL'}: {desc} -> got {actual!r}, expected {expected!r}")
        if ok:
            tests_passed += 1
        else:
            tests_failed += 1

    # Exact match, numbers
    check("exact match number found", excel_match(3, [1, 2, 3, 4], 0), 3)
    check("exact match number not found", excel_match(9, [1, 2, 3], 0), {'type': 'Error', 'kind': 'Na'})

    # Exact match, text, case-insensitive
    check("exact match text case-insensitive", excel_match("Ofgem FD", ["ofgem fd", "ofgem dd"], 0), 1)

    # Exact match, cross-type never equal
    check("cross-type never equal", excel_match(5, ["5", "6", "7"], 0), {'type': 'Error', 'kind': 'Na'})

    # Exact match, mixed text/number row (the known Carlsberg/Hidden Gem gotcha)
    check("exact match mixed row finds correct number", excel_match(2022, ["Q1", 2021, 2022, 2023], 0), 3)
    check("exact match mixed row finds correct text", excel_match("Total", ["Q1", 2021, "Total", 2023], 0), 3)

    # Approximate match ascending (match_type=1) - classic date lookup
    dates = [2002, 2003, 2004, 2005, 2019, 2020]
    check("approx match exact hit", excel_match(2019, dates, 1), 5)
    check("approx match between values", excel_match(2010, dates, 1), 4)
    check("approx match below range", excel_match(1999, dates, 1), {'type': 'Error', 'kind': 'Na'})
    check("approx match above range", excel_match(2030, dates, 1), 6)

    # Approximate match descending (match_type=-1)
    dates_desc = [2020, 2019, 2005, 2004, 2003, 2002]
    check("approx desc match exact hit", excel_match(2019, dates_desc, -1), 2)
    check("approx desc match between values", excel_match(2010, dates_desc, -1), 2)

    # Approximate match with mixed types (numbers rank below text below bool)
    mixed = [1, 2, "a", "b", True]
    check("approx match numbers-only region", excel_match(1.5, mixed, 1), 1)
    check("approx match crosses into text region", excel_match("aa", mixed, 1), 3)

    # Wildcard match (match_type=0, text with wildcards)
    check("wildcard star match", excel_match("Sc*", ["Scenario 1", "Other"], 0), 1)
    check("wildcard question match", excel_match("A?C", ["ABC", "AXC", "ABD"], 0), 1)
    check("wildcard escaped literal", excel_match("A~*B", ["A*B", "AxB"], 0), 1)

    print(f"\n{tests_passed} passed, {tests_failed} failed")
