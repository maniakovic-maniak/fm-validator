# Direct test of the _reason / _next_step / _blockers text fields fixed
# after finding they were missed in the original Tier 1 item 3 pass --
# these three were left referencing p1_open directly while sitting right
# next to a verdict banner that already correctly accounted for
# critical_query_open.

def compute_texts(p1_open, critical_query_open, igReadiness, cov_unc=0, cov_np=0):
    _open_desc = (f'{p1_open} open P1 finding(s)' if p1_open>0 else '') + \
                 (' and ' if p1_open>0 and critical_query_open>0 else '') + \
                 (f'{critical_query_open} unresolved Critical Quer{"y" if critical_query_open==1 else "ies"}' if critical_query_open>0 else '')
    _has_blocker = p1_open>0 or critical_query_open>0
    _reason = (f'{_open_desc} and {igReadiness}% audit completion' if _has_blocker
               else f'{igReadiness}% audit completion, {cov_unc} procedure(s) uncertain, {cov_np} not run' if igReadiness<100 or cov_unc or cov_np
               else 'All planned procedures completed with no open P1 findings or unresolved Critical Queries')
    _next_step = ('Close all P1 items and resolve all Critical Queries (confirming whether a defect exists either way), then complete outstanding procedures and reassess.' if _has_blocker
                  else 'Resolve remaining P2 items and complete outstanding procedures before wider reliance.' if igReadiness<95
                  else 'No further action required for this reliance level.')
    _blockers=[]
    if p1_open>0: _blockers.append('open P1 findings')
    if critical_query_open>0: _blockers.append('unresolved Critical Queries')
    _takeaway = (f"The model is not currently suitable for reliance. The main blockers are {', '.join(_blockers[:4])}."
                 if _has_blocker or _blockers else
                 "The model has no open P1 findings or unresolved Critical Queries and is suitable for reliance at the level shown above.")
    return _reason, _next_step, _takeaway

# The exact real scenario found in the actual report that exposed this gap:
# 4 P1, 16 Critical Query, 48% coverage.
reason, next_step, takeaway = compute_texts(4, 16, 48)
print('Real scenario (4 P1, 16 Critical Query, 48% coverage):')
print('  Reason:', reason)
print('  Next step:', next_step)
print('  Takeaway:', takeaway)
assert '4 open P1 finding(s)' in reason and '16 unresolved Critical Queries' in reason, "Reason must mention BOTH blockers, not just P1"
assert 'Critical Quer' in next_step
assert 'unresolved Critical Queries' in takeaway
print('PASS: real scenario correctly mentions both P1 and Critical Query counts\n')

# Critical Query alone, no P1 -- must still be treated as a real blocker
reason2, next_step2, takeaway2 = compute_texts(0, 3, 90)
print('Critical Query alone (0 P1, 3 Critical Query, 90% coverage):')
print('  Reason:', reason2)
assert '3 unresolved Critical Queries' in reason2 and 'open P1' not in reason2
print('PASS: Critical-Query-alone scenario correctly blocks without falsely mentioning P1\n')

# Clean scenario -- no blockers, full coverage
reason3, next_step3, takeaway3 = compute_texts(0, 0, 100)
print('Clean scenario (0 P1, 0 Critical Query, 100% coverage):')
print('  Reason:', reason3)
assert 'no open P1 findings or unresolved Critical Queries' in reason3
assert 'no open P1 findings or unresolved Critical Queries' in takeaway3
print('PASS: clean scenario correctly confirms both are absent\n')

print('ALL TESTS PASSED')
