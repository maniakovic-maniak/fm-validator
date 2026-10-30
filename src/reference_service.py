"""Shared reference reading for the recalculation check - the Python side of src/utils/reference-service.js.

The two files read references by the same rules, so a formula means the same thing to the JavaScript checks and to
the recalculation taint tracer:

  * string literals are removed before any reference is read ("C99" in IF(B1="C99",...) is text, not a cell);
  * a range is a range. Up to ``max_range_cells`` cells it is expanded into cells, as before. Above that it is kept as
    a rectangle in ``Refs.big_ranges`` instead of being dropped, and ``BigRanges`` answers "does any of these cells
    sit inside a range this formula reads?" so taint still reaches a SUM over thousands of cells;
  * 3-D references (Jan:Dec!B5) are expanded across the sheets between the two tabs.

Nothing here evaluates anything. It reads formula text only.
"""
import re

_CELL_REF_RE = re.compile(
    r"(?:(?:'([^']+)'|([A-Za-z0-9_]+))!)?\$?([A-Za-z]{1,3})\$?(\d+)(?::\$?([A-Za-z]{1,3})\$?(\d+))?"
)

# 3-D references like =SUM(Jan:Dec!B5) are matched and masked out before the single-sheet pattern runs, so
# "Sheet1:Sheet3!B3" cannot be corrupt-matched as the cell EET1 on the current sheet.
_SHEET_RANGE_REF_RE = re.compile(
    r"(?:'([^']+)'|([A-Za-z0-9_]+)):(?:'([^']+)'|([A-Za-z0-9_]+))!"
    r"\$?([A-Za-z]{1,3})\$?(\d+)(?::\$?([A-Za-z]{1,3})\$?(\d+))?"
)

_STRING_RE = re.compile(r'"(?:[^"]|"")*"')
_KEY_RE = re.compile(r'^(.*)!([A-Z]+)(\d+)$')

DEFAULT_MAX_RANGE_CELLS = 2000


def col_to_num(col):
    n = 0
    for ch in col:
        n = n * 26 + (ord(ch) - 64)
    return n


def num_to_col(n):
    s = ''
    while n > 0:
        n, rem = divmod(n - 1, 26)
        s = chr(65 + rem) + s
    return s


def sheets_in_span(sheet1, sheet2, sheet_order):
    """Every sheet from sheet1 to sheet2 inclusive, in actual tab order (what "Jan:Dec!B5" means in Excel). Falls back
    to the two named sheets when the order is unknown: degraded, but not corrupted."""
    if sheet_order and sheet1 in sheet_order and sheet2 in sheet_order:
        i1, i2 = sheet_order.index(sheet1), sheet_order.index(sheet2)
        lo, hi = (i1, i2) if i1 <= i2 else (i2, i1)
        return sheet_order[lo:hi + 1]
    return [sheet1, sheet2] if sheet1 != sheet2 else [sheet1]


def mask_strings(formula):
    """Blank out string literals, keeping every other character in place."""
    return _STRING_RE.sub(lambda m: ' ' * len(m.group(0)), formula)


class Refs(set):
    """The cells a formula reads, as (sheet, column letters, row). ``big_ranges`` holds the rectangles that were too
    large to expand, as (sheet, c1, r1, c2, r2) with numeric columns."""

    def __init__(self):
        super().__init__()
        self.big_ranges = []

    def cell_count(self):
        """Cells covered, counting a kept range by its area. For tests and disclosure."""
        return len(self) + sum((c2 - c1 + 1) * (r2 - r1 + 1) for (_s, c1, r1, c2, r2) in self.big_ranges)


def extract_refs(formula, current_sheet, sheet_order=None, max_range_cells=DEFAULT_MAX_RANGE_CELLS):
    refs = Refs()

    def add_range(sheet, col1, row1, col2, row2):
        c1, c2 = sorted([col_to_num(col1.upper()), col_to_num(col2.upper())])
        r1, r2 = sorted([int(row1), int(row2)])
        if (c2 - c1 + 1) * (r2 - r1 + 1) > max_range_cells:
            refs.big_ranges.append((sheet, c1, r1, c2, r2))
            return
        for c in range(c1, c2 + 1):
            for r in range(r1, r2 + 1):
                refs.add((sheet, num_to_col(c), r))

    text = mask_strings(formula)

    # Pass 1: 3-D (multi-sheet) references, masked out of the text before the single-sheet pattern runs.
    masked = text
    for m in _SHEET_RANGE_REF_RE.finditer(text):
        q1, b1, q2, b2, col1, row1, col2, row2 = m.groups()
        sheet1 = (q1 or b1).strip()
        sheet2 = (q2 or b2).strip()
        for sheet in sheets_in_span(sheet1, sheet2, sheet_order):
            if col2 and row2:
                add_range(sheet, col1, row1, col2, row2)
            else:
                refs.add((sheet, col1.upper(), int(row1)))
        start, end = m.span()
        masked = masked[:start] + (' ' * (end - start)) + masked[end:]

    # Pass 2: ordinary references, over the masked text.
    for m in _CELL_REF_RE.finditer(masked):
        quoted_sheet, bare_sheet, col1, row1, col2, row2 = m.groups()
        sheet = (quoted_sheet or bare_sheet or current_sheet).strip()
        if col2 and row2:
            add_range(sheet, col1, row1, col2, row2)
        else:
            refs.add((sheet, col1.upper(), int(row1)))
    return refs


class BigRanges:
    """Dependents of ranges that were kept as rectangles. ``add`` registers a formula's big ranges; ``hit_by`` returns
    the formulas that read a range containing any of the given cells, and retires those ranges (a range that has
    already passed its taint on has nothing more to give)."""

    def __init__(self):
        self.by_range = {}

    def add(self, refs, dependent_key):
        for rng in getattr(refs, 'big_ranges', ()):
            self.by_range.setdefault(rng, []).append(dependent_key)

    def __bool__(self):
        return bool(self.by_range)

    def hit_by(self, cell_keys):
        """-> {dependent: "Sheet!A1" of a given cell inside a range it reads}. Retires the ranges that were hit."""
        out = {}
        if not self.by_range:
            return out
        pts = {}
        for k in cell_keys:
            m = _KEY_RE.match(k)
            if m:
                pts.setdefault(m.group(1), []).append((col_to_num(m.group(2)), int(m.group(3)), k))
        if not pts:
            return out
        for rng in list(self.by_range):
            sheet, c1, r1, c2, r2 = rng
            for (c, r, k) in pts.get(sheet, ()):
                if c1 <= c <= c2 and r1 <= r <= r2:
                    for d in self.by_range.pop(rng):
                        out.setdefault(d, k)
                    break
        return out

    def first_hit(self, cell_keys):
        """Like hit_by, but returns {dependent: "Sheet!A1" of a cell inside the range} and does NOT retire the ranges,
        for seeding with a label."""
        res = {}
        pts = {}
        for k in cell_keys:
            m = _KEY_RE.match(k)
            if m:
                pts.setdefault(m.group(1), []).append((col_to_num(m.group(2)), int(m.group(3)), k))
        for (sheet, c1, r1, c2, r2), deps in self.by_range.items():
            for (c, r, k) in pts.get(sheet, ()):
                if c1 <= c <= c2 and r1 <= r <= r2:
                    for d in deps:
                        res.setdefault(d, k)
                    break
        return res
