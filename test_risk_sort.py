# Direct test of the Top 5 Blockers sort key, replicating the real logic
# to verify risk_weighted_total correctly ranks WITHIN a priority tier
# without ever letting a P2 outrank a P1, regardless of risk score.

def priority(f):
    return f.get('_priority')  # simplified stand-in for the real priority() function

_pri_rank = {'P1': 0, 'P2': 1, 'P3': 2}

def sort_key(f):
    return (
        _pri_rank.get(priority(f), 3),
        -(f.get('risk_weighted_total') or 0),
        0 if str(f.get('key_output_impact', '')).lower() in ('yes', 'true', 'high') else 1,
        -(f.get('fscore') or 0),
    )

findings = [
    { '_priority': 'P2', 'risk_weighted_total': 25, 'name': 'high-risk P2' },
    { '_priority': 'P1', 'risk_weighted_total': 5,  'name': 'low-risk P1' },
    { '_priority': 'P2', 'risk_weighted_total': 10, 'name': 'low-risk P2' },
    { '_priority': 'P3', 'risk_weighted_total': 30, 'name': 'high-risk P3' },
    { '_priority': 'P2', 'name': 'unscored P2 (e.g. not a Confirmed Finding)' },  # no risk_weighted_total at all
]

ordered = sorted(findings, key=sort_key)
names = [f['name'] for f in ordered]
print('Sort order:', names)

# The P1, however low its risk score, must ALWAYS come before every P2 --
# this is the memo's own explicit caveat: risk score ranks WITHIN a tier,
# never creates or reassigns a tier.
assert names[0] == 'low-risk P1', "A P1 must always rank first, regardless of its risk score being lower than any P2's"

# Within P2, the higher risk score must rank first.
p2_names = [n for n in names if 'P2' in n or n == 'unscored P2 (e.g. not a Confirmed Finding)']
assert p2_names.index('high-risk P2') < p2_names.index('low-risk P2'), "Higher risk_weighted_total must rank first within the same tier"
assert p2_names.index('low-risk P2') < p2_names.index('unscored P2 (e.g. not a Confirmed Finding)'), "An unscored finding (risk_weighted_total absent) falls back to 0 and ranks last within its tier, not crashing or sorting arbitrarily"

# P3 comes after both P1 and P2 regardless of its high risk score.
assert names[-1] == 'high-risk P3', "A P3 must never outrank a P1 or P2 no matter how high its risk score is"

print('PASS: P1 always ranks first regardless of risk score (tier gating never violated)')
print('PASS: within P2, higher risk_weighted_total correctly ranks first')
print('PASS: an unscored finding falls back to 0 gracefully, ranks last within its tier')
print('PASS: P3 never outranks P1/P2 despite the highest raw risk score in this test')
print('\nALL TESTS PASSED')
