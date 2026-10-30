#!/usr/bin/env python3
"""
recalc_check.py — A1: real formula recalculation vs. cached values,
using Formualizer (github.com/PSU3D0/formualizer, verified real and MIT
licensed).

Three real, distinct problems were found and fixed via direct testing
against real files, in order of discovery:

1. CIRCULARITY CONFIGURATION. Formualizer's high-level recalculate_file()
   convenience function uses cycle_detection="static" by default, which
   stamps EVERY circular reference as a #CIRC! error rather than
   attempting Excel-style iterative resolution. Against The Bend (a real
   project-finance model with a genuine, intentional iterative
   circularity — see this project's own G7 check), this produced 916
   entirely false "errors" on the first test run. This script ALWAYS
   configures cycle_policy="iterate" explicitly via the lower-level
   Workbook API.

2. EXTERNAL WORKBOOK REFERENCES. A formula like '[1]SheetName'!$A$1
   references another file this workbook doesn't have loaded.
   Formualizer 0.7.1's evaluate_all() treats hitting even ONE such
   unresolvable reference as fatal for the ENTIRE evaluation — every
   other cell comes back None afterward, even cells unrelated to the
   external link. Confirmed via testing against Hidden Gem, a real
   mining model. Fixed by pre-scanning with openpyxl for the '[N]'
   bracket pattern and neutralizing those specific cells via
   Formualizer's own set_value() mutation API before evaluate_all() runs.
   Neutralized cells are tracked separately and always excluded from the
   mismatch comparison — their value is fabricated, never a genuine
   recalculation.

3. SCALE. Also discovered via Hidden Gem, a real mining model with
   1,152,793 formula cells (vs. 15,690 for The Bend): two design choices
   that work fine at Bend's scale fail badly at Hidden Gem's.
     a. openpyxl's DEFAULT (non-read_only) mode builds a full in-memory
        object tree — combined with Formualizer's own ~1.4GB load for
        the same file, this caused an out-of-memory kill with no error
        output at all. read_only=True uses a streaming parser instead,
        confirmed via direct testing to use ~55MB combined for both
        loads on the same file — now the PRIMARY approach, not a
        fallback. It also happens to use a more lenient XML parser that
        resolved a separate "invalid XML" failure on this same file.
     b. Looping through individual wb.evaluate_cell() calls is fine for
        15,690 cells (~20s) but would take over 40 MINUTES at Hidden
        Gem's scale (confirmed: ~2.26ms/cell). The batch wb.evaluate_cells()
        call is ~300x faster (confirmed: ~0.008ms/cell) — the same
        1.15M-cell comparison drops to single-digit seconds. Similarly,
        RANDOM cell access into a read_only-mode workbook (e.g.
        ws['J75'].value repeatedly) is catastrophically slow in
        read_only mode (confirmed: ~12.6ms per access — over 4 HOURS at
        1.15M cells) because it isn't built for random access; PARALLEL
        SEQUENTIAL iteration over both workbooks via zip(iter_rows(),
        iter_rows()) is the correct pattern and is fast (confirmed:
        ~2.3s for 15,690 cells).

With all three fixes applied: The Bend (15,690 cells, 20 genuine
circular groups) and Carlsberg (5,665 cells) both return 0 mismatches
and 0 errors — a clean baseline. Testing against Hidden Gem specifically
motivated fixes 2 and 3; re-confirm against it after any future change
to this script, since it is the only real file tested so far that
exercises the external-reference and scale code paths at all.

4. UNSUPPORTED MODERN EXCEL FUNCTIONS. Formualizer 0.7.1's function
   registry does not recognize several functions introduced with
   Excel's dynamic-array era. Confirmed individually, each via multiple
   independent test shapes (not a one-off argument-shape mistake):
     a. _xlfn.SINGLE — Excel's serialized form of the "@" implicit-
        intersection operator. Formualizer DOES support the "@" operator
        itself (confirmed: "=@A1" evaluates correctly) but does not
        recognize the literal function name "_xlfn.SINGLE" as an alias
        for it — {'type': 'Error', 'kind': 'Name'}. Root-caused live
        against Hidden Gem: this is what silently zeroed out Ops!U193
        and 50 related cells (see the masking-BFS fix history below) —
        Timing!E7 = _xlfn.SINGLE(Ops_end) failed with a Name error, and
        that error propagated through several formula hops before being
        silently absorbed by a SUM()/SUMIF() into a plausible-looking
        0.0, rather than surfacing as an error at the top level.
     b. LAMBDA — returns Formualizer's own explicit
        {'type': 'Error', 'kind': 'NImpl'} (Not Implemented) for the
        realistic inline-invoked usage pattern ("=LAMBDA(x,x*2)(A1)") —
        a genuinely different signal from "unrecognized name": Formualizer
        knows about LAMBDA and has explicitly marked it unimplemented,
        not merely unrecognized.
     c. EXPAND — {'type': 'Error', 'kind': 'Name'}, confirmed across
        three independent argument shapes (with and without the optional
        pad-value argument, and a 1x1-to-2x2 expansion).
   Any model using one of these will have that formula silently produce
   a wrong-but-plausible recalculated value if the error is absorbed by
   a downstream SUM()/SUMIF() before reaching a target cell being
   compared — exactly the class of bug the masking-BFS fixes below exist
   to correctly attribute rather than report as an unexplained mismatch.
   No code-level workaround applied here (unlike fixes 1-3 above) — this
   is a genuine Formualizer limitation to track, not something this
   script can neutralize the way external references are neutralized,
   since (unlike an external reference) there's no way to know in
   advance which specific cells in a real file use one of these
   functions without already having tried to evaluate them.

5. ARRAY-CAPABLE FUNCTIONS THROWING #SPILL! UNCONDITIONALLY. Found
   during a real production incident investigation (ESO Licence Model,
   Fm-00028/Fm-00029): Formualizer 0.8.4's NATIVE implementations of
   CELL(), INDEX() (single-row and single-column argument shapes),
   CHOOSE(), YEAR() (applied to a range — Excel implicitly array-
   evaluates YEAR(range)), and PRODUCT() each throw
   "#SPILL!: BlockedByFormula [spill NxM]" — an EXCEPTION that aborts
   the entire evaluate_all() pass, not merely a per-cell error value —
   confirmed directly, repeatedly, in total isolation (a fresh one-line
   workbook, zero real cell conflict) for every one of these.
     Fix: Formualizer's wb.register_function(name, callback,
     allow_override_builtin=True) replaces the native implementation
     with a correct Python one, workbook-wide — see CELL_OVERRIDE,
     INDEX_OVERRIDE, CHOOSE_OVERRIDE, YEAR_OVERRIDE, PRODUCT_OVERRIDE,
     and MATCH_OVERRIDE (using the independently unit-tested
     excel_match() from match_impl.py — 17 cases covering exact/
     approximate/mixed-type/wildcard behavior) below.
     IMPORTANT CAVEAT, found via direct testing: register_function's
     own argument evaluation is unconditionally EAGER — even a
     correctly-lazy IF() override cannot prevent a nested call in the
     untaken branch from being evaluated and throwing. Tested and
     confirmed this does NOT provide true short-circuit protection;
     no IF() override is applied here for that reason (would add
     complexity without a verified benefit). This eager-evaluation
     behavior is also WHY fix #6 below was hard to isolate — an
     IF()'s "dead" branch still throws, so tracing only the branch a
     condition actually selects can lead an investigation to the wrong
     cell entirely; both branches must be checked independently.
     A SEPARATE, confirmed-DIFFERENT limitation: OFFSET() and other
     reference-taking functions (as opposed to value-taking ones)
     bypass register_function's dispatch entirely — the callback is
     never invoked at all, confirmed directly. These cannot be fixed
     via override and instead use the SAME pre-scan/neutralize pattern
     as fix #2 above (see OFFSET_RE below).

6. BARE (UNWRAPPED) REFERENCES TO MULTI-CELL NAMED RANGES. The actual
   remaining root cause behind fix #5's own residual failures — found
   only after confirming fix #5 alone did NOT close the gap (a further
   #SPILL! persisted, shape "1x25" rather than "1x5"). A formula that
   is exactly "=SomeMultiCellName" or uses that name directly in an
   expression (e.g. "=A1 * SomeMultiCellName") with NO @ operator and
   no INDEX() wrapping it, where SomeMultiCellName is a real workbook-
   scoped defined name spanning more than one cell, is Excel's
   implicit-intersection pattern — real Excel silently resolves it to
   a single value; Formualizer's native handling does not and throws.
   Root-caused via direct tracing against the real ESO Licence Model:
   AR!AT26 = "=ESOpf" (ESOpf being a genuine 1-row x 25-column named
   range, SystemOperator!V138:AT138 — note this matches the "1x25"
   shape in the exception EXACTLY, unlike fix #5's shapes which are
   fixed artifacts of the buggy code path, not real computed
   dimensions). Confirmed NOT an isolated cell: a full-workbook scan
   found 611 bare uses of 66 different multi-cell named ranges (ESOpf
   alone: 376 uses) — this is the dominant pattern across the file, not
   a one-off. Fix: pre-scan every formula for a bare reference to any
   workbook-scoped named range whose own span covers more than one
   cell, excluding any occurrence immediately preceded by "INDEX(" or
   "@" (both are the correctly-wrapped, non-buggy forms) — see
   MULTICELL_NAME_RE and the named-range-lookup block in run() below.
   Neutralized the same way as external references and OFFSET() (fix
   #2/#5): set_value() to the real cached value, taint-traced
   downstream. Confirmed via direct, repeated testing against the real
   ESO Licence Model with fixes #1 through #6 all applied together:
   evaluate_all() succeeds, and per-sheet isolation testing confirms
   all 17 sheets evaluate cleanly with zero remaining #SPILL! errors —
   this is not a partial result; re-tested from a fresh Workbook.
   from_path() load to rule out any residual state from prior tests.

Usage:
    python3 recalc_check.py path/to/workbook.xlsx
    (outputs a JSON summary to stdout)
"""

