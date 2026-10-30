"""decision_threshold.py - Patch 45. Does a change in an output change a decision?

The numeric comparison in recalc_compare.py asks whether two values are the same within a tolerance (0.1% relative). That
is the right question for "did the engine reproduce the saved value", and it must stay as it is: without a tolerance,
floating-point noise would be reported as disagreement. It is the wrong question for a covenant or other decision threshold.
1.2005 and 1.1995 are the same number to a tolerance, and they sit on opposite sides of a DSCR >= 1.20 test.

This module is the second, separate question: given a stated threshold, does the decision differ between two values?
It never changes how recalc_compare.classify() works.

A threshold must say where it comes from. A threshold without a source, units, operator or value is rejected, because a
decision test built on a guessed threshold would be a made-up finding.

Threshold record (JSON):
  {"id": "DSCR-min", "sheet": "Covenants", "cell": "H12", "operator": ">=", "value": 1.20, "units": "x",
   "period": "all", "rounding_decimals": 2, "source": "Facility agreement cl. 22.1, as stated by the client"}
  rounding_decimals: the rounding the agreement applies before the test (null = tested unrounded).
  period: "all" or a period label the threshold applies to; recorded, and matched against the cell's period by the caller.
"""
import json
import math

from decimal import Decimal, ROUND_HALF_UP

OPERATORS = (">=", ">", "<=", "<", "==")
REQUIRED = ("id", "sheet", "operator", "value", "units", "source")


def validate_threshold(t):
    """Returns a list of problems; empty when the threshold can be used."""
    problems = []
    if not isinstance(t, dict):
        return ["threshold is not an object"]
    for k in REQUIRED:
        v = t.get(k)
        if v is None or (isinstance(v, str) and not v.strip()):
            problems.append(f"missing {k}")
    if not (t.get("cell") or t.get("row")):
        problems.append("needs a cell or a row")
    if t.get("operator") is not None and t.get("operator") not in OPERATORS:
        problems.append(f"operator must be one of {', '.join(OPERATORS)}")
    v = t.get("value")
    if v is not None and (isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v)):
        problems.append("value must be a finite number")
    d = t.get("rounding_decimals")
    if d is not None and (isinstance(d, bool) or not isinstance(d, int) or d < 0 or d > 12):
        problems.append("rounding_decimals must be a whole number from 0 to 12, or null")
    if str(t.get("source", "")).strip().lower() in ("assumed", "unknown", "tbc", "n/a"):
        problems.append("source must name where the threshold comes from")
    return problems


def load_thresholds(path):
    """Reads a thresholds file. Returns (usable, problems). A file with any invalid threshold is not partly used."""
    with open(path, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    items = data.get("thresholds") if isinstance(data, dict) else data
    if not isinstance(items, list) or not items:
        return [], ["the file lists no thresholds"]
    problems, seen = [], set()
    for i, t in enumerate(items):
        for p in validate_threshold(t):
            problems.append(f"threshold {i + 1}: {p}")
        key = (t or {}).get("id") if isinstance(t, dict) else None
        if key in seen:
            problems.append(f"threshold {i + 1}: duplicate id {key}")
        seen.add(key)
    return ([] if problems else items), problems


def _round(x, decimals):
    if decimals is None:
        return x
    q = Decimal(1).scaleb(-decimals)
    return float(Decimal(repr(x)).quantize(q, rounding=ROUND_HALF_UP))


def passes(value, t):
    """True/False for the decision on one value, or None when the value is not a usable number."""
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return None
    x = _round(float(value), t.get("rounding_decimals"))
    thr = float(t["value"])
    op = t["operator"]
    if op == ">=":
        return x >= thr
    if op == ">":
        return x > thr
    if op == "<=":
        return x <= thr
    if op == "<":
        return x < thr
    return x == thr


def _band(value, tolerance):
    return abs(tolerance) if tolerance is not None else 0.0


def decision_test(original, other, t, tolerance=0.0, scenario_original=None, scenario_other=None):
    """Compares the decision on `original` with the decision on `other` (a recalculated value or a justified correction).

    tolerance is the numeric uncertainty of the engine at this value (recalc_compare.tolerance_for). If either value is within
    that band of the threshold the engine cannot say which side it is on: a differing decision is "flips_within_tolerance"
    (not called a defect, not cleared) and a matching one is "near_threshold". Both values must come from the same scenario; if the scenarios differ the values are not comparable.
    """
    base = {"id": t["id"], "operator": t["operator"], "threshold": t["value"], "units": t["units"],
            "rounding_decimals": t.get("rounding_decimals"), "source": t["source"], "original": original, "other": other}
    if scenario_original != scenario_other:
        return dict(base, outcome="not_comparable", reason="the two values are from different scenarios")
    a, b = passes(original, t), passes(other, t)
    if a is None or b is None:
        return dict(base, outcome="not_testable", reason="a value is not a usable number")
    thr = float(t["value"])
    # Distance to the threshold, in the units of the output, for the unrounded values.
    margin = min(abs(float(original) - thr), abs(float(other) - thr))
    tol = _band(original, tolerance)
    near = margin <= tol
    if a == b and not near:
        return dict(base, outcome="unchanged_pass" if a else "unchanged_fail", margin=margin, decision_original=a, decision_other=b)
    if a == b:
        # Same decision, but a value sits inside the engine's numeric tolerance of the line: the result is fragile.
        return dict(base, outcome="near_threshold", reason="same decision, but a value is within the engine's numeric tolerance of the threshold", margin=margin, tolerance=tol, decision_original=a, decision_other=b)
    if near:
        # The decisions differ while the numbers agree to the engine's tolerance. This is exactly what the numeric comparison
        # hides. It is not called a defect (the difference may be engine noise) and it is not cleared: it needs a decision.
        return dict(base, outcome="flips_within_tolerance", reason="the decision differs and the difference is inside the engine's numeric tolerance", margin=margin, tolerance=tol, decision_original=a, decision_other=b)
    return dict(base, outcome="flips_to_pass" if b else "flips_to_fail", margin=margin, decision_original=a, decision_other=b)


def correction_directions(original, delta, t, tolerance=0.0):
    """A correction of size `delta` whose sign is not known moves the output up or down. Tests both.

    direction_sensitive is True when the decision depends on which way the correction goes: the finding is then material to
    the decision whichever way it is resolved only if both directions flip it, and is a real risk if only one does.
    """
    up = decision_test(original, float(original) + abs(delta), t, tolerance)
    down = decision_test(original, float(original) - abs(delta), t, tolerance)
    outs = [r["outcome"] for r in (up, down)]
    flips = [o.startswith("flips") for o in outs]
    return {"up": up, "down": down,
            "direction_sensitive": any(flips) and not all(flips),
            "flips_either_way": all(flips),
            "flips_in_one_direction": sum(flips) == 1,
            "needs_decision": any(o in ("flips_within_tolerance", "near_threshold") for o in outs)}
