"""recalc_compare.py - Patch 28. How a saved (cached) value is compared with its recalculated value, and how every
formula cell ends up in exactly one outcome.

Kept apart from recalc_check.py so the rules can be tested without the recalculation engine.

Outcomes for a compared cell (exactly one each):
  matched       the saved and recalculated values agree under the policy below
  mismatch      they differ (type: number, boolean, text, type_changed)
  unresolved    the engine returned an error or a non-finite number, so there is nothing to compare
  missing_cache the file holds no saved value for a formula that recalculates to something
  unsupported   a value type this comparison does not judge (nothing is claimed either way)
  volatile      differs, but the cell calls (or depends on) NOW, TODAY, RAND or a file-name function, so the saved
                value from another day or file name is not comparable; counted and sampled, not raised as an error

Numeric policy (approved 30 Oct 2026):
  relative limit 0.1% of the saved value, with an absolute floor of 0.01 for values above 10 in size and 0.0001 for
  values of size 10 or less (ratios, percentages, amounts in millions). Text, Boolean and error values are exact.
  Dates are compared as Excel serial numbers to within one second. Units are not known to this check, so the policy is disclosed in the
  report rather than presented as a per-metric tolerance.
"""
import math
import re
import datetime

POLICY = {
    "relative": 0.001,
    "absolute": 0.01,
    "small_threshold": 10.0,
    "small_absolute": 0.0001,
}

# Functions this engine is known to evaluate differently from Excel (documented limitations). A mismatch in an
# IFERROR/IFNA cell whose own formula contains one of these is held back as "linked to an engine limitation" with that
# function named as the root. A mismatch in any other IFERROR/IFNA cell is NOT held back.
ENGINE_LIMITED_FUNCTIONS = ("MATCH", "IRR", "XIRR")
ENGINE_LIMITED_RE = re.compile(r"\b(" + "|".join(ENGINE_LIMITED_FUNCTIONS) + r")\s*\(", re.IGNORECASE)
ERROR_WRAPPER_RE = re.compile(r"\bIFERROR\s*\(|\bIFNA\s*\(", re.IGNORECASE)

# Formulas whose result depends on when or where they are calculated, so a saved value from another day or another
# file name cannot be compared with a fresh one. A cell that calls one, or depends on one, is reported as volatile.
VOLATILE_RE = re.compile(r"\b(NOW|TODAY|RAND|RANDBETWEEN|RANDARRAY|INFO)\s*\(|\bCELL\s*\(\s*\"(filename|directory)\"", re.IGNORECASE)


def is_volatile(formula):
    return bool(formula and VOLATILE_RE.search(formula))


_CACHED_ERROR_STRINGS = {"#DIV/0!", "#N/A", "#NAME?", "#NULL!", "#NUM!", "#REF!", "#VALUE!", "#GETTING_DATA", "#SPILL!", "#CALC!"}


_DATE_TYPES = (datetime.datetime, datetime.date, datetime.time, datetime.timedelta)
DATE_TOLERANCE_DAYS = 1.0 / 86400.0   # one second


def engine_limited_function(formula):
    """The name of the engine-limited function inside an IFERROR/IFNA formula, or None."""
    if not formula or not ERROR_WRAPPER_RE.search(formula):
        return None
    m = ENGINE_LIMITED_RE.search(formula)
    return m.group(1).upper() if m else None


def tolerance_for(cached, policy=POLICY):
    mag = abs(cached)
    floor = policy["small_absolute"] if mag <= policy["small_threshold"] else policy["absolute"]
    return max(floor, mag * policy["relative"])


def policy_text(policy=POLICY):
    return (f"numbers: within {policy['relative'] * 100:g}% of the saved value, with an absolute floor of "
            f"{policy['absolute']:g} (or {policy['small_absolute']:g} where the saved value is {policy['small_threshold']:g} or less); "
            f"text, Boolean and error values: exact; dates: to within one second")