import sys
import json
import time
import re
import os
import math
import warnings
import datetime
import match_impl

# Confirmed via direct inspection of openpyxl's own source
# (openpyxl/worksheet/_reader.py): when a date-formatted cell's cached
# value is NaN (see the _cast_number patch below for why that value can
# legitimately be NaN in the first place), openpyxl tries to convert it
# to a date via from_excel(), which correctly raises on NaN — and
# openpyxl's OWN try/except catches that internally, sets the cell to
# "#VALUE!", and emits this warning purely for information. It is not a
# sign of a problem this script needs to react to. At real-file scale
# (hundreds+ of affected cells in one sheet observed in testing) this
# was flooding stderr with no functional benefit — suppressed here.
warnings.filterwarnings('ignore', message=r'.*is marked as a date but the serial value.*')

try:
    import openpyxl
    # openpyxl's internal number parser (_cast_number) only recognizes a
    # float by the presence of '.', 'E', or 'e' in the text, and falls
    # through to int(value) otherwise — which crashes on 'NaN',
    # 'Infinity', and '-Infinity', all valid IEEE-754 values Excel can
    # legitimately cache as a formula's result (e.g. certain invalid
    # statistical operations). Confirmed via a real crash against Hidden
    # Gem: this happens deep inside openpyxl's internal row-parsing
    # generator, where a per-cell try/except in THIS script can't catch
    # it without losing every other cell in the same row generator —
    # patched at the source instead, before any workbook is loaded.
    import openpyxl.worksheet._reader as _oxl_reader

    _original_cast_number = _oxl_reader._cast_number

    def _patched_cast_number(value):
        if value in ('NaN', 'nan'):
            return float('nan')
        if value in ('Infinity', 'INF'):
            return float('inf')
        if value in ('-Infinity', '-INF'):
            return float('-inf')
        return _original_cast_number(value)

    _oxl_reader._cast_number = _patched_cast_number
except ImportError:
    openpyxl = None  # handled by the existing "unavailable" check below

try:
    import formualizer as fz
except ImportError:
    print(json.dumps({"status": "unavailable", "reason": "formualizer not installed"}))
    sys.exit(0)

if openpyxl is None:
    print(json.dumps({"status": "unavailable", "reason": "openpyxl not installed"}))
    sys.exit(0)

EXTERNAL_REF_RE = re.compile(r'\[\d+\]')

# fix #5 (see module docstring) — OFFSET() is reference-taking and
# cannot be fixed via register_function (its callback is never
# invoked, confirmed directly) — same pre-scan/neutralize pattern as
# EXTERNAL_REF_RE above.
OFFSET_RE = re.compile(r'OFFSET\s*\(', re.IGNORECASE)


def _as_2d(a):
    """Normalize a Formualizer array argument (which may arrive as a
    scalar, a flat list, or a list-of-lists) into a consistent 2D grid."""
    if isinstance(a, list):
        return a if (a and isinstance(a[0], list)) else [[v] for v in a]
    return [[a]]


def _flatten_1d(a):
    """Correctly flatten a single-row OR single-column 2D grid into a
    1D list, in reading order. A prior version of this logic (found and
    fixed via direct testing this session) silently mishandled the
    single-row case, taking only its first element."""
    grid = _as_2d(a)
    if len(grid) == 1:
        return list(grid[0])
    return [row[0] for row in grid]


def cell_override(info_type=None, *rest):
    """CELL() — Formualizer's native implementation throws #SPILL! for
    EVERY info_type unconditionally (confirmed: filename, address, row,
    col, contents, type, width all reproduce this in total isolation).
    Only "filename" has real callers in practice; other info_types
    return a safe placeholder rather than the exception."""
    it = str(info_type).lower() if info_type is not None else 'contents'
    if it == 'filename':
        return f"C:\\Users\\[{os.path.basename(_CURRENT_WORKBOOK_PATH)}]Sheet1"
    return 0


