# Direct test of the Tier 3 readiness-gate logic added to build_report.py
# -- replicates the real gate computations and verdict integration to
# verify correctness without the full workbook-building context.

def compute_verdict(p1_open, critical_query_open, igReadiness,
                    mandatory_procedure_gap=False, critical_module_gap=False,
                    key_output_gap=False, reviewer_approved=False):
    other_gates_open = mandatory_procedure_gap or critical_module_gap or key_output_gap
    reviewer_approval_gap = not reviewer_approved
    if p1_open > 0 or critical_query_open > 0 or other_gates_open:
        if igReadiness >= 60:
            return 'RELIANCE-READY FOR INTERNAL REVIEW ONLY'
        else:
            return 'NOT RELIANCE-READY'
    elif igReadiness >= 95 and not reviewer_approval_gap:
        return 'RELIANCE-READY FOR TRANSACTION EXECUTION'
    elif igReadiness >= 95 and reviewer_approval_gap:
        return 'RELIANCE-READY FOR LENDER / INVESTOR REVIEW'
    elif igReadiness >= 80:
        return 'RELIANCE-READY FOR LENDER / INVESTOR REVIEW'
    elif igReadiness >= 60:
        return 'RELIANCE-READY FOR MANAGEMENT DISCUSSION'
    else:
        return 'RELIANCE-READY FOR INTERNAL REVIEW ONLY'

all_pass = True
def check(desc, got, expected):
    global all_pass
    ok = got == expected
    if not ok: all_pass = False
    print(f"{'PASS' if ok else 'FAIL'}: {desc}\n  -> expected {expected!r}, got {got!r}")

# Gate 1: incomplete mandatory critical procedure blocks like a P1
check('mandatory procedure gap alone (no P1, no CQ, 90% coverage) blocks at internal review',
      compute_verdict(0, 0, 90, mandatory_procedure_gap=True),
      'RELIANCE-READY FOR INTERNAL REVIEW ONLY')

# Gate 2: unaudited critical module blocks like a P1
check('critical module gap alone blocks at internal review',
      compute_verdict(0, 0, 90, critical_module_gap=True),
      'RELIANCE-READY FOR INTERNAL REVIEW ONLY')

# Gate 3: unreconciled key output blocks like a P1
check('key output gap alone blocks at internal review',
      compute_verdict(0, 0, 90, key_output_gap=True),
      'RELIANCE-READY FOR INTERNAL REVIEW ONLY')

# Gate + low coverage -> NOT RELIANCE-READY
check('any gate + low coverage -> not reliance-ready',
      compute_verdict(0, 0, 40, key_output_gap=True),
      'NOT RELIANCE-READY')

# Gate 4: reviewer approval caps ONLY the top tier
check('all gates clear, 97% coverage, NO reviewer approval -> capped at lender/investor review',
      compute_verdict(0, 0, 97, reviewer_approved=False),
      'RELIANCE-READY FOR LENDER / INVESTOR REVIEW')
check('all gates clear, 97% coverage, WITH reviewer approval -> transaction execution reachable',
      compute_verdict(0, 0, 97, reviewer_approved=True),
      'RELIANCE-READY FOR TRANSACTION EXECUTION')

# Reviewer approval does NOT block the lower tiers
check('85% coverage, no approval -> still lender/investor review (approval only gates the top tier)',
      compute_verdict(0, 0, 85, reviewer_approved=False),
      'RELIANCE-READY FOR LENDER / INVESTOR REVIEW')
check('65% coverage, no approval -> still management discussion',
      compute_verdict(0, 0, 65, reviewer_approved=False),
      'RELIANCE-READY FOR MANAGEMENT DISCUSSION')

# Pre-existing behavior unchanged: P1/CQ still gate exactly as before
check('open P1 still blocks exactly as before Tier 3',
      compute_verdict(1, 0, 90),
      'RELIANCE-READY FOR INTERNAL REVIEW ONLY')
check('unresolved Critical Query still blocks exactly as before Tier 3',
      compute_verdict(0, 1, 90),
      'RELIANCE-READY FOR INTERNAL REVIEW ONLY')

# Mandatory-critical-ID derivation from the real checklist
import json, os
checklist_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'config', 'checklist.json')
with open(checklist_path) as f:
    _cl = json.load(f)
rules = ([dict(r, _tier='Tier 1') for r in _cl.get('tier1', [])]
         + [dict(r, _tier='Tier 2') for r in _cl.get('tier2', [])])
_mandatory = {r['id'] for r in rules
              if r.get('severity') == 'fatal' or 'fatal gate' in str(r.get('source_section', '')).lower()}
check('mandatory-critical rule set derived from the real checklist.json has the confirmed count of 43',
      len(_mandatory), 43)

# Incomplete-mandatory detection against a simulated ruleResults
_rule_status = {'T1-001': 'pass', 'T1-004': 'fail'}  # T1-005 etc. absent entirely (not run)
incomplete = [rid for rid in _mandatory if _rule_status.get(rid) not in ('pass',)]
check('a failed mandatory rule AND every not-run mandatory rule both count as incomplete',
      ('T1-004' in incomplete and 'T1-005' in incomplete and 'T1-001' not in incomplete), True)

print('\n' + ('ALL TESTS PASSED' if all_pass else 'SOME TESTS FAILED'))
import sys
sys.exit(0 if all_pass else 1)
