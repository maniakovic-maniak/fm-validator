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

Usage:
    python3 recalc_check.py path/to/workbook.xlsx
    (outputs a JSON summary to stdout)
"""

import sys
import json
import time
import re

try:
    import formualizer as fz
except ImportError:
    print(json.dumps({"status": "unavailable", "reason": "formualizer not installed"}))
    sys.exit(0)

try:
    import openpyxl
except ImportError:
    print(json.dumps({"status": "unavailable", "reason": "openpyxl not installed"}))
    sys.exit(0)

EXTERNAL_REF_RE = re.compile(r'\[\d+\]')

# Confirmed via direct testing (the system's own OOM killer log) that
# Formualizer's evaluate_all() was killed by the OS after growing to
# ~3.9GB while processing a real 1,152,789-formula-cell mining model —
# Formualizer's own initial load alone took ~1.4GB for that file, before
# evaluate_all() pushed memory past the available ceiling. This
# threshold is a conservative guess calibrated only against a 3.9GB
# sandbox; it has NOT been validated against the actual memory available
# on the production server, which may be higher or lower. Tune this
# based on real production testing, not left as a permanent guess.
MAX_FORMULA_CELLS = 200000


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


def run(path, relative_tolerance=0.001, absolute_tolerance=1.0):
    t_start = time.time()

    try:
        formula_count = count_formula_cells(path)
    except Exception as e:
        return {"status": "cached_value_read_failed", "error": str(e), "elapsed_s": round(time.time() - t_start, 2)}

    if formula_count > MAX_FORMULA_CELLS:
        return {"status": "skipped_too_large", "formula_cells": formula_count,
                "threshold": MAX_FORMULA_CELLS,
                "reason": f"{formula_count:,} formula cells exceeds the {MAX_FORMULA_CELLS:,}-cell safety threshold — skipped to avoid a memory-related crash. This threshold is a conservative estimate from sandbox testing, not validated against this server's actual available memory; raise it if this server has more headroom.",
                "elapsed_s": round(time.time() - t_start, 2)}

    cfg = fz.EvaluationConfig()
    cfg.cycle_policy = "iterate"  # fix #1 — see module docstring, never omit this

    try:
        wb = fz.Workbook.load_path(path, config=fz.WorkbookConfig(eval_config=cfg))
    except Exception as e:
        return {"status": "load_or_eval_failed", "error": str(e), "elapsed_s": round(time.time() - t_start, 2)}

    # fix #3a — read_only=True is primary, not a fallback. See module docstring.
    try:
        wb_formulas = openpyxl.load_workbook(path, data_only=False, read_only=True)
        wb_cached = openpyxl.load_workbook(path, data_only=True, read_only=True)
    except Exception as e:
        try:
            wb_formulas = openpyxl.load_workbook(path, data_only=False, keep_vba=path.lower().endswith('.xlsm'))
            wb_cached = openpyxl.load_workbook(path, data_only=True, keep_vba=path.lower().endswith('.xlsm'))
        except Exception as e2:
            return {"status": "cached_value_read_failed", "error": str(e), "fallback_error": str(e2), "elapsed_s": round(time.time() - t_start, 2)}

    # Single parallel-sequential pass (fix #3b) that both (i) identifies
    # and neutralizes external-reference cells (fix #2) and (ii) collects
    # the full target list + cached values for the batch comparison
    # below. Never uses random access (ws[coordinate]) — confirmed
    # catastrophically slow in read_only mode.
    external_ref_cells = set()
    targets = []          # [(sheet, row, col), ...]
    target_keys = []      # ["Sheet!A1", ...] parallel to targets
    cached_values = []    # parallel to targets

    for sheet_name in wb_formulas.sheetnames:
        if sheet_name not in wb_cached.sheetnames:
            continue
        ws_f = wb_formulas[sheet_name]
        ws_c = wb_cached[sheet_name]
        for row_f, row_c in zip(ws_f.iter_rows(), ws_c.iter_rows()):
            for cell_f, cell_c in zip(row_f, row_c):
                if cell_f.data_type != 'f':
                    continue
                if cell_f.value and EXTERNAL_REF_RE.search(str(cell_f.value)):
                    try:
                        wb.sheet(sheet_name).set_value(cell_f.row, cell_f.column, 0)
                        external_ref_cells.add(f"{sheet_name}!{cell_f.coordinate}")
                    except Exception:
                        pass  # if neutralizing itself fails, evaluate_all() below will surface it clearly
                    continue  # never compare a neutralized cell — its value is fabricated
                targets.append((sheet_name, cell_f.row, cell_f.column))
                target_keys.append(f"{sheet_name}!{cell_f.coordinate}")
                cached_values.append(cell_c.value)

    try:
        wb.evaluate_all()
    except Exception as e:
        return {"status": "load_or_eval_failed", "error": str(e), "elapsed_s": round(time.time() - t_start, 2),
                "note": f"{len(external_ref_cells)} external-reference cell(s) were pre-neutralized but evaluation still failed — a second, different blocking issue exists beyond external references."}

    telemetry = wb.last_cycle_telemetry()

    # fix #3b — one batched call instead of len(targets) individual ones.
    try:
        recalculated_values = wb.evaluate_cells(targets)
    except Exception as e:
        return {"status": "batch_evaluation_failed", "error": str(e), "elapsed_s": round(time.time() - t_start, 2),
                "target_count": len(targets)}

    mismatches = []
    unresolved_errors = []

    for key, cached_val, recalced_val in zip(target_keys, cached_values, recalculated_values):
        sheet_name, cell_addr = key.split('!', 1)

        if isinstance(recalced_val, str) and recalced_val.startswith('#'):
            unresolved_errors.append({"sheet": sheet_name, "cell": cell_addr, "recalculated_error": recalced_val})
            continue

        if isinstance(cached_val, (int, float)) and isinstance(recalced_val, (int, float)):
            tolerance = max(absolute_tolerance, abs(cached_val) * relative_tolerance)
            if abs(cached_val - recalced_val) > tolerance:
                mismatches.append({
                    "sheet": sheet_name, "cell": cell_addr,
                    "cached": cached_val, "recalculated": recalced_val,
                    "diff": recalced_val - cached_val,
                })

    return {
        "status": "success",
        "elapsed_s": round(time.time() - t_start, 2),
        "formula_cells_checked": len(targets),
        "external_reference_cells_excluded": len(external_ref_cells),
        "genuine_circular_groups": telemetry.iterated_sccs,
        "converged_circular_groups": telemetry.converged_sccs,
        "unconverged_circular_groups": telemetry.capped_sccs,
        "mismatches": mismatches,
        "mismatch_count": len(mismatches),
        "unresolved_errors": unresolved_errors,
        "unresolved_error_count": len(unresolved_errors),
    }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"status": "error", "reason": "usage: recalc_check.py <path>"}))
        sys.exit(1)
    result = run(sys.argv[1])
    print(json.dumps(result))
