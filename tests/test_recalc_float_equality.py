# Patch 61: =A=B tests that Excel calls TRUE (15-digit comparison) and the engine calls FALSE are held back, not raised.
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src"))
import recalc_compare as rc

fails = 0
def check(name, ok):
    global fails
    print(("PASS: " if ok else "FAIL: ") + name)
    if not ok:
        fails += 1

vals = {"AU116": 1234.5000000000002, "E116": 1234.5, "B5": 1.0000000000000002, "C5": 0.99, "D5": 5.0}
get = lambda ref: vals.get(ref)

check("operands read for cell = cell", rc.equality_operands("=AU116=E116") == ("AU116", "E116"))
check("operands read for cell = number, with $ signs", rc.equality_operands("=$B$5=1") == ("B5", "1"))
check("a function call is not a simple equality", rc.equality_operands("=SUM(A1:A3)=E116") is None)
check("a comparison other than = is not matched", rc.equality_operands("=A1>=B1") is None)
check("15-digit equality: last-bit difference is equal", rc.equal_to_15_digits(1234.5000000000002, 1234.5))
check("15-digit equality: a real difference is not equal", not rc.equal_to_15_digits(1234.5, 1234.6))
check("a Boolean is not treated as a number", not rc.equal_to_15_digits(True, 1))
check("quirk: TRUE saved, FALSE engine, sides equal to 15 digits",
      rc.is_float_equality_quirk(True, False, "=AU116=E116", get))
check("quirk: cell against number",
      rc.is_float_equality_quirk(True, False, "=B5=1", get))
check("not a quirk when the sides genuinely differ (0.99 vs 1)",
      not rc.is_float_equality_quirk(True, False, "=C5=1", get))
check("not a quirk when the saved value is FALSE",
      not rc.is_float_equality_quirk(False, True, "=AU116=E116", get))
check("not a quirk when an operand cannot be read",
      not rc.is_float_equality_quirk(True, False, "=ZZ1=E116", get))
check("not a quirk for a formula with a function",
      not rc.is_float_equality_quirk(True, False, "=SUM(A1:A3)=E116", get))
print("%d failed" % fails if fails else "\nall checks passed")
sys.exit(1 if fails else 0)
