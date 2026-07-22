# Direct unit test of the priority() logic added to build_report.py --
# copied verbatim from the real function to verify correctness without
# needing to invoke the full report-building pipeline.

def priority(f):
    if (f.get('record_type') or 'Confirmed Finding') != 'Confirmed Finding':
        return f.get('record_type')
    sev = (f.get('severity') or '').lower()
    if sev in ('fatal','critical'): return 'P1'
    if sev in ('high','medium'): return 'P2'
    return 'P3'

cases = [
    ({'record_type': 'Confirmed Finding', 'severity': 'critical'}, 'P1'),
    ({'record_type': 'Confirmed Finding', 'severity': 'high'}, 'P2'),
    ({'record_type': 'Confirmed Finding', 'severity': 'low'}, 'P3'),
    ({'record_type': 'Query', 'severity': 'high'}, 'Query'),  # severity ignored -- record_type gates first
    ({'record_type': 'Critical Query', 'severity': 'medium'}, 'Critical Query'),
    ({'record_type': 'Observation', 'severity': 'critical'}, 'Observation'),  # even a "critical"-severity Observation must NOT become P1
    ({'record_type': 'Scope Limitation'}, 'Scope Limitation'),
    ({'record_type': 'Not Applicable'}, 'Not Applicable'),
    ({'record_type': 'False Positive', 'severity': 'critical'}, 'False Positive'),
    ({'severity': 'critical'}, 'P1'),  # no record_type at all -- defaults to Confirmed Finding (backward compatibility)
]

all_pass = True
for finding, expected in cases:
    got = priority(finding)
    ok = got == expected
    if not ok: all_pass = False
    print(f"{'PASS' if ok else 'FAIL'}: {finding} -> expected {expected!r}, got {got!r}")

# Confirm the list-comprehension usage pattern works correctly too
findings = [
    {'record_type': 'Confirmed Finding', 'severity': 'critical'},  # P1
    {'record_type': 'Confirmed Finding', 'severity': 'high'},      # P2
    {'record_type': 'Confirmed Finding', 'severity': 'low'},       # P3
    {'record_type': 'Critical Query', 'severity': 'critical'},     # must NOT count as P1 despite critical severity
    {'record_type': 'Observation', 'severity': 'high'},            # must NOT count as P2
]
p1 = [f for f in findings if priority(f)=='P1']
p2 = [f for f in findings if priority(f)=='P2']
p3 = [f for f in findings if priority(f)=='P3']
critical_queries = [f for f in findings if f.get('record_type')=='Critical Query']

counts_ok = len(p1)==1 and len(p2)==1 and len(p3)==1 and len(critical_queries)==1
print(f"\n{'PASS' if counts_ok else 'FAIL'}: list-comprehension counts (p1={len(p1)}, p2={len(p2)}, p3={len(p3)}, critical_queries={len(critical_queries)})")
if not counts_ok: all_pass = False

print("\n" + ("ALL TESTS PASSED" if all_pass else "SOME TESTS FAILED"))
import sys
sys.exit(0 if all_pass else 1)