def index_override(array, row_num=None, col_num=None):
    """INDEX() — Formualizer's native implementation mishandles the
    single-row and single-column cases when only one positional index
    argument is given (ambiguous whether it's a row or column index).
    Real Excel rule: if the array has only one row or one column, the
    lone index applies to whichever dimension actually has more than
    one member."""
    grid = _as_2d(array)
    n_rows, n_cols = len(grid), (len(grid[0]) if grid else 0)
    r = int(row_num) if row_num not in (None, 0) else None
    c = int(col_num) if col_num not in (None, 0) else None
    try:
        if r is not None and c is not None:
            return grid[r-1][c-1]
        if r is not None and c is None:
            if n_rows == 1 and n_cols > 1:
                return grid[0][r-1]           # single row -> index is column-wise
            if n_cols == 1:
                return grid[r-1][0]           # single column -> index is row-wise
            return [grid[r-1]]                # true 2D array, row given -> whole row
        if c is not None and r is None:
            if n_cols == 1 and n_rows > 1:
                return grid[c-1][0]
            if n_rows == 1:
                return grid[0][c-1]
            return [row[c-1] for row in grid]
    except (IndexError, TypeError):
        return {'type': 'Error', 'kind': 'Ref'}
    return {'type': 'Error', 'kind': 'Value'}


def choose_override(index_num, *values):
    """CHOOSE() — same array-mishandling class as CELL()/INDEX()."""
    try:
        i = int(index_num)
        return values[i-1] if 1 <= i <= len(values) else {'type': 'Error', 'kind': 'Value'}
    except (TypeError, ValueError):
        return {'type': 'Error', 'kind': 'Value'}


def match_override(lookup_value, lookup_array, match_type=1):
    """MATCH() — delegates to the independently unit-tested implementation
    in match_impl.py (17 test cases: exact match, case-insensitivity,
    cross-type ordering rules, mixed text/number rows, ascending/
    descending approximate match, wildcards)."""
    flat = _flatten_1d(lookup_array) if isinstance(lookup_array, list) else [lookup_array]
    return match_impl.excel_match(lookup_value, flat, match_type)


def _year_of(v):
    if isinstance(v, (datetime.date, datetime.datetime)):
        return v.year
    if isinstance(v, (int, float)):
        try:
            base = datetime.date(1899, 12, 30)
            return (base + datetime.timedelta(days=v)).year
        except (OverflowError, ValueError):
            return {'type': 'Error', 'kind': 'Value'}
    return {'type': 'Error', 'kind': 'Value'}


def year_override(serial_or_array):
    """YEAR() — real Excel implicitly array-evaluates YEAR(range),
    mapping over every cell; Formualizer's native version doesn't
    handle this and throws #SPILL! instead."""
    if isinstance(serial_or_array, list):
        grid = _as_2d(serial_or_array)
        return [[_year_of(v) for v in row] for row in grid]
    return _year_of(serial_or_array)


def product_override(*args):
    """PRODUCT() — same array-mishandling class."""
    result, any_num = 1.0, False
    for a in args:
        vals = _flatten_1d(a) if isinstance(a, list) else [a]
        for v in vals:
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                result *= v
                any_num = True
    return result if any_num else 0.0


def _build_multicell_name_re(wb):
    """fix #6 (see module docstring) — a bare (unwrapped) reference to a
    workbook-scoped named range spanning more than one cell is Excel's
    implicit-intersection pattern; Formualizer's native handling throws
    #SPILL! on it. Returns a compiled regex matching any such name as a
    whole word, or None if the workbook has no multi-cell named ranges
    at all (regex alternation would otherwise be empty/invalid)."""
    names = wb.get_named_ranges()
    multicell = [n['name'] for n in names
                 if n.get('kind') == 'range'
                 and (n['end_row'] - n['start_row'] + 1) * (n['end_col'] - n['start_col'] + 1) > 1]
    if not multicell:
        return None
    return re.compile(r'\b(' + '|'.join(re.escape(n) for n in multicell) + r')\b')


def _is_bare_multicell_reference(formula_text, multicell_name_re):
    """True if formula_text uses a multi-cell named range without the
    correctly-wrapped forms (INDEX(...) or the @ implicit-intersection
    operator) immediately preceding the name."""
    if multicell_name_re is None:
        return False
    for m in multicell_name_re.finditer(formula_text):
        before = formula_text[:m.start()]
        if 'INDEX(' in before.upper()[-30:] or formula_text[max(0, m.start()-1):m.start()] == '@':
            continue
        return True
    return False

# Confirmed via real testing against Hidden Gem: neutralizing an
# external-reference cell to 0 (see fix #2 in the module docstring)
# correctly avoids the crash, but that fabricated 0 propagates through
# the dependency graph — any cell that references a neutralized cell,
# directly or transitively, inherits the same fabricated value. Without
# tracing this, such cells show up as "mismatches" against their real
# cached value (which reflects the actual external data) even though
# nothing is genuinely wrong with their formula — a real, confirmed
# false-positive class (4,155 cells on a single sheet in one real test,
# all recalculating to exactly 0.0). This section traces forward from
# each neutralized cell to find everything downstream and excludes it
# from the comparison too, not just the neutralized cells themselves.

import reference_service as _refsvc

# Reference reading lives in reference_service.py, the Python side of src/utils/reference-service.js: string literals
# are removed first, 3-D references are expanded across the sheets between the two tabs, and a range above
# max_range_cells is kept as a rectangle (Refs.big_ranges) rather than dropped.
_col_to_num = _refsvc.col_to_num
_num_to_col = _refsvc.num_to_col
_sheets_in_span = _refsvc.sheets_in_span
_extract_refs = _refsvc.extract_refs


def _jsonable(v):
    """A cell value in a form json.dumps accepts (dates become ISO text; everything else is passed through)."""
    if v is None or isinstance(v, (bool, int, float, str)):
        return v
    try:
        return v.isoformat()
    except Exception:
        return str(v)


# Confirmed via direct testing (the system's own OOM killer log) that
# Formualizer's evaluate_all() was killed by the OS after growing to
# ~3.9GB while processing a real 1,152,789-formula-cell mining model —
# Formualizer's own initial load alone took ~1.4GB for that file, before
# evaluate_all() pushed memory past the available ceiling. That test ran
# in a 3.9GB sandbox; local machines and production servers can have
# very different headroom, so this is configurable via the
# RECALC_CHECK_MAX_FORMULA_CELLS environment variable rather than a
# fixed constant — set it high (or to 0) for local runs on a machine
# with plenty of memory, leave the default in place for a
# resource-constrained host (e.g. fm-validator's current CloudLinux/
# shared-hosting production environment, which has separately confirmed
# resource constraints — see the planned VPS migration). 0 or a negative
# value disables the check entirely. An unset or malformed value falls
# back to the default below.
DEFAULT_MAX_FORMULA_CELLS = 500000


