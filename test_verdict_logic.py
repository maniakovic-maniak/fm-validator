# Direct test of the verdict logic block -- replicates the real if/elif
# chain from build_report.py to verify the new Critical Query gate
# works correctly across all branches without needing the full
# workbook-building context.

def compute_verdict(p1_open, p2_open, critical_query_open, igReadiness, cov_pass=0, cov_issue=0, cov_unc=0, cov_np=0):
    if p1_open > 0 or critical_query_open > 0:
        if igReadiness >= 60:
            return 'RELIANCE-READY FOR INTERNAL REVIEW ONLY'
        else:
            return 'NOT RELIANCE-READY'
    elif igReadiness >= 95:
        return 'RELIANCE-READY FOR TRANSACTION EXECUTION'
    elif igReadiness >= 80:
        return 'RELIANCE-READY FOR LENDER / INVESTOR REVIEW'
    elif igReadiness >= 60:
        return 'RELIANCE-READY FOR MANAGEMENT DISCUSSION'
    else:
        return 'RELIANCE-READY FOR INTERNAL REVIEW ONLY'

cases = [
    # (p1_open, p2_open, critical_query_open, igReadiness, expected, description)
    (1, 0, 0, 90, 'RELIANCE-READY FOR INTERNAL REVIEW ONLY', 'open P1 alone caps at internal review, same as before this change'),
    (0, 0, 1, 90, 'RELIANCE-READY FOR INTERNAL REVIEW ONLY', 'NEW: an unresolved Critical Query alone, with NO open P1, now ALSO caps at internal review'),
    (1, 0, 0, 40, 'NOT RELIANCE-READY', 'open P1 + low coverage -> not ready, unchanged'),
    (0, 0, 1, 40, 'NOT RELIANCE-READY', 'NEW: unresolved Critical Query + low coverage -> not ready, same severity as an open P1'),
    (0, 3, 0, 97, 'RELIANCE-READY FOR TRANSACTION EXECUTION', 'no P1, no critical query, high coverage -> full readiness, P2s do not block'),
    (0, 0, 0, 85, 'RELIANCE-READY FOR LENDER / INVESTOR REVIEW', 'no blockers, 85% coverage'),
    (0, 0, 0, 65, 'RELIANCE-READY FOR MANAGEMENT DISCUSSION', 'no blockers, 65% coverage'),
    (0, 0, 0, 30, 'RELIANCE-READY FOR INTERNAL REVIEW ONLY', 'no blockers but low coverage -> internal review only'),
]

all_pass = True
for p1, p2, cq, cov, expected, desc in cases:
    got = compute_verdict(p1, p2, cq, cov)
    ok = got == expected
    if not ok: all_pass = False
    print(f"{'PASS' if ok else 'FAIL'}: {desc}\n  p1={p1} p2={p2} critical_query={cq} coverage={cov}% -> expected {expected!r}, got {got!r}")

print("\n" + ("ALL TESTS PASSED" if all_pass else "SOME TESTS FAILED"))
import sys
sys.exit(0 if all_pass else 1)
