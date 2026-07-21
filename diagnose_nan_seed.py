#!/usr/bin/env python3
"""
diagnose_nan_seed.py — one-off diagnostic for the 51 clean mismatches
surfaced by recalc_check.py (A1) against Hidden Gem
(Ops!K189, Ops!U193:BQ193, D&T!I29 — all recalculating to 0.0).

Every one of those mismatches recalculates to exactly 0.0, and the
Ops!U193:BQ193 run is a smooth compounding series — consistent with a
single upstream cell resolving to NaN (a genuine Excel-cached IEEE-754
value), with SUM()/multiplication propagating a mathematically valid
but wrong 0 forward, rather than an error Formualizer or recalc_check.py's
masked-upstream-error tracing would catch.

Uses the exact _cast_number patch already deployed in src/recalc_check.py
(verbatim — do not reconstruct from memory, copy from the real file if
this script ever needs updating) so this diagnostic doesn't crash on the
same NaN-cast issue recalc_check.py already handles.

Usage:
    python3 diagnose_nan_seed.py "/path/to/the/validated/workbook.xlsx"

If no path is given, defaults to the path used in the session this
script was written for.
"""

import sys
import math
import warnings

import openpyxl

# Same warning recalc_check.py suppresses — openpyxl tries to convert a
# NaN cell to a date via from_excel(), correctly raises internally, and
# openpyxl's own try/except catches it and emits this warning purely for
# information. Not a sign of a problem.
warnings.filterwarnings('ignore', message=r'.*is marked as a date but the serial value.*')

# Verbatim patch from src/recalc_check.py — openpyxl's _cast_number only
# recognizes a float by '.', 'E', or 'e' in the text and otherwise falls
# through to int(value), which crashes on 'NaN'/'Infinity'/'-Infinity' —
# all valid IEEE-754 values Excel can legitimately cache. Patched at the
# source, before any workbook is loaded, since a per-cell try/except
# inside openpyxl's internal row-parsing generator can't catch this
# without losing every other cell in the same row.
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

DEFAULT_PATH = (
    "/Users/mriazanov/fm-validator-1.worktrees/"
    "agents-financial-model-validation-agent-e1004a1d/processed/"
    "Hidden Gem Base Case Financial Model (1.9Mtpa)4-03-2026 v 2 VBA FIX_VALIDATED.xlsx"
)


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_PATH
    print(f"Loading: {path}\n")

    wb_f = openpyxl.load_workbook(path, data_only=False)
    wb_c = openpyxl.load_workbook(path, data_only=True)

    print("=== Ops!T188:T193 — formulas ===")
    ws_f = wb_f['Ops']
    for r in range(188, 194):
        print(f"  Ops!T{r} formula = {ws_f[f'T{r}'].value}")

    print("\n=== Ops!T188:T193 — cached values ===")
    ws_c = wb_c['Ops']
    for r in range(188, 194):
        val = ws_c[f'T{r}'].value
        is_nan = isinstance(val, float) and math.isnan(val)
        flag = "  <-- NaN seed" if is_nan else ""
        print(f"  Ops!T{r} cached = {val!r} | is NaN: {is_nan}{flag}")

    print("\n=== Ops!K189 — formula and precedents ===")
    print(f"  Ops!K189 formula = {ws_f['K189'].value}")
    print(f"  Ops!K189 cached  = {ws_c['K189'].value!r}")

    print("\n=== D&T!J24:J29 — formulas and cached values (feeds D&T!I29) ===")
    ws_df = wb_f['D&T']
    ws_dc = wb_c['D&T']
    for r in range(24, 30):
        val = ws_dc[f'J{r}'].value
        is_nan = isinstance(val, float) and math.isnan(val)
        flag = "  <-- NaN seed" if is_nan else ""
        print(f"  D&T!J{r} formula = {ws_df[f'J{r}'].value}")
        print(f"  D&T!J{r} cached  = {val!r} | is NaN: {is_nan}{flag}")

    print("\nDone. Whichever row above shows 'is NaN: True' is the real seed —")
    print("check that cell's own formula next (it's one level further upstream).")


if __name__ == "__main__":
    main()