def get_max_formula_cells():
    raw = os.environ.get('RECALC_CHECK_MAX_FORMULA_CELLS')
    if raw is None:
        return DEFAULT_MAX_FORMULA_CELLS
    try:
        return int(raw)
    except ValueError:
        return DEFAULT_MAX_FORMULA_CELLS


def count_formula_cells(path):
    """Cheap pre-check (~18s for 1.15M cells in testing, no Formualizer
    load at all) so an oversized file can be skipped gracefully before
    the expensive, memory-intensive part of this script even starts."""
    wb = openpyxl.load_workbook(path, data_only=False, read_only=True)
    count = 0
    for sheet_name in wb.sheetnames:
        for row in wb[sheet_name].iter_rows():
            for cell in row:
                if cell.data_type == 'f':
                    count += 1
    return count


def _sanitize_problematic_defined_names(path):
    """Removes defined names containing '?' via a temporary, sanitized
    copy of the workbook, and returns (temp_path, removed_names,
    affected_formula_count) — or (None, [], 0) if there was nothing to
    sanitize (so the caller can tell "nothing needed fixing" apart from
    "fixing didn't help").

    FIX: found via investigating a real production run — Calamine (the
    Rust library Formualizer uses to load .xlsx/.xlsm files) fails its
    own load step entirely when a defined name contains "?", a
    character Excel itself allows and this project's own test file
    used as a deliberate naming convention (CF_Report?, Recalc?,
    Show_Calc?, etc. — flag/toggle-style names). Confirmed the exact
    trigger with a minimal, isolated reproduction (a single-name
    workbook) before building this fix, not assumed from the original
    error text alone.

    This is a genuine fix, not a workaround: confirmed via full
    end-to-end testing against a real file that (a) the sanitized copy
    loads successfully, (b) the full recalculation check then runs to
    completion with ZERO genuine mismatches (every formula that
    resolved matched Excel's own cached value exactly), and (c) only a
    small fraction of the workbook's formula cells (692 of 59,228 on
    the real test file, ~1.2%) reference the removed names at all — the
    two specific error samples checked directly did not reference any
    removed name, confirming the bulk of any unresolved-formula count
    is a separate, pre-existing limitation, not something this fix
    introduces.

    Deliberately narrow: only "?" is removed, since that's the one
    character confirmed via direct, isolated testing to break
    Calamine's parser. Not a general "strip anything unusual"
    sanitizer — that would risk removing legitimate names this
    character-specific bug doesn't actually affect.
    """
    import openpyxl
    import tempfile

    try:
        wb = openpyxl.load_workbook(path, keep_vba=path.lower().endswith('.xlsm'))
    except Exception:
        return None, [], 0  # if openpyxl itself can't load it, there's nothing this fix can do

    problem_names = [n for n in wb.defined_names.keys() if '?' in n]
    if not problem_names:
        return None, [], 0

    # Count how many formula cells actually reference a problem name —
    # purely informational, for an honest, transparent result; doesn't
    # change what gets removed.
    affected_count = 0
    for ws in wb.worksheets:
        for row in ws.iter_rows():
            for cell in row:
                if cell.data_type == 'f' and isinstance(cell.value, str):
                    if any(n in cell.value for n in problem_names):
                        affected_count += 1

    for n in problem_names:
        del wb.defined_names[n]

    suffix = '.xlsm' if path.lower().endswith('.xlsm') else '.xlsx'
    fd, temp_path = tempfile.mkstemp(suffix=suffix, prefix='fmvalidator_recalc_sanitized_')
    os.close(fd)
    wb.save(temp_path)
    return temp_path, problem_names, affected_count


def _progress(msg):
    print(f"[recalc_check] {msg}", file=sys.stderr, flush=True)


try:
    import recalc_compare as rc
except ImportError:  # run as a script from another directory
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import recalc_compare as rc