def _kind(v, epoch, is_recalc):
    """(kind, value). Kinds: empty, bool, number, text, error, nonfinite, unsupported."""
    if v is None:
        return "empty", None
    if isinstance(v, bool):
        return "bool", v
    if isinstance(v, (int, float)):
        if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
            return "nonfinite", v
        return "number", float(v)
    if isinstance(v, str):
        if v == "":
            return "empty", None
        if (is_recalc and v.startswith("#")) or (not is_recalc and v in _CACHED_ERROR_STRINGS):
            return "error", v
        return "text", v
    if isinstance(v, dict):
        return ("error", v) if v.get("type") == "Error" else ("unsupported", v)
    if isinstance(v, (datetime.datetime, datetime.date, datetime.time, datetime.timedelta)):
        try:
            from openpyxl.utils.datetime import to_excel
            serial = to_excel(v, epoch) if epoch is not None else to_excel(v)
            return "number", float(serial)
        except Exception:
            return "unsupported", v
    return "unsupported", v


def classify(cached, recalculated, policy=POLICY, epoch=None):
    """Returns {"outcome": ..., "type": ..., "diff": ..., "tolerance": ...} for one cell."""
    ck, cv = _kind(cached, epoch, False)
    rk, rv = _kind(recalculated, epoch, True)

    if rk == "error":
        return {"outcome": "unresolved", "reason": "engine_error"}
    if rk == "nonfinite" or ck == "nonfinite":
        return {"outcome": "unresolved", "reason": "non_finite"}
    if ck == "unsupported" or rk == "unsupported":
        return {"outcome": "unsupported"}

    if ck == "empty":
        if rk == "empty":
            return {"outcome": "matched"}
        return {"outcome": "missing_cache"}
    if rk == "empty":
        # the engine gave a blank where the file saved a value. A saved zero or empty text is the same thing.
        if (ck == "number" and cv == 0.0) or (ck == "bool" and cv is False):
            return {"outcome": "matched"}
        return {"outcome": "unsupported"}

    if ck == "error":
        return {"outcome": "mismatch", "type": "type_changed"}

    if ck in ("bool", "number") and rk in ("bool", "number"):
        if ck == "bool" and rk == "bool":
            return {"outcome": "matched"} if cv == rv else {"outcome": "mismatch", "type": "boolean"}
        a, b = float(cv), float(rv)
        # A date's serial number is large (about 45,000), so a relative limit would allow weeks of difference.
        # Dates are compared to about a second.
        tol = DATE_TOLERANCE_DAYS if isinstance(cached, _DATE_TYPES) else tolerance_for(a, policy)
        diff = b - a
        if abs(diff) > tol:
            return {"outcome": "mismatch", "type": "boolean" if "bool" in (ck, rk) else "number", "diff": diff, "tolerance": tol}
        return {"outcome": "matched"}

    if ck == "text" and rk == "text":
        return {"outcome": "matched"} if cv == rv else {"outcome": "mismatch", "type": "text"}

    return {"outcome": "mismatch", "type": "type_changed"}


def build_ledger(population, counts, excluded):
    """Every formula cell in exactly one outcome. `counts` holds the compared outcomes; `excluded` the cells set aside
    before comparison. Whatever the two do not account for is reported as not_run, never dropped."""
    keys = ("matched", "mismatched", "held_back", "volatile", "unresolved", "missing_cache", "unsupported")
    ex_keys = ("external_reference", "offset", "bare_multicell_name", "downstream_of_excluded")
    ledger = {k: int(counts.get(k, 0)) for k in keys}
    ledger.update({"excluded_" + k: int(excluded.get(k, 0)) for k in ex_keys})
    accounted = sum(ledger.values())
    ledger["population"] = int(population)
    ledger["accounted"] = accounted
    ledger["not_run"] = max(0, int(population) - accounted)
    ledger["unreconciled_excess"] = max(0, accounted - int(population))
    ledger["reconciles"] = (int(population) == accounted)
    ledger["compared"] = ledger["matched"] + ledger["mismatched"] + ledger["held_back"]
    return ledger
