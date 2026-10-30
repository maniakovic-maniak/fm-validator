import os, sys, json, tempfile
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src"))
import decision_threshold as dt
import recalc_compare as rc

fails = 0
def check(name, ok):
    global fails
    print(("PASS: " if ok else "FAIL: ") + name)
    if not ok:
        fails += 1

T = {"id": "DSCR-min", "sheet": "Cov", "cell": "H12", "operator": ">=", "value": 1.20, "units": "x", "period": "all",
     "rounding_decimals": 2, "source": "Facility agreement cl. 22.1, as stated by the client"}
tol = lambda v: rc.tolerance_for(v)

# 1. the gap the numeric comparison leaves: 1.2005 and 1.1995 are "matched" numerically and opposite decisions
check("the numeric comparison calls 1.2005 and 1.1995 the same", rc.classify(1.2005, 1.1995)["outcome"] == "matched")
T_raw = dict(T, rounding_decimals=None)
r = dt.decision_test(1.2005, 1.1995, T_raw, tol(1.2005))
check("the decision test sees the flip and says it is inside the engine tolerance, not a defect and not cleared", r["outcome"] == "flips_within_tolerance")
check("a clear flip is reported as a flip", dt.decision_test(1.35, 1.05, T, tol(1.35))["outcome"] == "flips_to_fail")
check("a flip upward is reported too", dt.decision_test(1.05, 1.35, T, tol(1.05))["outcome"] == "flips_to_pass")

# 2. valid cases are preserved: no change in decision is not a finding, and noise away from the line is ignored
check("different numbers on the same side of the line: unchanged pass", dt.decision_test(1.50, 1.4985, T, tol(1.5))["outcome"] == "unchanged_pass")
check("unchanged fail", dt.decision_test(1.00, 0.9990, T, tol(1.0))["outcome"] == "unchanged_fail")
check("same decision but sitting on the line is marked fragile", dt.decision_test(1.2004, 1.2002, T_raw, tol(1.2))["outcome"] == "near_threshold")

# 3. equality and rounding
check("exactly at the threshold passes >=", dt.passes(1.20, T) is True)
check("exactly at the threshold fails >", dt.passes(1.20, dict(T, operator=">")) is False)
check("rounding is applied before the test: 1.196 rounds to 1.20 and passes", dt.passes(1.196, T) is True)
check("unrounded, the same value fails", dt.passes(1.196, T_raw) is False)
check("rounding is half-up, not banker's: 1.195 rounds to 1.20", dt.passes(1.195, T) is True)
check("<= and < behave", dt.passes(0.5, dict(T, operator="<=", value=0.5)) is True and dt.passes(0.5, dict(T, operator="<", value=0.5)) is False)

# 4. both correction directions
d = dt.correction_directions(1.25, 0.10, T, tol(1.25))
check("a correction that can only hurt: one direction flips, so the decision depends on the sign", d["direction_sensitive"] and d["flips_in_one_direction"] and d["up"]["outcome"] == "unchanged_pass" and d["down"]["outcome"] == "flips_to_fail")
d2 = dt.correction_directions(1.20, 0.30, dict(T, operator="=="), tol(1.2))
check("a correction that flips either way is reported as flipping either way", d2["flips_either_way"] and not d2["direction_sensitive"])
d3 = dt.correction_directions(1.60, 0.05, T, tol(1.6))
check("a small correction far from the line changes nothing in either direction", not any([d3["direction_sensitive"], d3["flips_either_way"], d3["flips_in_one_direction"]]))

# 5. incomplete evidence stays unresolved
check("different scenarios are not compared", dt.decision_test(1.3, 1.1, T, 0.001, "Base", "Downside")["outcome"] == "not_comparable")
check("same scenario is compared", dt.decision_test(1.3, 1.1, T, 0.001, "Base", "Base")["outcome"] == "flips_to_fail")
check("a text value or an error is not testable", dt.decision_test("n/a", 1.3, T)["outcome"] == "not_testable" and dt.decision_test(float("nan"), 1.3, T)["outcome"] == "not_testable" and dt.decision_test(None, 1.3, T)["outcome"] == "not_testable")
check("a Boolean is not a number", dt.passes(True, T) is None)

# 6. a threshold must say where it comes from
check("a complete threshold is valid", dt.validate_threshold(T) == [])
check("no source is rejected", any("source" in p for p in dt.validate_threshold(dict(T, source=""))))
check("'assumed' is not a source", any("source" in p for p in dt.validate_threshold(dict(T, source="assumed"))))
check("a bad operator, units and value are rejected", len(dt.validate_threshold(dict(T, operator="=>", units="", value="1.2"))) >= 3)
check("no cell or row is rejected", any("cell or a row" in p for p in dt.validate_threshold({k: v for k, v in T.items() if k != "cell"})))
check("rounding must be a sensible whole number", any("rounding" in p for p in dt.validate_threshold(dict(T, rounding_decimals=-1))))

# 7. the file loader does not partly use a bad file
with tempfile.TemporaryDirectory() as td:
    good, bad, dup = os.path.join(td, "g.json"), os.path.join(td, "b.json"), os.path.join(td, "d.json")
    json.dump({"thresholds": [T]}, open(good, "w")); json.dump({"thresholds": [T, dict(T, id="X", source="")]}, open(bad, "w")); json.dump({"thresholds": [T, T]}, open(dup, "w"))
    u, p = dt.load_thresholds(good); check("a good file loads", len(u) == 1 and not p)
    u, p = dt.load_thresholds(bad); check("one bad threshold means none are used", u == [] and len(p) >= 1)
    u, p = dt.load_thresholds(dup); check("duplicate ids are rejected", u == [] and any("duplicate" in x for x in p))

# 8. the numeric policy is untouched
check("the numeric tolerance is still 0.1% relative", rc.POLICY["relative"] == 0.001)
print("\n" + (f"{fails} FAILED" if fails else "All decision-threshold checks passed"))
sys.exit(1 if fails else 0)