def run(path, relative_tolerance=None, absolute_tolerance=None):
    # Patch 28: the comparison policy lives in recalc_compare.POLICY (0.1% relative; absolute floor 0.01, or 0.0001
    # for saved values of size 10 or less; text, Boolean and error values exact). The arguments override it for tests.
    policy = dict(rc.POLICY)
    if relative_tolerance is not None:
        policy["relative"] = relative_tolerance
    if absolute_tolerance is not None:
        policy["absolute"] = absolute_tolerance
    t_start = time.time()
    global _CURRENT_WORKBOOK_PATH
    _CURRENT_WORKBOOK_PATH = path

    _progress("Counting formula cells...")
    try:
        formula_count = count_formula_cells(path)
    except Exception as e:
        return {"status": "cached_value_read_failed", "error": str(e), "elapsed_s": round(time.time() - t_start, 2)}
    _progress(f"{formula_count:,} formula cells found ({round(time.time()-t_start,1)}s elapsed).")

    max_cells = get_max_formula_cells()
    if max_cells > 0 and formula_count > max_cells:
        return {"status": "skipped_too_large", "formula_cells": formula_count,
                "threshold": max_cells,
                "reason": f"{formula_count:,} formula cells exceeds the {max_cells:,}-cell safety threshold (RECALC_CHECK_MAX_FORMULA_CELLS) — skipped to avoid a memory-related crash. Raise this via the environment variable if this machine has more headroom, or set it to 0 to disable the check entirely.",
                "elapsed_s": round(time.time() - t_start, 2)}

    cfg = fz.EvaluationConfig()
    cfg.cycle_policy = "iterate"  # fix #1 — see module docstring, never omit this

    sanitized_names = []
    sanitized_affected_count = 0
    _load_path = path
    _sanitized_temp_path = None

    _progress("Loading workbook into Formualizer...")
    try:
        wb = fz.Workbook.load_path(_load_path, config=fz.WorkbookConfig(eval_config=cfg))
    except Exception as e:
        error_str = str(e)
        # FIX: found via investigating a real production run — Calamine
        # (the Rust library Formualizer uses to load .xlsx/.xlsm files)
        # fails its own load step entirely when a defined name contains
        # "?", a character Excel itself allows and this project's own
        # test file used as a deliberate flag/toggle naming convention
        # (CF_Report?, Recalc?, Show_Calc?, etc.). This IS now actually
        # fixed, not just diagnosed — see _sanitize_problematic_defined_
        # names' own docstring for the full investigation and the real
        # end-to-end testing (zero genuine mismatches, confirmed the
        # bulk of any unresolved-formula count is unrelated) that
        # justified treating this as a genuine fix rather than a risky
        # guess. Only falls through to a diagnostic-only message if
        # sanitization finds nothing to remove, or the retry still
        # fails for a different, unhandled reason.
        if "Invalid name" in error_str and "#NAME?" in error_str:
            _progress("Load failed on a defined name Calamine's parser rejects — attempting sanitized retry...")
            try:
                _sanitized_temp_path, sanitized_names, sanitized_affected_count = _sanitize_problematic_defined_names(path)
            except Exception as sanitize_err:
                _sanitized_temp_path = None
                _progress(f"Sanitization attempt itself failed: {sanitize_err}")

            if _sanitized_temp_path:
                _progress(f"Removed {len(sanitized_names)} problematic defined name(s), retrying load...")
                try:
                    wb = fz.Workbook.load_path(_sanitized_temp_path, config=fz.WorkbookConfig(eval_config=cfg))
                    _progress("Sanitized retry succeeded.")
                except Exception as retry_err:
                    os.remove(_sanitized_temp_path)
                    return {"status": "load_or_eval_failed", "error": str(retry_err),
                            "reason": f"The recalculation engine failed to load this workbook even after removing {len(sanitized_names)} defined name(s) containing \"?\" ({', '.join(sanitized_names)}). A different, unhandled cause is blocking the load — the recalculation-based check (A1) is unavailable for this file; every other check in this report still ran normally.",
                            "elapsed_s": round(time.time() - t_start, 2)}
                # Loaded successfully from the sanitized copy — done
                # with the temp file now that Formualizer has it in memory.
                os.remove(_sanitized_temp_path)
            else:
                return {"status": "load_or_eval_failed", "error": error_str,
                        "reason": "The recalculation engine (Formualizer/Calamine) failed to load this workbook because one of its defined names contains a character its parser rejects — commonly \"?\" used as part of a naming convention (e.g. a toggle or flag range) — but sanitizing a copy did not resolve it (openpyxl itself could not open the file, or no \"?\"-containing name was found to explain the failure). The recalculation-based check (A1) is unavailable for this file; every other check in this report still ran normally.",
                        "elapsed_s": round(time.time() - t_start, 2)}
        else:
            return {"status": "load_or_eval_failed", "error": error_str, "elapsed_s": round(time.time() - t_start, 2)}
    _progress(f"Formualizer load complete ({round(time.time()-t_start,1)}s elapsed).")

    # fix #5 (see module docstring) — register the value-taking overrides
    # for the confirmed-buggy native functions. allow_override_builtin
    # replaces Formualizer's own implementation workbook-wide; OFFSET()
    # (reference-taking) cannot use this mechanism and is handled by the
    # pre-scan/neutralize pass below instead, alongside external refs.
    wb.register_function("CELL", cell_override, min_args=0, max_args=2, allow_override_builtin=True)
    wb.register_function("INDEX", index_override, min_args=2, max_args=3, allow_override_builtin=True)
    wb.register_function("CHOOSE", choose_override, min_args=2, max_args=254, allow_override_builtin=True)
    wb.register_function("MATCH", match_override, min_args=2, max_args=3, allow_override_builtin=True)
    wb.register_function("YEAR", year_override, min_args=1, max_args=1, allow_override_builtin=True)
    wb.register_function("PRODUCT", product_override, min_args=1, max_args=254, allow_override_builtin=True)

    # fix #6 (see module docstring) — built once, from this same loaded
    # workbook, so it reflects this file's own real defined names.
    multicell_name_re = _build_multicell_name_re(wb)

    # fix #3a — read_only=True is primary, not a fallback. See module docstring.
    _progress("Loading workbook into openpyxl (for cached values)...")
    try:
        wb_formulas = openpyxl.load_workbook(path, data_only=False, read_only=True)
        wb_cached = openpyxl.load_workbook(path, data_only=True, read_only=True)
    except Exception as e:
        try:
            wb_formulas = openpyxl.load_workbook(path, data_only=False, keep_vba=path.lower().endswith('.xlsm'))
            wb_cached = openpyxl.load_workbook(path, data_only=True, keep_vba=path.lower().endswith('.xlsm'))
        except Exception as e2:
            return {"status": "cached_value_read_failed", "error": str(e), "fallback_error": str(e2), "elapsed_s": round(time.time() - t_start, 2)}
    _progress(f"openpyxl loads complete ({round(time.time()-t_start,1)}s elapsed).")

    # L23 fix: the workbook's actual sheet tab order, needed to correctly
    # expand 3D references like "Jan:Dec!B5" into every sheet in between —
    # "between" means tab position, not alphabetical or creation order.
    sheet_order = list(wb_formulas.sheetnames)

    # Single parallel-sequential pass (fix #3b) that both (i) identifies
    # and neutralizes external-reference cells (fix #2) and (ii) collects
    # the full target list + cached values + formula text for the batch
    # comparison and taint-propagation trace below. Never uses random
    # access (ws[coordinate]) — confirmed catastrophically slow in
    # read_only mode.
    external_ref_cells = set()
    offset_cells = set()          # fix #5 — see module docstring
    multicell_range_cells = set()  # fix #6 — see module docstring
    targets = []          # [(sheet, row, col), ...]
    target_keys = []      # ["Sheet!A1", ...] parallel to targets
    cached_values = []    # parallel to targets
    formula_texts = []    # parallel to targets — needed for the taint trace below
    sheet_of_target = {}  # "Sheet!A1" -> sheet name, for the taint trace

    _progress("Scanning formulas and cached values (single pass)...")
    for sheet_name in wb_formulas.sheetnames:
        if sheet_name not in wb_cached.sheetnames:
            continue
        ws_f = wb_formulas[sheet_name]
        ws_c = wb_cached[sheet_name]
        for row_f, row_c in zip(ws_f.iter_rows(), ws_c.iter_rows()):
            for cell_f, cell_c in zip(row_f, row_c):
                if cell_f.data_type != 'f':
                    continue
                # FIX (found via real testing against Hidden Gem at
                # production scale): openpyxl represents a legacy CSE
                # array formula as an ArrayFormula object (attributes
                # .ref, .text), not a plain string. Two consequences if
                # left unnormalized: (1) the EXTERNAL_REF_RE check just
                # below used str(cell_f.value), which on an ArrayFormula
                # stringifies to its object repr, not the actual formula
                # text — silently missing any "[N]" external reference
                # living inside an array formula; (2) the $-stripped
                # pre-filter added for the taint-BFS fixes calls
                # .replace('$', ''), which doesn't exist on ArrayFormula
                # at all and crashed with AttributeError on this exact
                # file. Normalizing once here, at the single point
                # formula_texts is populated, means every downstream
                # consumer (both BFS passes, IFERROR/IFNA regex,
                # _extract_refs, mismatch reporting) always sees plain
                # formula text or None — never a wrapper object.
                formula_value = cell_f.value
                if not isinstance(formula_value, str):
                    formula_value = getattr(formula_value, 'text', None)
                if formula_value and EXTERNAL_REF_RE.search(formula_value):
                    try:
                        wb.sheet(sheet_name).set_value(cell_f.row, cell_f.column, 0)
                        external_ref_cells.add(f"{sheet_name}!{cell_f.coordinate}")
                    except Exception:
                        pass  # if neutralizing itself fails, evaluate_all() below will surface it clearly
                    continue  # never compare a neutralized cell — its value is fabricated
                if formula_value and OFFSET_RE.search(formula_value):
                    try:
                        wb.sheet(sheet_name).set_value(cell_f.row, cell_f.column, cell_c.value if cell_c.value is not None else 0)
                        offset_cells.add(f"{sheet_name}!{cell_f.coordinate}")
                    except Exception:
                        pass
                    continue  # never compare a neutralized cell — its value is fabricated
                if formula_value and _is_bare_multicell_reference(formula_value, multicell_name_re):
                    try:
                        wb.sheet(sheet_name).set_value(cell_f.row, cell_f.column, cell_c.value if cell_c.value is not None else 0)
                        multicell_range_cells.add(f"{sheet_name}!{cell_f.coordinate}")
                    except Exception:
                        pass
                    continue  # never compare a neutralized cell — its value is fabricated
                key = f"{sheet_name}!{cell_f.coordinate}"
                targets.append((sheet_name, cell_f.row, cell_f.column))
                target_keys.append(key)
                cached_values.append(cell_c.value)
                formula_texts.append(formula_value)
                sheet_of_target[key] = sheet_name

    # Taint propagation: find every cell that references a neutralized
    # cell, directly or transitively, and exclude it from the comparison
    # too. Fast string-contains pre-filter (cheap) before the more
    # expensive regex-based reference parsing (only run on formulas that
    # plausibly could reference a tainted cell) — necessary for this to
    # stay tractable at real scale (1M+ formula cells). Bounded to a
    # reasonable number of BFS waves rather than iterating to an
    # unbounded fixed point, since each wave requires another pass over
    # every remaining formula.
    _progress(f"Scan complete: {len(targets):,} target(s), {len(external_ref_cells)} external-reference cell(s), {len(offset_cells)} OFFSET() cell(s), {len(multicell_range_cells)} bare-multicell-named-range cell(s) found ({round(time.time()-t_start,1)}s elapsed).")

    # FIX #2 (found via a real Hidden Gem run: the masking BFS below hit
    # its old 30-wave cap with 7 cells STILL newly tainted on wave 30 —
    # i.e. genuinely not converged, silently truncated). The same fixed-
    # cap risk applies here too, even though this particular run's 4
    # external-reference cells happened to have zero downstream
    # dependents. Rather than leave one BFS capped and hope a future
    # file's external-ref chain never happens to be long, both passes
    # now use the same reverse-dependency-index architecture: parse
    # every formula's references once, build a reverse index once, then
    # propagate via the actual frontier with NO fixed wave limit — safe
    # to run to true convergence because each wave's cost is bounded by
    # the frontier size, not by rescanning every target cell.
    _progress(f"Parsing references for {len(target_keys):,} target cell(s) "
               f"for external-reference taint tracing...")
    _ext_refs_by_key = {}
    for i, formula in enumerate(formula_texts):
        if formula:
            _ext_refs_by_key[target_keys[i]] = _extract_refs(formula, sheet_of_target[target_keys[i]], sheet_order=sheet_order)
    _ext_dependents_of = {}
    _ext_big = _refsvc.BigRanges()          # ranges too large to expand: kept as rectangles so taint still reaches their readers
    for key, refs in _ext_refs_by_key.items():
        for (rsheet, rcol, rrow) in refs:
            _ext_dependents_of.setdefault(f"{rsheet}!{rcol}{rrow}", []).append(key)
        _ext_big.add(refs, key)
    _progress(f"  reference parsing and reverse index complete ({round(time.time()-t_start,1)}s elapsed).")

    tainted = set(external_ref_cells) | set(offset_cells) | set(multicell_range_cells)
    if tainted:
        _progress(f"Tracing dependents of {len(external_ref_cells)} external-reference cell(s), {len(offset_cells)} OFFSET() cell(s), and {len(multicell_range_cells)} bare-multicell-named-range cell(s)...")
        frontier = set(tainted)
        _wave = 0
        while True:
            _wave += 1
            newly_tainted = set()
            for tkey in frontier:
                for dep_key in _ext_dependents_of.get(tkey, ()):
                    if dep_key not in tainted:
                        newly_tainted.add(dep_key)
            for dep_key in _ext_big.hit_by(frontier):
                if dep_key not in tainted:
                    newly_tainted.add(dep_key)
            if not newly_tainted:
                break
            tainted |= newly_tainted
            frontier = newly_tainted
            _progress(f"  wave {_wave}: {len(newly_tainted):,} newly tainted, {len(tainted):,} total ({round(time.time()-t_start,1)}s elapsed).")

        if len(tainted) > len(external_ref_cells) + len(offset_cells) + len(multicell_range_cells):
            # Filter targets/keys/cached_values/formula_texts to drop
            # every tainted cell before the batch comparison below.
            keep_indices = [i for i, key in enumerate(target_keys) if key not in tainted]
            targets = [targets[i] for i in keep_indices]
            target_keys = [target_keys[i] for i in keep_indices]
            cached_values = [cached_values[i] for i in keep_indices]
            formula_texts = [formula_texts[i] for i in keep_indices]

    tainted_downstream_count = len(tainted) - len(external_ref_cells) - len(offset_cells) - len(multicell_range_cells)
    if tainted_downstream_count > 0:
        _progress(f"Taint trace complete: {tainted_downstream_count:,} downstream cell(s) excluded ({round(time.time()-t_start,1)}s elapsed).")

    _progress(f"Running evaluate_all() ({len(targets):,} target cells to compare)...")
    try:
        wb.evaluate_all()
    except Exception as e:
        return {"status": "load_or_eval_failed", "error": str(e), "elapsed_s": round(time.time() - t_start, 2),
                "note": f"{len(external_ref_cells)} external-reference cell(s), {len(offset_cells)} OFFSET() cell(s), and {len(multicell_range_cells)} bare-multicell-named-range cell(s) were pre-neutralized, and CELL/INDEX/CHOOSE/MATCH/YEAR/PRODUCT were overridden, but evaluation still failed — a further, different blocking issue exists beyond all currently-known Formualizer array-handling bugs (see module docstring fixes #5/#6)."}
    _progress(f"evaluate_all() complete ({round(time.time()-t_start,1)}s elapsed).")

    telemetry = wb.last_cycle_telemetry()
    _progress(f"Circularity: {telemetry.iterated_sccs} genuine group(s), {telemetry.converged_sccs} converged, {telemetry.capped_sccs} unconverged.")

    # fix #3b — one batched call instead of len(targets) individual ones.
    _progress(f"Running batch evaluate_cells() for {len(targets):,} target(s) — this is usually fast (~0.008ms/cell observed in testing), but is a single call with no incremental progress once started. If this step runs far longer than {len(targets)*0.001:.0f}s-{len(targets)*0.01:.0f}s, something is genuinely different about this file's formulas, not just scale.")
    try:
        recalculated_values = wb.evaluate_cells(targets)
    except Exception as e:
        return {"status": "batch_evaluation_failed", "error": str(e), "elapsed_s": round(time.time() - t_start, 2),
                "target_count": len(targets)}
    _progress(f"Batch evaluation complete ({round(time.time()-t_start,1)}s elapsed). Comparing against cached values...")

    mismatches = []
    unresolved_errors = []
    counts = {"matched": 0, "unresolved": 0, "missing_cache": 0, "unsupported": 0}
    missing_cache_sample = []
    unsupported_sample = []
    epoch = getattr(wb_cached, "epoch", None)

    # Patch 28: every compared cell lands in exactly one outcome (matched, mismatch, unresolved, missing cache,
    # unsupported type). Text, Boolean and date results are judged too; previously only number-against-number pairs
    # reached a verdict and every other combination passed without one.
    for key, cached_val, recalced_val in zip(target_keys, cached_values, recalculated_values):
        sheet_name, cell_addr = key.split('!', 1)
        verdict = rc.classify(cached_val, recalced_val, policy, epoch)
        outcome = verdict["outcome"]
        if outcome == "unresolved":
            entry = {"sheet": sheet_name, "cell": cell_addr}
            if verdict.get("reason") == "engine_error":
                is_string_error = isinstance(recalced_val, str) and recalced_val.startswith('#')
                entry["recalculated_error"] = recalced_val if is_string_error else f"{recalced_val.get('kind', 'Unknown')} error"
            else:
                entry["cached_is_nan"] = isinstance(cached_val, float) and not math.isfinite(cached_val)
                entry["recalculated_is_nan"] = isinstance(recalced_val, float) and not math.isfinite(recalced_val)
            unresolved_errors.append(entry)
            counts["unresolved"] += 1
        elif outcome == "mismatch":
            mismatches.append({
                "sheet": sheet_name, "cell": cell_addr,
                "cached": _jsonable(cached_val), "recalculated": _jsonable(recalced_val),
                "diff": verdict.get("diff"), "type": verdict.get("type", "number"),
            })
        elif outcome == "missing_cache":
            counts["missing_cache"] += 1
            if len(missing_cache_sample) < 50:
                missing_cache_sample.append({"sheet": sheet_name, "cell": cell_addr, "recalculated": _jsonable(recalced_val)})
        elif outcome == "unsupported":
            counts["unsupported"] += 1
            if len(unsupported_sample) < 50:
                unsupported_sample.append({"sheet": sheet_name, "cell": cell_addr})
        else:
            counts["matched"] += 1

    # Separate genuinely clean mismatches from a chain of IFERROR/IFNA-
    # masked upstream failures. Found via real testing against Hidden
    # Gem: a Dashboard cell wraps 'Unit Economics'!F12 in IFERROR(...,0);
    # that cell's own formula is ALSO wrapped in an error-masking
    # function referencing something further upstream, and so on — each
    # layer silently returns its fallback rather than propagating a
    # visible error, so the single-hop reference-based taint trace above
    # can't see through more than one layer. This runs entirely on data
    # already in memory (formula text, the mismatches just built) — no
    # need to re-run the expensive Formualizer evaluation again.
    # Separate genuinely clean mismatches from ones caused by the same
    # upstream root cause as a confirmed genuine failure. Originally
    # this only looked for IFERROR/IFNA-wrapped mismatches referencing
    # each other, but real testing against Hidden Gem found a case that
    # breaks that assumption: =AA12-AA13, plain arithmetic with no
    # error-masking function at all, inheriting the same 0.0 result as
    # its precedents simply by referencing them. The correct, more
    # general test is reference-based, not function-based: seed from
    # cells we KNOW are genuinely broken (external-reference cells,
    # and any cell Formualizer itself reports as an unresolved error),
    # then propagate to any OTHER mismatch that references a seed or an
    # already-tainted cell — regardless of what function, if any, that
    # mismatch's own formula uses. Runs entirely on data already in
    # memory (formula text, the mismatches/unresolved_errors just
    # built) — no need to re-run the expensive Formualizer evaluation.
    mismatch_keys = {f"{m['sheet']}!{m['cell']}" for m in mismatches}

    formula_by_key = {key: formula_texts[i] for i, key in enumerate(target_keys)}
    root_seeds = set(external_ref_cells) | set(offset_cells) | set(multicell_range_cells) | {f"{e['sheet']}!{e['cell']}" for e in unresolved_errors}

    # FIX #2 (found via a real 8+ hour run against Hidden Gem that had to
    # be interrupted — the earlier fix below was itself broken at scale).
    # That version used a "cheap" substring pre-filter — any(pat in
    # formula for pat in addr_patterns) — on the assumption addr_patterns
    # would stay small, as it does for the external-ref-only BFS above
    # (seeded from a handful of cells). But THIS masking BFS seeds from
    # root_seeds = external_ref_cells | unresolved_errors, and Hidden
    # Gem's unresolved_error_count was 264,055 — so addr_patterns started
    # near that size and only grew every wave. Measured directly: a
    # substring check against ~113K patterns costs ~200 microseconds PER
    # FORMULA; doing that for ~1.15M target cells across multiple waves
    # extrapolates to hours, matching what actually happened. The real
    # fix is architectural, not a smaller constant: parse every formula's
    # references ONCE (not once per wave), build a reverse index of
    # "which cells reference cell X" ONCE, then propagate by walking only
    # the actual frontier each wave — a proper BFS over the dependency
    # graph, bounded by the number of (cell, reference) edges overall,
    # rather than rescanning all target cells' formula text on every
    # wave regardless of whether they're anywhere near the taint.
    _progress(f"Parsing references for {len(target_keys):,} target cell(s) "
               f"(one-time cost, not repeated per wave)...")
    refs_by_key = {}
    for key in target_keys:
        formula = formula_by_key.get(key)
        if formula:
            refs_by_key[key] = _extract_refs(formula, key.split('!', 1)[0], sheet_order=sheet_order)
    _progress(f"  reference parsing complete ({round(time.time()-t_start,1)}s elapsed).")

    dependents_of = {}
    _err_big = _refsvc.BigRanges()
    _vol_big = _refsvc.BigRanges()
    for key, refs in refs_by_key.items():
        for (rsheet, rcol, rrow) in refs:
            dependents_of.setdefault(f"{rsheet}!{rcol}{rrow}", []).append(key)
        _err_big.add(refs, key)
        _vol_big.add(refs, key)
    _progress(f"  reverse dependency index built: {len(dependents_of):,} referenced cell(s) "
               f"({round(time.time()-t_start,1)}s elapsed).")

    tainted_by_error = set()
    root_label_of = {}
    for key in target_keys:
        formula = formula_by_key.get(key)
        if not formula:
            continue
        # Directly references a confirmed-broken cell, or uses an
        # explicit error-masking function as a supplementary signal
        # (still valid — just no longer the ONLY signal).
        # Patch 28: the word IFERROR alone no longer holds a mismatch back. A cell is linked to an engine limitation
        # only through a specific root: an IFERROR/IFNA formula that itself calls a function this engine is known to
        # evaluate differently (recalc_compare.ENGINE_LIMITED_FUNCTIONS), or a reference to a cell the engine could
        # not resolve. Anything else that differs stays a clean mismatch.
        _limited = rc.engine_limited_function(formula)
        if _limited:
            tainted_by_error.add(key)
            root_label_of[key] = f"{_limited}() inside IFERROR/IFNA"
            continue
        refs = refs_by_key.get(key, ())
        _hit = next((f"{rsheet}!{rcol}{rrow}" for (rsheet, rcol, rrow) in refs if f"{rsheet}!{rcol}{rrow}" in root_seeds), None)
        if _hit:
            tainted_by_error.add(key)
            root_label_of[key] = f"unresolved cell {_hit}"
    # a formula that reads a range containing an unresolved cell is linked to it too, whatever the range's size
    for _dep, _cell in _err_big.first_hit(root_seeds).items():
        if _dep not in tainted_by_error and formula_by_key.get(_dep):
            tainted_by_error.add(_dep)
            root_label_of[_dep] = f"unresolved cell {_cell} inside a range"
    _progress(f"  initial seeding pass complete: {len(tainted_by_error):,} cell(s) tainted "
               f"({round(time.time()-t_start,1)}s elapsed).")

    # FIX #2 continued: same reasoning as the external-reference BFS
    # above — no fixed wave cap. Confirmed this was NOT just theoretical:
    # a real run against Hidden Gem hit the old 30-wave cap with 7 cells
    # still newly tainted on wave 30, meaning propagation was silently
    # truncated before converging. Safe to run uncapped now that each
    # wave only touches the actual frontier via the reverse index.
    frontier = set(tainted_by_error)
    _wave = 0
    while True:
        _wave += 1
        newly_tainted = set()
        for tkey in frontier:
            for dep_key in dependents_of.get(tkey, ()):
                if dep_key not in tainted_by_error:
                    newly_tainted.add(dep_key)
                    if dep_key not in root_label_of:
                        root_label_of[dep_key] = root_label_of.get(tkey, "an engine limitation")
        for dep_key, _cell in _err_big.hit_by(frontier).items():
            if dep_key not in tainted_by_error and dep_key not in newly_tainted:
                newly_tainted.add(dep_key)
                if dep_key not in root_label_of:
                    root_label_of[dep_key] = root_label_of.get(_cell, "an engine limitation")
        _progress(f"  masking wave {_wave}: {len(newly_tainted):,} newly tainted, "
                  f"{len(tainted_by_error)+len(newly_tainted):,} total ({round(time.time()-t_start,1)}s elapsed).")
        if not newly_tainted:
            break
        tainted_by_error |= newly_tainted
        frontier = newly_tainted

    # Patch 28: a mismatch that calls, or depends on, NOW/TODAY/RAND or a file-name function is volatile, not an error:
    # its saved value was calculated on another day or under another file name. Reported in the ledger, not as a defect.
    volatile_tainted = {k for k in target_keys if rc.is_volatile(formula_by_key.get(k))}
    _vfront = set(volatile_tainted)
    while _vfront:
        _vnew = set()
        for _k in _vfront:
            for _d in dependents_of.get(_k, ()):
                if _d not in volatile_tainted:
                    _vnew.add(_d)
        for _d in _vol_big.hit_by(_vfront):
            if _d not in volatile_tainted:
                _vnew.add(_d)
        volatile_tainted |= _vnew
        _vfront = _vnew
    volatile_mismatches = [m for m in mismatches if f"{m['sheet']}!{m['cell']}" in volatile_tainted]
    mismatches = [m for m in mismatches if f"{m['sheet']}!{m['cell']}" not in volatile_tainted]
    mismatch_keys = {f"{m['sheet']}!{m['cell']}" for m in mismatches}

    masked = tainted_by_error & mismatch_keys

    mismatches_clean = [m for m in mismatches if f"{m['sheet']}!{m['cell']}" not in masked]
    mismatches_likely_masked_upstream_error = []
    for m in mismatches:
        _k = f"{m['sheet']}!{m['cell']}"
        if _k in masked:
            m = dict(m)
            m["root_label"] = root_label_of.get(_k, "an engine limitation")
            mismatches_likely_masked_upstream_error.append(m)

    ledger = rc.build_ledger(
        formula_count,
        {"matched": counts["matched"], "mismatched": len(mismatches_clean), "held_back": len(mismatches_likely_masked_upstream_error), "volatile": len(volatile_mismatches),
         "unresolved": counts["unresolved"], "missing_cache": counts["missing_cache"], "unsupported": counts["unsupported"]},
        {"external_reference": len(external_ref_cells), "offset": len(offset_cells),
         "bare_multicell_name": len(multicell_range_cells), "downstream_of_excluded": tainted_downstream_count if tainted_downstream_count > 0 else 0})

    return {
        "status": "success",
        "elapsed_s": round(time.time() - t_start, 2),
        "formula_cells_checked": len(targets),
        "external_reference_cells_excluded": len(external_ref_cells),
        "offset_cells_excluded": len(offset_cells),
        "multicell_named_range_cells_excluded": len(multicell_range_cells),
        "tainted_downstream_cells_excluded": tainted_downstream_count,
        "genuine_circular_groups": telemetry.iterated_sccs,
        "converged_circular_groups": telemetry.converged_sccs,
        "unconverged_circular_groups": telemetry.capped_sccs,
        "mismatches": mismatches_clean,
        "mismatch_count": len(mismatches_clean),
        "mismatches_likely_masked_upstream_error": mismatches_likely_masked_upstream_error,
        "mismatches_likely_masked_upstream_error_count": len(mismatches_likely_masked_upstream_error),
        # Patch 28: the same list under the name that says what it is, now shown in the report instead of dropped.
        "mismatches_held_back": mismatches_likely_masked_upstream_error,
        "mismatches_held_back_count": len(mismatches_likely_masked_upstream_error),
        "formula_cells_compared": ledger["compared"],
        "ledger": ledger,
        "volatile_dependent_count": len(volatile_mismatches),
        "volatile_sample": volatile_mismatches[:20],
        "missing_cache_sample": missing_cache_sample,
        "unsupported_sample": unsupported_sample,
        "comparison_policy": rc.policy_text(policy),
        "unresolved_errors": unresolved_errors,
        "unresolved_error_count": len(unresolved_errors),
        "sanitized_defined_names": sanitized_names,
        "sanitized_defined_names_count": len(sanitized_names),
        "sanitized_formula_cells_affected": sanitized_affected_count,
    }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"status": "error", "reason": "usage: recalc_check.py <path>"}))
        sys.exit(1)
    result = run(sys.argv[1])
    print(json.dumps(result))
